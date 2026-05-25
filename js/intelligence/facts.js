// ─────────────────────────────────────────────────────────────────
//  INSIGHTS FACTS — the number contract between the engine and the LLM
//
//  buildInsightsFacts(profile, insights) → a compact JSON object the
//  AI reads ALONGSIDE the Markdown fact sheet. Its job is narrow but
//  critical: it pins down the *exact* values and the *exact* vocabulary
//  the AI is allowed to reference, so the model authors words while the
//  engine keeps owning every number.
//
//    metricValues   — authoritative values for the stat strip. The AI
//                     picks which keys to show and labels them; the
//                     client re-attaches the value from here. The AI
//                     never types a headline number.
//    holdingNames   — the only valid evidence references. The AI cites
//                     a name from this list; the client resolves it back
//                     to {value, pct} from the profile. An unknown name
//                     is dropped, so a hallucinated holding can't render.
//    riskDimensions — the five dimension keys + their deterministic
//                     levels. The AI rewrites the *explanation prose*;
//                     the level (and therefore the color tone) stays
//                     deterministic.
//    deterministic  — what the rule engine already found, as a starting
//                     point the AI may refine, reprioritize, or replace.
//
//  Pure. No DOM, no i18n, no fetch. Safe to run on the server too.
// ─────────────────────────────────────────────────────────────────

export const METRIC_KEYS = ['stocks', 'tech', 'bonds', 'cash', 'concentration', 'cashBuffer'];

export const RISK_DIMENSIONS = ['volatility', 'concentration', 'diversification', 'suitability', 'liquidity'];

// Compute the authoritative stat-strip values from the profile. Returns
// a map { key → { value:Number, suffix:'%'|'mo' } }, omitting any metric
// that isn't meaningful for this state (so the AI can only pick from
// metrics that actually have a value). This is the single source of
// truth the normalizer re-attaches values from.
export function computeMetricValues(profile) {
  if (!profile) return {};
  const a       = profile.aggregate || {};
  const techPct = (profile.risk && profile.risk.aggregate && profile.risk.aggregate.techPct) || 0;
  const months  = profile.cash && profile.cash.monthsOfCover;

  const out = {};
  if (Number.isFinite(a.equityPct)) out.stocks = { value: Math.round(a.equityPct * 100), suffix: '%' };
  if (Number.isFinite(a.bondPct))   out.bonds  = { value: Math.round(a.bondPct   * 100), suffix: '%' };
  if (Number.isFinite(a.cashPct))   out.cash   = { value: Math.round(a.cashPct   * 100), suffix: '%' };
  if (techPct > 0)                  out.tech   = { value: Math.round(techPct * 100),     suffix: '%' };

  const conc = _concentrationMetric(profile.concentration);
  if (conc != null) out.concentration = { value: conc, suffix: '%' };

  if (Number.isFinite(months) && months >= 1) {
    out.cashBuffer = { value: Math.round(months), suffix: 'mo' };
  }
  return out;
}

// Mirrors narrative.js: the smallest top-N (2 or 3) whose combined
// weight crosses 50%, else the top-3 combined. Keeps the headline
// "concentration" number identical to what the prose would quote.
function _concentrationMetric(c) {
  if (!c || !Array.isArray(c.holdings) || c.holdings.length < 2) return null;
  const h    = c.holdings;
  const pct2 = (h[0] && h[0].pct || 0) + (h[1] && h[1].pct || 0);
  const pct3 = pct2 + (h[2] && h[2].pct || 0);
  if (pct2 >= 0.50) return Math.round(pct2 * 100);
  if (pct3 >= 0.50) return Math.round(pct3 * 100);
  return Math.round((c.top || 0) * 100);
}

// Resolve an AI-supplied evidence reference (a holding name) back to the
// authoritative { name, value, pct } from the profile. Case-insensitive
// exact match against the single-name concentration list (a superset of
// every individually-identifiable invested position). Returns null when
// the reference doesn't match anything real — the caller drops it.
export function resolveHolding(profile, ref) {
  if (!profile || !ref) return null;
  const c = profile.concentration;
  if (!c || !Array.isArray(c.holdings)) return null;
  const needle = String(ref).trim().toLowerCase();
  if (!needle) return null;
  for (const h of c.holdings) {
    if (String(h.name || '').trim().toLowerCase() === needle) {
      return { name: h.name, value: h.value, pct: h.pct, sub: null };
    }
  }
  return null;
}

// The compact JSON the server prompt carries next to the Markdown sheet.
export function buildInsightsFacts(profile, insights = []) {
  if (!profile) return null;

  const metricValues = computeMetricValues(profile);

  const holdingNames = (profile.concentration && Array.isArray(profile.concentration.holdings))
    ? profile.concentration.holdings.map(h => h.name).filter(Boolean)
    : [];

  const riskLevels = {};
  const rd = profile.riskDimensions || {};
  for (const key of RISK_DIMENSIONS) {
    if (rd[key] && rd[key].level) riskLevels[key] = rd[key].level;
  }

  const deterministic = (Array.isArray(insights) ? insights : []).map(i => ({
    id:     i.id,
    type:   i.type,
    impact: i.impact,
    tier:   i.impact === 'high' ? 'priority' : 'observation',
  }));

  return {
    metricKeys:     METRIC_KEYS,
    metricValues,                       // { stocks:{value,suffix}, ... }
    riskDimensions: RISK_DIMENSIONS,
    riskLevels,                         // { volatility:'elevated', ... }
    holdingNames,                       // valid evidence references
    deterministic,                      // what the engine already found
  };
}
