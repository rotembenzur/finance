// ─────────────────────────────────────────────────────────────────
//  CONFIG REGISTRY — user-editable category / selection lists
//
//  Single runtime source of truth for the app's configurable lists.
//  Each list is either:
//    · stored in `data.config.lists[<key>]` (categories), or
//    · backed by an existing top-level array (providers → data.providers[])
//
//  Lists are SEEDED from the hardcoded constants (js/data/*.js) on first
//  load (idempotent, in store.js _migratePersistedState via seedConfig).
//  The constants stay in code as the seed + fallback, so a fresh clone,
//  demo mode, or a wiped registry still renders. `getList()` merges
//  persisted-over-seed by id and appends seeds the persisted copy lacks,
//  so future code-added defaults still surface without clobbering edits.
//
//  The live resolver shims (getCategoryById, categoryDisplay, …) used to
//  live in js/data/expense-categories.js / income-categories.js as static
//  maps built at import time. They moved here so admin edits take effect
//  immediately. The data files keep only the seed consts + id-only bridge
//  helpers (no labels), so there's no circular import.
//
//  Normalized Item shape:
//    { id, he, en, emoji, color, order, active, parentId, description,
//      + opaque extras (logo, kind, flags) preserved on round-trip }
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { currentLang } from '../i18n.js';
import { EXPENSE_CATEGORIES } from '../data/expense-categories.js';
import { INCOME_CATEGORIES, CASH_INCOME_CATEGORY_IDS } from '../data/income-categories.js';

export const CONFIG_VERSION = 1;

// ── Seed builders (also used by store.js seeding migration) ──────

function _seedExpenseCategories() {
  const items = [];
  EXPENSE_CATEGORIES.forEach((c, i) => {
    items.push({
      id: c.id, he: c.name.he, en: c.name.en, emoji: c.emoji || null,
      color: null, order: (i + 1) * 10, active: true, parentId: null, description: null,
    });
    (c.subcategories || []).forEach((s, j) => {
      items.push({
        id: s.id, he: s.name.he, en: s.name.en, emoji: null,
        color: null, order: (j + 1) * 10, active: true, parentId: c.id, description: null,
      });
    });
  });
  return items;
}

function _seedIncomeCategories() {
  return INCOME_CATEGORIES.map((c, i) => ({
    id: c.id, he: c.name.he, en: c.name.en, emoji: c.emoji || null,
    color: null, order: (i + 1) * 10, active: true, parentId: null, description: null,
  }));
}

// ── List policy table ────────────────────────────────────────────
// editable: 'full' (add/rename/delete/reorder) | 'presentation' (label/
//   icon/order/active only) | 'locked' (read-only inventory).
// store:    'config' (data.config.lists[key]) | 'providers' (data.providers[]).
// referencedBy: the stored-record fields that point at this list's ids —
//   used by delete-with-reassign.

export const LIST_POLICIES = {
  expenseCategories: {
    group: 'spending', store: 'config', editable: 'full',
    hierarchical: true, hasEmoji: true, hasColor: false, hasLogo: false,
    seed: _seedExpenseCategories, referencedBy: ['categoryId', 'subcategoryId'],
  },
  incomeCategories: {
    group: 'spending', store: 'config', editable: 'full',
    hierarchical: false, hasEmoji: true, hasColor: false, hasLogo: false,
    seed: _seedIncomeCategories, referencedBy: ['incomeCategoryId'],
  },
  providers: {
    group: 'investments', store: 'providers', editable: 'full',
    hierarchical: false, hasEmoji: false, hasColor: false, hasLogo: true,
    seed: null, referencedBy: ['providerId'],
  },
};

export function listKeys() { return Object.keys(LIST_POLICIES); }
export function listPolicy(key) { return LIST_POLICIES[key] || null; }

// ── Store seeding (idempotent) ───────────────────────────────────
// Called from store.js _migratePersistedState. Seeds config-stored lists
// and merges in any seed items missing from the persisted copy (so a
// later code release that adds a default category still appears).

export function seedConfig(data) {
  if (!data || typeof data !== 'object') return;
  if (!data.config || typeof data.config !== 'object') data.config = { v: CONFIG_VERSION, lists: {} };
  if (!data.config.lists || typeof data.config.lists !== 'object') data.config.lists = {};

  for (const [key, cfg] of Object.entries(LIST_POLICIES)) {
    if (cfg.store !== 'config' || !cfg.seed) continue;
    const seeded = cfg.seed();
    const existing = data.config.lists[key];
    if (!Array.isArray(existing)) {
      data.config.lists[key] = seeded;
    } else {
      // Merge: append seed items the persisted copy doesn't have (by id).
      const have = new Set(existing.map(x => x && x.id));
      for (const s of seeded) if (!have.has(s.id)) existing.push(s);
    }
  }
}

// ── Provider ⇄ Item mapping (providers are stored in data.providers[]) ─

