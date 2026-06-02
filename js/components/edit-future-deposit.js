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
import { getBanks, getBank, getBankDisplayName, getProvider, entryValue } from '../utils.js';
import { logoFieldHtml, wireLogoInputs } from './logo-input.js';

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

  // Resolve the source (provider OR bank OR none) → set one id, clear the
  // other, and derive institution for display fallbacks.
  let bankId = null, providerId = null, institution = null;
  if (form.source.startsWith('bank:')) {
    bankId = form.source.slice(5);
    const b = getBank(data, bankId);
    institution = b ? b.name : null;
  } else if (form.source.startsWith('provider:')) {
    providerId = form.source.slice(9);
    const p = getProvider(data, providerId);
    institution = p ? p.name : null;
  }

  const fields = {
    name:          form.name,
    nameEn:        form.nameEn || null,
    bankId,
    providerId,
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
  const logo     = entry ? (entry.logo || '') : '';
  const expVal   = entry ? entryValue(entry) : null;
  const expected = expVal == null ? '' : expVal;

  // Source dropdown: providers (incl. special, e.g. IDF) + banks + none.
  const sourceValue = entry && entry.bankId ? `bank:${entry.bankId}`
                    : entry && entry.providerId ? `provider:${entry.providerId}` : '';
  const providerOpts = (data.providers || []).map(p => {
    const v = `provider:${p.id}`;
    const label = currentLang === 'he' ? p.name : (p.nameEn || p.name);
    return `<option value="${_esc(v)}" ${v === sourceValue ? 'selected' : ''}>${_esc(label || p.id)}</option>`;
  });
  const bankOpts = getBanks(data).map(b => {
    const v = `bank:${b.id}`;
    return `<option value="${_esc(v)}" ${v === sourceValue ? 'selected' : ''}>${_esc(getBankDisplayName(b) || b.name || b.id)}</option>`;
  });
  const sourceOpts = [`<option value="">${t('editFutureDeposit.sourceNone')}</option>`]
    .concat(providerOpts).concat(bankOpts).join('');

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

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-fd-source">${t('editFutureDeposit.field.source')}</label>
          <select class="form-select" id="f-fd-source">${sourceOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-fd-release">${t('editFutureDeposit.field.releaseDate')}</label>
          <input class="form-input" id="f-fd-release" type="date" value="${release}" />
        </div>
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
        <label class="form-label">${t('editFutureDeposit.field.logo')}</label>
        ${logoFieldHtml('f-fd-logo', logo)}
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
  const source      = document.getElementById('f-fd-source')?.value || '';
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

  return { name: name || nameEn, nameEn, source, releaseDate, logo, initialAmount, expectedFinal };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
