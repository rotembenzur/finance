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

// Merge parsed file charges into the card's existing imported charges.
//
//   priorImported  — existing charges with source !== 'manual'
//   parsedCharges  — rows from the freshly parsed file
//   buildCharge(parsed, prior?) — returns the storage-shaped charge.
//      `prior` is the matched existing charge (or undefined for a new
//      one) so the builder can carry user enrichment forward.
//
// Returns the full imported-charges array to store (manual entries are
// the caller's concern). Also reports what happened, for the preview.
export function upsertImportedCharges(priorImported, parsedCharges, buildCharge) {
  const byId = new Map();
  const byFp = new Map();
  for (const c of priorImported) {
    byId.set(c.id, c);
    const fp = chargeFingerprint(c);
    if (!byFp.has(fp)) byFp.set(fp, c);   // first writer wins on collisions
  }

  const consumed = new Set();   // prior ids claimed by a file row
  const result = [];
  let addedCount = 0;
  let updatedCount = 0;

  for (const parsed of parsedCharges) {
    let prior = byId.get(parsed.id);
    if (!prior) {
      const fpMatch = byFp.get(chargeFingerprint(parsed));
      if (fpMatch && !consumed.has(fpMatch.id)) prior = fpMatch;
    }
    if (prior) { consumed.add(prior.id); updatedCount++; }
    else       { addedCount++; }
    result.push(buildCharge(parsed, prior));
  }

  // Keep every prior imported charge the file didn't mention. This is
  // the whole point: a monthly file omitting older charges leaves them
  // standing instead of wiping them.
  let keptCount = 0;
  for (const c of priorImported) {
    if (!consumed.has(c.id)) { result.push(c); keptCount++; }
  }

  return { charges: result, addedCount, updatedCount, keptCount };
}
