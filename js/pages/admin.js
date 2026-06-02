// ─────────────────────────────────────────────────────────────────
//  ADMIN / MANAGEMENT screen
//
//  A dedicated owner-only view (not part of the dashboard sections,
//  reached from the More sheet, hidden in demo mode) for managing the
//  app's configurable category / selection lists without touching code.
//
//  Master-detail: a left catalog of lists, a right pane showing the
//  selected list's items as an editable table. Editing routes through
//  the config registry (js/config/registry.js); item add/edit uses the
//  shared modal editor (js/components/edit-config-item.js).
//
//  Phase 1 makes the data-resident lists fully editable (expense +
//  income categories, providers). Class-B lists whose ids drive code
//  behaviour are shown as a read-only "code-bound" inventory for now.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { init } from '../app.js';
import {
  listKeys, listPolicy, getRawList, getList, getItem, label,
  reorder, setActive, removeItem,
} from '../config/registry.js';
import { openConfigItemModal } from '../components/edit-config-item.js';
import { getSettings, setSettings } from '../config/settings.js';
import { CASH_CURRENCIES } from '../fx.js';
import { showToast } from '../components/toast.js';

// Reserved catalog key for the scalar Settings/Profile form (not a list).
const PROFILE_KEY = '__profile__';

// Lists not yet editable — their ids are wired to code. Empty now that
// the presentation layer of the former locked lists is editable; kept as
// a hook for any genuinely code-bound list added later.
const CODE_BOUND = [];

// Fixed industry enums NOT surfaced in Admin. They're real registry lists
// (so labels + the card-editor dropdowns keep resolving from them), but
// users can't add their own values, so editing them adds UI complexity
// without practical benefit. Hidden here, not removed — re-expose by
// deleting a key. The data + display are unaffected.
const ADMIN_HIDDEN = new Set([
  'cardNetworks', 'cardTypes', 'cardTiers', 'cardIssuers',
  'bankTxTypes', 'productTypes', 'reimbursementMethods',
  'recurringCycles', 'currencies', 'accountTypes',
]);

const GROUP_ORDER = ['spending', 'investments', 'cards', 'vouchers', 'accounts', 'other'];

// The registry lists shown as editable in Admin (everything not hidden).
function _visibleKeys() { return listKeys().filter(k => !ADMIN_HIDDEN.has(k)); }

// ── Render ────────────────────────────────────────────────────────

export function renderAdmin(data, listKey) {
  const visible = _visibleKeys();
  const activeKey = listKey === PROFILE_KEY
    ? PROFILE_KEY
    : (visible.includes(listKey) ? listKey : visible[0]);

  return `
    <section class="section admin" id="admin">
      <div class="admin-topbar">
        <button class="btn btn-ghost btn-sm admin-back" onclick="navigateToSection('dashboard')">
          ← ${_esc(t('admin.back'))}
        </button>
        <h2 class="section-title">${_esc(t('admin.title'))}</h2>
      </div>
      <p class="section-intro">${_esc(t('admin.intro'))}</p>

      <div class="admin-layout">
        <aside class="admin-catalog">${_renderCatalog(activeKey)}</aside>
        <div class="admin-detail">${activeKey === PROFILE_KEY ? _renderProfile() : _renderDetail(activeKey)}</div>
      </div>
    </section>
  `;
}

