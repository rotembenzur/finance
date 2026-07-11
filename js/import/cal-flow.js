// ─────────────────────────────────────────────────────────────────
//  CAL IMPORT FLOW
//
//  CAL (כאל) exports one XLSX per card. Flow mirrors Isracard's:
//
//    user clicks "Import CAL statement"
//      → hidden <input type="file"> opens
//      → arrayBuffer → readXLSX → parseCalStatement
//      → match a card by last4
//      → render diff preview in the shared modal shell
//      → on Apply, UPSERT charges into the matched card
//
//  Apply is UPSERT (charge-merge.js): re-importing the same file
//  is idempotent; manual quick-entries are untouched.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { t } from '../i18n.js';
import { calcCardPendingCharges } from '../utils.js';
import { readXLSX } from './xlsx-reader.js';
import { parseCalStatement } from './cal-parser.js';
import { upsertImportedCharges } from './charge-merge.js';
import { renderImportDiff } from './diff-preview.js';

let _pendingImport = null;  // { result, card, diff }

// ── Public entry point ────────────────────────────────────────

export function openCalImportFlow() {
  let input = document.getElementById('cal-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.id = 'cal-file-input';
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
    const result = parseCalStatement(rows, file.name);

    if (!result.ok) {
      _showImportError(result.errors[0]?.message || t('import.cal.errorGeneric'));
      return;
    }

    const data  = getAppData();
    const match = _matchCard(data, result.cardLast4);
    if (match.kind === 'none') {
      _showImportError(t('import.cal.cardNotFound').replace('{last4}', result.cardLast4 || '—'));
      return;
    }
    if (match.kind === 'multiple') {
      _showImportError(t('import.cal.multipleCards').replace('{last4}', result.cardLast4));
      return;
    }

    _pendingImport = {
      result,
      card: match.card,
      diff: _previewDiff(match.card, result.charges),
    };
    _openPreviewModal();
  } catch (err) {
    console.error('CAL import failed:', err);
    _showImportError(err.message || t('import.cal.errorGeneric'));
  }
}

function _matchCard(data, last4) {
  if (!last4) return { kind: 'none' };
  const candidates = (data.cards || []).filter(c => c.isActive && c.last4 === last4);
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1)  return { kind: 'multiple', candidates };
  return { kind: 'one', card: candidates[0] };
}

// ── Modal lifecycle ───────────────────────────────────────────

function _openPreviewModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.cal.previewTitle');
  saveBtnEl.textContent   = t('import.applyButton');
  saveBtnEl.className     = 'btn btn-primary';
  saveBtnEl.style.display = '';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = _renderPreview(_pendingImport);
  overlay.classList.add('open');
  overlay.classList.add('modal-overlay--wide');
}

export function hasPendingCalImport()   { return _pendingImport !== null; }

export function applyPendingCalImport() {
  if (!_pendingImport) return false;
  _applyToState(_pendingImport);
  _closePreviewModal();
  return true;
}

export function clearPendingCalImport() {
  _pendingImport = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}

function _closePreviewModal() {
  document.getElementById('modal-overlay').classList.remove('open', 'modal-overlay--wide');
  _pendingImport = null;
}

// ── Apply ─────────────────────────────────────────────────────

function _applyToState({ result, card }) {
  const data = getAppData();
  const idx  = (data.cards || []).findIndex(c => c.id === card.id);
  if (idx === -1) return;

  const target = data.cards[idx];

  const priorCharges  = target.charges || [];
  const priorManual   = priorCharges.filter(c => c.source === 'manual');
  const priorImported = priorCharges.filter(c => c.source !== 'manual');

  const deletedIds = new Set(data.deletedChargeIds || []);
  const { charges: importedCharges } = upsertImportedCharges(
    priorImported, result.charges, _chargeForStorage, deletedIds
  );

  target.charges        = [...priorManual, ...importedCharges];
  target.currentSpending = calcCardPendingCharges(target);
  target.updatedAt       = todayISO();

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  const newlyImportedIds = new Set(result.charges.map(c => c.id));
  setTimeout(() => _maybeOpenReconcile(card.id, newlyImportedIds), 50);
}

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

function _previewDiff(card, parsedCharges) {
  const priorImported = (card.charges || []).filter(c => c.source !== 'manual');
  const deletedIds = new Set(getAppData().deletedChargeIds || []);
  return upsertImportedCharges(priorImported, parsedCharges, p => p, deletedIds);
}

async function _maybeOpenReconcile(cardId, newlyImportedIds) {
  const { openReconcileForCard } = await import('./reconcile-flow.js');
  openReconcileForCard(cardId, newlyImportedIds);
}

// ── Preview rendering ─────────────────────────────────────────

function _renderPreview({ result, card, diff }) {
  const fileTotal = (result.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const warningsHtml = _renderWarnings(result.warnings);
  const diffHtml = renderImportDiff(diff, {
    inFile:      result.charges.length,
    inFileTotal: fileTotal,
  });

  const monthLabel = result.statementMonth
    ? _formatStatementMonth(result.statementMonth)
    : '';

  return `
    <div class="import-preview">
      <div class="import-section">
        <div class="import-section-title">${t('import.cal.cardMatched')}</div>
        <div class="import-isracard-card">
          <span class="import-isracard-card-name">${_esc(card.name)}</span>
          <span class="import-isracard-card-last4">•••• ${_esc(card.last4)}</span>
          ${monthLabel ? `<span class="import-isracard-card-month">${_esc(monthLabel)}</span>` : ''}
        </div>
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('import.cal.changes')}</div>
        ${diffHtml}
      </div>

      ${warningsHtml}
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

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.cal.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${_esc(message)}</p>
    <p class="modal-confirm-text import-error-hint">${t('import.cal.errorHint')}</p>
  `;
  overlay.classList.add('open');
}

// ── Helpers ───────────────────────────────────────────────────

const _HEBREW_MONTH_NAMES  = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const _ENGLISH_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _formatStatementMonth(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return yyyymm;
  const isHe = document.documentElement.lang === 'he';
  const names = isHe ? _HEBREW_MONTH_NAMES : _ENGLISH_MONTH_NAMES;
  return `${names[idx]} ${y}`;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
