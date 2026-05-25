// ─────────────────────────────────────────────────────────────────
//  INSIGHTS-AI — client helper for the "Refresh insights" action
//
//  refreshAIInsights(data) builds the grounded fact sheet + the number
//  contract, calls /api/ai/insights, then VALIDATES and NORMALIZES the
//  model's JSON before it is ever handed to the renderer. This module
//  is the safety net: malformed, oversized, or hallucinated output is
//  clamped or dropped here, so the design can't break and a fabricated
//  number can't reach the screen.
//
//  Contract:
//    request:  POST /api/ai/insights
//              { factSheet:string, facts:object, lang:'he'|'en' }
//    success:  HTTP 200  { success:true, insights:{...} }
//    failure:  HTTP 4xx|5xx { success:false, code, message, detail? }
//
//  This helper never throws and returns one of:
//    { ok:true,  insights:<normalized> }
//    { ok:false, code, message, status?, rawSnippet? }
//
//  Failure codes mirror assistant.js so app.js can reuse the same
//  code→friendly-message map (ASSISTANT_ERR_KEY).
// ─────────────────────────────────────────────────────────────────

import { buildFinancialProfile } from './profile.js';
import { buildInsights }         from './insights.js';
import { buildFactSheet }        from './llm-context.js';
import { buildInsightsFacts }    from './facts.js';
import { normalizeAIInsights }   from './insights-normalize.js';
import { currentLang }           from '../i18n.js';
import { authHeader }            from '../auth.js';

const ENDPOINT    = '/api/ai/insights';
const SNIPPET_LEN = 200;

export async function refreshAIInsights(data) {
  // ── Build the grounded inputs (defensively) ──────────────────
  let profile, factSheet, facts;
  try {
    profile = buildFinancialProfile(data);
    if (!profile) return _fail('no_data', 'No portfolio data yet.');
    const insights = buildInsights(profile, data);
    factSheet = buildFactSheet(profile, insights);
    facts     = buildInsightsFacts(profile, insights);
  } catch (err) {
    console.error('[insights-ai] fact build failed', err);
    return _fail('build_failed', 'Could not build the fact sheet.');
  }

  // ── HTTP call ────────────────────────────────────────────────
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body:    JSON.stringify({ factSheet, facts, lang: currentLang }),
    });
  } catch (err) {
    console.error('[insights-ai] fetch threw', err);
    return _fail('network', (err && err.message) || String(err));
  }

  // ── Read body as text first (same discipline as assistant.js) ─
  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err) {
    return _fail('read_failed', (err && err.message) || String(err), { status: response.status });
  }

  const status      = response.status;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawSnippet  = rawText.slice(0, SNIPPET_LEN);

  const looksJson = contentType.includes('application/json')
                 || rawText.trimStart().startsWith('{')
                 || rawText.trimStart().startsWith('[');
  if (!looksJson) {
    console.error('[insights-ai] non-JSON response', { status, contentType, body: rawSnippet });
    return _fail('non_json', `Server returned ${contentType || 'unknown type'} (HTTP ${status}).`,
      { status, contentType, rawSnippet });
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (err) {
    return _fail('parse', (err && err.message) || 'JSON parse failed.', { status, rawSnippet });
  }
  if (payload == null || typeof payload !== 'object') {
    return _fail('invalid_shape', 'Response was not an object.', { status, rawSnippet });
  }

  if (!response.ok) {
    const code    = typeof payload.code === 'string'    ? payload.code    : 'http_error';
    const message = typeof payload.message === 'string' ? payload.message : `HTTP ${status}`;
    console.error('[insights-ai] server error', { status, code, message });
    return _fail(code, message, { status });
  }

  if (payload.success !== true || payload.insights == null || typeof payload.insights !== 'object') {
    console.error('[insights-ai] bad success shape', payload);
    return _fail('invalid_shape', 'insights payload missing.', { status, rawSnippet });
  }

  // ── Normalize against the profile (the safety net) ───────────
  let insights;
  try {
    insights = normalizeAIInsights(payload.insights, profile, currentLang);
  } catch (err) {
    console.error('[insights-ai] normalize threw', err);
    return _fail('invalid_shape', 'Could not normalize insights.', { status });
  }

  if (!insights.cards.length && !insights.summaryMetrics.length
      && !insights.portfolioRead && !insights.riskSurface) {
    // The model returned valid JSON but nothing usable — treat as a
    // soft failure so the deterministic view stays on screen.
    return _fail('empty_answer', 'Model returned no usable insights.', { status });
  }

  return { ok: true, insights };
}

function _fail(code, message, extra = {}) {
  return Object.assign({ ok: false, code, message }, extra);
}
