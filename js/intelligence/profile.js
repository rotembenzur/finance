// ─────────────────────────────────────────────────────────────────
//  FINANCIAL PROFILE — the structured snapshot
//
//  Pure function buildFinancialProfile(data) → a single object that
//  describes the user's financial state in analytical terms:
//
//    {
//      aggregate:      { equityValue, bondValue, cashValue, totalInvested,
//                        equityPct, bondPct, cashPct, total },
//      accounts:       [ { id, label, totalILS, composition, source } ... ]
//                        — every account-like grouping rolled up
//                        (taxable portfolios, pension, study fund,
//                        provident, IRA/investment_gemel, locked savings,
//                        military deposit, family-managed)
//      concentration:  { top, holdings: [{ name, value, pct }] }
//      overlap:        [ { benchmarkId, name, totalValue, pct, holdings: [...] } ]
//      currencies:     [ { code, totalILS, pct } ]
//      cash:           { availableILS, recurringMonthly, monthsOfCover,
//                        idleILS, idleThreshold }
//      risk:           { aggregate, perAccount: [{ id, label, profile }] }
//
//      ── operational dimensions (ground-truth the assistant recites) ──
//      netWorth:       { total, available, invested, futureWealth,
//                        futureDeposits, liabilities, cardsOutstanding }
//      cards:          { items: [{ name, network, kind, last4, creditLimit,
//                        pendingILS, utilizationPct, billingDay, nextBilling,
//                        chargeCount, foreignTxnFee }], totalOutstanding }
//      spending:       { recent: [{ cardName, amount, direction, date,
//                        merchant, description }], topMerchants, totalCharges,
//                        count }
//      recurring:      { items: [{ name, amount, cycle, type,
//                        monthlyEquivalent }], monthlyTotal }
//      futureDeposits: { items: [{ name, value, maturityDate, estimated,
//                        type }], total }
//      income:         { netAmount, currency, depositDay, employer,
//                        destination, nextDepositDate } | null
//      meta:           { generatedAt, age }
//    }
//
//  No DOM, no fetches. The Intelligence page renders this; the LLM
//  assistant grounds on the same shape via llm-context.js.
// ─────────────────────────────────────────────────────────────────

import {
  entryValue, entryValueILS, getPortfolioHoldings, calcMonthlyBurn,
  calcCardPendingCharges, calcCardsOutstanding, calcNetWorth,
  calcAvailableTotal, calcInvestedTotal, calcFutureWealthTotal,
  calcFutureDepositsTotal, calcLiabilitiesTotal,
  getSalary, salaryIsConfigured, getSalaryDestinationEntry, nextDepositDate,
} from '../utils.js';
import { scoreRiskComposition, getUserAge } from '../risk-model.js';
import { findBenchmark } from './benchmarks.js';
import { resolveComposition } from './compositions.js';
import { buildRiskDimensions } from './risk-dimensions.js';

// Inlined to keep the analytical layer free of the persistence module
// (which transitively imports the Supabase SDK over the network). The
// analytical pipeline stays pure and testable in node without stubs.
function _todayISO() { return new Date().toISOString().split('T')[0]; }

const EQUITY_CLASSES = new Set(['us_equity', 'us_tech', 'global_equity', 'intl_equity', 'single_stock']);
const BOND_CLASSES   = new Set(['bonds']);
const CASH_CLASSES   = new Set(['cash']);

// "Idle cash" — checking balance that materially exceeds the user's
// monthly outflow buffer. We treat anything above ~3× monthly recurring
// outflow as a candidate for being inefficient — the rule is intentionally
// generous; the insight only flags it, doesn't demand action.
const IDLE_CASH_BUFFER_MONTHS = 3;

