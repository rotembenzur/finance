// ─────────────────────────────────────────────────────────────────
//  BENCHMARKS — what does each holding actually track?
//
//  Single-source map: index/underlying → list of matching securities.
//  Each match carries an `equityWeight` between 0 and 1 representing
//  how much of the holding's value should be counted toward that
//  benchmark when computing overlap. Pure index funds use 1.00.
//  Funds that hold a meaningful slice elsewhere use a partial weight
//  (e.g. IVW is the S&P 500 growth subset — most of its names also
//  appear in VOO, but it's not a pure S&P tracker, so we treat it as
//  a 0.70 partial overlap rather than a full duplicate).
//
//  Two lookup keys per match so the same holding can be matched
//  regardless of which broker source supplied it:
//    - ibiSecurityId — stable IBI identifier
//    - ticker        — for tickers that exist outside IBI too
//
//  Why not derive overlap from assetClass alone? Because assetClass
//  is coarse (us_equity, us_tech, global_equity). The interesting
//  insight is "you own three things that are all the S&P 500" —
//  which assetClass can't tell us. This map is the missing layer.
//
//  When new holdings appear in the user's data, add them here. The
//  map is intentionally short and hand-curated — V1 doesn't try to
//  identify every world ETF, just the ones the user actually holds.
// ─────────────────────────────────────────────────────────────────

// Each benchmark has a stable id + a human label key per language.
// `matches` is an array of { ibiSecurityId?, ticker?, equityWeight }.
// At least one identifier must be present; both is fine.
export const BENCHMARKS = [
  {
    id:     'sp500',
    nameEn: 'S&P 500',
    nameHe: 'S&P 500',
    matches: [
      { ibiSecurityId: '60604105', ticker: 'VOO',       equityWeight: 1.00 }, // Vanguard S&P 500
      { ibiSecurityId: '1148162',  ticker: 'SP500.IBI', equityWeight: 1.00 }, // S&P 500 IBI
      { ibiSecurityId: '60076072', ticker: 'IVW',       equityWeight: 0.70 }, // iShares S&P 500 Growth — overlaps but not pure
      { ibiSecurityId: '60062783', ticker: 'VTI',       equityWeight: 0.85 }, // VTI is total US — ~85% by mkt cap is S&P 500
      { ibiSecurityId: 'DEMO-SP500', ticker: null,      equityWeight: 1.00 }, // example-state seed
    ],
  },
  {
    id:     'nasdaq100',
    nameEn: 'NASDAQ 100',
    nameHe: 'נאסד״ק 100',
    matches: [
      { ibiSecurityId: '5129283', ticker: 'NDX100.IBI.K', equityWeight: 1.00 }, // NASDAQ 100 IBI fund
      { ibiSecurityId: '1200450', ticker: 'NDX100.IBI',   equityWeight: 1.00 }, // NASDAQ 100 IBI (alternate)
      { ibiSecurityId: null,      ticker: 'QQQ',          equityWeight: 1.00 }, // Invesco QQQ
      { ibiSecurityId: 'DEMO-NDX', ticker: null,          equityWeight: 1.00 }, // example-state seed
    ],
  },
  {
    id:     'totalUS',
    nameEn: 'Total US Stock Market',
    nameHe: 'שוק המניות האמריקאי הכולל',
    matches: [
      { ibiSecurityId: '60062783', ticker: 'VTI',   equityWeight: 1.00 }, // Vanguard Total Stock Market
    ],
  },
  {
    id:     'totalWorld',
    nameEn: 'Total World Stock Market',
    nameHe: 'שוק המניות העולמי',
    matches: [
      { ibiSecurityId: '60194669', ticker: 'VT',  equityWeight: 1.00 }, // Vanguard Total World
      { ibiSecurityId: 'DEMO-VT',  ticker: null, equityWeight: 1.00 }, // example-state seed
    ],
  },
  {
    id:     'usAggregateBonds',
    nameEn: 'US Aggregate Bonds',
    nameHe: 'אג״ח אמריקאי רחב',
    matches: [
      { ibiSecurityId: '1062520', ticker: 'BND', equityWeight: 1.00 }, // Vanguard Total Bond — this is the "weight inside benchmark" not equity
      { ibiSecurityId: 'DEMO-BND', ticker: null, equityWeight: 1.00 },
    ],
  },
];

// Returns the benchmark match for a given entry, or null. Matches by
// ibiSecurityId first (most stable), then ticker. The match object
// carries the benchmark identity + the entry's effective weight.
export function findBenchmark(entry) {
  if (!entry) return null;
  for (const bench of BENCHMARKS) {
    for (const m of bench.matches) {
      if (m.ibiSecurityId && entry.ibiSecurityId && m.ibiSecurityId === entry.ibiSecurityId) {
        return { benchmark: bench, weight: m.equityWeight };
      }
      if (m.ticker && entry.ticker && m.ticker === entry.ticker) {
        return { benchmark: bench, weight: m.equityWeight };
      }
    }
  }
  return null;
}

// Returns benchmark by id (or null). Used by insights rules when
// they want to render a benchmark name without re-looking-up via
// an entry.
export function getBenchmark(benchmarkId) {
  return BENCHMARKS.find(b => b.id === benchmarkId) || null;
}
