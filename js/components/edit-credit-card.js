// ─────────────────────────────────────────────────────────────────
//  EDIT CREDIT / DEBIT CARD
//
//  Full add / edit / delete for the cards in data.cards[] — the same
//  registry the wallet renders from (js/pages/cards.js). Before this
//  editor, cards were data-only: the demo seeds in data/state.example.js
//  were the only way to define one. Now the user manages their own card
//  portfolio entirely through the UI, like Future-Wealth products
//  (edit-product.js) and vouchers (edit-gift-card.js).
//
//  Issuing company and payment network are SEPARATE axes (an Israeli
//  card is e.g. issued by Max but runs on the Visa network): the issuer
//  sets card.institution (+ card.issuerId for known clubs), while the
//  network sets card.network, which drives the on-card logo
//  (networkLogoHtml).
//
//  A custom card image uploads to Supabase Storage via
//  card-image-storage.js; the record stores only the storage path in
//  card.image and the wallet mints a short-lived signed URL on render.
//
//  Editing MERGES onto the existing card object ({...existing, ...fields})
//  so per-card data the editor doesn't own — charges[], currentSpending —
//  is preserved. currentSpending keeps its own contextual modal
//  (edit-card-spending.js); charges are owned by the import / quick-
//  expense flows.
//
//  Rides the shared modal shell; modal.js routes the save through
//  hasPendingCreditCardEdit / applyPendingCreditCardEdit. The save
//  handler is async because a real image upload roundtrips.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import {
  getBankAccountEntries, getBank, getBankDisplayName, nextBillingDateFromDay,
} from '../utils.js';
import { getList, getItem, label as configLabel, skinColor } from '../config/registry.js';
import { showToast } from './toast.js';
import {
  uploadCardImage, deleteCardImage, getCardImageURL, isStoragePath, CardImageError,
} from '../card-image-storage.js';

// One of: null | { create: true } | { cardId }
let _editing = null;
// Image staged by the user in the form; uploaded on save.
let _pendingImageFile = null;
// User asked to drop the existing image (no replacement).
let _removeImage = false;

// Card issuers (clubs) are admin-editable via the config registry
// ('cardIssuers'). Banks (data.banks) are appended at render time so a
// bank-issued card can name its bank as the issuer too.

// Payment networks that have an on-card logo (see networkLogoHtml).
const NETWORKS  = ['visa', 'mastercard', 'amex'];
const CARD_TYPES = ['bank', 'non_bank', 'international'];
// Card skins (colors) are admin-editable via the registry ('cardSkins').
const TIERS      = ['standard', 'gold'];

// ── Public API ────────────────────────────────────────────────

