// ─────────────────────────────────────────────────────────────────
//  INSIGHTS-NORMALIZE — the safety net for AI output
//
//  normalizeAIInsights(raw, profile, lang) takes the model's raw tool
//  output and returns a sanitized, render-ready payload. Everything
//  here clamps, whitelists, and re-attaches authoritative numbers, so:
//
//    • a malformed/oversized field can't break the design,
//    • an out-of-range enum can't reach a CSS class,
//    • a fabricated holding (or number) can't render — evidence is
//      re-resolved from the profile and unmatched refs are dropped.
//
//  Pure: imports only the engine's number contract. No DOM, no fetch,
//  no i18n — `lang` is passed in. This is what makes it unit-testable.
// ─────────────────────────────────────────────────────────────────

import { computeMetricValues, resolveHolding, RISK_DIMENSIONS } from './facts.js';

// Output guards — clamp the model so a verbose answer can never blow
// out a card or the page.
const MAX_PRIORITY     = 2;   // matches the deterministic MAX_HIGH_IMPACT
const MAX_OBSERVATIONS = 6;
const MAX_METRICS      = 4;   // the stat strip shows up to four callouts
const MAX_SENTENCES    = 6;
const MAX_EVIDENCE     = 6;
const LEN_TITLE        = 100;
const LEN_BODY         = 320;
const LEN_SENTENCE     = 320;

const TIERS       = new Set(['priority', 'observation']);
const SEVERITIES  = new Set(['warn', 'notice', 'info']);
const LABELS      = new Set(['important', 'attention', 'positive', 'healthy']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

export function normalizeAIInsights(raw, profile, lang) {
  if (raw == null || typeof raw !== 'object') {
    return { lang, generatedAt: new Date().toISOString(), portfolioRead: null, summaryMetrics: [], riskSurface: null, cards: [] };
  }

  const metricValues = computeMetricValues(profile);

  // Portfolio Read — already-localized sentences. Strip markup, clip,
  // cap count. (Figure cross-checking against facts is Phase 2.)
  let portfolioRead = null;
  const sents = raw.portfolioRead && Array.isArray(raw.portfolioRead.sentences)
    ? raw.portfolioRead.sentences
    : (Array.isArray(raw.portfolioRead) ? raw.portfolioRead : null);
  if (sents) {
    const lines = sents
      .filter(s => typeof s === 'string')          // prose lines must be real strings
      .map(s => _str(s, LEN_SENTENCE))
      .filter(Boolean)
      .slice(0, MAX_SENTENCES);
    if (lines.length) portfolioRead = { lines };
  }

  // Stat strip — the AI picks keys + labels; values come from facts.
  const summaryMetrics = [];
  if (Array.isArray(raw.summaryMetrics)) {
    const seen = new Set();
    for (const m of raw.summaryMetrics) {
      if (!m || typeof m !== 'object') continue;
      const key = _str(m.key, 40);
      if (!key || seen.has(key)) continue;
      const mv = metricValues[key];
      if (!mv) continue;                     // unknown/meaningless metric → drop
      seen.add(key);
      summaryMetrics.push({ key, label: _str(m.label, 40) || key, value: mv.value, suffix: mv.suffix });
      if (summaryMetrics.length >= MAX_METRICS) break;
    }
  }

  // Risk surface — the AI rewrites the explanation; the level/tone are
  // taken from the deterministic engine, not the model.
  let riskSurface = null;
  if (raw.riskSurface != null) {
    const map = {};
    const rows = Array.isArray(raw.riskSurface)
      ? raw.riskSurface
      : Object.entries(raw.riskSurface).map(([dimension, explanation]) => ({ dimension, explanation }));
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const dim = _str(row.dimension, 40);
      if (!RISK_DIMENSIONS.includes(dim)) continue;
      const explanation = _str(row.explanation, LEN_BODY);
      if (explanation) map[dim] = explanation;
    }
    if (Object.keys(map).length) riskSurface = map;
  }

  // Cards — validate, whitelist enums, clamp text, re-attach evidence.
  const rawCards = Array.isArray(raw.insightCards) ? raw.insightCards
                 : (Array.isArray(raw.cards) ? raw.cards : []);
  let cards = [];
  for (const c of rawCards) {
    const card = _normalizeCard(c, profile);
    if (card) cards.push(card);
  }

  // Enforce tier caps: demote priority overflow to observation, then
  // trim observations.
  const priority = cards.filter(c => c.tier === 'priority');
  if (priority.length > MAX_PRIORITY) {
    const demote = new Set(priority.slice(MAX_PRIORITY).map(c => c.id));
    cards = cards.map(c => demote.has(c.id)
      ? { ...c, tier: 'observation', label: c.label === 'important' ? 'attention' : c.label }
      : c);
  }
  const finalPriority    = cards.filter(c => c.tier === 'priority');
  const finalObservation = cards.filter(c => c.tier !== 'priority').slice(0, MAX_OBSERVATIONS);
  cards = [...finalPriority, ...finalObservation];

  // Cross-check every AI prose field against the deterministic figures.
  // Best-effort, dev observability only — the safety net for evidence
  // values already blocks the worst case (fabricated holdings). This
  // catches a number the model invented INSIDE a prose sentence.
  const unmatched = crossCheckInsights({ portfolioRead, riskSurface, cards }, profile);
  if (unmatched.length && typeof console !== 'undefined') {
    console.warn('[insights-normalize] unverified figures in AI prose:', unmatched);
  }

  return {
    lang,
    generatedAt: new Date().toISOString(),
    portfolioRead, summaryMetrics, riskSurface, cards,
    unverifiedFigureCount: unmatched.length,
  };
}

