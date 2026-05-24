// ─────────────────────────────────────────────────────────────────
//  EDIT CASH CHARGE — modal for renaming / recategorizing a cash
//  wallet entry's transaction after it was saved.
//
//  Cash entries hold their own charges[] array (mirroring the card
//  schema). Each charge is either an expense (no direction, or
//  direction='out') or income (direction='in'). The user typed the
//  whole thing by hand in the quick-expense / quick-income flow, so
//  unlike imported card charges there's no immutable "original
//  merchant" to preserve — the name field edits `merchant` directly.
//
//  Editable fields:
//    · name            → charge.merchant (+ description for income,
//                        which stores both)
//    · expense charge  → categoryId + subcategoryId (EXPENSE_CATEGORIES)
//    · income charge   → incomeCategoryId (INCOME_CATEGORIES, no sub)
//
//  Amount/date stay put — they're not in scope here, and editing the
//  amount would mean re-reconciling the entry's running balance.
//
//  Rides the shared modal shell; modal.js routes the save through
//  hasPendingCashChargeEdit / applyPendingCashChargeEdit.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { EXPENSE_CATEGORIES, getCategoryById } from '../data/expense-categories.js';
import { INCOME_CATEGORIES } from '../data/income-categories.js';

let _editing = null;   // { entryId, chargeId }

// ── Public API ────────────────────────────────────────────────

export function openEditCashChargeModal(entryId, chargeId) {
  const entry = _findCashEntry(entryId);
  if (!entry) return;
  const charge = (entry.charges || []).find(c => c.id === chargeId);
  if (!charge) return;

  _editing = { entryId, chargeId };
  const income = charge.direction === 'in';

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = income ? t('editCashCharge.titleIncome') : t('editCashCharge.titleExpense');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className      = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(charge, income);
  _wireForm(income);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-cashcharge-name')?.focus(), 50);
}

export function hasPendingCashChargeEdit()   { return _editing !== null; }
export function clearPendingCashChargeEdit() { _editing = null; }

export function applyPendingCashChargeEdit() {
  if (!_editing) return false;

  const { entryId, chargeId } = _editing;
  const data  = getAppData();
  const entry = _findCashEntry(entryId, data);
  if (!entry) { _editing = null; return false; }
  const idx = (entry.charges || []).findIndex(c => c.id === chargeId);
  if (idx === -1) { _editing = null; return false; }

  const existing = entry.charges[idx];
  const income   = existing.direction === 'in';
  const form     = _readForm(income);
  if (!form) return false;   // validation surfaced inline

  const updated = { ...existing, merchant: form.name };
  if (income) {
    // Income records store the name in both merchant + description;
    // keep them in sync so every reader shows the edited name.
    updated.description     = form.name;
    updated.incomeCategoryId = form.incomeCategoryId || null;
  } else {
    updated.categoryId    = form.categoryId    || null;
    updated.subcategoryId = form.subcategoryId || null;
  }
  entry.charges[idx]    = updated;
  entry.updatedAt       = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form rendering ───────────────────────────────────────────

function _renderForm(charge, income) {
  const currentName = charge.merchant || charge.displayName || charge.description || '';

  const nameGroup = `
    <div class="form-group">
      <label class="form-label" for="f-cashcharge-name">${t('editCashCharge.name')}</label>
      <input class="form-input" id="f-cashcharge-name" type="text"
             value="${_esc(currentName)}"
             placeholder="${t('editCashCharge.namePlaceholder')}" />
    </div>
  `;

  if (income) {
    const categoryOptions = INCOME_CATEGORIES.map(cat => `
      <option value="${cat.id}" ${charge.incomeCategoryId === cat.id ? 'selected' : ''}>
        ${cat.emoji} ${cat.name[currentLang] || cat.name.en}
      </option>
    `).join('');

    return `
      <form class="edit-charge-form" id="f-cashcharge-form" onsubmit="event.preventDefault()">
        ${nameGroup}
        <div class="form-group">
          <label class="form-label" for="f-cashcharge-incomecat">${t('editCharge.category')}</label>
          <select class="form-select" id="f-cashcharge-incomecat">
            <option value="">${t('editCharge.noCategory')}</option>
            ${categoryOptions}
          </select>
        </div>
        <p id="f-cashcharge-error" class="form-error" style="display:none"></p>
      </form>
    `;
  }

  const categoryOptions = EXPENSE_CATEGORIES.map(cat => `
    <option value="${cat.id}" ${charge.categoryId === cat.id ? 'selected' : ''}>
      ${cat.emoji} ${cat.name[currentLang] || cat.name.en}
    </option>
  `).join('');
  const subcategoryOptions = _renderSubcategoryOptions(charge.categoryId, charge.subcategoryId);

  return `
    <form class="edit-charge-form" id="f-cashcharge-form" onsubmit="event.preventDefault()">
      ${nameGroup}
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cashcharge-category">${t('editCharge.category')}</label>
          <select class="form-select" id="f-cashcharge-category">
            <option value="">${t('editCharge.noCategory')}</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cashcharge-subcategory">${t('editCharge.subcategory')}</label>
          <select class="form-select" id="f-cashcharge-subcategory" ${!charge.categoryId ? 'disabled' : ''}>
            ${subcategoryOptions}
          </select>
        </div>
      </div>
      <p id="f-cashcharge-error" class="form-error" style="display:none"></p>
    </form>
  `;
}

function _renderSubcategoryOptions(categoryId, selectedId) {
  const cat = getCategoryById(categoryId);
  if (!cat) {
    return `<option value="">${t('editCharge.subcategoryPickFirst')}</option>`;
  }
  return [
    `<option value="">${t('editCharge.noSubcategory')}</option>`,
    ...cat.subcategories.map(sub => `
      <option value="${sub.id}" ${selectedId === sub.id ? 'selected' : ''}>
        ${sub.name[currentLang] || sub.name.en}
      </option>
    `),
  ].join('');
}

// Repopulate the subcategory select whenever the category changes
// (expense only — income has no subcategory dimension).
function _wireForm(income) {
  if (income) return;
  const catEl = document.getElementById('f-cashcharge-category');
  const subEl = document.getElementById('f-cashcharge-subcategory');
  if (!catEl || !subEl) return;

  catEl.addEventListener('change', () => {
    const catId = catEl.value || null;
    subEl.disabled = !catId;
    subEl.innerHTML = _renderSubcategoryOptions(catId, null);
  });
}

// ── Form reading + validation ────────────────────────────────

function _readForm(income) {
  const name    = (document.getElementById('f-cashcharge-name')?.value || '').trim();
  const errorEl = document.getElementById('f-cashcharge-error');

  if (!name) {
    if (errorEl) {
      errorEl.textContent   = t('editCashCharge.missingName');
      errorEl.style.display = 'block';
    }
    return null;
  }

  if (income) {
    return {
      name,
      incomeCategoryId: document.getElementById('f-cashcharge-incomecat')?.value || null,
    };
  }

  const categoryId    = document.getElementById('f-cashcharge-category')?.value    || null;
  const subcategoryId = document.getElementById('f-cashcharge-subcategory')?.value || null;
  if (subcategoryId && !categoryId) {
    if (errorEl) {
      errorEl.textContent   = t('editCharge.invalidSubcategory');
      errorEl.style.display = 'block';
    }
    return null;
  }
  return { name, categoryId, subcategoryId };
}

// ── Helpers ──────────────────────────────────────────────────

function _findCashEntry(entryId, data = getAppData()) {
  return (data.entries || []).find(e =>
    e.id === entryId && (e.type === 'cash' || e.isCash === true)
  );
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
