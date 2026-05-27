// ─────────────────────────────────────────────────────────────────
//  STOCK QUOTES — live market data via our own backend proxy
//
//  Single-ticker live quotes fetched from /api/market/<symbol>
//  (Vercel serverless function in api/market/[symbol].js), cached
//  in localStorage. Currently used only by the standalone Bank
//  Hapoalim (POLI.MR1) holding in the Invested section.
//
//  ── Why a backend proxy ──────────────────────────────────────
//  Browser-origin fetches to Yahoo Finance get blocked: Yahoo's
//  edge omits Access-Control-Allow-Origin, and the public CORS
//  proxies (corsproxy.io, allorigins.win) are now rate-limited or
//  403'd from production. The serverless route runs server-side,
//  where CORS doesn't apply, and normalizes the response shape so
//  this module only needs one fetch path.
//
//  ── Manual-only philosophy ───────────────────────────────────
//  This module never auto-runs. No boot-time refresh, no polling,
//  no timer. Quotes are pulled only in response to an explicit
//  user action — the per-holding sync icon on the row.
//
//  ── Failure model ────────────────────────────────────────────
//  Every failure path throws a StockQuoteError carrying { code,
//  endpoint, message, attempts }, so the caller can surface a
//  readable toast with copyable diagnostics. No silent nulls.
// ─────────────────────────────────────────────────────────────────

import { authHeader } from './auth.js';
import { isDemoMode } from './demo-mode.js';

// Tickers configured for live syncing. The UI identifies a holding
// by its logical ticker ("POLI.MR1"); the `yahoo` field is the
// symbol the backend forwards to Yahoo Finance. The backend itself
// applies the TASE agorot→ILS divisor for `.TA` symbols, so this
// config no longer carries a priceDivisor.
export const STOCK_QUOTES = {
  // בנק הפועלים — MR1 share on TASE.
  'POLI.MR1': { yahoo: 'POLI.TA', currency: 'ILS' },
};

const QUOTES_CACHE_KEY = 'stockQuotesCache_v1';
const FETCH_TIMEOUT_MS = 10_000;

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
//              'unknown_ticker', 'yahoo_error', 'rate_limited',
//              'backend_error')
//   endpoint — the canonical URL we were trying to reach (the
//              backend route, or Yahoo as reported by the backend)
//   message  — short human-readable headline
//   attempts — per-attempt { name, requestUrl, code, status, detail }
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

// ── Fetch from our backend proxy ──────────────────────────────────
// One fetch, one response. The backend handles Yahoo retries, parsing,
// and the TASE agorot→ILS divisor; if it returns success:false we
// repackage its diagnostics into a StockQuoteError so the toast
// shows them the same way it used to show direct-fetch failures.
async function _fetchFromBackend(yahooSymbol, ticker) {
  const url = `/api/market/${encodeURIComponent(yahooSymbol)}`;
  console.log(`[stock-quotes] ${ticker} → backend URL: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { ...(await authHeader()) } });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && err.name === 'AbortError';
    throw new StockQuoteError({
      code:     isTimeout ? 'timeout' : 'network',
      endpoint: url,
      message:  isTimeout
        ? `Backend request aborted after ${FETCH_TIMEOUT_MS}ms`
        : `Could not reach backend: ${err?.message || String(err)}`,
      attempts: [{
        name:       'backend',
        requestUrl: url,
        code:       isTimeout ? 'timeout' : 'network',
        status:     null,
        detail:     err?.message || String(err),
      }],
    });
  }
  clearTimeout(timer);

  console.log(`[stock-quotes] ${ticker} → backend HTTP ${response.status}`);

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new StockQuoteError({
      code:     'parse_error',
      endpoint: url,
      message:  `Backend returned non-JSON response (HTTP ${response.status}).`,
      attempts: [{
        name:       'backend',
        requestUrl: url,
        code:       'parse_error',
        status:     response.status,
        detail:     err?.message || String(err),
      }],
    });
  }

  if (!json || json.success === false) {
    // The backend already shaped the failure — preserve its code,
    // upstream endpoint, message, and detail so the toast tells the
    // user what actually happened (rate_limited / yahoo_error / etc.).
    throw new StockQuoteError({
      code:     (json && json.code) || 'backend_error',
      endpoint: (json && json.endpoint) || url,
      message:  (json && json.message) || `Backend reported failure (HTTP ${response.status}).`,
      attempts: [{
        name:       'backend',
        requestUrl: url,
        code:       (json && json.code) || 'backend_error',
        status:     response.status,
        detail:     (json && json.detail) || (json && json.message) || '',
      }],
    });
  }

  console.log(`[stock-quotes] ${ticker} → backend payload:`, json);
  return json;
}

// ── Public write-side API ─────────────────────────────────────────

// Force-refresh a single ticker (ignores TTL). Throws StockQuoteError
// on any failure — the caller surfaces this to the user via toast.
// Request deduplication: concurrent calls for the same ticker await
// the same in-flight promise.
export async function refreshStockQuote(ticker) {
  // Demo mode: prices baked into DISPLAY_STATE entries are used as-is.
  // No /api/market/<symbol> call (would 401 without a Supabase session),
  // no cache mutation. Sync icons are hidden by the .requires-write
  // pattern; this guard is defensive in case any code path still hits it.
  if (isDemoMode()) {
    throw new StockQuoteError({
      code:     'demo_mode',
      endpoint: '(none)',
      message:  'Quote sync is disabled in demo mode.',
    });
  }

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
      console.log(`[stock-quotes] refreshStockQuote("${ticker}") — force refresh via backend`);
      const json = await _fetchFromBackend(cfg.yahoo, ticker);

      // Build the cache-entry shape the rest of the app expects.
      // The backend already normalized prices (TASE divisor, currency
      // override) so we just copy the fields straight through.
      const quote = {
        ticker,
        yahoo:     cfg.yahoo,
        currency:  json.currency || cfg.currency || 'ILS',
        price:     json.price,
        prevClose: json.prevClose,
        change:    json.change,
        changePct: json.changePct,
        fetchedAt: new Date().toISOString(),
      };

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
