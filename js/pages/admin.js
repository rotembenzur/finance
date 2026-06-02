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

// Lists not yet editable — their ids are wired to code (validation, CSS,
// logo switches, the import classifier). Shown for inventory completeness
// and to set expectations; editing comes in a later phase.
const CODE_BOUND = [
  'bankTxTypes', 'productTypes', 'cardIssuers', 'cardNetworks', 'cardTypes',
  'cardSkins', 'cardTiers', 'reimbursementMethods', 'recurringCycles',
  'currencies', 'accountTypes', 'voucherStoreTypes',
];

const GROUP_ORDER = ['spending', 'investments', 'cards', 'vouchers', 'accounts', 'other'];

// ── Render ────────────────────────────────────────────────────────

export function renderAdmin(data, listKey) {
  const keys = listKeys();
  const activeKey = keys.includes(listKey) ? listKey : keys[0];

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
        <div class="admin-detail">${_renderDetail(activeKey)}</div>
      </div>
    </section>
  `;
}

function _renderCatalog(activeKey) {
  // Editable lists grouped by domain.
  const byGroup = {};
  for (const key of listKeys()) {
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

  const codeBound = `
    <div class="admin-catalog-group admin-catalog-group--locked">
      <div class="admin-catalog-group-title">${_esc(t('admin.group.codeBound'))}</div>
      ${CODE_BOUND.map(key => `
        <div class="admin-catalog-row is-locked" title="${_esc(t('admin.codeBoundHint'))}">
          <span class="admin-catalog-row-label">${_esc(t('admin.list.' + key))}</span>
          <span class="admin-catalog-row-lock" aria-hidden="true">🔒</span>
        </div>
      `).join('')}
    </div>
  `;

  return groupsHtml + codeBound;
}

function _renderDetail(key) {
  const pol = listPolicy(key);
  if (!pol) return '';

  const addBtn = `
    <button class="btn btn-primary btn-sm" onclick="openConfigItemModal('${key}', null)">
      + ${_esc(t('admin.addItem'))}
    </button>`;

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
  const icon = pol.hasLogo && item.logo
    ? `<img class="admin-cell-logo" src="${_esc(item.logo)}" alt="" />`
    : `<span class="admin-cell-emoji">${_esc(item.emoji || '')}</span>`;

  const inactive = item.active === false;

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
      <span class="admin-cell admin-cell--active">
        <button class="admin-toggle ${inactive ? '' : 'is-on'}"
                role="switch" aria-checked="${inactive ? 'false' : 'true'}"
                onclick="adminToggleActive('${key}','${_esc(item.id)}')">
          <span class="admin-toggle-knob"></span>
        </button>
      </span>
      <span class="admin-cell admin-cell--actions">
        <button class="btn btn-ghost btn-xs" onclick="openConfigItemModal('${key}','${_esc(item.id)}')">
          ${_esc(t('admin.edit'))}
        </button>
        <button class="btn btn-ghost btn-xs admin-del" onclick="adminDeleteItem('${key}','${_esc(item.id)}')">
          ${_esc(t('admin.delete'))}
        </button>
      </span>
    </div>
  `;
}

// ── Inline handlers (wired to window in app.js) ──────────────────

// Switch the visible list — re-renders the admin view with the new key.
export function adminSelectList(key) {
  if (typeof window.navigateToAdmin === 'function') window.navigateToAdmin(key);
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