export function buildFinancialProfile(data) {
  if (!data) return null;

  const accounts      = _safe(() => _buildAccountGroups(data), []);
  const aggregate     = _safe(() => _buildAggregate(data, accounts), null);
  const concentration = _safe(() => _buildConcentration(data), { top: 0, holdings: [], total: 0 });
  const overlap       = _safe(() => _buildOverlap(data), []);
  const currencies    = _safe(() => _buildCurrencies(data), []);
  const cash          = _safe(() => _buildCashAnalysis(data), null);
  const risk          = _safe(() => _buildRisk(data, accounts), { aggregate: null, perAccount: [] });

  // ── Operational dimensions ───────────────────────────────────
  // Beyond investment analytics, the assistant must be able to read
  // the user's full ground-truth: net-worth breakdown, cards and the
  // spending on them, recurring obligations, future-dated deposits,
  // and income. Each builder is wrapped in _safe so a malformed slice
  // of state can never take down the whole snapshot.
  const netWorth       = _safe(() => _buildNetWorth(data), null);
  const cards          = _safe(() => _buildCards(data), { items: [], totalOutstanding: 0 });
  const spending       = _safe(() => _buildSpending(data), { recent: [], topMerchants: [], totalCharges: 0, count: 0 });
  const recurring      = _safe(() => _buildRecurring(data), { items: [], monthlyTotal: 0 });
  const futureDeposits = _safe(() => _buildFutureDeposits(data), { items: [], total: 0 });
  const income         = _safe(() => _buildIncome(data), null);

  // Risk dimensions are derived from the rest of the profile; compute
  // last so they have everything to read.
  const partial = { aggregate, accounts, concentration, overlap, currencies, cash, risk,
                    netWorth, cards, spending, recurring, futureDeposits, income,
                    meta: { generatedAt: _todayISO(), age: getUserAge() } };
  const riskDimensions = _safe(() => buildRiskDimensions(partial), null);

  return { ...partial, riskDimensions };
}

// Run a builder, swallowing any throw and returning a safe fallback so
// one malformed dimension can never crash the assistant. Logs in dev.
function _safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[profile] dimension build failed', err);
    return fallback;
  }
}

function _num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// ─────────────────────────────────────────────────────────────────
//  ACCOUNT GROUPS — one row per "thing the user thinks of as an account"
//
//  - Each taxable portfolio (e.g. IBI)
//  - Each pension
//  - Each study fund
//  - Each provident fund
//  - Each investment gemel
//  - Family-managed investment (collapsed: ownership-only slice)
//  - Each non-liquid locked savings
//  - Each military deposit
//
//  Composition is in {equity, bonds, cash} percentages. Source is
//  one of: 'holdings' (built from real per-security data),
//  'override' (entry.compositionEstimate), 'pension-tracks',
//  'track-name', 'type-default'.
// ─────────────────────────────────────────────────────────────────

function _buildAccountGroups(data) {
  const groups = [];

  // Taxable brokerage portfolios — composition derived from holdings.
  for (const p of (data.portfolios || [])) {
    if (p.isActive === false) continue;
    const holdings = getPortfolioHoldings(data, p.id);
    const { equityValue, bondValue, cashValue, techValue } = _bucketHoldings(holdings);
    const portfolioCash = Number(p.cashAvailable) || 0;
    const total = equityValue + bondValue + cashValue + portfolioCash;
    if (total <= 0) continue;

    groups.push({
      id:          `portfolio:${p.id}`,
      kind:        'portfolio',
      label:       p.name || p.nameEn || 'Portfolio',
      labelEn:     p.nameEn || p.name || 'Portfolio',
      totalILS:    total,
      composition: {
        equity: equityValue / total,
        bonds:  bondValue   / total,
        cash:   (cashValue + portfolioCash) / total,
      },
      techPct:     total ? techValue / total : 0,
      source:      'holdings',
    });
  }

  // Long-term products — pension, study fund, provident, investment gemel,
  // family-managed, locked savings, military deposit. Composition resolved
  // by the compositions module.
  const LONG_TERM_TYPES = new Set([
    'pension', 'study_fund', 'provident_fund', 'investment_gemel',
    'investment_fund', 'savings', 'military_deposit',
  ]);

  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability || e.isTechnical) continue;
    if (!LONG_TERM_TYPES.has(e.type)) continue;

    // Only the user's own share of family-managed assets counts.
    const valueRaw = entryValueILS(e, data);
    if (!Number.isFinite(valueRaw) || valueRaw <= 0) continue;

    const breakdown = {};
    const comp      = resolveComposition(e, breakdown);
    if (!comp) continue;

    groups.push({
      id:          `entry:${e.id}`,
      kind:        e.type,
      label:       e.name   || e.nameEn || e.institution || e.type,
      labelEn:     e.nameEn || e.name   || e.institution || e.type,
      totalILS:    valueRaw,
      composition: comp,
      techPct:     0, // not resolvable without per-track holdings
      source:      breakdown.source,
    });
  }

  return groups;
}

