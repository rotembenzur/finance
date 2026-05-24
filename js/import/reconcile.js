// ─────────────────────────────────────────────────────────────────
//  RECONCILIATION MATCHER
//
//  Pure scoring function for "is this manual quick-entry the same
//  purchase as that imported charge?". Same-card is required. Each
//  candidate pair is graded into a confidence tier:
//
//    · 'exact'     — same amount (to the cent) AND same calendar day.
//                    These are duplicates with near-certainty, so the
//                    flow merges them automatically without asking.
//    · 'uncertain' — close but not certain: amount within ±2% or ₪5,
//                    or the date off by a day or two. These are shown
//                    to the user to confirm or reject.
//
//  Merchant similarity is a confidence bonus, not a gate — the
//  imported merchant name rarely matches what the user typed by hand.
//
//  The user's rejectedMatches[] list (per manual entry) is honored,
//  so once they've said "no, those aren't the same", that pair stays
//  silent on every subsequent import.
// ─────────────────────────────────────────────────────────────────

const EXACT_AMOUNT_TOLERANCE = 0.01;   // "same amount" = within a cent
const FUZZY_AMOUNT_ABS       = 5;      // ₪ — flag amounts this close…
const FUZZY_AMOUNT_PCT       = 0.02;   // …or within 2%, whichever is wider
const EXACT_DATE_DAYS        = 0;      // "same day"
const DATE_WINDOW_DAYS       = 5;      // outer bound for a fuzzy date match

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
      .filter(p => p.confidence !== null)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) continue;
    const best = scored[0];
    pairs.push({
      manual:     m,
      imported:   best.imported,
      score:      best.score,
      confidence: best.confidence,
      reasons:    best.reasons,
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

// Returns { score, confidence, reasons[] }.
//   confidence — 'exact' | 'uncertain' | null (not a candidate)
//   score      — 0..100, used only to rank competing candidates
//   reasons    — human-readable tags the modal renders ("Similar
//                amount", "1 day apart", …)
//
// Gates: a pair is a candidate only if the amounts are within the
// fuzzy threshold (±2% or ₪5, whichever is wider) AND the dates are
// within the date window. A candidate is 'exact' when the amount
// matches to the cent and the date matches to the day; otherwise it's
// 'uncertain' and gets surfaced for the user to confirm.
export function scorePair(manual, imported) {
  const reasons = [];

  const amtA = Number(manual.amount) || 0;
  const amtB = Number(imported.amount) || 0;
  const amtDiff = Math.abs(amtA - amtB);
  const amtThreshold = Math.max(
    FUZZY_AMOUNT_ABS,
    FUZZY_AMOUNT_PCT * Math.max(Math.abs(amtA), Math.abs(amtB))
  );
  if (amtDiff > amtThreshold) return { score: 0, confidence: null, reasons: [] };

  const dayDiff = _daysApart(manual.date, imported.date);
  if (dayDiff == null || dayDiff > DATE_WINDOW_DAYS) {
    return { score: 0, confidence: null, reasons: [] };
  }

  const amountExact = amtDiff <= EXACT_AMOUNT_TOLERANCE;
  const dateExact   = dayDiff <= EXACT_DATE_DAYS;

  reasons.push(amountExact ? 'amount' : 'nearAmount');
  reasons.push(dateExact ? 'sameDay' : 'closeDate');

  let score = 0;
  // Amount: full marks when exact, tapering as it drifts to the edge.
  score += amountExact ? 50 : Math.max(0, 45 - (amtDiff / amtThreshold) * 25);
  // Date: 30 same day, 24 one day apart, …
  score += Math.max(0, 30 - dayDiff * 6);

  const sim = _merchantSimilarity(manual.merchant, imported.merchant);
  if (sim >= 0.85) { score += 20; reasons.push('merchantStrong'); }
  else if (sim >= 0.5) { score += 10; reasons.push('merchantWeak'); }

  const confidence = (amountExact && dateExact) ? 'exact' : 'uncertain';
  return { score: Math.round(score), confidence, reasons };
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