function _renderCatalog(activeKey) {
  // Editable lists grouped by domain (fixed industry enums are hidden).
  const byGroup = {};
  for (const key of _visibleKeys()) {
    const g = (listPolicy(key).group) || 'other';
    (byGroup[g] = byGroup[g] || []).push(key);
  }

  const groupsHtml = GROUP_ORDER
    .filter(g => byGroup[g])
    .map(g => `
      <div class="admin-catalog-group">
        <div class="admin-catalog-group-title">${_esc(t('admin.group.' + g))}</div>
        ${byGroup[g].map(key => `
          <button class="admin-catalog-row ${key === activeKey ? 'is-active' : ''}"
                  type="button" onclick="adminSelectList('${key}')">
            <span class="admin-catalog-row-label">${_esc(t('admin.list.' + key))}</span>
            <span class="admin-catalog-row-count">${getRawList(key).length}</span>
          </button>
        `).join('')}
      </div>
    `).join('');

  // Code-bound inventory — only rendered if any genuinely locked lists
  // remain. Empty now that every former locked list is presentation-editable.
  const codeBound = CODE_BOUND.length ? `
    <div class="admin-catalog-group admin-catalog-group--locked">
      <div class="admin-catalog-group-title">${_esc(t('admin.group.codeBound'))}</div>
      ${CODE_BOUND.map(key => `
        <div class="admin-catalog-row is-locked" title="${_esc(t('admin.codeBoundHint'))}">
          <span class="admin-catalog-row-label">${_esc(t('admin.list.' + key))}</span>
          <span class="admin-catalog-row-lock" aria-hidden="true">🔒</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Profile / Settings — scalar config, sits at the top of the catalog.
  const profileGroup = `
    <div class="admin-catalog-group">
      <div class="admin-catalog-group-title">${_esc(t('admin.group.profile'))}</div>
      <button class="admin-catalog-row ${activeKey === PROFILE_KEY ? 'is-active' : ''}"
              type="button" onclick="adminSelectList('${PROFILE_KEY}')">
        <span class="admin-catalog-row-label">${_esc(t('admin.profile.title'))}</span>
      </button>
    </div>
  `;

  return profileGroup + groupsHtml + codeBound;
}

// Scalar Settings / Profile form (rendered in the detail pane instead of
// a list table). Values come from the settings model; Save validates and
// persists, and applies a language change live.
function _renderProfile() {
  const s = getSettings();
  const langOpts = [['he', t('settings.langHe')], ['en', t('settings.langEn')]]
    .map(([v, l]) => `<option value="${v}" ${s.defaultLanguage === v ? 'selected' : ''}>${_esc(l)}</option>`).join('');
  const curOpts = CASH_CURRENCIES
    .map(c => `<option value="${c}" ${s.defaultCurrency === c ? 'selected' : ''}>${c}</option>`).join('');

  return `
    <div class="admin-detail-head">
      <div>
        <h3 class="admin-detail-title">${_esc(t('admin.profile.title'))}</h3>
        <p class="admin-detail-hint">${_esc(t('admin.profile.hint'))}</p>
      </div>
    </div>
    <form class="admin-settings-form" onsubmit="event.preventDefault()">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-set-dob">${_esc(t('settings.dob'))}</label>
          <input class="form-input" id="f-set-dob" type="date" value="${_esc(s.dateOfBirth)}" />
          <small class="form-hint">${_esc(t('settings.dobHint'))}</small>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-set-retage">${_esc(t('settings.retirementAge'))}</label>
          <input class="form-input" id="f-set-retage" type="number" min="40" max="120" step="1"
                 inputmode="numeric" value="${_esc(s.retirementAge)}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-set-lang">${_esc(t('settings.language'))}</label>
          <select class="form-select" id="f-set-lang">${langOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-set-currency">${_esc(t('settings.currency'))}</label>
          <select class="form-select" id="f-set-currency">${curOpts}</select>
          <small class="form-hint">${_esc(t('settings.currencyNote'))}</small>
        </div>
      </div>
      <p id="f-set-error" class="form-error" style="display:none"></p>
      <button type="button" class="btn btn-primary" onclick="adminSaveSettings()">${_esc(t('settings.save'))}</button>
    </form>
  `;
}

