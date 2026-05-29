// ─────────────────────────────────────────────────────────────────
//  REIMBURSEMENT SECTION — shared editor block for "Expected
//  reimbursement" inside the edit-charge and edit-cash-charge modals.
//
//  Self-contained: owns its working state, renders into a host
//  container, and wires its own interactivity (toggle, expected/from/
//  method inputs, link picker, unlink, manual-received). The host modal:
//
//    1. drops reimbSectionHtml(charge) into its form
//    2. calls reimbWire(getData, charge.id) after innerHTML is set
//    3. calls reimbCommit(data, charge) on save
//
//  Nothing touches `data` until commit, so cancelling the modal leaves
//  everything (including income-side flags) untouched.
//
//  See reimbursements.js for the data model + reporting contract.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import {
  REIMBURSEMENT_METHODS,
  getReimbursementCandidates,
  setIncomeReimbursementFlag,
  reimbursementReceived, reimbursementRemaining, reimbursementStatus,
} from '../reimbursements.js';

const HOST_ID = 'reimb-section';

// Working state for the open modal. Reset on every reimbInit().
let _st = null;
let _getData = null;
let _chargeId = null;

// ── Public API ───────────────────────────────────────────────────

export function reimbInit(charge) {
  const r = charge.reimbursement || null;
  const links = (r && Array.isArray(r.links)) ? r.links.map(l => ({ ...l })) : [];
  _st = {
    amount:    Math.max(0, Number(charge.amount) || 0),   // the charge's full amount
    on:        !!r,
    expected:  r ? Math.max(0, Number(r.expected) || 0) : (Math.max(0, Number(charge.amount) || 0)),
    from:      (r && r.from) || '',
    method:    (r && r.method) || '',
    manual:    (r && Number(r.receivedManual)) || 0,
    links,
    pickerOpen: false,
    prevLinkIds: new Set(links.map(l => l.txId)),
  };
}

export function reimbSectionHtml() {
  return `<div id="${HOST_ID}" class="reimb">${_innerHtml()}</div>`;
}

export function reimbWire(getData, chargeId) {
  _getData  = getData;
  _chargeId = chargeId;
  _wireInner();
}

// Persist working state onto the charge and reconcile income-side flags.
export function reimbCommit(data, charge) {
  if (!_st) return;
  _syncInputs();

  const expected = _st.on ? (_st.expected > 0 ? Math.min(_st.expected, _st.amount) : _st.amount) : 0;
  const links    = _st.on ? _st.links : [];
  const manual   = _st.on ? _st.manual : 0;
  const keep     = _st.on && (expected > 0 || links.length > 0 || manual > 0);

  // Reconcile the isReimbursement flag on incoming transactions:
  // unflag every previously-linked tx, then flag the current set.
  for (const txId of _st.prevLinkIds) setIncomeReimbursementFlag(data, txId, charge.id, false);
  if (keep) {
    for (const l of links) setIncomeReimbursementFlag(data, l.txId, charge.id, true);
  }

  if (!keep) {
    delete charge.reimbursement;
    return;
  }
  charge.reimbursement = {
    expected,
    from:   _st.from.trim() || null,
    method: _st.method || null,
    links:  links.map(l => ({ txId: l.txId, source: l.source, entryId: l.entryId || null, amount: l.amount, date: l.date || '' })),
    ...(manual > 0 ? { receivedManual: manual } : {}),
  };
}

// ── Rendering ────────────────────────────────────────────────────

