// ─────────────────────────────────────────────────────────────────
//  EDIT TRANSACTION — modal for enriching a bank-account transaction
//
//  The classifier tags every imported row with a best-guess category
//  (salary, card settlement, fee, transfer, …). This modal lets the
//  user correct that guess and add their own context. Fields:
//
//    · userLabel  — overrides the bank's raw description on the row
//    · type       — the category; changing it re-groups the row and
//                   stamps the type's canonical icon + flags. When the
//                   chosen type differs from what the classifier would
//                   pick, `typeOverride` is set so re-imports keep the
//                   user's choice instead of re-guessing.
//    · notes      — free text: "what is it"
//
//  Bank-owned fields (description, amount, date, direction) are left
//  untouched — they stay the audit trail back to the statement.
//
//  Rides the shared modal-overlay shell. handleModalSave in modal.js
//  routes via hasPendingTransactionEdit / applyPendingTransactionEdit.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import {
  BANK_TX_TYPES, typeMeta, typeIcon, classifyTransaction,
} from '../import/bank/classifier.js';

let _editing = null;     // { txId }

// ── Public API ────────────────────────────────────────────────

export function openEditTransactionModal(txId) {
  const tx = _findTx(txId);
  if (!tx) return;

  _editing = { txId };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editTransaction.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(tx);
  document.getElementById('f-tx-delete')?.addEventListener('click', _deleteTransaction);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-tx-name')?.focus(), 50);
}

export function hasPendingTransactionEdit()   { return _editing !== null; }
export function clearPendingTransactionEdit() { _editing = null; }

export function applyPendingTransactionEdit() {
  if (!_editing) return false;

  const tx = _findTx(_editing.txId);
  if (!tx) { _editing = null; return false; }

  const form = _readForm();
  if (!form) return false;   // validation surfaced inline

  // Name + note: empty collapses to null so the row falls back to the
  // bank's original text.
  tx.userLabel = form.userLabel || null;
  tx.notes     = form.notes     || null;

  // Category: stamp the chosen type's canonical icon + flags. Mark it
  // as a user override only when it diverges from the classifier's
  // own verdict — that way rows the user merely re-confirmed still
  // benefit from future classifier improvements, while genuine
  // corrections survive every re-import.
  if (form.type) {
    const natural = classifyTransaction(tx).type;
    const meta    = typeMeta(form.type);
    tx.type              = form.type;
    tx.icon              = meta.icon;
    tx.isInternal        = meta.isInternal;
    tx.isRecurring       = meta.isRecurring;
    tx.isReconcileTarget = meta.isReconcileTarget;
    tx.typeOverride      = form.type !== natural;
  }

  tx.updatedAt = todayISO();
  const data = getAppData();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form rendering ───────────────────────────────────────────

function _renderForm(tx) {
  const typeOptions = BANK_TX_TYPES.map(id => `
    <option value="${id}" ${tx.type === id ? 'selected' : ''}>
      ${typeIcon(id)} ${t('bankTx.types.' + id)}
    </option>
  `).join('');

  return `
    <form class="edit-charge-form" id="f-tx-form" onsubmit="event.preventDefault()">

      <div class="edit-charge-original">
        <span class="edit-charge-original-label">${t('editTransaction.original')}</span>
        <span class="edit-charge-original-value">${_esc(tx.description || '')}</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-tx-name">${t('editTransaction.displayName')}</label>
        <input class="form-input" id="f-tx-name" type="text"
               value="${_esc(tx.userLabel || '')}"
               placeholder="${_esc(tx.description || '')}" />
        <small class="form-hint">${t('editTransaction.displayNameHint')}</small>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-tx-type">${t('editTransaction.category')}</label>
        <select class="form-select" id="f-tx-type">
          ${typeOptions}
        </select>
        <small class="form-hint">${t('editTransaction.categoryHint')}</small>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-tx-notes">${t('editTransaction.notes')}</label>
        <textarea class="form-input edit-charge-notes" id="f-tx-notes" rows="3"
                  placeholder="${t('editTransaction.notesPlaceholder')}">${_esc(tx.notes || '')}</textarea>
      </div>

      <p id="f-tx-error" class="form-error" style="display:none"></p>

      <button type="button" class="edit-modal-delete" id="f-tx-delete">${t('modal.delete')}</button>
    </form>
  `;
}

// ── Delete ───────────────────────────────────────────────────

// Remove a bank transaction. For manual entries that adjusted an
// account balance on creation (quick-income to a bank account), reverse
// that adjustment. Imported transactions never touched a balance, so
// they just get removed + tombstoned so a re-import won't bring them
// back (the import upsert has no remove path of its own).
function _deleteTransaction() {
  if (!_editing) return;
  if (!window.confirm(t('modal.confirmDelete'))) return;

  const data = getAppData();
  const txs  = data.bankTransactions || [];
  const idx  = txs.findIndex(t => t.id === _editing.txId);
  if (idx === -1) { _close(); return; }
  const tx = txs[idx];

  if (tx.source === 'manual' && tx.accountId) {
    const entry = (data.entries || []).find(e => e.id === tx.accountId);
    if (entry) {
      const amt = Number(tx.amount) || 0;
      entry.balance = (entry.balance || 0) + (tx.direction === 'credit' ? -amt : amt);
      entry.updatedAt = todayISO();
    }
  }

  txs.splice(idx, 1);
  const tomb = data.deletedBankTxIds = data.deletedBankTxIds || [];
  if (!tomb.includes(tx.id)) tomb.push(tx.id);

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  _close();
}

function _close() {
  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form reading ─────────────────────────────────────────────

function _readForm() {
  const userLabel = (document.getElementById('f-tx-name')?.value || '').trim();
  const type      = document.getElementById('f-tx-type')?.value || null;
  const notes     = (document.getElementById('f-tx-notes')?.value || '').trim();
  return { userLabel, type, notes };
}

// ── Helpers ──────────────────────────────────────────────────

function _findTx(txId) {
  return (getAppData().bankTransactions || []).find(t => t.id === txId) || null;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
