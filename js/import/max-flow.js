// ─────────────────────────────────────────────────────────────────
//  MAX IMPORT FLOW
//
//  MAX exports may interleave rows from multiple cards in one file.
//  Each row carries its own last-4 (column D), so the importer:
//
//    1. parses the file
//    2. groups parsed rows by cardLast4
//    3. matches each group to a card in state (by last4)
//    4. shows a per-card preview (one block per matched card)
//    5. on Apply, replaces each matched card's charges[] with its
//       group; cards not represented in the file stay untouched
//
//  Unmatched last-4s appear as warnings — those rows aren't dropped
//  silently. The user can fix the card list and re-import.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { t } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { readXLSX } from './xlsx-reader.js';
import { parseMaxStatement } from './max-parser.js';

let _pendingImport = null;       // { result, groups[], unmatched[] }

// ── Public entry point ─────────────────────────────────────────

export function openMaxImportFlow() {
  let input = document.getElementById('max-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.id = 'max-file-input';
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
    const result = parseMaxStatement(rows, file.name);

    if (!result.ok) {
      _showImportError(result.errors[0]?.message || t('import.max.errorGeneric'));
      return;
    }

    const data = getAppData();
    const { groups, unmatched } = _resolveGroups(data, result);

    if (groups.length === 0) {
      const list = unmatched.map(u => `•••• ${u.last4} (${u.count})`).join(', ');
      _showImportError(t('import.max.noMatches').replace('{list}', list || '—'));
      return;
    }

    _pendingImport = { result, groups, unmatched };
    _openPreviewModal();
  } catch (err) {
    console.error('MAX import failed:', err);
    _showImportError(err.message || t('import.max.errorGeneric'));
  }
}

// Build the per-card application plan + the list of last-4s that
// appeared in the file but have no card in state.
function _resolveGroups(data, result) {
  const cards = (data.cards || []).filter(c => c.isActive);
  const byLast4 = new Map();
  for (const c of cards) byLast4.set(c.last4, c);

  const groups = [];
  const unmatched = [];

  for (const [last4, charges] of Object.entries(result.chargesByCard)) {
    const card = byLast4.get(last4);
    if (!card) {
      unmatched.push({ last4, count: charges.length, total: charges.reduce((s, c) => s + (c.amount || 0), 0) });
      continue;
    }
    groups.push({
      card,
      charges,
      replacing: (card.charges || []).length,
      beforeSpending: Number(card.currentSpending) || 0,
      afterSpending:  charges.reduce((s, c) => s + (c.amount || 0), 0),
    });
  }

  // Stable display order: largest card group first.
  groups.sort((a, b) => b.charges.length - a.charges.length);
  return { groups, unmatched };
}

// ── Modal lifecycle ────────────────────────────────────────────

function _openPreviewModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.max.previewTitle');
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

export function hasPendingMaxImport()    { return _pendingImport !== null; }
export function applyPendingMaxImport()  {
  if (!_pendingImport) return false;
  _applyToState(_pendingImport);
  _closePreviewModal();
  return true;
}
export function clearPendingMaxImport()  {
  _pendingImport = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}

// ── Apply: per-card replacement ────────────────────────────────

function _applyToState({ groups }) {
  const data = getAppData();
  const today = todayISO();
  const reconcileTargets = [];     // [{ cardId, newlyImportedIds }]

  for (const group of groups) {
    const idx = (data.cards || []).findIndex(c => c.id === group.card.id);
    if (idx === -1) continue;
    const target = data.cards[idx];

    // Split by source so manual quick-entries survive a re-import.
    const priorCharges    = target.charges || [];
    const priorManual     = priorCharges.filter(c => c.source === 'manual');
    const priorImportedBy = new Map(
      priorCharges.filter(c => c.source !== 'manual').map(c => [c.id, c])
    );

    const importedCharges = group.charges.map(parsed =>
      _chargeForStorage(parsed, priorImportedBy.get(parsed.id))
    );
    target.charges = [...priorManual, ...importedCharges];
    target.currentSpending = target.charges.reduce((s, c) => s + (c.amount || 0), 0);
    target.updatedAt = today;

    reconcileTargets.push({
      cardId: target.id,
      newlyImportedIds: new Set(importedCharges.map(c => c.id)),
    });
  }

  data.meta.lastUpdated = today;
  saveData(data);
  init();

  // Reconcile-after-import: queue each card. The reconcile flow opens
  // sequentially; if a card has no manual matches it skips silently.
  setTimeout(() => _maybeOpenReconcile(reconcileTargets), 50);
}

async function _maybeOpenReconcile(targets) {
  const { openReconcileQueue } = await import('./reconcile-flow.js');
  openReconcileQueue(targets);
}

