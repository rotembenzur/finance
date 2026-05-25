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

  return { lang, generatedAt: new Date().toISOString(), portfolioRead, summaryMetrics, riskSurface, cards };
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
