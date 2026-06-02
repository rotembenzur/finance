// ─────────────────────────────────────────────────────────────────
//  EMOJI INPUT — reusable emoji picker field
//
//  Wraps `emoji-picker-element` (Nolan Lawson, MIT) — a framework-
//  agnostic Web Component with the full emoji library, search, category
//  browsing, and a built-in "recently used" row. Loaded lazily from the
//  CDN on first open (same pattern as supabase / pdf.js), so it adds zero
//  weight to boot.
//
//  Usage:
//    1. Render the field where an emoji is chosen:
//         ${emojiFieldHtml('f-ci-emoji', currentValue)}
//       It paints a trigger button (shows the chosen emoji), a clear
//       button, and a hidden <input id="..."> — so existing form-read
//       code that does getElementById(id).value keeps working unchanged.
//    2. After injecting the form HTML, wire it:
//         wireEmojiInputs(modalBodyEl);
//
//  Selection is emoji-only (you can't type arbitrary text). The popover
//  anchors under the trigger on desktop and becomes a bottom sheet on
//  phones (see .emoji-popover in css/pages.css). Closes on pick, on
//  outside click, on Escape, and on resize.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';

const ELEMENT = 'emoji-picker';
const CDN_PICKER = 'https://esm.sh/emoji-picker-element@1/picker.js';
const CDN_SIDEEFFECT = 'https://esm.sh/emoji-picker-element@1';

let _libPromise = null;

// Define <emoji-picker> once. Prefer the explicit Picker class export so
// registration is deterministic; fall back to the side-effect import.
function _ensurePicker() {
  if (customElements.get(ELEMENT)) return Promise.resolve();
  if (_libPromise) return _libPromise;
  _libPromise = import(CDN_PICKER)
    .then(mod => {
      const Picker = mod && (mod.default || mod.Picker);
      if (Picker && !customElements.get(ELEMENT)) customElements.define(ELEMENT, Picker);
      if (!customElements.get(ELEMENT)) throw new Error('Picker class not found');
    })
    .catch(async (err) => {
      console.warn('[emoji-input] picker.js import failed; trying side-effect import', err);
      await import(CDN_SIDEEFFECT);   // registers <emoji-picker> itself
    });
  return _libPromise;
}

// ── Public API ────────────────────────────────────────────────

// Markup for an emoji field. `id` is the hidden input's id (read by the
// surrounding form exactly as before). `value` is the current emoji.
export function emojiFieldHtml(id, value) {
  const v = value || '';
  const clearLabel = t('emojiPicker.clear') || 'Clear';
  return `
    <div class="emoji-field" data-emoji-field>
      <button type="button" class="emoji-trigger" data-emoji-target="${_esc(id)}"
              aria-haspopup="dialog" aria-expanded="false" title="${_esc(t('emojiPicker.choose') || 'Choose emoji')}">
        <span class="emoji-trigger-glyph ${v ? '' : 'is-empty'}">${v || '🙂'}</span>
      </button>
      <button type="button" class="emoji-clear" data-emoji-clear="${_esc(id)}"
              aria-label="${_esc(clearLabel)}" title="${_esc(clearLabel)}"
              style="${v ? '' : 'display:none'}">×</button>
      <input type="hidden" id="${_esc(id)}" value="${_esc(v)}" />
    </div>`;
}

// Wire all emoji fields found under `root` (default: document). Idempotent
// per element via a data flag.
export function wireEmojiInputs(root = document) {
  root.querySelectorAll('.emoji-trigger').forEach(btn => {
    if (btn.dataset.emojiWired) return;
    btn.dataset.emojiWired = '1';
    btn.addEventListener('click', (e) => { e.stopPropagation(); _toggle(btn); });
  });
  root.querySelectorAll('.emoji-clear').forEach(btn => {
    if (btn.dataset.emojiWired) return;
    btn.dataset.emojiWired = '1';
    btn.addEventListener('click', (e) => { e.stopPropagation(); _setValue(btn.dataset.emojiClear, ''); _close(); });
  });
}

// ── Internals ─────────────────────────────────────────────────

let _activePopover = null;

function _setValue(id, unicode) {
  const input = document.getElementById(id);
  if (input) input.value = unicode || '';
  const field = input && input.closest('.emoji-field');
  if (!field) return;
  const glyph = field.querySelector('.emoji-trigger-glyph');
  if (glyph) {
    glyph.textContent = unicode || '🙂';
    glyph.classList.toggle('is-empty', !unicode);
  }
  const clear = field.querySelector('.emoji-clear');
  if (clear) clear.style.display = unicode ? '' : 'none';
}

async function _toggle(trigger) {
  if (_activePopover && _activePopover._trigger === trigger) { _close(); return; }
  _close();
  await _ensurePicker();
  // The trigger may have been removed (modal re-render) while awaiting.
  if (!document.body.contains(trigger)) return;

  const id  = trigger.dataset.emojiTarget;
  const pop = document.createElement('div');
  pop.className = 'emoji-popover';
  pop._trigger = trigger;

  const picker = document.createElement(ELEMENT);
  // Force the light skin to match the app (the element otherwise follows
  // prefers-color-scheme, which could mismatch the always-light UI).
  picker.className = 'light';
  pop.appendChild(picker);
  document.body.appendChild(pop);

  _position(pop, trigger);

  picker.addEventListener('emoji-click', (ev) => {
    const u = ev.detail && ev.detail.unicode;
    if (u) _setValue(id, u);
    _close();
  });

  trigger.setAttribute('aria-expanded', 'true');
  _activePopover = pop;

  // Defer listener attachment so the opening click doesn't immediately
  // close it. Capture phase so a click on Save/Cancel closes the popover
  // before that button's own handler runs.
  setTimeout(() => {
    document.addEventListener('click', _onDocClick, true);
    document.addEventListener('keydown', _onKey, true);
    window.addEventListener('resize', _close);
    const search = picker.shadowRoot && picker.shadowRoot.querySelector('input.search, input[type="search"]');
    if (search) { try { search.focus(); } catch (_) {} }
  }, 0);
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

// Desktop anchoring: below the trigger, flipping up / clamping to the
// viewport. Phones get a bottom sheet purely via CSS (@media), so the
// computed top/left are harmless overrides there.
function _position(pop, trigger) {
  const r = trigger.getBoundingClientRect();
  const PW = 340, PH = 420, M = 8;
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
