// ─────────────────────────────────────────────────────────────────
//  EDIT / ADD FUTURE DEPOSIT
//
//  Create / edit / delete a Future Deposits item — principal that's
//  already yours and lands on a known release date (e.g. a military
//  discharge deposit, a maturing term deposit). These are entries[]
//  with tier: 'future_deposits', so they're counted in the future-
//  deposits total and rendered in that section.
//
//  New deposits are created as type 'savings' + isLocked: true (which
//  gives the generic "unlocks on {date}" meta via _lockedSavingsMeta)
//  but pinned to tier 'future_deposits' — so they live ONLY in the
//  Future Deposits section (the Accounts page is tier 'available').
//  Editing spread-merges, so an existing deposit's type/tier/category
//  (e.g. the military one) survive untouched.
//
//  Source (bank / provider) is optional. The logo is chosen visually
//  from the logo library (logo-input.js) — never a typed path — and
//  wins over the source's logo for the row mark.
//
//  Tracking-only: nothing here moves money. Deleting a matured deposit
//  is the user's cue to add a matching income transaction.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getBank, getProvider, entryValue } from '../utils.js';
import { logoFieldHtml, wireLogoInputs } from './logo-input.js';
import { logoName } from '../config/logo-library.js';

// One of: null | { create: true } | { entryId }
let _editing = null;

// ── Public API ────────────────────────────────────────────────

export function openEditFutureDepositModal(entryId = null) {
  const data  = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (entryId && !entry) return;

  _editing = entry ? { entryId: entry.id } : { create: true };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = entry ? t('editFutureDeposit.title') : t('editFutureDeposit.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, entry);
  _wireForm();

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-fd-name')?.focus(), 50);
}

export function hasPendingFutureDepositEdit()   { return _editing !== null; }
export function clearPendingFutureDepositEdit() { _editing = null; }

export function applyPendingFutureDepositEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data     = getAppData();
  const isCreate = !!_editing.create;
  const now      = todayISO();
  const existing = isCreate ? null : (data.entries || []).find(e => e.id === _editing.entryId);
  if (!isCreate && !existing) { _editing = null; return false; }

  // The institution IS the chosen logo — one visual selection sets both
  // the row mark and the institution name (from the logo library). No
  // separate bank/provider link for future deposits, so clear those.
  const institution = form.logo ? (logoName(form.logo, currentLang) || null) : null;

  const fields = {
    name:          form.name,
    nameEn:        form.nameEn || null,
    bankId:        null,
    providerId:    null,
    institution,
    logo:          form.logo || null,
    maturityDate:  form.releaseDate || null,
    // A user-entered date is authoritative; only keep the "estimated"
    // flag when no date is given on an existing entry.
    maturityDateEstimated: form.releaseDate ? false : (existing ? (existing.maturityDateEstimated || false) : false),
    initialAmount: form.initialAmount,
    currentValue:  form.expectedFinal,
    balance:       null,            // entryValue() reads currentValue
    updatedAt:     now,
  };

  if (isCreate) {
    if (!Array.isArray(data.entries)) data.entries = [];
    data.entries.push({
      id:          generateId('deposit'),
      type:        'savings',
      isLocked:    true,
      category:    'non_liquid',
      tier:        'future_deposits',
      currency:    'ILS',
      isActive:    true,
      isLiability: false,
      createdAt:   now,
      ...fields,
    });
  } else {
    const idx = data.entries.findIndex(e => e.id === _editing.entryId);
    // Spread-merge: tier 'future_deposits', type, category, etc. are
    // preserved so the entry keeps rendering in the Future Deposits section.
    data.entries[idx] = { ...existing, ...fields };
  }

  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Inline delete (edit only). Confirms first; removes only the deposit entry.
function _removeCurrent() {
  if (!_editing || !_editing.entryId) return;
  if (!window.confirm(t('editFutureDeposit.deleteConfirm'))) return;

  const data = getAppData();
  const idx  = (data.entries || []).findIndex(e => e.id === _editing.entryId);
  if (idx === -1) return;
  data.entries.splice(idx, 1);
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form ──────────────────────────────────────────────────────

function _renderForm(data, entry) {
  const isNew    = !entry;
  const name     = entry ? (entry.name   || '') : '';
  const nameEn   = entry ? (entry.nameEn || '') : '';
  const release  = entry ? (entry.maturityDate || '') : '';
  const initial  = entry ? (entry.initialAmount ?? '') : '';
  const expVal   = entry ? entryValue(entry) : null;
  const expected = expVal == null ? '' : expVal;

  // Single institution choice = the visual logo+name picker. Prefill with
  // the entry's effective logo (its own, else a legacy provider/bank logo)
  // so editing shows the current institution selected.
  const provider = entry ? getProvider(data, entry.providerId) : null;
  const bank     = entry && entry.bankId ? getBank(data, entry.bankId) : null;
  const logo     = entry ? (entry.logo || (provider && provider.logo) || (bank && bank.logo) || '') : '';

  return `
    <form class="edit-future-deposit-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-fd-name">${t('editFutureDeposit.field.name')}</label>
          <input class="form-input" id="f-fd-name" type="text"
                 value="${_esc(name)}" placeholder="${t('editFutureDeposit.namePlaceholder')}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-fd-nameEn">${t('editFutureDeposit.field.nameEn')}</label>
          <input class="form-input" id="f-fd-nameEn" type="text" value="${_esc(nameEn)}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editFutureDeposit.field.institution')}</label>
        ${logoFieldHtml('f-fd-logo', logo)}
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-fd-deposit">${t('editFutureDeposit.field.depositAmount')}</label>
          <input class="form-input" id="f-fd-deposit" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${initial}" placeholder="${t('editFutureDeposit.depositPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-fd-expected">${t('editFutureDeposit.field.expectedFinal')}</label>
          <input class="form-input" id="f-fd-expected" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${expected}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-fd-release">${t('editFutureDeposit.field.releaseDate')}</label>
        <input class="form-input" id="f-fd-release" type="date" value="${release}" />
      </div>

      <p id="f-fd-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-fd-remove">${t('editFutureDeposit.remove')}</button>` : ''}
    </form>
  `;
}

function _wireForm() {
  wireLogoInputs(document.getElementById('modal-body') || document);
  document.getElementById('f-fd-remove')?.addEventListener('click', _removeCurrent);
}

function _readForm() {
  const errorEl = document.getElementById('f-fd-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const name        = (document.getElementById('f-fd-name')?.value || '').trim();
  const nameEn      = (document.getElementById('f-fd-nameEn')?.value || '').trim();
  const releaseDate = document.getElementById('f-fd-release')?.value || '';
  const logo        = document.getElementById('f-fd-logo')?.value || '';
  const depRaw      = document.getElementById('f-fd-deposit')?.value;
  const expRaw      = document.getElementById('f-fd-expected')?.value;

  const initialAmount = depRaw === '' || depRaw == null ? null : parseFloat(depRaw);
  const expectedFinal = parseFloat(expRaw);

  if (!name && !nameEn) { showErr(t('editFutureDeposit.invalidName'), 'f-fd-name'); return null; }
  if (!Number.isFinite(expectedFinal) || expectedFinal < 0) {
    showErr(t('editFutureDeposit.invalidExpected'), 'f-fd-expected'); return null;
  }
  if (initialAmount != null && (!Number.isFinite(initialAmount) || initialAmount < 0)) {
    showErr(t('editFutureDeposit.invalidDeposit'), 'f-fd-deposit'); return null;
  }

  return { name: name || nameEn, nameEn, releaseDate, logo, initialAmount, expectedFinal };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
