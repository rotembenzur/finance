// ─────────────────────────────────────────────────────────────────
//  EDIT AMOUNT — minimal modal for editing the only fields the user
//  is allowed to mutate today: an entry's balance / current value,
//  and per-track values for products that hold multiple investment
//  paths (currently the Harel pension).
//
//  Structural metadata (name, type, institution, provider, track
//  names, fees, etc.) is intentionally read-only — it lives in the
//  data files. When the time comes to add full CRUD back, that flow
//  will be designed deliberately. This module exists in the
//  meantime so day-to-day balance updates don't require editing
//  data/state.local.js by hand.
//
//  The flow rides the existing modal-overlay shell:
//    openEditAmountModal(id) → user types → handleModalSave() in
//    modal.js routes via hasPendingAmountEdit() → applyPendingAmountEdit()
//    runs updateEntry() → init() re-renders.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { updateEntry } from '../app.js';
import { formatCurrency, getBanks, getBankDisplayName } from '../utils.js';
import { todayISO, generateId } from '../store.js';

let _editEntryId = null;


// ── Public API ───────────────────────────────────────────────────

export function openEditAmountModal(entryId) {
  const entry = getAppData().entries.find(e => e.id === entryId);
  if (!entry) return;

  _editEntryId = entryId;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editAmount.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  // Any entry with a `tracks` array gets the multi-track editor —
  // even with a single track, so the user can rename or refee it.
  // Entries with a flat `trackName` string use the single-amount
  // form's path-editing extension instead.
  const isMultiTrack = Array.isArray(entry.tracks) && entry.tracks.length > 0;
  bodyEl.innerHTML = isMultiTrack
    ? _renderTracksForm(entry)
    : _renderSingleAmountForm(entry);

  if (isMultiTrack) _wireTotalToTrackPreviews(entry);
  if (!isMultiTrack && _hasAnnualLimit(entry)) _wireAnnualLimitInputs(entry);
  if (_canShowRecurringSection(entry)) _wireRecurringToggle();

  overlay.classList.add('open');

  // Focus first input
  setTimeout(() => {
    const first = bodyEl.querySelector('input');
    if (first) { first.focus(); first.select(); }
  }, 50);
}

export function hasPendingAmountEdit() {
  return _editEntryId !== null;
}

export function clearPendingAmountEdit() {
  _editEntryId = null;
}

