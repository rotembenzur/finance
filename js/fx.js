// ─────────────────────────────────────────────────────────────────
//  FX — live exchange rates for multi-currency cash
//
//  Fetches "1 foreign = X ILS" rates from open.er-api.com (free,
//  key-less, CORS-enabled), caches them in localStorage with a 4h
//  TTL, and falls back to the project's static `data.rates` if the
//  network is unreachable. The whole module never blocks rendering:
//  callers should treat rates as eventually-consistent and re-render
//  when refreshRatesIfStale() resolves.
//
//  The API returns rates from a base of our choice. We ask for ILS
//  as the base (returns "1 ILS = N foreign") and take the reciprocal
//  so the rest of the app speaks in the natural direction —
//  "1 foreign equals N ILS" — used to value cash held abroad.
// ─────────────────────────────────────────────────────────────────

import { saveData } from './store.js';

const FX_ENDPOINT     = 'https://open.er-api.com/v6/latest/ILS';
const FX_STORAGE_KEY  = 'fxRates_v1';
const FX_TTL_MS       = 4 * 60 * 60 * 1000;     // 4 hours

// Curated list of "wallet-worthy" currencies the picker offers. The
// API returns ~160; we surface the ones most relevant for an Israeli
// traveler holding physical cash. Order = display order in the picker.
export const CASH_CURRENCIES = [
  'ILS', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'THB', 'CHF', 'CAD', 'AUD', 'CNY',
];

// Per-currency display symbol. Falls through to "CODE " when a
// currency isn't in the map so the number always wears its country.
const _SYMBOLS = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  KRW: '₩',
  THB: '฿',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
};

// JPY/KRW (and a handful of others) have no minor unit — always render
// them as whole numbers. Other currencies use whatever precision the
// user typed, rounded to two decimals at most.
const _NO_DECIMALS = new Set(['JPY', 'KRW', 'CLP', 'VND', 'IDR']);

// ─────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────

// Returns the freshest rates we have, in "1 foreign = X ILS" form,
// without hitting the network. Order of preference: localStorage
// cache → data.rates (from the seed file) → empty object.
export function getRates(data) {
  const cached = _readCache();
  if (cached && cached.rates) return cached.rates;
  return _ratesFromData(data);
}

// Returns the timestamp (Date) of the cached fetch, or null if we've
// never fetched. UI uses this to render an "as of …" footnote.
export function getRatesFetchedAt() {
  const cached = _readCache();
  return cached && cached.fetchedAt ? new Date(cached.fetchedAt) : null;
}

// Convert `amount` from `currency` into ILS. Returns null when the
// amount is not a finite number or we don't have a rate for that
// currency. ILS amounts pass through unchanged.
export function convertToILS(amount, currency, data) {
  if (!Number.isFinite(amount)) return null;
  if (!currency || currency === 'ILS') return amount;
  const rates = getRates(data);
  const r = rates && rates[currency];
  if (!Number.isFinite(r) || r <= 0) return null;
  return amount * r;
}

// "$300", "¥45,000", "₩200,000", "CHF 80". Pure formatting — no FX.
export function formatForeignAmount(amount, currency) {
  if (!Number.isFinite(amount)) return '';
  const code = currency || 'ILS';
  const sign = amount < 0 ? '-' : '';
  const abs  = Math.abs(amount);
  const digits = _NO_DECIMALS.has(code) ? 0 : (Math.round(abs) === abs ? 0 : 2);
  const num  = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sym  = _SYMBOLS[code] || (code + ' ');
  return `${sign}${sym}${num}`;
}

// Fire-and-forget refresh. If the cached rates are still fresh,
// resolves immediately with them. Otherwise tries the network; on
// success persists to localStorage AND mirrors onto data.rates so
// downstream `getRates(data)` callers without a cache still see
// fresh values. On any failure, falls back silently to whatever
// was already there.
//
// Returns: { rates, fetchedAt, source: 'cache' | 'network' | 'fallback' }
export async function refreshRatesIfStale(data) {
  const cached = _readCache();
  if (cached && Date.now() - cached.fetchedAt < FX_TTL_MS) {
    return { ...cached, source: 'cache' };
  }
  try {
    const fresh = await _fetchLiveRates();
    _writeCache(fresh);
    if (data) {
      data.rates = { ...(data.rates || {}), ...fresh.rates };
      try { saveData(data); } catch { /* persistence is best-effort */ }
    }
    return { ...fresh, source: 'network' };
  } catch (e) {
    console.warn('FX refresh failed; using cached or static rates.', e);
    const fallback = cached || { rates: _ratesFromData(data), fetchedAt: 0 };
    return { ...fallback, source: 'fallback' };
  }
}

// ─────────────────────────────────────────
//  INTERNALS
// ─────────────────────────────────────────

async function _fetchLiveRates() {
  const resp = await fetch(FX_ENDPOINT);
  if (!resp.ok) throw new Error(`FX HTTP ${resp.status}`);
  const json = await resp.json();
  // open.er-api.com responds with { result: 'success', base_code, rates }
  // where rates[X] is "1 ILS = X units of currency X". We invert.
  if (json.result !== 'success' || !json.rates) {
    throw new Error('FX API: malformed response');
  }
  const ilsPerForeign = {};
  for (const [code, ilsToForeign] of Object.entries(json.rates)) {
    if (typeof ilsToForeign === 'number' && ilsToForeign > 0) {
      ilsPerForeign[code] = 1 / ilsToForeign;
    }
  }
  ilsPerForeign.ILS = 1;
  return { rates: ilsPerForeign, fetchedAt: Date.now() };
}

function _readCache() {
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.rates && typeof parsed.fetchedAt === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

function _writeCache(payload) {
  try {
    localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* best-effort; quota errors don't break the app */
  }
}

function _ratesFromData(data) {
  const out = { ILS: 1, ...(data && data.rates ? data.rates : {}) };
  return out;
}