function _innerHtml() {
  const toggle = `
    <label class="reimb-toggle">
      <input type="checkbox" id="reimb-on" ${_st.on ? 'checked' : ''} />
      <span class="reimb-toggle-text">
        <span class="reimb-toggle-label">${t('reimbursement.toggle')}</span>
        <span class="reimb-toggle-hint">${t('reimbursement.toggleHint')}</span>
      </span>
    </label>
  `;
  if (!_st.on) return toggle;

  const methodOptions = [
    `<option value="">${t('reimbursement.methodNone')}</option>`,
    ...REIMBURSEMENT_METHODS.map(m =>
      `<option value="${m}" ${_st.method === m ? 'selected' : ''}>${t('reimbursement.method.' + m)}</option>`),
  ].join('');

  return `
    ${toggle}
    <div class="reimb-body">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="reimb-expected">${t('reimbursement.expected')}</label>
          <input class="form-input" id="reimb-expected" type="number" min="0" step="1"
                 max="${_st.amount}" value="${_st.expected || ''}"
                 placeholder="${_st.amount}" />
          <small class="form-hint">${t('reimbursement.expectedHint').replace('{amount}', formatCurrency(_st.amount))}</small>
        </div>
        <div class="form-group">
          <label class="form-label" for="reimb-method">${t('reimbursement.method')}</label>
          <select class="form-select" id="reimb-method">${methodOptions}</select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="reimb-from">${t('reimbursement.from')}</label>
        <input class="form-input" id="reimb-from" type="text"
               value="${_esc(_st.from)}" placeholder="${t('reimbursement.fromPlaceholder')}" />
      </div>

      ${_statusHtml()}
      ${_linksHtml()}

      <div class="form-group">
        <label class="form-label" for="reimb-manual">${t('reimbursement.receivedManual')}</label>
        <input class="form-input" id="reimb-manual" type="number" min="0" step="1"
               value="${_st.manual || ''}" placeholder="0" />
        <small class="form-hint">${t('reimbursement.receivedManualHint')}</small>
      </div>
    </div>
  `;
}

// Status pill + remaining/settled line, computed from a synthetic
// charge shaped like the persisted one so it shares the canonical math.
function _statusHtml() {
  const synthetic = {
    amount: _st.amount,
    reimbursement: { expected: _st.expected || _st.amount, links: _st.links, receivedManual: _st.manual },
  };
  const status    = reimbursementStatus(synthetic);
  const remaining  = reimbursementRemaining(synthetic);
  const received   = reimbursementReceived(synthetic);
  const detail = status === 'full'
    ? t('reimbursement.settled')
    : status === 'partial'
      ? t('reimbursement.partialLine')
          .replace('{received}', formatCurrency(received))
          .replace('{remaining}', formatCurrency(remaining))
      : t('reimbursement.pendingLine').replace('{remaining}', formatCurrency(remaining));
  return `
    <div class="reimb-status reimb-status--${status}">
      <span class="reimb-status-pill">${t('reimbursement.status.' + status)}</span>
      <span class="reimb-status-detail">${detail}</span>
    </div>
  `;
}

function _linksHtml() {
  const linkedRows = _st.links.map(l => `
    <div class="reimb-link-row">
      <span class="reimb-link-info">
        <span class="reimb-link-source">${_sourceLabel(l)}</span>
        <span class="reimb-link-meta">${_fmtDate(l.date)}${l.label ? ' · ' + _esc(l.label) : ''}</span>
      </span>
      <span class="reimb-link-amount">${formatCurrency(l.amount)}</span>
      <button type="button" class="reimb-link-remove" data-txid="${_esc(l.txId)}"
              title="${t('reimbursement.unlink')}" aria-label="${t('reimbursement.unlink')}">×</button>
    </div>
  `).join('');

  let picker = '';
  if (_st.pickerOpen) {
    const candidates = getReimbursementCandidates(_getData(), { excludeChargeId: _chargeId })
      .filter(c => !_st.links.some(l => l.txId === c.txId))
      .slice(0, 50);
    picker = candidates.length === 0
      ? `<div class="reimb-picker reimb-picker--empty">${t('reimbursement.pickerEmpty')}</div>`
      : `<div class="reimb-picker">${candidates.map(c => `
          <button type="button" class="reimb-cand" data-txid="${_esc(c.txId)}">
            <span class="reimb-cand-info">
              <span class="reimb-cand-source">${_sourceLabel(c)}</span>
              <span class="reimb-cand-meta">${_fmtDate(c.date)}${c.label ? ' · ' + _esc(c.label) : ''}</span>
            </span>
            <span class="reimb-cand-amount">${formatCurrency(c.amount)}</span>
          </button>`).join('')}</div>`;
  }

  return `
    <div class="reimb-links">
      <span class="reimb-links-label">${t('reimbursement.linked')}</span>
      ${linkedRows || `<div class="reimb-links-empty">${t('reimbursement.noneLinked')}</div>`}
      <button type="button" class="btn btn-ghost btn-sm reimb-link-add" id="reimb-link-add">
        ${_st.pickerOpen ? t('reimbursement.linkClose') : t('reimbursement.linkAdd')}
      </button>
      ${picker}
    </div>
  `;
}

