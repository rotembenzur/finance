// ─────────────────────────────────────────────────────────────────
//  IMPORT — DIFF & APPLY
//
//  Pure functions for comparing a parsed broker report against the
//  current portfolio state, plus the mutator that applies the diff.
//  Mutations go through the same in-memory path as manual CRUD, so
//  localStorage persistence happens for free.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';

const _IMPORT_TARGET_PORTFOLIO_ID = 'ibi';

// Current entries belonging to the target portfolio.
function _existingPortfolioEntries(data, portfolioId) {
  return data.entries.filter(e => e.portfolioId === portfolioId);
}

function _portfolioById(data, portfolioId) {
  return (data.portfolios || []).find(p => p.id === portfolioId) || null;
}

// Build deterministic entry IDs from IBI security IDs so re-syncing
// the same security never duplicates the entry.
function _entryIdFromIBI(securityId) {
  return `inv-ibi-${securityId}`;
}

// Compare a parse result against current state. Pure — returns the
// proposed change set without mutating anything.
//
// Match strategy:
//   1) by parsed.ibiSecurityId === existing.ibiSecurityId  (subsequent syncs)
//   2) fallback: parsed by id, existing without id → orphans removed
//
// On the very first sync (existing entries have no ibiSecurityId
// because they were seeded as placeholders), every existing entry
// becomes "removed" and every parsed entry becomes "added". The
// preview surfaces this clearly so the user understands.
export function computeImportDiff(data, parseResult) {
  const portfolio = _portfolioById(data, _IMPORT_TARGET_PORTFOLIO_ID);
  const existing  = _existingPortfolioEntries(data, _IMPORT_TARGET_PORTFOLIO_ID);

  const existingById = new Map();
  const existingOrphans = [];
  for (const e of existing) {
    if (e.ibiSecurityId) existingById.set(String(e.ibiSecurityId), e);
    else                 existingOrphans.push(e);
  }

  const added = [];
  const updated = [];
  const seenIds = new Set();

  for (const h of parseResult.holdings) {
    const sid = String(h.ibiSecurityId);
    seenIds.add(sid);
    const match = existingById.get(sid);
    if (match) {
      const changes = _fieldChanges(match, h);
      if (changes.length > 0) updated.push({ existing: match, parsed: h, changes });
    } else {
      added.push(h);
    }
  }

  // Anything in existingById but not in seenIds is gone from the file.
  const removed = [];
  for (const [sid, entry] of existingById) {
    if (!seenIds.has(sid)) removed.push(entry);
  }
  // Plus orphans (existing entries without an IBI ID — first-sync case).
  removed.push(...existingOrphans);

  // Portfolio-level total diff.
  const portfolioChanges = portfolio
    ? _portfolioFieldChanges(portfolio, parseResult.portfolio)
    : [];

  return {
    portfolio,
    portfolioChanges,
    parsedPortfolio: parseResult.portfolio,
    added,
    updated,
    removed,
    warnings: parseResult.warnings || [],
    parseResult,
  };
}

// Field-level diff for a single holding. Only checks fields that the
// apply step actually touches — name, ticker, type, assetClass, and
// other classification metadata are USER-OWNED across syncs and never
// overwritten by the broker, so showing them in the preview would be
// misleading.
function _fieldChanges(existing, parsed) {
  const cmp = [
    ['currentValue',       existing.currentValue,       parsed.currentValue],
    ['invested',           existing.invested,           parsed.invested],
    ['gain',               existing.gain,               parsed.gain],
    ['gainPercent',        existing.gainPercent,        parsed.gainPercent],
    ['quantity',           existing.quantity,           parsed.quantity],
    ['allocationPct',      existing.allocationPct,      parsed.allocationPct],
    ['dailyChangePercent', existing.dailyChangePercent, parsed.dailyChangePercent],
  ];
  return cmp
    .filter(([, a, b]) => !_eq(a, b))
    .map(([field, before, after]) => ({ field, before, after }));
}

function _portfolioFieldChanges(existing, parsed) {
  const cmp = [
    ['totalValue',         existing.totalValue,         parsed.totalValue],
    ['totalInvested',      existing.totalInvested,      parsed.totalInvested],
    ['totalGain',          existing.totalGain,          parsed.totalGain],
    ['totalGainPercent',   existing.totalGainPercent,   parsed.totalGainPercent],
    ['dailyChange',        existing.dailyChange,        parsed.dailyChange],
  ];
  return cmp
    .filter(([, a, b]) => !_eq(a, b))
    .map(([field, before, after]) => ({ field, before, after }));
}