function _bucketHoldings(holdings) {
  let equityValue = 0;
  let bondValue   = 0;
  let cashValue   = 0;
  let techValue   = 0;
  for (const h of holdings) {
    const v = entryValue(h);
    if (!Number.isFinite(v) || v <= 0) continue;
    const cls = h.assetClass || 'unknown';
    if (EQUITY_CLASSES.has(cls) || cls === 'unknown') equityValue += v;
    else if (BOND_CLASSES.has(cls))                   bondValue   += v;
    else if (CASH_CLASSES.has(cls))                   cashValue   += v;
    if (cls === 'us_tech') techValue += v;
  }
  return { equityValue, bondValue, cashValue, techValue };
}

// ─────────────────────────────────────────────────────────────────
//  AGGREGATE — equity / bond / cash split across EVERYTHING
//
//  Sums the account groups and adds in liquid (checking + cash). The
//  liquid total counts entirely toward `cash`. Returns null when
//  the user has no positions yet.
// ─────────────────────────────────────────────────────────────────

function _buildAggregate(data, accounts) {
  let equityILS = 0;
  let bondILS   = 0;
  let cashILS   = 0;

  for (const g of accounts) {
    equityILS += g.totalILS * g.composition.equity;
    bondILS   += g.totalILS * g.composition.bonds;
    cashILS   += g.totalILS * g.composition.cash;
  }

  // Add liquid (checking + cash) — all cash for the purposes of
  // composition. This is the "Available" tier.
  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability) continue;
    if (e.tier !== 'available') continue;
    const v = entryValueILS(e, data);
    if (Number.isFinite(v) && v > 0) cashILS += v;
  }

  const total = equityILS + bondILS + cashILS;
  if (total <= 0) return null;

  return {
    equityValue:   equityILS,
    bondValue:     bondILS,
    cashValue:     cashILS,
    total,
    equityPct:     equityILS / total,
    bondPct:       bondILS   / total,
    cashPct:       cashILS   / total,
  };
}

// ─────────────────────────────────────────────────────────────────
//  CONCENTRATION — single-name exposure across the user's holdings
//
//  Operates on positions that are individually identifiable (brokerage
//  holdings, standalone invested entries with names). Aggregates by
//  name so the same security held in two portfolios shows up once.
// ─────────────────────────────────────────────────────────────────

function _buildConcentration(data) {
  const byName = new Map();
  let totalNamed = 0;

  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability || e.isTechnical) continue;
    if (e.tier !== 'invested') continue; // long-term products aren't single-name
    const v = entryValueILS(e, data);
    if (!Number.isFinite(v) || v <= 0) continue;

    const key = e.name || e.nameEn || e.ticker || e.id;
    const existing = byName.get(key) || { name: key, value: 0, count: 0 };
    existing.value += v;
    existing.count += 1;
    byName.set(key, existing);
    totalNamed += v;
  }

  if (totalNamed <= 0) return { top: 0, holdings: [], total: 0 };

  const sorted = Array.from(byName.values())
    .map(h => ({ ...h, pct: h.value / totalNamed }))
    .sort((a, b) => b.value - a.value);

  // "Top concentration" = combined weight of top 3 holdings
  const top = sorted.slice(0, 3).reduce((s, h) => s + h.pct, 0);

  return { top, holdings: sorted, total: totalNamed };
}

// ─────────────────────────────────────────────────────────────────
//  INDEX OVERLAP — which benchmark do you accidentally hold N times?
//
//  Groups holdings by the benchmark they track (per benchmarks.js)
//  and reports the combined ILS value per group. A group with only
//  one holding isn't "overlap" yet, but it's still useful to see —
//  the rule in insights.js decides what to surface.
// ─────────────────────────────────────────────────────────────────

