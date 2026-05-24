// ─────────────────────────────────────────────────────────────────
//  ISRACARD IMPORT FLOW
//
//  Mirrors the IBI flow's lifecycle:
//
//    user clicks "Import statement"
//      → hidden <input type="file"> opens
//      → arrayBuffer → readXLSX → parseIsracardStatement
//      → match a card by last4
//      → render preview into the shared modal shell
//      → on Apply, replace card.charges and persist
//
//  Match strategy is intentionally conservative: a single active
//  credit card with the parsed last4. Multiple matches → require
//  user to pick. Zero matches → error with the parsed last4 quoted.
//
//  Apply strategy is UPSERT (see charge-merge.js): the file is a
//  partial feed, not the whole truth. Charges already on the card but
//  absent from the file are KEPT, not deleted — so a monthly file with
//  only that month's charges accumulates into a running ledger instead
//  of wiping history. Re-running the same file is idempotent (voucher
//  numbers are stable IDs).
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { t } from '../i18n.js';
import { formatCurrency, calcCardPendingCharges } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { readXLSX } from './xlsx-reader.js';
import { parseIsracardStatement } from './isracard-parser.js';
import { upsertImportedCharges } from './charge-merge.js';

let _pendingImport = null;     // { result, card, counts }

// ── Public entry point — wired on window in app.js ──────────────

export function openIsracardImportFlow() {
  let input = document.getElementById('isracard-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.id = 'isracard-file-input';
    input.style.display = 'none';
    input.addEventListener('change', _handleFileSelected);
    document.body.appendChild(input);
  }
  input.value = '';
  input.click();
}

async function _handleFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const rows   = await readXLSX(buffer);
    const result = parseIsracardStatement(rows, file.name);

    if (!result.ok) {
      _showImportError(result.errors[0]?.message || t('import.isracard.errorGeneric'));
      return;
    }

    const data  = getAppData();
    const match = _matchCard(data, result.cardLast4);
    if (match.kind === 'none') {
      _showImportError(t('import.isracard.cardNotFound').replace('{last4}', result.cardLast4 || '—'));
      return;
    }
    if (match.kind === 'multiple') {
      _showImportError(t('import.isracard.multipleCards').replace('{last4}', result.cardLast4));
      return;
    }

    _pendingImport = {
      result,
      card:   match.card,
      counts: _previewCounts(match.card, result.charges),
    };
    _openPreviewModal();
  } catch (err) {
    console.error('Isracard import failed:', err);
    _showImportError(err.message || t('import.isracard.errorGeneric'));
  }
}

// Find the active credit card that matches the parsed last4. Returns
// {kind: 'one'|'multiple'|'none', card?}.
function _matchCard(data, last4) {
  if (!last4) return { kind: 'none' };
  const candidates = (data.cards || []).filter(c =>
    c.isActive && c.last4 === last4
  );
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1)  return { kind: 'multiple', candidates };
  return { kind: 'one', card: candidates[0] };
}

// ── Modal lifecycle — reuses #modal-overlay shell ────────────────

function _openPreviewModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.isracard.previewTitle');
  saveBtnEl.textContent   = t('import.applyButton');
  saveBtnEl.className     = 'btn btn-primary';
  saveBtnEl.style.display = '';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = _renderPreview(_pendingImport);
  overlay.classList.add('open');
  overlay.classList.add('modal-overlay--wide');
}

function _closePreviewModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.classList.remove('modal-overlay--wide');
  _pendingImport = null;
}

export function hasPendingIsracardImport() { return _pendingImport !== null; }

export function applyPendingIsracardImport() {
  if (!_pendingImport) return false;
  _applyToState(_pendingImport);
  _closePreviewModal();
  return true;
}

export function clearPendingIsracardImport() {
  _pendingImport = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}

// ── Apply: upsert the parsed charges into the card ──────────────

function _applyToState({ result, card }) {
  const data = getAppData();
  const idx  = (data.cards || []).findIndex(c => c.id === card.id);
  if (idx === -1) return;

  const target = data.cards[idx];

  // Split prior charges by source so manual quick-entries survive the
  // import untouched. Imported charges go through the upsert: matched
  // rows refresh while keeping user enrichment, new rows are added,
  // and prior imported charges absent from the file are KEPT.
  const priorCharges  = target.charges || [];
  const priorManual   = priorCharges.filter(c => c.source === 'manual');
  const priorImported = priorCharges.filter(c => c.source !== 'manual');

  const { charges: importedCharges } = upsertImportedCharges(
    priorImported, result.charges, _chargeForStorage
  );

  target.charges = [...priorManual, ...importedCharges];
  // Stored fallback only — the windowed pending total. The live
  // outstanding figure is recomputed from charges[] by
  // calcCardPendingCharges everywhere it's shown.
  target.currentSpending = calcCardPendingCharges(target);
  target.updatedAt       = todayISO();

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  // After the import settles, reconcile the file's charges against any
  // manual quick-entries: exact duplicates merge automatically, the
  // rest are surfaced for the user. setTimeout defers past the preview
  // modal's own close cycle.
  const newlyImportedIds = new Set(result.charges.map(c => c.id));
  setTimeout(() => _maybeOpenReconcile(card.id, newlyImportedIds), 50);
}

