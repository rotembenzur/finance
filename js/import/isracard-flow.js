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
//  Apply strategy is REPLACE: each new file represents one billing
//  cycle, and that's the unit the UI displays. Re-running with the
//  same file is idempotent (voucher numbers are stable IDs).
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { t } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { readXLSX } from './xlsx-reader.js';
import { parseIsracardStatement } from './isracard-parser.js';

let _pendingImport = null;     // { result, card, replacing }

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
      card:      match.card,
      replacing: (match.card.charges || []).length,
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

// ── Apply: replace the card's charges with the parsed set ───────

function _applyToState({ result, card }) {
  const data = getAppData();
  const idx  = (data.cards || []).findIndex(c => c.id === card.id);
  if (idx === -1) return;

  const target = data.cards[idx];

  // Split prior charges by source so manual quick-entries survive
  // the import. Imported charges are merged-by-id (imported fields
  // refresh, user enrichment carries over). Anything no longer in
  // the file is dropped — but only on the imported side.
  const priorCharges    = target.charges || [];
  const priorManual     = priorCharges.filter(c => c.source === 'manual');
  const priorImportedBy = new Map(
    priorCharges.filter(c => c.source !== 'manual').map(c => [c.id, c])
  );

  const importedCharges = result.charges.map(parsed => {
    const prior = priorImportedBy.get(parsed.id);
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
  });

  target.charges = [...priorManual, ...importedCharges];
  // Headline figure sums everything — duplicate manual+imported pairs
  // will collapse once the user runs reconciliation.
  target.currentSpending = target.charges.reduce((s, c) => s + (c.amount || 0), 0);
  target.updatedAt       = todayISO();

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  // After the import settles, check whether any of the manual entries
  // look like duplicates of newly-imported ones; if so, open the
  // reconcile modal. setTimeout(0) defers past the preview modal's
  // own close cycle.
  const newlyImportedIds = new Set(importedCharges.map(c => c.id));
  setTimeout(() => _maybeOpenReconcile(card.id, newlyImportedIds), 50);
}

async function _maybeOpenReconcile(cardId, newlyImportedIds) {
  const { openReconcileForCard } = await import('./reconcile-flow.js');
  openReconcileForCard(cardId, newlyImportedIds);
}

// ── Preview rendering ────────────────────────────────────────────

function _renderPreview({ result, card, replacing }) {
  const pending   = result.pending.length;
  const committed = result.committed.length;
  const total     = pending + committed;

  const totalsHtml = _renderTotalsBlock(result, card, replacing);
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

      ${totalsHtml}

      <div class="import-section">
        <div class="import-section-title">${t('import.isracard.changes')}</div>
        <div class="import-summary-pills">
          <span class="import-pill import-pill--added">${total} ${t('import.isracard.charges')}</span>
          ${committed > 0 ? `<span class="import-pill import-pill--unchanged">${committed} ${t('import.isracard.committed')}</span>` : ''}
          ${pending > 0   ? `<span class="import-pill import-pill--updated">${pending} ${t('import.isracard.pending')}</span>`   : ''}
          ${replacing > 0 ? `<span class="import-pill import-pill--removed">−${replacing} ${t('import.isracard.replaced')}</span>` : ''}
        </div>
      </div>

      ${previewHtml}
      ${warningsHtml}
    </div>
  `;
}

function _renderTotalsBlock(result, card, replacing) {
  const beforeSpending = Number(card.currentSpending) || 0;
  const afterSpending  = result.totals.committed;
  const beforeCount    = replacing;
  const afterCount     = result.charges.length;

  return `
    <div class="import-section">
      <div class="import-section-title">${t('import.isracard.totals')}</div>
      <div class="import-totals">
        <div class="import-totals-row ${beforeSpending !== afterSpending ? 'is-changed' : ''}">
          <span class="import-totals-label">${t('import.isracard.committedTotal')}</span>
          <span class="import-totals-before">${formatCurrency(beforeSpending)}</span>
          <span class="import-totals-arrow">→</span>
          <span class="import-totals-after">${formatCurrency(afterSpending)}</span>
        </div>
        <div class="import-totals-row ${beforeCount !== afterCount ? 'is-changed' : ''}">
          <span class="import-totals-label">${t('import.isracard.chargesCount')}</span>
          <span class="import-totals-before">${beforeCount}</span>
          <span class="import-totals-arrow">→</span>
          <span class="import-totals-after">${afterCount}</span>
        </div>
      </div>
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
