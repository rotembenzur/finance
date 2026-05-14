// ─────────────────────────────────────────────────────────────────
//  INSIGHTS — rules over the financial profile
//
//  buildInsights(profile, data) → Insight[]
//
//  Insight shape (V3):
//
//    {
//      id:          'overlap.sp500',
//      severity:    'info' | 'notice' | 'warn',
//      impact:      'high' | 'medium' | 'low',
//      type:        'structural' | 'concentration' | 'efficiency'
//                       | 'risk' | 'positioning',
//      labelKey:    'priority.important' | 'priority.attention'
//                       | 'priority.healthy' | 'priority.positive',
//      titleKey,    titleVars,
//      bodyKey,     bodyVars,
//      whyMattersKey?, whyMattersVars?,     ← 1 sentence on real-world consequence
//      suggestionKey?, suggestionVars?,     ← 1 short, analytical, non-prescriptive hint
//      evidence:    { kind: 'holdings' | 'contrast' | null, ... }
//    }
//
//  Voice rules (see [[intelligence-voice-and-hierarchy]]):
//    - Plain second-person possessive: "your portfolio", "התיק שלך"
//    - Real product names and real percentages — never abstract counts
//    - Natural verbs ("lean on", "make up", "נשען על", "מהווה") —
//      no corporate metaphors ("tilted toward", "מוטה")
//    - Two sentences max per field; the 3-second understanding test
//    - "Why this matters" reads as one real-world consequence sentence
//    - "What might shift it" is analytical, never prescriptive — no
//      named securities, no broker-specific advice
// ─────────────────────────────────────────────────────────────────

const MIN_OVERLAP_PCT      = 0.10;
const HIGH_CONCENTRATION   = 0.50;
const SEVERE_CONCENTRATION = 0.70;
const MIN_CASH_INSIGHT_ILS = 5000;
const ACCOUNT_RISK_GAP     = 1.5;
const TECH_BIAS_NOTABLE    = 0.15;
const TECH_BIAS_HIGH       = 0.25;

// Prioritization tuning. The cap exists because "Important" loses
// meaning when 4 of 5 cards are tagged Important. Two is the most
// the eye can rank as "the primary read" without dilution.
const MAX_HIGH_IMPACT = 2;

// Type-level priority used as a tie-breaker when too many high-
// impact insights compete for the top slots. Concentration in real
// holdings beats overlap; overlap beats tech bias; structural reads
// (comparative risk, positioning) sit below.
const TYPE_PRIORITY = {
  concentration: 5,
  risk:          4,
  efficiency:    3,
  structural:    2,
  positioning:   1,
};

const SEVERITY_PRIORITY = { warn: 3, notice: 2, info: 1 };

export function buildInsights(profile, data) {
  if (!profile) return [];
  const insights = [];

  _addConcentrationInsight(insights, profile);
  _addTechBiasInsight(insights, profile);
  _addOverlapInsights(insights, profile);
  _addComparativeRiskInsight(insights, profile);
  _addCashEfficiencyInsight(insights, profile);

  return _capHighImpact(insights, MAX_HIGH_IMPACT);
}

// Demote everything past the top N high-impact insights to medium.
// Ranking key: severity desc, then type priority desc. Stable — when
// scores tie, original insertion order wins. Demoted insights lose
// their "Important" badge but keep their original severity dot and
// body; they just move from the Priority tier to Observations on
// the page.
function _capHighImpact(insights, maxHigh) {
  const highs = insights.filter(i => i.impact === 'high');
  if (highs.length <= maxHigh) return insights;

  const ranked = highs
    .map((i, idx) => ({ i, idx, key: [SEVERITY_PRIORITY[i.severity] || 0, TYPE_PRIORITY[i.type] || 0] }))
    .sort((a, b) => {
      const sevDiff = b.key[0] - a.key[0];
      if (sevDiff !== 0) return sevDiff;
      const typeDiff = b.key[1] - a.key[1];
      if (typeDiff !== 0) return typeDiff;
      return a.idx - b.idx;
    });

  const demoted = new Set(ranked.slice(maxHigh).map(x => x.i.id));
  return insights.map(i =>
    demoted.has(i.id)
      ? { ...i, impact: 'medium', labelKey: 'priority.attention', wasDemoted: true }
      : i
  );
}


// ─── Concentration in a handful of products ─────────────────────
//
// One of the most strategically important reads. The body names
// the actual top products (matching the user's preferred voice
// pattern: "שני מוצרים בלבד מהווים יותר מחצי מהתיק").

