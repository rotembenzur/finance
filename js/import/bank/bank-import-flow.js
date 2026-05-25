// ─────────────────────────────────────────────────────────────────
//  BANK STATEMENT IMPORT FLOW
//
//  User clicks "Import bank statement" → file picker opens (.pdf/.xlsx)
//  → parse via the matching Hapoalim parser → classify each row →
//  render a preview modal → on Apply, upsert into data.bankTransactions[]
//  keyed by stable fingerprint id (so re-importing the same statement is
//  idempotent and user-edits on existing rows survive) → then run the
//  bank reconcile flow (bank-reconcile-flow.js), which auto-merges
//  certain duplicates of the user's manual deposits and prompts only for
//  borderline ones.
//
//  Supports Bank Hapoalim PDF and Excel exports today. Additional banks
//  register their own parser in the registry below; bank-import-flow
//  stays the generic orchestrator.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../../state.js';
import { saveData, todayISO } from '../../store.js';
import { init } from '../../app.js';
import { t } from '../../i18n.js';
import { formatCurrency } from '../../utils.js';
import { formatChargeDate } from '../../dates.js';
import { parseHapoalimPdf } from './hapoalim-pdf-parser.js';
import { parseHapoalimXlsx } from './hapoalim-xlsx-parser.js';
import { classifyTransaction } from './classifier.js';
import { bankTxMatchKey, mergeBankTxEnrichment } from './bank-tx-identity.js';

// Format registry. Hapoalim ships its checking-account statement in two
// shapes: the printed PDF and the "export to Excel" .xlsx. Both land in
// the same unified bankTransactions[] structure. Adding a new bank or
// format means registering it here; bank-import-flow stays generic.
const PARSERS = [
  { match: f => /\.pdf$/i.test(f.name),   parse: parseHapoalimPdf,  format: 'hapoalim-pdf'  },
  { match: f => /\.xlsx$/i.test(f.name),  parse: parseHapoalimXlsx, format: 'hapoalim-xlsx' },
];

let _pendingImport = null;        // { result, classified[], existingCount }

// ── Public entry point ─────────────────────────────────────────

export function openBankImportFlow() {
  let input = document.getElementById('bank-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.xlsx';
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

    const data = getAppData();

    // Tag each transaction with classifier output. Preserved as part
    // of the parsed payload so the preview can group/count by type
    // without re-classifying on every render. Transactions the user
    // deleted are dropped here so they don't reappear on re-import
    // (the upsert below has no remove path of its own).
    // Drop rows the user deleted so they don't reappear. Checked by BOTH
    // the stored id and the canonical identity key, so a row deleted
    // after a PDF import stays gone when the same movement is re-imported
    // from Excel (and vice-versa).
    const deletedIds  = new Set(data.deletedBankTxIds  || []);
    const deletedKeys = new Set(data.deletedBankTxKeys || []);
    const classified = result.transactions
      .filter(tx => !deletedIds.has(tx.id) && !deletedKeys.has(bankTxMatchKey(tx)))
      .map(tx => ({
        ...tx,
        ...classifyTransaction(tx),
      }));

    // "New vs already-on-file" count, by canonical identity (not id), so
    // a movement already imported under another format counts as
    // "already on file" rather than as new. Drives the preview only.
    const existingKeys = new Set(
      (data.bankTransactions || [])
        .filter(t => t.source !== 'manual')
        .map(bankTxMatchKey)
    );
    const newCount     = classified.filter(t => !existingKeys.has(bankTxMatchKey(t))).length;
    const updatedCount = classified.length - newCount;

    // Duplicate detection against manual entries is no longer done here.
    // It runs AFTER apply, in bank-reconcile-flow.js, so it can auto-
    // merge certain duplicates and only prompt for borderline ones —
    // keeping this preview focused on "what's in the file".
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
  const { result } = _pendingImport;
  const touchedIds = _applyToState(_pendingImport);
  _closePreviewModal();

  // Reconcile-after-import: hand the STORED ids we just upserted (which
  // may be stable prior ids, not the incoming parser ids) to the bank
  // reconcile flow, which silently merges certain duplicates of your
  // manual deposits and only prompts for the borderline ones. Imported
  // dynamically to avoid a load-time cycle (it pulls in app.js), and
  // deferred 50ms so closing the preview doesn't race opening it.
  const account = result.account;
  setTimeout(async () => {
    const { openBankReconcile } = await import('./bank-reconcile-flow.js');
    openBankReconcile(account, touchedIds);
  }, 50);
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

  // Imported rows are de-duplicated by CANONICAL IDENTITY (date +
  // direction + amount + running balance), not by per-parser id — so a
  // movement already on file from another format, or from a prior
  // import, is updated in place instead of duplicated. Manual entries
  // are left for the reconcile flow that runs after this.
  const deleted = new Set(data.deletedBankTxIds || []);
  const existing = data.bankTransactions || [];
  const manual = existing.filter(tx => tx.source === 'manual');
  const priorImported = existing.filter(tx => tx.source !== 'manual' && !deleted.has(tx.id));

  // Index prior imported rows by identity, collapsing any pre-existing
  // duplicates (e.g. one row imported once from PDF and once from Excel)
  // into a single enriched row as we go.
  const byKey = new Map();
  for (const tx of priorImported) {
    const k = bankTxMatchKey(tx);
    byKey.set(k, byKey.has(k) ? mergeBankTxEnrichment(byKey.get(k), tx) : tx);
  }

  // Upsert each incoming row by the same identity.
  const touchedIds = new Set();
  for (const incoming of classified) {
    const k = bankTxMatchKey(incoming);
    const merged = _buildImported(incoming, byKey.get(k), result.account);
    byKey.set(k, merged);
    touchedIds.add(merged.id);
  }

  data.bankTransactions = [...manual, ...byKey.values()];
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  return touchedIds;
}

// Build the stored row for an incoming imported transaction. A matched
// prior row's stable id and user enrichment are carried forward, so a
// re-import (any format) never loses notes / category / rename and never
// changes the row's id out from under tombstones or reconcile links.
// Imported fields (description, amount, balance, …) refresh from the file.
function _buildImported(incoming, prior, account) {
  const merged = {
    ...incoming,
    id:        prior ? prior.id : incoming.id,
    accountId: account ? account.id : (prior ? prior.accountId ?? null : null),
    // User-owned enrichment (preserved across re-imports & formats)
    notes:             prior?.notes              ?? null,
    userLabel:         prior?.userLabel          ?? incoming.userLabel ?? null,
    reconciledStatus:  prior?.reconciledStatus   ?? null,
    reconciledWith:    prior?.reconciledWith     ?? [],
    incomeCategoryId:  prior?.incomeCategoryId   ?? null,
    importedAt:        incoming.importedAt,
  };
  if (prior?.mergedManualId) merged.mergedManualId = prior.mergedManualId;
  // Honor a manual category correction: keep the user's type, icon, and
  // grouping flags instead of the classifier's fresh guess.
  if (prior?.typeOverride) {
    merged.type              = prior.type;
    merged.icon              = prior.icon;
    merged.isInternal        = prior.isInternal;
    merged.isRecurring       = prior.isRecurring;
    merged.isReconcileTarget = prior.isReconcileTarget;
    merged.typeOverride      = true;
  }
  return merged;
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
