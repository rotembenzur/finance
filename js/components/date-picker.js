// ─────────────────────────────────────────────────────────────────
//  DATE PICKER — calm, custom calendar popover
//
//  Replaces the browser's native <input type="date"> popup. Same
//  design language as the rest of the app: paper-elevated card,
//  hairline borders, restrained color, no system chrome. Built from
//  vanilla DOM — no library, no portal framework.
//
//  Public API:
//
//    openDatePicker({
//      anchor,        // optional element to position near (else centered)
//      initial,       // ISO 'YYYY-MM-DD' for the initial selection
//      min, max,      // optional ISO strings bounding the range
//      onSelect,      // (iso) → … when the user picks a day
//      onCancel,      // optional, fires on outside-click / Escape
//    })
//
//  Locale-aware: Hebrew weekday letters and month names come from
//  Intl.DateTimeFormat with the current UI language; week starts on
//  Sunday (Israeli + US convention). Future dates beyond `max` are
//  rendered disabled. "Today" + "Yesterday" quick chips sit above
//  the grid for the most common cases. Closes on backdrop click,
//  outside click, or Escape.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { todayISO } from '../store.js';

let _instance = null;   // currently-mounted picker, if any

// ── Public ────────────────────────────────────────────────────

export function openDatePicker(opts = {}) {
  closeDatePicker();          // only one at a time

  const initialIso = _coerceIso(opts.initial) || todayISO();
  const initial    = _parseIso(initialIso);
  const min        = opts.min ? _parseIso(_coerceIso(opts.min)) : null;
  const max        = opts.max ? _parseIso(_coerceIso(opts.max)) : null;

  const state = {
    selected: initial,                 // Date the user has picked
    viewYear: initial.getFullYear(),   // Year-month of the visible grid
    viewMonth: initial.getMonth(),
  };

  // Mount
  const root = document.createElement('div');
  root.className = 'date-picker-portal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('datePicker.label'));
  document.body.appendChild(root);

  _instance = { root, state, opts };
  _render();
  _position(opts.anchor || null);

  // Outside-click / Escape — bound on capture so they fire before
  // any modal-overlay click handlers downstream.
  document.addEventListener('mousedown', _onOutsideClick, true);
  document.addEventListener('keydown',   _onKeydown,      true);
  window.addEventListener('resize',      _onViewportChange);
  window.addEventListener('scroll',      _onViewportChange, true);

  return { close: closeDatePicker };

  function _render() {
    root.innerHTML = _renderHtml(state, min, max);

    root.querySelectorAll('[data-nav]').forEach(b => {
      b.addEventListener('click', () => {
        const delta = b.dataset.nav === 'prev' ? -1 : 1;
        let y = state.viewYear, m = state.viewMonth + delta;
        if (m < 0)  { m = 11; y -= 1; }
        if (m > 11) { m = 0;  y += 1; }
        state.viewYear = y; state.viewMonth = m;
        _render();
      });
    });

    root.querySelectorAll('[data-iso]').forEach(b => {
      if (b.disabled) return;
      b.addEventListener('click', () => _pick(b.dataset.iso));
    });

    root.querySelectorAll('[data-quick]').forEach(b => {
      b.addEventListener('click', () => _pick(b.dataset.quick));
    });
  }

  function _pick(iso) {
    if (typeof opts.onSelect === 'function') opts.onSelect(iso);
    closeDatePicker();
  }
}

export function closeDatePicker() {
  if (!_instance) return;
  document.removeEventListener('mousedown', _onOutsideClick, true);
  document.removeEventListener('keydown',   _onKeydown,      true);
  window.removeEventListener('resize',      _onViewportChange);
  window.removeEventListener('scroll',      _onViewportChange, true);
  _instance.root.remove();
  _instance = null;
}

// ── Render ────────────────────────────────────────────────────

