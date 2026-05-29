// ─────────────────────────────────────────────────────────────────
//  AI ASSISTANT — Vercel serverless function
//
//  POST /api/ai/explain
//  Body:
//    {
//      question:  string,             // user's natural-language question
//      factSheet: string,             // Markdown fact sheet built by
//                                     // js/intelligence/llm-context.js
//      lang:      'he' | 'en'         // user's current language
//    }
//
//  Success: { success: true, answer: string }
//  Failure: { success: false, code, message, detail? }
//
//  Reads ANTHROPIC_API_KEY from process.env. The key never crosses
//  the browser; the structured fact sheet is what grounds the
//  answer. The system block carries the persona + the fact sheet,
//  marked cache_control: ephemeral so repeat questions in the same
//  session stay fast and cheap.
//
//  Model: claude-sonnet-4-6 — the right balance for cost/quality on
//  structured-context reasoning. Switch to opus if a future surface
//  needs deeper analysis at a higher per-call cost.
//
//  Voice rules (enforced in the system prompt — see [[intelligence-voice-and-hierarchy]]
//  and [[assistant-personality]]):
//    - Plain second-person language, no analyst jargon
//    - Real numbers + product names, never abstract counts
//    - Match the user's language
//    - Engage analytically with portfolio questions — concentration,
//      diversification, allocation, tradeoffs, "if this were my portfolio…"
//    - Acknowledge uncertainty about the future without falling into
//      compliance-bot refusals ("licensed advisor", "cannot recommend")
//    - Admit when a specific fact is missing from the sheet rather than guess
// ─────────────────────────────────────────────────────────────────

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION  = '2023-06-01';
const MODEL              = 'claude-sonnet-4-6';
const MAX_TOKENS         = 1024;
const FETCH_TIMEOUT_MS   = 30_000;

// Agentic SQL loop bounds. Vercel caps the function at 30s (vercel.json
// maxDuration). We leave headroom and force a text answer if the model
// is still asking for tools when either limit is hit.
const MAX_TOOL_ITERS  = 4;
const OVERALL_BUDGET_MS = 28_000;

