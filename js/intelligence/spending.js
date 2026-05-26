// ─────────────────────────────────────────────────────────────────
//  SPENDING — category/subcategory breakdown of a month's expenses
//
//  Pure engine for the Spending section. Aggregates every expense
//  charge across cards + cash entries (income excluded) into a
//  category → subcategory tree for a given month, with the prior
//  month computed from the same dated charges so the page can show
//  month-over-month deltas without any snapshot infrastructure.
//
//  Data sources:
//    • card.charges[]        — credit/debit card charges
//    • cashEntry.charges[]   — cash-entry charges
//    • bankTransactions[]    — direct-debit and other bank-statement
//                              rows the user has explicitly
//                              categorized (categoryId set, debit, not
//                              internal, not a card_settlement so no
//                              double-count of the linked card charges).
//  All share the expense-categories taxonomy (categoryId +
//  subcategoryId). Income entries (direction='in' on charges, 'credit'
//  on bank txs) are excluded: this view is money OUT only.
//
//  No DOM, no i18n. The page resolves category IDs to names via the
//  i18n-aware display helpers in expense-categories.js.
// ─────────────────────────────────────────────────────────────────

export const UNCATEGORIZED = '__uncategorized__';
export const NO_SUBCATEGORY = '__none__';

// Every expense charge across cards, cash entries, and qualifying bank
// transactions. Income filtered out — only money leaving counts.
function _allExpenseCharges(data) {
  const out = [];
  for (const card of (data.cards || [])) {
    if (!Array.isArray(card.charges)) continue;
    for (const c of card.charges) {
      if (c.direction === 'in') continue;
      out.push(c);
    }
  }
  for (const e of (data.entries || [])) {
    if (e.type !== 'cash' && e.isCash !== true) continue;
    if (!Array.isArray(e.charges)) continue;
    for (const c of e.charges) {
      if (c.direction === 'in') continue;
      out.push(c);
    }
  }
  // Bank-transaction debits the user has explicitly categorized. The
  // user labelling something with an expense category is what counts
  // it as spending; raw bank rows without a category remain pure
  // statement entries on the Transactions page only.
  for (const tx of (data.bankTransactions || [])) {
    if (!tx || tx.direction !== 'debit') continue;
    if (tx.isInternal)                   continue;
    if (tx.type === 'card_settlement')   continue;   // already counted via card.charges
    if (!tx.categoryId)                  continue;   // not yet labelled
    out.push(tx);
  }
  return out;
}

// Distinct YYYY-MM that have at least one expense charge, newest
// first. Undated charges contribute no month and are skipped — both
// the quick-expense modal and the importers always set a date, so
// this only ever drops legacy entries.
export function availableSpendingMonths(data) {
  const set = new Set();
  for (const c of _allExpenseCharges(data)) {
    const ym = (c.date || '').slice(0, 7);
    if (ym) set.add(ym);
  }
  return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
}

export function buildSpendingProfile(data, ym) {
  const all          = _allExpenseCharges(data);
  const monthCharges = all.filter(c => (c.date || '').slice(0, 7) === ym);
  const prevYm       = _shiftMonth(ym, -1);
  const prevCharges  = all.filter(c => (c.date || '').slice(0, 7) === prevYm);

  const total     = _sum(monthCharges);
  const prevTotal = _sum(prevCharges);
  const delta     = total - prevTotal;
  const deltaPct  = prevTotal > 0 ? (delta / prevTotal) * 100 : null;

  // Per-category prior-month totals — cheap to compute now, used by
  // the per-category delta + the slice-B insight rules later.
  const prevCatTotals = new Map();
  for (const c of prevCharges) {
    const catId = c.categoryId || UNCATEGORIZED;
    prevCatTotals.set(catId, (prevCatTotals.get(catId) || 0) + (Number(c.amount) || 0));
  }

  // Group the selected month: category → subcategory.
  const catMap = new Map();
  for (const c of monthCharges) {
    const catId = c.categoryId || UNCATEGORIZED;
    if (!catMap.has(catId)) {
      catMap.set(catId, { categoryId: catId, total: 0, count: 0, subs: new Map() });
    }
    const cat = catMap.get(catId);
    const amt = Number(c.amount) || 0;
    cat.total += amt;
    cat.count += 1;

    const subId = c.subcategoryId || NO_SUBCATEGORY;
    if (!cat.subs.has(subId)) {
      cat.subs.set(subId, { subcategoryId: subId, total: 0, count: 0 });
    }
    const sub = cat.subs.get(subId);
    sub.total += amt;
    sub.count += 1;
  }

  const categories = Array.from(catMap.values())
    .map(cat => {
      const prev = prevCatTotals.get(cat.categoryId) || 0;
      return {
        categoryId:   cat.categoryId,
        total:        cat.total,
        count:        cat.count,
        pct:          total > 0 ? (cat.total / total) * 100 : 0,
        prevTotal:    prev,
        delta:        cat.total - prev,
        deltaPct:     prev > 0 ? ((cat.total - prev) / prev) * 100 : null,
        subcategories: Array.from(cat.subs.values()).sort((a, b) => b.total - a.total),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    month:    ym,
    prevMonth: prevYm,
    total,
    prevTotal,
    delta,
    deltaPct,
    count:    monthCharges.length,
    categories,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function _sum(charges) {
  return charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function _shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
