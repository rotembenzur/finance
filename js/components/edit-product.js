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
//  Company + logo are a SINGLE source of truth: the user picks a
//  provider from data.providers[] (the registry), and both the company
//  name and the logo derive from it — no invalid name/logo pairs. New
//  providers can be added inline and persist to the registry.
//
//  Track allocation can be entered by amount OR by percentage; in
//  percent mode each track's ₪ amount is computed from the total and
//  recomputed whenever the total changes.
//
//  All data is entered manually. An optional monthly standing order is
//  stored as a data.recurring[] row linked by toEntryId; nothing here
//  auto-executes a transfer.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO, generateId } from '../store.js';
import { init } from '../app.js';
import { getBanks, getProvider, formatCurrency } from '../utils.js';
import { getList, getItem, label as configLabel } from '../config/registry.js';

// One of: null | { create: true } | { entryId }
let _editing = null;

// The four product types this editor manages.
const PRODUCT_TYPES = ['pension', 'investment_gemel', 'study_fund', 'provident_fund'];

// Financial providers only — special entities (family, IDF) are excluded.
function _financialProviders(data) {
  return (data.providers || []).filter(p => p && p.kind !== 'special');
}

function _providerLabel(p) {
  return (currentLang === 'he' ? p.name : (p.nameEn || p.name)) || p.id;
}

