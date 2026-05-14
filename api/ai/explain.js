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
//  Voice rules (enforced in the system prompt — see [[intelligence-voice-and-hierarchy]]):
//    - Plain second-person language, no analyst jargon
//    - Real numbers + product names, never abstract counts
//    - Match the user's language
//    - Refuse to recommend specific securities, brokers, or tax strategies
//    - Admit when data is insufficient rather than speculate
// ─────────────────────────────────────────────────────────────────

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION  = '2023-06-01';
const MODEL              = 'claude-sonnet-4-6';
const MAX_TOKENS         = 1024;
const FETCH_TIMEOUT_MS   = 30_000;

const SYSTEM_PROMPT_PREAMBLE = `You are a personal financial intelligence assistant for one specific user. They have an analytical engine that has already produced a structured fact sheet of their full financial state and current analytical findings — that fact sheet (below) is your single source of truth.

How to answer:
- Use the fact sheet. Never invent figures, accounts, holdings, or activity that aren't in it.
- Speak naturally and directly, like a sharp advisor briefing a client they know well. Not like a research note. Not like ChatGPT.
- Use real numbers and real product names from the fact sheet. Avoid jargon ("equity exposure", "tilted toward", "aggressive growth posture") — say "stocks", "leans on", "lots of US tech."
- Use second-person possessive ("your portfolio", "your money", "התיק שלך", "הכסף שלך").
- Two short paragraphs maximum. No bullet lists unless the user explicitly asks for one.
- Respond in the user's language. If the language hint says "he", reply in natural Hebrew. If "en", reply in English. Match the register: calm, intelligent, plain.

Rules and limits:
- Do not recommend specific securities, brokers, or tax strategies. You may describe what kinds of moves would change a given finding (e.g. "broader index funds typically dilute single-name concentration") but never name a specific ticker as a recommendation.
- If the user asks for advice the fact sheet can't answer (specific tax outcomes, market predictions, what to buy), say plainly that this isn't something you can answer here, and point at what *would* be needed (e.g. consulting a licensed advisor, looking at the specific fund's prospectus, etc.).
- If a number or fact isn't in the sheet, say "I don't have that information" rather than guessing.

The fact sheet follows.

═══════════════════════════════════════════════════════════════════
FACT SHEET
═══════════════════════════════════════════════════════════════════

`;

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return _error(res, 405, {
      code:    'method_not_allowed',
      message: `HTTP ${req.method} not supported. Use POST.`,
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
  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: systemPre, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: question },
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
    return _error(res, 502, {
      code:    'parse_error',
      message: 'Anthropic response was not valid JSON.',
      detail:  (err && err.message) || String(err),
    });
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
  // cache is handled by Anthropic itself via cache_control above.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, answer: text });
};

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
