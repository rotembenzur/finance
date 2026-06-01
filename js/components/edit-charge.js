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
import { calcCardPendingCharges, isRefundCharge } from '../utils.js';
import { EXPENSE_CATEGORIES, getCategoryById } from '../data/expense-categories.js';
import { reimbInit, reimbSectionHtml, reimbWire, reimbCommit } from './reimbursement-section.js';

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

  reimbInit(charge);
  bodyEl.innerHTML = _renderForm(charge);
  _wireForm(charge);
  reimbWire(getAppData, chargeId);
  document.getElementById('f-charge-delete')?.addEventListener('click', _deleteCharge);

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
  // Reimbursement: write the {expected, from, method, links} block onto
  // the charge and (un)flag any linked incoming transactions.
  reimbCommit(data, card.charges[idx]);
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

  const refundBanner = isRefundCharge(charge)
    ? `<div class="edit-charge-refund-banner">↩ ${t('editCharge.refundNotice')}</div>`
    : '';

  return `
    <form class="edit-charge-form" id="f-charge-form" onsubmit="event.preventDefault()">

      ${refundBanner}

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

      ${reimbSectionHtml()}

      <p id="f-charge-error" class="form-error" style="display:none"></p>

      <button type="button" class="edit-modal-delete" id="f-charge-delete">${t('modal.delete')}</button>
    </form>
  `;
}

// ── Delete ───────────────────────────────────────────────────

// Remove a charge from the card. The outstanding figure recomputes
// from charges[] via calcCardPendingCharges. Imported charges are
// tombstoned so a statement re-import won't bring them back; manual
// quick-entries aren't re-imported, so they need no tombstone.
function _deleteCharge() {
  if (!_editing) return;
  if (!window.confirm(t('modal.confirmDelete'))) return;

  const { cardId, chargeId } = _editing;
  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === cardId);
  if (!card) { _close(); return; }
  const charges = card.charges || [];
  const idx = charges.findIndex(c => c.id === chargeId);
  if (idx === -1) { _close(); return; }

  const removed = charges[idx];
  charges.splice(idx, 1);
  card.charges = charges;
  // calcCardPendingCharges falls back to the stored currentSpending
  // when charges is empty, which would leave a stale value after the
  // last charge is deleted — so zero it explicitly in that case.
  card.currentSpending = charges.length ? calcCardPendingCharges(card) : 0;
  card.updatedAt = todayISO();

  if (removed.source !== 'manual') {
    const tomb = data.deletedChargeIds = data.deletedChargeIds || [];
    if (!tomb.includes(removed.id)) tomb.push(removed.id);
  }

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  _close();
}

function _close() {
  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
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