function _buildOverlap(data) {
  const groups = new Map();

  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability || e.isTechnical) continue;
    if (e.tier !== 'invested') continue;
    const v = entryValueILS(e, data);
    if (!Number.isFinite(v) || v <= 0) continue;
    const match = findBenchmark(e);
    if (!match) continue;

    const b   = match.benchmark;
    const eff = v * (match.weight || 1.0);

    if (!groups.has(b.id)) {
      groups.set(b.id, {
        benchmarkId:  b.id,
        nameEn:       b.nameEn,
        nameHe:       b.nameHe,
        totalValue:   0,
        rawValue:     0,
        holdings:     [],
      });
    }
    const g = groups.get(b.id);
    g.totalValue += eff;
    g.rawValue   += v;
    g.holdings.push({
      name:     e.name || e.nameEn || e.ticker || e.id,
      ticker:   e.ticker || null,
      value:    v,
      weight:   match.weight,
      effective: eff,
    });
  }

  // Compute pct of total tagged-equity for each group, so a single
  // 90%-S&P-500 group reads as concentrated even when the rest of the
  // equity isn't benchmark-tagged.
  let totalEffective = 0;
  for (const g of groups.values()) totalEffective += g.totalValue;

  return Array.from(groups.values())
    .map(g => ({ ...g, pct: totalEffective ? g.totalValue / totalEffective : 0 }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

// ─────────────────────────────────────────────────────────────────
//  CURRENCY EXPOSURE
//
//  Aggregates total value (in ILS) by the entry's native currency.
//  Captures FX risk: even an ILS-denominated VOO fund has indirect
//  USD exposure through what it holds, but for V1 we report only
//  what the entries actually say. Live-data enrichment can refine
//  this later (Phase 2).
// ─────────────────────────────────────────────────────────────────

function _buildCurrencies(data) {
  const buckets = new Map();
  let total = 0;
  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability || e.isTechnical) continue;
    const v = entryValueILS(e, data);
    if (!Number.isFinite(v) || v <= 0) continue;
    const code = e.currency || 'ILS';
    buckets.set(code, (buckets.get(code) || 0) + v);
    total += v;
  }
  return Array.from(buckets.entries())
    .map(([code, value]) => ({ code, totalILS: value, pct: total ? value / total : 0 }))
    .sort((a, b) => b.totalILS - a.totalILS);
}

// ─────────────────────────────────────────────────────────────────
//  CASH ANALYSIS — months of cover, idle balance
//
//  Available = all entries with tier='available' (checking + cash).
//  Recurring = monthly burn from utils.calcMonthlyBurn (recurring[]).
//  monthsOfCover = available / recurring (Infinity when no recurring).
//  idleILS = max(0, available - recurring × IDLE_CASH_BUFFER_MONTHS).
// ─────────────────────────────────────────────────────────────────

function _buildCashAnalysis(data) {
  let availableILS = 0;
  for (const e of (data.entries || [])) {
    if (e.isActive === false || e.isLiability) continue;
    if (e.tier !== 'available') continue;
    const v = entryValueILS(e, data);
    if (Number.isFinite(v) && v > 0) availableILS += v;
  }

  const recurringMonthly = calcMonthlyBurn(data) || 0;
  const monthsOfCover    = recurringMonthly > 0 ? availableILS / recurringMonthly : Infinity;
  const idleThreshold    = recurringMonthly * IDLE_CASH_BUFFER_MONTHS;
  const idleILS          = Math.max(0, availableILS - idleThreshold);

  return { availableILS, recurringMonthly, monthsOfCover, idleILS, idleThreshold };
}

// ─────────────────────────────────────────────────────────────────
//  RISK — composition-aware score per account + an aggregate score
//
//  Each account group is fed back into scoreRiskComposition with its
//  own equity/bond/cash totals. The aggregate score uses the same
//  function on the cross-account totals. The largest-position bullet
//  is suppressed at the aggregate level (it doesn't apply to fund
//  composites) and at the long-term-product level (we don't have
//  per-position data there).
// ─────────────────────────────────────────────────────────────────

