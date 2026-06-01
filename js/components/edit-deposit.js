// ─────────────────────────────────────────────────────────────────
//  EDIT LOCKED SAVING / DEPOSIT
//
//  Add / edit / delete a locked savings or term-deposit record on
//  data.entries[]. A deposit is a normal entry with the discriminators
//  `type: 'savings'` + `isLocked: true`, so it flows through every
//  existing total / grouping path unchanged — it renders as the locked
//  row under its linked bank card (see _renderLockedRow in
//  pages/accounts.js) and its status line comes from _lockedSavingsMeta
//  in asset-meta.js.
//
//  Purely a tracking surface: nothing here moves money into the
//  checking account on maturity. Deleting a matured deposit is the
//  user's cue to manually add a matching income transaction.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getBanks, getBank, entryValue } from '../utils.js';

// One of: null | { create: true, presetBankId } | { entryId }
let _editing = null;

// ── Public API ────────────────────────────────────────────────

export function openEditDepositModal(entryId = null, presetBankId = null) {
  const data  = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (entryId && !entry) return;

  _editing = entry ? { entryId: entry.id } : { create: true, presetBankId };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = entry ? t('editDeposit.titleEdit') : t('editDeposit.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, entry, presetBankId);
  _wireForm();

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-dep-name')?.focus(), 50);
}

export function hasPendingDepositEdit()   { return _editing !== null; }
export function clearPendingDepositEdit() { _editing = null; }

export function applyPendingDepositEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data     = getAppData();
  const isCreate = !!_editing.create;
  const now      = todayISO();
  const bank     = getBank(data, form.bankId);

  // Fields the deposit form owns. On edit we spread-merge these onto
  // the existing entry so engine-managed fields (tier, category,
  // providerId, etc.) survive untouched.
  const fields = {
    name:          form.name,
    bankId:        form.bankId,
    institution:   bank ? bank.name : null,
    startDate:     form.startDate || null,
    maturityDate:  form.releaseDate,
    initialAmount: form.initialAmount,
    currentValue:  form.expectedFinal,
    balance:       null,            // entryValue() reads currentValue; keep one source of truth
    depositStatus: form.status || null,
    updatedAt:     now,
  };

  if (isCreate) {
    if (!Array.isArray(data.entries)) data.entries = [];
    data.entries.push({
      id:          generateId('deposit'),
      type:        'savings',
      isLocked:    true,
      category:    'liquid',
      tier:        'available',
      balance:     null,
      currency:    'ILS',
      isActive:    true,
      isLiability: false,
      createdAt:   now,
      ...fields,
    });
  } else {
    const idx = data.entries.findIndex(e => e.id === _editing.entryId);
    if (idx === -1) return false;
    // Preserve isLocked even if a legacy record lacked it, so the row
    // keeps rendering as a locked deposit after the first edit.
    data.entries[idx] = { ...data.entries[idx], isLocked: true, ...fields };
  }

  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Inline delete from the edit modal. Confirms via window.confirm — a
// destructive action deserves the extra click. Removes ONLY the
// deposit entry; the checking balance is intentionally left untouched.
function _removeCurrent() {
  if (!_editing || !_editing.entryId) return;
  if (!window.confirm(t('editDeposit.deleteConfirm'))) return;

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

// ── Form rendering ────────────────────────────────────────────

function _renderForm(data, entry, presetBankId) {
  const isNew    = !entry;
  const name     = entry ? (entry.name || '') : '';
  const bankId   = entry ? (entry.bankId || '') : (presetBankId || '');
  const start    = entry ? (entry.startDate || '') : '';
  const release  = entry ? (entry.maturityDate || '') : '';
  const initial  = entry ? (entry.initialAmount ?? '') : '';
  // Default from entryValue() so a legacy deposit whose amount lives in
  // `balance` (currentValue null) still pre-fills correctly.
  const expVal   = entry ? entryValue(entry) : null;
  const expected = expVal == null ? '' : expVal;
  const status   = entry ? (entry.depositStatus || '') : '';

  const bankOpts = getBanks(data).map(b =>
    `<option value="${_esc(b.id)}" ${b.id === bankId ? 'selected' : ''}>${_esc(b.name || b.id)}</option>`
  ).join('');

  return `
    <form class="edit-deposit-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-dep-name">${t('editDeposit.field.name')}</label>
          <input class="form-input" id="f-dep-name" type="text"
                 value="${_esc(name)}" placeholder="${t('editDeposit.namePlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-dep-bank">${t('editDeposit.field.bank')}</label>
          <select class="form-select" id="f-dep-bank">${bankOpts}</select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-dep-start">${t('editDeposit.field.startDate')}</label>
          <input class="form-input" id="f-dep-start" type="date" value="${start}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-dep-release">${t('editDeposit.field.releaseDate')}</label>
          <input class="form-input" id="f-dep-release" type="date" value="${release}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-dep-initial">${t('editDeposit.field.initialAmount')}</label>
          <input class="form-input" id="f-dep-initial" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${initial}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-dep-expected">${t('editDeposit.field.expectedFinal')}</label>
          <input class="form-input" id="f-dep-expected" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${expected}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-dep-status">${t('editDeposit.field.status')}</label>
        <textarea class="form-input" id="f-dep-status" rows="2"
                  placeholder="${t('editDeposit.statusPlaceholder')}">${_esc(status)}</textarea>
      </div>

      <p id="f-dep-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-dep-remove">${t('editDeposit.remove')}</button>` : ''}
    </form>
  `;
}

// ── Form wiring ───────────────────────────────────────────────

function _wireForm() {
  document.getElementById('f-dep-remove')?.addEventListener('click', _removeCurrent);
}

function _readForm() {
  const errorEl = document.getElementById('f-dep-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const name        = (document.getElementById('f-dep-name')?.value || '').trim();
  const bankId      = document.getElementById('f-dep-bank')?.value || '';
  const startDate   = document.getElementById('f-dep-start')?.value || '';
  const releaseDate = document.getElementById('f-dep-release')?.value || '';
  const initRaw     = document.getElementById('f-dep-initial')?.value;
  const expRaw      = document.getElementById('f-dep-expected')?.value;
  const status      = (document.getElementById('f-dep-status')?.value || '').trim();

  const initialAmount = initRaw === '' || initRaw == null ? null : parseFloat(initRaw);
  const expectedFinal = parseFloat(expRaw);

  if (!name) {
    showErr(t('editDeposit.invalidName'), 'f-dep-name');
    return null;
  }
  if (!bankId) {
    showErr(t('editDeposit.invalidBank'), 'f-dep-bank');
    return null;
  }
  if (!releaseDate) {
    showErr(t('editDeposit.invalidRelease'), 'f-dep-release');
    return null;
  }
  if (!Number.isFinite(expectedFinal) || expectedFinal < 0) {
    showErr(t('editDeposit.invalidExpected'), 'f-dep-expected');
    return null;
  }
  if (initialAmount != null && (!Number.isFinite(initialAmount) || initialAmount < 0)) {
    showErr(t('editDeposit.invalidInitial'), 'f-dep-initial');
    return null;
  }

  return { name, bankId, startDate, releaseDate, initialAmount, expectedFinal, status };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
