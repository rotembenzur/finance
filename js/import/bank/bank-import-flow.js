// ─────────────────────────────────────────────────────────────────
//  BANK STATEMENT IMPORT FLOW
//
//  User clicks "Import bank statement" → hidden .pdf picker opens →
//  parse via Hapoalim parser → classify each row → render a preview
//  modal → on Apply, merge into data.bankTransactions[] keyed by
//  stable fingerprint id (so re-importing the same statement is
//  idempotent and user-edits on existing rows survive).
//
//  Today this only supports Bank Hapoalim PDFs. The flow is set up
//  so additional banks can register their own parsers in the future
//  (CSV/XLSX/OCR/sync APIs) — bank-import-flow stays the orchestrator,
//  each format adds itself to the parser registry below.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../../state.js';
import { saveData, todayISO } from '../../store.js';
import { init } from '../../app.js';
import { t } from '../../i18n.js';
import { formatCurrency } from '../../utils.js';
import { formatChargeDate } from '../../dates.js';
import { parseHapoalimPdf } from './hapoalim-pdf-parser.js';
import { classifyTransaction, BANK_TX_TYPES } from './classifier.js';

// Format registry. Today: PDF → Hapoalim. Adding a new bank or
// format means registering it here; bank-import-flow stays generic.
const PARSERS = [
  { match: f => /\.pdf$/i.test(f.name),  parse: parseHapoalimPdf, format: 'hapoalim-pdf' },
];

let _pendingImport = null;        // { result, classified[], existingCount }

// ── Public entry point ─────────────────────────────────────────

