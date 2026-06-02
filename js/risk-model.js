// ─────────────────────────────────────────────────────────────────
//  RISK MODEL
//
//  Composition-aware, age-adjusted risk profile for a portfolio.
//  The output is intentionally analytical, not promotional:
//
//    {
//      score: 7.4,                    // 0..10
//      basis: [                       // bullet points: WHY
//        { key: 'risk.factor.equities',     value: 91 },
//        { key: 'risk.factor.bondsLow' },
//        { key: 'risk.factor.nasdaqHigh' },
//        { key: 'risk.factor.horizonLong',  value: 24 },
//      ],
//      interpretation: {              // one neutral sentence
//        tierKey: 'risk.tier.highGrowth',
//        volKey:  'risk.vol.elevated',
//        divKey:  'risk.div.moderate',
//      },
//      age: 24,
//    }
//
//  The renderer (assets.js) interpolates i18n keys + parameters
//  into prose. The model stays pure — no DOM, no i18n, no state.
//
//  Composition score (0..100 → /10 for display):
//
//    + equity%   × 70    dominant driver of volatility
//    + tech%     × 20    NASDAQ/tech adds dispersion
//    + max(0, largestPosition% − 30%) × 50   concentration penalty
//    − bonds%    × 35    stabilizer
//    − cash%     × 25    stabilizer
//
//  Age is hardcoded — this app is single-user. If multi-user
//  ever happens, refactor to read from data.meta.dateOfBirth and
//  reintroduce the migration that was removed alongside this file.
// ─────────────────────────────────────────────────────────────────


// Date of birth + retirement age moved to user settings (data.settings,
// seeded from these same prior values). Read through getSetting so an
// edit in Admin → Profile flows to every analytical view at once.
import { getSetting } from './config/settings.js';

const EQUITY_CLASSES = ['us_equity', 'us_tech', 'global_equity', 'intl_equity', 'single_stock'];
const BOND_CLASSES   = ['bonds'];
const CASH_CLASSES   = ['cash'];

// Exposed so the intelligence layer (and any future risk surface) reads
// the same DOB as the portfolio-scoped score — keeps the user's age
// consistent across every analytical view.
export function getUserAge(refIsoToday) {
  return _ageYears(getSetting('dateOfBirth'), refIsoToday);
}


// Integer age from an ISO date, anchored at noon to dodge DST.
function _ageYears(dobIso, refIsoToday) {
  const dob = _parseIso(dobIso);
  if (!dob) return null;
  const today = _parseIso(refIsoToday) || new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return (age >= 0 && age <= 130) ? age : null;
}

function _parseIso(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}


export function computeRiskProfile(portfolio, allEntries) {
  if (!portfolio) return null;

  const positions = (allEntries || []).filter(
    e => e.portfolioId === portfolio.id && !e.isTechnical
  );

  // Bucket sums by asset class. Positions without an assetClass roll
  // up under equity — uncategorized brokerage positions are almost
  // always equity-like, and the conservative default errs toward
  // "your real exposure may be higher than the categorized number."
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

  // Largest single position — concentration risk
  let largest = null;
  let largestValue = 0;
  for (const e of positions) {
    const v = Number(e.currentValue) || 0;
    if (v > largestValue) {
      largest = e;
      largestValue = v;
    }
  }

  return scoreRiskComposition({
    equityValue,
    bondValue,
    cashValue,
    techValue:    byClass.us_tech || 0,
    largestValue,
    largestName:  largest ? largest.name : null,
    hasUS:        (byClass.us_equity     || 0) > 0 || (byClass.us_tech      || 0) > 0,
    hasGlobal:    (byClass.global_equity || 0) > 0 || (byClass.intl_equity || 0) > 0,
  });
}