const _round  = n => Math.round((Number(n) || 0) * 100) / 100;

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

  // Provider is the single source of truth for company + logo.
  const provider = form.providerId ? getProvider(data, form.providerId) : null;

  // Preserve per-track extras (nameEn, fee) from the matching existing
  // track row by index, so editing a bilingual pension doesn't drop them.
  const prevTracks = (existing && Array.isArray(existing.tracks)) ? existing.tracks : [];
  const tracks = form.tracks.map((tr, i) => {
    const prev = prevTracks[i] || {};
    const merged = { ...prev, name: tr.name, value: tr.value };
    if (tr.value == null) delete merged.value;
    if (tr.pct != null) merged.pct = tr.pct; else delete merged.pct;
    return merged;
  });

  // Description is bilingual; edit the current-language side, keep the other.
  const prevDesc = (existing && existing.description && typeof existing.description === 'object')
    ? existing.description : {};
  const description = form.description
    ? { ...prevDesc, [currentLang]: form.description }
    : null;

  const fields = {
    type:           form.type,
    name:           form.name,
    nameEn:         form.nameEn || null,
    providerId:     form.providerId || null,
    institution:    provider ? provider.name : (existing ? existing.institution : null),
    logo:           null,            // derived from providerId by the logo resolvers
    category:       'non_liquid',
    tier:           'future_wealth',
    balance:        null,
    invested:       null,
    currentValue:   form.total,
    tracks,
    allocationMode: form.allocationMode,
    maturityDate:   form.maturityDate || null,
    description,
    currency:       'ILS',
    updatedAt:      now,
  };

  if (isCreate) {
    if (!Array.isArray(data.entries)) data.entries = [];
    data.entries.push({
      id, bankId: null, portfolioId: null,
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
  const total  = entry ? (entry.currentValue ?? '') : '';
  const matur  = entry ? (entry.maturityDate || '') : '';
  const desc   = entry ? _descText(entry.description) : '';
  const mode   = entry && entry.allocationMode === 'percent' ? 'percent' : 'amount';

  // Selected provider: explicit providerId, else infer from a stored
  // logo path (products created before the registry change).
  let selProviderId = entry ? (entry.providerId || '') : '';
  if (!selProviderId && entry && entry.logo) {
    const match = _financialProviders(data).find(p => p.logo === entry.logo);
    if (match) selProviderId = match.id;
  }

  // Tracks: existing tracks[], or a single row built from a legacy
  // trackName, or one empty starter row.
  let tracks;
  if (entry && Array.isArray(entry.tracks) && entry.tracks.length) {
    tracks = entry.tracks.map(tr => ({
      name:  currentLang === 'he' ? (tr.name || tr.nameEn || '') : (tr.nameEn || tr.name || ''),
      value: tr.value ?? '',
      pct:   tr.pct ?? '',
    }));
  } else if (entry && entry.trackName) {
    tracks = [{ name: currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName), value: '', pct: '' }];
  } else {
    tracks = [{ name: '', value: '', pct: '' }];
  }

  // Standing order prefill from the linked recurring row, if any.
  const rec = entry ? (data.recurring || []).find(r => r && r.toEntryId === entry.id) : null;
  const soAmount = rec ? (rec.amount ?? '') : '';
  const soBank   = rec ? (rec.fromBankId || '') : '';

  // Options come from the registry (active, ordered) so admin label /
  // emoji / order / active edits show here. The current entry's type is
  // force-included even if it was deactivated, so editing never drops it.
  const ptIds = getList('productTypes').map(it => it.id);
  if (type && !ptIds.includes(type)) ptIds.unshift(type);
  const typeOpts = ptIds.map(ty => {
    const it  = getItem('productTypes', ty);
    const lbl = it ? configLabel(it) : (t('type.' + ty) || ty);
    const em  = it && it.emoji ? it.emoji + ' ' : '';
    return `<option value="${ty}" ${ty === type ? 'selected' : ''}>${em}${lbl}</option>`;
  }).join('');

  const bankOpts = [`<option value="">${t('editProduct.noBank')}</option>`]
    .concat(getBanks(data).map(b =>
      `<option value="${_esc(b.id)}" ${b.id === soBank ? 'selected' : ''}>${_esc(b.name || b.id)}</option>`))
    .join('');

  const trackRows = tracks.map((tr, i) => _trackRowHtml(tr, i)).join('');

  return `
    <form class="edit-product-form" onsubmit="event.preventDefault()">

      <div class="form-group">
        <label class="form-label" for="f-pr-type">${t('editProduct.field.type')}</label>
        <select class="form-select" id="f-pr-type">${typeOpts}</select>
      </div>

      <div class="form-group">
        <label class="form-label">${t('editProduct.field.provider')}</label>
        <div class="provider-gallery" id="f-pr-providers">${_renderProviderChips(data, selProviderId)}</div>
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
        <div class="alloc-head">
          <label class="form-label">${t('editProduct.field.tracks')}</label>
          <div class="alloc-toggle" id="f-pr-allocMode" role="radiogroup">
            <label><input type="radio" name="allocMode" value="amount"  ${mode === 'amount'  ? 'checked' : ''} /> ${t('editProduct.byAmount')}</label>
            <label><input type="radio" name="allocMode" value="percent" ${mode === 'percent' ? 'checked' : ''} /> ${t('editProduct.byPercent')}</label>
          </div>
        </div>
        <div id="f-pr-tracks" class="alloc-${mode}">${trackRows}</div>
        <div class="alloc-foot">
          <button type="button" class="btn btn-ghost btn-sm" id="f-pr-trackAdd">+ ${t('editProduct.addTrack')}</button>
          <span class="alloc-pct-sum" id="f-pr-pctSum"></span>
        </div>
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

function _renderProviderChips(data, selectedId) {
  return _financialProviders(data).map(p => `
    <button type="button" class="provider-chip ${p.id === selectedId ? 'is-selected' : ''}"
            data-provider-id="${_esc(p.id)}" title="${_esc(_providerLabel(p))}">
      <img class="provider-chip-img" src="${_esc(p.logo)}" alt="${_esc(_providerLabel(p))}" />
      <span class="provider-chip-name">${_esc(_providerLabel(p))}</span>
    </button>`).join('');
}

function _trackRowHtml(track, idx) {
  const value = track.value === '' || track.value == null ? '' : track.value;
  const pct   = track.pct === '' || track.pct == null ? '' : track.pct;
  return `
    <div class="edit-product-track-row" data-idx="${idx}">
      <input class="form-input" type="text" data-field="name"
             value="${_esc(track.name || '')}" placeholder="${t('editProduct.trackNamePlaceholder')}" />
      <div class="track-value-col">
        <input class="form-input track-amount" type="number" min="0" step="0.01" inputmode="decimal"
               data-field="value" value="${value}" placeholder="${t('editProduct.trackAmountPlaceholder')}" />
        <div class="track-pct-wrap">
          <input class="form-input track-pct" type="number" min="0" max="100" step="0.01" inputmode="decimal"
                 data-field="pct" value="${pct}" placeholder="${t('editProduct.trackPctPlaceholder')}" />
          <span class="track-pct-pctsign">%</span>
          <span class="track-pct-amount" data-field="pctAmount"></span>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="remove-track" aria-label="Remove">×</button>
    </div>
  `;
}

// ── Form wiring ───────────────────────────────────────────────

function _wireForm() {
  const list   = document.getElementById('f-pr-tracks');
  const addBtn = document.getElementById('f-pr-trackAdd');
  const total  = document.getElementById('f-pr-total');

  addBtn?.addEventListener('click', () => {
    const idx = list.querySelectorAll('.edit-product-track-row').length;
    list.insertAdjacentHTML('beforeend', _trackRowHtml({ name: '', value: '', pct: '' }, idx));
    _recalcPercent();
  });

  list?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-track"]');
    if (!btn) return;
    const row = btn.closest('.edit-product-track-row');
    if (!row) return;
    if (list.querySelectorAll('.edit-product-track-row').length <= 1) {
      row.querySelectorAll('input').forEach(i => { i.value = ''; });
    } else {
      row.remove();
    }
    _recalcPercent();
  });

  // Live percent recompute on total or per-track % changes.
  total?.addEventListener('input', _recalcPercent);
  list?.addEventListener('input', (e) => {
    if (e.target.matches('[data-field="pct"]')) _recalcPercent();
  });

  // Allocation-mode toggle.
  document.getElementById('f-pr-allocMode')?.addEventListener('change', (e) => {
    if (e.target.name === 'allocMode') _setMode(e.target.value);
  });

  _wireProviderGallery();
  _recalcPercent();

  document.getElementById('f-pr-remove')?.addEventListener('click', _removeCurrent);
}

// Single-select provider grid. Providers are predefined registry
// entities (name + logo + id); selecting one is the only way to set a
// product's company/logo. Managing the registry itself lives elsewhere.
function _wireProviderGallery() {
  const gallery = document.getElementById('f-pr-providers');
  gallery?.addEventListener('click', (e) => {
    const chip = e.target.closest('.provider-chip');
    if (!chip) return;
    gallery.querySelectorAll('.provider-chip').forEach(c => c.classList.remove('is-selected'));
    chip.classList.add('is-selected');
  });
}

// Recompute each track's ₪ preview from the total + its %, and the
// running sum indicator. No-op unless we're in percent mode.
function _recalcPercent() {
  const tracks = document.getElementById('f-pr-tracks');
  const sumEl  = document.getElementById('f-pr-pctSum');
  if (!tracks) return;
  if (!tracks.classList.contains('alloc-percent')) { if (sumEl) sumEl.textContent = ''; return; }

  const total = parseFloat(document.getElementById('f-pr-total')?.value) || 0;
  let sum = 0;
  tracks.querySelectorAll('.edit-product-track-row').forEach(row => {
    const pct = parseFloat(row.querySelector('[data-field="pct"]')?.value) || 0;
    sum += pct;
    const span = row.querySelector('[data-field="pctAmount"]');
    if (span) span.textContent = pct ? formatCurrency(_round(total * pct / 100)) : '';
  });
  if (sumEl) {
    sumEl.textContent = t('editProduct.pctSum').replace('{sum}', String(_round(sum)));
    sumEl.classList.toggle('is-bad', Math.abs(sum - 100) > 0.5);
  }
}

// Switch allocation mode, carrying values across so the user doesn't
// lose work: amount→percent seeds % from the current amounts; the
// reverse seeds amounts from the percentages.
function _setMode(mode) {
  const tracks = document.getElementById('f-pr-tracks');
  if (!tracks) return;
  const total = parseFloat(document.getElementById('f-pr-total')?.value) || 0;

  tracks.querySelectorAll('.edit-product-track-row').forEach(row => {
    const valEl = row.querySelector('[data-field="value"]');
    const pctEl = row.querySelector('[data-field="pct"]');
    if (mode === 'percent') {
      if ((pctEl.value === '' || pctEl.value == null) && total > 0) {
        const v = parseFloat(valEl.value);
        if (Number.isFinite(v)) pctEl.value = String(_round(v / total * 100));
      }
    } else {
      const p = parseFloat(pctEl.value);
      if (Number.isFinite(p) && total > 0) valEl.value = String(_round(total * p / 100));
    }
  });

  tracks.classList.toggle('alloc-percent', mode === 'percent');
  tracks.classList.toggle('alloc-amount',  mode !== 'percent');
  _recalcPercent();
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
  const maturityDate = document.getElementById('f-pr-maturity')?.value || '';
  const description = (document.getElementById('f-pr-desc')?.value || '').trim();
  const totalRaw    = document.getElementById('f-pr-total')?.value;
  const soRaw       = document.getElementById('f-pr-soAmount')?.value;
  const soBankId    = document.getElementById('f-pr-soBank')?.value || '';

  const providerId = document.querySelector('#f-pr-providers .provider-chip.is-selected')
    ?.getAttribute('data-provider-id') || '';

  const allocationMode = document.querySelector('#f-pr-allocMode input[name="allocMode"]:checked')?.value || 'amount';
  const isPercent = allocationMode === 'percent';

  if (!PRODUCT_TYPES.includes(type)) { showErr(t('editProduct.invalidType'), 'f-pr-type'); return null; }
  if (!name) { showErr(t('editProduct.invalidName'), 'f-pr-name'); return null; }

  // Total must be known up front in percent mode (amounts derive from it).
  const totalParsed = totalRaw === '' || totalRaw == null ? null : parseFloat(totalRaw);
  if (isPercent && (!Number.isFinite(totalParsed) || totalParsed <= 0)) {
    showErr(t('editProduct.invalidTotalPercent'), 'f-pr-total'); return null;
  }

  // Collect track rows (raw), then derive value/pct per mode.
  const rawRows = [];
  document.querySelectorAll('#f-pr-tracks .edit-product-track-row').forEach(row => {
    const tn  = (row.querySelector('[data-field="name"]')?.value || '').trim();
    const vRaw = row.querySelector('[data-field="value"]')?.value;
    const pRaw = row.querySelector('[data-field="pct"]')?.value;
    const blank = !tn && (vRaw === '' || vRaw == null) && (pRaw === '' || pRaw == null);
    if (blank) return;
    rawRows.push({ name: tn, vRaw, pRaw });
  });

  let tracks;
  if (isPercent) {
    let pctSum = 0;
    tracks = rawRows.map(r => {
      const pct = r.pRaw === '' || r.pRaw == null ? 0 : parseFloat(r.pRaw);
      if (!Number.isFinite(pct) || pct < 0) return { name: r.name, value: null, pct: 0 };
      pctSum += pct;
      return { name: r.name, value: _round(totalParsed * pct / 100), pct };
    });
    if (rawRows.length && Math.abs(pctSum - 100) > 0.5) {
      showErr(t('editProduct.invalidPercentSum').replace('{sum}', String(_round(pctSum)))); return null;
    }
  } else {
    tracks = rawRows.map(r => {
      const v = r.vRaw === '' || r.vRaw == null ? null : parseFloat(r.vRaw);
      return { name: r.name, value: Number.isFinite(v) ? v : null, pct: null };
    });
  }

  // In amount mode the total defaults to the sum of track amounts.
  let total = totalParsed;
  if (!isPercent && total == null) {
    total = tracks.reduce((s, tr) => s + (Number.isFinite(tr.value) ? tr.value : 0), 0);
  }
  if (!Number.isFinite(total) || total < 0) { showErr(t('editProduct.invalidTotal'), 'f-pr-total'); return null; }

  const soAmount = soRaw === '' || soRaw == null ? null : parseFloat(soRaw);
  if (soAmount != null && (!Number.isFinite(soAmount) || soAmount < 0)) {
    showErr(t('editProduct.invalidStandingOrder'), 'f-pr-soAmount'); return null;
  }
  if (soAmount != null && soAmount > 0 && !soBankId) {
    showErr(t('editProduct.standingOrderNeedsBank'), 'f-pr-soBank'); return null;
  }

  return { type, name, nameEn, providerId, tracks, total, allocationMode, maturityDate, description, soAmount, soBankId };
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
