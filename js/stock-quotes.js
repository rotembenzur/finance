// ─────────────────────────────────────────────────────────────────
//  STOCK QUOTES — live market data from Yahoo Finance
//
//  Single-ticker live quotes pulled from Yahoo's v8 chart endpoint
//  and cached in localStorage. Currently used only by the standalone
//  Bank Hapoalim (POLI.MR1) holding in the Invested section.
//
//  ── Manual-only philosophy ────────────────────────────────────
//  This module never auto-runs. No boot-time refresh, no polling,
//  no timer. Quotes are pulled only in response to an explicit user
//  action — the per-holding sync icon on the row.
//
//  ── Failure model ─────────────────────────────────────────────
//  Every failure path throws a StockQuoteError carrying { code,
//  endpoint, message, attempts }, so the caller can surface a
//  readable toast with copyable diagnostics. No silent nulls.
//
//  ── CORS / proxy strategy ─────────────────────────────────────
//  Yahoo's query1.finance.yahoo.com does NOT include
//  Access-Control-Allow-Origin for browser-origin requests. To
//  work around it we try fetch strategies in order:
//
//    1. direct
//    2. corsproxy.io
//    3. allorigins.win
//
//  The first that returns a parseable Yahoo payload wins. If all
//  fail, we throw a StockQuoteError listing each attempt.
// ─────────────────────────────────────────────────────────────────

// Tickers configured for live syncing. Tel Aviv Stock Exchange (.TA)
// symbols return prices in אגורות — divide by 100 for shekels.
export const STOCK_QUOTES = {
  // בנק הפועלים — MR1 share on TASE (price in אגורות).
  'POLI.MR1': { yahoo: 'POLI.TA', priceDivisor: 100, currency: 'ILS' },
};

const QUOTES_CACHE_KEY = 'stockQuotesCache_v1';
const FETCH_TIMEOUT_MS = 10_000;

