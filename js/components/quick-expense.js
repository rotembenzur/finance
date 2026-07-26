// ─────────────────────────────────────────────────────────────────
//  QUICK EXPENSE ENTRY
//
//  Mobile-first "I just paid for something, log it" capture flow.
//  Stored on the chosen card's charges[] array with source='manual'
//  so it appears alongside imported charges on the card-charges
//  page. After the next official statement import, the reconciliation
//  flow looks for matches between manual entries and incoming ones.
//
//  Form order is optimized for typing speed on a phone:
//    1. amount      — large numeric input, focused on open
//    2. name        — single text line
//    3. category    — chip grid (tap → reveals subcategory chips)
//    4. subcategory — chip grid (only after a category is picked)
//    5. card        — chip grid of active credit/debit cards
//    6. date        — defaults to today; tap to change
//    7. notes       — optional, collapsed behind a single-tap reveal
//
//  Saving builds a charge object with the same shape imported charges
//  use, so row rendering, edit-charge enrichment, and reconciliation
//  all work without any source-specific forks.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getCards, getCashEntries, getWalletEntries, isCashLikeEntry } from '../utils.js';
import { formatMilestone } from '../dates.js';
import { openDatePicker } from './date-picker.js';
import { getExpenseCategoriesNested, getCategoryById } from '../config/registry.js';

let _open = false;
// Local draft for the modal. `sourceKind` is 'card' | 'cash' | 'wallet'
// and `sourceId` references the corresponding entity. Cash and wallet
// sources deduct the amount from the chosen entry's balance on save;
// both push the same charge shape to entry.charges so the history
// page renders either kind without source-specific forks.
let _state = null;

// ── Public API ────────────────────────────────────────────────

