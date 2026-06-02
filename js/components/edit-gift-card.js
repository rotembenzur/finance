// ─────────────────────────────────────────────────────────────────
//  EDIT GIFT CARD / VOUCHER
//
//  Add or edit a voucher record on data.giftCards[]. Files are
//  uploaded via voucher-storage.js (Supabase Storage), and the
//  record stores only the storage path — short-lived signed URLs
//  are minted on view.
//
//  Multi-store: each voucher carries a stores[] array of
//  bilingual aliases {he, en}, used by the page's search index.
//  Single-store toggle just hides the extra rows.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { showToast } from './toast.js';
import {
  uploadAttachment, deleteAttachment, isStoragePath, VoucherStorageError,
} from '../voucher-storage.js';

// One of: null | { create: true } | { cardId }
let _editing = null;
// File staged by the user in the form; uploaded on save (or replaced).
let _pendingFile = null;
// Stores list maintained in DOM only; serialized on save.
// Currency list keeps parity with cash entries — uses CASH_CURRENCIES.
import { CASH_CURRENCIES } from '../fx.js';
import { getSetting } from '../config/settings.js';

// ── Public API ────────────────────────────────────────────────

export function openEditGiftCardModal(cardId = null) {
  const data = getAppData();
  const card = cardId ? (data.giftCards || []).find(c => c.id === cardId) : null;
  if (cardId && !card) return;

  _editing     = card ? { cardId: card.id } : { create: true };
  _pendingFile = null;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = card ? t('editVoucher.titleEdit') : t('editVoucher.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(card);
  _wireForm();

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-vc-title')?.focus(), 50);
}

export function hasPendingGiftCardEdit()   { return _editing !== null; }
export function clearPendingGiftCardEdit() { _editing = null; _pendingFile = null; }

// Save handler — async because a real file upload roundtrips. We
// signal "busy" by disabling the save button + showing a spinner-ish
// label; on storage failure we leave the modal open with a toast.
export async function applyPendingGiftCardEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data = getAppData();

  const isCreate = !!_editing.create;
  const cardId   = isCreate ? generateId('voucher') : _editing.cardId;

  // Upload first (if a new file was staged). On failure: leave the
  // modal open, surface the error, and let the user retry or cancel.
  let attachment = null;
  const existing = !isCreate ? (data.giftCards || []).find(c => c.id === cardId) : null;
  if (_pendingFile) {
    _setBusy(true);
    try {
      const ref = await uploadAttachment(cardId, _pendingFile);
      attachment = {
        ref,
        mime:      _pendingFile.type || null,
        sizeBytes: _pendingFile.size || null,
        name:      _pendingFile.name || null,
        addedAt:   todayISO(),
      };
      // Replacing? Best-effort delete of the old file.
      if (existing && existing.attachment && isStoragePath(existing.attachment.ref)) {
        deleteAttachment(existing.attachment.ref);
      }
    } catch (err) {
      _setBusy(false);
      const msg = err instanceof VoucherStorageError
        ? err.message
        : t('editVoucher.uploadFailed');
      showToast({ tone: 'error', message: msg });
      console.error('[edit-voucher] upload failed', err);
      return false;
    }
    _setBusy(false);
  } else if (existing) {
    attachment = existing.attachment || null;
  }

  const now = todayISO();
  const record = {
    id:              cardId,
    title:           form.title,
    titleEn:         form.titleEn || null,
    originalAmount:  form.originalAmount,
    remainingAmount: form.remainingAmount,
    currency:        form.currency,
    stores:          form.stores,
    isSingleStore:   form.isSingleStore,
    expirationDate:  form.expirationDate || null,
    issueDate:       form.issueDate || null,
    code:            form.code || null,
    notes:           form.notes || null,
    attachment,
    createdAt:       existing && existing.createdAt ? existing.createdAt : now,
    updatedAt:       now,
  };

  if (!Array.isArray(data.giftCards)) data.giftCards = [];
  if (isCreate) {
    data.giftCards.push(record);
  } else {
    const idx = data.giftCards.findIndex(c => c.id === cardId);
    if (idx === -1) data.giftCards.push(record); else data.giftCards[idx] = record;
  }
  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  _pendingFile = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Inline delete from the edit modal. Removes the record AND its
// attachment file (best-effort). Confirms via window.confirm to
// keep the modal flow simple — a destructive action deserves the
// extra click, even though the gesture is plain.
async function _removeCurrent() {
  if (!_editing || !_editing.cardId) return;
  if (!window.confirm(t('vouchers.deleteConfirm'))) return;

  const data = getAppData();
  const idx = (data.giftCards || []).findIndex(c => c.id === _editing.cardId);
  if (idx === -1) return;
  const card = data.giftCards[idx];
  if (card && card.attachment && isStoragePath(card.attachment.ref)) {
    deleteAttachment(card.attachment.ref);
  }
  data.giftCards.splice(idx, 1);
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  _editing = null;
  _pendingFile = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form rendering ────────────────────────────────────────────

function _renderForm(card) {
  const isNew     = !card;
  const stores    = (card && Array.isArray(card.stores) && card.stores.length > 0)
    ? card.stores
    : [{ he: '', en: '' }];
  const currency  = card ? (card.currency || 'ILS') : (getSetting('defaultCurrency') || 'ILS');
  const isSingle  = card ? !!card.isSingleStore : false;
  const original  = card ? (card.originalAmount  ?? '') : '';
  const remaining = card ? (card.remainingAmount ?? '') : '';
  const title     = card ? (card.title   || '') : '';
  const titleEn   = card ? (card.titleEn || '') : '';
  const exp       = card ? (card.expirationDate || '') : '';
  const issue     = card ? (card.issueDate || '') : '';
  const code      = card ? (card.code  || '') : '';
  const notes     = card ? (card.notes || '') : '';
  const att       = card && card.attachment;

  const currencyOpts = CASH_CURRENCIES.map(c =>
    `<option value="${c}" ${c === currency ? 'selected' : ''}>${c}</option>`
  ).join('');

  const storeRows = stores.map((s, i) => _storeRowHtml(s, i)).join('');

  return `
    <form class="edit-voucher-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-vc-title">${t('vouchers.field.title')}</label>
          <input class="form-input" id="f-vc-title" type="text"
                 value="${_esc(title)}" placeholder="${t('editVoucher.titlePlaceholderHe')}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-vc-titleEn">${t('editVoucher.titleEn')}</label>
          <input class="form-input" id="f-vc-titleEn" type="text"
                 value="${_esc(titleEn)}" placeholder="${t('editVoucher.titlePlaceholderEn')}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-vc-original">${t('vouchers.field.original')}</label>
          <input class="form-input" id="f-vc-original" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${original}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-vc-remaining">${t('vouchers.field.remaining')}</label>
          <input class="form-input" id="f-vc-remaining" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${remaining}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-vc-currency">${t('vouchers.field.currency')}</label>
          <select class="form-select" id="f-vc-currency">${currencyOpts}</select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" id="f-vc-singleStore" ${isSingle ? 'checked' : ''} />
          <span>${t('vouchers.field.singleStore')}</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label">${t('vouchers.field.stores')}</label>
        <small class="form-hint">${t('vouchers.field.storesHint')}</small>
        <div id="f-vc-stores">${storeRows}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="f-vc-storeAdd">
          + ${t('editVoucher.addStore')}
        </button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-vc-exp">${t('vouchers.field.expiration')}</label>
          <input class="form-input" id="f-vc-exp" type="date" value="${exp}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-vc-issue">${t('vouchers.field.issueDate')}</label>
          <input class="form-input" id="f-vc-issue" type="date" value="${issue}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-vc-code">${t('vouchers.field.code')}</label>
        <input class="form-input" id="f-vc-code" type="text" value="${_esc(code)}" />
      </div>

      <div class="form-group">
        <label class="form-label" for="f-vc-notes">${t('vouchers.field.notes')}</label>
        <textarea class="form-input" id="f-vc-notes" rows="2">${_esc(notes)}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-vc-file">${t('vouchers.field.attachment')}</label>
        <input class="form-input" id="f-vc-file" type="file" accept="image/*,application/pdf" />
        <small class="form-hint">${t('vouchers.field.attachmentHint')}</small>
        <div id="f-vc-fileExisting" class="edit-voucher-file-existing">
          ${att ? `<span class="edit-voucher-file-name">${_esc(att.name || 'file')}</span>` : ''}
        </div>
      </div>

      <p id="f-vc-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-vc-remove">${t('editVoucher.remove')}</button>` : ''}
    </form>
  `;
}

function _storeRowHtml(store, idx) {
  return `
    <div class="edit-voucher-store-row" data-idx="${idx}">
      <input class="form-input" type="text"
             data-field="he"
             value="${_esc(store.he || '')}"
             placeholder="${t('editVoucher.storeHePlaceholder')}" />
      <input class="form-input" type="text"
             data-field="en"
             value="${_esc(store.en || '')}"
             placeholder="${t('editVoucher.storeEnPlaceholder')}" />
      <button type="button" class="btn btn-ghost btn-sm" data-action="remove-store" aria-label="Remove">×</button>
    </div>
  `;
}

// ── Form wiring ───────────────────────────────────────────────

function _wireForm() {
  const addBtn   = document.getElementById('f-vc-storeAdd');
  const list     = document.getElementById('f-vc-stores');
  const fileInp  = document.getElementById('f-vc-file');
  const removeBtn = document.getElementById('f-vc-remove');

  addBtn?.addEventListener('click', () => {
    const idx = list.querySelectorAll('.edit-voucher-store-row').length;
    list.insertAdjacentHTML('beforeend', _storeRowHtml({ he: '', en: '' }, idx));
  });

  list?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-store"]');
    if (!btn) return;
    const row = btn.closest('.edit-voucher-store-row');
    if (!row) return;
    if (list.querySelectorAll('.edit-voucher-store-row').length <= 1) {
      // Keep at least one row visible so the form never collapses.
      row.querySelectorAll('input').forEach(i => { i.value = ''; });
      return;
    }
    row.remove();
  });

  fileInp?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    _pendingFile = file || null;
    const existing = document.getElementById('f-vc-fileExisting');
    if (existing && file) {
      existing.innerHTML = `<span class="edit-voucher-file-name">${_esc(file.name)}</span>`;
    }
  });

  removeBtn?.addEventListener('click', _removeCurrent);
}

function _readForm() {
  const errorEl = document.getElementById('f-vc-error');
  const showErr = (msg) => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  };

  const title    = (document.getElementById('f-vc-title')?.value    || '').trim();
  const titleEn  = (document.getElementById('f-vc-titleEn')?.value  || '').trim();
  const original = parseFloat(document.getElementById('f-vc-original')?.value);
  const remVal   = document.getElementById('f-vc-remaining')?.value;
  const remaining = remVal === '' || remVal == null
    ? (Number.isFinite(original) ? original : NaN)
    : parseFloat(remVal);
  const currency = document.getElementById('f-vc-currency')?.value || 'ILS';
  const isSingleStore = !!document.getElementById('f-vc-singleStore')?.checked;
  const exp       = document.getElementById('f-vc-exp')?.value    || '';
  const issue     = document.getElementById('f-vc-issue')?.value  || '';
  const code      = (document.getElementById('f-vc-code')?.value  || '').trim();
  const notes     = (document.getElementById('f-vc-notes')?.value || '').trim();

  // Collect stores from the DOM. Drop entries where both he+en are empty.
  const storeRows = document.querySelectorAll('#f-vc-stores .edit-voucher-store-row');
  const stores = [];
  storeRows.forEach(row => {
    const he = (row.querySelector('[data-field="he"]')?.value || '').trim();
    const en = (row.querySelector('[data-field="en"]')?.value || '').trim();
    if (he || en) stores.push({ he: he || null, en: en || null });
  });

  if (!title && !titleEn) {
    showErr(t('editVoucher.invalidTitle'));
    document.getElementById('f-vc-title')?.focus();
    return null;
  }
  if (!Number.isFinite(original) || original < 0) {
    showErr(t('editVoucher.invalidAmount'));
    document.getElementById('f-vc-original')?.focus();
    return null;
  }
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > original) {
    showErr(t('editVoucher.invalidRemaining'));
    document.getElementById('f-vc-remaining')?.focus();
    return null;
  }
  if (!CASH_CURRENCIES.includes(currency)) {
    showErr(t('editVoucher.invalidCurrency'));
    return null;
  }
  if (stores.length === 0) {
    showErr(t('editVoucher.noStores'));
    return null;
  }

  return {
    title:           title || titleEn,
    titleEn:         titleEn || null,
    originalAmount:  original,
    remainingAmount: remaining,
    currency,
    stores,
    isSingleStore,
    expirationDate:  exp,
    issueDate:       issue,
    code,
    notes,
  };
}

function _setBusy(busy) {
  const saveBtn = document.getElementById('modal-save-btn');
  if (!saveBtn) return;
  saveBtn.disabled = busy;
  saveBtn.classList.toggle('is-busy', busy);
  saveBtn.textContent = busy ? t('editVoucher.uploading') : t('modal.save');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
