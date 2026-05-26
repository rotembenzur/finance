// ─────────────────────────────────────────────────────────────────
//  IMPORTED-CHARGE MERGE (UPSERT, NEVER SUBTRACT)
//
//  A statement file is treated as a partial feed, not the full truth.
//  Re-importing — or importing a later month that omits earlier
//  charges — must never delete charges already on the card. So the
//  apply step UPSERTS:
//
//    · a file charge that matches an existing one  → update it in
//      place (refresh imported fields, keep user enrichment)
//    · a file charge with no match                 → add it
//    · an existing charge absent from the file     → keep it as-is
//
//  Matching is by stable id first. The fingerprint fallback exists
//  for one specific case: an Isracard row imported while *pending*
//  gets a `isr-fb-<date>-<merchant>-<amount>` id, but once it
//  *commits* it carries a voucher id (`isr-<voucher>`). Same charge,
//  different id. The fingerprint (date + amount + merchant) bridges
//  that transition so the pending row is updated, not duplicated.
//
//  The upsert ALSO emits a rich diff payload (added[]/updated[]/
//  kept[]) the preview consumes to show exactly what will change:
//  per-row matching reason, per-field before/after for updates, and
//  an "identical re-import" flag so unchanged rows can be folded
//  into a one-line footer instead of cluttering the diff list.
// ─────────────────────────────────────────────────────────────────

// Stable-ish fingerprint for cross-file identity when ids don't match.
// Cents-rounded amount + ISO date + normalized merchant. Two charges
// with the same fingerprint are almost certainly the same purchase
// re-surfacing under a different id.
export function chargeFingerprint(charge) {
  const date  = String(charge.date || '').slice(0, 10);
  const cents = Math.round((Number(charge.amount) || 0) * 100);
  const merch = String(charge.merchant || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${date}|${cents}|${merch}`;
}

// Fields that count for the user-visible diff. These are the ones the
// preview surfaces as "Field: from → to" lines so the user can verify
// what's about to change. Everything not in this list is either
// user-owned enrichment (preserved across re-imports by definition)
// or import metadata that always changes (importedAt, source).
const DIFF_FIELDS = [
  'merchant',
  'amount',
  'currency',
  'date',
  'originalAmount',
  'originalCurrency',
  'fxRate',
  'billingDate',
  'note',
  'maxCategory',
  'maxType',
  'channel',
  'status',
];

const AMOUNT_FIELDS = new Set(['amount', 'originalAmount', 'fxRate']);

// Compute the user-visible diff between a prior stored charge and the
// new built charge. Numeric fields are cents-rounded to avoid floating-
// point chatter; everything else is a direct === comparison after a
// null/undefined coalesce.
export function diffCharge(prior, next) {
  const changes = [];
  for (const field of DIFF_FIELDS) {
    const a = prior ? prior[field] : null;
    const b = next  ? next[field]  : null;
    if (AMOUNT_FIELDS.has(field)) {
      const ca = a == null ? null : Math.round(Number(a) * 100);
      const cb = b == null ? null : Math.round(Number(b) * 100);
      if (ca !== cb) changes.push({ field, from: a, to: b });
    } else {
      if (!_eq(a, b)) changes.push({ field, from: a, to: b });
    }
  }
  return changes;
}

function _eq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Treat empty strings the same as nullish for diff purposes —
  // "" → null is not a meaningful change to surface.
  if (a === '' && b == null) return true;
  if (b === '' && a == null) return true;
  return a === b;
}

// Merge parsed file charges into the card's existing imported charges.
//
//   priorImported  — existing charges with source !== 'manual'
//   parsedCharges  — rows from the freshly parsed file
//   buildCharge(parsed, prior?) — returns the storage-shaped charge.
//      `prior` is the matched existing charge (or undefined for a new
//      one) so the builder can carry user enrichment forward.
//
// `deletedIds` (optional Set) are charges the user explicitly deleted.
// They're skipped on both sides so a re-import never resurrects them —
// the upsert otherwise has no "remove" path by design.
//
// Returns the full imported-charges array to store (manual entries are
// the caller's concern), the legacy counts (addedCount / updatedCount /
// keptCount), and rich diff lists the preview consumes:
//
//   added:   [{ parsed, built }]
//   updated: [{ parsed, prior, built, matchedBy, changes, identical }]
//   kept:    [{ prior }]
//
// `matchedBy` is 'id' (stable-id match) or 'fingerprint' (date + amount
// + normalized merchant match — used when the id changed between
// imports, e.g. Isracard pending → committed).
//
// `changes` is the output of diffCharge(prior, built); empty means the
// file re-imported the same row verbatim. `identical` mirrors that flag
// so callers can quickly partition truly-changed updates from no-ops.
export function upsertImportedCharges(priorImported, parsedCharges, buildCharge, deletedIds) {
  const deleted = deletedIds instanceof Set ? deletedIds : new Set();
  const live = priorImported.filter(c => !deleted.has(c.id));

  const byId = new Map();
  const byFp = new Map();
  for (const c of live) {
    byId.set(c.id, c);
    const fp = chargeFingerprint(c);
    if (!byFp.has(fp)) byFp.set(fp, c);   // first writer wins on collisions
  }

  const consumed = new Set();   // prior ids claimed by a file row
  const result = [];
  const added = [];
  const updated = [];

  for (const parsed of parsedCharges) {
    if (deleted.has(parsed.id)) continue;   // user removed this; don't re-add

    let prior = byId.get(parsed.id);
    let matchedBy = null;
    if (prior) {
      matchedBy = 'id';
    } else {
      const fpMatch = byFp.get(chargeFingerprint(parsed));
      if (fpMatch && !consumed.has(fpMatch.id)) {
        prior = fpMatch;
        matchedBy = 'fingerprint';
      }
    }

    const built = buildCharge(parsed, prior);
    result.push(built);

    if (prior) {
      consumed.add(prior.id);
      const changes = diffCharge(prior, built);
      updated.push({
        parsed,
        prior,
        built,
        matchedBy,
        changes,
        identical: changes.length === 0,
      });
    } else {
      added.push({ parsed, built });
    }
  }

  // Keep every prior imported charge the file didn't mention. This is
  // the whole point: a monthly file omitting older charges leaves them
  // standing instead of wiping them. (Deleted ones were filtered out
  // of `live` already, so they're neither kept nor re-added.)
  const kept = [];
  for (const c of live) {
    if (!consumed.has(c.id)) {
      result.push(c);
      kept.push({ prior: c });
    }
  }

  return {
    charges:      result,
    addedCount:   added.length,
    updatedCount: updated.length,
    keptCount:    kept.length,
    added,
    updated,
    kept,
  };
}