function _buildRisk(data, accounts) {
  const perAccount = [];
  for (const g of accounts) {
    const eq = g.totalILS * g.composition.equity;
    const bd = g.totalILS * g.composition.bonds;
    const cs = g.totalILS * g.composition.cash;
    const tech = g.totalILS * (g.techPct || 0);
    const profile = scoreRiskComposition({
      equityValue: eq, bondValue: bd, cashValue: cs,
      techValue:   tech,
      hasUS:       g.kind === 'portfolio',  // assume yes for taxable
      hasGlobal:   g.kind === 'portfolio',
    });
    if (profile) perAccount.push({ id: g.id, label: g.label, labelEn: g.labelEn, kind: g.kind, profile });
  }

  // Aggregate — sum equity/bond/cash across every account group.
  let totalEq = 0, totalBd = 0, totalCs = 0, totalTech = 0;
  for (const g of accounts) {
    totalEq += g.totalILS * g.composition.equity;
    totalBd += g.totalILS * g.composition.bonds;
    totalCs += g.totalILS * g.composition.cash;
    totalTech += g.totalILS * (g.techPct || 0);
  }
  const aggregate = scoreRiskComposition({
    equityValue: totalEq, bondValue: totalBd, cashValue: totalCs,
    techValue:   totalTech,
    hasUS:       true,
    hasGlobal:   true,
  });

  return { aggregate, perAccount };
}

// ─────────────────────────────────────────────────────────────────
//  NET WORTH — the headline breakdown across all tiers
//
//  Mirrors utils.calcNetWorth so the assistant recites the same
//  figure the dashboard shows: assets (available + invested + future)
//  minus liabilities and pending credit-card charges.
// ─────────────────────────────────────────────────────────────────

function _buildNetWorth(data) {
  return {
    total:            _num(calcNetWorth(data)),
    available:        _num(calcAvailableTotal(data)),
    invested:         _num(calcInvestedTotal(data)),
    futureWealth:     _num(calcFutureWealthTotal(data)),
    futureDeposits:   _num(calcFutureDepositsTotal(data)),
    liabilities:      _num(calcLiabilitiesTotal(data)),
    cardsOutstanding: _num(calcCardsOutstanding(data)),
  };
}

// ─────────────────────────────────────────────────────────────────
//  CARDS — one row per active card, with the pending billing total
//
//  Pending = charges inside the current billing window (utils.
//  calcCardPendingCharges, which respects refunds and the half-open
//  cycle). Utilization is pending ÷ credit limit for credit cards.
//  Debit cards carry no pending/limit. Card numbers are reduced to a
//  last-4 reference only — never anything more sensitive.
// ─────────────────────────────────────────────────────────────────

function _buildCards(data) {
  const list = (data && Array.isArray(data.cards)) ? data.cards.filter(c => c && c.isActive) : [];
  const items = list.map(c => {
    const isDebit = !!c.isDebit;
    const pending = isDebit ? 0 : _num(calcCardPendingCharges(c));
    const limit   = _num(c.creditLimit);
    return {
      name:           c.name || c.nameEn || 'Card',
      nameEn:         c.nameEn || c.name || 'Card',
      network:        c.network || null,
      kind:           isDebit ? 'debit' : (c.cardType || 'credit'),
      isDebit,
      institution:    c.institution || null,
      last4:          c.last4 || null,
      creditLimit:    limit > 0 ? limit : null,
      pendingILS:     pending,
      utilizationPct: (!isDebit && limit > 0) ? pending / limit : null,
      billingDay:     Number.isFinite(c.billingDay) ? c.billingDay : null,
      nextBilling:    c.nextBilling || null,
      chargeCount:    Array.isArray(c.charges) ? c.charges.length : 0,
      foreignTxnFee:  (c.fees && c.fees.foreignTxn && Number.isFinite(c.fees.foreignTxn.usd))
                        ? c.fees.foreignTxn.usd : null,
    };
  });
  return { items, totalOutstanding: _num(calcCardsOutstanding(data)) };
}

// ─────────────────────────────────────────────────────────────────
//  SPENDING — recent card transactions, top merchants, totals
//
//  Flattens every charge across active cards into a single activity
//  view. `recent` is capped so the fact sheet stays bounded; the
//  merchant rollup and totals are computed over the full set. Refunds
//  (direction='in') are tracked but excluded from spend totals.
// ─────────────────────────────────────────────────────────────────

