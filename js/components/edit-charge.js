// ─────────────────────────────────────────────────────────────────
//  EDIT CHARGE — modal for enriching an imported credit-card charge
//
//  Fields the user can mutate:
//    · displayName          — overrides the imported merchant text
//    · categoryId           — one of EXPENSE_CATEGORIES
//    · subcategoryId        — must belong to the chosen category
//    · notes                — free text
//    · isRecurringMonthly   — boolean flag
//
//  Fields kept as immutable import metadata:
//    · merchant             — original from the statement
//    · date, amount, currency, originalAmount, etc.
//
//  Storage shape on charge:
//    { id, merchant, date, amount, ...importMeta,
//      displayName?, notes?, categoryId?, subcategoryId?,
//      isRecurringMonthly? }
//
//  The flow rides the existing modal-overlay shell. handleModalSave
//  in modal.js routes via hasPendingChargeEdit / applyPendingChargeEdit.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { EXPENSE_CATEGORIES, getCategoryById } from '../data/expense-categories.js';

let _editing = null;     // { cardId, chargeId }

// ── Public API ────────────────────────────────────────────────

export function openEditChargeModal(cardId, chargeId) {
  const card = _findCard(cardId);
  if (!card) return;
  const charge = (card.charges || []).find(c => c.id === chargeId);
  if (!charge) return;

  _editing = { cardId, chargeId };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editCharge.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(charge);
  _wireForm(charge);

  overlay.classList.add('open');

  // Focus the displayName field. Slight delay so the modal's open
  // transition doesn't steal focus back to the body.
  setTimeout(() => {
    document.getElementById('f-charge-name')?.focus();
  }, 50);
}

export function hasPendingChargeEdit()   { return _editing !== null; }
export function clearPendingChargeEdit() { _editing = null; }

export function applyPendingChargeEdit() {
  if (!_editing) return false;

  const { cardId, chargeId } = _editing;
  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === cardId);
  if (!card) { _editing = null; return false; }
  const idx  = (card.charges || []).findIndex(c => c.id === chargeId);
  if (idx === -1) { _editing = null; return false; }

  const form = _readForm();
  if (!form) return false;   // validation already surfaced inline

  // Merge user-owned fields onto the existing charge — imported
  // fields stay as the parser wrote them. Empty strings collapse to
  // null so re-importing doesn't surprise the parser's merge step.
  card.charges[idx] = {
    ...card.charges[idx],
    displayName:        form.displayName || null,
    categoryId:         form.categoryId  || null,
    subcategoryId:      form.subcategoryId || null,
    notes:              form.notes       || null,
    isRecurringMonthly: form.isRecurringMonthly,
  };
  card.updatedAt = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form rendering ───────────────────────────────────────────

function _renderForm(charge) {
  const categoryOptions = EXPENSE_CATEGORIES.map(cat => `
    <option value="${cat.id}" ${charge.categoryId === cat.id ? 'selected' : ''}>
      ${cat.emoji} ${cat.name[currentLang] || cat.name.en}
    </option>
  `).join('');

  const subcategoryOptions = _renderSubcategoryOptions(charge.categoryId, charge.subcategoryId);

  return `
    <form class="edit-charge-form" id="f-charge-form" onsubmit="event.preventDefault()">

      <div class="edit-charge-original">
        <span class="edit-charge-original-label">${t('editCharge.original')}</span>
        <span class="edit-charge-original-value">${_esc(charge.merchant || '')}</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-charge-name">${t('editCharge.displayName')}</label>
        <input class="form-input" id="f-charge-name" type="text"
               value="${_esc(charge.displayName || '')}"
               placeholder="${_esc(charge.merchant || '')}" />
        <small class="form-hint">${t('editCharge.displayNameHint')}</small>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-charge-category">${t('editCharge.category')}</label>
          <select class="form-select" id="f-charge-category">
            <option value="">${t('editCharge.noCategory')}</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-charge-subcategory">${t('editCharge.subcategory')}</label>
          <select class="form-select" id="f-charge-subcategory" ${!charge.categoryId ? 'disabled' : ''}>
            ${subcategoryOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-charge-notes">${t('editCharge.notes')}</label>
        <textarea class="form-input edit-charge-notes" id="f-charge-notes" rows="3"
                  placeholder="${t('editCharge.notesPlaceholder')}">${_esc(charge.notes || '')}</textarea>
      </div>

      <label class="edit-charge-recurring">
        <input type="checkbox" id="f-charge-recurring" ${charge.isRecurringMonthly ? 'checked' : ''} />
        <span class="edit-charge-recurring-text">
          <span class="edit-charge-recurring-label">${t('editCharge.recurring')}</span>
          <span class="edit-charge-recurring-hint">${t('editCharge.recurringHint')}</span>
        </span>
      </label>

      <p id="f-charge-error" class="form-error" style="display:none"></p>
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

// Repopulate the subcategory select whenever the category changes.
function _wireForm(charge) {
  const catEl = document.getElementById('f-charge-category');
  const subEl = document.getElementById('f-charge-subcategory');
  if (!catEl || !subEl) return;

  catEl.addEventListener('change', () => {
    const catId = catEl.value || null;
    subEl.disabled = !catId;
    // When switching category, the previous subcategory no longer
    // applies — drop it unless the new category happens to contain
    // the same id (it shouldn't, but the data layer doesn't enforce
    // uniqueness across categories, so be defensive).
    subEl.innerHTML = _renderSubcategoryOptions(catId, null);
  });
}

// ── Form reading + validation ────────────────────────────────

function _readForm() {
  const displayName     = (document.getElementById('f-charge-name')?.value || '').trim();
  const categoryId      = document.getElementById('f-charge-category')?.value || null;
  const subcategoryId   = document.getElementById('f-charge-subcategory')?.value || null;
  const notes           = (document.getElementById('f-charge-notes')?.value || '').trim();
  const isRecurring     = !!document.getElementById('f-charge-recurring')?.checked;
  const errorEl         = document.getElementById('f-charge-error');

  // A subcategory without a category is invalid. The disabled state
  // on the select normally prevents this, but defend anyway.
  if (subcategoryId && !categoryId) {
    if (errorEl) {
      errorEl.textContent = t('editCharge.invalidSubcategory');
      errorEl.style.display = 'block';
    }
    return null;
  }

  return {
    displayName,
    categoryId,
    subcategoryId,
    notes,
    isRecurringMonthly: isRecurring,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function _findCard(cardId) {
  return (getAppData().cards || []).find(c => c.id === cardId);
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
