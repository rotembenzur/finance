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
import { bankTxKey, bankTxMatchKey, mergeBankTxEnrichment } from './bank-tx-identity.js';
import { renderImportDiff } from '../diff-preview.js';

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

    // Build the rich diff payload for the preview: per-row added /
    // updated (with prior + matched-by reason + per-field changes) /
    // kept lists. Matching is by canonical identity (date + direction
    // + amount + running balance) so a movement already on file from
    // another format counts as "already on file" rather than as new.
    //
    // Duplicate detection against manual entries is NOT done here —
    // it runs after apply, in bank-reconcile-flow.js, which can
    // auto-merge certain duplicates and only prompt for borderline
    // ones. Keeping this preview focused on "what's in the file."
    const priorImported = (data.bankTransactions || [])
      .filter(tx => tx.source !== 'manual');
    const diff = _buildBankDiff(classified, priorImported);

    _pendingImport = { result, classified, diff };
    _openPreviewModal();
  } catch (err) {
    console.error('Bank import failed:', err);
    _showImportError(err.message || t('bankImport.errorGeneric'));
  }
}

// ── Diff payload ───────────────────────────────────────────────
//
// Build the rich diff payload the preview consumes. Same shape as
// charge-merge.js's upsert result (added[]/updated[]/kept[]) so the
// shared diff-preview renderer can be reused without flow-specific
// branching at the render layer.
//
//   matchedBy:
//     · 'balance'     → matched by canonical key
//                       (date + direction + amount + running balance)
//     · 'idFallback'  → matched by per-parser id, because the row
//                       has no running balance to anchor identity
//
//   changes: per-field "from → to" entries computed against
//   BANK_DIFF_FIELDS (the user-visible bank columns). Numeric
//   fields are cents-rounded; null/empty equivalence is normalized.

const BANK_DIFF_FIELDS = [
  'description',
  'amount',
  'direction',
  'balance',
  'type',
  'valueDate',
  'processedDate',
  'reference',
  'details',
];

const BANK_AMOUNT_FIELDS = new Set(['amount', 'balance']);

function _buildBankDiff(classified, priorImported) {
  // Index prior rows by their canonical identity. Same logic the
  // apply step uses to upsert, so the preview reflects exactly what
  // pressing Apply will do.
  const byKey = new Map();
  for (const tx of priorImported) {
    const k = bankTxMatchKey(tx);
    byKey.set(k, byKey.has(k) ? mergeBankTxEnrichment(byKey.get(k), tx) : tx);
  }

  const consumed = new Set();
  const added = [];
  const updated = [];

  for (const incoming of classified) {
    const key   = bankTxMatchKey(incoming);
    const prior = byKey.get(key);
    if (prior) {
      consumed.add(key);
      // 'balance' when canonical key (date|dir|amount|balance) hit;
      // 'idFallback' when we fell back to the parser id because the
      // row had no running balance.
      const matchedBy = bankTxKey(incoming) ? 'balance' : 'idFallback';
      const changes = _diffBankTx(prior, incoming);
      updated.push({
        parsed:    incoming,
        prior,
        built:     incoming,
        matchedBy,
        changes,
        identical: changes.length === 0,
      });
    } else {
      added.push({ parsed: incoming, built: incoming });
    }
  }

  // Kept: prior rows the file doesn't mention. Surfaced as a footer
  // line by the renderer so the user knows their history is preserved.
  const kept = [];
  for (const [key, tx] of byKey) {
    if (!consumed.has(key)) kept.push({ prior: tx });
  }

  return {
    added,
    updated,
    kept,
    addedCount:   added.length,
    updatedCount: updated.length,
    keptCount:    kept.length,
  };
}

function _diffBankTx(prior, next) {
  const changes = [];
  for (const field of BANK_DIFF_FIELDS) {
    const a = prior ? prior[field] : null;
    const b = next  ? next[field]  : null;
    if (BANK_AMOUNT_FIELDS.has(field)) {
      const ca = a == null ? null : Math.round(Number(a) * 100);
      const cb = b == null ? null : Math.round(Number(b) * 100);
      if (ca !== cb) changes.push({ field, from: a, to: b });
    } else {
      if (!_eqLoose(a, b)) changes.push({ field, from: a, to: b });
    }
  }
  return changes;
}

function _eqLoose(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a === '' && b == null) return true;
  if (b === '' && a == null) return true;
  return a === b;
}

// Translate a classifier `type` (e.g., "bit_transfer") to its
// localized label. Used by the diff renderer's formatFieldValue hook
// so a Type change reads as "Bit transfer → Direct debit" instead of
// "bit_transfer → direct_debit_charge".
function _bankTypeLabel(type) {
  if (!type) return null;
  const key = 'bankTx.types.' + type;
  const value = t(key);
  return value === key ? String(type) : value;
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
    // Expense category + recurring override survive every re-import.
    categoryId:        prior?.categoryId         ?? null,
    subcategoryId:     prior?.subcategoryId      ?? null,
    isRecurringMonthly: prior?.isRecurringMonthly,
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

function _renderPreview({ result, classified, diff }) {
  // Totals stay as a small sanity-check strip at the top — the user
  // wants to confirm the file's inflow / outflow / net matches what
  // they expect. Demoted visually so the diff sections below carry
  // the focus.
  const inflow  = classified.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
  const outflow = classified.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0);

  const accountLine = result.account
    ? `<div class="bank-import-account">${_esc(result.account.ownerName || '')} · ${_esc(result.account.bankId)} · ${_esc(result.account.branch)} / ${_esc(result.account.accountNumber)}</div>`
    : '';

  const periodLine = result.period
    ? `<div class="bank-import-period">${formatChargeDate(result.period.from)} – ${formatChargeDate(result.period.to)}</div>`
    : '';

  // The diff renderer carries the heavy lifting: explicit New /
  // Updated / Kept sections with per-field "from → to" lines and a
  // matching-logic note. Bank-flow passes `signed: true` so amounts
  // in the identity column show +/− by direction, supplies bank-
  // specific matched-by labels, and a per-field formatter that
  // localizes the classifier 'type' and the 'direction' enum.
  const diffHtml = renderImportDiff(diff, {
    inFile: classified.length,
    signed: true,
    matchedByLabels: {
      balance:    t('import.diff.matchedBy.balance'),
      idFallback: t('import.diff.matchedBy.idFallback'),
    },
    formatFieldValue: (field, value) => {
      if (field === 'type')      return _esc(_bankTypeLabel(value) || '');
      if (field === 'direction') {
        const k = 'bankTx.direction.' + value;
        const v = t(k);
        return _esc(v === k ? String(value) : v);
      }
      return null;
    },
  });

  return `
    <div class="import-preview">

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.detected')}</div>
        ${accountLine}
        ${periodLine}
      </div>

      <div class="import-section bank-import-totals-section">
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
        ${diffHtml}
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
