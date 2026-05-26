// ─────────────────────────────────────────────────────────────────
//  QUICK INCOME ENTRY
//
//  Mirror of quick-expense.js for the income side. Single mobile-
//  first capture flow for money arriving from outside the user's
//  tracked accounts: a cash gift, a salary deposit, a card refund,
//  a Bit/Paybox transfer, an investment payout, etc.
//
//  Form order (optimized for thumb-typing):
//    1. amount       — large numeric input, focused on open
//    2. name         — single text line (who/what)
//    3. income type  — chip grid (salary, gift, refund, transfer, …)
//    4. destination  — chip grid of bank accounts + cash entries + cards
//                       (cards present for refunds; selecting a card
//                       reduces that card's pending billing total)
//    5. date         — defaults to today; tap to change
//    6. notes        — optional, collapsed behind a single-tap reveal
//
//  Persistence by destination kind:
//    • cash  → push to cashEntry.charges[] with direction='in';
//              bump cashEntry.balance UP by the amount.
//    • bank  → push to data.bankTransactions[] with source='manual',
//              direction='credit', accountId=<entry.id>, plus the
//              income category; bump entry.balance UP by the amount.
//    • card  → push to card.charges[] with direction='in'; the
//              calcCardPendingCharges helper subtracts in-window
//              direction='in' charges so the refund reduces what
//              the user will be billed for.
//
//  Direction is the discriminator that distinguishes income from
//  expense everywhere downstream. Existing entries that predate this
//  feature have no `direction` field; readers treat them as 'out'
//  (the implicit historical default).
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import {
  getCards, getCashEntries, getWalletEntries, getBankAccountEntries,
  getBankDisplayName, getBank, isCashLikeEntry,
} from '../utils.js';
import { formatMilestone } from '../dates.js';
import { openDatePicker } from './date-picker.js';
import {
  INCOME_CATEGORIES, getIncomeCategoryById,
  getCashIncomeCategories, CASH_INCOME_CATEGORY_IDS,
} from '../data/income-categories.js';

let _open  = false;
let _state = null;

// ── Public API ────────────────────────────────────────────────