function _providerToItem(p) {
  return {
    id: p.id,
    he: p.name || p.nameEn || p.id,
    en: p.nameEn || p.name || p.id,
    emoji: null, color: null,
    order: typeof p.order === 'number' ? p.order : 0,
    active: p.active !== false,
    parentId: null,
    description: p.description || null,
    logo: p.logo || null,
    kind: p.kind || 'financial',
  };
}

function _itemToProvider(item, prev) {
  return {
    ...(prev || {}),
    id: item.id,
    name: item.he || item.en || item.id,
    nameEn: item.en || item.he || item.id,
    logo: item.logo != null ? item.logo : (prev ? prev.logo : null),
    kind: item.kind || (prev && prev.kind) || 'financial',
    order: typeof item.order === 'number' ? item.order : (prev && prev.order) || 0,
    active: item.active !== false,
    description: item.description || null,
  };
}

// ── Core read API ─────────────────────────────────────────────────

// Raw list AS STORED (includes inactive, original order). Falls back to
// the seed when nothing is persisted yet (demo state, pre-migration).
export function getRawList(key) {
  const cfg = LIST_POLICIES[key];
  if (!cfg) return [];
  const data = getAppData();
  if (!data) return cfg.seed ? cfg.seed() : [];

  if (cfg.store === 'providers') {
    return (data.providers || []).map(_providerToItem);
  }
  const lists = (data.config && data.config.lists) || {};
  if (Array.isArray(lists[key])) return lists[key];
  return cfg.seed ? cfg.seed() : [];
}

