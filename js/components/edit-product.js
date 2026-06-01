// ─────────────────────────────────────────────────────────────────
//  EDIT FUTURE-WEALTH PRODUCT
//
//  Full add / edit / delete for the long-term products in the Future
//  Wealth section: pension, investment provident fund
//  (investment_gemel), study / education fund (study_fund) and
//  provident fund. Each is a normal entries[] record with
//  tier: 'future_wealth' + category: 'non_liquid', so it flows through
//  every existing total / net-worth path unchanged.
//
//  All data is entered manually — this is a hand-maintained dashboard.
//  An optional monthly standing order is stored as a data.recurring[]
//  row linked by toEntryId (surfaced as a sentence by asset-meta.js);
//  nothing here auto-executes a transfer.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getBanks } from '../utils.js';

// One of: null | { create: true } | { entryId }
let _editing = null;

// The four product types this editor manages.
const PRODUCT_TYPES = ['pension', 'investment_gemel', 'study_fund', 'provident_fund'];

// Company logos already present in assets/logos/. Selecting one stores
// its path on entry.logo; the Future / Assets logo resolvers honor it.
const LOGO_CHOICES = [
  { path: 'assets/logos/harel_logo.png',           he: 'הראל',          en: 'Harel' },
  { path: 'assets/logos/menora_logo.png',          he: 'מנורה מבטחים',  en: 'Menora' },
  { path: 'assets/logos/altshuler_logo.png',       he: 'אלטשולר שחם',   en: 'Altshuler' },
  { path: 'assets/logos/migdal_logo.png',          he: 'מגדל',          en: 'Migdal' },
  { path: 'assets/logos/fnx_logo.png',             he: 'הפניקס',        en: 'Phoenix' },
  { path: 'assets/logos/meitav_logo.jpeg',         he: 'מיטב',          en: 'Meitav' },
  { path: 'assets/logos/mizrahi_tefahot_logo.png', he: 'מזרחי טפחות',   en: 'Mizrahi Tefahot' },
  { path: 'assets/logos/yl_lapidot_logo.png',      he: 'ילין לפידות',   en: 'Yelin Lapidot' },
  { path: 'assets/logos/ibi_logo.svg.png',         he: 'IBI',           en: 'IBI' },
  { path: 'assets/logos/discount_bank_logo.jpg',   he: 'דיסקונט',       en: 'Discount' },
  { path: 'assets/logos/hapoalim.jpg',             he: 'הפועלים',       en: 'Hapoalim' },
  { path: 'assets/logos/habenleumi.jpg',           he: 'הבינלאומי',     en: 'Beinleumi' },
  { path: 'assets/logos/family.png',               he: 'משפחתי',        en: 'Family' },
  { path: 'assets/logos/idf.jpg',                  he: 'צה״ל',          en: 'IDF' },
];

function _logoLabel(choice) {
  return currentLang === 'he' ? choice.he : choice.en;
}

// ── Public API ────────────────────────────────────────────────

