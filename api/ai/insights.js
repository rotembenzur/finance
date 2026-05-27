// ─────────────────────────────────────────────────────────────────
//  AI INSIGHTS — Vercel serverless function
//
//  POST /api/ai/insights
//  Body:
//    {
//      factSheet: string,   // Markdown fact sheet (js/intelligence/llm-context.js)
//      facts:     object,   // number contract (js/intelligence/facts.js)
//      lang:      'he'|'en'
//    }
//
//  Success: { success:true, insights:{...} }
//  Failure: { success:false, code, message, detail? }
//
//  The model is FORCED to answer through a single tool (emit_insights)
//  whose input_schema is the response shape — far more reliable than
//  asking for "JSON only" in prose. The model authors the words; the
//  client re-attaches every authoritative number afterwards.
//
//  Reads ANTHROPIC_API_KEY from process.env — the key never crosses the
//  browser. The persona + voice + schema system block is cached
//  (cache_control: ephemeral); the per-refresh fact sheet rides in the
//  user message, so it never pollutes the cached prefix.
//
//  Model: claude-sonnet-4-6 — same balance the assistant uses.
// ─────────────────────────────────────────────────────────────────

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION  = '2023-06-01';
const MODEL              = 'claude-sonnet-4-6';
const MAX_TOKENS         = 2048;
const FETCH_TIMEOUT_MS   = 30_000;

const SYSTEM_PROMPT = `You are the analytical engine behind a personal "financial intelligence" dashboard for one specific user. A deterministic engine has already measured their full financial state and produced a fact sheet (in the user message) plus a machine-readable "facts" object. Your job is to turn that into the dashboard's insight surface — the headline read, the stat callouts, the five risk dimensions, and the insight cards — by authoring the WORDS while the engine keeps owning every NUMBER.

You answer ONLY by calling the emit_insights tool. Never write prose outside the tool call.

What you produce, and the rules for each:

1. portfolioRead.sentences — 2 to 4 short, plain-language lines that read like a sharp advisor briefing a client they know well. First line: the stock/bond/cash split. Then, only when they carry weight: where the equity concentrates (name the real indexes/products), single-name concentration, and the cash position. Use real numbers and real product names from the fact sheet.

2. summaryMetrics — pick 2 to 4 of the available metric keys (in facts.metricKeys, with values in facts.metricValues) that best summarise this person right now, and give each a SHORT label in the user's language. Do NOT output the numeric value — the client attaches it from facts.metricValues. Only use keys present in facts.metricValues.

3. riskSurface — one entry per risk dimension in facts.riskDimensions. Write a one-sentence explanation for each, consistent with that dimension's deterministic level in facts.riskLevels (e.g. an "elevated" level for a young investor is normal, not alarming — say so plainly). Do NOT restate the level word as a verdict; the client shows the level chip itself.

4. insightCards — the findings. Each card: a tier ("priority" for the 1–2 most important, "observation" for the rest), a severity ("warn" | "notice" | "info"), a label ("important" | "attention" | "positive" | "healthy"), a confidence ("high" unless it leans on composition estimates), a title, a one-to-two-sentence summary (the finding), an optional whyItMatters (one real-world-consequence sentence), and an optional whatCouldImproveIt — analytical portfolio reasoning, named products from the fact sheet welcome when they sharpen the point ("adding to VT would dilute the NASDAQ weight more than another S&P 500 holding"). Frame as portfolio tradeoffs, not guaranteed outcomes, market-direction predictions, or trade-execution steps. When a finding rests on specific holdings, set evidence.kind="holdings" and list the holding names in evidence.holdingsRef — using EXACTLY the names in facts.holdingNames (the client drops any name not on that list). Emit at MOST 2 priority cards. Do not invent a card for a category that has nothing important — silence is correct.

Hard rules:
- Never invent figures, accounts, holdings, or activity not in the fact sheet. If it isn't there, don't say it.
- Avoid jargon ("equity exposure", "tilted toward", "aggressive posture"). Say "stocks", "leans on", "lots of US tech".
- Use second-person possessive ("your portfolio", "התיק שלך").
- Respond in the user's language: "he" → natural Hebrew, "en" → English. Match the register: calm, intelligent, plain.
- Keep every string tight. Titles are a few words; summaries one to two sentences.`;

