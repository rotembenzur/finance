// ─────────────────────────────────────────────────────────────────
//  EDIT / ADD STANDALONE INVESTMENT
//
//  Create / edit / delete an "השקעות נוספות" (Other Invested) item —
//  a manually-tracked investment held outside the IBI portfolio (e.g.
//  stocks at Bank Hapoalim, a self-managed fund, etc.). These are
//  entries[] with tier: 'invested' and portfolioId: null.
//
//  The logo picker doubles as the institution selector (same pattern
//  as Future Deposits). Name + current value are required; cost basis
//  is optional but enables gain/loss display on the row.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getProvider, getBank, entryValue } from '../utils.js';
import { logoFieldHtml, wireLogoInputs } from './logo-input.js';
import { logoName } from '../config/logo-library.js';

// One of: null | { create: true } | { entryId }
let _editing = null;

// ── Public API ────────────────────────────────────────────────

export function openEditStandaloneInvestmentModal(entryId = null) {
  const data  = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (entryId && !entry) return;

  _editing = entry ? { entryId: entry.id } : { create: true };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = entry ? t('editStandaloneInvest.titleEdit') : t('editStandaloneInvest.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, entry);
  _wireForm();

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-si-name')?.focus(), 50);
}

export function hasPendingStandaloneInvestmentEdit()   { return _editing !== null; }
export function clearPendingStandaloneInvestmentEdit() { _editing = null; }

export function applyPendingStandaloneInvestmentEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data     = getAppData();
  const isCreate = !!_editing.create;
  const now      = todayISO();
  const existing = isCreate ? null : (data.entries || []).find(e => e.id === _editing.entryId);
  if (!isCreate && !existing) { _editing = null; return false; }

  const institution = form.logo ? (logoName(form.logo, currentLang) || null) : null;

  const fields = {
    name:         form.name,
    nameEn:       form.nameEn || null,
    institution,
    logo:         form.logo || null,
    bankId:       null,
    providerId:   null,
    currentValue: form.currentValue,
    invested:     form.invested,
    balance:      null,
    updatedAt:    now,
  };

  if (isCreate) {
    if (!Array.isArray(data.entries)) data.entries = [];
    data.entries.push({
      id:          generateId('investment'),
      type:        'stock_portfolio',
      category:    'non_liquid',
      tier:        'invested',
      portfolioId: null,
      currency:    'ILS',
      isActive:    true,
      isLiability: false,
      createdAt:   now,
      ...fields,
    });
  } else {
    const idx = data.entries.findIndex(e => e.id === _editing.entryId);
    data.entries[idx] = { ...existing, ...fields };
  }

  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

function _removeCurrent() {
  if (!_editing || !_editing.entryId) return;
  if (!window.confirm(t('editStandaloneInvest.deleteConfirm'))) return;

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
  const isNew     = !entry;
  const name      = entry ? (entry.name   || '') : '';
  const nameEn    = entry ? (entry.nameEn || '') : '';
  const curVal    = entry ? (entryValue(entry) ?? '') : '';
  const investedV = entry ? (entry.invested  ?? '') : '';

  const provider = entry ? getProvider(data, entry.providerId) : null;
  const bank     = entry && entry.bankId ? getBank(data, entry.bankId) : null;
  const logo     = entry ? (entry.logo || (provider && provider.logo) || (bank && bank.logo) || '') : '';

  return `
    <form class="edit-standalone-invest-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-si-name">${t('editStandaloneInvest.field.name')}</label>
          <input class="form-input" id="f-si-name" type="text"
                 value="${_esc(name)}" placeholder="${t('editStandaloneInvest.namePlaceholder')}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-si-nameEn">${t('editStandaloneInvest.field.nameEn')}</label>
          <input class="form-input" id="f-si-nameEn" type="text" value="${_esc(nameEn)}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editStandaloneInvest.field.institution')}</label>
        ${logoFieldHtml('f-si-logo', logo)}
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-si-value">${t('editStandaloneInvest.field.currentValue')}</label>
          <input class="form-input" id="f-si-value" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${curVal}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-si-invested">${t('editStandaloneInvest.field.invested')}</label>
          <input class="form-input" id="f-si-invested" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${investedV}"
                 placeholder="${t('editStandaloneInvest.investedPlaceholder')}" />
        </div>
      </div>

      <p id="f-si-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-si-remove">${t('editStandaloneInvest.remove')}</button>` : ''}
    </form>
  `;
}

function _wireForm() {
  wireLogoInputs(document.getElementById('modal-body') || document);
  document.getElementById('f-si-remove')?.addEventListener('click', _removeCurrent);
}

function _readForm() {
  const errorEl = document.getElementById('f-si-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const name   = (document.getElementById('f-si-name')?.value   || '').trim();
  const nameEn = (document.getElementById('f-si-nameEn')?.value || '').trim();
  const logo   = document.getElementById('f-si-logo')?.value || '';
  const valRaw = document.getElementById('f-si-value')?.value;
  const invRaw = document.getElementById('f-si-invested')?.value;

  const currentValue = parseFloat(valRaw);
  const invested     = invRaw === '' || invRaw == null ? null : parseFloat(invRaw);

  if (!name && !nameEn) { showErr(t('editStandaloneInvest.invalidName'),     'f-si-name');  return null; }
  if (!Number.isFinite(currentValue) || currentValue < 0) {
    showErr(t('editStandaloneInvest.invalidValue'), 'f-si-value'); return null;
  }
  if (invested != null && (!Number.isFinite(invested) || invested < 0)) {
    showErr(t('editStandaloneInvest.invalidInvested'), 'f-si-invested'); return null;
  }

  return { name: name || nameEn, nameEn, logo, currentValue, invested };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
