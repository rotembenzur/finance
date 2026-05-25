// ─────────────────────────────────────────────────────────────────
//  ASSISTANT — client helper for the AI panel on the Intelligence page
//
//  Contract between frontend, engine, and serverless endpoint:
//
//    request:
//      POST /api/ai/explain
//      Content-Type: application/json
//      Body: { question: string, factSheet: string, lang: 'he' | 'en' }
//
//    server success response:
//      HTTP 200, Content-Type: application/json
//      Body:    { success: true, answer: string }
//
//    server failure response:
//      HTTP 4xx | 5xx, Content-Type: application/json
//      Body:    { success: false, code: string, message: string, detail?: string }
//
//  This helper returns one of two structured shapes — never throws,
//  never returns a partially-populated object:
//
//    { ok: true,  answer: string }
//    { ok: false, code, message, status?, contentType?, rawSnippet? }
//
//  The `rawSnippet` is the first 200 chars of the response body when
//  parsing or shape validation failed. Logged via console.error along
//  with the structured result; never rendered to end-users by the page.
//
//  Failure codes the page maps to friendly messages (see app.js):
//    empty           — empty question (caller-side)
//    no_data         — no financial state yet
//    network         — fetch() rejected (offline, CORS, etc.)
//    read_failed     — could not read response body
//    non_json        — server returned HTML / text (most often: Vercel
//                      function not executing — e.g. python http.server)
//    parse           — Content-Type claimed JSON but body wouldn't parse
//    invalid_shape   — JSON parsed but missing required fields
//    empty_answer    — success=true but answer is empty
//    not_configured  — server returned 503 with code 'not_configured'
//    rate_limited    — 429 from Anthropic
//    auth_failed     — 401 from Anthropic (bad API key)
//    upstream_error  — other 5xx from Anthropic
//    timeout         — server-side abort (request took too long)
//    too_large       — request body exceeded limits
//    bad_request     — server rejected request shape
//    http_error      — any other non-2xx that came back as JSON
// ─────────────────────────────────────────────────────────────────

import { buildFinancialProfile } from './profile.js';
import { buildInsights }         from './insights.js';
import { buildFactSheet }        from './llm-context.js';
import { currentLang }           from '../i18n.js';
import { authHeader }            from '../auth.js';

const ENDPOINT     = '/api/ai/explain';
const MAX_QUESTION = 2000;
const SNIPPET_LEN  = 200;

export async function askAssistant(question, data) {
  // ── Input validation (caller side) ───────────────────────────
  if (typeof question !== 'string' || !question.trim()) {
    return _fail('empty', 'Empty question.');
  }
  if (question.length > MAX_QUESTION) {
    return _fail('too_large', `Question exceeds ${MAX_QUESTION} characters.`);
  }

  // Build the structured fact sheet defensively. buildFinancialProfile
  // and buildFactSheet are each designed to never throw on partial or
  // malformed state, but wrap the whole pipeline anyway so a bug here
  // can't take down the UI — the user gets a friendly error instead.
  let factSheet;
  try {
    const profile = buildFinancialProfile(data);
    if (!profile) return _fail('no_data', 'No portfolio data yet.');
    const insights = buildInsights(profile, data);
    factSheet = buildFactSheet(profile, insights);
  } catch (err) {
    console.error('[assistant] fact-sheet build failed', err);
    return _fail('build_failed', 'Could not build the fact sheet.', { detail: String(err && err.message || err) });
  }

  // ── HTTP call ────────────────────────────────────────────────
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body:    JSON.stringify({ question, factSheet, lang: currentLang }),
    });
  } catch (err) {
    console.error('[assistant] fetch threw', err);
    return _fail('network', (err && err.message) || String(err));
  }

  // ── Always read body as text first ───────────────────────────
  // Calling response.json() directly is unsafe: any non-JSON
  // response (HTML error page from the dev server, gateway page
  // from a CDN, plaintext from an outage) throws and we lose the
  // raw body that would tell us what's actually wrong.
  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err) {
    console.error('[assistant] could not read response body', err);
    return _fail('read_failed', (err && err.message) || String(err), {
      status: response.status,
    });
  }

  const status      = response.status;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawSnippet  = rawText.slice(0, SNIPPET_LEN);

  // ── Detect HTML / non-JSON responses early ───────────────────
  // The most common cause is the dev server not executing the
  // /api function (python http.server returns 501 + text/html).
  // Without this branch we'd hand HTML to JSON.parse and get a
  // misleading "parse" code.
  const looksJson = contentType.includes('application/json')
                 || rawText.trimStart().startsWith('{')
                 || rawText.trimStart().startsWith('[');

  if (!looksJson) {
    console.error('[assistant] non-JSON response', { status, contentType, body: rawSnippet });
    return _fail('non_json', `Server returned ${contentType || 'unknown type'} (HTTP ${status}).`, {
      status, contentType, rawSnippet,
    });
  }

  // ── Parse JSON ───────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (err) {
    console.error('[assistant] JSON parse failed', { status, contentType, body: rawSnippet, error: err });
    return _fail('parse', (err && err.message) || 'JSON parse failed.', {
      status, contentType, rawSnippet,
    });
  }

  if (payload == null || typeof payload !== 'object') {
    console.error('[assistant] payload not an object', { status, payload });
    return _fail('invalid_shape', 'Response was not an object.', { status, rawSnippet });
  }

  // ── HTTP-level failure (server replied with valid JSON) ──────
  if (!response.ok) {
    const code    = typeof payload.code === 'string'    ? payload.code    : 'http_error';
    const message = typeof payload.message === 'string' ? payload.message : `HTTP ${status}`;
    console.error('[assistant] server error', { status, code, message, detail: payload.detail });
    return _fail(code, message, { status, detail: payload.detail });
  }

  // ── Success shape validation ─────────────────────────────────
  if (payload.success !== true) {
    console.error('[assistant] success flag missing/false', payload);
    return _fail('invalid_shape', 'success flag missing.', { status, rawSnippet });
  }
  if (typeof payload.answer !== 'string') {
    console.error('[assistant] answer field missing or wrong type', payload);
    return _fail('invalid_shape', 'answer field missing.', { status, rawSnippet });
  }
  if (!payload.answer.trim()) {
    console.error('[assistant] empty answer', payload);
    return _fail('empty_answer', 'Server returned empty answer.', { status });
  }

  return { ok: true, answer: payload.answer };
}


function _fail(code, message, extra = {}) {
  return Object.assign({ ok: false, code, message }, extra);
}
