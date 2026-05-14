// ─────────────────────────────────────────────────────────────────
//  RISK MODEL
//
//  Replaces the previous static `portfolio.riskScore` field with a
//  composition-aware, age-adjusted profile.
//
//  Computation pipeline (per portfolio):
//
//    1. Bucket every non-technical position by asset class:
//         equity  = us_equity + us_tech + global_equity
//                 + intl_equity + single_stock
//         bonds   = bonds
//         cash    = cash + portfolio.cashAvailable
//       Anything with no assetClass is bucketed as equity by
//       default — a brokerage position with missing classification
//       is almost always equity-like, and the conservative default
//       errs on the side of "I might be more exposed than I think."
//
//    2. Compute exposure ratios over total invested.
//
//    3. Build a 0-100 composition volatility score:
//         + equity%   × 70    (the dominant driver of volatility)
//         + tech%     × 20    (NASDAQ/tech adds dispersion)
//         + max(0, largestPosition% − 30%) × 50   (concentration penalty)
//         − bonds%    × 35    (stabilizer)
//         − cash%     × 25    (stabilizer)
//       Clamped to [0, 100]. The 0-10 numeric score is comp / 10.
//
//    4. Band: <25 conservative, <50 balanced, <75 growth, ≥75 aggressive.
//
//    5. Factors (small data tokens for chip display): equity%, tech%,
//       largest-position%, bonds%, cash%, US-concentrated vs
//       globally-diversified, and age.
//
//    6. Age/horizon summary: derived from `meta.dateOfBirth`. Same
//       portfolio composition can read differently for a 24-year-old
//       than for someone 5 years from retirement. The summary picks
//       one of three templates per horizon × three per equity range.
//
//  No promises about predictive accuracy — this is an explainable
//  heuristic that mirrors how a personal-finance app would phrase
//  the portfolio's character.
// ─────────────────────────────────────────────────────────────────

import { todayISO } from './store.js';

const EQUITY_CLASSES = ['us_equity', 'us_tech', 'global_equity', 'intl_equity', 'single_stock'];
const BOND_CLASSES   = ['bonds'];
const CASH_CLASSES   = ['cash'];

// Israeli statutory retirement age — used as the horizon anchor.
// Picked because the app is Israel-first; a setting could be added
// later if we ever localize this.
const RETIREMENT_AGE = 67;


// Compute integer age in years from an ISO date string. Returns null
// if input is missing or unparseable.
export function computeAgeYears(dobIso, refIsoToday) {
  if (!dobIso) return null;
  const dob = _parseIso(dobIso);
  if (!dob) return null;
  const today = _parseIso(refIsoToday || todayISO()) || new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  if (age < 0 || age > 130) return null;
  return age;
}

