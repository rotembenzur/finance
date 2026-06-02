// ─────────────────────────────────────────────────────────────────
//  EDIT CONFIG ITEM — generic editor for a single registry list item
//
//  Used by the Admin screen (js/pages/admin.js) to add/edit one item of
//  any fully-editable config list (expense/income categories, providers).
//  Fields adapt to the list's policy (js/config/registry.js LIST_POLICIES):
//  emoji for category lists, logo path for providers, parent picker for
//  hierarchical lists.
//
//  The internal id is editable only on CREATE (ids are referenced by
//  stored records, so they're immutable once they exist). On save the
//  item is written through registry.upsertItem and the app re-renders.
//
//  Rides the shared modal shell; modal.js routes the save through
//  hasPendingConfigItemEdit / applyPendingConfigItemEdit.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { init } from '../app.js';
import {
  listPolicy, getItem, getRawList, getList, label, upsertItem, newItemId,
} from '../config/registry.js';
import { emojiFieldHtml, wireEmojiInputs } from './emoji-input.js';

// null | { key, create:true, parentId } | { key, id }
let _editing = null;

// ── Public API ────────────────────────────────────────────────

export function openConfigItemModal(key, itemId = null, parentId = null) {
  const pol = listPolicy(key);
  // 'full' lists allow add+edit; 'presentation' lists allow editing the
  // label/icon of fixed items only (the admin never opens these for
  // create, and the id stays locked in the form).
  if (!pol || (pol.editable !== 'full' && pol.editable !== 'presentation')) return;

  const item = itemId ? getItem(key, itemId) : null;
  if (itemId && !item) return;

  _editing = item ? { key, id: item.id } : { key, create: true, parentId: parentId || null };

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = item ? t('adminItem.titleEdit') : t('adminItem.titleNew');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(key, pol, item, _editing.parentId);
  _wireForm(key, pol);

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-ci-he')?.focus(), 50);
}

export function hasPendingConfigItemEdit()   { return _editing !== null; }
export function clearPendingConfigItemEdit() { _editing = null; }