export function openBankImportFlow() {
  let input = document.getElementById('bank-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.id = 'bank-file-input';
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

  const parser = PARSERS.find(p => p.match(file));
  if (!parser) {
    _showImportError(t('bankImport.errorUnsupported'));
    return;
  }

  // Open a busy state — PDF loading + pdf.js boot can take a second,
  // so the user sees something happening immediately.
  _showBusy();

  try {
    const buffer = await file.arrayBuffer();
    const result = await parser.parse(buffer);
    if (!result.ok) {
      _showImportError(result.errors[0]?.message || t('bankImport.errorGeneric'));
      return;
    }

    // Tag each transaction with classifier output. Preserved as part
    // of the parsed payload so the preview can group/count by type
    // without re-classifying on every render.
    const classified = result.transactions.map(tx => ({
      ...tx,
      ...classifyTransaction(tx),
    }));

    // How many of these IDs already exist in state? Drives the
    // preview's "new vs updated" count without committing anything.
    const data = getAppData();
    const existingIds = new Set((data.bankTransactions || []).map(t => t.id));
    const newCount     = classified.filter(t => !existingIds.has(t.id)).length;
    const updatedCount = classified.length - newCount;

    _pendingImport = { result, classified, newCount, updatedCount };
    _openPreviewModal();
  } catch (err) {
    console.error('Bank import failed:', err);
    _showImportError(err.message || t('bankImport.errorGeneric'));
  }
}

// ── Modal lifecycle ───────────────────────────────────────────

function _openPreviewModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.previewTitle');
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

export function hasPendingBankImport()   { return _pendingImport !== null; }
export function clearPendingBankImport() {
  _pendingImport = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}
export function applyPendingBankImport() {
  if (!_pendingImport) return false;
  _applyToState(_pendingImport);
  _closePreviewModal();
  return true;
}

// ── Apply: upsert into data.bankTransactions ───────────────────

function _applyToState({ result, classified }) {
  const data = getAppData();

  // Ensure the account record exists. Updating overwrites the lazy
  // metadata (ownerName, lastImportedAt) without touching anything
  // else attached to the same id.
  if (result.account) {
    const accounts = (data.bankAccounts = data.bankAccounts || []);
    const idx = accounts.findIndex(a => a.id === result.account.id);
    const next = {
      ...(idx >= 0 ? accounts[idx] : {}),
      ...result.account,
      lastImportedAt: todayISO(),
    };
    if (idx >= 0) accounts[idx] = next; else accounts.push(next);
  }

  // Upsert transactions by stable id. Imported metadata always
  // refreshes from the file; user-owned fields (notes,
  // reconciledStatus, reconciledWith) carry over from the prior
  // record so a re-import doesn't blow away manual reconciliation.
  const existing = data.bankTransactions = data.bankTransactions || [];
  const byId = new Map(existing.map(t => [t.id, t]));

  for (const incoming of classified) {
    const prior = byId.get(incoming.id);
    const merged = {
      ...incoming,
      accountId: result.account ? result.account.id : null,
      // User-owned enrichment (preserved across re-imports)
      notes:             prior?.notes              ?? null,
      reconciledStatus:  prior?.reconciledStatus   ?? null,
      reconciledWith:    prior?.reconciledWith     ?? [],
      // Refresh imported metadata
      importedAt:        incoming.importedAt,
    };
    byId.set(incoming.id, merged);
  }
  data.bankTransactions = [...byId.values()];

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
}

// ── Preview rendering ─────────────────────────────────────────

function _renderPreview({ result, classified, newCount, updatedCount }) {
  const inflow  = classified.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
  const outflow = classified.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0);

  // Count by type for the breakdown pill row.
  const byType = new Map();
  for (const t of classified) byType.set(t.type, (byType.get(t.type) || 0) + 1);

  const accountLine = result.account
    ? `<div class="bank-import-account">${_esc(result.account.ownerName || '')} · ${_esc(result.account.bankId)} · ${_esc(result.account.branch)} / ${_esc(result.account.accountNumber)}</div>`
    : '';

  const periodLine = result.period
    ? `<div class="bank-import-period">${formatChargeDate(result.period.from)} – ${formatChargeDate(result.period.to)}</div>`
    : '';

  // Sample rows — first 10 (newest dates first) for a quick eyeball.
  const sample = [...classified]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10);

  return `
    <div class="import-preview">

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.detected')}</div>
        ${accountLine}
        ${periodLine}
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.totals')}</div>
        <div class="bank-import-totals">
          <div class="bank-import-total bank-import-total--in">
            <span class="bank-import-total-label">${t('bankImport.inflow')}</span>
            <span class="bank-import-total-value">${formatCurrency(inflow)}</span>
          </div>
          <div class="bank-import-total bank-import-total--out">
            <span class="bank-import-total-label">${t('bankImport.outflow')}</span>
            <span class="bank-import-total-value">${formatCurrency(outflow)}</span>
          </div>
          <div class="bank-import-total bank-import-total--net">
            <span class="bank-import-total-label">${t('bankImport.net')}</span>
            <span class="bank-import-total-value">${formatCurrency(inflow - outflow)}</span>
          </div>
        </div>
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.transactions')}</div>
        <div class="import-summary-pills">
          <span class="import-pill import-pill--added">+${newCount} ${t('bankImport.new')}</span>
          ${updatedCount > 0
            ? `<span class="import-pill import-pill--unchanged">${updatedCount} ${t('bankImport.alreadySeen')}</span>`
            : ''}
        </div>
        <div class="bank-import-typebreak">
          ${[...byType.entries()].map(([type, count]) => `
            <span class="bank-import-type-chip">
              <span class="bank-import-type-icon" aria-hidden="true">${_typeIcon(type)}</span>
              ${t('bankTx.types.' + type)} · ${count}
            </span>
          `).join('')}
        </div>
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.preview')}</div>
        <div class="import-changes-list">
          ${sample.map(_renderPreviewRow).join('')}
        </div>
      </div>

      ${(result.warnings && result.warnings.length > 0) ? `
        <div class="import-section">
          <div class="import-section-title import-section-title--warning">${t('import.warnings')}</div>
          <ul class="import-warnings">
            ${result.warnings.map(w => `<li>${_esc(w.message)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function _renderPreviewRow(tx) {
  const sign     = tx.direction === 'credit' ? '+' : '−';
  const toneCls  = tx.direction === 'credit' ? 'is-credit' : 'is-debit';
  const dateText = tx.date ? formatChargeDate(tx.date) : (tx.rawDate || '');
  return `
    <div class="import-change-row bank-import-row ${toneCls}">
      <span class="bank-import-row-icon" aria-hidden="true">${tx.icon || '·'}</span>
      <span class="bank-import-row-desc">${_esc(tx.description)}</span>
      <span class="bank-import-row-amount">${sign}${formatCurrency(tx.amount, { cents: true })}</span>
      <span class="bank-import-row-date">${_esc(dateText)}</span>
    </div>
  `;
}

function _typeIcon(type) {
  // Cheap lookup against the classifier's canonical icons by
  // running an empty description through the rules — keeps icon
  // ↔ type pairings in one place (the classifier).
  const order = [
    ['salary',                 '💼'],
    ['bit_transfer',           '⚡'],
    ['incoming_transfer',      '➕'],
    ['outgoing_transfer',      '➖'],
    ['card_settlement',        '💳'],
    ['investment_contribution','📈'],
    ['securities_buy',         '🛒'],
    ['securities_sell',        '💱'],
    ['dividend',               '🎁'],
    ['interest',               '💹'],
    ['refund',                 '🎉'],
    ['social_security',        '🏛'],
    ['insurance',              '🛡'],
    ['internal_savings',       '🔄'],
    ['fee',                    '🧾'],
    ['unclassified',           '·'],
  ];
  return (order.find(([t]) => t === type) || [, '·'])[1];
}

// ── Busy + error display ──────────────────────────────────────

function _showBusy() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.busyTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${t('bankImport.busyText')}</p>
  `;
  overlay.classList.add('open');
}

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${_esc(message)}</p>
    <p class="modal-confirm-text import-error-hint">${t('bankImport.errorHint')}</p>
  `;
  overlay.classList.add('open');
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
