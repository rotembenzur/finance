// ─────────────────────────────────────────────────────────────────
//  BROKERAGE TERMS — view + edit
//
//  Renders the ⓘ affordance that sits beside a trading venue, the
//  panel it opens, and the editor behind that panel. The data lives
//  on `data.brokerageTerms` (see js/data/brokerage-terms.js), which
//  means every edit here persists to Supabase with the rest of the
//  state and is visible to the assistant's read-only SQL tool.
//
//  The panel leads with `asOf` rather than burying it: a fee schedule
//  is only as good as the date it was confirmed, and the whole reason
//  this is a record and not a hardcoded blob is that it goes stale.
//  Anything older than STALE_AFTER_MONTHS is flagged in place, so the
//  user finds out the terms need re-checking at the moment they're
//  relying on them.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { getBrokerageTermsById } from '../data/brokerage-terms.js';
import { _iconInfo } from '../utils.js';

// Past this, the panel says so. Fee schedules and benefit tracks are
// renegotiated on roughly an annual cycle, so 18 months is "you have
// probably been paying something else for a while".
const STALE_AFTER_MONTHS = 18;

// null | { id }
let _editing = null;

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const _he = () => currentLang === 'he';

// Bilingual field with a fallback: records the user adds by hand
// usually only have one side filled in, and an empty label is worse
// than the other language's.
function _pick(obj, key) {
  if (!obj) return '';
  const en = obj[`${key}En`];
  const he = obj[key];
  return (_he() ? (he || en) : (en || he)) || '';
}

