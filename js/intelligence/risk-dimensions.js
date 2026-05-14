// ─────────────────────────────────────────────────────────────────
//  RISK DIMENSIONS — five qualitative reads
//
//  Pure function buildRiskDimensions(profile) → object with five
//  qualitative dimensions, each rated on its own three-level scale:
//
//    volatility       low · moderate · elevated
//    concentration    low · moderate · elevated
//    diversification  broad · moderate · narrow
//    suitability      well-suited · appropriate · cautious · mismatch
//    liquidity        strong · adequate · thin
//
//  Levels are *neutral position labels*, not verdicts. "Elevated
//  volatility" for a 24-year-old with a long horizon is normal; the
//  explanation line carries the contextual interpretation. The page
//  styles all levels in the same calm tone so the engine doesn't
//  whisper "danger" where it doesn't apply.
//
//  Each dimension returns:
//    {
//      level:       string,                 // matches the level enum above
//      labelKey:    'riskDim.<dim>.label',
//      levelKey:    'riskDim.<dim>.<level>',
//      explainKey:  'riskDim.<dim>.<level>.explain',
//      explainVars: { ... }                 // template interpolation values
//    }
//
//  Future LLM integration consumes these via llm-context.js's fact
//  sheet — the dimensions become explicit prompt context, replacing
//  the previous single risk score with five differentiated reads.
// ─────────────────────────────────────────────────────────────────

const RETIREMENT_AGE = 67;

export function buildRiskDimensions(profile) {
  if (!profile) return null;

  const r    = profile.risk && profile.risk.aggregate;
  const c    = profile.concentration;
  const cash = profile.cash;
  const age  = profile.meta && profile.meta.age;

  return {
    volatility:      _volatility(r),
    concentration:   _concentration(c),
    diversification: _diversification(r),
    suitability:     _suitability(r, age),
    liquidity:       _liquidity(cash),
  };
}


// ─── Volatility ─────────────────────────────────────────────────
//
// Drivers: equity %, NASDAQ-style tech weight on TOTAL wealth.
// High equity + concentrated tech = expected to swing harder.

function _volatility(r) {
  if (!r) return _unknown('vol');
  const equity = r.equityPct;
  const tech   = r.techPct;

  let level;
  if (equity >= 0.70 && tech >= 0.20)      level = 'elevated';
  else if (equity >= 0.55 || tech >= 0.15) level = 'moderate';
  else                                      level = 'low';

  return _build('vol', level, {
    equity: Math.round(equity * 100),
    tech:   Math.round(tech   * 100),
  });
}


// ─── Concentration ──────────────────────────────────────────────
//
// Driver: top-3 combined weight in the invested tier.

function _concentration(c) {
  if (!c || !c.holdings || !c.holdings.length) return _unknown('conc');
  const top3 = c.top || 0;

  let level;
  if (top3 >= 0.60)      level = 'elevated';
  else if (top3 >= 0.35) level = 'moderate';
  else                    level = 'low';

  return _build('conc', level, { pct: Math.round(top3 * 100) });
}


// ─── Diversification ────────────────────────────────────────────
//
// Drivers: geographic spread (hasUS, hasGlobal) + presence of
// bonds/cash as ballast. The standalone risk module already
// computes hasUS/hasGlobal on the aggregate.

function _diversification(r) {
  if (!r) return _unknown('div');
  const hasUS     = r.hasUS;
  const hasGlobal = r.hasGlobal;
  const hasBonds  = (r.bondPct || 0) >= 0.05;
  const equity    = r.equityPct;

  // Broad = both regions AND some non-equity ballast OR equity is
  // not so dominant that everything else is rounding.
  // Moderate = one region + ballast, OR both regions + very heavy equity.
  // Narrow = single region with little ballast.
  let level;
  if (hasUS && hasGlobal && hasBonds)      level = 'broad';
  else if (hasUS && hasGlobal)             level = equity >= 0.90 ? 'moderate' : 'broad';
  else if ((hasUS || hasGlobal) && hasBonds) level = 'moderate';
  else                                       level = 'narrow';

  return _build('div', level, {});
}


// ─── Long-term suitability ──────────────────────────────────────
//
// Age-aware. The point is to differentiate "elevated volatility"
// from "wrong volatility for your horizon." A 24-year-old with 95%
// equity is taking volatility that suits a 40+ year horizon. A
// 60-year-old with the same allocation faces sequence-of-returns
// risk much more sharply.

function _suitability(r, age) {
  if (!r || age == null) return _unknown('suit');
  const yearsLeft = Math.max(0, RETIREMENT_AGE - age);
  const equity    = r.equityPct;

  let level;
  if (yearsLeft >= 25) {
    // Long horizon — high equity is suitable; low equity leaves return on the table.
    if (equity >= 0.60)      level = 'wellSuited';
    else if (equity >= 0.30) level = 'appropriate';
    else                     level = 'cautious';
  } else if (yearsLeft >= 10) {
    // Mid horizon — balanced ranges fit.
    if (equity >= 0.40 && equity <= 0.85) level = 'wellSuited';
    else                                   level = 'appropriate';
  } else {
    // Short horizon — high equity carries sequence-of-returns risk.
    if (equity <= 0.50)      level = 'wellSuited';
    else if (equity <= 0.70) level = 'appropriate';
    else                     level = 'mismatch';
  }

  return _build('suit', level, {
    age,
    yearsLeft,
    equity: Math.round(equity * 100),
  });
}


// ─── Liquidity ──────────────────────────────────────────────────
//
// Driver: months of recurring-outflow cover from the available tier.
// If no recurring outflow is tracked, we can't say strong/thin yet —
// report 'unknown' until the user has imported their cash flow.

function _liquidity(cash) {
  if (!cash) return _unknown('liq');
  const months = cash.monthsOfCover;
  if (!Number.isFinite(months)) return _unknown('liq');

  let level;
  if (months >= 6)      level = 'strong';
  else if (months >= 2) level = 'adequate';
  else                  level = 'thin';

  return _build('liq', level, {
    months: months >= 100 ? '100+' : months.toFixed(1),
  });
}


// ─── Helpers ────────────────────────────────────────────────────

function _build(dim, level, explainVars) {
  return {
    level,
    labelKey:    `riskDim.${dim}.label`,
    levelKey:    `riskDim.${dim}.${level}`,
    explainKey:  `riskDim.${dim}.${level}.explain`,
    explainVars,
  };
}

function _unknown(dim) {
  return {
    level:       'unknown',
    labelKey:    `riskDim.${dim}.label`,
    levelKey:    `riskDim.${dim}.unknown`,
    explainKey:  `riskDim.${dim}.unknown.explain`,
    explainVars: {},
  };
}