function _renderHtml(state, min, max) {
  const monthLabel = _formatMonthYear(state.viewYear, state.viewMonth);
  const weekdays   = _weekdayLabels();
  const cells      = _buildMonthGrid(state.viewYear, state.viewMonth);
  const today      = todayISO();
  const selectedIso = _isoFromDate(state.selected);

  const quick = `
    <div class="date-picker-quick">
      <button type="button" class="date-picker-quick-btn" data-quick="${today}">
        ${t('datePicker.today')}
      </button>
      <button type="button" class="date-picker-quick-btn" data-quick="${_yesterday()}">
        ${t('datePicker.yesterday')}
      </button>
    </div>
  `;

  const header = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-nav="prev" aria-label="${t('datePicker.prevMonth')}">‹</button>
      <span class="date-picker-month">${monthLabel}</span>
      <button type="button" class="date-picker-nav" data-nav="next" aria-label="${t('datePicker.nextMonth')}">›</button>
    </div>
  `;

  const weekdaysRow = `
    <div class="date-picker-weekdays">
      ${weekdays.map(w => `<span class="date-picker-weekday">${w}</span>`).join('')}
    </div>
  `;

  const gridHtml = cells.map(cell => {
    const iso = cell.iso;
    const cls = [];
    if (cell.isOtherMonth)       cls.push('is-other-month');
    if (iso === today)           cls.push('is-today');
    if (iso === selectedIso)     cls.push('is-selected');
    const disabled =
      (min && iso < _isoFromDate(min)) ||
      (max && iso > _isoFromDate(max));
    return `
      <button type="button"
              class="date-picker-day ${cls.join(' ')}"
              data-iso="${iso}"
              ${disabled ? 'disabled' : ''}
              aria-label="${iso}">${cell.day}</button>
    `;
  }).join('');

  return `
    <div class="date-picker">
      ${quick}
      ${header}
      ${weekdaysRow}
      <div class="date-picker-grid">${gridHtml}</div>
    </div>
  `;
}

// ── Geometry / positioning ───────────────────────────────────

function _position(anchor) {
  if (!_instance) return;
  const root = _instance.root;

  // Default — centered on viewport (no anchor, no spatial anchor).
  if (!anchor) {
    root.style.top      = '50%';
    root.style.left     = '50%';
    root.style.transform = 'translate(-50%, -50%)';
    return;
  }

  const rect       = anchor.getBoundingClientRect();
  const pickerRect = root.getBoundingClientRect();
  const vw         = window.innerWidth;
  const vh         = window.innerHeight;
  const gap        = 6;      // tight enough to read as "attached"
  const edgePad    = 8;      // breathing room from the viewport edge

  // RTL-aware horizontal anchor: align the picker's INLINE-START edge
  // to the anchor's INLINE-START edge. In LTR that's left↔left; in
  // RTL it's right↔right (so the picker opens leftward, hugging the
  // field's natural reading start).
  const isRTL = getComputedStyle(anchor).direction === 'rtl' ||
                (document.documentElement.dir || '').toLowerCase() === 'rtl';

  let left = isRTL
    ? rect.right - pickerRect.width
    : rect.left;

  // Clamp horizontally inside the viewport, preserving the inline-
  // start hug as long as possible.
  if (left + pickerRect.width > vw - edgePad) left = vw - pickerRect.width - edgePad;
  if (left < edgePad)                          left = edgePad;

  // Vertical — open below if it fits, flip above if it'd be clipped.
  let top = rect.bottom + gap;
  if (top + pickerRect.height > vh - edgePad) {
    const above = rect.top - gap - pickerRect.height;
    if (above >= edgePad) top = above;
  }
  if (top < edgePad) top = edgePad;

  root.style.top       = `${top}px`;
  root.style.left      = `${left}px`;
  root.style.transform = 'none';
}

function _onViewportChange() {
  if (_instance) _position(_instance.opts.anchor || null);
}

function _onOutsideClick(e) {
  if (!_instance) return;
  if (_instance.root.contains(e.target)) return;
  if (typeof _instance.opts.onCancel === 'function') _instance.opts.onCancel();
  closeDatePicker();
}

function _onKeydown(e) {
  if (!_instance) return;
  if (e.key !== 'Escape') return;
  if (typeof _instance.opts.onCancel === 'function') _instance.opts.onCancel();
  closeDatePicker();
}

// ── Calendar helpers ─────────────────────────────────────────

// Returns 42 day cells (6 weeks × 7 days) for the given year/month.
// Each cell carries its iso date and whether it spills out of the
// focused month — used to render leading/trailing day numbers in a
// muted color so the user still sees them but knows they're "next
// to" the focused month.
function _buildMonthGrid(year, month) {
  const firstOfMonth   = new Date(year, month, 1);
  const daysThisMonth  = new Date(year, month + 1, 0).getDate();
  const daysPrevMonth  = new Date(year, month,     0).getDate();
  const firstDow       = firstOfMonth.getDay();           // 0 = Sun

  const cells = [];
  // Leading days from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysPrevMonth - i;
    const date = new Date(year, month - 1, d);
    cells.push({ day: d, iso: _isoFromDate(date), isOtherMonth: true });
  }
  // Current month
  for (let d = 1; d <= daysThisMonth; d++) {
    cells.push({ day: d, iso: _isoFromDate(new Date(year, month, d)), isOtherMonth: false });
  }
  // Trailing days into next month — pad to 42 so the grid height
  // stays constant across months.
  let next = 1;
  while (cells.length < 42) {
    const date = new Date(year, month + 1, next);
    cells.push({ day: next, iso: _isoFromDate(date), isOtherMonth: true });
    next++;
  }
  return cells;
}

function _formatMonthYear(year, month) {
  const sample = new Date(year, month, 1);
  return sample.toLocaleDateString(currentLang === 'he' ? 'he-IL' : 'en-US', {
    month: 'long',
    year:  'numeric',
  });
}

// Single-letter weekday labels, derived from the locale so they
// match the user's language without a hardcoded translation table.
function _weekdayLabels() {
  // Use a known Sunday as the anchor (2026-05-03 is a Sunday).
  const anchor = new Date(2026, 4, 3);
  const fmt    = new Intl.DateTimeFormat(currentLang === 'he' ? 'he-IL' : 'en-US', { weekday: 'short' });
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    out.push(fmt.format(d));
  }
  return out;
}

function _yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return _isoFromDate(d);
}

function _parseIso(iso) {
  // Anchor at midday so DST transitions never push the date back a day.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function _isoFromDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function _coerceIso(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}