function _fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(_he() ? 'he-IL' : 'en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

function _monthsSince(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return null;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

// ── The ⓘ affordance ──────────────────────────────────────────
//
// Returns '' when the venue has no terms record, so callers can splice
// it into a name line unconditionally — same contract as the holding
// description tooltip next to it.
export function renderBrokerTermsBtn(record) {
  if (!record) return '';
  const stale = _monthsSince(record.asOf);
  const isStale = stale != null && stale >= STALE_AFTER_MONTHS;
  return `
    <button class="icon-btn broker-terms-btn${isStale ? ' is-stale' : ''}"
            type="button"
            aria-label="${_esc(t('brokerTerms.open'))}"
            title="${_esc(t('brokerTerms.open'))}"
            onclick="event.stopPropagation(); openBrokerTermsModal('${_esc(record.id)}')">${_iconInfo}</button>
  `;
}

// ── View panel ────────────────────────────────────────────────

export function openBrokerTermsModal(id) {
  const data   = getAppData();
  const record = getBrokerageTermsById(data, id);
  if (!record) return;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');
  if (!overlay) return;

  _editing = null;                       // viewing, not editing

  titleEl.textContent     = _pick(record, 'name');
  saveBtnEl.style.display = 'none';      // read-only surface
  cancelEl.textContent    = t('data.close') || 'Close';
  overlay.classList.add('modal-overlay--wide');

  bodyEl.innerHTML = _renderView(record);
  overlay.classList.add('open');

  const editBtn = bodyEl.querySelector('[data-action="edit-terms"]');
  if (editBtn) editBtn.addEventListener('click', () => openEditBrokerTermsModal(record.id));
}

function _renderView(record) {
  const months  = _monthsSince(record.asOf);
  const isStale = months != null && months >= STALE_AFTER_MONTHS;

  const sections = (record.sections || []).map(sec => {
    const rows = (sec.items || []).map(item => `
      <div class="broker-terms-row">
        <span class="broker-terms-row-label"><bdi>${_esc(_pick(item, 'label'))}</bdi></span>
        <span class="broker-terms-row-value"><bdi>${_esc(item.value || '')}</bdi></span>
      </div>
    `).join('');
    return `
      <section class="broker-terms-section">
        <h4 class="broker-terms-section-title">${_esc(_pick(sec, 'title'))}</h4>
        <div class="broker-terms-rows">${rows}</div>
      </section>
    `;
  }).join('');

  const notes = (record.notes || []).length
    ? `<section class="broker-terms-notes">
         <h4 class="broker-terms-section-title">${_esc(t('brokerTerms.caveats'))}</h4>
         ${record.notes.map(n => `<p class="broker-terms-note">${_esc(_pick(n, 'text'))}</p>`).join('')}
       </section>`
    : '';

  const account = record.accountRef
    ? `<span class="broker-terms-meta-item">${_esc(t('brokerTerms.account'))} ${_esc(record.accountRef)}</span>`
    : '';
  const effective = record.effectiveFrom
    ? `<span class="broker-terms-meta-item">${_esc(t('brokerTerms.effectiveFrom'))} ${_esc(_fmtDate(record.effectiveFrom))}</span>`
    : '';
  const source = _pick(record, 'source')
    ? `<span class="broker-terms-meta-item">${_esc(_pick(record, 'source'))}</span>`
    : '';

  return `
    <div class="broker-terms">
      <div class="broker-terms-head">
        <div class="broker-terms-asof${isStale ? ' is-stale' : ''}">
          <span class="broker-terms-asof-label">${_esc(t('brokerTerms.asOf'))}</span>
          <span class="broker-terms-asof-date">${_esc(_fmtDate(record.asOf)) || '—'}</span>
        </div>
        <button class="btn btn-ghost btn-sm requires-write" type="button" data-action="edit-terms">
          ${_esc(t('action.edit'))}
        </button>
      </div>

      ${isStale ? `<p class="broker-terms-stale">${_esc(
        t('brokerTerms.staleWarning').replace('{months}', String(months))
      )}</p>` : ''}

      ${account || effective || source
        ? `<div class="broker-terms-meta">${account}${effective}${source}</div>`
        : ''}

      ${sections}
      ${notes}
    </div>
  `;
}

// ── Editor ────────────────────────────────────────────────────

export function openEditBrokerTermsModal(id) {
  const data   = getAppData();
  const record = getBrokerageTermsById(data, id);
  if (!record) return;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');
  if (!overlay) return;

  _editing = { id: record.id };

  titleEl.textContent     = t('brokerTerms.editTitle');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.add('modal-overlay--wide');

  bodyEl.innerHTML = _renderEditor(record);
  overlay.classList.add('open');

  _wireEditor(bodyEl);
}

function _itemRowHtml(item = {}) {
  return `
    <div class="bt-edit-item" data-item>
      <input class="form-input" data-field="label"   value="${_esc(item.label   || '')}" placeholder="${_esc(t('brokerTerms.f.label'))}" />
      <input class="form-input" data-field="labelEn" value="${_esc(item.labelEn || '')}" placeholder="${_esc(t('brokerTerms.f.labelEn'))}" />
      <input class="form-input" data-field="value"   value="${_esc(item.value   || '')}" placeholder="${_esc(t('brokerTerms.f.value'))}" />
      <button class="icon-btn bt-edit-remove" type="button" data-remove="item"
              aria-label="${_esc(t('action.delete'))}" title="${_esc(t('action.delete'))}">×</button>
    </div>
  `;
}

function _sectionHtml(sec = {}) {
  return `
    <fieldset class="bt-edit-section" data-section>
      <div class="bt-edit-section-head">
        <input class="form-input" data-field="title"   value="${_esc(sec.title   || '')}" placeholder="${_esc(t('brokerTerms.f.sectionTitle'))}" />
        <input class="form-input" data-field="titleEn" value="${_esc(sec.titleEn || '')}" placeholder="${_esc(t('brokerTerms.f.sectionTitleEn'))}" />
        <button class="icon-btn bt-edit-remove" type="button" data-remove="section"
                aria-label="${_esc(t('action.delete'))}" title="${_esc(t('action.delete'))}">×</button>
      </div>
      <div class="bt-edit-items" data-items>
        ${(sec.items || []).map(_itemRowHtml).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-add="item">+ ${_esc(t('brokerTerms.addRow'))}</button>
    </fieldset>
  `;
}

function _noteHtml(note = {}) {
  return `
    <div class="bt-edit-note" data-note>
      <textarea class="form-input" rows="2" data-field="text"   placeholder="${_esc(t('brokerTerms.f.note'))}">${_esc(note.text   || '')}</textarea>
      <textarea class="form-input" rows="2" data-field="textEn" placeholder="${_esc(t('brokerTerms.f.noteEn'))}">${_esc(note.textEn || '')}</textarea>
      <button class="icon-btn bt-edit-remove" type="button" data-remove="note"
              aria-label="${_esc(t('action.delete'))}" title="${_esc(t('action.delete'))}">×</button>
    </div>
  `;
}

function _renderEditor(record) {
  return `
    <div class="bt-edit" data-broker-terms-form>
      <div class="form-row">
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.name'))}</span>
          <input class="form-input" data-head="name" value="${_esc(record.name || '')}" />
        </label>
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.nameEn'))}</span>
          <input class="form-input" data-head="nameEn" value="${_esc(record.nameEn || '')}" />
        </label>
      </div>

      <div class="form-row">
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.asOf'))}</span>
          <input class="form-input" type="date" data-head="asOf" value="${_esc(record.asOf || '')}" />
        </label>
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.effectiveFrom'))}</span>
          <input class="form-input" type="date" data-head="effectiveFrom" value="${_esc(record.effectiveFrom || '')}" />
        </label>
      </div>

      <div class="form-row">
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.account'))}</span>
          <input class="form-input" data-head="accountRef" value="${_esc(record.accountRef || '')}" />
        </label>
        <label class="form-field">
          <span class="form-label">${_esc(t('brokerTerms.f.source'))}</span>
          <input class="form-input" data-head="source" value="${_esc(record.source || '')}" />
        </label>
      </div>

      <div class="bt-edit-sections" data-sections>
        ${(record.sections || []).map(_sectionHtml).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-add="section">+ ${_esc(t('brokerTerms.addSection'))}</button>

      <div class="bt-edit-notes-head">
        <span class="form-label">${_esc(t('brokerTerms.caveats'))}</span>
      </div>
      <div class="bt-edit-notes" data-notes>
        ${(record.notes || []).map(_noteHtml).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" type="button" data-add="note">+ ${_esc(t('brokerTerms.addNote'))}</button>
    </div>
  `;
}

// One delegated listener for the whole form — rows and sections are
// added and removed freely, so per-node binding would need rebinding
// on every mutation.
function _wireEditor(bodyEl) {
  bodyEl.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      if (add.dataset.add === 'item') {
        add.closest('[data-section]').querySelector('[data-items]')
           .insertAdjacentHTML('beforeend', _itemRowHtml());
      } else if (add.dataset.add === 'section') {
        bodyEl.querySelector('[data-sections]')
              .insertAdjacentHTML('beforeend', _sectionHtml({ items: [{}] }));
      } else if (add.dataset.add === 'note') {
        bodyEl.querySelector('[data-notes]')
              .insertAdjacentHTML('beforeend', _noteHtml());
      }
      return;
    }

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      e.preventDefault();
      const kind = remove.dataset.remove;
      const host = kind === 'item' ? remove.closest('[data-item]')
                 : kind === 'note' ? remove.closest('[data-note]')
                 : remove.closest('[data-section]');
      if (host) host.remove();
    }
  });
}