function _eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return String(a) === String(b);
}

// Build a fresh entry object from a parsed holding. `isTechnical`
// rides through so that tax shields and system positions stay
// flagged after every broker re-sync.
function _entryFromParsed(parsed) {
  return {
    id:                 _entryIdFromIBI(parsed.ibiSecurityId),
    name:               parsed.name,
    institution:        'IBI',
    portfolioId:        _IMPORT_TARGET_PORTFOLIO_ID,
    bankId:              null,
    ibiSecurityId:      String(parsed.ibiSecurityId),
    type:               parsed.type,
    category:           'semi_liquid',
    tier:               'invested',
    assetClass:         parsed.assetClass,
    isTechnical:        parsed.isTechnical || false,
    balance:             null,
    currentValue:       parsed.currentValue,
    invested:           parsed.invested,
    gain:               parsed.gain,
    gainPercent:        parsed.gainPercent,
    ticker:             parsed.ticker,
    quantity:           parsed.quantity,
    dailyChangePercent: parsed.dailyChangePercent,
    allocationPct:      parsed.allocationPct,
    currency:           parsed.currency || 'ILS',
    isActive:            true,
    isLiability:         false,
    updatedAt:           todayISO(),
  };
}

// Apply a previously-computed diff to appData and persist. Returns a
// summary of what changed for the post-apply confirmation toast.
//
// Two distinct merge strategies:
//
//  · UPDATE existing entries — conservative. Only broker-volatile
//    fields (value, quantity, daily%, allocation%) are overwritten.
//    User-owned classification (name, type, assetClass, isTechnical,
//    categoryOverride, ticker) is preserved across syncs. So once
//    you rename "USD cash row" to "Dolev USA" with assetClass
//    us_equity, future syncs won't undo that.
//
//  · ADD new entries — full creation from parser defaults. Genuinely
//    new securities show up with their broker-derived metadata.
export function applyImportDiff(diff) {
  const portfolioId = _IMPORT_TARGET_PORTFOLIO_ID;
  const appData = getAppData();

  // 1. Drop removed entries.
  const removedIds = new Set(diff.removed.map(e => e.id));
  if (removedIds.size > 0) {
    appData.entries = appData.entries.filter(e => !removedIds.has(e.id));
  }

  // 2. Update existing entries — broker-volatile fields only.
  //    `invested`, `gain`, and `gainPercent` are intentionally
  //    included here: cost basis shifts on every new buy/sell, and
  //    the broker's running gain figures move with both basis and
  //    price. They're broker-owned just like currentValue.
  for (const { existing, parsed } of diff.updated) {
    const idx = appData.entries.findIndex(e => e.id === existing.id);
    if (idx === -1) continue;
    appData.entries[idx] = {
      ...appData.entries[idx],
      currentValue:       parsed.currentValue,
      invested:           parsed.invested,
      gain:               parsed.gain,
      gainPercent:        parsed.gainPercent,
      quantity:           parsed.quantity,
      dailyChangePercent: parsed.dailyChangePercent,
      allocationPct:      parsed.allocationPct,
      updatedAt:          todayISO(),
    };
  }

  // 3. Add new entries — full classification from parser defaults.
  for (const parsed of diff.added) {
    appData.entries.push(_entryFromParsed(parsed));
  }

  // 4. Update portfolio-level totals from parsed data.
  const pf = (appData.portfolios || []).find(p => p.id === portfolioId);
  if (pf) {
    pf.totalValue          = diff.parsedPortfolio.totalValue;
    pf.totalInvested       = diff.parsedPortfolio.totalInvested;
    pf.totalGain           = diff.parsedPortfolio.totalGain;
    pf.totalGainPercent    = diff.parsedPortfolio.totalGainPercent;
    pf.dailyChange         = diff.parsedPortfolio.dailyChange;
    pf.dailyChangePercent  = diff.parsedPortfolio.dailyChangePercent;
    pf.updatedAt           = todayISO();
  }

  appData.meta.lastUpdated = todayISO();
  saveData(appData);
  init();   // re-render

  return {
    addedCount:   diff.added.length,
    updatedCount: diff.updated.length,
    removedCount: diff.removed.length,
  };
}