export function openQuickExpenseModal(prefill = null) {
  _open = true;
  // `prefill` accepts either a string card id (legacy callers) or an
  // object `{ kind: 'card'|'cash', id }`. Defaults to the most recently
  // used credit card; if none exists but the user has a cash entry,
  // cash becomes the default source.
  const initialSource = _resolvePrefill(prefill);
  _state = {
    amount:        '',
    name:          '',
    categoryId:    null,
    subcategoryId: null,
    sourceKind:    initialSource.kind,
    sourceId:      initialSource.id,
    date:          todayISO(),
    notes:         '',
    notesOpen:     false,
  };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('quickExpense.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('quickExpense.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  _render();
  overlay.classList.add('open');

  setTimeout(() => document.getElementById('f-qe-amount')?.focus(), 50);
}

export function hasPendingQuickExpense()   { return _open; }
export function clearPendingQuickExpense() { _open = false; _state = null; }

export function applyPendingQuickExpense() {
  if (!_open || !_state) return false;

  const validation = _validate(_state);
  if (validation.error) {
    _showError(validation.error, validation.focus);
    return false;
  }

  const data   = getAppData();
  const amount = Number(_state.amount);

  // Common charge shape — same for cards and cash, so card-charges,
  // cash-history, and future reconciliation flows can render the
  // same record without source-specific forks. The `paymentMethod`
  // discriminator is what tells consumers "this came from cash"
  // even though the array it lives in (card.charges vs cash.charges)
  // already implies that.
  const charge = {
    id:               generateId('manual'),
    date:             _state.date,
    merchant:         _state.name.trim(),
    amount,
    currency:         'ILS',
    originalAmount:   amount,
    originalCurrency: 'ILS',
    voucher:          null,
    note:             null,
    status:           'manual',
    importedFrom:     null,
    importedAt:       null,
    source:           'manual',
    paymentMethod:    _state.sourceKind,  // 'card' | 'cash' | 'wallet'
    enteredAt:        new Date().toISOString(),
    displayName:        null,
    categoryId:         _state.categoryId,
    subcategoryId:      _state.subcategoryId,
    notes:              _state.notes.trim() || null,
    isRecurringMonthly: false,
    rejectedMatches:    [],
  };

  if (_state.sourceKind === 'cash' || _state.sourceKind === 'wallet') {
    // Push to the chosen entry's charges and deduct from its balance.
    // Cash and wallet entries share this shape — physical cash and
    // digital wallets both hold their own charges[] array and treat
    // a saved expense as a direct balance decrement.
    const entry = (data.entries || []).find(e =>
      e.id === _state.sourceId && isCashLikeEntry(e)
    );
    if (!entry) {
      const errKey = _state.sourceKind === 'wallet'
        ? 'quickExpense.invalidWallet'
        : 'quickExpense.invalidCash';
      _showError(t(errKey), 'f-qe-source-grid');
      return false;
    }
    entry.charges = [...(entry.charges || []), charge];
    entry.balance = (entry.balance || 0) - amount;
    entry.updatedAt = todayISO();

  } else {
    // Card path — unchanged from before.
    const card = (data.cards || []).find(c => c.id === _state.sourceId);
    if (!card) {
      _showError(t('quickExpense.invalidCard'), 'f-qe-source-grid');
      return false;
    }
    card.charges = [...(card.charges || []), charge];
    card.updatedAt = todayISO();
    // Manual entries flow into currentSpending too; reconciliation
    // later will swap manual→imported so the figure stays correct.
    card.currentSpending = (card.charges || []).reduce((s, c) => s + (c.amount || 0), 0);
  }

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _open = false;
  _state = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Render + re-render ────────────────────────────────────────

function _render() {
  const bodyEl = document.getElementById('modal-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = _renderForm(_state);
  _wireInputs();
}

function _renderForm(s) {
  const data    = getAppData();
  const cards   = getCards(data).filter(c => !c.isDebit || true);
  const cash    = getCashEntries(data);
  const wallets = getWalletEntries(data);

  return `
    <form class="quick-expense-form" onsubmit="event.preventDefault()">

      <div class="quick-expense-amount-wrap">
        <span class="quick-expense-amount-symbol">₪</span>
        <input class="quick-expense-amount" id="f-qe-amount"
               type="text" inputmode="decimal" autocomplete="off"
               value="${_esc(s.amount)}"
               placeholder="0" />
      </div>

      <div class="form-group">
        <label class="form-label" for="f-qe-name">${t('quickExpense.name')}</label>
        <input class="form-input" id="f-qe-name" type="text"
               value="${_esc(s.name)}"
               placeholder="${t('quickExpense.namePlaceholder')}" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('quickExpense.category')}</label>
        <div class="quick-expense-chip-grid" id="f-qe-category-grid">
          ${getExpenseCategoriesNested().map(cat => _renderCategoryChip(cat, s.categoryId)).join('')}
        </div>
      </div>

      <div class="form-group" id="f-qe-subcategory-wrap" style="${s.categoryId ? '' : 'display:none'}">
        <label class="form-label">${t('quickExpense.subcategory')}</label>
        <div class="quick-expense-chip-grid" id="f-qe-subcategory-grid">
          ${s.categoryId ? _renderSubcategoryChips(s.categoryId, s.subcategoryId) : ''}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('quickExpense.source')}</label>
        <div class="quick-expense-chip-grid quick-expense-chip-grid--cards" id="f-qe-source-grid">
          ${cards.map(c => _renderCardChip(c, s)).join('')}
          ${cash.map(c => _renderCashChip(c, s)).join('')}
          ${wallets.map(w => _renderWalletChip(w, s)).join('')}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-qe-date-btn">${t('quickExpense.date')}</label>
          <!-- The visible date is rendered through formatMilestone so
               it reads naturally in both languages ("12 במאי 2026" /
               "May 12, 2026"). Tapping the button opens the app's
               custom date picker (js/components/date-picker.js) —
               no more browser-native system calendar. The picker
               writes back to _state.date and refreshes the label. -->
          <button type="button" class="form-input quick-expense-date-btn"
                  id="f-qe-date-btn"
                  aria-haspopup="dialog">
            <span class="quick-expense-date-label" id="f-qe-date-label">${formatMilestone(s.date)}</span>
            <span class="quick-expense-date-chevron" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="form-group quick-expense-notes-slot" id="f-qe-notes-slot">
          <label class="form-label">${t('quickExpense.notes')}</label>
          ${_renderNotesSlotInner(s)}
        </div>
      </div>

      <p id="f-qe-error" class="form-error" style="display:none"></p>
    </form>
  `;
}

function _renderNotesSlotInner(s) {
  return s.notesOpen
    ? `<textarea class="form-input" id="f-qe-notes" rows="2"
                 placeholder="${t('quickExpense.notesPlaceholder')}">${_esc(s.notes)}</textarea>`
    : `<button type="button" class="btn btn-ghost btn-sm" id="f-qe-notes-toggle">+ ${t('quickExpense.addNote')}</button>`;
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
  const cat = getCategoryById(categoryId);
  if (!cat) return '';
  return cat.subcategories.map(sub => {
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

function _renderCardChip(card, s) {
  const isSel = s.sourceKind === 'card' && s.sourceId === card.id;
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--card ${isSel ? 'is-selected' : ''}"
            data-source-kind="card"
            data-source-id="${card.id}">
      <span class="quick-expense-chip-text">•••• ${_esc(card.last4)}</span>
    </button>
  `;
}

// Cash entries appear in the same chip grid as cards. Visually
// distinguished by the wallet emoji + the entry's label so the eye
// reads "this is a different payment kind" at a glance.
function _renderCashChip(entry, s) {
  const isSel = s.sourceKind === 'cash' && s.sourceId === entry.id;
  const label = currentLang === 'he'
    ? (entry.name   || entry.nameEn || t('quickExpense.cashLabel'))
    : (entry.nameEn || entry.name   || t('quickExpense.cashLabel'));
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--cash ${isSel ? 'is-selected' : ''}"
            data-source-kind="cash"
            data-source-id="${entry.id}">
      <span class="quick-expense-chip-emoji" aria-hidden="true">💵</span>
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

// Digital-wallet chips (Bit, Paybox). Brand logo when one is attached
// to the entry; falls back to the generic wallet emoji so an unknown
// future wallet still renders.
function _renderWalletChip(entry, s) {
  const isSel = s.sourceKind === 'wallet' && s.sourceId === entry.id;
  const label = currentLang === 'he'
    ? (entry.name   || entry.nameEn || '')
    : (entry.nameEn || entry.name   || '');
  const mark = entry.logo
    ? `<img class="quick-expense-chip-logo" src="${_esc(entry.logo)}" alt="" />`
    : `<span class="quick-expense-chip-emoji" aria-hidden="true">📱</span>`;
  return `
    <button type="button"
            class="quick-expense-chip quick-expense-chip--wallet ${isSel ? 'is-selected' : ''}"
            data-source-kind="wallet"
            data-source-id="${entry.id}">
      ${mark}
      <span class="quick-expense-chip-text">${_esc(label)}</span>
    </button>
  `;
}

// ── Wiring (delegate within the modal body) ──────────────────

function _wireInputs() {
  const bodyEl = document.getElementById('modal-body');
  if (!bodyEl) return;

  // Live-sync the simple text inputs into _state.
  const amount = document.getElementById('f-qe-amount');
  if (amount) {
    amount.addEventListener('input', () => {
      _state.amount = amount.value.replace(/[^\d.]/g, '');
    });
    amount.addEventListener('blur', () => {
      if (amount.value !== _state.amount) amount.value = _state.amount;
    });
  }
  document.getElementById('f-qe-name')?.addEventListener('input', e => { _state.name = e.target.value; });

  // Date picker — tapping the button opens the app's custom calendar
  // popover (anchored beneath the button when there's room, centered
  // on viewport otherwise). On select we update _state.date AND the
  // visible label. formatMilestone returns <bdi>-wrapped HTML so the
  // label is repainted via innerHTML, not textContent.
  const dateBtn   = document.getElementById('f-qe-date-btn');
  const dateLabel = document.getElementById('f-qe-date-label');
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

  // Category chip grid — tap to select; clearing previously selected
  // subcategory because subcategory IDs don't span categories.
  // Selecting only swaps the (small) subcategory block in place rather
  // than re-rendering the whole form: a full re-render replaced the
  // amount/name <input> nodes on every tap, which dropped focus, closed
  // the on-screen keyboard, and shifted the layout under the user's
  // next tap — the actual cause of "buttons don't respond" on mobile.
  document.getElementById('f-qe-category-grid')?.querySelectorAll('[data-category-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.categoryId;
      if (_state.categoryId === newId) {
        _state.categoryId = null;
        _state.subcategoryId = null;
      } else {
        _state.categoryId = newId;
        _state.subcategoryId = null;
      }
      document.querySelectorAll('#f-qe-category-grid [data-category-id]').forEach(b => {
        b.classList.toggle('is-selected', b.dataset.categoryId === _state.categoryId);
      });
      _refreshSubcategoryBlock();
    });
  });

  _wireSubcategoryChips();

  // Source chip grid — cards + cash entries. Selecting toggles the
  // selection class lightweight (no re-render) so the user doesn't
  // lose focus on the amount/name fields.
  document.getElementById('f-qe-source-grid')?.querySelectorAll('[data-source-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.sourceKind = btn.dataset.sourceKind;
      _state.sourceId   = btn.dataset.sourceId;
      document.querySelectorAll('[data-source-id]').forEach(b => {
        const same = b.dataset.sourceKind === _state.sourceKind
                  && b.dataset.sourceId   === _state.sourceId;
        b.classList.toggle('is-selected', same);
      });
    });
  });

  _wireNotesSlot();
}

// Notes reveal — swaps only its own slot in place (same reasoning as
// the subcategory block: no full-form re-render, no lost focus/keyboard).
function _wireNotesSlot() {
  document.getElementById('f-qe-notes-toggle')?.addEventListener('click', () => {
    _state.notesOpen = true;
    const slot = document.getElementById('f-qe-notes-slot');
    if (slot) {
      slot.innerHTML = `<label class="form-label">${t('quickExpense.notes')}</label>${_renderNotesSlotInner(_state)}`;
    }
    _wireNotesSlot();
    document.getElementById('f-qe-notes')?.focus();
  });
  document.getElementById('f-qe-notes')?.addEventListener('input', e => { _state.notes = e.target.value; });
}

// Swaps just the subcategory grid's contents in place — never touches
// the rest of the form (amount/name inputs keep their focus and the
// keyboard stays open).
function _refreshSubcategoryBlock() {
  const wrap = document.getElementById('f-qe-subcategory-wrap');
  const grid = document.getElementById('f-qe-subcategory-grid');
  if (!wrap || !grid) return;
  wrap.style.display = _state.categoryId ? '' : 'none';
  grid.innerHTML = _state.categoryId ? _renderSubcategoryChips(_state.categoryId, _state.subcategoryId) : '';
  _wireSubcategoryChips();
}

// Subcategory chip grid — toggleable, lightweight (no re-render) so a
// tap never drops focus/keyboard on the fields above it.
function _wireSubcategoryChips() {
  document.getElementById('f-qe-subcategory-grid')?.querySelectorAll('[data-subcategory-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newId = btn.dataset.subcategoryId;
      _state.subcategoryId = _state.subcategoryId === newId ? null : newId;
      document.querySelectorAll('#f-qe-subcategory-grid [data-subcategory-id]').forEach(b => {
        b.classList.toggle('is-selected', b.dataset.subcategoryId === _state.subcategoryId);
      });
    });
  });
}

// ── Validation ────────────────────────────────────────────────

function _validate(s) {
  const amount = Number(s.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: t('quickExpense.invalidAmount'), focus: 'f-qe-amount' };
  if (!s.name.trim())                            return { error: t('quickExpense.missingName'),   focus: 'f-qe-name' };
  if (!s.sourceId || !s.sourceKind)              return { error: t('quickExpense.missingSource'), focus: 'f-qe-source-grid' };
  if (!s.date)                                   return { error: t('quickExpense.missingDate'),   focus: 'f-qe-date' };
  return { error: null };
}

function _showError(message, focusId) {
  const errorEl = document.getElementById('f-qe-error');
  if (errorEl) {
    errorEl.textContent  = message;
    errorEl.style.display = 'block';
  }
  document.getElementById(focusId)?.focus();
}

// ── Helpers ──────────────────────────────────────────────────

// Resolve the initial source for a fresh modal. Accepts:
//   • null            → pick a sensible default (first credit card,
//                       then first card, then first cash entry)
//   • 'card-id-str'   → legacy: treat as a card id
//   • { kind, id }    → explicit source pre-fill
function _resolvePrefill(prefill) {
  const data = getAppData();

  if (prefill && typeof prefill === 'object' && prefill.kind && prefill.id) {
    return { kind: prefill.kind, id: prefill.id };
  }
  if (typeof prefill === 'string' && prefill) {
    return { kind: 'card', id: prefill };
  }

  const cards = getCards(data);
  const credit = cards.filter(c => !c.isDebit);
  if (credit.length > 0) return { kind: 'card', id: credit[0].id };
  if (cards.length > 0)  return { kind: 'card', id: cards[0].id };

  const cash = getCashEntries(data);
  if (cash.length > 0)   return { kind: 'cash', id: cash[0].id };

  return { kind: null, id: null };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