function _buildSpending(data) {
  const cards = (data && Array.isArray(data.cards)) ? data.cards.filter(c => c && c.isActive) : [];
  const all = [];
  for (const c of cards) {
    const charges = Array.isArray(c.charges) ? c.charges : [];
    for (const ch of charges) {
      const amount = _num(ch && ch.amount);
      if (!amount) continue;
      all.push({
        cardName:    c.name || c.nameEn || 'Card',
        amount,
        direction:   (ch.direction === 'in') ? 'in' : 'out',
        date:        ch.date ? String(ch.date).slice(0, 10) : null,
        merchant:    ch.merchant || null,
        description: ch.description || null,
      });
    }
  }

  // Most recent first; undated charges sink to the bottom.
  all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const byMerchant = new Map();
  let totalCharges = 0;
  for (const ch of all) {
    if (ch.direction === 'in') continue;
    totalCharges += ch.amount;
    const key = ch.merchant || ch.description || '(unlabeled)';
    byMerchant.set(key, (byMerchant.get(key) || 0) + ch.amount);
  }
  const topMerchants = Array.from(byMerchant.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return {
    recent: all.slice(0, 12),
    topMerchants,
    totalCharges,
    count: all.length,
  };
}

// ─────────────────────────────────────────────────────────────────
//  RECURRING — standing obligations (auto deposits / bills)
//
//  Each entry is normalized to a monthly-equivalent so the assistant
//  can reason about cadence regardless of cycle. `type` carries the
//  direction-of-intent (investment_contribution, bill, …).
// ─────────────────────────────────────────────────────────────────

function _buildRecurring(data) {
  const list = (data && Array.isArray(data.recurring)) ? data.recurring.filter(r => r && r.isActive) : [];
  const items = list.map(r => {
    const amount = _num(r.amount);
    let monthlyEquivalent = amount;
    if (r.cycle === 'yearly')      monthlyEquivalent = amount / 12;
    else if (r.cycle === 'weekly') monthlyEquivalent = amount * 4.33;
    return {
      name:   r.name || r.nameEn || 'Recurring',
      amount,
      cycle:  r.cycle || 'monthly',
      type:   r.type || null,
      monthlyEquivalent,
    };
  });
  return { items, monthlyTotal: items.reduce((s, i) => s + i.monthlyEquivalent, 0) };
}

// ─────────────────────────────────────────────────────────────────
//  FUTURE DEPOSITS — locked money with a known release date
//
//  The canonical "Future Deposits" tier (military discharge deposit,
//  etc.) plus any locked entry that carries a maturity date but lives
//  in another tier (e.g. a locked savings account), de-duplicated.
// ─────────────────────────────────────────────────────────────────

function _buildFutureDeposits(data) {
  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  const seen = new Set();
  const items = [];

  const push = (e, source) => {
    if (!e || seen.has(e.id)) return;
    seen.add(e.id);
    items.push({
      name:         e.name || e.nameEn || 'Deposit',
      value:        _num(entryValueILS(e, data)),
      maturityDate: e.maturityDate || null,
      estimated:    !!e.maturityDateEstimated,
      type:         e.type || null,
      source,
    });
  };

  for (const e of entries) {
    if (!e || e.isActive === false || e.isLiability) continue;
    if (e.tier === 'future_deposits') push(e, 'tier');
  }
  for (const e of entries) {
    if (!e || e.isActive === false || e.isLiability) continue;
    if (e.isLocked && e.maturityDate) push(e, 'locked');
  }

  return { items, total: items.reduce((s, i) => s + i.value, 0) };
}

// ─────────────────────────────────────────────────────────────────
//  INCOME — configured monthly salary, if any
//
//  Returns null when no salary is set up (the demo state ships with
//  salary=null), so the fact sheet simply omits the section.
// ─────────────────────────────────────────────────────────────────

function _buildIncome(data) {
  const salary = getSalary(data);
  if (!salaryIsConfigured(salary)) return null;
  const dest = getSalaryDestinationEntry(data, salary);
  return {
    netAmount:       _num(salary.netAmount),
    currency:        salary.currency || 'ILS',
    depositDay:      salary.depositDay,
    employer:        salary.employerEn || salary.employer || null,
    destination:     dest ? (dest.nameEn || dest.name || dest.institution || null) : null,
    nextDepositDate: nextDepositDate(salary),
  };
}