export function applyPendingAmountEdit() {
  if (!_editEntryId) return false;

  const entry = getAppData().entries.find(e => e.id === _editEntryId);
  if (!entry) { _editEntryId = null; return false; }

  const errorEl = document.getElementById('f-edit-error');
  const isMultiTrack = Array.isArray(entry.tracks) && entry.tracks.length > 0;

  if (isMultiTrack) {
    // Single total input → proportionally distribute across tracks
    // by their existing percentage share. The user enters ONE number
    // (the fund's new total value); the system splits it. Track
    // names remain individually editable; `fee` is left intact.
    const amountInp = document.getElementById('f-amount');
    const newTotal  = parseFloat(amountInp?.value);
    if (isNaN(newTotal) || newTotal < 0) {
      _showFormError(errorEl, t('editAmount.invalid'), amountInp);
      return false;
    }

    const oldTotal = entry.tracks.reduce((s, tr) => s + (tr.value || 0), 0);

    const newTracks = entry.tracks.map((tr, idx) => {
      // Distribute: tracks keep their existing proportion of the
      // total. If the old total was 0 (uninitialized), split evenly.
      const nextValue = oldTotal > 0
        ? (newTotal * (tr.value || 0) / oldTotal)
        : (newTotal / entry.tracks.length);

      const nameInp = document.getElementById(`f-track-name-${idx}`);
      const next = { ...tr, value: nextValue };
      if (nameInp) {
        const newName = nameInp.value.trim();
        if (currentLang === 'he') next.name   = newName || null;
        else                       next.nameEn = newName || null;
      }
      return next;
    });

    // Recurring transfer (same path the single-amount branch takes —
    // mutate appData.recurring[] in place before updateEntry triggers
    // the persistence).
    if (_canShowRecurringSection(entry)) {
      const ok = _applyRecurringChanges(entry, getAppData(), errorEl);
      if (!ok) return false;
    }

    // currentValue is the exact typed total — the per-track sum may
    // drift by floating-point ε under proportional scaling but the
    // displayed total stays clean.
    updateEntry(_editEntryId, { tracks: newTracks, currentValue: newTotal });

  } else {
    const inp = document.getElementById('f-amount');
    const v = parseFloat(inp?.value);
    if (isNaN(v) || v < 0) {
      _showFormError(errorEl, t('editAmount.invalid'), inp);
      return false;
    }
    const usesBalance = entry.balance !== null && entry.balance !== undefined;
    const fields = usesBalance ? { balance: v } : { currentValue: v };

    // Single-track entries (study fund, provident, investment
    // gemel) carry their path as the flat `trackName` / `trackNameEn`
    // string. When the form rendered a track-name input, route the
    // edit to the current-language field so what the user sees is
    // what they save.
    if (_hasSingleTrack(entry)) {
      const trackInp = document.getElementById('f-track-name');
      if (trackInp) {
        const newTrackName = trackInp.value.trim();
        if (currentLang === 'he') fields.trackName   = newTrackName || null;
        else                       fields.trackNameEn = newTrackName || null;
      }
    }

    // Annual-limit-bearing entries (Investment Gemel today; any
    // future tax-advantaged account with `annualLimit` will be
    // picked up automatically) also persist their yearly fields.
    // Inputs are independent — no auto-sync. The user types each
    // value as it appears on their tax statement; we save what they
    // typed and stamp the reference date as today.
    if (_hasAnnualLimit(entry)) {
      const dInp = document.getElementById('f-yearly-deposited');
      const lInp = document.getElementById('f-annual-limit');
      const rInp = document.getElementById('f-remaining');

      const fieldPairs = [
        ['yearlyDeposited',    dInp],
        ['annualLimit',        lInp],
        ['remainingAllowance', rInp],
      ];
      for (const [key, el] of fieldPairs) {
        if (!el) continue;
        if (el.value === '') { fields[key] = null; continue; }
        const parsed = parseFloat(el.value);
        if (isNaN(parsed) || parsed < 0) {
          _showFormError(errorEl, t('editAmount.invalid'), el);
          return false;
        }
        fields[key] = parsed;
      }
      fields.limitReferenceDate = todayISO();
    }

    // Recurring transfer — mutate data.recurring[] in place on the
    // live appData reference BEFORE updateEntry() triggers saveData().
    // Validation errors bail out of the whole apply.
    if (_canShowRecurringSection(entry)) {
      const ok = _applyRecurringChanges(entry, getAppData(), errorEl);
      if (!ok) return false;
    }

    updateEntry(_editEntryId, fields);
  }

  _editEntryId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}


// ── Form builders ────────────────────────────────────────────────

function _renderSingleAmountForm(entry) {
  const usesBalance = entry.balance !== null && entry.balance !== undefined;
  const value       = usesBalance ? entry.balance : entry.currentValue;
  const label       = usesBalance ? t('editAmount.balance') : t('editAmount.amount');

  const annualHtml    = _hasAnnualLimit(entry) ? _renderAnnualLimitSection(entry) : '';
  const singleTrackHtml = _hasSingleTrack(entry) ? _renderSingleTrackSection(entry) : '';
  const recurringHtml = _canShowRecurringSection(entry)
    ? _renderRecurringSection(entry, _findRecurring(entry.id, getAppData()))
    : '';

  return `
    <div class="edit-amount">
      <div class="edit-amount-name">${_esc(entry.name || '')}</div>
      <div class="form-group">
        <label class="form-label" for="f-amount">${label}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-amount" type="number" min="0" step="0.01" value="${value ?? ''}" />
        </div>
      </div>
      ${singleTrackHtml}
      ${annualHtml}
      ${recurringHtml}
      <p id="f-edit-error" class="form-error" style="display:none"></p>
    </div>
  `;
}

// Investment path section — exposed when the entry stores its track
// as a flat `trackName` / `trackNameEn` (study fund, provident
// fund, investment gemel). Editing writes back to the current-
// language field; the other-language value is preserved.
function _renderSingleTrackSection(entry) {
  const shownName = currentLang === 'he'
    ? (entry.trackName   || entry.trackNameEn || '')
    : (entry.trackNameEn || entry.trackName   || '');

  return `
    <div class="edit-amount-section-divider"></div>
    <div class="edit-amount-section-label">${t('editAmount.investmentPath')}</div>
    <div class="form-group">
      <label class="form-label" for="f-track-name">${t('editAmount.trackName')}</label>
      <input class="form-input" id="f-track-name" type="text" value="${_esc(shownName)}" />
    </div>
  `;
}

