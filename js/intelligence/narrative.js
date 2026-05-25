// ─────────────────────────────────────────────────────────────────
//  NARRATIVE — plain-language read of the portfolio
//
//  Pure function composePortfolioRead(profile) → { sentences: [...] }
//
//  Each sentence is { key, vars }. The page renders them by looking
//  up the i18n key, interpolating the vars, and joining the results
//  into a single paragraph.
//
//  Voice rules: second-person possessive, real numbers, real product
//  names. No labeling clichés ("aggressive growth portfolio"), no
//  jargon nouns ("equity exposure"). Every sentence must pass the
//  3-second understanding test — see [[intelligence-voice-and-hierarchy]].
//
//  The composer reads the profile only. It never touches the DOM and
//  never invents copy in code — copy lives entirely in i18n.js.
// ─────────────────────────────────────────────────────────────────

import { findBenchmark } from './benchmarks.js';

export function composePortfolioRead(profile) {
  if (!profile || !profile.aggregate) return null;

  const a    = profile.aggregate;
  const r    = profile.risk && profile.risk.aggregate;
  const c    = profile.concentration;
  const cash = profile.cash;

  const sentences = [];

  // ── Lede: composition in one direct line ─────────────────────
  // "73% של הכסף שלך במניות, 6% באג״ח ו-21% במזומן."
  sentences.push({
    key:  'narrative.s.composition',
    vars: {
      equity: Math.round(a.equityPct * 100),
      bonds:  Math.round(a.bondPct   * 100),
      cash:   Math.round(a.cashPct   * 100),
    },
  });

  // ── Follow-up #1: where the equity sits, if there's a dominant
  // benchmark grouping (≥ 15% of total wealth in tech via NASDAQ,
  // or a large S&P 500 grouping, etc.). The point is to name the
  // actual indexes so the user reads "NASDAQ + S&P 500" not
  // "US large-cap technology exposure".
  const techPct = r ? r.techPct : 0;
  if (techPct >= 0.15) {
    sentences.push({
      key:  'narrative.s.usTech',
      vars: { pct: Math.round(techPct * 100) },
    });
  }

  // ── Follow-up #2: concentration, names the actual top products.
  // The user's good example: "שני מוצרים בלבד מהווים יותר מחצי
  // מהתיק שלך." We follow that pattern with whichever top-N
  // crosses 50% with the fewest items.
  const conc = _concentrationSentence(c);
  if (conc) sentences.push(conc);

  // ── Follow-up #3: cash position in one plain line.
  // Distinguishes "wide buffer" / "tight buffer" / "no recurring
  // tracked yet" so the same number reads differently in context.
  const months = cash && Number.isFinite(cash.monthsOfCover) ? cash.monthsOfCover : null;
  if (months === null && cash && cash.availableILS > 0) {
    sentences.push({ key: 'narrative.s.cashNoRecurring', vars: {} });
  } else if (months !== null && months >= 12) {
    sentences.push({ key: 'narrative.s.cashWide',     vars: { months: Math.round(months) } });
  } else if (months !== null && months >= 3) {
    sentences.push({ key: 'narrative.s.cashAdequate', vars: { months: Math.round(months) } });
  } else if (months !== null && months >= 1) {
    sentences.push({ key: 'narrative.s.cashThin',     vars: { months: months.toFixed(1) } });
  } else if (months !== null) {
    sentences.push({ key: 'narrative.s.cashTight',    vars: { months: months.toFixed(1) } });
  }

  // ── Headline anchors ─────────────────────────────────────────
  // The few numbers a reader should catch at a glance, surfaced as
  // stat callouts above the prose. Derived from the SAME values the
  // sentences use, so the strip and the narrative never disagree.
  const metrics = [];
  metrics.push({ labelKey: 'narrative.m.stocks', value: Math.round(a.equityPct * 100), suffixKey: 'narrative.m.pct' });
  if (techPct >= 0.15) {
    metrics.push({ labelKey: 'narrative.m.tech', value: Math.round(techPct * 100), suffixKey: 'narrative.m.pct' });
  }
  if (conc && conc.vars && typeof conc.vars.pct === 'number') {
    metrics.push({ labelKey: 'narrative.m.concentration', value: conc.vars.pct, suffixKey: 'narrative.m.pct' });
  }
  if (months !== null && months >= 1) {
    metrics.push({ labelKey: 'narrative.m.runway', value: Math.round(months), suffixKey: 'narrative.m.mo' });
  }

  return { sentences, metrics };
}


// "X and Y together make up Z% of the portfolio" — picks the
// smallest N (2 or 3) whose combined weight passes 50%, falling
// back to top-3 when none reaches it. Returns null when the data
// is too thin to say something useful.
function _concentrationSentence(c) {
  if (!c || !c.holdings || c.holdings.length < 2) return null;

  const h    = c.holdings;
  const top2 = h.slice(0, 2);
  const top3 = h.slice(0, 3);

  const pct2 = top2.reduce((s, x) => s + (x.pct || 0), 0);
  const pct3 = top3.reduce((s, x) => s + (x.pct || 0), 0);

  if (pct2 >= 0.50) {
    return {
      key:  'narrative.s.conc2',
      vars: {
        first:  top2[0].name,
        second: top2[1].name,
        pct:    Math.round(pct2 * 100),
      },
    };
  }
  if (pct3 >= 0.50) {
    return {
      key:  'narrative.s.conc3',
      vars: {
        first:  top3[0].name,
        second: top3[1].name,
        third:  top3[2].name,
        pct:    Math.round(pct3 * 100),
      },
    };
  }
  return null;
}