export function applyPendingConfigItemEdit() {
  if (!_editing) return false;
  const { key } = _editing;
  const pol = listPolicy(key);
  if (!pol) { _editing = null; return false; }

  const form = _readForm(key, pol);
  if (!form) return false;

  const isCreate = !!_editing.create;
  const prev = isCreate ? null : getItem(key, _editing.id);

  const item = {
    ...(prev || {}),
    id:          isCreate ? form.id : _editing.id,
    he:          form.he,
    en:          form.en,
    emoji:       pol.hasEmoji ? (form.emoji || null) : (prev ? prev.emoji : null),
    color:       pol.hasColor ? (form.color || null) : (prev ? (prev.color ?? null) : null),
    logo:        pol.hasLogo ? (form.logo || null) : (prev ? prev.logo : undefined),
    parentId:    pol.hierarchical ? (form.parentId || null) : null,
    description: form.description || null,
    active:      prev ? prev.active !== false : true,
    order:       prev ? prev.order : _nextOrder(key, form.parentId),
  };
  if (!pol.hasLogo) delete item.logo;

  upsertItem(key, item);
  init();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form ──────────────────────────────────────────────────────

function _renderForm(key, pol, item, presetParentId) {
  const isNew = !item;
  const he    = item ? (item.he || '') : '';
  const en    = item ? (item.en || '') : '';
  const emoji = item ? (item.emoji || '') : '';
  const logo  = item ? (item.logo || '') : '';
  const color = item ? (item.color || '') : '';
  const desc  = item ? (item.description || '') : '';
  const id    = item ? item.id : '';
  const parentId = item ? (item.parentId || '') : (presetParentId || '');

  // Parent picker (hierarchical lists only): top-level + each parent.
  let parentRow = '';
  if (pol.hierarchical) {
    const parents = getList(key).filter(it => !it.parentId && (!item || it.id !== item.id));
    const opts = [`<option value="">${t('adminItem.topLevel')}</option>`]
      .concat(parents.map(p =>
        `<option value="${_esc(p.id)}" ${p.id === parentId ? 'selected' : ''}>${_esc(label(p))}</option>`))
      .join('');
    parentRow = `
      <div class="form-group">
        <label class="form-label" for="f-ci-parent">${t('adminItem.parent')}</label>
        <select class="form-select" id="f-ci-parent">${opts}</select>
        <small class="form-hint">${t('adminItem.parentHint')}</small>
      </div>`;
  }

  const emojiRow = pol.hasEmoji ? `
    <div class="form-group">
      <label class="form-label">${t('adminItem.emoji')}</label>
      ${emojiFieldHtml('f-ci-emoji', emoji)}
    </div>` : '';

  const logoRow = pol.hasLogo ? `
    <div class="form-group">
      <label class="form-label" for="f-ci-logo">${t('adminItem.logo')}</label>
      <input class="form-input" id="f-ci-logo" type="text" value="${_esc(logo)}"
             placeholder="assets/logos/example.png" />
      <small class="form-hint">${t('adminItem.logoHint')}</small>
    </div>` : '';

  // Color (card skins): an optional custom hex. Unchecked = use the
  // built-in gradient (color stays null); checked = override with the
  // chosen color. Native <input type=color> works on desktop + mobile.
  const colorRow = pol.hasColor ? `
    <div class="form-group">
      <label class="form-checkbox">
        <input type="checkbox" id="f-ci-colorOn" ${color ? 'checked' : ''} />
        <span>${t('adminItem.colorCustom')}</span>
      </label>
      <input class="form-input cc-color-input" id="f-ci-color" type="color"
             value="${_esc(color || '#1e3a8a')}" ${color ? '' : 'disabled'} />
      <small class="form-hint">${t('adminItem.colorHint')}</small>
    </div>` : '';

  // Id: editable on create (auto-suggested from English on blur), locked
  // on edit (ids are referenced by stored records).
  const idRow = isNew ? `
    <div class="form-group">
      <label class="form-label" for="f-ci-id">${t('adminItem.id')}</label>
      <input class="form-input" id="f-ci-id" type="text" value="${_esc(id)}"
             placeholder="${t('adminItem.idPlaceholder')}" />
      <small class="form-hint">${t('adminItem.idHint')}</small>
    </div>` : `
    <div class="form-group">
      <label class="form-label">${t('adminItem.id')}</label>
      <div class="admin-id-locked"><code>${_esc(id)}</code> <span class="admin-id-lock">🔒</span></div>
      <small class="form-hint">${t('adminItem.idLockedHint')}</small>
    </div>`;

  return `
    <form class="edit-config-form" onsubmit="event.preventDefault()">
      <div class="form-row">
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-ci-he">${t('adminItem.he')}</label>
          <input class="form-input" id="f-ci-he" type="text" dir="rtl" value="${_esc(he)}" />
        </div>
        <div class="form-group form-group--grow">
          <label class="form-label" for="f-ci-en">${t('adminItem.en')}</label>
          <input class="form-input" id="f-ci-en" type="text" value="${_esc(en)}" />
        </div>
      </div>
      ${emojiRow}
      ${colorRow}
      ${logoRow}
      ${parentRow}
      ${idRow}
      <div class="form-group">
        <label class="form-label" for="f-ci-desc">${t('adminItem.description')}</label>
        <textarea class="form-input" id="f-ci-desc" rows="2">${_esc(desc)}</textarea>
      </div>
      <p id="f-ci-error" class="form-error" style="display:none"></p>
    </form>
  `;
}

function _wireForm(key, pol) {
  // Emoji picker (replaces the old plain-text emoji input).
  wireEmojiInputs(document.getElementById('modal-body') || document);

  // Custom-color checkbox enables/disables the color input.
  const colorOn = document.getElementById('f-ci-colorOn');
  const colorIn = document.getElementById('f-ci-color');
  if (colorOn && colorIn) {
    colorOn.addEventListener('change', () => { colorIn.disabled = !colorOn.checked; });
  }

  // Auto-suggest an id from the English name while creating, until the
  // user types their own id.
  const idInp = document.getElementById('f-ci-id');
  const enInp = document.getElementById('f-ci-en');
  if (idInp && enInp) {
    let touched = false;
    idInp.addEventListener('input', () => { touched = true; });
    enInp.addEventListener('input', () => {
      if (touched) return;
      idInp.value = newItemId(key, enInp.value);
    });
  }
}

function _readForm(key, pol) {
  const errorEl = document.getElementById('f-ci-error');
  const showErr = (msg, focusId) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const he   = (document.getElementById('f-ci-he')?.value || '').trim();
  const en   = (document.getElementById('f-ci-en')?.value || '').trim();
  const emoji = (document.getElementById('f-ci-emoji')?.value || '').trim();
  const logo = (document.getElementById('f-ci-logo')?.value || '').trim();
  const desc = (document.getElementById('f-ci-desc')?.value || '').trim();
  const parentId = pol.hierarchical ? (document.getElementById('f-ci-parent')?.value || '') : '';

  // Color: only when "custom color" is on and the value is a valid hex;
  // otherwise null (use the built-in gradient).
  let color = null;
  if (pol.hasColor && document.getElementById('f-ci-colorOn')?.checked) {
    const cv = document.getElementById('f-ci-color')?.value || '';
    color = /^#[0-9a-f]{6}$/i.test(cv) ? cv : null;
  }

  if (!he && !en) { showErr(t('adminItem.invalidName'), 'f-ci-he'); return null; }

  let id = _editing.id;
  if (_editing.create) {
    id = (document.getElementById('f-ci-id')?.value || '').trim();
    if (!id) id = newItemId(key, en || he);
    if (!/^[a-z0-9_]+$/i.test(id)) { showErr(t('adminItem.invalidId'), 'f-ci-id'); return null; }
    if (getRawList(key).some(it => it && it.id === id)) {
      showErr(t('adminItem.duplicateId'), 'f-ci-id'); return null;
    }
  }

  return { id, he: he || en, en: en || he, emoji, logo, color, description: desc, parentId };
}

function _nextOrder(key, parentId) {
  const scope = getRawList(key).filter(it => (it.parentId || null) === (parentId || null));
  const max = scope.reduce((m, it) => Math.max(m, it.order || 0), 0);
  return max + 10;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