function _hasSingleTrack(entry) {
  if (Array.isArray(entry.tracks) && entry.tracks.length > 0) return false;
  return !!(entry.trackName || entry.trackNameEn);
}

// Yearly-contribution fields — shown only for entries that already
// carry `annualLimit` (Investment Gemel today; the same shape will
// pick up any future tax-advantaged annual-limit-bearing entry).
function _renderAnnualLimitSection(entry) {
  return `
    <div class="edit-amount-section-divider"></div>
    <div class="edit-amount-section-label">${t('editAmount.yearlySection')}</div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="f-yearly-deposited">${t('editAmount.yearlyDeposited')}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-yearly-deposited" type="number" min="0" step="0.01" value="${entry.yearlyDeposited ?? ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-annual-limit">${t('editAmount.annualLimit')}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-annual-limit" type="number" min="0" step="0.01" value="${entry.annualLimit ?? ''}" />
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="f-remaining">${t('editAmount.remaining')}</label>
      <div class="input-with-symbol">
        <span class="currency-symbol">₪</span>
        <input class="form-input" id="f-remaining" type="number" min="0" step="0.01" value="${entry.remainingAllowance ?? ''}" />
      </div>
      <small class="form-hint" id="f-annual-hint"></small>
    </div>
  `;
}

function _hasAnnualLimit(entry) {
  return entry.annualLimit !== null && entry.annualLimit !== undefined;
}

// ── Recurring transfer section ──────────────────────────────────
//
// Renders a "Recurring transfer (הוראת קבע)" block whenever the
// entry already has a linked recurring transfer in data.recurring[]
// OR is a type where one would normally exist (pension / study
// fund / provident fund / investment gemel / savings). The block
// lets the user edit amount, source bank, cycle, and an active
// toggle, and creates the recurring row on demand if one doesn't
// exist yet.
//
// Recurring frequency: monthly is the only cycle the rest of the
// app currently surfaces, but the select keeps a few extras so the
// data model and future UI can grow without another schema bump.
const _RECURRING_ELIGIBLE_TYPES = new Set([
  'pension', 'study_fund', 'provident_fund', 'investment_gemel', 'savings',
]);

const _RECURRING_CYCLES = ['monthly', 'biweekly', 'weekly', 'quarterly', 'yearly'];

function _canShowRecurringSection(entry) {
  if (!entry) return false;
  const data = getAppData();
  if (_findRecurring(entry.id, data)) return true;
  return _RECURRING_ELIGIBLE_TYPES.has(entry.type);
}

function _findRecurring(entryId, data) {
  return (data.recurring || []).find(r => r.toEntryId === entryId) || null;
}

function _renderRecurringSection(entry, recurring) {
  const data = getAppData();
  const banks = getBanks(data);

  const amountVal   = recurring ? (recurring.amount ?? '') : '';
  const cycleVal    = recurring ? (recurring.cycle  || 'monthly') : 'monthly';
  const fromBankVal = recurring ? (recurring.fromBankId || '') : '';
  const isActive    = recurring ? !!recurring.isActive : false;

  const cycleOptions = _RECURRING_CYCLES.map(c =>
    `<option value="${c}" ${c === cycleVal ? 'selected' : ''}>${t('editAmount.recurringCycle.' + c)}</option>`
  ).join('');

  const bankOptions = [
    `<option value="">${t('editAmount.recurringPickBank')}</option>`,
    ...banks.map(b =>
      `<option value="${b.id}" ${b.id === fromBankVal ? 'selected' : ''}>${_esc(getBankDisplayName(b))}</option>`
    ),
  ].join('');

  return `
    <div class="edit-amount-section-divider"></div>
    <label class="edit-amount-section-toggle">
      <input type="checkbox" id="f-recurring-active" ${isActive ? 'checked' : ''} />
      <span class="edit-amount-section-label">${t('editAmount.recurringSection')}</span>
    </label>
    <small class="form-hint">${t('editAmount.recurringHint')}</small>

    <div class="edit-amount-recurring" id="f-recurring-fields" ${isActive ? '' : 'data-collapsed="1"'}>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-recurring-amount">${t('editAmount.recurringAmount')}</label>
          <div class="input-with-symbol">
            <span class="currency-symbol">₪</span>
            <input class="form-input" id="f-recurring-amount" type="number" min="0" step="0.01" value="${amountVal}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-recurring-cycle">${t('editAmount.recurringFrequency')}</label>
          <select class="form-select" id="f-recurring-cycle">
            ${cycleOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-recurring-bank">${t('editAmount.recurringSource')}</label>
        <select class="form-select" id="f-recurring-bank">
          ${bankOptions}
        </select>
      </div>
    </div>
  `;
}