// ─────────────────────────────────────────────────────────────────
//  CROSS-CHECK — best-effort number integrity for AI prose
//
//  Extracts every "<n>%" and "₪<n>[K|M]" figure from each AI-authored
//  text field and tries to match it against the deterministic facts
//  with tolerance (±1% on percentages, ±2% or ±100₪ on currency). An
//  unmatched figure is reported but NOT blocked — the check is
//  heuristic (the model may legitimately quote a derived number) so
//  blocking would cause false positives. Console.warn is the dev
//  observability path; the UI keeps rendering.
// ─────────────────────────────────────────────────────────────────

export function crossCheckInsights(insights, profile) {
  if (!insights || !profile) return [];
  const allowed = _buildAllowedFigures(profile);
  const out = [];
  const check = (text, source) => {
    if (!text || typeof text !== 'string') return;
    for (const u of _crossCheckText(text, allowed)) out.push({ figure: u, source });
  };
  if (insights.portfolioRead && Array.isArray(insights.portfolioRead.lines)) {
    insights.portfolioRead.lines.forEach((line, i) => check(line, `read.line[${i}]`));
  }
  if (insights.riskSurface) {
    for (const [dim, text] of Object.entries(insights.riskSurface)) check(text, `risk.${dim}`);
  }
  for (const card of insights.cards || []) {
    check(card.summary,            `card.${card.id}.summary`);
    check(card.whyItMatters,       `card.${card.id}.why`);
    check(card.whatCouldImproveIt, `card.${card.id}.improve`);
  }
  return out;
}

function _buildAllowedFigures(profile) {
  const pcts = new Set();
  const ils  = new Set();
  const addP = n => { if (Number.isFinite(n)) pcts.add(Math.round(n * 100)); };
  const addI = n => { if (Number.isFinite(n)) ils.add(Math.round(n)); };

  const a  = profile.aggregate || {};
  addP(a.equityPct); addP(a.bondPct); addP(a.cashPct);
  addI(a.total); addI(a.equityValue); addI(a.bondValue); addI(a.cashValue);

  const ra = (profile.risk && profile.risk.aggregate) || {};
  addP(ra.techPct);

  const conc = profile.concentration || {};
  addP(conc.top); addI(conc.total);
  const h = conc.holdings || [];
  for (const x of h) { addP(x.pct); addI(x.value); }
  // top-2 / top-3 combined (the narrative + stat-strip values)
  if (h.length >= 2) addP((h[0].pct || 0) + (h[1].pct || 0));
  if (h.length >= 3) addP((h[0].pct || 0) + (h[1].pct || 0) + (h[2].pct || 0));

  for (const g of profile.overlap || []) {
    addP(g.pct); addI(g.totalValue); addI(g.rawValue);
    for (const gh of g.holdings || []) addI(gh.value);
  }

  const c = profile.cash || {};
  addI(c.availableILS); addI(c.recurringMonthly); addI(c.idleILS);
  // monthsOfCover is small integer — sits in the pcts bucket (numbers
  // without %/₪ aren't parsed today, but if added later they'd live here).
  if (Number.isFinite(c.monthsOfCover)) pcts.add(Math.round(c.monthsOfCover));

  for (const v of Object.values(profile.netWorth || {})) addI(v);
  if (profile.recurring)       addI(profile.recurring.monthlyTotal);
  if (profile.spending)        addI(profile.spending.totalCharges);
  if (profile.futureDeposits)  addI(profile.futureDeposits.total);
  if (profile.cards)           addI(profile.cards.totalOutstanding);
  if (profile.income)          addI(profile.income.netAmount);

  for (const acc of profile.accounts || []) {
    addI(acc.totalILS);
    if (acc.composition) {
      addP(acc.composition.equity); addP(acc.composition.bonds); addP(acc.composition.cash);
    }
  }
  return { pcts, ils };
}

