// ─────────────────────────────────────────────────────────────────
//  BANK TRANSACTION IDENTITY  (format-independent de-duplication)
//
//  The same real movement can enter the app from different files with
//  different text: a Bank Hapoalim PDF labels a transfer
//  "bit העברת כסף", while the Excel export labels the same row
//  "bit העברת כסף — המבצע: … עבור: …". The per-parser ids hash the
//  description, so one transaction gets two ids and re-importing the
//  other format duplicates it.
//
//  The reliable identity is date + direction + amount + RUNNING
//  BALANCE. The post-transaction balance is effectively unique per
//  movement (every transaction changes it), so it separates even two
//  same-day / same-amount transfers — which a description- or
//  amount-only key would wrongly merge. Description is deliberately
//  EXCLUDED from identity.
//
//  Used by the import upsert (bank-import-flow.js) and a load-time
//  migration (store.js) so existing duplicates collapse and future
//  imports stay idempotent across formats.
// ─────────────────────────────────────────────────────────────────

// Canonical identity string for a transaction, or null when the row
// has no running balance (then it can't be reliably matched and must
// keep its own id rather than risk colliding with a different row).
export function bankTxKey(tx) {
  if (!tx) return null;
  const date = String(tx.date || '').slice(0, 10);
  if (!date) return null;
  if (tx.balance == null || tx.balance === '') return null;
  const dir = tx.direction || '';
  const amt = Math.round((Number(tx.amount)  || 0) * 100);
  const bal = Math.round((Number(tx.balance) || 0) * 100);
  return `${date}|${dir}|${amt}|${bal}`;
}

// The matching key with a guaranteed value — falls back to the row's
// own id when it has no canonical key, so balance-less rows never
// collapse into each other.
export function bankTxMatchKey(tx) {
  return bankTxKey(tx) || ('id:' + (tx && tx.id));
}

// Strip the variable "who/for" tail Hapoalim appends in the Excel
// export so both "bit העברת כסף" and
// "bit העברת כסף — המבצע: … עבור: …" reduce to the same readable core.
// Used to pick the cleaner label when two formats of one row collapse.
export function canonicalBankName(desc) {
  let s = String(desc || '');
  const sep = s.indexOf(' — ');
  if (sep !== -1) s = s.slice(0, sep);
  s = s.replace(/\s*(?:עבור|המבצע)\s*:.*$/u, '');
  return s.replace(/\s+/g, ' ').trim();
}

// Combine two imported rows that share an identity into one. `keep`
// (the first seen) wins on id + position; we take the cleaner display
// name and fill any enrichment gaps from `drop`. Neither is mutated.
export function mergeBankTxEnrichment(keep, drop) {
  const coreA = canonicalBankName(keep.description);
  const coreB = canonicalBankName(drop.description);
  // Same movement → use the clean shared core; otherwise keep base's text.
  const description = (coreA && coreA === coreB)
    ? coreA
    : (keep.description || drop.description || '');

  const out = {
    ...keep,
    description,
    details:          keep.details          ?? drop.details          ?? null,
    reference:        keep.reference         ?? drop.reference         ?? null,
    userLabel:        keep.userLabel         ?? drop.userLabel         ?? null,
    incomeCategoryId: keep.incomeCategoryId  ?? drop.incomeCategoryId  ?? null,
    notes:            keep.notes             ?? drop.notes             ?? null,
    reconciledStatus: keep.reconciledStatus  ?? drop.reconciledStatus  ?? null,
    reconciledWith:   (keep.reconciledWith && keep.reconciledWith.length)
                        ? keep.reconciledWith
                        : (drop.reconciledWith || []),
    mergedManualId:   keep.mergedManualId    ?? drop.mergedManualId    ?? undefined,
  };

  // Carry a user category override from whichever side has one.
  const src = keep.typeOverride ? keep : (drop.typeOverride ? drop : null);
  if (src) {
    out.type              = src.type;
    out.icon              = src.icon;
    out.isInternal        = src.isInternal;
    out.isRecurring       = src.isRecurring;
    out.isReconcileTarget = src.isReconcileTarget;
    out.typeOverride      = true;
  }
  return out;
}

// Collapse imported duplicates (rows sharing a canonical identity) in a
// bankTransactions list. Preserves order and the first id seen, leaves
// manual entries untouched, and is idempotent (re-running is a no-op).
export function dedupeImportedBankTransactions(list) {
  if (!Array.isArray(list)) return list;
  const indexByKey = new Map();   // key → position in `out`
  const out = [];
  for (const tx of list) {
    if (!tx || tx.source === 'manual') { out.push(tx); continue; }
    const key = bankTxMatchKey(tx);
    if (indexByKey.has(key)) {
      const i = indexByKey.get(key);
      out[i] = mergeBankTxEnrichment(out[i], tx);
    } else {
      indexByKey.set(key, out.length);
      out.push(tx);
    }
  }
  return out;
}