// Show/hide the body of the section based on the Active checkbox.
// Kept visual-only — the apply step also gates on the same checkbox
// so a collapsed-but-filled section doesn't silently persist.
function _wireRecurringToggle() {
  const cb     = document.getElementById('f-recurring-active');
  const fields = document.getElementById('f-recurring-fields');
  if (!cb || !fields) return;
  const update = () => {
    if (cb.checked) fields.removeAttribute('data-collapsed');
    else            fields.setAttribute('data-collapsed', '1');
  };
  cb.addEventListener('change', update);
  update();
}

// Validate + persist the recurring section. Returns true on success,
// false on validation error (with the error surfaced inline).
// Mutates data.recurring[] in place; the caller's updateEntry() flow
// is what actually triggers saveData() + init().
function _applyRecurringChanges(entry, data, errorEl) {
  const cb = document.getElementById('f-recurring-active');
  if (!cb) return true;            // section wasn't rendered

  const existing = _findRecurring(entry.id, data);
  const recurringArr = (data.recurring = data.recurring || []);

  if (!cb.checked) {
    // Toggle off: keep the record but flag inactive so the meta line
    // hides it and history isn't lost. If there was nothing, nothing
    // to do.
    if (existing) existing.isActive = false;
    return true;
  }

  const amountInp = document.getElementById('f-recurring-amount');
  const cycleInp  = document.getElementById('f-recurring-cycle');
  const bankInp   = document.getElementById('f-recurring-bank');
  const amount    = parseFloat(amountInp?.value);
  const cycle     = cycleInp?.value || 'monthly';
  const fromBank  = bankInp?.value || '';

  if (!Number.isFinite(amount) || amount <= 0) {
    _showFormError(errorEl, t('editAmount.recurringInvalidAmount'), amountInp);
    return false;
  }
  if (!fromBank) {
    _showFormError(errorEl, t('editAmount.recurringMissingBank'), bankInp);
    return false;
  }
  if (!_RECURRING_CYCLES.includes(cycle)) {
    _showFormError(errorEl, t('editAmount.recurringInvalidCycle'), cycleInp);
    return false;
  }

  if (existing) {
    existing.amount     = amount;
    existing.cycle      = cycle;
    existing.fromBankId = fromBank;
    existing.isActive   = true;
  } else {
    const entryName = entry.name || entry.nameEn || '';
    recurringArr.push({
      id:         generateId('rec'),
      name:       _defaultRecurringName(entryName, cycle, 'he'),
      nameEn:     _defaultRecurringName(entryName, cycle, 'en'),
      amount,
      cycle,
      fromBankId: fromBank,
      toEntryId:  entry.id,
      type:       _defaultRecurringType(entry),
      currency:   'ILS',
      isActive:   true,
    });
  }
  return true;
}

function _defaultRecurringName(entryName, cycle, lang) {
  const cyclePart = (lang === 'he')
    ? { monthly: 'הפקדה חודשית', biweekly: 'הפקדה דו־שבועית', weekly: 'הפקדה שבועית', quarterly: 'הפקדה רבעונית', yearly: 'הפקדה שנתית' }[cycle] || 'הפקדה'
    : { monthly: 'Monthly contribution', biweekly: 'Biweekly contribution', weekly: 'Weekly contribution', quarterly: 'Quarterly contribution', yearly: 'Yearly contribution' }[cycle] || 'Contribution';
  return entryName ? `${cyclePart} — ${entryName}` : cyclePart;
}

function _defaultRecurringType(entry) {
  if (['pension', 'study_fund', 'provident_fund', 'investment_gemel'].includes(entry.type)) {
    return 'investment_contribution';
  }
  if (entry.type === 'savings') return 'savings_contribution';
  return 'contribution';
}