function _renderDetail(key) {
  const pol = listPolicy(key);
  if (!pol) return '';

  const isFull = pol.editable === 'full';

  // Add is only offered for fully-editable lists. Presentation lists
  // (e.g. bank-tx types) have a fixed id set wired to code.
  const addBtn = isFull
    ? `<button class="btn btn-primary btn-sm" onclick="openConfigItemModal('${key}', null)">
         + ${_esc(t('admin.addItem'))}
       </button>`
    : `<span class="admin-presentation-badge" title="${_esc(t('admin.presentationHint'))}">${_esc(t('admin.presentationBadge'))}</span>`;

  return `
    <div class="admin-detail-head">
      <div>
        <h3 class="admin-detail-title">${_esc(t('admin.list.' + key))}</h3>
        <p class="admin-detail-hint">${_esc(t('admin.list.' + key + '.hint'))}</p>
      </div>
      ${addBtn}
    </div>
    <div class="admin-table" role="table">
      <div class="admin-row admin-row--head" role="row">
        <span class="admin-cell admin-cell--order"></span>
        <span class="admin-cell admin-cell--icon">${_esc(t('admin.col.icon'))}</span>
        <span class="admin-cell admin-cell--name">${_esc(t('admin.col.he'))}</span>
        <span class="admin-cell admin-cell--name">${_esc(t('admin.col.en'))}</span>
        <span class="admin-cell admin-cell--id">${_esc(t('admin.col.id'))}</span>
        <span class="admin-cell admin-cell--active">${_esc(t('admin.col.active'))}</span>
        <span class="admin-cell admin-cell--actions"></span>
      </div>
      ${_renderRows(key, pol)}
    </div>
  `;
}

function _renderRows(key, pol) {
  // Use the RAW list (includes inactive) sorted by order so the admin
  // sees everything, including deactivated items.
  const all = getRawList(key).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  if (pol.hierarchical) {
    const parents = all.filter(it => !it.parentId);
    return parents.map(p => {
      const children = all.filter(it => it.parentId === p.id);
      return _row(key, pol, p, false)
        + children.map(c => _row(key, pol, c, true)).join('')
        + `<div class="admin-row admin-row--subadd" role="row">
             <button class="btn btn-ghost btn-xs admin-subadd"
                     onclick="openConfigItemModal('${key}', null, '${_esc(p.id)}')">
               + ${_esc(t('admin.addSub'))}
             </button>
           </div>`;
    }).join('');
  }
  return all.map(it => _row(key, pol, it, false)).join('');
}