export function openQuickIncomeModal(prefill = null) {
  _open = true;
  const initialDest = _resolvePrefill(prefill);
  _state = {
    amount:           '',
    name:             '',
    incomeCategoryId: null,
    destKind:         initialDest.kind, // 'cash' | 'wallet' | 'bank' | 'card'
    destId:           initialDest.id,
    date:             todayISO(),
    notes:            '',
    notesOpen:        false,
  };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('quickIncome.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('quickIncome.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  _render();
  overlay.classList.add('open');

  setTimeout(() => document.getElementById('f-qi-amount')?.focus(), 50);
}

export function hasPendingQuickIncome()   { return _open; }
export function clearPendingQuickIncome() { _open = false; _state = null; }

export function applyPendingQuickIncome() {
  if (!_open || !_state) return false;

  const v = _validate(_state);
  if (v.error) { _showError(v.error, v.focus); return false; }

  const data   = getAppData();
  const amount = Number(_state.amount);

  // Common income record shape — same on cash, card, and bank
  // destinations so the row renderers can render either side
  // without source-specific forks. The `direction` field is the
  // discriminator that turns this into "income" downstream.
  const record = {
    id:                 generateId('manual-in'),
    date:               _state.date,
    merchant:           _state.name.trim(),
    description:        _state.name.trim(),
    amount,
    currency:           'ILS',
    direction:          _state.destKind === 'bank' ? 'credit' : 'in',  // 'in' for cash + wallets + cards
    source:             'manual',
    paymentMethod:      _state.destKind,
    incomeCategoryId:   _state.incomeCategoryId,
    notes:              _state.notes.trim() || null,
    enteredAt:          new Date().toISOString(),
  };

  if (_state.destKind === 'cash' || _state.destKind === 'wallet') {
    // Cash and wallets share the same charges[]-on-the-entry pattern,
    // so a saved income just appends to that array and bumps balance.
    const entry = (data.entries || []).find(e =>
      e.id === _state.destId && isCashLikeEntry(e)
    );
    if (!entry) {
      const errKey = _state.destKind === 'wallet'
        ? 'quickIncome.invalidWallet'
        : 'quickIncome.invalidCash';
      _showError(t(errKey), 'f-qi-dest-grid');
      return false;
    }
    entry.charges = [...(entry.charges || []), record];
    entry.balance = (entry.balance || 0) + amount;
    entry.updatedAt = todayISO();

  } else if (_state.destKind === 'bank') {
    const bankEntry = (data.entries || []).find(e => e.id === _state.destId);
    if (!bankEntry) { _showError(t('quickIncome.invalidBank'), 'f-qi-dest-grid'); return false; }

    // Push as a bank-transactions[] record so the Transactions page
    // (and future dedupe layer on import) sees it. Schema mirrors
    // what hapoalim-pdf-parser produces, with source='manual' as the
    // distinguishing field. balance is null because we don't know
    // the running balance for the bank-side post; imports later will
    // overwrite balance on existing transactions.
    const tx = {
      id:               record.id,
      date:             record.date,
      description:      record.description,
      amount:           record.amount,
      direction:        'credit',
      balance:          null,
      type:             _state.incomeCategoryId || 'incoming_transfer',
      incomeCategoryId: record.incomeCategoryId,
      source:           'manual',
      // accountId points to the entries[] id the user picked.
      // bankId is the institution-level link — the bank-import
      // dedupe layer matches on bankId because import txs use
      // bankAccounts[].id (a different namespace) for accountId.
      accountId:        bankEntry.id,
      bankId:           bankEntry.bankId || null,
      rejectedMatches:  [],
      notes:            record.notes,
      enteredAt:        record.enteredAt,
    };
    data.bankTransactions = [...(data.bankTransactions || []), tx];
    bankEntry.balance   = (bankEntry.balance || 0) + amount;
    bankEntry.updatedAt = todayISO();

  } else if (_state.destKind === 'card') {
    const card = (data.cards || []).find(c => c.id === _state.destId);
    if (!card) { _showError(t('quickIncome.invalidCard'), 'f-qi-dest-grid'); return false; }
    card.charges = [...(card.charges || []), record];
    card.updatedAt = todayISO();
    // currentSpending stays as the sum of charge amounts — refunds
    // reduce calcCardPendingCharges via the direction-aware path,
    // not via the legacy stored field. Backward compat: cards with
    // no charges[] still fall back to stored currentSpending.
    card.currentSpending = (card.charges || []).reduce((s, c) => {
      const a = Number(c.amount) || 0;
      return s + (c.direction === 'in' ? -a : a);
    }, 0);
  } else {
    _showError(t('quickIncome.missingDestination'), 'f-qi-dest-grid');
    return false;
  }

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
  const data    = getAppData();
  const banks   = getBankAccountEntries(data);
  const cash    = getCashEntries(data);
  const wallets = getWalletEntries(data);
  const cards   = getCards(data).filter(c => !c.isDebit);

  return `
    <form class="quick-expense-form" onsubmit="event.preventDefault()">

      <div class="quick-expense-amount-wrap quick-expense-amount-wrap--income">
        <span class="quick-expense-amount-symbol">+₪</span>
        <input class="quick-expense-amount" id="f-qi-amount"
               type="text" inputmode="decimal" autocomplete="off"
               value="${_esc(s.amount)}"
               placeholder="0" />
      </div>

      <div class="form-group">
        <label class="form-label" for="f-qi-name">${t('quickIncome.name')}</label>
        <input class="form-input" id="f-qi-name" type="text"
               value="${_esc(s.name)}"
               placeholder="${t('quickIncome.namePlaceholder')}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('quickIncome.category')}</label>
        <div class="quick-expense-chip-grid" id="f-qi-category-grid">
          ${_incomeCategoriesFor(s.destKind).map(cat => _renderCategoryChip(cat, s.incomeCategoryId)).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('quickIncome.destination')}</label>
        <div class="quick-expense-chip-grid quick-expense-chip-grid--cards" id="f-qi-dest-grid">
          ${banks.map(b => _renderBankChip(b, data, s)).join('')}
          ${cash.map(c => _renderCashChip(c, s)).join('')}
          ${wallets.map(w => _renderWalletChip(w, s)).join('')}
          ${cards.map(c => _renderCardChip(c, s)).join('')}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-qi-date-btn">${t('quickIncome.date')}</label>
          <button type="button" class="form-input quick-expense-date-btn"
                  id="f-qi-date-btn"
                  aria-haspopup="dialog">
            <span class="quick-expense-date-label" id="f-qi-date-label">${formatMilestone(s.date)}</span>
            <span class="quick-expense-date-chevron" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="form-group quick-expense-notes-slot">
          <label class="form-label">${t('quickIncome.notes')}</label>
          ${s.notesOpen
            ? `<textarea class="form-input" id="f-qi-notes" rows="2"
                         placeholder="${t('quickIncome.notesPlaceholder')}">${_esc(s.notes)}</textarea>`
            : `<button type="button" class="btn btn-ghost btn-sm" id="f-qi-notes-toggle">+ ${t('quickIncome.addNote')}</button>`}
        </div>
      </div>

      <p id="f-qi-error" class="form-error" style="display:none"></p>
    </form>
  `;
}

// Cash and wallet destinations only offer the narrow cash-income
// set (gift / refund / transfer / other) — salary, social security,
// etc. land in a bank account in practice, not a Bit transfer.
// Bank + card destinations keep the full registry.
function _incomeCategoriesFor(destKind) {
  return _isNarrowCategoryDest(destKind) ? getCashIncomeCategories() : INCOME_CATEGORIES;
}

function _isNarrowCategoryDest(destKind) {
  return destKind === 'cash' || destKind === 'wallet';
}

function _renderCategoryChip(cat, selectedId) {
  const isSel = selectedId === cat.id;
  const label = cat.name[currentLang] || cat.name.en;
  return `
    <button type="button"
            class="quick-expense-chip ${isSel ? 'is-selected' : ''}"
            data-income-category-id="${cat.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">${cat.emoji}</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

function _renderBankChip(entry, data, s) {
  const isSel = s.destKind === 'bank' && s.destId === entry.id;
  const bank  = entry.bankId ? getBank(data, entry.bankId) : null;
  const bankName = bank ? getBankDisplayName(bank) : (entry.institution || '');
  const label = bankName
    ? `${bankName} · ${currentLang === 'he' ? entry.name : (entry.nameEn || entry.name)}`
    : (currentLang === 'he' ? entry.name : (entry.nameEn || entry.name));
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--bank ${isSel ? 'is-selected' : ''}"
            data-dest-kind="bank"
            data-dest-id="${entry.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">🏦</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

function _renderCashChip(entry, s) {
  const isSel = s.destKind === 'cash' && s.destId === entry.id;
  const label = currentLang === 'he'
    ? (entry.name   || entry.nameEn || t('quickIncome.cashLabel'))
    : (entry.nameEn || entry.name   || t('quickIncome.cashLabel'));
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--cash ${isSel ? 'is-selected' : ''}"
            data-dest-kind="cash"
            data-dest-id="${entry.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">💵</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

// Digital wallet chips (Bit, Paybox). Uses the entry's brand logo so
// the user recognizes the destination at a glance — Bit's teal mark
// is unmistakable on the Israeli side.
function _renderWalletChip(entry, s) {
  const isSel = s.destKind === 'wallet' && s.destId === entry.id;
  const label = currentLang === 'he'
    ? (entry.name   || entry.nameEn || '')
    : (entry.nameEn || entry.name   || '');
  const mark = entry.logo
    ? `<img class="quick-expense-chip-logo" src="${_esc(entry.logo)}" alt="" />`
    : `<span class="quick-expense-chip-emoji" aria-hidden="true">📱</span>`;
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--wallet ${isSel ? 'is-selected' : ''}"
            data-dest-kind="wallet"
            data-dest-id="${entry.id}">
      ${mark}
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

function _renderCardChip(card, s) {
  const isSel = s.destKind === 'card' && s.destId === card.id;
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--card ${isSel ? 'is-selected' : ''}"
            data-dest-kind="card"
            data-dest-id="${card.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">💳</span>
      <span class="quick-expense-chip-text">•••• ${_esc(card.last4)}</span>
    </button>
  `;
}

// ── Wiring ────────────────────────────────────────────────────

function _wireInputs() {
  const amount = document.getElementById('f-qi-amount');
  if (amount) {
    amount.addEventListener('input', () => {
      _state.amount = amount.value.replace(/[^\d.]/g, '');
    });
    amount.addEventListener('blur', () => {
      if (amount.value !== _state.amount) amount.value = _state.amount;
    });
  }
  document.getElementById('f-qi-name')?.addEventListener('input', e => { _state.name = e.target.value; });

  const dateBtn   = document.getElementById('f-qi-date-btn');
  const dateLabel = document.getElementById('f-qi-date-label');
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

  document.getElementById('f-qi-category-grid')?.querySelectorAll('[data-income-category-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.incomeCategoryId;
      _state.incomeCategoryId = (_state.incomeCategoryId === newId) ? null : newId;
      _render();
      document.querySelector(`[data-income-category-id="${newId}"]`)?.focus();
    });
  });

  document.getElementById('f-qi-dest-grid')?.querySelectorAll('[data-dest-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasNarrow = _isNarrowCategoryDest(_state.destKind);
      _state.destKind = btn.dataset.destKind;
      _state.destId   = btn.dataset.destId;
      const nowNarrow = _isNarrowCategoryDest(_state.destKind);

      // The available income categories differ between cash-like
      // destinations (cash + digital wallets — narrow set) and bank
      // / card destinations (full registry). When we cross that
      // boundary, drop a now-invalid selection and re-render so the
      // chip grid matches the new destination. Within the same
      // boundary we keep the lightweight class-toggle so the user
      // doesn't lose focus.
      if (wasNarrow !== nowNarrow) {
        if (nowNarrow && _state.incomeCategoryId
            && !CASH_INCOME_CATEGORY_IDS.includes(_state.incomeCategoryId)) {
          _state.incomeCategoryId = null;
        }
        _render();
        return;
      }

      document.querySelectorAll('[data-dest-id]').forEach(b => {
        const same = b.dataset.destKind === _state.destKind
                  && b.dataset.destId   === _state.destId;
        b.classList.toggle('is-selected', same);
      });
    });
  });

  document.getElementById('f-qi-notes-toggle')?.addEventListener('click', () => {
    _state.notesOpen = true;
    _render();
    setTimeout(() => document.getElementById('f-qi-notes')?.focus(), 30);
  });
  document.getElementById('f-qi-notes')?.addEventListener('input', e => { _state.notes = e.target.value; });
}

