// ─────────────────────────────────────────────────────────────────
//  PORTFOLIO ALLOCATION
//
//  Groups portfolio holdings into meaningful investment categories
//  (e.g. "US Large Cap", "Tech / NASDAQ", "Global Equity") instead
//  of showing every ticker separately. Answers the question:
//    "What is my money actually exposed to?"
//
//  ── Architecture ────────────────────────────────────────────────
//  Each holding's category is decided in this order:
//    1. entry.categoryOverride  — explicit manual override (future UI)
//    2. PORTFOLIO_CATEGORIES rule matching entry.assetClass
//    3. (no match) — holding is excluded from the breakdown
//
//  Future schemes (geography, strategy/theme) can be added as
//  parallel CATEGORY_DEFS arrays + a `scheme` argument on
//  buildPortfolioAllocation, without touching this V1 logic.
// ─────────────────────────────────────────────────────────────────

// Categories represent REAL economic exposure, not security wrappers.
// Two holdings that both track NASDAQ belong together regardless of
// whether one is an Israeli mutual fund and the other a US ETF.
//
// The mapping flow:
//   1. entry.categoryOverride  — explicit user mental classification
//      (e.g. VTI is technically us_equity but the user reads it as
//      part of their broad/global bucket)
//   2. PORTFOLIO_CATEGORIES rule matching entry.assetClass
import { entryValue, getPortfolioHoldings } from './utils.js';

export const PORTFOLIO_CATEGORIES = [
  {
    id:           'nasdaq',
    nameKey:      'category.nasdaq',
    color:        '#6E5BB8',         // muted purple — NASDAQ growth tone
    assetClasses: ['us_tech'],
  },
  {
    id:           'us_large_cap',
    nameKey:      'category.usLargeCap',
    color:        '#3B5BDB',         // deep indigo — flagship US exposure
    assetClasses: ['us_equity'],
  },
  {
    id:           'global_equity',
    nameKey:      'category.globalEquity',
    color:        '#3D7068',         // deep teal — diversified
    assetClasses: ['global_equity', 'intl_equity'],
  },
  {
    id:           'bonds',
    nameKey:      'category.bonds',
    color:        '#8B6F4A',         // earthy brown — defensive
    assetClasses: ['bonds'],
  },
  {
    id:           'usd_cash',
    nameKey:      'category.usdCash',
    color:        '#A87526',         // aged gold — idle cash
    assetClasses: ['cash'],
  },
  {
    id:           'individual_stocks',
    nameKey:      'category.individualStocks',
    color:        '#5B6577',         // slate — small, secondary
    assetClasses: ['single_stock'],
  },
];

// Resolve the category for a single holding. Returns null when no
// rule matches and there's no manual override — those holdings are
// intentionally excluded from the allocation breakdown so that a
// missing classification surfaces as a visible gap rather than being
// silently absorbed into the wrong bucket.
export function categorizeHolding(entry) {
  // Technical instruments (tax shields, etc.) never represent real
  // exposure — they should never appear in the allocation chart even
  // if their value were non-zero.
  if (entry.isTechnical) return null;

  if (entry.categoryOverride) {
    return PORTFOLIO_CATEGORIES.find(c => c.id === entry.categoryOverride) || null;
  }
  if (!entry.assetClass) return null;
  return PORTFOLIO_CATEGORIES.find(c => c.assetClasses.includes(entry.assetClass)) || null;
}

// Build the allocation breakdown for a portfolio.
//
// Returns:
//   {
//     total:         <sum of all holding values, including uncategorized>,
//     categorized:   <sum of categorized holdings>,
//     uncategorized: <list of holdings without a category>,
//     segments:      [{ category, value, pct, holdings: [...] }, ...]
//                      sorted by value descending. pct is relative to
//                      `total` (not `categorized`), so a sliver of
//                      uncategorized never silently inflates the rest.
//   }
export function buildPortfolioAllocation(data, portfolioId) {
  const holdings = getPortfolioHoldings(data, portfolioId);
  const total    = holdings.reduce((sum, h) => sum + entryValue(h), 0);

  const groups        = new Map();
  const uncategorized = [];
  let   categorized   = 0;

  for (const h of holdings) {
    const cat = categorizeHolding(h);
    if (!cat) {
      uncategorized.push(h);
      continue;
    }
    const value = entryValue(h);
    if (!groups.has(cat.id)) {
      groups.set(cat.id, { category: cat, value: 0, holdings: [] });
    }
    const g = groups.get(cat.id);
    g.value += value;
    g.holdings.push(h);
    categorized += value;
  }

  const segments = Array.from(groups.values())
    .map(g => ({ ...g, pct: total ? (g.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return { total, categorized, uncategorized, segments };
}