// ── Save wiring (modal.js router) ─────────────────────────────

export function hasPendingBrokerTermsEdit() {
  return _editing !== null;
}

export function clearPendingBrokerTermsEdit() {
  _editing = null;
}

export function applyPendingBrokerTermsEdit() {
  if (!_editing) return;
  const form = document.querySelector('[data-broker-terms-form]');
  if (!form) { _editing = null; return; }

  const data   = getAppData();
  const record = getBrokerageTermsById(data, _editing.id);
  if (!record) { _editing = null; return; }

  const head = (name) => {
    const el = form.querySelector(`[data-head="${name}"]`);
    return el ? el.value.trim() : '';
  };

  record.name          = head('name');
  record.nameEn        = head('nameEn');
  record.accountRef    = head('accountRef') || null;
  record.asOf          = head('asOf') || null;
  record.effectiveFrom = head('effectiveFrom') || null;
  record.source        = head('source') || null;

  // Drop rows the user emptied out rather than persisting blanks —
  // clearing a row's fields is how you delete it without hunting for
  // the × on a small screen.
  const val = (el, f) => {
    const n = el.querySelector(`[data-field="${f}"]`);
    return n ? n.value.trim() : '';
  };

  record.sections = [...form.querySelectorAll('[data-section]')].map(sec => ({
    title:   val(sec, 'title'),
    titleEn: val(sec, 'titleEn'),
    items: [...sec.querySelectorAll('[data-item]')].map(it => ({
      label:   val(it, 'label'),
      labelEn: val(it, 'labelEn'),
      value:   val(it, 'value'),
    })).filter(it => it.label || it.labelEn || it.value),
  })).filter(sec => sec.title || sec.titleEn || sec.items.length);

  record.notes = [...form.querySelectorAll('[data-note]')].map(n => ({
    text:   val(n, 'text'),
    textEn: val(n, 'textEn'),
  })).filter(n => n.text || n.textEn);

  record.updatedAt  = todayISO();
  data.meta.lastUpdated = todayISO();

  _editing = null;
  document.getElementById('modal-overlay').classList.remove('open');
  saveData(data);
  init();
}
