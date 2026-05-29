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
import { isDemoMode }            from '../demo-mode.js';
import { lookupDemoAnswer }      from '../../data/display-state.js';

const ENDPOINT     = '/api/ai/explain';
const MAX_QUESTION = 2000;
const SNIPPET_LEN  = 200;

// askAssistant(question, data, handlers?)
//
//   handlers.onStage(stage)  — called with 'understanding' | 'querying'
//                              | 'analyzing' | 'writing' as the server
//                              reports progress (streamed). Each stage
//                              supersedes the streamed answer-so-far.
//   handlers.onToken(textSoFar) — called with the cumulative answer
//                              text as it streams in (live typing).
//
// Both are optional; when omitted the call still resolves to the final
// { ok, answer }. Demo mode and any pre-stream error bypass streaming.
export async function askAssistant(question, data, handlers = {}) {
  const onStage = typeof handlers.onStage === 'function' ? handlers.onStage : () => {};
  const onToken = typeof handlers.onToken === 'function' ? handlers.onToken : () => {};

  // ── Input validation (caller side) ───────────────────────────
  if (typeof question !== 'string' || !question.trim()) {
    return _fail('empty', 'Empty question.');
  }
  if (question.length > MAX_QUESTION) {
    return _fail('too_large', `Question exceeds ${MAX_QUESTION} characters.`);
  }

  // PUBLIC DISPLAY MODE — answer from the pre-baked Q&A bundle in
  // data/display-state.js. No /api/ai/explain call (would 401 without
  // a Supabase session anyway), no fact-sheet build, no auth header.
  if (isDemoMode()) {
    const answer = lookupDemoAnswer(question, currentLang);
    return { ok: true, answer };
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
  // Backstop abort: a streamed answer can take up to the function's
  // 60s ceiling; allow a little beyond that for the connection itself.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 70_000);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body:    JSON.stringify({ question, factSheet, lang: currentLang }),
    });
  } catch (err) {
    clearTimeout(abortTimer);
    console.error('[assistant] fetch threw', err);
    const isAbort = err && err.name === 'AbortError';
    return _fail(isAbort ? 'timeout' : 'network', (err && err.message) || String(err));
  }

  const status      = response.status;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // ── Streamed (SSE) success path ──────────────────────────────
  if (response.ok && contentType.includes('text/event-stream') && response.body) {
    try {
      const result = await _consumeStream(response.body, onStage, onToken);
      clearTimeout(abortTimer);
      return result;
    } catch (err) {
      clearTimeout(abortTimer);
      console.error('[assistant] stream read failed', err);
      const isAbort = err && err.name === 'AbortError';
      return _fail(isAbort ? 'timeout' : 'read_failed', (err && err.message) || String(err), { status });
    }
  }

  // ── Non-streamed fallback (pre-stream errors, old deploys) ───
  // Errors raised before the server switches to SSE come back as plain
  // JSON with a status code; so might an old deployment. Read the body
  // as text first so a non-JSON outage page yields a useful code.
  clearTimeout(abortTimer);
  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err) {
    console.error('[assistant] could not read response body', err);
    return _fail('read_failed', (err && err.message) || String(err), { status });
  }

  const rawSnippet = rawText.slice(0, SNIPPET_LEN);
  const looksJson = contentType.includes('application/json')
                 || rawText.trimStart().startsWith('{')
                 || rawText.trimStart().startsWith('[');

  if (!looksJson) {
    console.error('[assistant] non-JSON response', { status, contentType, body: rawSnippet });
    return _fail('non_json', `Server returned ${contentType || 'unknown type'} (HTTP ${status}).`, {
      status, contentType, rawSnippet,
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (err) {
    console.error('[assistant] JSON parse failed', { status, contentType, body: rawSnippet, error: err });
    return _fail('parse', (err && err.message) || 'JSON parse failed.', { status, contentType, rawSnippet });
  }

  if (payload == null || typeof payload !== 'object') {
    console.error('[assistant] payload not an object', { status, payload });
    return _fail('invalid_shape', 'Response was not an object.', { status, rawSnippet });
  }

  if (!response.ok) {
    const code    = typeof payload.code === 'string'    ? payload.code    : 'http_error';
    const message = typeof payload.message === 'string' ? payload.message : `HTTP ${status}`;
    console.error('[assistant] server error', { status, code, message, detail: payload.detail });
    return _fail(code, message, { status, detail: payload.detail });
  }

  // Old non-streaming success shape: { success:true, answer }.
  if (payload.success === true && typeof payload.answer === 'string' && payload.answer.trim()) {
    return { ok: true, answer: payload.answer };
  }
  console.error('[assistant] unexpected success payload', payload);
  return _fail('invalid_shape', 'Unexpected response shape.', { status, rawSnippet });
}

// Read the Server-Sent Event stream from /api/ai/explain. Dispatches
// stage/token events to the callbacks and resolves to the same
// { ok, answer } | { ok:false, code, message } shape as the caller.
async function _consumeStream(body, onStage, onToken) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const evt = _parseSseFrame(frame);
      if (!evt) continue;

      if (evt.event === 'stage') {
        // A new stage supersedes any partial answer streamed so far.
        answer = '';
        onStage(evt.data.stage);
      } else if (evt.event === 'token') {
        answer += evt.data.text || '';
        onToken(answer);
      } else if (evt.event === 'done') {
        const finalAnswer = (evt.data.answer || answer || '').trim();
        if (!finalAnswer) return _fail('empty_answer', 'Server returned empty answer.');
        return { ok: true, answer: finalAnswer };
      } else if (evt.event === 'error') {
        const code = typeof evt.data.code === 'string' ? evt.data.code : 'upstream_error';
        console.error('[assistant] stream error event', evt.data);
        return _fail(code, evt.data.message || 'Stream error.');
      }
    }
  }

  // Stream ended without a done/error frame.
  if (answer.trim()) return { ok: true, answer: answer.trim() };
  return _fail('empty_answer', 'Stream ended without an answer.');
}

// Parse one SSE frame ("event: X\ndata: {...}") into { event, data }.
// Lines starting with ':' are comments (keepalive) → ignored.
function _parseSseFrame(frame) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  let data;
  try { data = JSON.parse(dataLines.join('\n')); } catch { return null; }
  return { event, data };
}


function _fail(code, message, extra = {}) {
  return Object.assign({ ok: false, code, message }, extra);
}