function _chargeForStorage(parsed, prior) {
  return {
    // Imported metadata — refreshed from the file every time.
    id:               parsed.id,
    date:             parsed.date,
    merchant:         parsed.merchant,
    amount:           parsed.amount,
    currency:         parsed.currency,
    originalAmount:   parsed.originalAmount,
    originalCurrency: parsed.originalCurrency,
    billingDate:      parsed.billingDate,
    note:             parsed.note,         // MAX-side note (col K)
    maxCategory:      parsed.maxCategory,
    maxType:          parsed.maxType,
    channel:          parsed.channel,
    fxRate:           parsed.fxRate,
    status:           parsed.status,
    importedFrom:     parsed.importedFrom,
    importedAt:       parsed.importedAt,
    source:           'imported',
    // User-owned enrichment — preserved across re-imports.
    displayName:        prior?.displayName        ?? null,
    categoryId:         prior?.categoryId         ?? null,
    subcategoryId:      prior?.subcategoryId      ?? null,
    notes:              prior?.notes              ?? null,
    isRecurringMonthly: prior?.isRecurringMonthly ?? false,
  };
}

// ── Preview rendering ──────────────────────────────────────────

function _renderPreview({ result, groups, unmatched }) {
  const monthHtml = result.statementMonth
    ? `<div class="import-section">
         <div class="import-section-title">${t('import.max.statementMonth')}</div>
         <div class="import-max-month">${_esc(_formatStatementMonth(result.statementMonth))}</div>
       </div>`
    : '';

  const groupsHtml = groups.map(_renderGroupBlock).join('');

  const unmatchedHtml = unmatched.length > 0
    ? `<div class="import-section">
         <div class="import-section-title import-section-title--warning">${t('import.max.unmatched')}</div>
         <ul class="import-warnings">
           ${unmatched.map(u =>
             `<li>${t('import.max.unmatchedRow')
                .replace('{last4}', _esc(u.last4))
                .replace('{count}', u.count)
                .replace('{total}', formatCurrency(u.total))}</li>`
           ).join('')}
         </ul>
       </div>`
    : '';

  const warningsHtml = (result.warnings && result.warnings.length > 0)
    ? `<div class="import-section">
         <div class="import-section-title import-section-title--warning">${t('import.warnings')}</div>
         <ul class="import-warnings">
           ${result.warnings.map(w => `<li>${_esc(w.message)}</li>`).join('')}
         </ul>
       </div>`
    : '';

  return `
    <div class="import-preview">
      ${monthHtml}
      ${groupsHtml}
      ${unmatchedHtml}
      ${warningsHtml}
    </div>
  `;
}

function _renderGroupBlock(group) {
  const { card, charges, replacing, beforeSpending, afterSpending } = group;

  const totalsHtml = `
    <div class="import-totals">
      <div class="import-totals-row ${beforeSpending !== afterSpending ? 'is-changed' : ''}">
        <span class="import-totals-label">${t('import.isracard.committedTotal')}</span>
        <span class="import-totals-before">${formatCurrency(beforeSpending)}</span>
        <span class="import-totals-arrow">→</span>
        <span class="import-totals-after">${formatCurrency(afterSpending)}</span>
      </div>
      <div class="import-totals-row ${replacing !== charges.length ? 'is-changed' : ''}">
        <span class="import-totals-label">${t('import.isracard.chargesCount')}</span>
        <span class="import-totals-before">${replacing}</span>
        <span class="import-totals-arrow">→</span>
        <span class="import-totals-after">${charges.length}</span>
      </div>
    </div>
  `;

  // Top 5 by amount per card — keep the modal scannable across cards.
  const top = [...charges]
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 5);
  const topHtml = top.length > 0
    ? `<div class="import-changes-list">
         ${top.map(_renderChargeRow).join('')}
       </div>`
    : '';

  return `
    <div class="import-section">
      <div class="import-section-title">
        ${_esc(card.name)} <span class="import-max-card-last4">•••• ${_esc(card.last4)}</span>
      </div>
      ${totalsHtml}
      ${topHtml}
    </div>
  `;
}

function _renderChargeRow(charge) {
  const dateText = charge.date ? formatChargeDate(charge.date) : (charge.rawDate || '');
  const fxText   = charge.originalCurrency && charge.originalCurrency !== charge.currency
    ? ` · ${charge.originalAmount} ${charge.originalCurrency}`
    : '';
  return `
    <div class="import-change-row import-change-row--added">
      <span class="import-change-marker">+</span>
      <span class="import-change-name">${_esc(charge.merchant)}</span>
      <span class="import-change-value">${formatCurrency(charge.amount || 0, { cents: true })}</span>
      <span class="import-change-detail">${_esc(dateText)}${fxText}</span>
    </div>
  `;
}

// ── Error display ──────────────────────────────────────────────

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('import.max.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${_esc(message)}</p>
    <p class="modal-confirm-text import-error-hint">${t('import.max.errorHint')}</p>
  `;
  overlay.classList.add('open');
}

// ── Helpers ────────────────────────────────────────────────────

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
