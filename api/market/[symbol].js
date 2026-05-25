// ─────────────────────────────────────────────────────────────────
//  MARKET QUOTE PROXY — Vercel serverless function
//
//  Frontends cannot call Yahoo Finance directly: Yahoo does not send
//  CORS headers for browser-origin requests, and its anti-bot layer
//  blocks the public CORS proxies we used to fan out through. So
//  this route runs server-side (where CORS doesn't apply) and acts
//  as a thin proxy over Yahoo's v8 chart endpoint.
//
//  Request:  GET /api/market/POLI.TA
//  Success:  { success: true,
//              symbol, price, prevClose, change, changePct,
//              currency, source: 'Yahoo Finance', timestamp }
//  Failure:  { success: false, code, message, endpoint,
//              status?, detail? }   with appropriate HTTP status
//
//  The frontend (js/stock-quotes.js) consumes the failure shape via
//  StockQuoteError so failure toasts stay structured and copyable.
// ─────────────────────────────────────────────────────────────────

const YAHOO_BASE       = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const FETCH_TIMEOUT_MS = 10_000;

// Tight allowlist for the path parameter. Yahoo symbols are
// short and alphanumeric with a handful of punctuation chars
// (^GSPC, BTC-USD, EUR=X, POLI.TA). Anything else is almost
// certainly an injection attempt and we reject before spending
// the Yahoo round-trip.
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-_=^]{1,32}$/;

const { requireUser } = require('../../lib/require-auth.js');

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return _error(res, 405, {
      code:     'method_not_allowed',
      message:  `HTTP ${req.method} not supported. Use GET.`,
    });
  }

  // Gate: only the allow-listed, signed-in user may use this proxy.
  const user = await requireUser(req);
  if (!user) {
    return _error(res, 401, {
      code:     'unauthorized',
      message:  'Sign in required.',
    });
  }

  const rawSymbol = req.query && req.query.symbol;
  const symbol    = Array.isArray(rawSymbol) ? rawSymbol[0] : rawSymbol;
  if (!symbol || typeof symbol !== 'string') {
    return _error(res, 400, {
      code:    'bad_request',
      message: 'Missing symbol path parameter.',
    });
  }
  if (!SYMBOL_PATTERN.test(symbol)) {
    return _error(res, 400, {
      code:    'bad_request',
      message: 'Symbol contains unsupported characters or is too long.',
    });
  }

  const endpoint = `${YAHOO_BASE}${encodeURIComponent(symbol)}`;

  // Yahoo's edge sometimes returns 401/403 to non-browser UAs. A
  // generic UA gets us through. AbortController gives us a hard
  // timeout so a hung Yahoo connection can't pin the function open.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FinanceDashboard/1.0; +server-proxy)',
        'Accept':     'application/json, text/plain, */*',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && err.name === 'AbortError';
    return _error(res, 504, {
      code:     isTimeout ? 'timeout' : 'network',
      message:  isTimeout
        ? `Yahoo request aborted after ${FETCH_TIMEOUT_MS}ms.`
        : `Network error while reaching Yahoo Finance: ${(err && err.message) || String(err)}`,
      endpoint,
    });
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch { /* ignore */ }
    // 429 stays 429 (rate-limited). Everything else surfaces as 502
    // since the upstream — not the frontend — failed.
    const proxyStatus = response.status === 429 ? 429 : 502;
    return _error(res, proxyStatus, {
      code:    response.status === 429 ? 'rate_limited' : 'http_error',
      message: `Yahoo returned HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}.`,
      endpoint,
      status:  response.status,
      detail,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return _error(res, 502, {
      code:    'parse_error',
      message: 'Yahoo response was not valid JSON.',
      endpoint,
      detail:  (err && err.message) || String(err),
    });
  }

  // Yahoo signals its own application-level errors with HTTP 200 plus
  // chart.error populated. Surface those as a distinct code so the
  // frontend can show "unknown ticker" / "delisted" cleanly.
  const yahooError = payload && payload.chart && payload.chart.error;
  if (yahooError) {
    return _error(res, 502, {
      code:    'yahoo_error',
      message: `${yahooError.code || 'error'}: ${yahooError.description || 'Yahoo Finance reported an error.'}`,
      endpoint,
    });
  }

  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const meta   = result && result.meta;
  if (!meta) {
    return _error(res, 502, {
      code:    'missing_field',
      message: 'Yahoo response missing chart.result[0].meta.',
      endpoint,
      detail:  `payload keys: ${Object.keys(payload || {}).join(', ')}`,
    });
  }

  const rawPrice = meta.regularMarketPrice;
  const rawPrev  = meta.previousClose;
  if (typeof rawPrice !== 'number' || typeof rawPrev !== 'number') {
    return _error(res, 502, {
      code:    'missing_field',
      message: `meta.regularMarketPrice or meta.previousClose missing/non-numeric for ${symbol}.`,
      endpoint,
      detail:  `regularMarketPrice=${rawPrice} previousClose=${rawPrev}`,
    });
  }

  // TASE quirk: Yahoo returns prices for `.TA` tickers in agorot but
  // labels the currency as ILS. Divide by 100 here so the frontend
  // doesn't need to know about Yahoo's per-exchange conventions.
  const isTASE   = /\.TA$/i.test(symbol);
  const divisor  = isTASE ? 100 : 1;
  const price     = rawPrice / divisor;
  const prevClose = rawPrev  / divisor;
  const change    = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const currency  = isTASE ? 'ILS' : (meta.currency || null);

  // Edge caching: even at single-user scale, this means rapid
  // re-clicks of the sync button (or the same page open in two tabs)
  // hit Vercel's CDN instead of Yahoo. Keeps us comfortably under
  // any per-IP rate budget Yahoo applies.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({
    success:   true,
    symbol,
    price,
    prevClose,
    change,
    changePct,
    currency,
    source:    'Yahoo Finance',
    timestamp: typeof meta.regularMarketTime === 'number'
      ? meta.regularMarketTime
      : Math.floor(Date.now() / 1000),
  });
};

function _error(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ success: false, ...body });
}
