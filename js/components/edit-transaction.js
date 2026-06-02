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

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import {
  BANK_TX_TYPES, typeMeta, typeIcon, classifyTransaction,
} from '../import/bank/classifier.js';
import { bankTxKey } from '../import/bank/bank-tx-identity.js';
import { getExpenseCategoriesNested, getCategoryById, getIncomeCategoriesList } from '../config/registry.js';
import { resolveIncomeCategoryId } from '../data/income-categories.js';

// Transaction types where an expense category + a "monthly recurring"
// toggle make sense. Income / internal / system flows (salary, dividend,
// card_settlement, internal_savings, securities_*, etc.) don't get the
// category picker — they don't slot into food/transport/entertainment.
//
// The picker also requires direction === 'debit': a Bit/transfer row in
// the credit direction is money INCOMING (someone paid you), not an
// expense. The same `type` value can appear in either direction, so
// type alone isn't enough — see _canCategorize().
const CATEGORIZABLE_TYPES = new Set([
  'direct_debit_charge',
  'bit_transfer',
  'outgoing_transfer',
  'fee',
  'unclassified',
]);

function _canCategorize(type, direction) {
  return CATEGORIZABLE_TYPES.has(type) && direction === 'debit';
}

// Income categorization applies to every CREDIT (incoming) row — it's
// the user-facing classification of money in, parallel to the expense
// category on debit rows. Gated purely on direction, which never
// changes within the modal, so the technical `type` picker and this
// stay independent.
function _canIncomeCategorize(direction) {
  return direction === 'credit';
}

let _editing = null;     // { txId, direction }

// ── Public API ────────────────────────────────────────────────

