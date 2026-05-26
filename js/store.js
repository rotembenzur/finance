// ─────────────────────────────────────────────────────────────────
//  STORE
//
//  Local-first persistence with Supabase as the cloud source of truth.
//  Load priority: Supabase → localStorage → demo state from
//  data/state.example.js. Saves always write to localStorage first
//  (sync) and then fire-and-forget to Supabase — cloud failures never
//  block the UI or break offline use.
// ─────────────────────────────────────────────────────────────────

import { FINANCIAL_STATE as DEMO_STATE } from '../data/state.example.js';
import { supabase } from './supabase.js';
import { dedupeImportedBankTransactions } from './import/bank/bank-tx-identity.js';

const SUPABASE_TABLE  = 'app_state';
const SUPABASE_ROW_ID = 'primary';
const SUPABASE_COLUMN = 'data';

export const STORE_KEY = 'financeData_v17';

// Load priority: Supabase → localStorage → bootstrap. `_migratePersistedState`
// runs on every successful path so the in-memory shape is normalized
// regardless of source. Migrations are idempotent (each one checks before
// patching). Async because the Supabase fetch is — callers `await` it.
export async function loadData() {
  // 1. Cloud first — Supabase row id='primary' on table app_state.
  try {
    const { data: row, error } = await supabase
      .from(SUPABASE_TABLE)
      .select(SUPABASE_COLUMN)
      .eq('id', SUPABASE_ROW_ID)
      .maybeSingle();
    if (error) {
      console.warn('Supabase load failed — falling back to localStorage.', error);
    } else if (row && _isValidAppState(row[SUPABASE_COLUMN])) {
      const data = row[SUPABASE_COLUMN];
      _migratePersistedState(data);
      return data;
    } else if (row) {
      // Row exists but `data` is missing/empty/malformed (e.g. `{}` left
      // over from a manual reset). Don't adopt it — that would crash
      // renderers that expect entries/cards/banks to be arrays. Falling
      // through to localStorage; the next saveData() will overwrite
      // the cloud row with a real snapshot.
      console.warn(
        'Supabase row exists but `data` is not a valid app state — ' +
        'ignoring cloud state and falling back to localStorage.',
        { cloudValue: row[SUPABASE_COLUMN] }
      );
    }
  } catch (e) {
    console.warn('Supabase load threw — falling back to localStorage.', e);
  }

  // 2. localStorage — preserves all prior behavior.
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

  // 3. Bootstrap — deep copy so mutations never touch the canonical object.
  const seeded = JSON.parse(JSON.stringify(DEMO_STATE));
  _migratePersistedState(seeded);
  return seeded;
}

// Structural sanity check for cloud-loaded state. Migrations can lazily
// fill in newer optional fields, but they can't conjure a usable
// snapshot out of `{}` — renderers crash if the top-level arrays are
// missing. We require the three structural anchors and treat anything
// else as "not a real snapshot, ignore."
function _isValidAppState(data) {
  return !!data
    && typeof data === 'object'
    && Array.isArray(data.entries)
    && Array.isArray(data.cards)
    && Array.isArray(data.banks);
}

