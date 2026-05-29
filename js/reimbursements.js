// ─────────────────────────────────────────────────────────────────
//  REIMBURSEMENTS — "this expense wasn't really mine" bookkeeping
//
//  Real-life case: you pay ₪30 for challah on your credit card, and
//  your mom sends the ₪30 back via Bit. The card charge is real money
//  that left your card, and the Bit payment is real money that landed
//  in your wallet — but neither is your spending or your income. It's
//  a settlement that closes the loop.
//
//  Model (all additive + optional, so no migration is needed):
//
//    On an EXPENSE charge (card.charges[] or cash/wallet entry.charges[]):
//      reimbursement: {
//        expected,        // ₪ portion that isn't yours (full = whole
//                         //   amount, or a partial slice e.g. 40 of 100)
//        from,            // free text: "Mom", "work", a friend's name
//        method,          // one of REIMBURSEMENT_METHODS — how you
//                         //   expect it back (bit/paybox/bank/cash/other)
//        links: [ { txId, source, entryId, amount, date } ],
//                         //   actual incoming payments linked later
//        receivedManual,  // optional ₪ received that isn't a tracked tx
//      }
//
//    On the linked INCOMING transaction (wallet/cash 'in' charge or a
//    bank credit): isReimbursement: true + reimbursesId (the expense id).
//
//  Reporting contract (see intelligence/spending.js + activity modules):
//    • Real spending counts amount − expected (the not-mine slice drops
//      out the moment you mark it; see effectiveExpenseAmount).
//    • Real income excludes isReimbursement transactions (a settlement,
//      not income).
//    • Balances and card-pending are left ALONE — the money genuinely
//      moved, you still owe the card, the wallet balance still rose.
//      Only the spending/income *reporting* nets out.
// ─────────────────────────────────────────────────────────────────

import { getWalletEntries, getCashEntries } from './utils.js';

// Expected reimbursement methods, in display order. UI maps these to
// localized labels via `reimbursement.method.<id>` i18n keys.
export const REIMBURSEMENT_METHODS = ['bit', 'paybox', 'bank', 'cash', 'other'];

// ── Readers ──────────────────────────────────────────────────────

export function getReimbursement(charge) {
  return charge && charge.reimbursement ? charge.reimbursement : null;
}

export function reimbursementExpected(charge) {
  const r = getReimbursement(charge);
  return r ? Math.max(0, Number(r.expected) || 0) : 0;
}

// Total actually settled: linked incoming payments + any manually
// recorded amount (for reimbursements that aren't tracked transactions).
export function reimbursementReceived(charge) {
  const r = getReimbursement(charge);
  if (!r) return 0;
  const linked = Array.isArray(r.links)
    ? r.links.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    : 0;
  return linked + (Number(r.receivedManual) || 0);
}

export function reimbursementRemaining(charge) {
  return Math.max(0, reimbursementExpected(charge) - reimbursementReceived(charge));
}

// 'none' (not reimbursable) | 'pending' (nothing back yet) |
// 'partial' (some back) | 'full' (settled). The 0.005 fudge absorbs
// floating-point dust so a ₪30/₪30 match reads as full, not partial.
export function reimbursementStatus(charge) {
  const expected = reimbursementExpected(charge);
  if (expected <= 0) return 'none';
  const received = reimbursementReceived(charge);
  if (received <= 0) return 'pending';
  return received + 0.005 >= expected ? 'full' : 'partial';
}

// The amount that should count toward REAL spending: the original
// charge minus the expected (not-mine) slice, never below zero.
export function effectiveExpenseAmount(charge) {
  const amt = Number(charge && charge.amount) || 0;
  if (amt <= 0) return amt;
  const expected = Math.min(reimbursementExpected(charge), amt);
  return amt - expected;
}

// ── Candidate incoming transactions (for the link picker) ─────────
//
// Every "money in" event that could be a reimbursement: wallet/cash
// 'in' charges and bank credits. Excludes anything already linked to a
// DIFFERENT expense (so two expenses can't claim the same payment).
// Newest first. Each candidate is a flat, render-ready descriptor.
export function getReimbursementCandidates(data, { excludeChargeId = null } = {}) {
  const claimed = _linkedTxIds(data, excludeChargeId);
  const out = [];

  for (const e of getWalletEntries(data)) {
    _pushCashLikeCandidates(out, e, 'wallet', claimed);
  }
  for (const e of getCashEntries(data)) {
    _pushCashLikeCandidates(out, e, 'cash', claimed);
  }
  for (const tx of (data.bankTransactions || [])) {
    if (!tx || tx.direction !== 'credit') continue;
    if (claimed.has(tx.id)) continue;
    out.push({
      txId:     tx.id,
      source:   'bank',
      entryId:  tx.accountId || null,
      entryName: '',
      amount:   Number(tx.amount) || 0,
      date:     tx.date || '',
      label:    tx.userLabel || tx.description || '',
    });
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function _pushCashLikeCandidates(out, entry, source, claimed) {
  for (const c of (entry.charges || [])) {
    if (c.direction !== 'in') continue;
    if (claimed.has(c.id)) continue;
    out.push({
      txId:     c.id,
      source,
      entryId:  entry.id,
      entryName: entry.name || '',
      amount:   Number(c.amount) || 0,
      date:     c.date || '',
      label:    c.merchant || c.description || '',
    });
  }
}

// Tx ids already linked as a reimbursement somewhere. `exceptChargeId`
// keeps the expense currently being edited from hiding its own links.
function _linkedTxIds(data, exceptChargeId) {
  const ids = new Set();
  const visit = (charge) => {
    if (!charge || charge.id === exceptChargeId) return;
    const r = charge.reimbursement;
    if (r && Array.isArray(r.links)) {
      for (const l of r.links) if (l && l.txId) ids.add(l.txId);
    }
  };
  for (const card of (data.cards || [])) (card.charges || []).forEach(visit);
  for (const e of (data.entries || []))  (e.charges || []).forEach(visit);
  return ids;
}

// ── Income-side flag (set on the linked incoming transaction) ─────
//
// Marks/unmarks an incoming tx as a reimbursement settlement so the
// reporting layer drops it from real income and the row can show a
// settlement tag. Searches wallet/cash charges and bank transactions.
export function setIncomeReimbursementFlag(data, txId, expenseChargeId, on) {
  const tx = _findIncomeTx(data, txId);
  if (!tx) return;
  if (on) {
    tx.isReimbursement = true;
    tx.reimbursesId    = expenseChargeId;
  } else {
    delete tx.isReimbursement;
    delete tx.reimbursesId;
  }
}

function _findIncomeTx(data, txId) {
  for (const e of (data.entries || [])) {
    const hit = (e.charges || []).find(c => c.id === txId);
    if (hit) return hit;
  }
  return (data.bankTransactions || []).find(tx => tx && tx.id === txId) || null;
}
