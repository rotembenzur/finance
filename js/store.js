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
import { DISPLAY_STATE } from '../data/display-state.js';
import { supabase } from './supabase.js';
import { dedupeImportedBankTransactions } from './import/bank/bank-tx-identity.js';
import { BANK_TX_TYPES } from './import/bank/classifier.js';
import { INCOME_CATEGORIES } from './data/income-categories.js';
import { seedConfig } from './config/registry.js';
import { seedSettings } from './config/settings.js';
import { seedBrokerageTerms } from './data/brokerage-terms.js';
import { isDemoMode } from './demo-mode.js';
import { t } from './i18n.js';
import { showToast } from './components/toast.js';

const SUPABASE_TABLE  = 'app_state';
const SUPABASE_ROW_ID = 'primary';
const SUPABASE_COLUMN = 'data';

export const STORE_KEY = 'financeData_v17';

// Optimistic-concurrency guard against the stale-tab overwrite class of
// bug: saveData() used to blindly overwrite the entire cloud row with
// whatever this tab held in memory, no matter how stale. A tab left open
// from before another tab/device saved newer data would silently wipe
// that newer data on its next save (e.g. a fresh import), with nothing
// in the UI hinting it happened.
//
// `_syncVersion` is the raw `meta.savedAt` value THIS tab actually saw
// at load time (cloud or localStorage) — never migration-backfilled, so
// it faithfully reflects what the cloud row held, including `null` for
// legacy rows that predate this field. Every save both bumps
// `meta.savedAt` to a fresh value and makes the cloud write conditional
// on the row still holding the version this tab expects (a single
// atomic UPDATE ... WHERE, not a separate check-then-write). If another
// writer moved it first, zero rows match and the write is refused
// instead of silently clobbering.
let _syncVersion; // undefined until this tab's first loadData() resolves

// Entry types whose long-term value we snapshot on every amount edit
// so the user can see how the product has grown over time. Other
// entries (cash, wallets, bank accounts, cards) change too often or
// for the wrong reasons to make a "growth over time" view meaningful.
export const _HISTORY_TRACKED_TYPES = new Set([
  'pension', 'study_fund', 'provident_fund', 'investment_gemel',
]);
export function hasValueHistoryTracking(entry) {
  return !!entry && _HISTORY_TRACKED_TYPES.has(entry.type);
}