function _addConcentrationInsight(out, profile) {
  const c = profile.concentration;
  if (!c || !c.holdings || c.holdings.length < 2) return;

  const top3 = c.top || 0;
  const top  = c.holdings;
  const pct2 = (top[0]?.pct || 0) + (top[1]?.pct || 0);

  let severity = 'info';
  let impact   = 'low';
  let labelKey = 'priority.healthy';
  if (top3 >= SEVERE_CONCENTRATION || pct2 >= 0.60) {
    severity = 'warn';
    impact   = 'high';
    labelKey = 'priority.important';
  } else if (top3 >= HIGH_CONCENTRATION) {
    severity = 'notice';
    impact   = 'high';
    labelKey = 'priority.important';
  } else if (top3 >= 0.35) {
    severity = 'notice';
    impact   = 'medium';
    labelKey = 'priority.attention';
  } else {
    // Healthy diversification — surface as a quiet positive observation.
    labelKey = 'priority.positive';
  }

  // Two named-product variants depending on whether 2 products
  // already cross 50%, or whether 3 are needed.
  let bodyKey;
  let bodyVars;
  if (pct2 >= 0.50) {
    bodyKey  = 'insights.concentration.body.two';
    bodyVars = {
      first:  top[0].name,
      second: top[1].name,
      pct:    Math.round(pct2 * 100),
    };
  } else if (top3 >= 0.50) {
    bodyKey  = 'insights.concentration.body.three';
    bodyVars = {
      first:  top[0].name,
      second: top[1].name,
      third:  top[2].name,
      pct:    Math.round(top3 * 100),
    };
  } else {
    bodyKey  = 'insights.concentration.body.spread';
    bodyVars = { pct: Math.round(top3 * 100) };
  }

  out.push({
    id:        'concentration.topN',
    severity, impact, labelKey,
    type:      'concentration',
    // Reads from real holdings and real values — no estimates involved.
    confidence: 'high',
    titleKey:  'insights.concentration.title',
    bodyKey, bodyVars,
    whyMattersKey: top3 >= HIGH_CONCENTRATION ? 'insights.concentration.why' : null,
    suggestionKey: top3 >= HIGH_CONCENTRATION ? 'insights.concentration.suggestion' : null,
    evidence: {
      kind:  'holdings',
      items: top.slice(0, 5).map(h => ({
        name:  h.name,
        value: h.value,
        pct:   h.pct,
        sub:   null,
      })),
    },
  });
}


// ─── US-tech bias ───────────────────────────────────────────────
//
// Tech weight on TOTAL wealth, not portfolio-relative.

function _addTechBiasInsight(out, profile) {
  const r = profile.risk && profile.risk.aggregate;
  if (!r) return;
  if (r.techPct < TECH_BIAS_NOTABLE) return;

  const impact   = r.techPct >= TECH_BIAS_HIGH ? 'high' : 'medium';
  const labelKey = impact === 'high' ? 'priority.important' : 'priority.attention';
  const severity = impact === 'high' ? 'notice' : 'info';

  out.push({
    id:        'bias.tech',
    severity, impact, labelKey,
    type:      'concentration',
    // Derived from the assetClass tagging — high confidence for the
    // taxable portfolio side, but the aggregate tech % includes
    // long-term products where assetClass isn't always populated.
    // Still high overall — the math is conservative.
    confidence: 'high',
    titleKey:  'insights.techBias.title',
    bodyKey:   'insights.techBias.body',
    bodyVars: {
      tech:   Math.round(r.techPct * 100),
      equity: Math.round(r.equityPct * 100),
    },
    whyMattersKey: 'insights.techBias.why',
    suggestionKey: impact === 'high' ? 'insights.techBias.suggestion' : null,
    evidence: null,
  });
}


// ─── Index overlap ──────────────────────────────────────────────

function _addOverlapInsights(out, profile) {
  for (const g of profile.overlap || []) {
    if (g.holdings.length < 2) continue;
    if (g.pct < MIN_OVERLAP_PCT) continue;

    const impact =
        (g.pct >= 0.30 || g.holdings.length >= 3) ? 'high'
      : (g.pct >= 0.15 || g.holdings.length >= 2) ? 'medium'
      :                                              'low';

    const labelKey =
        impact === 'high'   ? 'priority.important'
      : impact === 'medium' ? 'priority.attention'
      :                       'priority.healthy';

    out.push({
      id:        `overlap.${g.benchmarkId}`,
      severity:  impact === 'high' ? 'notice' : 'info',
      impact, labelKey,
      type:      'concentration',
      // Deterministic benchmark match by ibiSecurityId/ticker.
      confidence: 'high',
      titleKey:  'insights.overlap.title',
      titleVars: { name: g.nameEn, nameHe: g.nameHe },
      bodyKey:   'insights.overlap.body',
      bodyVars: {
        nameEn:  g.nameEn,
        nameHe:  g.nameHe,
        count:   g.holdings.length,
        pct:     Math.round(g.pct * 100),
        total:   Math.round(g.totalValue),
      },
      whyMattersKey: 'insights.overlap.why',
      suggestionKey: impact === 'high' ? 'insights.overlap.suggestion' : null,
      evidence: {
        kind: 'holdings',
        items: g.holdings.map(h => ({
          name:  h.name,
          value: h.value,
          pct:   g.rawValue ? (h.value / g.rawValue) : 0,
          sub:   h.weight < 1 ? `× ${Math.round(h.weight * 100)}%` : null,
        })),
      },
    });
  }
}


// ─── Comparative risk across accounts ───────────────────────────