// Storage shape for one imported charge. `prior` (when the upsert
// matched an existing charge) carries the user's enrichment forward.
function _chargeForStorage(parsed, prior) {
  return {
    id:               parsed.id,
    date:             parsed.date,
    merchant:         parsed.merchant,
    amount:           parsed.amount,
    currency:         parsed.currency,
    originalAmount:   parsed.originalAmount,
    originalCurrency: parsed.originalCurrency,
    voucher:          parsed.voucher,
    note:             parsed.note,
    status:           parsed.status,
    importedFrom:     parsed.importedFrom,
    importedAt:       parsed.importedAt,
    source:           'imported',
    displayName:        prior?.displayName        ?? null,
    categoryId:         prior?.categoryId         ?? null,
    subcategoryId:      prior?.subcategoryId      ?? null,
    notes:              prior?.notes              ?? null,
    isRecurringMonthly: prior?.isRecurringMonthly ?? false,
  };
}

// Dry-run the upsert to count new / updated / kept for the preview.
function _previewCounts(card, parsedCharges) {
  const priorImported = (card.charges || []).filter(c => c.source !== 'manual');
  const { addedCount, updatedCount, keptCount } =
    upsertImportedCharges(priorImported, parsedCharges, p => p);
  return { addedCount, updatedCount, keptCount };
}

async function _maybeOpenReconcile(cardId, newlyImportedIds) {
  const { openReconcileForCard } = await import('./reconcile-flow.js');
  openReconcileForCard(cardId, newlyImportedIds);
}

// ── Preview rendering ────────────────────────────────────────────

function _renderPreview({ result, card, counts }) {
  const pending   = result.pending.length;
  const committed = result.committed.length;
  const total     = pending + committed;
  const { addedCount, updatedCount, keptCount } = counts;

  const previewHtml = _renderChargesPreview(result);
  const warningsHtml = _renderWarnings(result.warnings);

  return `
    <div class="import-preview">
      <div class="import-section">
        <div class="import-section-title">${t('import.isracard.cardMatched')}</div>
        <div class="import-isracard-card">
          <span class="import-isracard-card-name">${_esc(card.name)}</span>
          <span class="import-isracard-card-last4">•••• ${_esc(card.last4)}</span>
          ${result.statementMonth ? `<span class="import-isracard-card-month">${_esc(_formatStatementMonth(result.statementMonth))}</span>` : ''}
        </div>
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('import.isracard.changes')}</div>
        <div class="import-summary-pills">
          <span class="import-pill import-pill--unchanged">${total} ${t('import.isracard.inFile')}</span>
          ${addedCount > 0   ? `<span class="import-pill import-pill--added">+${addedCount} ${t('import.new')}</span>` : ''}
          ${updatedCount > 0 ? `<span class="import-pill import-pill--updated">~${updatedCount} ${t('import.updated')}</span>` : ''}
          ${keptCount > 0    ? `<span class="import-pill import-pill--kept">${keptCount} ${t('import.kept')}</span>` : ''}
        </div>
        <p class="import-keep-note">${t('import.keepNote')}</p>
      </div>

      ${previewHtml}
      ${warningsHtml}
    </div>
  `;
}

function _renderChargesPreview(result) {
  // Show top 8 by amount so the user sees the biggest impact at a
  // glance without scrolling a long modal.
  const top = [...result.charges]
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 8);
  if (top.length === 0) return '';

  return `
    <div class="import-section">
      <div class="import-section-title">${t('import.isracard.topCharges')}</div>
      <div class="import-changes-list">
        ${top.map(c => _renderChargeRow(c)).join('')}
      </div>
    </div>
  `;
}

function _renderChargeRow(charge) {
  const dateText = charge.date ? formatChargeDate(charge.date) : (charge.rawDate || '');
  const fxText   = charge.originalCurrency && charge.originalCurrency !== charge.currency
    ? ` · ${charge.originalAmount} ${charge.originalCurrency}`
    : '';
  const statusCls = charge.status === 'pending' ? 'import-change-row--updated' : 'import-change-row--added';
  return `
    <div class="import-change-row ${statusCls}">
      <span class="import-change-marker">${charge.status === 'pending' ? '~' : '+'}</span>
      <span class="import-change-name">${_esc(charge.merchant)}</span>
      <span class="import-change-value">${formatCurrency(charge.amount || 0, { cents: true })}</span>
      <span class="import-change-detail">${_esc(dateText)}${fxText}</span>
    </div>
  `;
}

function _renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return `
    <div class="import-section">
      <div class="import-section-title import-section-title--warning">${t('import.warnings')}</div>
      <ul class="import-warnings">
        ${warnings.map(w => `<li>${_esc(w.message)}</li>`).join('')}
      </ul>
    </div>
  `;
}

// ── Error display ───────────────────────────────────────────────

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.isracard.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${_esc(message)}</p>
    <p class="modal-confirm-text import-error-hint">${t('import.isracard.errorHint')}</p>
  `;
  overlay.classList.add('open');
}

// ── Helpers ─────────────────────────────────────────────────────

const _HEBREW_MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const _ENGLISH_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// "2026-06" → "יוני 2026" / "Jun 2026" depending on UI language.
function _formatStatementMonth(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return yyyymm;
  // Re-read current language at format time so a language toggle
  // before the user confirms reflects in the rendered preview.
  const isHe = document.documentElement.lang === 'he';
  const names = isHe ? _HEBREW_MONTH_NAMES : _ENGLISH_MONTH_NAMES;
  return `${names[idx]} ${y}`;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