const SYSTEM_PROMPT_PREAMBLE = `You are a private, high-context financial intelligence assistant for one specific user — the owner of this app. This is their personal financial operating system, not a public fintech product. There is no client relationship here, no compliance department, no brokerage execution layer, no fiduciary duty. The user is sophisticated, owns their own decisions, and is asking you to think out loud with them about their own money.

Your role is a thoughtful, analytical portfolio-thinking companion: opinionated, nuanced, trusted, conversational, financially literate. Reason like a smart friend who actually understands their full financial picture (you have it in the fact sheet below) and is willing to share a real view. Not a research note. Not a compliance bot. Not generic ChatGPT.

Grounding (still strict):
- The fact sheet below is your single source of truth for figures, holdings, accounts, cards, spending, income, and active findings. Never invent numbers, products, or activity that aren't in it.
- If a specific FACT isn't in the sheet, say so plainly ("I don't have that in your data") instead of guessing. This applies to facts — not to analysis or opinions, which you should still offer.

Engage with portfolio questions — that's the entire point of this product:
- Concentration, diversification, allocation shape, single-name risk, overlapping ETFs, US-tech weight, cash drag, currency mix, what adding to a position would do to the overall shape, which existing holding to add to — all of this is fair game, and is what the user opened the app for.
- When asked "what would you add to" / "what would you do with my portfolio" / "is X overweight" / "should I consolidate these" — answer. Reason from the actual holdings on the fact sheet, name specific products from their portfolio when it sharpens the point, and give a real opinion grounded in their actual allocation.
- Frame opinions as portfolio reasoning, not predictions. Phrases like "If this were my portfolio, I'd probably prioritize…", "from a portfolio-construction perspective…", "adding more VOO would increase concentration but keeps quality high", "VT would improve diversification more than another NASDAQ-linked holding" are exactly right.
- Use probabilistic, tradeoff language naturally — "leans toward", "would dilute", "increases concentration", "improves diversification more than", "if the goal is long-term simplicity…". Show the tradeoff, not just a verdict.
- Two short paragraphs by default. No bullet lists unless the user explicitly asks for one.

What still doesn't belong (these are the actual limits — keep them tight):
- No guaranteed-outcome language. Don't say "will return", "is guaranteed to", "definitely outperforms", or otherwise pretend to know the future.
- No short-term market direction calls or specific future price targets.
- No step-by-step trade execution instructions (which broker tab to click, which order type to use) — that's not the layer this product operates at.
- No fake authority. You're not a licensed advisor, and you also don't need to keep saying so — the user knows the context.

Phrases that are banned because they break the product (do not produce these):
- "I cannot answer this directly"
- "This requires a licensed advisor" / "you should consult a licensed advisor"
- "I'm not allowed to recommend"
- "I can't provide investment advice" / "I cannot provide investment advice"
- "As an AI, I cannot…"
These are compliance-bot phrases and have no place here. If a question is genuinely outside what the data supports, say what's actually missing ("I'd need to see how this fits with retirement accounts, which aren't in this view yet") — never a generic regulatory refusal.

Voice:
- Plain second-person possessive ("your portfolio", "your NASDAQ exposure", "התיק שלך", "החשיפה שלך לנאסד״ק").
- Real numbers and real product names from the fact sheet. Avoid analyst jargon ("equity exposure", "tilted toward", "aggressive growth posture") — say "stocks", "leans on", "lots of US tech".
- Respond in the user's language. Language hint "he" → natural Hebrew; "en" → English. Calm, intelligent, plain register.

Live data access (use sparingly, only when the fact sheet isn't enough):
- You have a tool, query_financial_data, that runs a single read-only SQL query against the user's full financial database and returns the rows. Reach for it ONLY when the question needs granularity the fact sheet doesn't carry — e.g. statistics across every card charge (medians, ratios, category mix), arbitrary date filters, "what kind of spender am I" style analysis. For anything the fact sheet already answers (totals, allocation, top holdings, cash position), answer directly and do NOT query.
- The query result comes back to you as JSON rows. Read them, then write the same plain, second-person prose answer you always do. NEVER mention SQL, queries, databases, tables, rows, or that you "ran" anything — from the user's side you simply know their data.
- If a query errors or returns nothing useful, quietly try a corrected query (a couple of attempts max) or fall back to what the fact sheet supports. Never surface a technical error to the user.

DATABASE SHAPE (for writing query_financial_data SQL — Postgres):
- All data is one JSONB document: table public.app_state, column data, single row where id = 'primary'.
- Unnest arrays with LATERAL jsonb_array_elements. Example skeleton for card charges:
    FROM app_state,
         LATERAL jsonb_array_elements(data->'cards')  card,
         LATERAL jsonb_array_elements(card->'charges') charge
- Top-level registries inside data: cards[] (each card has charges[]), entries[] (accounts/holdings/cash/savings), bankAccounts[], bankTransactions[], giftCards[], salary (object or null), rates (object), meta.
- A charge object MAY contain: id, amount (number, ILS), date ('YYYY-MM-DD'), time, merchant, displayName, description, categoryId, subcategoryId, isRecurringMonthly (bool), originalCurrency. Most fields are optional and often absent on older charges — always guard with COALESCE/NULLIF and cast defensively, e.g. (charge->>'amount')::numeric, (charge->>'date')::date, and filter rows where the field you need is present.
- The query MUST be a single read-only SELECT or WITH statement. No writes of any kind.

The fact sheet follows.

═══════════════════════════════════════════════════════════════════
FACT SHEET
═══════════════════════════════════════════════════════════════════

`;