// Resolved list: active only, sorted by order. This is what consumers
// (pickers, dropdowns) should render.
export function getList(key) {
  return getRawList(key)
    .filter(it => it && it.active !== false)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getItem(key, id) {
  if (!id) return null;
  return getRawList(key).find(it => it && it.id === id) || null;
}

// Language-aware label for an Item.
export function label(item, lang = currentLang) {
  if (!item) return '';
  return (lang === 'he' ? item.he : item.en) || item.en || item.he || item.id || '';
}

// ── Category-specific live shims (replace the old static helpers) ──

// Nested {id, emoji, name:{en,he}, subcategories:[…]} shape that the
// quick-expense grid + charge editors iterate. Built from the live flat
// registry (active + ordered), so admin edits show immediately.
export function getExpenseCategoriesNested() {
  const all = getList('expenseCategories');
  const parents = all.filter(it => !it.parentId);
  return parents.map(p => ({
    id: p.id,
    emoji: p.emoji || '',
    name: { en: p.en, he: p.he },
    subcategories: all
      .filter(it => it.parentId === p.id)
      .map(s => ({ id: s.id, name: { en: s.en, he: s.he } })),
  }));
}

export function getCategoryById(id) {
  const it = id ? getItem('expenseCategories', id) : null;
  if (!it || it.parentId) return null;            // parents only
  return { id: it.id, emoji: it.emoji || '', name: { en: it.en, he: it.he } };
}

export function getSubcategoryById(id) {
  const it = id ? getItem('expenseCategories', id) : null;
  if (!it || !it.parentId) return null;           // subcategories only
  return { id: it.id, name: { en: it.en, he: it.he } };
}

export function resolveCharge(categoryId, subcategoryId) {
  const subItem = subcategoryId ? getItem('expenseCategories', subcategoryId) : null;
  if (subItem && subItem.parentId) {
    const parent = getCategoryById(subItem.parentId);
    if (parent) return { category: parent, subcategory: { id: subItem.id, name: { en: subItem.en, he: subItem.he } } };
  }
  const cat = getCategoryById(categoryId);
  return cat ? { category: cat, subcategory: null } : null;
}

export function categoryDisplay(categoryId, lang) {
  const cat = getCategoryById(categoryId);
  if (!cat) return null;
  return { emoji: cat.emoji, name: cat.name[lang] || cat.name.en };
}

export function subcategoryDisplay(subcategoryId, lang) {
  const sub = getSubcategoryById(subcategoryId);
  if (!sub) return null;
  return { name: sub.name[lang] || sub.name.en };
}

// ── Income-category live shims ────────────────────────────────────

// Nested-free list in the {id, emoji, name:{en,he}} shape the income
// pickers expect (parallel to the old INCOME_CATEGORIES const).
export function getIncomeCategoriesList() {
  return getList('incomeCategories').map(it => ({
    id: it.id, emoji: it.emoji || '', name: { en: it.en, he: it.he },
  }));
}

// Cash wallets receive only a narrow slice of income (gift / refund /
// transfer / other) — see CASH_INCOME_CATEGORY_IDS. Live-filtered so an
// admin rename/reorder of those categories still flows through.
export function getCashIncomeCategories() {
  return getIncomeCategoriesList().filter(c => CASH_INCOME_CATEGORY_IDS.includes(c.id));
}

export function getIncomeCategoryById(id) {
  const it = id ? getItem('incomeCategories', id) : null;
  if (!it) return null;
  return { id: it.id, emoji: it.emoji || '', name: { en: it.en, he: it.he } };
}

export function incomeCategoryDisplay(id, lang) {
  const cat = getIncomeCategoryById(id);
  if (!cat) return null;
  return { emoji: cat.emoji, name: cat.name[lang] || cat.name.en };
}

// ── Mutators (admin) ──────────────────────────────────────────────
// Each mutates state + persists. The caller (admin editor) is responsible
// for re-rendering via init() — keeps the registry independent of app.js.

export function newItemId(key, prefix) {
  // Stable, readable id for a new item; unique within the list.
  const base = (prefix || key).replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 24) || 'item';
  const existing = new Set(getRawList(key).map(it => it && it.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function upsertItem(key, item) {
  const cfg = LIST_POLICIES[key];
  if (!cfg) return false;
  const data = getAppData();
  if (!data) return false;

  if (cfg.store === 'providers') {
    if (!Array.isArray(data.providers)) data.providers = [];
    const idx = data.providers.findIndex(p => p && p.id === item.id);
    const prev = idx === -1 ? null : data.providers[idx];
    const next = _itemToProvider(item, prev);
    if (idx === -1) data.providers.push(next); else data.providers[idx] = next;
  } else {
    if (!data.config || !data.config.lists) seedConfig(data);
    if (!Array.isArray(data.config.lists[key])) data.config.lists[key] = cfg.seed ? cfg.seed() : [];
    const arr = data.config.lists[key];
    const idx = arr.findIndex(x => x && x.id === item.id);
    if (idx === -1) arr.push(item); else arr[idx] = { ...arr[idx], ...item };
  }
  _touch(data);
  saveData(data);
  return true;
}

export function setActive(key, id, active) {
  const it = getItem(key, id);
  if (!it) return false;
  return upsertItem(key, { ...it, active: !!active });
}

// Reorder: `orderedIds` is the desired full order; assigns order = i*10.
// For hierarchical lists, pass the ids within a single parent scope.
export function reorder(key, orderedIds) {
  const cfg = LIST_POLICIES[key];
  if (!cfg) return false;
  const data = getAppData();
  if (!data) return false;
  orderedIds.forEach((id, i) => {
    const it = getItem(key, id);
    if (it) upsertItem(key, { ...it, order: (i + 1) * 10 });
  });
  _touch(data);
  saveData(data);
  return true;
}

// Delete an item. For full-editable lists, references in stored records
// are reassigned to `reassignTo` (or cleared to null). Deleting a parent
// category cascades to its subcategories. Returns false for non-editable
// lists.
export function removeItem(key, id, { reassignTo = null } = {}) {
  const cfg = LIST_POLICIES[key];
  if (!cfg || cfg.editable !== 'full') return false;
  const data = getAppData();
  if (!data) return false;

  // Collect ids to remove (parent + its children for hierarchical lists).
  const idsToRemove = [id];
  if (cfg.hierarchical) {
    for (const it of getRawList(key)) {
      if (it && it.parentId === id) idsToRemove.push(it.id);
    }
  }

  // Reassign / clear references in stored records.
  if (key === 'expenseCategories') {
    _reassignField(data, 'categoryId', idsToRemove, reassignTo);
    // Any removed subcategory clears subcategoryId (no sub-reassign target).
    _reassignField(data, 'subcategoryId', idsToRemove, null);
  } else if (key === 'incomeCategories') {
    _reassignField(data, 'incomeCategoryId', idsToRemove, reassignTo);
  }
  // providers: providerId on entries; clear it (logo/name fall back to type).
  else if (key === 'providers') {
    for (const e of (data.entries || [])) {
      if (e && idsToRemove.includes(e.providerId)) e.providerId = reassignTo;
    }
  }

  // Remove from the list itself.
  if (cfg.store === 'providers') {
    data.providers = (data.providers || []).filter(p => !idsToRemove.includes(p.id));
  } else if (data.config && data.config.lists && Array.isArray(data.config.lists[key])) {
    data.config.lists[key] = data.config.lists[key].filter(x => !idsToRemove.includes(x.id));
  }

  _touch(data);
  saveData(data);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────

// Reassign a category-like field across every record collection that can
// carry it: card charges, cash/wallet entry charges, and bank transactions.
function _reassignField(data, field, fromIds, toId) {
  const set = new Set(fromIds);
  const fix = (rec) => { if (rec && set.has(rec[field])) rec[field] = toId; };

  for (const card of (data.cards || [])) {
    for (const ch of (card.charges || [])) fix(ch);
  }
  for (const e of (data.entries || [])) {
    for (const ch of (e.charges || [])) fix(ch);
  }
  for (const tx of (data.bankTransactions || [])) fix(tx);
}

function _touch(data) {
  if (data.meta && typeof data.meta === 'object') data.meta.lastUpdated = todayISO();
}
