// ─────────────────────────────────────────────────────────────────
//  LOGO INPUT — reusable visual logo picker
//
//  Replaces the old "type an assets/logos/… path" text input. Users
//  pick a logo from a visual gallery (image + name); the underlying
//  file path is stored behind the scenes. Used anywhere an entity
//  carries a logo (banks, providers, … any hasLogo registry list).
//
//  Usage:
//    1. Render the field:  ${logoFieldHtml('f-ci-logo', currentPath)}
//       — paints a trigger (current logo preview), a clear button, and a
//       HIDDEN input with the given id holding the path, so existing
//       form-read code (getElementById(id).value) is unchanged.
//    2. After injecting the HTML:  wireLogoInputs(modalBodyEl)
//
//  The gallery is the LOGO_LIBRARY manifest. Popover anchors under the
//  trigger on desktop and becomes a bottom sheet on phones (see
//  .logo-popover in css/pages.css). Closes on pick / outside / Escape.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { LOGO_LIBRARY, logoName } from '../config/logo-library.js';

// ── Public API ────────────────────────────────────────────────

export function logoFieldHtml(id, value) {
  const v = value || '';
  const clearLabel = t('logoPicker.clear') || 'Clear';
  return `
    <div class="logo-field" data-logo-field>
      <button type="button" class="logo-trigger" data-logo-target="${_esc(id)}"
              aria-haspopup="dialog" aria-expanded="false" title="${_esc(t('logoPicker.choose') || 'Choose logo')}">
        ${_triggerInner(v)}
      </button>
      <button type="button" class="logo-clear" data-logo-clear="${_esc(id)}"
              aria-label="${_esc(clearLabel)}" title="${_esc(clearLabel)}"
              style="${v ? '' : 'display:none'}">×</button>
      <input type="hidden" id="${_esc(id)}" value="${_esc(v)}" />
    </div>`;
}

export function wireLogoInputs(root = document) {
  root.querySelectorAll('.logo-trigger').forEach(btn => {
    if (btn.dataset.logoWired) return;
    btn.dataset.logoWired = '1';
    btn.addEventListener('click', (e) => { e.stopPropagation(); _toggle(btn); });
  });
  root.querySelectorAll('.logo-clear').forEach(btn => {
    if (btn.dataset.logoWired) return;
    btn.dataset.logoWired = '1';
    btn.addEventListener('click', (e) => { e.stopPropagation(); _setValue(btn.dataset.logoClear, ''); _close(); });
  });
}

// ── Internals ─────────────────────────────────────────────────

let _activePopover = null;

function _triggerInner(path) {
  if (path) {
    return `<img class="logo-trigger-img" src="${_esc(path)}" alt="${_esc(logoName(path, currentLang))}" />`;
  }
  return `<span class="logo-trigger-empty">${_esc(t('logoPicker.choose') || 'Choose logo')}</span>`;
}

function _setValue(id, path) {
  const input = document.getElementById(id);
  if (input) input.value = path || '';
  const field = input && input.closest('.logo-field');
  if (!field) return;
  const trigger = field.querySelector('.logo-trigger');
  if (trigger) trigger.innerHTML = _triggerInner(path);
  const clear = field.querySelector('.logo-clear');
  if (clear) clear.style.display = path ? '' : 'none';
}

function _toggle(trigger) {
  if (_activePopover && _activePopover._trigger === trigger) { _close(); return; }
  _close();
  const id = trigger.dataset.logoTarget;
  const current = document.getElementById(id)?.value || '';

  const pop = document.createElement('div');
  pop.className = 'logo-popover';
  pop._trigger = trigger;
  pop.innerHTML = `
    <input type="text" class="logo-popover-filter" placeholder="${_esc(t('logoPicker.filter') || 'Filter…')}" />
    <div class="logo-grid">${_gridHtml(current)}</div>
  `;
  document.body.appendChild(pop);
  _position(pop, trigger);

  // Select a logo (event delegation on the grid).
  pop.querySelector('.logo-grid').addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-logo-path]');
    if (!tile) return;
    _setValue(id, tile.getAttribute('data-logo-path'));   // '' for the "None" tile
    _close();
  });
  // Filter by name.
  const filter = pop.querySelector('.logo-popover-filter');
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    pop.querySelectorAll('.logo-tile[data-name]').forEach(tile => {
      tile.style.display = (!q || tile.dataset.name.includes(q)) ? '' : 'none';
    });
  });

  trigger.setAttribute('aria-expanded', 'true');
  _activePopover = pop;

  setTimeout(() => {
    document.addEventListener('click', _onDocClick, true);
    document.addEventListener('keydown', _onKey, true);
    window.addEventListener('resize', _close);
    try { filter.focus(); } catch (_) {}
  }, 0);
}

function _gridHtml(current) {
  const none = `
    <button type="button" class="logo-tile logo-tile--none ${current ? '' : 'is-selected'}"
            data-logo-path="" data-name="">
      <span class="logo-tile-none">${_esc(t('logoPicker.none') || 'No logo')}</span>
    </button>`;
  const tiles = LOGO_LIBRARY.map(l => {
    const name = (currentLang === 'he' ? l.he : l.en) || l.en;
    return `
      <button type="button" class="logo-tile ${l.path === current ? 'is-selected' : ''}"
              data-logo-path="${_esc(l.path)}" data-name="${_esc((l.en + ' ' + l.he).toLowerCase())}"
              title="${_esc(name)}">
        <img class="logo-tile-img" src="${_esc(l.path)}" alt="" loading="lazy" />
        <span class="logo-tile-name">${_esc(name)}</span>
      </button>`;
  }).join('');
  return none + tiles;
}

function _onDocClick(e) {
  if (!_activePopover) return;
  if (_activePopover.contains(e.target)) return;
  if (_activePopover._trigger && _activePopover._trigger.contains(e.target)) return;
  _close();
}

function _onKey(e) {
  if (e.key === 'Escape' && _activePopover) { e.stopPropagation(); _close(); }
}

function _close() {
  if (_activePopover) {
    if (_activePopover._trigger) _activePopover._trigger.setAttribute('aria-expanded', 'false');
    _activePopover.remove();
    _activePopover = null;
  }
  document.removeEventListener('click', _onDocClick, true);
  document.removeEventListener('keydown', _onKey, true);
  window.removeEventListener('resize', _close);
}

function _position(pop, trigger) {
  const r = trigger.getBoundingClientRect();
  const PW = 340, PH = 380, M = 8;
  let left = Math.max(M, Math.min(r.left, window.innerWidth - PW - M));
  let top  = r.bottom + 6;
  if (top + PH > window.innerHeight - M) {
    const above = r.top - 6 - PH;
    top = above > M ? above : Math.max(M, window.innerHeight - PH - M);
  }
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
