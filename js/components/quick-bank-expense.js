// ─────────────────────────────────────────────────────────────────
//  QUICK BANK EXPENSE — manual OUTGOING bank transaction
//
//  The expense-side mirror of quick-income.js, scoped to bank
//  accounts. Captures money leaving a real bank account that isn't a
//  credit-card charge or a recurring debit: a transfer to a person, a
//  transfer to savings/investment, a supplier payment, a one-time fee,
//  a cash withdrawal. (Card / cash / wallet expenses are already
//  covered by quick-expense.js.)
//
//  Form order (optimized for thumb-typing):
//    1. amount        — large numeric input, focused on open
//    2. name          — single text line (who/what)
//    3. kind          — chip grid (payment, transfer, to savings, …)
//    4. expense cat   — chip grid, ONLY for `spendable` kinds; what
//                       makes the row count toward Spending
//    5. subcategory   — chip grid, only after a category is picked
//    6. account       — chip grid of bank accounts
//    7. date          — defaults to today; tap to change
//    8. notes         — optional, collapsed behind a single-tap reveal
//
//  Persistence: push a bankTransactions[] record with source='manual'
//  and direction='debit' — the exact mirror of quick-income's bank
//  branch — and bump the chosen account's balance DOWN. The schema
//  matches an imported debit row, so the timeline, Spending engine,
//  and the edit-transaction modal all consume it with no forks.
//
//  The kind carries the TECHNICAL `type` (a real BANK_TX_TYPE) plus
//  `isInternal` / `spendable` flags (see data/outgoing-categories.js);
//  the user-facing expense category lives in categoryId, parallel to
//  how income uses incomeCategoryId.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getBankAccountEntries, getBankDisplayName, getBank } from '../utils.js';
import { formatMilestone } from '../dates.js';
import { openDatePicker } from './date-picker.js';
import { typeIcon } from '../import/bank/classifier.js';
import { OUTGOING_KINDS, getOutgoingKindById } from '../data/outgoing-categories.js';
// Categories come from the live admin-editable registry (same source the
// quick-expense modal + charge editors use), so admin edits show here too.
import { getExpenseCategoriesNested } from '../config/registry.js';

let _open  = false;
let _state = null;

// ── Public API ────────────────────────────────────────────────