// Load priority: Supabase → localStorage → bootstrap. `_migratePersistedState`
// runs on every successful path so the in-memory shape is normalized
// regardless of source. Migrations are idempotent (each one checks before
// patching). Async because the Supabase fetch is — callers `await` it.
export async function loadData() {
  // PUBLIC DISPLAY MODE — `?v_display`. Short-circuit BEFORE any
  // Supabase call or localStorage read. Real data lives in those two
  // stores; this branch makes it physically impossible for the demo
  // path to touch either. Deep clone so demo edits stay in-memory and
  // never mutate the imported module constant.
  if (isDemoMode()) {
    const cloned = JSON.parse(JSON.stringify(DISPLAY_STATE));
    _migratePersistedState(cloned);
    return cloned;
  }

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
      _syncVersion = data?.meta?.savedAt ?? null;
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
      // We didn't get a trustworthy read of the cloud's current version
      // above (network error, or a malformed row), so we don't actually
      // know what's there. Treat that the same as "expect null": if the
      // cloud turns out to hold real data when we eventually save, the
      // conditional write below won't match and the save is refused
      // rather than silently clobbering it. Blocking an occasional save
      // after a network hiccup (fixed by reloading) is a far smaller
      // cost than the alternative — the exact stale-tab-overwrite bug
      // this guard exists to close.
      _syncVersion = null;
      _migratePersistedState(data);
      return data;
    }
  } catch (e) {
    console.warn('Could not read persisted state — bootstrapping from initial state.');
  }

  // 3. Bootstrap — deep copy so mutations never touch the canonical object.
  _syncVersion = null;
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

  // Repair card charges that share an id. The CAL/MAX/Isracard-pending
  // parsers built ids from (date, merchant, amount) when the statement
  // has no voucher number, so two identical same-day purchases (e.g.
  // two equal parking charges) fingerprinted to the same id and landed
  // in storage as two array entries with one id. Array.find/findIndex
  // then always resolved to the first one, so the second appeared
  // "stuck" — clicking it opened/edited the first instead. The parsers
  // now disambiguate on import; this repairs charges imported before
  // that fix. Keeps the first occurrence's id, suffixes the rest.
  // Idempotent — a second pass finds no collisions left.
  if (Array.isArray(data.cards)) {
    for (const card of data.cards) {
      if (!Array.isArray(card.charges)) continue;
      const seen = new Map();
      for (const charge of card.charges) {
        if (!charge || !charge.id) continue;
        const count = (seen.get(charge.id) || 0) + 1;
        seen.set(charge.id, count);
        if (count > 1) charge.id = `${charge.id}-dup${count}`;
      }
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

  // Vouchers / gift cards / store credits — restricted store-credit
  // assets. Their remaining value counts toward net worth as a
  // separate bucket; the list lives on a dedicated page. Lazy-add
  // so older snapshots still load. See [[vouchers-feature]].
  if (!Array.isArray(data.giftCards))         data.giftCards = [];

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

  // Income-category un-conflation. The old manual quick-income flow
  // wrote the chosen income-category id straight into the classifier
  // `type` field. For categories that aren't valid bank-transaction
  // types (gift, transfer, cashback, investment, other_income) that
  // left rows the timeline couldn't label and the editor couldn't
  // represent. Move any such value into the dedicated incomeCategoryId
  // field (the user's real classification) and reset `type` to a valid
  // technical type. NON-DESTRUCTIVE: the category value is preserved,
  // never dropped. Idempotent: once `type` is a real BANK_TX_TYPE the
  // row is skipped, so re-running (or re-loading) is a no-op. Only rows
  // whose `type` is an income-category id are touched — imported rows
  // (type already a BANK_TX_TYPE) are never altered.
  if (Array.isArray(data.bankTransactions)) {
    const _validTypes = new Set(BANK_TX_TYPES);
    const _incomeIds  = new Set(INCOME_CATEGORIES.map(c => c.id));
    for (const tx of data.bankTransactions) {
      if (!tx) continue;
      if (!_validTypes.has(tx.type) && _incomeIds.has(tx.type)) {
        if (!tx.incomeCategoryId) tx.incomeCategoryId = tx.type;
        tx.type = 'incoming_transfer';
      }
    }
  }

  // Cash + wallet entries hold their own `charges: []` array. Older
  // snapshots may pre-date that field for either type, so initialize
  // it lazily so the quick-entry / history flows always find an array.
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      if (!e) continue;
      const isCashLike =
        e.type === 'cash'           || e.isCash   === true ||
        e.type === 'digital_wallet' || e.isWallet === true;
      if (isCashLike && !Array.isArray(e.charges)) e.charges = [];
    }
  }

  // Seed digital-wallet entries (Bit, Paybox) on snapshots that pre-date
  // them. Idempotent — keyed on stable ids so re-loads don't duplicate.
  // Balances start at 0; the user edits inline from the Accounts page.
  if (Array.isArray(data.entries)) {
    const walletSeeds = [
      { id: 'wallet-bit',    name: 'Bit',    logo: 'assets/logos/bit_logo.png' },
      { id: 'wallet-paybox', name: 'Paybox', logo: 'assets/logos/paybox_logo.jpg' },
    ];
    for (const w of walletSeeds) {
      if (!data.entries.some(e => e && e.id === w.id)) {
        data.entries.push({
          id:           w.id,
          name:         w.name,
          nameEn:       w.name,
          institution:  null,
          bankId:       null,
          type:         'digital_wallet',
          category:     'liquid',
          tier:         'available',
          balance:       0,
          currentValue: null,
          currency:     'ILS',
          isWallet:     true,
          isActive:     true,
          isLiability:  false,
          logo:         w.logo,
          updatedAt:    new Date().toISOString().split('T')[0],
        });
      }
    }
  }

  // Bank registry — the banks offered in the account / card editors and
  // listed on the Admin screen. Seeds every bank that ships a logo asset
  // in js/config/logo-library.js, so a fresh account can pick its bank
  // instead of typing it. Only name + logo are seeded; branch and
  // location stay empty for the user to fill in.
  // Idempotent: keyed by id; an existing bank is never overwritten, so a
  // bank the user already set up keeps its branch, location and primary
  // flag. `hapoalim` / `international` reuse the ids the demo state and
  // the live data already use, so seeding can't duplicate them.
  if (!Array.isArray(data.banks)) data.banks = [];
  const _bankSeeds = [
    { id: 'hapoalim',      name: 'בנק הפועלים',    nameEn: 'Bank Hapoalim',        logo: 'assets/logos/hapoalim.jpg' },
    { id: 'leumi',         name: 'בנק לאומי',      nameEn: 'Bank Leumi',           logo: 'assets/logos/leumi_logo.svg' },
    { id: 'pepper',        name: 'פפר',            nameEn: 'Pepper',               logo: 'assets/logos/pepper_logo.png' },
    { id: 'mizrahi',       name: 'מזרחי טפחות',    nameEn: 'Mizrahi Tefahot',      logo: 'assets/logos/mizrahi_tefahot_logo.png' },
    { id: 'discount',      name: 'בנק דיסקונט',    nameEn: 'Discount',             logo: 'assets/logos/discount_bank_logo.jpg' },
    { id: 'international', name: 'הבנק הבינלאומי', nameEn: 'The International Bank', logo: 'assets/logos/habenleumi.jpg' },
    { id: 'jerusalem',     name: 'בנק ירושלים',    nameEn: 'Bank of Jerusalem',    logo: 'assets/logos/jerusalem_logo.png' },
    { id: 'onezero',       name: 'וואן זירו',      nameEn: 'One Zero',             logo: 'assets/logos/onezero_logo.png' },
  ];
  for (const b of _bankSeeds) {
    if (!data.banks.some(x => x && x.id === b.id)) data.banks.push({ ...b, isPrimary: false });
  }
  // Exactly one bank carries the primary flag (default + badge). Only
  // claim it when nothing does — never demote a bank the user picked.
  if (!data.banks.some(b => b && b.isPrimary)) {
    const fallback = data.banks.find(b => b && b.id === 'hapoalim') || data.banks[0];
    if (fallback) fallback.isPrimary = true;
  }

  // Provider registry — the single source of truth for a Future
  // Wealth product's company name + logo. Seed the financial fund
  // managers / banks that ship a logo asset but predate the registry,
  // and tag non-financial special entities (family fund, IDF discharge
  // deposit) with kind:'special' so the product editor excludes them.
  // Idempotent: keyed by id; existing providers are never overwritten,
  // only their missing `kind` is backfilled.
  if (!Array.isArray(data.providers)) data.providers = [];
  const _providerSeeds = [
    { id: 'harel',      name: 'הראל',         nameEn: 'Harel',           logo: 'assets/logos/harel_logo.png' },
    { id: 'menora',     name: 'מנורה מבטחים',  nameEn: 'Menora Mivtachim', logo: 'assets/logos/menora_logo.png' },
    { id: 'altshuler',  name: 'אלטשולר שחם',   nameEn: 'Altshuler Shaham', logo: 'assets/logos/altshuler_logo.png' },
    { id: 'ibi',        name: 'IBI',           nameEn: 'IBI',             logo: 'assets/logos/ibi_logo.svg.png' },
    { id: 'migdal',     name: 'מגדל',          nameEn: 'Migdal',          logo: 'assets/logos/migdal_logo.png' },
    { id: 'phoenix',    name: 'הפניקס',        nameEn: 'Phoenix',         logo: 'assets/logos/fnx_logo.png' },
    { id: 'meitav',     name: 'מיטב',          nameEn: 'Meitav',          logo: 'assets/logos/meitav_logo.jpeg' },
    { id: 'mizrahi',    name: 'מזרחי טפחות',   nameEn: 'Mizrahi Tefahot', logo: 'assets/logos/mizrahi_tefahot_logo.png' },
    { id: 'yl-lapidot', name: 'ילין לפידות',   nameEn: 'Yelin Lapidot',   logo: 'assets/logos/yl_lapidot_logo.png' },
    { id: 'discount',   name: 'דיסקונט',       nameEn: 'Discount',        logo: 'assets/logos/discount_bank_logo.jpg' },
    { id: 'hapoalim-p', name: 'בנק הפועלים',   nameEn: 'Bank Hapoalim',   logo: 'assets/logos/hapoalim.jpg' },
    { id: 'beinleumi',  name: 'הבינלאומי',     nameEn: 'Beinleumi',       logo: 'assets/logos/habenleumi.jpg' },
    { id: 'ayalon',     name: 'איילון',        nameEn: 'Ayalon',          logo: 'assets/logos/ayalon_logo.png' },
    { id: 'mor',        name: 'מור',           nameEn: 'Mor',             logo: 'assets/logos/mor_logo.webp' },
    { id: 'clal',       name: 'כלל',           nameEn: 'Clal',            logo: 'assets/logos/clal_logo.png' },
    { id: 'psagot',     name: 'פסגות',         nameEn: 'Psagot',          logo: 'assets/logos/psagot_logo.png' },
  ];
  for (const p of _providerSeeds) {
    const existing = data.providers.find(x => x && x.id === p.id);
    if (!existing) data.providers.push({ ...p, kind: 'financial' });
    else if (existing.kind == null) existing.kind = 'financial';
  }
  for (const specialId of ['family', 'idf']) {
    const ex = data.providers.find(x => x && x.id === specialId);
    if (ex && ex.kind == null) ex.kind = 'special';
  }

  // Config registry — user-editable category / selection lists. Seeded
  // from the hardcoded constants (idempotent; merges in any new seed
  // items missing from a persisted copy). The Admin screen edits these;
  // consumers read them through js/config/registry.js. See
  // [[project_admin_config]].
  seedConfig(data);

  // Settings / Profile — personal assumptions (DOB, retirement age) +
  // preferences (default language/currency) that used to be hardcoded.
  // Idempotent; seeds the prior code defaults so behaviour is preserved.
  seedSettings(data);

  // Brokerage terms — what each trading venue charges to hold and move
  // positions, with the date those terms were last confirmed. Seeded
  // once and then owned by the user (the seeder never overwrites an
  // existing record). Lives on `data` so it persists and so the
  // assistant's read-only SQL tool can query it. See
  // js/data/brokerage-terms.js.
  // includeDefaults is off in demo mode: the seed records carry real
  // negotiated rates and a real account number, and `?v_display` is a
  // shareable public URL.
  seedBrokerageTerms(data, { includeDefaults: !isDemoMode() });

  // Seed `valueHistory: [{date, value}]` on long-term investment
  // products (pension, study fund, provident fund, investment gemel).
  // Each time the user edits the amount we append a snapshot — but the
  // first snapshot has to come from somewhere, so on first load we
  // seed it from the existing `updatedAt` + `currentValue` (the only
  // historical point we have). Without this seed the chart would stay
  // empty until the *second* edit. Idempotent: skipped when the array
  // already exists.
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      if (!e) continue;
      if (!_HISTORY_TRACKED_TYPES.has(e.type)) continue;
      if (Array.isArray(e.valueHistory)) continue;
      const seedValue = (typeof e.currentValue === 'number') ? e.currentValue
                      : (typeof e.balance      === 'number') ? e.balance
                      : null;
      if (seedValue == null) { e.valueHistory = []; continue; }
      const seedDate = e.updatedAt || new Date().toISOString().split('T')[0];
      e.valueHistory = [{ date: seedDate, value: seedValue }];
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
  //
  // Skipped in demo mode. These are real dated buy prices, and
  // `?v_display` is a shareable public URL — the same reason the
  // brokerage-terms seed is gated. The rule is positional (any entry
  // whose ticker is POLI.MR1), so without this guard a demo dataset
  // that merely uses that ticker to exercise the live-quote layout
  // would silently inherit the real purchase history, and have its
  // own quantity overwritten to match.
  if (Array.isArray(data.entries) && !isDemoMode()) {
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
  // PUBLIC DISPLAY MODE — silent no-op. Demo edits live only in the
  // in-memory app state for the current tab session; refreshing the
  // page reverts to the bundled DISPLAY_STATE. No localStorage write,
  // no Supabase write, no auth token in scope.
  if (isDemoMode()) return;

  // Version this save. Every save moves `meta.savedAt` forward, and the
  // cloud write below is made conditional on the row still holding the
  // version this tab last saw (see `_syncVersion` above) — the guard
  // that stops a stale tab from silently overwriting newer cloud data.
  const expected = _syncVersion;
  const stamp    = new Date().toISOString();
  if (!data.meta) data.meta = {};
  data.meta.savedAt = stamp;

  // Bump the expected baseline NOW, synchronously — not in the response
  // callback below. saveData() is fire-and-forget, so two edits made in
  // quick succession (before the first request round-trips) must not
  // treat each other as a foreign conflict: the second call needs to see
  // `stamp` from the first as its `expected`, not the value both loaded
  // with. Worst case if this particular write ends up failing/blocked is
  // a future save in this tab also blocks until reload — annoying, but
  // never a silent overwrite, which is the only outcome this guards
  // against.
  _syncVersion = stamp;

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Could not write to localStorage.', e);
  }

  // Fire-and-forget cloud write. Not awaited — callers stay synchronous
  // and a slow/offline network can never block the UI. localStorage is
  // already the authoritative offline copy if this fails.
  //
  // The extra JSON-path filter makes this a single atomic
  // "UPDATE ... WHERE id = 'primary' AND data->meta->>savedAt = <expected>"
  // — not a separate check-then-write, so there's no race window between
  // the two. `expected == null` (covers both a genuinely-legacy/fresh row
  // and "we never got a trustworthy read of the cloud version") uses
  // `.is()` instead of `.eq()`, since Postgres needs `IS NULL`, not `= NULL`.
  //
  // Chained .select() so the response includes the updated rows — zero
  // rows means either the id/RLS filter matched nothing (pre-existing
  // failure mode) OR the version condition didn't match, i.e. another
  // tab/device saved since this one last loaded.
  let query = supabase
    .from(SUPABASE_TABLE)
    .update({ [SUPABASE_COLUMN]: data })
    .eq('id', SUPABASE_ROW_ID);
  query = (expected == null)
    ? query.is(`${SUPABASE_COLUMN}->meta->>savedAt`, null)
    : query.eq(`${SUPABASE_COLUMN}->meta->>savedAt`, expected);

  query
    .select()
    .then(({ data: rows, error, status, statusText }) => {
      if (error) {
        console.warn('[saveData] Supabase update failed', {
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
      if (affected === 0) {
        console.warn(
          '[saveData] Write blocked — either no row matches id=\'' + SUPABASE_ROW_ID +
          '\', an RLS policy is filtering it out, or (most likely) another tab/device ' +
          'saved data since this tab last loaded (expected version: ' + String(expected) + ').'
        );
        showToast({
          tone:    'error',
          message: t('store.staleWriteBlocked'),
          details: t('store.staleWriteBlockedDetails'),
        });
      }
    }, (e) => {
      console.warn('[saveData] Supabase update threw', e);
    });
}

// Drops persisted state so the next load re-bootstraps from initial state.
// Also clears the Supabase row's data column — without this, the next
// loadData() would just re-pull the pre-reset cloud snapshot and the
// reload-from-file flow would have no visible effect. Returns the
// Supabase promise so callers can await it before reloading the page.
export function resetToInitialState() {
  // PUBLIC DISPLAY MODE — silent no-op. The "reset" entry point isn't
  // rendered in demo mode anyway (mutation UI is hidden), but guard
  // here defensively in case any code path reaches it.
  if (isDemoMode()) return Promise.resolve();

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