// ── Wiring ───────────────────────────────────────────────────────

function _wireInner() {
  const onEl = document.getElementById('reimb-on');
  if (onEl) {
    onEl.addEventListener('change', () => {
      _syncInputs();
      _st.on = onEl.checked;
      // First enable defaults the expected amount to the full charge.
      if (_st.on && !(_st.expected > 0)) _st.expected = _st.amount;
      _st.pickerOpen = false;
      _refresh();
    });
  }
  if (!_st.on) return;

  document.getElementById('reimb-link-add')?.addEventListener('click', () => {
    _syncInputs();
    _st.pickerOpen = !_st.pickerOpen;
    _refresh();
  });

  document.querySelectorAll('.reimb-cand').forEach(btn => {
    btn.addEventListener('click', () => {
      _syncInputs();
      const txId = btn.dataset.txid;
      const cand = getReimbursementCandidates(_getData(), { excludeChargeId: _chargeId })
        .find(c => c.txId === txId);
      if (cand && !_st.links.some(l => l.txId === txId)) {
        _st.links.push({ txId: cand.txId, source: cand.source, entryId: cand.entryId, amount: cand.amount, date: cand.date, label: cand.label });
      }
      _st.pickerOpen = false;
      _refresh();
    });
  });

  document.querySelectorAll('.reimb-link-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _syncInputs();
      _st.links = _st.links.filter(l => l.txId !== btn.dataset.txid);
      _refresh();
    });
  });

  // Recompute the status line live as the expected amount changes.
  document.getElementById('reimb-expected')?.addEventListener('input', () => {
    _syncInputs();
    _refreshStatusOnly();
  });
  document.getElementById('reimb-manual')?.addEventListener('input', () => {
    _syncInputs();
    _refreshStatusOnly();
  });
}

// Pull the free inputs into state before any re-render so typed values
// survive the innerHTML swap.
function _syncInputs() {
  const exp = document.getElementById('reimb-expected');
  if (exp) _st.expected = Math.max(0, Number(exp.value) || 0);
  const from = document.getElementById('reimb-from');
  if (from) _st.from = from.value;
  const method = document.getElementById('reimb-method');
  if (method) _st.method = method.value;
  const manual = document.getElementById('reimb-manual');
  if (manual) _st.manual = Math.max(0, Number(manual.value) || 0);
}

function _refresh() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  host.innerHTML = _innerHtml();
  _wireInner();
}

// Cheaper refresh for the status line only — avoids stealing focus
// from the number input the user is actively typing in.
function _refreshStatusOnly() {
  const host = document.getElementById(HOST_ID);
  const cur  = host?.querySelector('.reimb-status');
  if (!cur) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _statusHtml();
  cur.replaceWith(tmp.firstElementChild);
}

// ── Helpers ──────────────────────────────────────────────────────

function _sourceLabel(linkOrCand) {
  if (linkOrCand.source === 'wallet' && linkOrCand.entryName) return _esc(linkOrCand.entryName);
  return t('reimbursement.source.' + linkOrCand.source) || _esc(linkOrCand.source);
}

function _fmtDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [, m, day] = s.split('-');
  return (day && m) ? `${day}.${m}` : _esc(s);
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