// Fetch strategies tried in order. Direct first (cheapest), then
// public CORS proxies as fallbacks.
const FETCH_STRATEGIES = [
  {
    name:  'direct',
    build: (yahooUrl) => yahooUrl,
  },
  {
    name:  'corsproxy.io',
    build: (yahooUrl) => `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
  },
  {
    name:  'allorigins.win',
    build: (yahooUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
  },
];

// In-memory cache. Hydrated from localStorage at module load and
// pruned to the currently-configured ticker set — so cache entries
// left behind by removed tickers (an earlier Market Sync iteration,
// for instance) can NEVER bleed into entryValue() and contaminate
// portfolio totals. Without this gate, a stale USD price would get
// multiplied by an ILS-denominated quantity → wildly wrong shekel
// totals on the next render.
let _cache = _loadCacheFromStorage();

function _loadCacheFromStorage() {
  try {
    const raw = localStorage.getItem(QUOTES_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Drop any cached entries whose ticker isn't currently configured
    // for live syncing. Re-persist the pruned cache so the contamination
    // is cleared from localStorage as well, not just memory.
    const pruned = {};
    let removedAny = false;
    for (const ticker of Object.keys(parsed)) {
      if (STOCK_QUOTES[ticker]) pruned[ticker] = parsed[ticker];
      else                      removedAny    = true;
    }
    if (removedAny) {
      try { localStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify(pruned)); }
      catch { /* persistence is best-effort */ }
    }
    return pruned;
  } catch { /* corrupt cache — discard */ }
  return {};
}

function _saveCacheToStorage() {
  try { localStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify(_cache)); }
  catch { /* quota or storage disabled — best-effort */ }
}

// ── Structured error type ─────────────────────────────────────────
// Carries everything the toast needs to be useful:
//   code     — short machine-readable tag ('http_error', 'network',
//              'parse_error', 'missing_field', 'timeout',
//              'unknown_ticker', 'yahoo_error')
//   endpoint — the canonical Yahoo URL we were trying to reach
//   message  — short human-readable headline
//   attempts — per-strategy { name, requestUrl, code, status, detail }
export class StockQuoteError extends Error {
  constructor({ code, endpoint, message, attempts = [] }) {
    super(message);
    this.name     = 'StockQuoteError';
    this.code     = code;
    this.endpoint = endpoint;
    this.attempts = attempts;
  }

  toDetailsString() {
    const lines = [`Endpoint: ${this.endpoint}`, ''];
    if (this.attempts.length === 0) {
      lines.push(`Error: ${this.message}`);
    } else {
      lines.push('Attempts:');
      this.attempts.forEach((a, i) => {
        const head = `  ${i + 1}. ${a.name}`;
        const url  = `     URL:    ${a.requestUrl}`;
        const stat = a.status != null ? `     Status: ${a.status}` : null;
        const code = `     Code:   ${a.code}`;
        const det  = a.detail ? `     Detail: ${a.detail}` : null;
        [head, url, stat, code, det].filter(Boolean).forEach(l => lines.push(l));
      });
    }
    return lines.join('\n');
  }
}

// ── Public read-side accessor ─────────────────────────────────────

export function getStockQuote(ticker) {
  if (!ticker) return null;
  // Defensive gate: only surface quotes for tickers still configured
  // for live syncing. Even if a stale cache entry slipped through the
  // load-time pruning, entryValue() never sees it.
  if (!STOCK_QUOTES[ticker]) return null;
  return _cache[ticker] || null;
}

// In-flight deduplication. Re-entrant clicks return the same promise.
const _inflight = new Map();

// ── Low-level: try one fetch strategy ─────────────────────────────
async function _tryStrategy(strategy, yahooUrl, ticker) {
  const requestUrl = strategy.build(yahooUrl);
  console.log(`[stock-quotes] ${ticker} → trying strategy "${strategy.name}"`);
  console.log(`[stock-quotes] ${ticker} → URL: ${requestUrl}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(requestUrl, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && err.name === 'AbortError';
    throw {
      name:       strategy.name,
      requestUrl,
      code:       isTimeout ? 'timeout' : 'network',
      status:     null,
      detail:     isTimeout
        ? `Aborted after ${FETCH_TIMEOUT_MS}ms`
        : (err?.message || String(err)),
    };
  }
  clearTimeout(timer);

  console.log(`[stock-quotes] ${ticker} → HTTP ${response.status} via "${strategy.name}"`);

  if (!response.ok) {
    throw {
      name:       strategy.name,
      requestUrl,
      code:       'http_error',
      status:     response.status,
      detail:     `HTTP ${response.status} ${response.statusText || ''}`.trim(),
    };
  }

  let raw;
  try { raw = await response.text(); }
  catch (err) {
    throw {
      name:       strategy.name,
      requestUrl,
      code:       'read_error',
      status:     response.status,
      detail:     err?.message || String(err),
    };
  }

  let json;
  try { json = JSON.parse(raw); }
  catch (err) {
    throw {
      name:       strategy.name,
      requestUrl,
      code:       'parse_error',
      status:     response.status,
      detail:     `Could not parse JSON: ${err?.message || err}. First 200 chars: ${raw.slice(0, 200)}`,
    };
  }

  console.log(`[stock-quotes] ${ticker} → raw payload via "${strategy.name}":`, json);
  return json;
}

// ── Orchestrate strategies, validate payload, return raw meta ─────
async function _fetchYahooMeta(yahooUrl, label) {
  const attempts = [];
  let json = null;

  for (const strategy of FETCH_STRATEGIES) {
    try {
      json = await _tryStrategy(strategy, yahooUrl, label);
      if (json && json.chart && json.chart.error) {
        const yErr = json.chart.error;
        attempts.push({
          name:       strategy.name,
          requestUrl: strategy.build(yahooUrl),
          code:       'yahoo_error',
          status:     200,
          detail:     `${yErr.code || 'error'}: ${yErr.description || JSON.stringify(yErr)}`,
        });
        json = null;
        continue;
      }
      break;
    } catch (attemptErr) {
      console.warn(`[stock-quotes] ${label} → strategy "${strategy.name}" failed:`, attemptErr);
      attempts.push(attemptErr);
    }
  }

  if (!json) {
    throw new StockQuoteError({
      code:     attempts.length > 0 ? attempts[attempts.length - 1].code : 'all_strategies_failed',
      endpoint: yahooUrl,
      message:  `All ${FETCH_STRATEGIES.length} fetch strategies failed for ${label}`,
      attempts,
    });
  }

  const result = json && json.chart && json.chart.result && json.chart.result[0];
  const meta   = result && result.meta;
  if (!meta) {
    throw new StockQuoteError({
      code:     'missing_field',
      endpoint: yahooUrl,
      message:  `Yahoo response missing chart.result[0].meta`,
      attempts: [...attempts, {
        name: 'parse', requestUrl: yahooUrl, code: 'missing_field', status: 200,
        detail: `payload keys: ${Object.keys(json || {}).join(', ')}`,
      }],
    });
  }
  return meta;
}

// ── Build a parsed quote from the Yahoo meta ──────────────────────
function _parseQuote(ticker, cfg, meta) {
  const rawPrice = meta.regularMarketPrice;
  const rawPrev  = meta.previousClose;
  console.log(`[stock-quotes] ${ticker} → meta.regularMarketPrice: ${rawPrice}, meta.previousClose: ${rawPrev}`);
  if (typeof rawPrice !== 'number' || typeof rawPrev !== 'number') {
    throw new StockQuoteError({
      code:     'missing_field',
      endpoint: cfg.yahoo,
      message:  `meta.regularMarketPrice or meta.previousClose missing/non-numeric for ${ticker}`,
    });
  }

  const divisor   = cfg.priceDivisor || 1;
  const price     = rawPrice / divisor;
  const prevClose = rawPrev  / divisor;
  const change    = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;

  console.log(`[stock-quotes] ${ticker} → ${cfg.currency} price: ${price.toFixed(4)} (raw ${rawPrice} / ${divisor})`);

  return {
    ticker,
    yahoo:      cfg.yahoo,
    currency:   cfg.currency || 'ILS',
    price,
    prevClose,
    change,
    changePct,
    fetchedAt:  new Date().toISOString(),
  };
}

// ── Public write-side API ─────────────────────────────────────────

// Force-refresh a single ticker (ignores TTL). Throws StockQuoteError
// on any failure — the caller surfaces this to the user via toast.
// Request deduplication: concurrent calls for the same ticker await
// the same in-flight promise.
export async function refreshStockQuote(ticker) {
  if (_inflight.has(ticker)) return _inflight.get(ticker);

  const cfg = STOCK_QUOTES[ticker];
  if (!cfg) {
    throw new StockQuoteError({
      code:     'unknown_ticker',
      endpoint: '(none)',
      message:  `Ticker "${ticker}" is not configured in STOCK_QUOTES`,
    });
  }

  const p = (async () => {
    try {
      console.log(`[stock-quotes] refreshStockQuote("${ticker}") — force refresh`);
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cfg.yahoo)}`;
      const meta = await _fetchYahooMeta(yahooUrl, ticker);
      const quote = _parseQuote(ticker, cfg, meta);

      _cache[ticker] = quote;
      _saveCacheToStorage();
      console.log(`[stock-quotes] ${ticker} → cached:`, quote);
      return quote;
    } finally {
      _inflight.delete(ticker);
    }
  })();
  _inflight.set(ticker, p);
  return p;
}