export function openEditProductModal(entryId = null) {
  const data  = getAppData();
  const entry = entryId ? (data.entries || []).find(e => e.id === entryId) : null;
  if (entryId && !entry) return;

  _editing = entry ? { entryId: entry.id } : { create: true };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = entry ? t('editProduct.titleEdit') : t('editProduct.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(data, entry);
  _wireForm();

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-pr-name')?.focus(), 50);
}

export function hasPendingProductEdit()   { return _editing !== null; }
export function clearPendingProductEdit() { _editing = null; }

export function applyPendingProductEdit() {
  if (!_editing) return false;

  const form = _readForm();
  if (!form) return false;

  const data     = getAppData();
  const isCreate = !!_editing.create;
  const now      = todayISO();
  const id       = isCreate ? generateId('product') : _editing.entryId;

  const existing = isCreate ? null : (data.entries || []).find(e => e.id === id);
  if (!isCreate && !existing) return false;

  // Preserve per-track extras (nameEn, fee) from the matching existing
  // track row by index, so editing a bilingual pension doesn't drop them.
  const prevTracks = (existing && Array.isArray(existing.tracks)) ? existing.tracks : [];
  const tracks = form.tracks.map((tr, i) => {
    const prev = prevTracks[i] || {};
    const merged = { ...prev, name: tr.name, value: tr.value };
    if (tr.value == null) delete merged.value;
    return merged;
  });

  // Description is bilingual; edit the current-language side, keep the other.
  const prevDesc = (existing && existing.description && typeof existing.description === 'object')
    ? existing.description : {};
  const description = form.description
    ? { ...prevDesc, [currentLang]: form.description }
    : null;

  const fields = {
    type:         form.type,
    name:         form.name,
    nameEn:       form.nameEn || null,
    institution:  form.institution || null,
    logo:         form.logo || null,
    category:     'non_liquid',
    tier:         'future_wealth',
    balance:      null,
    invested:     null,
    currentValue: form.total,
    tracks,
    maturityDate: form.maturityDate || null,
    description,
    currency:     'ILS',
    updatedAt:    now,
  };

  if (isCreate) {
    if (!Array.isArray(data.entries)) data.entries = [];
    data.entries.push({
      id, providerId: null, bankId: null, portfolioId: null,
      isActive: true, isLiability: false, createdAt: now, ...fields,
    });
  } else {
    const idx = data.entries.findIndex(e => e.id === id);
    data.entries[idx] = { ...existing, ...fields };
  }

  _syncStandingOrder(data, id, form);

  data.meta.lastUpdated = now;
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// Upsert / remove the monthly standing order linked to this product.
// Clearing the amount deletes any existing one.
function _syncStandingOrder(data, entryId, form) {
  if (!Array.isArray(data.recurring)) data.recurring = [];
  const idx = data.recurring.findIndex(r => r && r.toEntryId === entryId);

  if (form.soAmount != null && form.soAmount > 0 && form.soBankId) {
    const base = {
      name:      form.name,
      nameEn:    form.nameEn || null,
      amount:    form.soAmount,
      cycle:     'monthly',
      fromBankId: form.soBankId,
      toEntryId:  entryId,
      type:      'investment_contribution',
      currency:  'ILS',
      isActive:   true,
    };
    if (idx === -1) data.recurring.push({ id: generateId('rec'), ...base });
    else            data.recurring[idx] = { ...data.recurring[idx], ...base };
  } else if (idx !== -1) {
    data.recurring.splice(idx, 1);
  }
}

// Inline delete from the editor — removes the product AND any standing
// order linked to it. The amounts are tracking-only, so nothing else
// needs reconciling.
function _removeCurrent() {
  if (!_editing || !_editing.entryId) return;
  if (!window.confirm(t('editProduct.deleteConfirm'))) return;

  const data = getAppData();
  const idx  = (data.entries || []).findIndex(e => e.id === _editing.entryId);
  if (idx === -1) return;
  data.entries.splice(idx, 1);
  if (Array.isArray(data.recurring)) {
    data.recurring = data.recurring.filter(r => !r || r.toEntryId !== _editing.entryId);
  }
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── Form rendering ────────────────────────────────────────────

function _renderForm(data, entry) {
  const isNew  = !entry;
  const type   = entry ? entry.type : 'pension';
  const name   = entry ? (entry.name   || '') : '';
  const nameEn = entry ? (entry.nameEn || '') : '';
  const inst   = entry ? (entry.institution || '') : '';
  const total  = entry ? (entry.currentValue ?? '') : '';
  const matur  = entry ? (entry.maturityDate || '') : '';
  const desc   = entry ? _descText(entry.description) : '';
  const selLogo = entry ? (entry.logo || '') : '';

  // Tracks: existing tracks[], or a single row built from a legacy
  // trackName, or one empty starter row.
  let tracks;
  if (entry && Array.isArray(entry.tracks) && entry.tracks.length) {
    tracks = entry.tracks.map(tr => ({
      name:  currentLang === 'he' ? (tr.name || tr.nameEn || '') : (tr.nameEn || tr.name || ''),
      value: tr.value ?? '',
    }));
  } else if (entry && entry.trackName) {
    tracks = [{ name: currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName), value: '' }];
  } else {
    tracks = [{ name: '', value: '' }];
  }

  // Standing order prefill from the linked recurring row, if any.
  const rec = entry ? (data.recurring || []).find(r => r && r.toEntryId === entry.id) : null;
  const soAmount = rec ? (rec.amount ?? '') : '';
  const soBank   = rec ? (rec.fromBankId || '') : '';

  const typeOpts = PRODUCT_TYPES.map(ty =>
    `<option value="${ty}" ${ty === type ? 'selected' : ''}>${t('type.' + ty)}</option>`
  ).join('');

  const bankOpts = [`<option value="">${t('editProduct.noBank')}</option>`]
    .concat(getBanks(data).map(b =>
      `<option value="${_esc(b.id)}" ${b.id === soBank ? 'selected' : ''}>${_esc(b.name || b.id)}</option>`))
    .join('');

  const logoChips = [`
    <button type="button" class="logo-chip ${selLogo ? '' : 'is-selected'}" data-logo=""
            title="${t('editProduct.noLogo')}">
      <span class="logo-chip-none">${t('editProduct.noLogo')}</span>
    </button>`]
    .concat(LOGO_CHOICES.map(c => `
      <button type="button" class="logo-chip ${c.path === selLogo ? 'is-selected' : ''}"
              data-logo="${_esc(c.path)}" title="${_esc(_logoLabel(c))}">
        <img class="logo-chip-img" src="${_esc(c.path)}" alt="${_esc(_logoLabel(c))}" />
      </button>`))
    .join('');

  const trackRows = tracks.map((tr, i) => _trackRowHtml(tr, i)).join('');

  return `
    <form class="edit-product-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-pr-type">${t('editProduct.field.type')}</label>
          <select class="form-select" id="f-pr-type">${typeOpts}</select>
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-pr-institution">${t('editProduct.field.company')}</label>
          <input class="form-input" id="f-pr-institution" type="text"
                 value="${_esc(inst)}" placeholder="${t('editProduct.companyPlaceholder')}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editProduct.field.logo')}</label>
        <div class="logo-gallery" id="f-pr-logos">${logoChips}</div>
      </div>

      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-pr-name">${t('editProduct.field.name')}</label>
          <input class="form-input" id="f-pr-name" type="text"
                 value="${_esc(name)}" placeholder="${t('editProduct.namePlaceholder')}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-pr-nameEn">${t('editProduct.field.nameEn')}</label>
          <input class="form-input" id="f-pr-nameEn" type="text" value="${_esc(nameEn)}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editProduct.field.tracks')}</label>
        <div id="f-pr-tracks">${trackRows}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="f-pr-trackAdd">
          + ${t('editProduct.addTrack')}
        </button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-pr-total">${t('editProduct.field.total')}</label>
          <input class="form-input" id="f-pr-total" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${total}" placeholder="${t('editProduct.totalPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-pr-maturity">${t('editProduct.field.maturity')}</label>
          <input class="form-input" id="f-pr-maturity" type="date" value="${matur}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-pr-soAmount">${t('editProduct.field.standingOrder')}</label>
          <input class="form-input" id="f-pr-soAmount" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${soAmount}" placeholder="${t('editProduct.standingOrderPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-pr-soBank">${t('editProduct.field.sourceBank')}</label>
          <select class="form-select" id="f-pr-soBank">${bankOpts}</select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-pr-desc">${t('editProduct.field.description')}</label>
        <textarea class="form-input" id="f-pr-desc" rows="2"
                  placeholder="${t('editProduct.descriptionPlaceholder')}">${_esc(desc)}</textarea>
      </div>

      <p id="f-pr-error" class="form-error" style="display:none"></p>

      ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm edit-cash-remove" id="f-pr-remove">${t('editProduct.remove')}</button>` : ''}
    </form>
  `;
}

function _trackRowHtml(track, idx) {
  return `
    <div class="edit-product-track-row" data-idx="${idx}">
      <input class="form-input" type="text" data-field="name"
             value="${_esc(track.name || '')}" placeholder="${t('editProduct.trackNamePlaceholder')}" />
      <input class="form-input" type="number" min="0" step="0.01" inputmode="decimal"
             data-field="value" value="${track.value === '' || track.value == null ? '' : track.value}"
             placeholder="${t('editProduct.trackAmountPlaceholder')}" />
      <button type="button" class="btn btn-ghost btn-sm" data-action="remove-track" aria-label="Remove">×</button>
    </div>
  `;
}

// ── Form wiring ───────────────────────────────────────────────

function _wireForm() {
  const list   = document.getElementById('f-pr-tracks');
  const addBtn = document.getElementById('f-pr-trackAdd');
  const logos  = document.getElementById('f-pr-logos');
  const inst   = document.getElementById('f-pr-institution');

  addBtn?.addEventListener('click', () => {
    const idx = list.querySelectorAll('.edit-product-track-row').length;
    list.insertAdjacentHTML('beforeend', _trackRowHtml({ name: '', value: '' }, idx));
  });

  list?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-track"]');
    if (!btn) return;
    const row = btn.closest('.edit-product-track-row');
    if (!row) return;
    if (list.querySelectorAll('.edit-product-track-row').length <= 1) {
      row.querySelectorAll('input').forEach(i => { i.value = ''; });
      return;
    }
    row.remove();
  });

  // Single-select logo gallery. Picking a logo also fills the company
  // name when it's still empty, as a convenience.
  logos?.addEventListener('click', (e) => {
    const chip = e.target.closest('.logo-chip');
    if (!chip) return;
    logos.querySelectorAll('.logo-chip').forEach(c => c.classList.remove('is-selected'));
    chip.classList.add('is-selected');
    const path = chip.getAttribute('data-logo');
    if (path && inst && !inst.value.trim()) {
      const match = LOGO_CHOICES.find(c => c.path === path);
      if (match) inst.value = _logoLabel(match);
    }
  });
}

function _readForm() {
  const errorEl = document.getElementById('f-pr-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const type        = document.getElementById('f-pr-type')?.value || 'pension';
  const name        = (document.getElementById('f-pr-name')?.value || '').trim();
  const nameEn      = (document.getElementById('f-pr-nameEn')?.value || '').trim();
  const institution = (document.getElementById('f-pr-institution')?.value || '').trim();
  const maturityDate = document.getElementById('f-pr-maturity')?.value || '';
  const description = (document.getElementById('f-pr-desc')?.value || '').trim();
  const totalRaw    = document.getElementById('f-pr-total')?.value;
  const soRaw       = document.getElementById('f-pr-soAmount')?.value;
  const soBankId    = document.getElementById('f-pr-soBank')?.value || '';

  const logoChip = document.querySelector('#f-pr-logos .logo-chip.is-selected');
  const logo     = logoChip ? (logoChip.getAttribute('data-logo') || '') : '';

  // Tracks — drop rows with no name; parse the amount if present.
  const tracks = [];
  document.querySelectorAll('#f-pr-tracks .edit-product-track-row').forEach(row => {
    const tn = (row.querySelector('[data-field="name"]')?.value || '').trim();
    const tvRaw = row.querySelector('[data-field="value"]')?.value;
    if (!tn && (tvRaw === '' || tvRaw == null)) return;
    const value = tvRaw === '' || tvRaw == null ? null : parseFloat(tvRaw);
    tracks.push({ name: tn, value: Number.isFinite(value) ? value : null });
  });

  if (!PRODUCT_TYPES.includes(type)) { showErr(t('editProduct.invalidType'), 'f-pr-type'); return null; }
  if (!name) { showErr(t('editProduct.invalidName'), 'f-pr-name'); return null; }

  // Total defaults to the sum of track amounts when left blank.
  const trackSum = tracks.reduce((s, tr) => s + (Number.isFinite(tr.value) ? tr.value : 0), 0);
  const total = totalRaw === '' || totalRaw == null ? trackSum : parseFloat(totalRaw);
  if (!Number.isFinite(total) || total < 0) { showErr(t('editProduct.invalidTotal'), 'f-pr-total'); return null; }

  const soAmount = soRaw === '' || soRaw == null ? null : parseFloat(soRaw);
  if (soAmount != null && (!Number.isFinite(soAmount) || soAmount < 0)) {
    showErr(t('editProduct.invalidStandingOrder'), 'f-pr-soAmount'); return null;
  }
  if (soAmount != null && soAmount > 0 && !soBankId) {
    showErr(t('editProduct.standingOrderNeedsBank'), 'f-pr-soBank'); return null;
  }

  return { type, name, nameEn, institution, logo, tracks, total, maturityDate, description, soAmount, soBankId };
}

function _descText(description) {
  if (!description) return '';
  if (typeof description === 'string') return description;
  return description[currentLang] || description.he || description.en || '';
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
