// ─────────────────────────────────────────────────────────────────
//  STORE
//
//  localStorage persistence + initial-state resolution. On first run
//  (or after reset), bootstrap from data/state.example.js. If the
//  developer has dropped a data/state.local.js file in place, the
//  dynamic import below succeeds and its FINANCIAL_STATE replaces
//  the demo as the bootstrap source. Either way, subsequent loads
//  return the persisted localStorage copy.
// ─────────────────────────────────────────────────────────────────

import { FINANCIAL_STATE as DEMO_STATE } from '../data/state.example.js';

// Resolve initial state — try the gitignored local file, fall back to demo.
// Top-level await pauses module evaluation until the dynamic import settles,
// which is fine for a single-shot startup decision. The "Reload from data
// file" action in data-io.js uses window.location.reload() to re-run this
// import against the current file on disk; the in-memory module cache
// makes any other approach unreliable.
let _initialState = DEMO_STATE;
try {
  const local = await import('../data/state.local.js');
  if (local && local.FINANCIAL_STATE) _initialState = local.FINANCIAL_STATE;
} catch {
  // No local file → demo state is the bootstrap source.
}

export const STORE_KEY = 'financeData_v17';

// On first run (or after reset), bootstrap from initial state.
// Subsequent loads return the persisted localStorage copy.
// `_migratePersistedState` runs on BOTH paths — localStorage and
// fresh-from-file — so the shape is normalized regardless of source.
// Migrations are idempotent (each one checks before patching).
export function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      _migratePersistedState(data);
      return data;
    }
  } catch (e) {
    console.warn('Could not read persisted state — bootstrapping from initial state.');
  }
  // Deep copy so mutations never touch the canonical FINANCIAL_STATE object
  const seeded = JSON.parse(JSON.stringify(_initialState));
  _migratePersistedState(seeded);
  return seeded;
}

// In-place migrations for persisted snapshots that pre-date a schema
// tweak. Keep idempotent. Add new entries here when changes happen
// after v6 ship — bump STORE_KEY only when a change is incompatible
// enough that re-bootstrapping is cleaner than migrating.
function _migratePersistedState(data) {
  // Cards gained a `charges: []` array — older snapshots don't have it.
  // Initialize lazily so existing localStorage state from before the
  // monthly-charges feature still loads cleanly.
  if (Array.isArray(data.cards)) {
    for (const card of data.cards) {
      if (!Array.isArray(card.charges)) card.charges = [];
    }
  }
  // Salary slot — added later; nullable so users who haven't set one
  // up keep working without re-bootstrapping.
  if (!('salary' in data)) data.salary = null;

  // Bank-transactions layer — separate from cards/cash/investments.
  // bankAccounts[] holds the bank+branch+account identity returned by
  // the PDF parser; bankTransactions[] is a flat append-only stream
  // keyed by stable fingerprint id so re-imports collapse to the
  // same row. Both default to empty arrays for older snapshots.
  if (!Array.isArray(data.bankAccounts))     data.bankAccounts = [];
  if (!Array.isArray(data.bankTransactions)) data.bankTransactions = [];
  // Cash entries gained a `charges: []` array when cash became a
  // first-class payment source. Older snapshots' cash entries don't
  // have it. Initialize lazily so existing state keeps working.
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      const isCash = e && (e.type === 'cash' || e.isCash === true);
      if (isCash && !Array.isArray(e.charges)) e.charges = [];
    }
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Could not write to localStorage.');
  }
}

// Drops persisted state so the next load re-bootstraps from initial state.
export function resetToInitialState() {
  localStorage.removeItem(STORE_KEY);
}

export function generateId(prefix = 'entry') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayISO() {
  return new Date().toISOString().split('T')[0];
}