// Live math-check hint — runs the user's three values through
// (limit − deposited) and flags when they don't reconcile. No
// auto-write to other inputs; this is purely advisory.
function _wireAnnualLimitInputs(entry) {
  const dInp = document.getElementById('f-yearly-deposited');
  const lInp = document.getElementById('f-annual-limit');
  const rInp = document.getElementById('f-remaining');
  const hint = document.getElementById('f-annual-hint');
  if (!dInp || !lInp || !rInp || !hint) return;

  const update = () => {
    const d = parseFloat(dInp.value);
    const l = parseFloat(lInp.value);
    const r = parseFloat(rInp.value);
    if (isNaN(d) || isNaN(l) || isNaN(r)) { hint.textContent = ''; return; }
    const expected = l - d;
    const diff = Math.abs(expected - r);
    if (diff < 0.5) {
      hint.textContent = t('editAmount.annualReconciled');
      hint.classList.remove('form-hint--warning');
    } else {
      hint.textContent = t('editAmount.annualMismatch').replace('{expected}', formatCurrency(expected));
      hint.classList.add('form-hint--warning');
    }
  };

  [dInp, lInp, rInp].forEach(el => el.addEventListener('input', update));
  update();
}

function _renderTracksForm(entry) {
  const total = entry.tracks.reduce((s, tr) => s + (tr.value || 0), 0);

  const rows = entry.tracks.map((tr, idx) => {
    const shownName = currentLang === 'he'
      ? (tr.name   || tr.nameEn || '')
      : (tr.nameEn || tr.name   || '');
    const pct = total > 0 ? ((tr.value || 0) / total * 100).toFixed(1) : '0.0';
    return `
      <div class="edit-track-row">
        <div class="edit-track-row-head">
          <span class="edit-track-pct">${pct}%</span>
          <span class="edit-track-preview" id="f-track-preview-${idx}">${formatCurrency(tr.value || 0)}</span>
        </div>
        <div class="form-group">
          <label class="form-label form-label--sm" for="f-track-name-${idx}">${t('editAmount.trackName')}</label>
          <input class="form-input" id="f-track-name-${idx}" type="text" value="${_esc(shownName)}" />
        </div>
      </div>
    `;
  }).join('');

  const recurringHtml = _canShowRecurringSection(entry)
    ? _renderRecurringSection(entry, _findRecurring(entry.id, getAppData()))
    : '';

  return `
    <div class="edit-amount">
      <div class="edit-amount-name">${_esc(entry.name || '')}</div>
      <div class="form-group">
        <label class="form-label" for="f-amount">${t('editAmount.amount')}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-amount" type="number" min="0" step="0.01" value="${total}" />
        </div>
        <small class="form-hint">${t('editAmount.proportionalHint')}</small>
      </div>
      <div class="edit-amount-section-divider"></div>
      <div class="edit-amount-section-label">${t('editAmount.paths')}</div>
      <div class="edit-tracks">${rows}</div>
      ${recurringHtml}
      <p id="f-edit-error" class="form-error" style="display:none"></p>
    </div>
  `;
}

// Live preview: as the user types the total amount, recompute each
// track's projected value (current percentage × new total) and
// update the small preview badge above the track name. Doesn't
// touch anything else — pure display sugar.
function _wireTotalToTrackPreviews(entry) {
  const totalInp = document.getElementById('f-amount');
  if (!totalInp) return;

  const oldTotal = entry.tracks.reduce((s, tr) => s + (tr.value || 0), 0);

  const update = () => {
    const v = parseFloat(totalInp.value);
    const next = isNaN(v) || v < 0 ? null : v;
    entry.tracks.forEach((tr, idx) => {
      const previewEl = document.getElementById(`f-track-preview-${idx}`);
      if (!previewEl) return;
      let projected;
      if (next == null) {
        projected = tr.value || 0;
      } else if (oldTotal > 0) {
        projected = next * (tr.value || 0) / oldTotal;
      } else {
        projected = next / entry.tracks.length;
      }
      previewEl.textContent = formatCurrency(projected);
    });
  };

  totalInp.addEventListener('input', update);
}


// ── Helpers ──────────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _showFormError(errorEl, message, focusEl) {
  if (errorEl) {
    errorEl.textContent  = message;
    errorEl.style.display = 'block';
  }
  focusEl?.focus();
}