function _addComparativeRiskInsight(out, profile) {
  const all = profile.risk && profile.risk.perAccount;
  if (!all || all.length < 2) return;

  const per = all.filter(p =>
    (p.profile.equityPct + p.profile.bondPct) >= 0.10
  );
  if (per.length < 2) return;

  let maxGap = 0;
  let pair   = null;
  for (let i = 0; i < per.length; i++) {
    for (let j = i + 1; j < per.length; j++) {
      const gap = Math.abs(per[i].profile.score - per[j].profile.score);
      if (gap > maxGap) {
        maxGap = gap;
        pair   = [per[i], per[j]];
      }
    }
  }
  if (!pair || maxGap < ACCOUNT_RISK_GAP) return;

  const [a, b] = pair[0].profile.score >= pair[1].profile.score ? pair : [pair[1], pair[0]];

  out.push({
    id:        'risk.spread',
    severity:  'notice',
    impact:    'medium',
    labelKey:  'priority.attention',
    type:      'structural',
    // Per-account scores depend on composition estimates for long-
    // term products (pension tracks, study fund, gemel). Those use
    // heuristics today, not live data. Confidence is medium until
    // live composition is wired in.
    confidence: 'medium',
    titleKey:  'insights.compRisk.title',
    bodyKey:   'insights.compRisk.body',
    bodyVars: {
      aLabel:    a.label, aLabelEn: a.labelEn,
      bLabel:    b.label, bLabelEn: b.labelEn,
      aEquityPct: Math.round(a.profile.equityPct * 100),
      bEquityPct: Math.round(b.profile.equityPct * 100),
    },
    whyMattersKey: 'insights.compRisk.why',
    suggestionKey: null,
    evidence: {
      kind: 'contrast',
      pair: [
        { label: a.label, labelEn: a.labelEn,
          equityPct: a.profile.equityPct, bondPct: a.profile.bondPct, cashPct: a.profile.cashPct,
          score: a.profile.score },
        { label: b.label, labelEn: b.labelEn,
          equityPct: b.profile.equityPct, bondPct: b.profile.bondPct, cashPct: b.profile.cashPct,
          score: b.profile.score },
      ],
    },
  });
}


// ─── Cash efficiency — context-aware ────────────────────────────

function _addCashEfficiencyInsight(out, profile) {
  const c = profile.cash;
  if (!c) return;
  if (c.availableILS < MIN_CASH_INSIGHT_ILS) return;

  const cover  = Number.isFinite(c.monthsOfCover) ? c.monthsOfCover : null;
  const idleNotable = c.idleILS >= MIN_CASH_INSIGHT_ILS;
  const longCover   = cover !== null && cover >= 12;
  const shortCover  = cover !== null && cover < 2;
  if (!idleNotable && !longCover && !shortCover && cover === null) return;

  const equityPct = (profile.aggregate && profile.aggregate.equityPct) || 0;
  const equityLed = equityPct >= 0.65;

  let bodyKey;
  let severity = 'info';
  let impact   = 'low';
  let labelKey = 'priority.healthy';
  let whyMattersKey = null;
  let suggestionKey = null;

  if (shortCover) {
    bodyKey       = 'insights.cash.body.shortCover';
    severity      = 'warn';
    impact        = 'high';
    labelKey      = 'priority.important';
    whyMattersKey = 'insights.cash.why.shortCover';
  } else if (idleNotable && longCover && equityLed) {
    bodyKey       = 'insights.cash.body.idleOverBuffer';
    severity      = 'notice';
    impact        = 'medium';
    labelKey      = 'priority.attention';
    whyMattersKey = 'insights.cash.why.idle';
    suggestionKey = 'insights.cash.suggestion.idle';
  } else if (idleNotable && longCover) {
    bodyKey       = 'insights.cash.body.idleConservative';
    impact        = 'low';
    labelKey      = 'priority.healthy';
  } else if (longCover && equityLed) {
    bodyKey       = 'insights.cash.body.strongBallast';
    impact        = 'low';
    labelKey      = 'priority.positive';
    whyMattersKey = 'insights.cash.why.ballast';
  } else if (cover === null && c.availableILS > 0) {
    bodyKey       = 'insights.cash.body.noRecurring';
    impact        = 'low';
    labelKey      = 'priority.healthy';
  } else {
    bodyKey       = 'insights.cash.body.adequate';
    impact        = 'low';
    labelKey      = 'priority.healthy';
  }

  out.push({
    id:        'cash.efficiency',
    severity, impact, labelKey,
    type:      'efficiency',
    // Real cash balances + real recurring outflow — no estimates.
    confidence: 'high',
    titleKey:  'insights.cash.title',
    bodyKey,
    bodyVars: {
      months:    cover === null ? '∞' : (cover >= 100 ? '100+' : cover.toFixed(1)),
      idle:      Math.round(c.idleILS),
      avail:     Math.round(c.availableILS),
      recurring: Math.round(c.recurringMonthly),
    },
    whyMattersKey, suggestionKey,
    evidence: null,
  });
}
