// ─────────────────────────────────────────────────────────────────
//  BANK TRANSACTION RECONCILIATION FLOW
//
//  Runs right after a bank-statement import. It looks for manual
//  bank-account entries (the quick-income deposits you logged by hand)
//  that the freshly-imported statement now also contains, so the same
//  deposit doesn't end up recorded twice.
//
//  Mirrors the credit-card reconcile flow (../reconcile-flow.js) and
//  REUSES its matcher (../reconcile.js → findDuplicateCandidates /
//  scorePair), so the matching logic, thresholds, and confidence tiers
//  live in exactly one place:
//
//    · 'exact'     (amount equal to the agora AND same calendar day) →
//                  merged AUTOMATICALLY with a quiet toast. No prompt —
//                  "same amount, same day" is a duplicate with
//                  near-certainty.
//    · 'uncertain' (amount within ±2%/₪5, or a date a day or two off) →
//                  shown in a confirmation modal where you Merge / Skip
//                  / Reject each pair.
//
//  Merging transfers your enrichment (the name you typed, income
//  category, notes) onto the imported row and drops the manual one.
//  Rejecting remembers the pairing (rejectedMatches[]) so it's never
//  suggested again. No candidates → nothing happens, so the import
//  flow is never interrupted without reason.
//
//  Routed through the shared modal shell: modal.js dispatches Save via
//  hasPendingBankReconcile / applyPendingBankReconcile.
// ─────────────────────────────────────────────────────────────────

import { t } from '../../i18n.js';
import { getAppData } from '../../state.js';
import { saveData, todayISO } from '../../store.js';
import { init } from '../../app.js';
import { formatCurrency } from '../../utils.js';
import { formatChargeDate } from '../../dates.js';
import { showToast } from '../../components/toast.js';
import { findDuplicateCandidates } from '../reconcile.js';

let _open = false;
let _pairs = [];                 // uncertain pairs awaiting a decision
let _decisions = new Map();      // pairKey → 'merge' | 'skip' | 'reject'
let _accountLabel = '';

// ── Public entry point ─────────────────────────────────────────

// Called by bank-import-flow after a statement is applied. `account`
// is result.account (carries bankId for same-account scoping);
// `newlyImportedIds` is a Set of the tx ids just upserted.
export function openBankReconcile(account, newlyImportedIds) {
  const data = getAppData();
  const txs  = data.bankTransactions || [];
  const ids  = newlyImportedIds instanceof Set ? newlyImportedIds : new Set();

  // Manual deposits for the SAME bank as this import. A manual tx links
  // to its institution via bankId — its accountId is an entries[] id, a
  // different namespace from imported txs' bankAccounts[] id — so bankId
  // is the reliable same-account key. (Falls back to all manual txs if
  // the import couldn't detect a bankId.)
  const bankId = account && account.bankId;
  const manual   = txs.filter(tx => tx.source === 'manual' && (!bankId || tx.bankId === bankId));
  const imported = txs.filter(tx => ids.has(tx.id));

  const pairs = findDuplicateCandidates(manual, imported);
  if (pairs.length === 0) return;

  const exact     = pairs.filter(p => p.confidence === 'exact');
  const uncertain = pairs.filter(p => p.confidence !== 'exact');

  if (exact.length > 0) _autoMergeExact(exact);

  // Only borderline pairs are worth the user's attention.
  if (uncertain.length === 0) return;

  _pairs        = uncertain;
  _decisions    = new Map(uncertain.map(p => [_key(p), 'merge']));   // default = accept
  _accountLabel = _describeAccount(account);
  _open = true;
  _renderModal();
}

export function hasPendingBankReconcile()   { return _open; }
export function clearPendingBankReconcile() { _open = false; _pairs = []; _decisions = new Map(); }

// Modal Save → commit decisions, then close.
export function applyPendingBankReconcile() {
  if (!_open) return false;
  _commitDecisions();
  _close();
  return true;
}

// ── Auto-merge near-certain duplicates ─────────────────────────

function _autoMergeExact(exactPairs) {
  const data = getAppData();
  const txs  = data.bankTransactions || [];
  const drop = new Set();
  for (const pair of exactPairs) {
    if (_mergeInto(txs, pair)) drop.add(pair.manual.id);
  }
  if (drop.size === 0) return;

  data.bankTransactions = txs.filter(tx => !drop.has(tx.id));
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
  showToast({ tone: 'info', message: t('bankReconcile.autoMerged').replace('{count}', drop.size) });
}

// ── Commit user decisions from the modal ───────────────────────

function _commitDecisions() {
  const data = getAppData();
  const txs  = data.bankTransactions || [];
  const drop = new Set();   // manual ids merged away

  for (const pair of _pairs) {
    const decision = _decisions.get(_key(pair)) || 'skip';
    if (decision === 'merge') {
      if (_mergeInto(txs, pair)) drop.add(pair.manual.id);
    } else if (decision === 'reject') {
      // Persist the rejection so this pairing isn't suggested again.
      const idx = txs.findIndex(tx => tx.id === pair.manual.id);
      if (idx === -1) continue;
      const m = txs[idx];
      const rejected = Array.isArray(m.rejectedMatches) ? m.rejectedMatches.slice() : [];
      if (!rejected.includes(pair.imported.id)) rejected.push(pair.imported.id);
      txs[idx] = { ...m, rejectedMatches: rejected };
    }
    // 'skip' → leave the manual entry untouched; re-evaluated next import.
  }

  if (drop.size > 0) data.bankTransactions = txs.filter(tx => !drop.has(tx.id));
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
}