// Pure composition → risk profile. Same scoring + basis + interpretation
// logic that powers the portfolio-scoped score, but driven by raw value
// bundles instead of an entries list. Used by the intelligence layer to
// run the model on aggregated pension/study-fund/cross-account values.
//
// All inputs are absolute values; the function derives percentages
// itself, so callers don't need to compute them twice (once to pass
// in, once to render).
//
// Optional `largestName` annotates the position-concentration bullet
// when known. `hasUS` / `hasGlobal` drive the geographic-spread bullet
// and are otherwise both true (the safest default — produces no geo
// bullet rather than a misleading "concentrated" one).
export function scoreRiskComposition({
  equityValue = 0,
  bondValue   = 0,
  cashValue   = 0,
  techValue   = 0,
  largestValue = 0,
  largestName  = null,
  hasUS       = true,
  hasGlobal   = true,
} = {}) {
  const totalInvested = equityValue + bondValue + cashValue;
  if (totalInvested <= 0) return null;

  const equityPct  = equityValue / totalInvested;
  const bondPct    = bondValue   / totalInvested;
  const cashPct    = cashValue   / totalInvested;
  const techPct    = techValue   / totalInvested;
  const largestPct = largestValue / totalInvested;

  // Composition volatility 0..100 → /10 score
  let comp = equityPct * 70
           + techPct  * 20
           + Math.max(0, largestPct - 0.30) * 50
           - bondPct  * 35
           - cashPct  * 25;
  comp = Math.max(0, Math.min(100, comp));
  const score = Number((comp / 10).toFixed(1));

  // ── Basis bullets — neutral, qualitative phrasing ───────────────
  const basis = [];

  // Equities — always shown, percentage drives the language
  basis.push({ key: 'risk.factor.equities', value: Math.round(equityPct * 100) });

  // Bonds — qualitative
  if (bondPct === 0)       basis.push({ key: 'risk.factor.bondsNone' });
  else if (bondPct < 0.10) basis.push({ key: 'risk.factor.bondsLow' });
  else if (bondPct < 0.30) basis.push({ key: 'risk.factor.bondsModerate' });
  else                     basis.push({ key: 'risk.factor.bondsSignificant' });

  // Cash — only mention if it's a meaningful slice
  if (cashPct >= 0.15)      basis.push({ key: 'risk.factor.cashSignificant' });
  else if (cashPct >= 0.05) basis.push({ key: 'risk.factor.cashModest' });

  // NASDAQ / Tech — only mention when actually concentrated
  if (techPct >= 0.30)      basis.push({ key: 'risk.factor.nasdaqHigh' });
  else if (techPct >= 0.15) basis.push({ key: 'risk.factor.nasdaqModerate' });

  // Single-position concentration — only call out at >=20%
  if (largestName && largestPct >= 0.40) {
    basis.push({
      key:         'risk.factor.positionHeavy',
      value:       Math.round(largestPct * 100),
      holdingName: largestName,
    });
  } else if (largestName && largestPct >= 0.20) {
    basis.push({
      key:         'risk.factor.positionNotable',
      value:       Math.round(largestPct * 100),
      holdingName: largestName,
    });
  }

  // Geographic spread
  if (hasGlobal && hasUS)        basis.push({ key: 'risk.factor.geoGlobal' });
  else if (hasUS && !hasGlobal)  basis.push({ key: 'risk.factor.geoUSOnly' });
  else if (hasGlobal && !hasUS)  basis.push({ key: 'risk.factor.geoIntlOnly' });

  // Age + horizon
  const age = _ageYears(getSetting('dateOfBirth'));
  if (age != null) {
    const yearsLeft = Math.max(0, getSetting('retirementAge') - age);
    if (yearsLeft >= 25)      basis.push({ key: 'risk.factor.horizonLong',  value: age });
    else if (yearsLeft >= 10) basis.push({ key: 'risk.factor.horizonMid',   value: age });
    else                      basis.push({ key: 'risk.factor.horizonShort', value: age });
  }

  // ── Interpretation — composed from three independent axes ──────
  // Tier = where the portfolio sits on the equity ladder
  const tierKey =
      equityPct >= 0.80 ? 'risk.tier.highGrowth'
    : equityPct >= 0.50 ? 'risk.tier.equityLeaning'
    : equityPct >= 0.25 ? 'risk.tier.balanced'
    :                     'risk.tier.conservative';

  // Volatility = NASDAQ concentration + single-position concentration
  const volKey =
      (techPct >= 0.30 || largestPct >= 0.40) ? 'risk.vol.elevated'
    : (techPct >= 0.15 || largestPct >= 0.25) ? 'risk.vol.moderate'
    :                                           'risk.vol.limited';

  // Diversification = geographic + concentration
  const broadlyDiverse  = hasGlobal && hasUS && largestPct < 0.30;
  const moderatelyDiverse =
       (hasGlobal && hasUS)
    || (largestPct < 0.30);
  const divKey =
      broadlyDiverse      ? 'risk.div.broad'
    : moderatelyDiverse   ? 'risk.div.moderate'
    :                       'risk.div.concentrated';

  return {
    score,
    basis,
    interpretation: { tierKey, volKey, divKey },
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