export function openQuickBankExpenseModal(prefill = null) {
  _open = true;
  _state = {
    amount:        '',
    name:          '',
    kindId:        null,
    categoryId:    null,
    subcategoryId: null,
    accountId:     _resolvePrefill(prefill),
    date:          todayISO(),
    notes:         '',
    notesOpen:     false,
  };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('quickBankExpense.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('quickBankExpense.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  _render();
  overlay.classList.add('open');

  setTimeout(() => document.getElementById('f-qbe-amount')?.focus(), 50);
}

export function hasPendingQuickBankExpense()   { return _open; }
export function clearPendingQuickBankExpense() { _open = false; _state = null; }

export function applyPendingQuickBankExpense() {
  if (!_open || !_state) return false;

  const v = _validate(_state);
  if (v.error) { _showError(v.error, v.focus); return false; }

  const data   = getAppData();
  const amount = Number(_state.amount);
  const kind   = getOutgoingKindById(_state.kindId);
  if (!kind) { _showError(t('quickBankExpense.missingKind'), 'f-qbe-kind-grid'); return false; }

  const bankEntry = (data.entries || []).find(e => e.id === _state.accountId);
  if (!bankEntry) { _showError(t('quickBankExpense.invalidBank'), 'f-qbe-account-grid'); return false; }

  const name = _state.name.trim();

  // Mirror of quick-income's bank record, in the debit direction. The
  // schema matches what the bank importer produces (hapoalim-pdf-parser
  // et al.), with source='manual' as the distinguishing field. balance
  // is null because the running statement balance isn't known for a
  // manual post; a later import overwrites balance on matched rows.
  const tx = {
    id:            generateId('manual-out'),
    date:          _state.date,
    description:   name,
    amount,
    direction:     'debit',
    balance:       null,
    // `type` is the TECHNICAL classification (a real BANK_TX_TYPE) —
    // never the expense-category id. The user's chosen expense category
    // lives in categoryId, mirroring how imported debits carry both.
    type:          kind.type,
    icon:          typeIcon(kind.type),
    // isInternal comes from the kind registry, NOT typeMeta: some types
    // (internal_savings) have no classifier rule and would default to
    // false. Internal rows are excluded from the Spending breakdown.
    isInternal:    kind.isInternal,
    // Expense category only for spendable kinds; internal transfers
    // carry none so they never slip into Spending.
    categoryId:    kind.spendable ? (_state.categoryId    || null) : null,
    subcategoryId: kind.spendable ? (_state.subcategoryId || null) : null,
    source:        'manual',
    // accountId points to the entries[] id the user picked. bankId is
    // the institution-level link the import dedupe layer matches on.
    accountId:     bankEntry.id,
    bankId:        bankEntry.bankId || null,
    rejectedMatches: [],
    notes:         _state.notes.trim() || null,
    enteredAt:     new Date().toISOString(),
  };

  data.bankTransactions = [...(data.bankTransactions || []), tx];
  bankEntry.balance   = (bankEntry.balance || 0) - amount;
  bankEntry.updatedAt = todayISO();

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _open = false;
  _state = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Render ────────────────────────────────────────────────────

function _render() {
  const bodyEl = document.getElementById('modal-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = _renderForm(_state);
  _wireInputs();
}

function _renderForm(s) {
  const data  = getAppData();
  const banks = getBankAccountEntries(data);
  const kind  = getOutgoingKindById(s.kindId);
  const showCategory = !!(kind && kind.spendable);

  return `
    <form class="quick-expense-form" onsubmit="event.preventDefault()">

      <div class="quick-expense-amount-wrap">
        <span class="quick-expense-amount-symbol">₪</span>
        <input class="quick-expense-amount" id="f-qbe-amount"
               type="text" inputmode="decimal" autocomplete="off"
               value="${_esc(s.amount)}"
               placeholder="0" />
      </div>

      <div class="form-group">
        <label class="form-label" for="f-qbe-name">${t('quickBankExpense.name')}</label>
        <input class="form-input" id="f-qbe-name" type="text"
               value="${_esc(s.name)}"
               placeholder="${t('quickBankExpense.namePlaceholder')}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('quickBankExpense.kind')}</label>
        <div class="quick-expense-chip-grid" id="f-qbe-kind-grid">
          ${OUTGOING_KINDS.map(k => _renderKindChip(k, s.kindId)).join('')}
        </div>
      </div>

      ${showCategory ? `
        <div class="form-group">
          <label class="form-label">${t('quickBankExpense.expenseCategory')}</label>
          <div class="quick-expense-chip-grid" id="f-qbe-category-grid">
            ${getExpenseCategoriesNested().map(cat => _renderCategoryChip(cat, s.categoryId)).join('')}
          </div>
        </div>

        ${s.categoryId ? `
          <div class="form-group">
            <label class="form-label">${t('quickExpense.subcategory')}</label>
            <div class="quick-expense-chip-grid" id="f-qbe-subcategory-grid">
              ${_renderSubcategoryChips(s.categoryId, s.subcategoryId)}
            </div>
          </div>
        ` : ''}
      ` : ''}

      <div class="form-group">
        <label class="form-label">${t('quickBankExpense.account')}</label>
        <div class="quick-expense-chip-grid quick-expense-chip-grid--cards" id="f-qbe-account-grid">
          ${banks.map(b => _renderBankChip(b, data, s)).join('')}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-qbe-date-btn">${t('quickBankExpense.date')}</label>
          <button type="button" class="form-input quick-expense-date-btn"
                  id="f-qbe-date-btn"
                  aria-haspopup="dialog">
            <span class="quick-expense-date-label" id="f-qbe-date-label">${formatMilestone(s.date)}</span>
            <span class="quick-expense-date-chevron" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="form-group quick-expense-notes-slot">
          <label class="form-label">${t('quickBankExpense.notes')}</label>
          ${s.notesOpen
            ? `<textarea class="form-input" id="f-qbe-notes" rows="2"
                         placeholder="${t('quickBankExpense.notesPlaceholder')}">${_esc(s.notes)}</textarea>`
            : `<button type="button" class="btn btn-ghost btn-sm" id="f-qbe-notes-toggle">+ ${t('quickBankExpense.addNote')}</button>`}
        </div>
      </div>

      <p id="f-qbe-error" class="form-error" style="display:none"></p>
    </form>
  `;
}

function _renderKindChip(kind, selectedId) {
  const isSel = selectedId === kind.id;
  const label = kind.name[currentLang] || kind.name.en;
  return `
    <button type="button"
            class="quick-expense-chip ${isSel ? 'is-selected' : ''}"
            data-kind-id="${kind.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">${kind.emoji}</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

function _renderCategoryChip(cat, selectedId) {
  const isSel = selectedId === cat.id;
  const label = cat.name[currentLang] || cat.name.en;
  return `
    <button type="button"
            class="quick-expense-chip ${isSel ? 'is-selected' : ''}"
            data-category-id="${cat.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">${cat.emoji}</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

function _renderSubcategoryChips(categoryId, selectedSubId) {
  // Pull the nested category (with its subcategories) from the live
  // registry — getCategoryById there returns parents WITHOUT a
  // subcategories array, so resolve against the nested list instead.
  const cat = getExpenseCategoriesNested().find(c => c.id === categoryId);
  if (!cat) return '';
  return (cat.subcategories || []).map(sub => {
    const isSel = selectedSubId === sub.id;
    const label = sub.name[currentLang] || sub.name.en;
    return `
      <button type="button"
              class="quick-expense-chip quick-expense-chip--sub ${isSel ? 'is-selected' : ''}"
              data-subcategory-id="${sub.id}">
        <span class="quick-expense-chip-text">${_esc(label)}</span>
      </button>
    `;
  }).join('');
}

function _renderBankChip(entry, data, s) {
  const isSel = s.accountId === entry.id;
  const bank  = entry.bankId ? getBank(data, entry.bankId) : null;
  const bankName = bank ? getBankDisplayName(bank) : (entry.institution || '');
  const label = bankName
    ? `${bankName} · ${currentLang === 'he' ? entry.name : (entry.nameEn || entry.name)}`
    : (currentLang === 'he' ? entry.name : (entry.nameEn || entry.name));
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--bank ${isSel ? 'is-selected' : ''}"
            data-account-id="${entry.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">🏦</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

// ── Wiring ────────────────────────────────────────────────────

function _wireInputs() {
  const amount = document.getElementById('f-qbe-amount');
  if (amount) {
    amount.addEventListener('input', () => {
      _state.amount = amount.value.replace(/[^\d.]/g, '');
    });
    amount.addEventListener('blur', () => {
      if (amount.value !== _state.amount) amount.value = _state.amount;
    });
  }
  document.getElementById('f-qbe-name')?.addEventListener('input', e => { _state.name = e.target.value; });

  const dateBtn   = document.getElementById('f-qbe-date-btn');
  const dateLabel = document.getElementById('f-qbe-date-label');
  if (dateBtn) {
    dateBtn.addEventListener('click', () => {
      openDatePicker({
        anchor:  dateBtn,
        initial: _state.date,
        max:     todayISO(),
        onSelect(iso) {
          _state.date = iso || todayISO();
          if (dateLabel) dateLabel.innerHTML = formatMilestone(_state.date);
        },
      });
    });
  }

  // Kind chips — selecting a kind toggles whether the expense-category
  // block is shown (spendable kinds only), so we re-render. Switching to
  // a non-spendable kind clears any stray category selection so it can't
  // quietly persist.
  document.getElementById('f-qbe-kind-grid')?.querySelectorAll('[data-kind-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.kindId;
      _state.kindId = (_state.kindId === newId) ? null : newId;
      const kind = getOutgoingKindById(_state.kindId);
      if (!kind || !kind.spendable) {
        _state.categoryId = null;
        _state.subcategoryId = null;
      }
      _render();
      document.querySelector(`[data-kind-id="${newId}"]`)?.focus();
    });
  });

  // Expense-category chips — picking one clears the previous subcategory
  // (subcategory ids don't span categories) and re-renders to reveal the
  // matching subcategory grid.
  document.getElementById('f-qbe-category-grid')?.querySelectorAll('[data-category-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.categoryId;
      if (_state.categoryId === newId) {
        _state.categoryId = null;
        _state.subcategoryId = null;
      } else {
        _state.categoryId = newId;
        _state.subcategoryId = null;
      }
      _render();
      document.querySelector(`[data-category-id="${newId}"]`)?.focus();
    });
  });

  document.getElementById('f-qbe-subcategory-grid')?.querySelectorAll('[data-subcategory-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.subcategoryId;
      _state.subcategoryId = _state.subcategoryId === newId ? null : newId;
      _render();
      document.querySelector(`[data-subcategory-id="${newId}"]`)?.focus();
    });
  });

  // Account chips — lightweight class toggle so the user doesn't lose
  // focus on the amount/name fields.
  document.getElementById('f-qbe-account-grid')?.querySelectorAll('[data-account-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.accountId = btn.dataset.accountId;
      document.querySelectorAll('[data-account-id]').forEach(b => {
        b.classList.toggle('is-selected', b.dataset.accountId === _state.accountId);
      });
    });
  });

  document.getElementById('f-qbe-notes-toggle')?.addEventListener('click', () => {
    _state.notesOpen = true;
    _render();
    setTimeout(() => document.getElementById('f-qbe-notes')?.focus(), 30);
  });
  document.getElementById('f-qbe-notes')?.addEventListener('input', e => { _state.notes = e.target.value; });
}

