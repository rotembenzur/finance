// ─────────────────────────────────────────────────────────────────
//  EDIT FUTURE DEPOSIT
//
//  Edit / delete a Future Deposits item — principal that's already
//  yours and lands on a known release date (e.g. the military discharge
//  deposit). These are entries[] with tier: 'future_deposits'.
//
//  Distinct from edit-deposit.js (locked bank savings, tier 'available',
//  bank-required): a future deposit's source can be a provider (IDF) OR
//  a bank OR neither, and it lives in its own dashboard section. Editing
//  spread-merges onto the existing entry so the tier / type / category
//  (and everything the engine manages) survive untouched.
//
//  Tracking-only: deleting a matured deposit is the user's cue to add a
//  matching income transaction; nothing here moves money.
//
//  Rides the shared modal shell; modal.js routes the save through
//  hasPendingFutureDepositEdit / applyPendingFutureDepositEdit.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { getBanks, getBank, getBankDisplayName, getProvider, entryValue } from '../utils.js';

let _editEntryId = null;

// ── Public API ────────────────────────────────────────────────

export function openEditFutureDepositModal(entryId) {
  const data  = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (!entry) return;

  _editEntryId = entry.id;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editFutureDeposit.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, entry);
  document.getElementById('f-fd-remove')?.addEventListener('click', _removeCurrent);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-fd-name')?.focus(), 50);
}

export function hasPendingFutureDepositEdit()   { return _editEntryId !== null; }
export function clearPendingFutureDepositEdit() { _editEntryId = null; }

export function applyPendingFutureDepositEdit() {
  if (!_editEntryId) return false;

  const form = _readForm();
  if (!form) return false;

  const data = getAppData();
  const idx  = (data.entries || []).findIndex(e => e.id === _editEntryId);
  if (idx === -1) { _editEntryId = null; return false; }
  const existing = data.entries[idx];

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

  // Spread-merge: tier 'future_deposits', type, category, etc. are
  // preserved so the entry keeps rendering in the Future Deposits section.
  data.entries[idx] = {
    ...existing,
    name:          form.name,
    nameEn:        form.nameEn || null,
    bankId,
    providerId,
    institution,
    maturityDate:  form.releaseDate || null,
    // A user-entered date is authoritative; only keep the "estimated"
    // flag when no date is given.
    maturityDateEstimated: form.releaseDate ? false : (existing.maturityDateEstimated || false),
    initialAmount: form.initialAmount,
    currentValue:  form.expectedFinal,
    balance:       null,            // entryValue() reads currentValue
    updatedAt:     todayISO(),
  };

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editEntryId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Inline delete. Confirms first; removes only the deposit entry.
function _removeCurrent() {
  if (!_editEntryId) return;
  if (!window.confirm(t('editFutureDeposit.deleteConfirm'))) return;

  const data = getAppData();
  const idx  = (data.entries || []).findIndex(e => e.id === _editEntryId);
  if (idx === -1) return;
  data.entries.splice(idx, 1);
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editEntryId = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form ──────────────────────────────────────────────────────

function _renderForm(data, entry) {
  const name     = entry.name   || '';
  const nameEn   = entry.nameEn || '';
  const release  = entry.maturityDate || '';
  const initial  = entry.initialAmount ?? '';
  const expVal   = entryValue(entry);
  const expected = expVal == null ? '' : expVal;

  // Source dropdown: providers (incl. special, e.g. IDF) + banks + none.
  const sourceValue = entry.bankId ? `bank:${entry.bankId}`
                    : entry.providerId ? `provider:${entry.providerId}` : '';
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

      <p id="f-fd-error" class="form-error" style="display:none"></p>

      <button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-fd-remove">${t('editFutureDeposit.remove')}</button>
    </form>
  `;
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

  return { name: name || nameEn, nameEn, source, releaseDate, initialAmount, expectedFinal };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