function _parseIso(s) {
  if (!s) return null;
  // Accept YYYY-MM-DD; anchor at noon to dodge any DST drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}


// Main entry point. Returns null when the portfolio has no positions
// AND no cash — there's nothing meaningful to evaluate yet.
export function computeRiskProfile(portfolio, allEntries, meta) {
  if (!portfolio) return null;

  const positions = (allEntries || []).filter(
    e => e.portfolioId === portfolio.id && !e.isTechnical
  );

  // Bucket sums by asset class. Positions without an assetClass are
  // collected under 'unknown' and added to equity below.
  const byClass = {};
  for (const e of positions) {
    const cls = e.assetClass || 'unknown';
    byClass[cls] = (byClass[cls] || 0) + (Number(e.currentValue) || 0);
  }

  const equityValue =
      _sumKeys(byClass, EQUITY_CLASSES)
    + (byClass.unknown || 0);
  const bondValue   = _sumKeys(byClass, BOND_CLASSES);
  const cashValue   = _sumKeys(byClass, CASH_CLASSES) + (Number(portfolio.cashAvailable) || 0);
  const totalInvested = equityValue + bondValue + cashValue;

  if (totalInvested <= 0) return null;

  const equityPct  = equityValue / totalInvested;
  const bondPct    = bondValue   / totalInvested;
  const cashPct    = cashValue   / totalInvested;
  const techPct    = (byClass.us_tech || 0) / totalInvested;

  // Largest single position — concentration risk only counts when
  // the position itself is meaningful (>5% of portfolio) so a
  // 100%-of-cash row doesn't flag as risky.
  let largest = null;
  let largestValue = 0;
  for (const e of positions) {
    const v = Number(e.currentValue) || 0;
    if (v > largestValue) {
      largest = e;
      largestValue = v;
    }
  }
  const largestPct = totalInvested > 0 ? largestValue / totalInvested : 0;

  const hasGlobal = (byClass.global_equity || 0) > 0 || (byClass.intl_equity || 0) > 0;
  const hasUS     = (byClass.us_equity     || 0) > 0 || (byClass.us_tech      || 0) > 0;

  // Composition volatility (0-100)
  let comp = equityPct * 70
           + techPct  * 20
           + Math.max(0, largestPct - 0.30) * 50
           - bondPct * 35
           - cashPct * 25;
  comp = Math.max(0, Math.min(100, comp));
  const score = Number((comp / 10).toFixed(1));

  let band;
  if (comp < 25)      band = 'conservative';
  else if (comp < 50) band = 'balanced';
  else if (comp < 75) band = 'growth';
  else                band = 'aggressive';

  // Factors for chip display. Each carries a `kind` so the UI can
  // tint accordingly (positive/concentration/stabilizer/neutral).
  const factors = [];
  if (equityPct > 0) {
    factors.push({
      kind:  equityPct > 0.7 ? 'concentration' : 'neutral',
      key:   'risk.factor.equity',
      value: Math.round(equityPct * 100),
    });
  }
  if (techPct > 0.20) {
    factors.push({
      kind:  'concentration',
      key:   'risk.factor.tech',
      value: Math.round(techPct * 100),
    });
  }
  if (largest && largestPct > 0.30) {
    factors.push({
      kind:        'concentration',
      key:         'risk.factor.largest',
      value:       Math.round(largestPct * 100),
      holdingName: largest.name,
    });
  }
  if (bondPct > 0.05) {
    factors.push({
      kind:  'stabilizer',
      key:   'risk.factor.bonds',
      value: Math.round(bondPct * 100),
    });
  }
  if (cashPct > 0.05) {
    factors.push({
      kind:  'stabilizer',
      key:   'risk.factor.cash',
      value: Math.round(cashPct * 100),
    });
  }
  if (hasGlobal && hasUS) {
    factors.push({ kind: 'positive', key: 'risk.factor.globallyDiverse' });
  } else if (hasUS && !hasGlobal) {
    factors.push({ kind: 'concentration', key: 'risk.factor.usConcentrated' });
  }

  // Age + horizon summary. Without DOB we still return a profile —
  // the consumer (assets.js) prompts the user to set one when this
  // field is null.
  const age = meta && meta.dateOfBirth ? computeAgeYears(meta.dateOfBirth) : null;
  let horizonKey = null;
  if (age != null) {
    factors.push({ kind: 'positive', key: 'risk.factor.age', value: age });
    const yearsLeft = Math.max(0, RETIREMENT_AGE - age);
    // Four cases keyed on (long-horizon × high-equity). Mid-horizon
    // collapses into one of the two long-horizon templates so we
    // don't fragment the i18n surface for marginal nuance.
    const longHorizon  = yearsLeft >= 20;
    const highEquity   = equityPct >= 0.6;
    if (longHorizon && highEquity)   horizonKey = 'risk.summary.horizonLongFitsHigh';
    else if (longHorizon)            horizonKey = 'risk.summary.horizonLongCouldTakeMore';
    else if (highEquity)             horizonKey = 'risk.summary.horizonShortHighEquity';
    else                             horizonKey = 'risk.summary.horizonShortBalanced';
  }

  return {
    score,
    band,
    factors,
    horizonKey,
    age,
    equityPct,
    bondPct,
    cashPct,
    techPct,
    largestPct,
    hasGlobal,
    hasUS,
  };
}

function _sumKeys(obj, keys) {
  let s = 0;
  for (const k of keys) s += (obj[k] || 0);
  return s;
}