// Transfer the manual deposit's user enrichment onto its matched
// imported tx (mutates `txs` in place), then the manual one is dropped
// by the caller. Existing imported values win so we never clobber
// something already set; the manual's typed name becomes the row's
// userLabel when it differs from the bank's raw text. We do NOT touch
// the account balance: the manual quick-income already added the money
// to entries[].balance, and imports don't feed that field, so the
// balance stays correct after the manual record is removed.
// Returns true when the merge landed (imported tx still present).
function _mergeInto(txs, pair) {
  const idx = txs.findIndex(tx => tx.id === pair.imported.id);
  if (idx === -1) return false;
  const imp = txs[idx];
  const man = pair.manual;
  const manualName = (man.userLabel || man.description || '').trim();

  txs[idx] = {
    ...imp,
    userLabel:        imp.userLabel ?? (manualName && manualName !== imp.description ? manualName : null),
    incomeCategoryId: imp.incomeCategoryId ?? man.incomeCategoryId ?? null,
    notes:            imp.notes ?? man.notes ?? null,
    // Audit trail: which manual entry collapsed into this row.
    mergedManualId:   man.id,
  };
  return true;
}

// ── Modal rendering ───────────────────────────────────────────

function _renderModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankReconcile.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('reconcile.apply');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.add('modal-overlay--wide');

  bodyEl.innerHTML = `
    <div class="reconcile">
      <p class="reconcile-intro">${t('bankReconcile.intro').replace('{account}', _esc(_accountLabel))}</p>
      <div class="reconcile-list">
        ${_pairs.map(_renderPair).join('')}
      </div>
    </div>
  `;
  _wireDecisionButtons();
  overlay.classList.add('open');
}

function _renderPair(pair) {
  const key = _key(pair);
  const reasonText = pair.reasons.map(r => t('bankReconcile.reason.' + r)).filter(Boolean).join(' · ');
  const manualName   = pair.manual.userLabel   || pair.manual.description   || '';
  const importedName = pair.imported.userLabel || pair.imported.description || '';

  return `
    <div class="reconcile-pair" data-key="${key}">

      <div class="reconcile-pair-confidence">
        <span class="reconcile-pair-score">${pair.score}%</span>
        <span class="reconcile-pair-reason">${_esc(reasonText)}</span>
      </div>

      <div class="reconcile-pair-cards">
        <div class="reconcile-card reconcile-card--manual">
          <div class="reconcile-card-label">${t('bankReconcile.manual')}</div>
          <div class="reconcile-card-name">${_esc(manualName)}</div>
          <div class="reconcile-card-meta">
            ${formatChargeDate(pair.manual.date || '')} · ${formatCurrency(pair.manual.amount || 0, { cents: true })}
          </div>
          ${pair.manual.notes ? `<div class="reconcile-card-notes">“${_esc(pair.manual.notes)}”</div>` : ''}
        </div>

        <div class="reconcile-pair-arrow" aria-hidden="true">↔</div>

        <div class="reconcile-card reconcile-card--imported">
          <div class="reconcile-card-label">${t('bankReconcile.imported')}</div>
          <div class="reconcile-card-name">${_esc(importedName)}</div>
          <div class="reconcile-card-meta">
            ${formatChargeDate(pair.imported.date || '')} · ${formatCurrency(pair.imported.amount || 0, { cents: true })}
          </div>
        </div>
      </div>

      <div class="reconcile-pair-actions" role="radiogroup" aria-label="${t('reconcile.decision')}">
        <button type="button" data-action="merge"  data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'merge'  ? 'is-active' : ''}">${t('reconcile.action.merge')}</button>
        <button type="button" data-action="skip"   data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'skip'   ? 'is-active' : ''}">${t('reconcile.action.skip')}</button>
        <button type="button" data-action="reject" data-key="${key}" class="reconcile-action ${_decisionFor(key) === 'reject' ? 'is-active' : ''}">${t('reconcile.action.reject')}</button>
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
      // Local visual update only — no full re-render, so scroll is kept.
      document.querySelectorAll(`.reconcile-action[data-key="${key}"]`).forEach(b =>
        b.classList.toggle('is-active', b.dataset.action === action)
      );
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────

function _describeAccount(account) {
  if (!account) return '';
  const parts = [account.branch, account.accountNumber].filter(Boolean);
  return parts.length ? parts.join(' / ') : (account.bankId || '');
}

function _close() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.classList.remove('modal-overlay--wide');
  _open = false;
  _pairs = [];
  _decisions = new Map();
}

function _key(pair)        { return `${pair.manual.id}__${pair.imported.id}`; }
function _decisionFor(key) { return _decisions.get(key) || 'merge'; }

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