// ── Validation ────────────────────────────────────────────────

function _validate(s) {
  const amount = Number(s.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: t('quickIncome.invalidAmount'),     focus: 'f-qi-amount' };
  if (!s.name.trim())                            return { error: t('quickIncome.missingName'),      focus: 'f-qi-name' };
  if (!s.incomeCategoryId)                       return { error: t('quickIncome.missingCategory'),  focus: 'f-qi-category-grid' };
  if (!s.destId || !s.destKind)                  return { error: t('quickIncome.missingDestination'),focus: 'f-qi-dest-grid' };
  if (!s.date)                                   return { error: t('quickIncome.missingDate'),      focus: 'f-qi-date' };
  return { error: null };
}

function _showError(message, focusId) {
  const errorEl = document.getElementById('f-qi-error');
  if (errorEl) {
    errorEl.textContent  = message;
    errorEl.style.display = 'block';
  }
  document.getElementById(focusId)?.focus();
}

// ── Helpers ───────────────────────────────────────────────────

// Default destination preference: a primary checking account if
// available, then any bank entry, then cash. Cards aren't picked
// by default — refunds are the rarer case.
function _resolvePrefill(prefill) {
  const data = getAppData();

  if (prefill && typeof prefill === 'object' && prefill.kind && prefill.id) {
    return { kind: prefill.kind, id: prefill.id };
  }

  const banks = getBankAccountEntries(data);
  const primary = banks.find(b => b.isPrimary);
  if (primary) return { kind: 'bank', id: primary.id };
  if (banks.length > 0) return { kind: 'bank', id: banks[0].id };

  const cash = getCashEntries(data);
  if (cash.length > 0) return { kind: 'cash', id: cash[0].id };

  return { kind: null, id: null };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
