// ─────────────────────────────────────────────────────────────────
//  COMPOSITIONS — equity / bond / cash split for long-term products
//
//  Pensions, study funds, provident funds and investment-gemels are
//  held in the state as single entries with a single currentValue.
//  They are NOT broken down into individual securities — so the
//  cross-account allocation rollup can't see what's inside them
//  unless we tell it.
//
//  This module provides estimates. Resolution order per entry:
//
//    1. entry.compositionEstimate — explicit override on the entry
//         { equity, bonds, cash, intl } summing to ~1.0 (the
//         remaining sum after equity+bonds+cash is treated as intl
//         when intl is omitted; otherwise intl is just a sub-slice
//         of equity for the cross-account view).
//    2. Track-name heuristic — if the entry has a trackName/trackNameEn
//         that names a common track, infer from a small built-in map.
//    3. Type-default — broad assumption per entry.type
//
//  All numbers are estimates. The Intelligence page renders them
//  as such — never as facts. Live-data enrichment (Phase 2) will
//  replace the heuristics with actual provider compositions.
// ─────────────────────────────────────────────────────────────────

// Built-in heuristics by entry.type. Aggressive defaults at the
// shorter end of the working life (the user is 24) — most Israeli
// "age 50 and under" tracks sit around 75-85% equity in practice,
// so 0.75 is a reasonable midpoint for an unknown track.
const TYPE_DEFAULTS = {
  pension:           { equity: 0.65, bonds: 0.30, cash: 0.05 }, // mixed default — most pensions hold bonds
  study_fund:        { equity: 0.70, bonds: 0.25, cash: 0.05 },
  provident_fund:    { equity: 0.70, bonds: 0.25, cash: 0.05 },
  investment_gemel:  { equity: 0.85, bonds: 0.12, cash: 0.03 }, // marketed as long-horizon, usually equity-heavy
  // Family-managed investment — without more info, assume balanced
  investment_fund:   { equity: 0.60, bonds: 0.35, cash: 0.05 },
  // Locked bank savings + military deposits — capital, not equity
  savings:           { equity: 0.00, bonds: 0.00, cash: 1.00 },
  military_deposit:  { equity: 0.00, bonds: 0.00, cash: 1.00 },
};

// Track-name pattern matches. Order matters — earlier rules win.
// `match` is a substring or regex tested against trackName and
// trackNameEn (and against pension-track sub-entries too — see
// below). Keep this list tight; only add patterns we know map
// reliably to a composition shape.
const TRACK_HEURISTICS = [
  // Pure-equity index trackers
  { match: /S&P\s*500|מדד מניות|מסלול מניות|מחקה מדדי מניות|מחקה מדד|Equity Index Tracking|stocks track|מניות חו"ל|מניות חוץ/i,
    composition: { equity: 0.97, bonds: 0.00, cash: 0.03 } },

  // Age-band tracks — "age 50 and under" is the Israeli regulatory
  // glide path equivalent, typically ~75-85% equity.
  { match: /גיל 50 ומטה|age 50 and under/i,
    composition: { equity: 0.80, bonds: 0.17, cash: 0.03 } },

  // Bond-heavy tracks
  { match: /אג"ח|אג״ח|bonds?|bond track|מסלול אג/i,
    composition: { equity: 0.10, bonds: 0.85, cash: 0.05 } },

  // Money-market / shekel tracks — treat as cash
  { match: /כספית|כספי שקלי|money market|cash track/i,
    composition: { equity: 0.00, bonds: 0.10, cash: 0.90 } },

  // Mixed / general / standard
  { match: /כללי|כללית|general|standard|מסלול כללי/i,
    composition: { equity: 0.55, bonds: 0.40, cash: 0.05 } },
];

// Resolve composition for a single entry. Returns `{ equity, bonds,
// cash }` summing to ~1.0, or null when the entry has no long-term
// product shape (callers should treat null as "not applicable").
//
// `breakdown` (optional) is an object the caller can pass in to
// receive provenance: which resolution branch was used. Useful for
// rendering "based on track name" badges.
export function resolveComposition(entry, breakdown) {
  if (!entry) return null;

  // 1) Explicit override
  if (entry.compositionEstimate
      && typeof entry.compositionEstimate.equity === 'number') {
    if (breakdown) breakdown.source = 'override';
    return _normalize(entry.compositionEstimate);
  }

  // 2) Pension entries can have multi-track sub-entries — aggregate
  // each track separately and weight by track value.
  if (entry.type === 'pension' && Array.isArray(entry.tracks) && entry.tracks.length) {
    const total = entry.tracks.reduce((s, t) => s + (Number(t.value) || 0), 0);
    if (total > 0) {
      let eq = 0, bd = 0, cs = 0;
      for (const tr of entry.tracks) {
        const w = (Number(tr.value) || 0) / total;
        const c = _resolveByTrackName(tr.name, tr.nameEn) || TYPE_DEFAULTS.pension;
        eq += c.equity * w;
        bd += c.bonds  * w;
        cs += c.cash   * w;
      }
      if (breakdown) breakdown.source = 'pension-tracks';
      return _normalize({ equity: eq, bonds: bd, cash: cs });
    }
  }

  // 3) Track-name heuristic
  const byTrack = _resolveByTrackName(entry.trackName, entry.trackNameEn);
  if (byTrack) {
    if (breakdown) breakdown.source = 'track-name';
    return _normalize(byTrack);
  }

  // 4) Type default
  if (entry.type && TYPE_DEFAULTS[entry.type]) {
    if (breakdown) breakdown.source = 'type-default';
    return _normalize(TYPE_DEFAULTS[entry.type]);
  }

  return null;
}

function _resolveByTrackName(name, nameEn) {
  const text = `${name || ''} ${nameEn || ''}`;
  if (!text.trim()) return null;
  for (const rule of TRACK_HEURISTICS) {
    if (rule.match.test(text)) return { ...rule.composition };
  }
  return null;
}

function _normalize(comp) {
  const eq = Number(comp.equity) || 0;
  const bd = Number(comp.bonds)  || 0;
  const cs = Number(comp.cash)   || 0;
  const sum = eq + bd + cs;
  if (sum <= 0) return { equity: 0, bonds: 0, cash: 0 };
  return { equity: eq / sum, bonds: bd / sum, cash: cs / sum };
}