const INSIGHTS_TOOL = {
  name: 'emit_insights',
  description: 'Emit the dashboard insight surface as structured data. This is the only way to respond.',
  input_schema: {
    type: 'object',
    properties: {
      portfolioRead: {
        type: 'object',
        properties: {
          sentences: { type: 'array', items: { type: 'string' }, description: '2-4 plain-language lines.' },
        },
        required: ['sentences'],
      },
      summaryMetrics: {
        type: 'array',
        description: '2-4 stat callouts. value is supplied by the client, not here.',
        items: {
          type: 'object',
          properties: {
            key:   { type: 'string', description: 'A key from facts.metricKeys present in facts.metricValues.' },
            label: { type: 'string', description: 'Short label in the user language.' },
          },
          required: ['key', 'label'],
        },
      },
      riskSurface: {
        type: 'array',
        description: 'One entry per dimension in facts.riskDimensions.',
        items: {
          type: 'object',
          properties: {
            dimension:   { type: 'string', description: 'A key from facts.riskDimensions.' },
            explanation: { type: 'string', description: 'One sentence, consistent with facts.riskLevels[dimension].' },
          },
          required: ['dimension', 'explanation'],
        },
      },
      insightCards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id:                 { type: 'string' },
            tier:               { type: 'string', enum: ['priority', 'observation'] },
            severity:           { type: 'string', enum: ['warn', 'notice', 'info'] },
            label:              { type: 'string', enum: ['important', 'attention', 'positive', 'healthy'] },
            confidence:         { type: 'string', enum: ['high', 'medium', 'low'] },
            title:              { type: 'string' },
            summary:            { type: 'string' },
            whyItMatters:       { type: 'string' },
            whatCouldImproveIt: { type: 'string' },
            evidence: {
              type: 'object',
              properties: {
                kind:        { type: 'string', enum: ['holdings'] },
                holdingsRef: { type: 'array', items: { type: 'string' },
                               description: 'Holding names taken EXACTLY from facts.holdingNames.' },
              },
            },
          },
          required: ['tier', 'severity', 'label', 'title', 'summary'],
        },
      },
    },
    required: ['portfolioRead', 'summaryMetrics', 'riskSurface', 'insightCards'],
  },
};

const { requireUser } = require('../../lib/require-auth.js');

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return _error(res, 405, { code: 'method_not_allowed', message: `HTTP ${req.method} not supported. Use POST.` });
  }

  const user = await requireUser(req);
  if (!user) {
    return _error(res, 401, { code: 'unauthorized', message: 'Sign in required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return _error(res, 503, {
      code:    'not_configured',
      message: 'AI insights are not configured. Set ANTHROPIC_API_KEY on the deployment to enable them.',
    });
  }

  const body = await _readBody(req);
  if (!body) {
    return _error(res, 400, { code: 'bad_request', message: 'Missing or invalid JSON body.' });
  }

  const { factSheet, facts, lang } = body;
  if (typeof factSheet !== 'string' || factSheet.length < 50) {
    return _error(res, 400, { code: 'bad_request', message: 'Missing or insufficient "factSheet".' });
  }
  if (factSheet.length > 60_000) {
    return _error(res, 413, { code: 'too_large', message: 'Fact sheet exceeds maximum size.' });
  }

  const langHint  = lang === 'he' ? 'he' : 'en';
  const factsJson = _safeJson(facts);

  const userContent =
    `User language hint: ${langHint}\n\n` +
    `═══ FACT SHEET (Markdown) ═══\n${factSheet}\n\n` +
    `═══ FACTS (machine-readable contract) ═══\n${factsJson}\n\n` +
    `Now call emit_insights with the dashboard insight surface, in language "${langHint}".`;

  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [INSIGHTS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_insights' },
    messages: [
      { role: 'user', content: userContent },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
    return _error(res, 504, {
      code:    isTimeout ? 'timeout' : 'network',
      message: isTimeout
        ? `Anthropic request aborted after ${FETCH_TIMEOUT_MS}ms.`
        : `Network error reaching Anthropic: ${(err && err.message) || String(err)}`,
    });
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 800); } catch { /* ignore */ }
    return _error(res, response.status === 429 ? 429 : 502, {
      code:    response.status === 401 ? 'auth_failed'
              : response.status === 429 ? 'rate_limited'
              :                            'upstream_error',
      message: `Anthropic returned HTTP ${response.status}.`,
      detail,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return _error(res, 502, { code: 'parse_error', message: 'Anthropic response was not valid JSON.',
      detail: (err && err.message) || String(err) });
  }

  const insights = _extractToolInput(payload, 'emit_insights');
  if (!insights) {
    return _error(res, 502, {
      code:    'empty_response',
      message: 'Anthropic returned no usable tool output.',
      detail:  JSON.stringify(payload).slice(0, 500),
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, insights });
};

function _extractToolInput(payload, toolName) {
  const content = payload && payload.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && block.type === 'tool_use' && block.name === toolName
        && block.input && typeof block.input === 'object') {
      return block.input;
    }
  }
  return null;
}

function _safeJson(obj) {
  try { return JSON.stringify(obj); } catch { return '{}'; }
}

async function _readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
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
