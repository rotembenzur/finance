// ─────────────────────────────────────────────────────────────────
//  RECONCILIATION FLOW
//
//  After each successful statement import, this flow reconciles the
//  card's manual quick-entries against the freshly imported charges.
//
//  Pairs the matcher grades as 'exact' (same amount, same day) are
//  near-certain duplicates and are merged AUTOMATICALLY — no prompt,
//  just a quiet toast saying how many collapsed. Only 'uncertain'
//  pairs (a near-but-not-equal amount, or a date off by a day or two)
//  open the modal, where the user picks one of three actions per pair:
//
//    ✓ Merge   — drop the manual entry; transfer the user's
//                enrichment (category, notes, displayName, recurring
//                flag) onto the imported charge.
//    ✗ Reject  — mark this pairing as "not the same purchase". The
//                imported charge id is appended to the manual entry's
//                rejectedMatches[] so we never re-suggest it.
//    ↷ Skip    — decide later. The manual entry stays untouched and
//                will be re-evaluated on the next import.
//
//  Cards are processed one-at-a-time. When a queue is passed in via
//  openReconcileQueue, each card's reconcile screen opens in turn
//  after the prior is dismissed.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { formatCurrency, calcCardPendingCharges } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { showToast } from '../components/toast.js';
import { findReconciliationCandidates } from './reconcile.js';

let _queue = [];      // pending [{cardId, newlyImportedIds}] to walk
let _open = false;    // a reconcile modal is on screen
let _decisions = new Map();   // pairKey → 'merge' | 'reject' | 'skip'
let _activeCardId = null;
let _activePairs = [];

// ── Public entry points ───────────────────────────────────────

export function openReconcileForCard(cardId, newlyImportedIds) {
  openReconcileQueue([{ cardId, newlyImportedIds }]);
}

export function openReconcileQueue(targets) {
  _queue = (targets || []).slice();
  _walkQueue();
}

export function hasPendingReconcile()   { return _open; }
export function clearPendingReconcile() { _open = false; _decisions = new Map(); _activePairs = []; _activeCardId = null; }

// Called by the modal's Save button → commit decisions, then advance.
export function applyPendingReconcile() {
  if (!_open) return false;
  _commitDecisions();
  _close();
  // Defer the next card so the modal-close transition doesn't race
  // the next modal-open.
  setTimeout(() => _walkQueue(), 50);
  return true;
}

// ── Queue walking ─────────────────────────────────────────────

function _walkQueue() {
  while (_queue.length > 0) {
    const { cardId, newlyImportedIds } = _queue.shift();
    const data = getAppData();
    const card = (data.cards || []).find(c => c.id === cardId);
    if (!card) continue;

    const pairs = findReconciliationCandidates(card, newlyImportedIds || new Set());
    if (pairs.length === 0) continue;

    // Exact pairs (same amount + same day) are duplicates — merge them
    // silently so the user never sees a manual entry double up with the
    // statement charge it represents.
    const exact     = pairs.filter(p => p.confidence === 'exact');
    const uncertain = pairs.filter(p => p.confidence !== 'exact');
    if (exact.length > 0) _autoMergeExact(cardId, exact);

    // Only ambiguous pairs are worth the user's attention.
    if (uncertain.length === 0) continue;

    _activeCardId = cardId;
    _activePairs  = uncertain;
    _decisions    = new Map(uncertain.map(p => [_key(p), 'merge']));   // default = accept
    _open = true;
    _renderModal();
    return;
  }
  // queue empty → nothing to do
}

// Silently merge near-certain duplicate pairs and tell the user how
// many collapsed. No modal — the only honest answer for "same amount,
// same day" is "yes, that's the same purchase".
function _autoMergeExact(cardId, exactPairs) {
  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === cardId);
  if (!card) return;

  const charges = card.charges || [];
  const idsToDrop = new Set();
  for (const pair of exactPairs) {
    if (_mergePairInto(charges, pair)) idsToDrop.add(pair.manual.id);
  }
  if (idsToDrop.size === 0) return;

  card.charges = charges.filter(c => !idsToDrop.has(c.id));
  card.currentSpending = calcCardPendingCharges(card);
  card.updatedAt = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  showToast({
    tone: 'info',
    message: t('reconcile.autoMerged').replace('{count}', idsToDrop.size),
  });
}

// ── Modal rendering ───────────────────────────────────────────

function _renderModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === _activeCardId);
  const cardName = card ? `•••• ${card.last4}` : '';

  titleEl.textContent     = t('reconcile.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('reconcile.apply');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.add('modal-overlay--wide');

  bodyEl.innerHTML = `
    <div class="reconcile">
      <p class="reconcile-intro">${t('reconcile.intro').replace('{card}', cardName)}</p>
      <div class="reconcile-list">
        ${_activePairs.map(p => _renderPair(p)).join('')}
      </div>
    </div>
  `;
  _wireDecisionButtons();
  overlay.classList.add('open');
}