// ── Validation ────────────────────────────────────────────────

function _validate(s) {
  const amount = Number(s.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: t('quickBankExpense.invalidAmount'), focus: 'f-qbe-amount' };
  if (!s.name.trim())                            return { error: t('quickBankExpense.missingName'),   focus: 'f-qbe-name' };
  if (!s.kindId)                                 return { error: t('quickBankExpense.missingKind'),   focus: 'f-qbe-kind-grid' };
  if (!s.accountId)                              return { error: t('quickBankExpense.missingAccount'),focus: 'f-qbe-account-grid' };
  if (!s.date)                                   return { error: t('quickBankExpense.missingDate'),   focus: 'f-qbe-date-btn' };
  return { error: null };
}

function _showError(message, focusId) {
  const errorEl = document.getElementById('f-qbe-error');
  if (errorEl) {
    errorEl.textContent  = message;
    errorEl.style.display = 'block';
  }
  document.getElementById(focusId)?.focus();
}

// ── Helpers ───────────────────────────────────────────────────

// Default account: explicit prefill id, then a primary checking
// account, then the first bank entry, else null.
function _resolvePrefill(prefill) {
  const data = getAppData();

  if (typeof prefill === 'string' && prefill) return prefill;
  if (prefill && typeof prefill === 'object' && prefill.id) return prefill.id;

  const banks = getBankAccountEntries(data);
  const primary = banks.find(b => b.isPrimary);
  if (primary) return primary.id;
  if (banks.length > 0) return banks[0].id;
  return null;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