export function openEditTransactionModal(txId) {
  const tx = _findTx(txId);
  if (!tx) return;

  // Stash the direction so the type-change handler and the save logic
  // can gate the expense-category UI on it without re-querying state.
  _editing = { txId, direction: tx.direction };

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

  // Show/hide the category + recurring fields based on the chosen type;
  // refresh subcategory options when the category changes.
  document.getElementById('f-tx-type')?.addEventListener('change', _onTypeChange);
  document.getElementById('f-tx-category')?.addEventListener('change', _onCategoryChange);

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

  // Expense category — only meaningful for categorizable debit rows.
  // Type changed away from one of those (or it's an income row)? clear
  // so a stray category from a previous edit can't quietly count toward
  // Spending.
  if (_canCategorize(tx.type, tx.direction)) {
    tx.categoryId    = form.categoryId    || null;
    tx.subcategoryId = form.subcategoryId || null;
  } else {
    tx.categoryId    = null;
    tx.subcategoryId = null;
  }

  // Income category — only for credit (incoming) rows. Stored in its own
  // field (never the technical `type`). Debit rows are left untouched.
  if (_canIncomeCategorize(tx.direction)) {
    tx.incomeCategoryId = form.incomeCategoryId || null;
  }

  // Recurring override is tri-state: checked → force-true; unchecked →
  // remove the override and fall back to the heuristic. We never persist
  // an explicit false from this form so saving an untouched row doesn't
  // silently override the heuristic for unrelated transactions.
  if (form.isRecurringMonthly) {
    tx.isRecurringMonthly = true;
  } else {
    delete tx.isRecurringMonthly;
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

  const showCategory  = _canCategorize(tx.type, tx.direction);
  const catBlockStyle = showCategory ? '' : 'display:none';

  // Reuse the credit-charge category select pattern exactly, so the UX
  // matches what the user already knows from editing card charges.
  const categoryOptions = `
    <option value="">${t('editCharge.noCategory')}</option>
    ${getExpenseCategoriesNested().map(cat => `
      <option value="${cat.id}" ${tx.categoryId === cat.id ? 'selected' : ''}>
        ${cat.emoji} ${_esc(cat.name[currentLang] || cat.name.en)}
      </option>
    `).join('')}
  `;
  const subcategoryOptions = _renderSubcategoryOptions(tx.categoryId, tx.subcategoryId);

  // Income-category block — shown for credit rows. Defaults to the
  // resolved category (explicit field, else derived from the type) so
  // imported and manual income land on the same value.
  const showIncomeCat   = _canIncomeCategorize(tx.direction);
  const incomeBlockStyle = showIncomeCat ? '' : 'display:none';
  const selectedIncome  = resolveIncomeCategoryId(tx);
  const incomeCategoryOptions = `
    <option value="">${t('editCharge.noCategory')}</option>
    ${getIncomeCategoriesList().map(cat => `
      <option value="${cat.id}" ${selectedIncome === cat.id ? 'selected' : ''}>
        ${cat.emoji} ${_esc(cat.name[currentLang] || cat.name.en)}
      </option>
    `).join('')}
  `;

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

      <div class="form-group" id="f-tx-expcat-group" style="${catBlockStyle}">
        <label class="form-label" for="f-tx-category">${t('editTransaction.expenseCategory')}</label>
        <select class="form-select" id="f-tx-category">
          ${categoryOptions}
        </select>
      </div>

      <div class="form-group" id="f-tx-subcat-group" style="${catBlockStyle}">
        <label class="form-label" for="f-tx-subcategory">${t('editTransaction.subcategory')}</label>
        <select class="form-select" id="f-tx-subcategory" ${!tx.categoryId ? 'disabled' : ''}>
          ${subcategoryOptions}
        </select>
      </div>

      <label class="edit-charge-recurring" id="f-tx-recurring-group" style="${catBlockStyle}">
        <input type="checkbox" id="f-tx-recurring" ${tx.isRecurringMonthly ? 'checked' : ''} />
        <span class="edit-charge-recurring-text">
          <span class="edit-charge-recurring-label">${t('editTransaction.recurring')}</span>
          <span class="edit-charge-recurring-hint">${t('editTransaction.recurringHint')}</span>
        </span>
      </label>

      <div class="form-group" id="f-tx-incomecat-group" style="${incomeBlockStyle}">
        <label class="form-label" for="f-tx-incomecat">${t('editTransaction.incomeCategory')}</label>
        <select class="form-select" id="f-tx-incomecat">
          ${incomeCategoryOptions}
        </select>
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

// Subcategory options for a given category. When category is null, the
// select is disabled but we still render a placeholder option so the
// markup stays consistent between states.
function _renderSubcategoryOptions(categoryId, selectedId) {
  const cat = getCategoryById(categoryId);
  if (!cat) return `<option value="">${t('editCharge.noSubcategory')}</option>`;
  const opts = [`<option value="">${t('editCharge.noSubcategory')}</option>`];
  for (const sub of cat.subcategories || []) {
    opts.push(`<option value="${sub.id}" ${selectedId === sub.id ? 'selected' : ''}>
      ${_esc(sub.name[currentLang] || sub.name.en)}
    </option>`);
  }
  return opts.join('');
}

// Show or hide the expense-category block when the user changes the
// transaction type. Doesn't clear the stored fields — the user can
// flip back without losing them. The save handler decides whether to
// persist them based on the FINAL type + direction.
function _onTypeChange(e) {
  const type      = e.target.value;
  const direction = _editing && _editing.direction;
  const show      = _canCategorize(type, direction);
  for (const id of ['f-tx-expcat-group', 'f-tx-subcat-group', 'f-tx-recurring-group']) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }
}

// Refresh the subcategory options when the category changes — same
// cascading pattern the card-charge edit modal uses.
function _onCategoryChange(e) {
  const catId  = e.target.value || null;
  const subEl  = document.getElementById('f-tx-subcategory');
  if (!subEl) return;
  subEl.innerHTML = _renderSubcategoryOptions(catId, null);
  subEl.disabled  = !catId;
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
  // Also tombstone by canonical identity so re-importing the same
  // movement from another file format (different id) doesn't bring it
  // back. Only imported rows have a running balance → a key here.
  const key = bankTxKey(tx);
  if (key) {
    const tombKeys = data.deletedBankTxKeys = data.deletedBankTxKeys || [];
    if (!tombKeys.includes(key)) tombKeys.push(key);
  }

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
  const userLabel          = (document.getElementById('f-tx-name')?.value || '').trim();
  const type               = document.getElementById('f-tx-type')?.value || null;
  const notes              = (document.getElementById('f-tx-notes')?.value || '').trim();
  const categoryId         = document.getElementById('f-tx-category')?.value    || null;
  const subcategoryId      = document.getElementById('f-tx-subcategory')?.value || null;
  const incomeCategoryId   = document.getElementById('f-tx-incomecat')?.value   || null;
  const isRecurringMonthly = !!document.getElementById('f-tx-recurring')?.checked;

  // Subcategory without a category is invalid; the disabled state on
  // the select normally prevents it, but defend anyway and surface inline.
  if (subcategoryId && !categoryId) {
    const errorEl = document.getElementById('f-tx-error');
    if (errorEl) {
      errorEl.textContent   = t('editCharge.invalidSubcategory');
      errorEl.style.display = 'block';
    }
    return null;
  }

  return { userLabel, type, notes, categoryId, subcategoryId, incomeCategoryId, isRecurringMonthly };
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