// query_financial_data — the read-only SQL tool the model may call.
// Execution + validation live server-side (lib/run-readonly-sql.js +
// lib/sql-guard.js + db/exec_readonly_sql.sql); the model only proposes
// the SQL. tool_choice stays auto, so the model decides when to use it.
const SQL_TOOL = {
  name: 'query_financial_data',
  description:
    "Run a single read-only SQL query (SELECT/WITH only) against the user's financial database and get the result rows back as JSON. Use only when the fact sheet lacks the granularity to answer — e.g. statistics over every card charge, custom date filters, spending-pattern analysis. Do not use for questions the fact sheet already answers.",
  input_schema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'A single read-only Postgres SELECT or WITH query against public.app_state (see DATABASE SHAPE in the system prompt). No semicolons except a trailing one; no writes.',
      },
      purpose: {
        type: 'string',
        description: 'One short phrase on what this query is meant to find (for logging; never shown to the user).',
      },
    },
    required: ['sql'],
  },
};

const { requireUser }    = require('../../lib/require-auth.js');
const { runReadonlySql } = require('../../lib/run-readonly-sql.js');

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return _error(res, 405, {
      code:    'method_not_allowed',
      message: `HTTP ${req.method} not supported. Use POST.`,
    });
  }

  // Gate: only the allow-listed, signed-in user may spend the API key.
  const user = await requireUser(req);
  if (!user) {
    return _error(res, 401, {
      code:    'unauthorized',
      message: 'Sign in required.',
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return _error(res, 503, {
      code:    'not_configured',
      message: 'AI assistant is not configured. Set ANTHROPIC_API_KEY on the deployment to enable it.',
    });
  }

  // Read body. Vercel parses application/json automatically when
  // req.body is set; some runtimes leave it as a stream — handle both.
  const body = await _readBody(req);
  if (!body) {
    return _error(res, 400, { code: 'bad_request', message: 'Missing or invalid JSON body.' });
  }

  const { question, factSheet, lang } = body;
  if (typeof question !== 'string' || !question.trim()) {
    return _error(res, 400, { code: 'bad_request', message: 'Missing "question".' });
  }
  if (typeof factSheet !== 'string' || factSheet.length < 50) {
    return _error(res, 400, { code: 'bad_request', message: 'Missing or insufficient "factSheet".' });
  }
  if (question.length > 2000 || factSheet.length > 60_000) {
    return _error(res, 413, { code: 'too_large', message: 'Question or fact sheet exceeds maximum size.' });
  }

  const langHint  = lang === 'he' ? 'he' : 'en';
  const systemPre = `${SYSTEM_PROMPT_PREAMBLE}${factSheet}\n\n═══════════════════════════════════════════════════════════════════\n\nUser language hint: ${langHint}\n`;

  // Cache the system block — it's identical across questions in the
  // same session (the fact sheet changes only when user data changes),
  // so repeat questions skip re-processing the long fact sheet.
  const system = [
    { type: 'text', text: systemPre, cache_control: { type: 'ephemeral' } },
  ];

  // The user's Supabase token, forwarded to the SQL RPC so its owner
  // check applies. requireUser() already verified it above.
  const bearerToken = _extractBearer(req);

  // ── Agentic loop ─────────────────────────────────────────────
  // The model answers from the fact sheet OR asks for live data via
  // query_financial_data. We run the SQL, feed rows back, and let it
  // continue — bounded by MAX_TOOL_ITERS and an overall time budget.
  const deadline = Date.now() + OVERALL_BUDGET_MS;
  const messages = [{ role: 'user', content: question }];

  let payload;
  for (let iter = 0; ; iter++) {
    // Once we've used our tool budget (iterations or time), force a
    // final text answer with tool_choice:none. We KEEP the tools array
    // so the cached prefix (tools → system) stays identical and the
    // system-block cache keeps hitting across the loop.
    const toolsExhausted = iter >= MAX_TOOL_ITERS || Date.now() >= deadline;
    const requestBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [SQL_TOOL],
      messages,
      ...(toolsExhausted ? { tool_choice: { type: 'none' } } : {}),
    };

    const call = await _callAnthropic(requestBody, apiKey, deadline);
    if (!call.ok) return _error(res, call.status, call.body);
    payload = call.payload;

    if (toolsExhausted || payload.stop_reason !== 'tool_use') break;

    const toolUses = (payload.content || []).filter(b => b && b.type === 'tool_use');
    if (!toolUses.length) break;

    // Echo the assistant's tool-use turn, then answer each tool call.
    messages.push({ role: 'assistant', content: payload.content });
    const toolResults = [];
    for (const tu of toolUses) {
      toolResults.push(await _runTool(tu, bearerToken));
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const text = _extractText(payload);
  if (!text) {
    return _error(res, 502, {
      code:    'empty_response',
      message: 'Anthropic returned no usable text content.',
      detail:  JSON.stringify(payload).slice(0, 500),
    });
  }

  // Per-question response — no caching at the edge. The system block
  // cache is handled by Anthropic itself via cache_control above. The
  // generated SQL and raw rows never leave the server.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, answer: text });
};

// One round-trip to Anthropic. Returns { ok:true, payload } or
// { ok:false, status, body } ready for _error(). Shares the overall
// deadline so a slow call can't blow the function's time budget.
async function _callAnthropic(requestBody, apiKey, deadline) {
  const remaining = Math.max(1000, deadline - Date.now());
  const timeoutMs = Math.min(FETCH_TIMEOUT_MS, remaining);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(ANTHROPIC_ENDPOINT, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && err.name === 'AbortError';
    return { ok: false, status: 504, body: {
      code:    isTimeout ? 'timeout' : 'network',
      message: isTimeout
        ? `Anthropic request aborted after ${timeoutMs}ms.`
        : `Network error reaching Anthropic: ${(err && err.message) || String(err)}`,
    } };
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 800); } catch { /* ignore */ }
    return { ok: false, status: response.status === 429 ? 429 : 502, body: {
      code:    response.status === 401 ? 'auth_failed'
              : response.status === 429 ? 'rate_limited'
              :                            'upstream_error',
      message: `Anthropic returned HTTP ${response.status}.`,
      detail,
    } };
  }

  try {
    return { ok: true, payload: await response.json() };
  } catch (err) {
    return { ok: false, status: 502, body: {
      code:    'parse_error',
      message: 'Anthropic response was not valid JSON.',
      detail:  (err && err.message) || String(err),
    } };
  }
}