export function openEditCreditCardModal(cardId = null) {
  const data = getAppData();
  const card = cardId ? (data.cards || []).find(c => c.id === cardId) : null;
  if (cardId && !card) return;

  _editing          = card ? { cardId: card.id } : { create: true };
  _pendingImageFile = null;
  _removeImage      = false;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = card ? t('editCard.titleEdit') : t('editCard.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, card);
  _wireForm(card);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-cc-name')?.focus(), 50);
}

export function hasPendingCreditCardEdit()   { return _editing !== null; }
export function clearPendingCreditCardEdit() {
  _editing = null;
  _pendingImageFile = null;
  _removeImage = false;
}

// Save handler — async because a real image upload roundtrips. On
// storage failure we leave the modal open with a toast (mirrors
// edit-gift-card.js).
export async function applyPendingCreditCardEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data     = getAppData();
  const isCreate = !!_editing.create;
  const cardId   = isCreate ? generateId('card') : _editing.cardId;
  const existing = isCreate ? null : (data.cards || []).find(c => c.id === cardId);
  if (!isCreate && !existing) { _editing = null; return false; }

  // Resolve the image. Upload first (if a new file was staged); on
  // failure, leave the modal open and let the user retry or cancel.
  let image = existing ? (existing.image || null) : null;
  if (_pendingImageFile) {
    _setBusy(true);
    try {
      image = await uploadCardImage(cardId, _pendingImageFile);
      if (existing && existing.image && isStoragePath(existing.image)) {
        deleteCardImage(existing.image);   // best-effort
      }
    } catch (err) {
      _setBusy(false);
      const msg = err instanceof CardImageError ? err.message : t('editCard.uploadFailed');
      showToast({ tone: 'error', message: msg });
      console.error('[edit-credit-card] image upload failed', err);
      return false;
    }
    _setBusy(false);
  } else if (_removeImage) {
    if (existing && existing.image && isStoragePath(existing.image)) {
      deleteCardImage(existing.image);     // best-effort
    }
    image = null;
  }

  const now = todayISO();

  // Billing: nextBilling is derived from billingDay so the hero's
  // "next billing" and the billing-window calc stay consistent.
  const billingDay = form.isDebit ? null : form.billingDay;
  const nextBilling = (!form.isDebit && billingDay != null)
    ? nextBillingDateFromDay(billingDay)
    : null;

  const fields = {
    name:            form.name,
    nameEn:          form.nameEn || null,
    club:            form.club || null,
    network:         form.network || null,
    tier:            form.tier,
    cardType:        form.cardType,
    issuerId:        form.issuerId || null,
    institution:     form.institution || null,
    bankId:          form.bankId || null,
    last4:           form.last4,
    skin:            form.skin,
    expiry:          form.expiry || null,
    creditLimit:     form.isDebit ? null : form.creditLimit,
    billingDay,
    nextBilling,
    isDebit:         form.isDebit,
    fees:            form.fees,
    image,
    isActive:        true,
    updatedAt:       now,
  };

  if (isCreate) {
    if (!Array.isArray(data.cards)) data.cards = [];
    data.cards.push({ id: cardId, charges: [], ...fields });
  } else {
    const idx = data.cards.findIndex(c => c.id === cardId);
    // Spread-merge preserves charges[], currentSpending, createdAt, etc.
    data.cards[idx] = { ...existing, ...fields };
  }

  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  _pendingImageFile = null;
  _removeImage = false;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Inline delete from the editor. Removes the card AND its image
// (best-effort). Warns when the card carries imported/manual charges,
// since deleting the card drops them too.
function _removeCurrent() {
  if (!_editing || !_editing.cardId) return;
  const data = getAppData();
  const idx  = (data.cards || []).findIndex(c => c.id === _editing.cardId);
  if (idx === -1) return;
  const card = data.cards[idx];

  const chargeCount = Array.isArray(card.charges) ? card.charges.length : 0;
  const msg = chargeCount > 0
    ? t('editCard.deleteConfirmWithCharges').replace('{count}', String(chargeCount))
    : t('editCard.deleteConfirm');
  if (!window.confirm(msg)) return;

  if (card.image && isStoragePath(card.image)) deleteCardImage(card.image);
  data.cards.splice(idx, 1);
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  _pendingImageFile = null;
  _removeImage = false;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form rendering ────────────────────────────────────────────

function _renderForm(data, card) {
  const isNew  = !card;
  const name   = card ? (card.name   || '') : '';
  const nameEn = card ? (card.nameEn || '') : '';
  const club   = card ? (card.club   || '') : '';
  const last4  = card ? (card.last4  || '') : '';
  const network  = card ? (card.network  || '') : '';
  const cardType = card ? (card.cardType || 'non_bank') : 'non_bank';
  const tier     = card ? (card.tier || 'standard') : 'standard';
  const skin     = card ? (card.skin || 'black') : 'black';
  const isDebit  = card ? !!card.isDebit : false;
  const limit    = card && card.creditLimit != null ? card.creditLimit : '';
  const billingDay = card && card.billingDay != null ? card.billingDay : '';
  const expiryMonth = _expiryToMonthInput(card ? card.expiry : '');
  const issuerId    = card ? (card.issuerId || '') : '';
  const institution = card ? (card.institution || '') : '';

  // Issuer <select> value: a known club id, 'bank:<id>' for a bank, or
  // '__other__' when the stored institution matches no known issuer.
  // A known issuer resolves even if it was deactivated in admin
  // (getItem reads the raw list), so editing a card never loses it.
  const banks = (data.banks || []);
  let issuerValue = '';
  if (issuerId && getItem('cardIssuers', issuerId)) {
    issuerValue = issuerId;
  } else if (institution) {
    const bank = banks.find(b => b.name === institution || b.nameEn === institution);
    issuerValue = bank ? `bank:${bank.id}` : '__other__';
  }

  // Active issuers (ordered) for new cards; force-include the current
  // issuer if it's known but deactivated, so the selection stays valid.
  const issuerItems = getList('cardIssuers');
  if (issuerValue && issuerValue !== '__other__' && !issuerValue.startsWith('bank:')
      && !issuerItems.some(i => i.id === issuerValue)) {
    const cur = getItem('cardIssuers', issuerValue);
    if (cur) issuerItems.unshift(cur);
  }

  const issuerOpts = [`<option value="">${t('editCard.issuerNone')}</option>`]
    .concat(issuerItems.map(i => {
      const em = i.emoji ? i.emoji + ' ' : '';
      return `<option value="${_esc(i.id)}" ${i.id === issuerValue ? 'selected' : ''}>${em}${_esc(configLabel(i))}</option>`;
    }))
    .concat(banks.map(b => {
      const v = `bank:${b.id}`;
      return `<option value="${_esc(v)}" ${v === issuerValue ? 'selected' : ''}>${_esc(getBankDisplayName(b) || b.name || b.id)}</option>`;
    }))
    .concat(`<option value="__other__" ${issuerValue === '__other__' ? 'selected' : ''}>${t('editCard.issuerOther')}</option>`)
    .join('');

  const networkOpts = [`<option value="">${t('editCard.networkNone')}</option>`]
    .concat(NETWORKS.map(n =>
      `<option value="${n}" ${n === network ? 'selected' : ''}>${t('editCard.network.' + n)}</option>`))
    .join('');

  const typeOpts = CARD_TYPES.map(ct =>
    `<option value="${ct}" ${ct === cardType ? 'selected' : ''}>${t('cards.type.' + ct)}</option>`).join('');

  const tierOpts = TIERS.map(tr =>
    `<option value="${tr}" ${tr === tier ? 'selected' : ''}>${t('editCard.tier.' + tr)}</option>`).join('');

  const bankOpts = [`<option value="">${t('cardLink.none')}</option>`]
    .concat(_linkTargets(data).map(tg =>
      `<option value="${_esc(tg.bankId)}" ${card && card.bankId === tg.bankId ? 'selected' : ''}>${_esc(tg.label)}</option>`))
    .join('');

  // Skins come from the registry (active, ordered) so admin recolor /
  // rename / reorder / deactivate edits show here; the current card's
  // skin is force-included even if deactivated. A custom color renders
  // inline over the .credit-card--<id> CSS gradient.
  const skinItems = getList('cardSkins');
  if (skin && getItem('cardSkins', skin) && !skinItems.some(s => s.id === skin)) {
    skinItems.unshift(getItem('cardSkins', skin));
  }
  const skinSwatches = skinItems.map(s => {
    const sc = skinColor(s.id);
    const style = sc ? ` style="background:${sc}"` : '';
    const lbl = configLabel(s);
    return `<button type="button" class="cc-skin-swatch credit-card--${s.id} ${s.id === skin ? 'is-selected' : ''}"
            data-skin="${_esc(s.id)}"${style} aria-label="${_esc(lbl)}" title="${_esc(lbl)}"></button>`;
  }).join('');

  // Foreign fees: our model stores eur/usd/other equal, edited as one %.
  const txnFee  = _feeValue(card && card.fees && card.fees.foreignTxn);
  const cashFee = _feeValue(card && card.fees && card.fees.foreignCash);

  return `
    <form class="edit-card-form" onsubmit="event.preventDefault()">

      <div class="form-group">
        <label class="form-label">${t('editCard.field.image')}</label>
        <div class="cc-image-row">
          <div class="cc-image-preview" id="f-cc-imgPreview"></div>
          <div class="cc-image-controls">
            <input class="form-input" id="f-cc-image" type="file" accept="image/*" />
            <small class="form-hint">${t('editCard.field.imageHint')}</small>
            ${card && card.image ? `<button type="button" class="btn btn-ghost btn-sm" id="f-cc-imgRemove">${t('editCard.removeImage')}</button>` : ''}
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-cc-name">${t('editCard.field.name')}</label>
          <input class="form-input" id="f-cc-name" type="text"
                 value="${_esc(name)}" placeholder="${t('editCard.namePlaceholder')}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-cc-nameEn">${t('editCard.field.nameEn')}</label>
          <input class="form-input" id="f-cc-nameEn" type="text" value="${_esc(nameEn)}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-cc-issuer">${t('editCard.field.issuer')}</label>
          <select class="form-select" id="f-cc-issuer">${issuerOpts}</select>
        </div>
        <div class="form-group form-group--grow" id="f-cc-issuerOtherWrap" style="${issuerValue === '__other__' ? '' : 'display:none'}">
          <label class="form-label" for="f-cc-issuerOther">${t('editCard.field.issuerOtherLabel')}</label>
          <input class="form-input" id="f-cc-issuerOther" type="text"
                 value="${issuerValue === '__other__' ? _esc(institution) : ''}" placeholder="${t('editCard.issuerOtherPlaceholder')}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cc-network">${t('editCard.field.network')}</label>
          <select class="form-select" id="f-cc-network">${networkOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cc-last4">${t('editCard.field.last4')}</label>
          <input class="form-input" id="f-cc-last4" type="text" inputmode="numeric"
                 maxlength="4" value="${_esc(last4)}" placeholder="0000" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editCard.field.kind')}</label>
        <div class="cc-kind-toggle" id="f-cc-kind" role="radiogroup">
          <label><input type="radio" name="ccKind" value="credit" ${isDebit ? '' : 'checked'} /> ${t('editCard.kind.credit')}</label>
          <label><input type="radio" name="ccKind" value="debit"  ${isDebit ? 'checked' : ''} /> ${t('editCard.kind.debit')}</label>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cc-type">${t('editCard.field.cardType')}</label>
          <select class="form-select" id="f-cc-type">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cc-tier">${t('editCard.field.tier')}</label>
          <select class="form-select" id="f-cc-tier">${tierOpts}</select>
        </div>
      </div>

      <div class="cc-credit-only" id="f-cc-creditOnly" style="${isDebit ? 'display:none' : ''}">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="f-cc-limit">${t('editCard.field.creditLimit')}</label>
            <input class="form-input" id="f-cc-limit" type="number" min="0" step="0.01"
                   inputmode="decimal" value="${limit}" placeholder="${t('editCard.limitPlaceholder')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="f-cc-billingDay">${t('editCard.field.billingDay')}</label>
            <input class="form-input" id="f-cc-billingDay" type="number" min="1" max="31" step="1"
                   inputmode="numeric" value="${billingDay}" placeholder="${t('editCard.billingDayPlaceholder')}" />
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cc-expiry">${t('editCard.field.expiry')}</label>
          <input class="form-input" id="f-cc-expiry" type="month" value="${expiryMonth}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cc-bank">${t('editCard.field.linkedBank')}</label>
          <select class="form-select" id="f-cc-bank">${bankOpts}</select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-cc-feeTxn">${t('editCard.field.foreignTxn')}</label>
          <div class="input-with-symbol input-with-symbol--suffix">
            <input class="form-input" id="f-cc-feeTxn" type="number" min="0" step="0.01"
                   inputmode="decimal" value="${txnFee}" placeholder="0" />
            <span class="currency-symbol">%</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-cc-feeCash">${t('editCard.field.foreignCash')}</label>
          <div class="input-with-symbol input-with-symbol--suffix">
            <input class="form-input" id="f-cc-feeCash" type="number" min="0" step="0.01"
                   inputmode="decimal" value="${cashFee}" placeholder="0" />
            <span class="currency-symbol">%</span>
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-cc-club">${t('editCard.field.club')}</label>
          <input class="form-input" id="f-cc-club" type="text"
                 value="${_esc(club)}" placeholder="${t('editCard.clubPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label">${t('editCard.field.skin')}</label>
          <div class="cc-skin-swatches" id="f-cc-skin">${skinSwatches}</div>
        </div>
      </div>

      <p id="f-cc-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-cc-remove">${t('editCard.remove')}</button>` : ''}
    </form>
  `;
}

// ── Form wiring ───────────────────────────────────────────────

function _wireForm(card) {
  // Image: stage a new file, or resolve + show the existing one.
  const fileInp = document.getElementById('f-cc-image');
  fileInp?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    _pendingImageFile = file || null;
    _removeImage = false;
    if (file) _showImagePreview(URL.createObjectURL(file));
  });
  document.getElementById('f-cc-imgRemove')?.addEventListener('click', () => {
    _pendingImageFile = null;
    _removeImage = true;
    if (fileInp) fileInp.value = '';
    _showImagePreview(null);
  });
  if (card && card.image) {
    getCardImageURL(card.image).then(url => { if (url && !_pendingImageFile && !_removeImage) _showImagePreview(url); });
  }

  // Issuer "Other…" reveal.
  document.getElementById('f-cc-issuer')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('f-cc-issuerOtherWrap');
    if (wrap) wrap.style.display = e.target.value === '__other__' ? '' : 'none';
  });

  // Credit/debit kind toggles the limit + billing-day block.
  document.getElementById('f-cc-kind')?.addEventListener('change', (e) => {
    if (e.target.name !== 'ccKind') return;
    const block = document.getElementById('f-cc-creditOnly');
    if (block) block.style.display = e.target.value === 'debit' ? 'none' : '';
  });

  // Skin swatch single-select.
  document.getElementById('f-cc-skin')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cc-skin-swatch');
    if (!btn) return;
    document.querySelectorAll('#f-cc-skin .cc-skin-swatch').forEach(s => s.classList.remove('is-selected'));
    btn.classList.add('is-selected');
  });

  document.getElementById('f-cc-remove')?.addEventListener('click', _removeCurrent);
}

function _showImagePreview(url) {
  const host = document.getElementById('f-cc-imgPreview');
  if (!host) return;
  host.innerHTML = url
    ? `<img src="${_esc(url)}" alt="" />`
    : `<span class="cc-image-empty">${t('editCard.noImage')}</span>`;
}

// ── Read + validate ───────────────────────────────────────────

function _readForm() {
  const data    = getAppData();
  const errorEl = document.getElementById('f-cc-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const name   = (document.getElementById('f-cc-name')?.value   || '').trim();
  const nameEn = (document.getElementById('f-cc-nameEn')?.value || '').trim();
  const club   = (document.getElementById('f-cc-club')?.value   || '').trim();
  const last4Raw = (document.getElementById('f-cc-last4')?.value || '').trim();
  const network  = document.getElementById('f-cc-network')?.value || '';
  const cardType = document.getElementById('f-cc-type')?.value || 'non_bank';
  const tier     = document.getElementById('f-cc-tier')?.value || 'standard';
  const bankId   = document.getElementById('f-cc-bank')?.value || '';
  const isDebit  = (document.querySelector('#f-cc-kind input[name="ccKind"]:checked')?.value || 'credit') === 'debit';
  const skin     = document.querySelector('#f-cc-skin .cc-skin-swatch.is-selected')?.getAttribute('data-skin') || 'black';
  const expiry   = _monthInputToExpiry(document.getElementById('f-cc-expiry')?.value || '');

  // Issuer → institution + issuerId.
  const issuerSel = document.getElementById('f-cc-issuer')?.value || '';
  let issuerId = '';
  let institution = '';
  const issuerItem = issuerSel ? getItem('cardIssuers', issuerSel) : null;
  if (issuerItem) {
    issuerId = issuerSel;
    institution = configLabel(issuerItem);
  } else if (issuerSel.startsWith('bank:')) {
    const bank = getBank(data, issuerSel.slice(5));
    institution = bank ? (getBankDisplayName(bank) || bank.name || '') : '';
  } else if (issuerSel === '__other__') {
    institution = (document.getElementById('f-cc-issuerOther')?.value || '').trim();
  }

  if (!name && !nameEn) { showErr(t('editCard.invalidName'), 'f-cc-name'); return null; }
  if (!/^\d{4}$/.test(last4Raw)) { showErr(t('editCard.invalidLast4'), 'f-cc-last4'); return null; }

  let creditLimit = null;
  let billingDay  = null;
  if (!isDebit) {
    const limitRaw = document.getElementById('f-cc-limit')?.value;
    if (limitRaw !== '' && limitRaw != null) {
      const v = parseFloat(limitRaw);
      if (!Number.isFinite(v) || v < 0) { showErr(t('editCard.invalidLimit'), 'f-cc-limit'); return null; }
      creditLimit = v;
    }
    const dayRaw = document.getElementById('f-cc-billingDay')?.value;
    if (dayRaw !== '' && dayRaw != null) {
      const d = parseInt(dayRaw, 10);
      if (!Number.isFinite(d) || d < 1 || d > 31) { showErr(t('editCard.invalidBillingDay'), 'f-cc-billingDay'); return null; }
      billingDay = d;
    }
  }

  const txnFee  = _readFee(document.getElementById('f-cc-feeTxn')?.value);
  const cashFee = _readFee(document.getElementById('f-cc-feeCash')?.value);
  if (txnFee === false)  { showErr(t('editCard.invalidFee'), 'f-cc-feeTxn');  return null; }
  if (cashFee === false) { showErr(t('editCard.invalidFee'), 'f-cc-feeCash'); return null; }

  // Build fees only from provided sub-objects; undefined when neither set.
  let fees;
  if (txnFee != null || cashFee != null) {
    fees = {};
    if (txnFee  != null) fees.foreignTxn  = { eur: txnFee,  usd: txnFee,  other: txnFee };
    if (cashFee != null) fees.foreignCash = { eur: cashFee, usd: cashFee, other: cashFee };
  } else {
    fees = undefined;
  }

  return {
    name, nameEn, club, network, cardType, tier, skin, isDebit,
    last4: last4Raw, expiry, creditLimit, billingDay,
    issuerId, institution, bankId, fees,
  };
}

// ── Helpers ───────────────────────────────────────────────────

// Distinct banks with an active checking account — one option per bank
// (the pending-charge projection links by bankId). Mirrors the
// _linkTargets logic in edit-card-link.js.
function _linkTargets(data) {
  const checking = getBankAccountEntries(data)
    .filter(e => e.type === 'checking' && e.isActive !== false && e.bankId);
  const seen = new Set();
  const out = [];
  for (const acct of checking) {
    if (seen.has(acct.bankId)) continue;
    seen.add(acct.bankId);
    const bank     = getBank(data, acct.bankId);
    const bankName = bank ? getBankDisplayName(bank) : acct.bankId;
    const acctName = currentLang === 'he' ? (acct.name || '') : (acct.nameEn || acct.name || '');
    out.push({ bankId: acct.bankId, label: [bankName, acctName].filter(Boolean).join(' · ') });
  }
  return out;
}

// Representative % from a fee sub-object (eur/usd/other are stored equal
// in the single-field model). Empty string when no fee set.
function _feeValue(feeObj) {
  if (!feeObj) return '';
  const v = feeObj.usd ?? feeObj.eur ?? feeObj.other;
  return v == null ? '' : v;
}

// Parse a fee input: '' → null (omit), a finite ≥0 number → that number,
// anything else → false (invalid).
function _readFee(raw) {
  if (raw === '' || raw == null) return null;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0) return false;
  return v;
}

// 'MM/YYYY' (stored) → 'YYYY-MM' (for <input type=month>).
function _expiryToMonthInput(expiry) {
  if (!expiry) return '';
  const m = String(expiry).match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : '';
}

// 'YYYY-MM' (<input type=month>) → 'MM/YYYY' (stored).
function _monthInputToExpiry(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : '';
}

function _setBusy(busy) {
  const saveBtn = document.getElementById('modal-save-btn');
  if (!saveBtn) return;
  saveBtn.disabled = busy;
  saveBtn.classList.toggle('is-busy', busy);
  saveBtn.textContent = busy ? t('editCard.uploading') : t('modal.save');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