function _crossCheckText(text, allowed) {
  const unmatched = [];
  // percent: 73%, 14.5%
  const pctRe = /(\d[\d,]*(?:\.\d+)?)\s*%/g;
  let m;
  while ((m = pctRe.exec(text)) !== null) {
    const p = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(p)) continue;
    let ok = false;
    for (const a of allowed.pcts) {
      if (Math.abs(a - p) <= 1) { ok = true; break; }   // ±1% tolerates rounding
    }
    if (!ok) unmatched.push(`${m[1]}%`);
  }
  // currency: ₪14,000, ₪500K, ₪1.2M
  const ilsRe = /₪\s?(\d[\d,]*(?:\.\d+)?)\s*([KkMm]?)/g;
  while ((m = ilsRe.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    const suffix = m[2].toLowerCase();
    if (suffix === 'k') n *= 1000;
    else if (suffix === 'm') n *= 1000000;
    if (!Number.isFinite(n)) continue;
    let ok = false;
    for (const a of allowed.ils) {
      if (a === 0 && n === 0) { ok = true; break; }
      if (a > 0) {
        const diff = Math.abs(a - n);
        if (diff <= Math.max(100, a * 0.02)) { ok = true; break; }   // ±2% or ±100₪
      }
    }
    if (!ok) unmatched.push(`₪${m[1]}${m[2]}`);
  }
  return unmatched;
}


function _normalizeCard(c, profile) {
  if (!c || typeof c !== 'object') return null;

  const title   = _str(c.title, LEN_TITLE);
  const summary = _str(c.summary, LEN_BODY);
  if (!title || !summary) return null;       // a card must say something

  const tier       = TIERS.has(c.tier)             ? c.tier       : 'observation';
  const severity   = SEVERITIES.has(c.severity)    ? c.severity   : 'info';
  const label      = LABELS.has(c.label)           ? c.label      : 'attention';
  const confidence = CONFIDENCES.has(c.confidence) ? c.confidence : 'high';

  // Evidence: only 'holdings' is supported for AI cards in Phase 1.
  // Each reference is re-resolved to authoritative {value, pct}; an
  // unmatched reference is dropped so a fabricated holding can't render.
  let evidence = null;
  const ev = c.evidence;
  if (ev && ev.kind === 'holdings') {
    const refs = Array.isArray(ev.holdingsRef) ? ev.holdingsRef
               : (Array.isArray(ev.items) ? ev.items.map(it => it && (it.name || it.ref)) : []);
    const items = [];
    const seen = new Set();
    for (const ref of refs) {
      const resolved = resolveHolding(profile, ref);
      if (!resolved || seen.has(resolved.name)) continue;
      seen.add(resolved.name);
      items.push(resolved);
      if (items.length >= MAX_EVIDENCE) break;
    }
    if (items.length) evidence = { kind: 'holdings', items };
  }

  return {
    id: _str(c.id, 60) || _slug(title),
    tier, severity, label, confidence,
    title,
    summary,
    whyItMatters:       _str(c.whyItMatters, LEN_BODY) || null,
    whatCouldImproveIt: _str(c.whatCouldImproveIt, LEN_BODY) || null,
    evidence,
  };
}

// Coerce to a trimmed, single-line, length-clamped plain string. Strips
// any stray markup so model output can't inject HTML structure (the
// renderer escapes again — defense in depth).
function _str(v, max) {
  if (v == null) return '';
  let s = String(v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.slice(0, max).trim();
  return s;
}

function _slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card';
}