// In-place migrations for persisted snapshots that pre-date a schema
// tweak. Keep idempotent. Add new entries here when changes happen
// after v6 ship — bump STORE_KEY only when a change is incompatible
// enough that re-bootstrapping is cleaner than migrating.
// Exported so the file-import path (data-io.js) can normalize imported
// data without round-tripping through loadData() — which now hits
// Supabase first and would return the pre-import cloud state.
export function migratePersistedState(data) {
  _migratePersistedState(data);
}
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
  // Tombstones for user-deleted imported records. Because imports
  // upsert (never delete), a deleted bank transaction or card charge
  // would otherwise reappear when its statement is re-imported. The
  // import paths consult these id lists and skip resurrecting them.
  if (!Array.isArray(data.deletedBankTxIds))  data.deletedBankTxIds = [];
  // Tombstones keyed by canonical identity (date+direction+amount+
  // balance), so a deleted movement stays deleted even when re-imported
  // from a different file format that assigns it a different id.
  if (!Array.isArray(data.deletedBankTxKeys)) data.deletedBankTxKeys = [];
  if (!Array.isArray(data.deletedChargeIds))  data.deletedChargeIds = [];

  // Collapse imported bank-transaction duplicates that share a canonical
  // identity — e.g. the same movement imported once from PDF and once
  // from the Excel export, which carry different per-parser ids. Manual
  // entries are untouched; idempotent once collapsed.
  data.bankTransactions = dedupeImportedBankTransactions(data.bankTransactions);

  // Reclassify legacy direct-debit-card rows. The old classifier rule
  // wrongly tagged Hapoalim's per-charge דירקט rows as 'internal_savings'
  // with isInternal: true, which hid them from real-expense buckets.
  // They are individual direct-debit charges — reclassify in place.
  // Strict match (type AND description) so a user who manually set
  // 'internal_savings' on something unrelated is never overwritten.
  // Idempotent: a second load finds no matching rows.
  if (Array.isArray(data.bankTransactions)) {
    for (const tx of data.bankTransactions) {
      if (tx && tx.type === 'internal_savings'
          && typeof tx.description === 'string'
          && /דירקט/.test(tx.description)) {
        tx.type        = 'direct_debit_charge';
        tx.icon        = '💸';
        tx.isInternal  = false;
        tx.isRecurring = false;
      }
    }
  }
  // Cash entries gained a `charges: []` array when cash became a
  // first-class payment source. Older snapshots' cash entries don't
  // have it. Initialize lazily so existing state keeps working.
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      const isCash = e && (e.type === 'cash' || e.isCash === true);
      if (isCash && !Array.isArray(e.charges)) e.charges = [];
    }
  }

  // Backfill MR1 purchase lots. Until there's a UI to enter buy
  // history on a manually-tracked stock, we seed Bank Hapoalim's
  // MR1 holding with the historical data Rotem provided in
  // conversation. The migration is idempotent: existing `lots`
  // arrays are NEVER overwritten, so additional buys can be added
  // safely later (via UI or another migration) without losing data.
  // We also align `quantity` to the lot sum on this initial seed so
  // entryValue() (= price × quantity) matches the four shares the
  // broker reports.
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      if (e && e.ticker === 'POLI.MR1' && !Array.isArray(e.lots)) {
        e.lots = [
          { date: '2025-09-19', units: 2, pricePerUnit: 61.84 },
          { date: '2025-12-19', units: 2, pricePerUnit: 75.35 },
        ];
        const totalUnits = e.lots.reduce((s, l) => s + l.units, 0);
        if (typeof e.quantity !== 'number' || e.quantity !== totalUnits) {
          e.quantity = totalUnits;
        }
      }
    }
  }
}

export function saveData(data) {
  // [DEBUG] confirm saveData itself fires
  console.log('[saveData] called', {
    keys: data ? Object.keys(data) : null,
    approxBytes: data ? JSON.stringify(data).length : 0,
  });

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    console.log('[saveData] localStorage write OK', { key: STORE_KEY });
  } catch (e) {
    console.warn('Could not write to localStorage.', e);
  }

  // [DEBUG] log the request shape before firing
  console.log('[saveData] → Supabase update', {
    table:  SUPABASE_TABLE,
    column: SUPABASE_COLUMN,
    rowId:  SUPABASE_ROW_ID,
  });

  // Fire-and-forget cloud write. Not awaited — callers stay synchronous
  // and a slow/offline network can never block the UI. localStorage is
  // already the authoritative offline copy if this fails.
  //
  // Chained .select() so the response includes the updated rows — an
  // empty array means the eq() filter matched nothing (wrong id OR an
  // RLS policy is filtering the row out of the write set silently).
  supabase
    .from(SUPABASE_TABLE)
    .update({ [SUPABASE_COLUMN]: data })
    .eq('id', SUPABASE_ROW_ID)
    .select()
    .then(({ data: rows, error, status, statusText, count }) => {
      if (error) {
        console.warn('[saveData] ← Supabase update FAILED', {
          message: error.message,
          details: error.details,
          hint:    error.hint,
          code:    error.code,
          status,
          statusText,
        });
        return;
      }
      const affected = Array.isArray(rows) ? rows.length : 0;
      console.log('[saveData] ← Supabase update OK', {
        affectedRowCount: affected,
        rows,
        status,
        statusText,
        count,
      });
      if (affected === 0) {
        console.warn(
          '[saveData] Supabase reported success but updated 0 rows. ' +
          'Either no row matches id=\'' + SUPABASE_ROW_ID + '\' or an RLS ' +
          'policy is blocking writes for the anon key.'
        );
      }
    }, (e) => {
      console.warn('[saveData] ← Supabase update THREW', e);
    });
}

// Drops persisted state so the next load re-bootstraps from initial state.
// Also clears the Supabase row's data column — without this, the next
// loadData() would just re-pull the pre-reset cloud snapshot and the
// reload-from-file flow would have no visible effect. Returns the
// Supabase promise so callers can await it before reloading the page.
export function resetToInitialState() {
  localStorage.removeItem(STORE_KEY);
  return supabase
    .from(SUPABASE_TABLE)
    .update({ [SUPABASE_COLUMN]: null })
    .eq('id', SUPABASE_ROW_ID)
    .then(({ error }) => {
      if (error) console.warn('Supabase reset failed — cloud row unchanged.', error);
    }, (e) => {
      console.warn('Supabase reset threw — cloud row unchanged.', e);
    });
}

export function generateId(prefix = 'entry') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayISO() {
  return new Date().toISOString().split('T')[0];
}
