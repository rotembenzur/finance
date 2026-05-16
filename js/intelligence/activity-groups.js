// ─────────────────────────────────────────────────────────────────
//  ACTIVITY GROUPS — fold a month's transactions into meaningful sections
//
//  The Transactions page reads the output of this module instead of
//  the raw chronological river. The grouping logic is the page's
//  smarts: it answers "what kind of money movement was this" before
//  the user has to read every row.
//
//  groupActivity(monthTxs, historyBeforeMonth) → { groups, tail }
//
//  Group order is the order the page renders them (top-down read):
//
//    income            — every credit (salary, bit, refund, dividend, …)
//    recurring         — debits that look like a regular monthly bill
//                        (same description + similar amount in ≥2 of
//                        the prior 3 months)
//    cards             — credit-card settlements (single biggest
//                        predictable debit each cycle, typically)
//    transfers         — internal money movement (investments,
//                        outgoing transfers to your own accounts)
//    notable           — top 3 remaining single debits ≥ ₪500, the
//                        irregular ones worth eyeballing
//    tail              — everything else, collapsed in the UI
//
//  Each transaction lands in exactly one group (used-set tracked
//  here). Groups missing data are omitted from the returned array
//  entirely so the page renders a clean list with no empty cards.
//
//  Pure module — no DOM, no i18n, no fetches. Future LLM grounding
//  can consume the same output via the same fact-sheet builder
//  pattern the Intelligence page uses.
// ─────────────────────────────────────────────────────────────────

const TRANSFER_TYPES = new Set([
  'investment_contribution',
  'securities_buy',
  'securities_sell',
  'internal_savings',
  'outgoing_transfer',
]);

const RECURRING_AMOUNT_TOLERANCE = 0.15; // ±15% — enough for water/electric variance
const RECURRING_MIN_OCCURRENCES  = 2;    // appeared in N of prior 3 months
const RECURRING_LOOKBACK_MONTHS  = 3;
const NOTABLE_MIN_AMOUNT         = 500;
const NOTABLE_LIMIT              = 3;

export function groupActivity(monthTxs, historyBeforeMonth = []) {
  if (!Array.isArray(monthTxs) || monthTxs.length === 0) {
    return { groups: [], tail: { id: 'tail', kind: 'tail', items: [], total: 0 } };
  }

  const used = new Set();
  const groups = [];

  // ── 1. Income (all credits, regardless of type) ─────────────
  const incomeItems = monthTxs.filter(t => t.direction === 'credit');
  for (const t of incomeItems) used.add(t.id);
  if (incomeItems.length) {
    groups.push({
      id:    'income',
      kind:  'income',
      items: incomeItems.slice().sort((a, b) => b.amount - a.amount),
      total: _sum(incomeItems),
    });
  }

  // ── 2. Recurring obligations (debits matching cross-month pattern) ──
  const recurringItems = [];
  for (const tx of monthTxs) {
    if (used.has(tx.id)) continue;
    if (tx.direction !== 'debit') continue;
    if (_isRecurring(tx, historyBeforeMonth)) {
      recurringItems.push(tx);
      used.add(tx.id);
    }
  }
  if (recurringItems.length) {
    groups.push({
      id:    'recurring',
      kind:  'recurring',
      items: recurringItems.sort((a, b) => b.amount - a.amount),
      total: _sum(recurringItems),
    });
  }

  // ── 3. Card settlements ─────────────────────────────────────
  const cardItems = monthTxs.filter(t => !used.has(t.id) && t.type === 'card_settlement');
  for (const t of cardItems) used.add(t.id);
  if (cardItems.length) {
    groups.push({
      id:    'cards',
      kind:  'cards',
      items: cardItems.sort((a, b) => b.amount - a.amount),
      total: _sum(cardItems),
    });
  }

  // ── 4. Transfers & investments ──────────────────────────────
  const transferItems = monthTxs.filter(t => !used.has(t.id) && TRANSFER_TYPES.has(t.type));
  for (const t of transferItems) used.add(t.id);
  if (transferItems.length) {
    groups.push({
      id:    'transfers',
      kind:  'transfers',
      items: transferItems.sort((a, b) => b.amount - a.amount),
      total: _sum(transferItems),
    });
  }

  // ── 5. Notable single charges ───────────────────────────────
  // Largest remaining debits the user might want to eyeball — usually
  // a flight, a one-off purchase, a notable restaurant. Capped at
  // NOTABLE_LIMIT so the section stays scannable.
  const remainingDebits = monthTxs.filter(t =>
    !used.has(t.id) && t.direction === 'debit' && t.amount >= NOTABLE_MIN_AMOUNT
  );
  const notable = remainingDebits
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, NOTABLE_LIMIT);
  for (const t of notable) used.add(t.id);
  if (notable.length) {
    groups.push({
      id:    'notable',
      kind:  'notable',
      items: notable,
      total: _sum(notable),
    });
  }

  // ── 6. Tail — everything else ───────────────────────────────
  const tailItems = monthTxs.filter(t => !used.has(t.id));
  const tail = {
    id:    'tail',
    kind:  'tail',
    items: tailItems.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
    // Net signed total — credits add, debits subtract, so the tail
    // total reads as "what the leftovers actually did to the
    // balance" rather than just summing both sides.
    total: tailItems.reduce((s, t) =>
      s + (t.direction === 'debit' ? -t.amount : t.amount), 0),
  };

  return { groups, tail };
}


// Same-description + close-amount in ≥N of the prior M months.
//
// Description matching normalizes obvious noise (account numbers,
// reference codes, repeated whitespace) but keeps the core merchant
// string intact. Amount tolerance handles utility-bill variance
// (electricity / water bills that drift between months).
function _isRecurring(tx, historyBeforeMonth) {
  if (!tx.description) return false;
  const key = _normalizeDesc(tx.description);
  if (!key) return false;
  const amt = Math.abs(tx.amount);
  if (amt <= 0) return false;

  // Bucket prior matches by YYYY-MM so two debits in the same prior
  // month count as one occurrence (avoids "weekly subscription"
  // false-matching against itself).
  const buckets = new Set();
  for (const h of historyBeforeMonth) {
    if (!h || h.direction !== tx.direction) continue;
    if (_normalizeDesc(h.description) !== key) continue;
    const hAmt = Math.abs(h.amount || 0);
    if (hAmt <= 0) continue;
    if (Math.abs(hAmt - amt) / amt > RECURRING_AMOUNT_TOLERANCE) continue;
    const ym = (h.date || '').slice(0, 7);
    if (ym) buckets.add(ym);
    if (buckets.size >= RECURRING_LOOKBACK_MONTHS) break;
  }
  return buckets.size >= RECURRING_MIN_OCCURRENCES;
}


// Lower-case, collapse runs of digits ≥2 to '#' (reference/account
// numbers vary across statements), collapse whitespace. Conservative:
// keeps the merchant/intent text intact so "Cellcom" still matches
// "Cellcom" but "Cellcom 4592" still matches "Cellcom 6731".
function _normalizeDesc(d) {
  return String(d || '')
    .toLowerCase()
    .replace(/\d{2,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function _sum(arr) {
  return arr.reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