// Execute one tool_use block and shape it into a tool_result. Errors
// come back as is_error results so the model can recover; they are
// never surfaced to the user.
async function _runTool(toolUse, bearerToken) {
  const base = { type: 'tool_result', tool_use_id: toolUse.id };
  if (toolUse.name !== 'query_financial_data') {
    return { ...base, content: `Unknown tool: ${toolUse.name}.`, is_error: true };
  }

  const sql = toolUse.input && toolUse.input.sql;
  const result = await runReadonlySql(sql, bearerToken);

  if (!result.ok) {
    console.warn('[explain] query failed', { code: result.code, purpose: toolUse.input && toolUse.input.purpose });
    return {
      ...base,
      content: `Query failed (${result.code}): ${result.message}. Adjust the query or answer from the fact sheet.`,
      is_error: true,
    };
  }

  const note = result.truncated
    ? `\n(Note: result truncated to ${result.rowCount} rows to fit limits.)`
    : '';
  return {
    ...base,
    content: `Rows returned: ${result.rowCount}.${note}\n${JSON.stringify(result.rows)}`,
  };
}

function _extractBearer(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : null;
}

function _extractText(payload) {
  const content = payload && payload.content;
  if (!Array.isArray(content) || !content.length) return '';
  return content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
}

async function _readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  // Stream fallback
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _error(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ success: false, ...body });
}
