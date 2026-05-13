// ─────────────────────────────────────────────────────────────────
//  RECONCILIATION MATCHER
//
//  Pure scoring function for "is this manual quick-entry the same
//  purchase as that imported charge?". Same-card is required; amount
//  must agree within a cent; date within 5 days. Merchant similarity
//  is a confidence bonus, not a gate — the imported merchant name
//  rarely matches what the user typed by hand.
//
//  The user's rejectedMatches[] list (per manual entry) is honored,
//  so once they've said "no, those aren't the same", that pair stays
//  silent on every subsequent import.
// ─────────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 0.01;
const DATE_WINDOW_DAYS = 5;
const SCORE_THRESHOLD  = 50;

export function findReconciliationCandidates(card, newlyImportedIds) {
  if (!card || !Array.isArray(card.charges)) return [];

  const manual = card.charges.filter(c => c.source === 'manual');
  const imported = card.charges.filter(c =>
    c.source !== 'manual' && newlyImportedIds.has(c.id)
  );
  if (manual.length === 0 || imported.length === 0) return [];

  const pairs = [];
  for (const m of manual) {
    const rejected = new Set(m.rejectedMatches || []);
    const scored = imported
      .filter(i => !rejected.has(i.id))
      .map(i => ({ imported: i, ...scorePair(m, i) }))
      .filter(p => p.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) continue;
    const best = scored[0];
    pairs.push({
      manual:   m,
      imported: best.imported,
      score:    best.score,
      reasons:  best.reasons,
    });
  }

  // Resolve conflicts: one imported charge should not match more than
  // one manual entry. When two manual entries point at the same
  // imported, keep the higher-scoring pair.
  const claimed = new Map();   // importedId → best pair
  for (const p of pairs) {
    const prior = claimed.get(p.imported.id);
    if (!prior || p.score > prior.score) {
      claimed.set(p.imported.id, p);
    }
  }
  return [...claimed.values()].sort((a, b) => b.score - a.score);
}

// Returns { score, reasons[] }. Score is 0..100. Reasons are human
// strings the modal uses ("Same amount", "1 day apart", …) so the
// user understands why we're suggesting the merge.
export function scorePair(manual, imported) {
  const reasons = [];
  let score = 0;

  const amtDiff = Math.abs((manual.amount || 0) - (imported.amount || 0));
  if (amtDiff > AMOUNT_TOLERANCE) {
    return { score: 0, reasons: [] };   // hard gate
  }
  score   += 50;
  reasons.push('amount');

  const dayDiff = _daysApart(manual.date, imported.date);
  if (dayDiff == null || dayDiff > DATE_WINDOW_DAYS) {
    return { score: 0, reasons: [] };   // hard gate
  }
  score += Math.max(0, 30 - dayDiff * 6);   // 30 same day, 24 one day, …
  reasons.push(dayDiff === 0 ? 'sameDay' : 'closeDate');

  const sim = _merchantSimilarity(manual.merchant, imported.merchant);
  if (sim >= 0.85) { score += 20; reasons.push('merchantStrong'); }
  else if (sim >= 0.5) { score += 10; reasons.push('merchantWeak'); }

  return { score, reasons };
}

// ── Helpers ───────────────────────────────────────────────────

function _daysApart(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  const diff = Math.round((a - b) / (1000 * 60 * 60 * 24));
  return Math.abs(diff);
}

// 0..1 normalized similarity. We strip punctuation/case and compute
// a Jaccard over character bigrams — cheap, language-agnostic, and
// works fine for short Hebrew + English merchant strings.
function _merchantSimilarity(a, b) {
  const sa = _bigrams(_normalize(a));
  const sb = _bigrams(_normalize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function _normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\-_.,'"!?()\[\]׳״״]/g, '')
    .trim();
}

function _bigrams(text) {
  const out = new Set();
  for (let i = 0; i < text.length - 1; i++) {
    out.add(text.slice(i, i + 2));
  }
  if (text.length === 1) out.add(text);
  return out;
}
