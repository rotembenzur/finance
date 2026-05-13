// ─────────────────────────────────────────────────────────────────
//  EDIT CASH — create, update, or remove a wallet entry
//
//  Cash entries live on `data.entries[]` with `type: 'cash'` +
//  `isCash: true`. Each entry is one currency: ILS, USD, EUR, JPY,
//  KRW, … Amount is stored in the entry's own currency; per-entry
//  display shows the native number plus a live ILS equivalent
//  derived from the FX module.
//
//  Opening with no id → create. Opening with an id → edit (or
//  remove). Same form, same Save button; the Remove action lives
//  inline as a quiet danger button.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { CASH_CURRENCIES, convertToILS, formatForeignAmount } from '../fx.js';
import { formatCurrency } from '../utils.js';

let _editing = null;     // { entryId } | { create: true } | null

// ── Public API ────────────────────────────────────────────────

export function openEditCashModal(entryId = null) {
  const data = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (entryId && !entry) return;

  _editing = entry ? { entryId: entry.id } : { create: true };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = entry ? t('editCash.titleEdit') : t('editCash.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(entry, data);
  _wireForm(data);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-cash-amount')?.focus(), 50);
}

export function hasPendingCashEdit()   { return _editing !== null; }
export function clearPendingCashEdit() { _editing = null; }

export function applyPendingCashEdit() {
  if (!_editing) return false;

  const data = getAppData();
  const form = _readForm();
  if (!form) return false;

  if (_editing.entryId) {
    const idx = (data.entries || []).findIndex(e => e.id === _editing.entryId);
    if (idx === -1) { _editing = null; return false; }
    const prev = data.entries[idx];
    data.entries[idx] = {
      ...prev,
      name:        form.name || _defaultName(form.currency),
      currency:    form.currency,
      balance:     form.amount,
      currentValue: null,
      updatedAt:   todayISO(),
    };
  } else {
    data.entries.push(_buildNewEntry(form));
  }

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Remove ────────────────────────────────────────────────────

// Inline Remove button — wired in _wireForm. Sets _editing back to
// null after dropping the entry so the save handler doesn't also fire.
function _removeCurrent() {
  if (!_editing || !_editing.entryId) return;
  const data = getAppData();
  const idx = (data.entries || []).findIndex(e => e.id === _editing.entryId);
  if (idx === -1) return;
  data.entries.splice(idx, 1);
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form ──────────────────────────────────────────────────────

function _renderForm(entry, data) {
  const isNew    = !entry;
  const amount   = entry ? (entry.balance ?? '') : '';
  const currency = entry ? (entry.currency || 'ILS') : 'USD';
  const name     = entry ? (entry.name || '') : '';

  const options = CASH_CURRENCIES.map(c =>
    `<option value="${c}" ${c === currency ? 'selected' : ''}>${_currencyOptionLabel(c)}</option>`
  ).join('');

  // Initial ILS preview — refreshed on every input via _wireForm.
  const previewHtml = _previewLine(amount, currency, data);

  return `
    <form class="edit-cash-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cash-amount">${t('editCash.amount')}</label>
          <input class="form-input" id="f-cash-amount" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${amount}"
                 placeholder="${t('editCash.amountPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cash-currency">${t('editCash.currency')}</label>
          <select class="form-select" id="f-cash-currency">${options}</select>
        </div>
      </div>

      <div class="edit-cash-preview" id="f-cash-preview" aria-live="polite">
        ${previewHtml}
      </div>

      <div class="form-group">
        <label class="form-label" for="f-cash-name">${t('editCash.name')}</label>
        <input class="form-input" id="f-cash-name" type="text"
               value="${_esc(name)}"
               placeholder="${_esc(_defaultName(currency))}" />
        <small class="form-hint">${t('editCash.nameHint')}</small>
      </div>

      <p id="f-cash-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-cash-remove">${t('editCash.remove')}</button>` : ''}
    </form>
  `;
}

function _wireForm(data) {
  const amount   = document.getElementById('f-cash-amount');
  const currency = document.getElementById('f-cash-currency');
  const name     = document.getElementById('f-cash-name');
  const preview  = document.getElementById('f-cash-preview');
  const remove   = document.getElementById('f-cash-remove');

  const refresh = () => {
    const a = parseFloat(amount?.value);
    const c = currency?.value || 'ILS';
    if (preview) preview.innerHTML = _previewLine(Number.isFinite(a) ? a : '', c, getAppData());
    if (name && !name.value) name.placeholder = _defaultName(c);
  };

  amount?.addEventListener('input',  refresh);
  currency?.addEventListener('change', refresh);
  remove?.addEventListener('click', _removeCurrent);
}

// "≈ ₪1,110 at 3.70 ₪ per $" — shown beneath the amount. ILS amounts
// get a quieter "same currency" line so the slot doesn't disappear
// (form jumpiness) but doesn't pretend a conversion is happening.
function _previewLine(amount, currency, data) {
  if (amount === '' || !Number.isFinite(amount)) {
    return `<span class="edit-cash-preview-empty">${t('editCash.previewEmpty')}</span>`;
  }
  if (!currency || currency === 'ILS') {
    return `<span class="edit-cash-preview-native">${t('editCash.sameCurrency')}</span>`;
  }
  const ils = convertToILS(amount, currency, data);
  if (ils == null) {
    return `<span class="edit-cash-preview-empty">${t('editCash.noRate').replace('{currency}', currency)}</span>`;
  }
  return `
    <span class="edit-cash-preview-native">${_esc(formatForeignAmount(amount, currency))}</span>
    <span class="edit-cash-preview-arrow" aria-hidden="true">≈</span>
    <span class="edit-cash-preview-ils">${_esc(formatCurrency(ils))}</span>
  `;
}

function _readForm() {
  const errorEl = document.getElementById('f-cash-error');
  const amount   = parseFloat(document.getElementById('f-cash-amount')?.value);
  const currency = document.getElementById('f-cash-currency')?.value || '';
  const name     = (document.getElementById('f-cash-name')?.value || '').trim();

  if (!Number.isFinite(amount) || amount < 0) {
    if (errorEl) { errorEl.textContent = t('editCash.invalidAmount'); errorEl.style.display = 'block'; }
    document.getElementById('f-cash-amount')?.focus();
    return null;
  }
  if (!CASH_CURRENCIES.includes(currency)) {
    if (errorEl) { errorEl.textContent = t('editCash.invalidCurrency'); errorEl.style.display = 'block'; }
    document.getElementById('f-cash-currency')?.focus();
    return null;
  }
  return { amount, currency, name };
}

// ── Helpers ──────────────────────────────────────────────────

function _buildNewEntry(form) {
  return {
    id:           generateId('cash'),
    name:         form.name || _defaultName(form.currency),
    institution:  null,
    bankId:        null,
    type:         'cash',
    category:     'liquid',
    tier:         'available',
    balance:       form.amount,
    currentValue: null,
    currency:     form.currency,
    isCash:        true,
    isActive:      true,
    isLiability:   false,
    updatedAt:    todayISO(),
  };
}

function _defaultName(currency) {
  if (!currency || currency === 'ILS') {
    return currentLang === 'he' ? 'מזומן' : 'Cash';
  }
  // "USD cash" / "מזומן USD" — currency codes are universal Latin,
  // so the same suffix works in both languages with no translation.
  return currentLang === 'he' ? `מזומן ${currency}` : `${currency} cash`;
}

function _currencyOptionLabel(code) {
  const native = currentLang === 'he' ? _CURRENCY_HE[code] : _CURRENCY_EN[code];
  return native ? `${code} — ${native}` : code;
}

// Friendly names for the dropdown — kept here (not in i18n.js) since
// the list is tied to CASH_CURRENCIES and only used in this modal.
const _CURRENCY_EN = {
  ILS: 'Israeli Shekel', USD: 'US Dollar',  EUR: 'Euro', GBP: 'British Pound',
  JPY: 'Japanese Yen',   KRW: 'Korean Won', THB: 'Thai Baht', CHF: 'Swiss Franc',
  CAD: 'Canadian Dollar', AUD: 'Australian Dollar', CNY: 'Chinese Yuan',
};
const _CURRENCY_HE = {
  ILS: 'שקל חדש',  USD: 'דולר אמריקאי', EUR: 'אירו',  GBP: 'לירה שטרלינג',
  JPY: 'יין יפני', KRW: 'וון קוריאני',   THB: 'באט תאי', CHF: 'פרנק שווייצרי',
  CAD: 'דולר קנדי', AUD: 'דולר אוסטרלי', CNY: 'יואן סיני',
};

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