function _row(key, pol, item, isChild) {
  const isFull = pol.editable === 'full';
  let icon;
  if (pol.hasColor) {
    // Color swatch: custom hex inline over the .credit-card--<id> gradient.
    const sc = (item.color && /^#[0-9a-f]{6}$/i.test(item.color)) ? item.color : '';
    icon = `<span class="cc-skin-swatch credit-card--${_esc(item.id)}"${sc ? ` style="background:${sc}"` : ''}></span>`;
  } else if (pol.hasLogo && item.logo) {
    icon = `<img class="admin-cell-logo" src="${_esc(item.logo)}" alt="" />`;
  } else {
    icon = `<span class="admin-cell-emoji">${_esc(item.emoji || '')}</span>`;
  }

  const inactive = item.active === false;

  // Delete is full-only. The active toggle shows for full lists and for
  // presentation lists that opt in via allowActive (deactivating is safe
  // when it can't orphan data — e.g. product types, which are only ever
  // set through the editor dropdown). bank-tx types stay always-active.
  const showToggle = isFull || pol.allowActive;
  const activeCell = showToggle
    ? `<button class="admin-toggle ${inactive ? '' : 'is-on'}"
               role="switch" aria-checked="${inactive ? 'false' : 'true'}"
               onclick="adminToggleActive('${key}','${_esc(item.id)}')">
         <span class="admin-toggle-knob"></span>
       </button>`
    : `<span class="admin-toggle-locked" title="${_esc(t('admin.presentationHint'))}" aria-hidden="true">—</span>`;

  const deleteBtn = isFull
    ? `<button class="btn btn-ghost btn-xs admin-del" onclick="adminDeleteItem('${key}','${_esc(item.id)}')">
         ${_esc(t('admin.delete'))}
       </button>`
    : '';

  return `
    <div class="admin-row ${isChild ? 'admin-row--child' : ''} ${inactive ? 'is-inactive' : ''}" role="row">
      <span class="admin-cell admin-cell--order">
        <button class="admin-ord-btn" title="${_esc(t('admin.moveUp'))}"
                onclick="adminMoveItem('${key}','${_esc(item.id)}',-1)">▲</button>
        <button class="admin-ord-btn" title="${_esc(t('admin.moveDown'))}"
                onclick="adminMoveItem('${key}','${_esc(item.id)}',1)">▼</button>
      </span>
      <span class="admin-cell admin-cell--icon">${icon}</span>
      <span class="admin-cell admin-cell--name" dir="rtl">${_esc(item.he || '')}</span>
      <span class="admin-cell admin-cell--name">${_esc(item.en || '')}</span>
      <span class="admin-cell admin-cell--id"><code>${_esc(item.id)}</code></span>
      <span class="admin-cell admin-cell--active">${activeCell}</span>
      <span class="admin-cell admin-cell--actions">
        <button class="btn btn-ghost btn-xs" onclick="openConfigItemModal('${key}','${_esc(item.id)}')">
          ${_esc(t('admin.edit'))}
        </button>
        ${deleteBtn}
      </span>
    </div>
  `;
}

// ── Inline handlers (wired to window in app.js) ──────────────────

// Switch the visible list — re-renders the admin view with the new key.
export function adminSelectList(key) {
  if (typeof window.navigateToAdmin === 'function') window.navigateToAdmin(key);
}

// Save the Settings / Profile form. Validates via the settings model;
// applies a language change live (which re-renders), else re-renders to
// reflect the new calc inputs (age/horizon) everywhere.
export function adminSaveSettings() {
  const dob      = document.getElementById('f-set-dob')?.value || '';
  const retAge   = document.getElementById('f-set-retage')?.value || '';
  const lang     = document.getElementById('f-set-lang')?.value || 'he';
  const currency = document.getElementById('f-set-currency')?.value || 'ILS';

  const res = setSettings({
    dateOfBirth: dob,
    retirementAge: Number(retAge),
    defaultLanguage: lang,
    defaultCurrency: currency,
  });

  if (!res.ok) {
    const err = document.getElementById('f-set-error');
    if (err) {
      err.textContent = res.errors.includes('dateOfBirth')
        ? t('settings.invalidDob')
        : t('settings.invalidRetAge');
      err.style.display = 'block';
    }
    return;
  }

  // A language change re-renders the whole app (incl. this view) via the
  // app.js setLanguage wrapper; otherwise re-render to flow the new
  // DOB/retirement-age through every analytical view.
  if (lang !== currentLang && typeof window.setLanguage === 'function') {
    window.setLanguage(lang);
  } else {
    init();
  }
  showToast({ tone: 'info', message: t('settings.saved') });
}

// Move an item up/down within its sibling scope (same parentId).
export function adminMoveItem(key, id, dir) {
  const item = getItem(key, id);
  if (!item) return;
  const parentId = item.parentId || null;
  const siblings = getRawList(key)
    .filter(it => (it.parentId || null) === parentId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const ids = siblings.map(it => it.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  reorder(key, ids);
  init();
}

export function adminToggleActive(key, id) {
  const item = getItem(key, id);
  if (!item) return;
  setActive(key, id, item.active === false);   // flip
  init();
}

export function adminDeleteItem(key, id) {
  const item = getItem(key, id);
  if (!item) return;
  const pol = listPolicy(key);
  const childCount = pol && pol.hierarchical
    ? getRawList(key).filter(it => it.parentId === id).length
    : 0;
  const msg = childCount > 0
    ? t('admin.deleteConfirmParent').replace('{name}', label(item)).replace('{count}', String(childCount))
    : t('admin.deleteConfirm').replace('{name}', label(item));
  if (!window.confirm(msg)) return;
  // Phase 1: references become uncategorized (reassignTo null). A
  // reassignment picker can be layered on later.
  removeItem(key, id, { reassignTo: null });
  init();
}

// ── Helpers ───────────────────────────────────────────────────────

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