function _renderPair(pair) {
  const key = _key(pair);
  const reasonText = pair.reasons.map(r => t('reconcile.reason.' + r)).filter(Boolean).join(' · ');
  return `
    <div class="reconcile-pair" data-key="${key}">

      <div class="reconcile-pair-confidence">
        <span class="reconcile-pair-score">${pair.score}%</span>
        <span class="reconcile-pair-reason">${_esc(reasonText)}</span>
      </div>

      <div class="reconcile-pair-cards">
        <div class="reconcile-card reconcile-card--manual">
          <div class="reconcile-card-label">${t('reconcile.manual')}</div>
          <div class="reconcile-card-name">${_esc(pair.manual.merchant || '')}</div>
          <div class="reconcile-card-meta">
            ${formatChargeDate(pair.manual.date || '')} · ${formatCurrency(pair.manual.amount || 0, { cents: true })}
          </div>
          ${pair.manual.notes ? `<div class="reconcile-card-notes">“${_esc(pair.manual.notes)}”</div>` : ''}
        </div>

        <div class="reconcile-pair-arrow" aria-hidden="true">↔</div>

        <div class="reconcile-card reconcile-card--imported">
          <div class="reconcile-card-label">${t('reconcile.imported')}</div>
          <div class="reconcile-card-name">${_esc(pair.imported.merchant || '')}</div>
          <div class="reconcile-card-meta">
            ${formatChargeDate(pair.imported.date || '')} · ${formatCurrency(pair.imported.amount || 0, { cents: true })}
          </div>
        </div>
      </div>

      <div class="reconcile-pair-actions" role="radiogroup" aria-label="${t('reconcile.decision')}">
        <button type="button" data-action="merge"  data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'merge' ? 'is-active' : ''}">${t('reconcile.action.merge')}</button>
        <button type="button" data-action="skip"   data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'skip'  ? 'is-active' : ''}">${t('reconcile.action.skip')}</button>
        <button type="button" data-action="reject" data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'reject'? 'is-active' : ''}">${t('reconcile.action.reject')}</button>
      </div>
    </div>
  `;
}

function _wireDecisionButtons() {
  document.querySelectorAll('.reconcile-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const key    = btn.dataset.key;
      const action = btn.dataset.action;
      _decisions.set(key, action);
      // Local visual update only — no full re-render to keep scroll.
      document.querySelectorAll(`.reconcile-action[data-key="${key}"]`).forEach(b =>
        b.classList.toggle('is-active', b.dataset.action === action)
      );
    });
  });
}

// ── Commit ────────────────────────────────────────────────────

function _commitDecisions() {
  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === _activeCardId);
  if (!card) return;

  const charges = card.charges || [];
  const idsToDrop = new Set();   // manual ids merged away

  for (const pair of _activePairs) {
    const decision = _decisions.get(_key(pair)) || 'skip';
    if (decision === 'merge') {
      if (_mergePairInto(charges, pair)) idsToDrop.add(pair.manual.id);
    } else if (decision === 'reject') {
      // Persist the rejection so we don't keep nagging on every
      // future import for the same pair.
      const manualIdx = charges.findIndex(c => c.id === pair.manual.id);
      if (manualIdx === -1) continue;
      const m = charges[manualIdx];
      const rejected = Array.isArray(m.rejectedMatches) ? m.rejectedMatches.slice() : [];
      if (!rejected.includes(pair.imported.id)) rejected.push(pair.imported.id);
      charges[manualIdx] = { ...m, rejectedMatches: rejected };
    }
    // 'skip' → no change; will be re-evaluated next import.
  }

  card.charges = charges.filter(c => !idsToDrop.has(c.id));
  card.currentSpending = calcCardPendingCharges(card);
  card.updatedAt = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
}

// ── Helpers ──────────────────────────────────────────────────

// Transfer the manual entry's user enrichment onto its matched
// imported charge (mutating `charges` in place). We prefer the
// manual's values when set so the user's quick-entry intent wins over
// any blank field on the imported side. Returns true when the merge
// landed (so the caller knows to drop the manual entry), false when
// the imported charge has vanished.
function _mergePairInto(charges, pair) {
  const importedIdx = charges.findIndex(c => c.id === pair.imported.id);
  if (importedIdx === -1) return false;
  const imp = charges[importedIdx];
  charges[importedIdx] = {
    ...imp,
    displayName:        imp.displayName        ?? (pair.manual.displayName || pair.manual.merchant || null),
    categoryId:         imp.categoryId         ?? pair.manual.categoryId    ?? null,
    subcategoryId:      imp.subcategoryId      ?? pair.manual.subcategoryId ?? null,
    notes:              imp.notes              ?? pair.manual.notes         ?? null,
    isRecurringMonthly: imp.isRecurringMonthly || !!pair.manual.isRecurringMonthly,
  };
  return true;
}

function _close() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal-overlay').classList.remove('modal-overlay--wide');
  _open = false;
  _decisions = new Map();
  _activePairs = [];
  _activeCardId = null;
}

function _key(pair) {
  return `${pair.manual.id}__${pair.imported.id}`;
}

function _decisionFor(key) {
  return _decisions.get(key) || 'merge';
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
