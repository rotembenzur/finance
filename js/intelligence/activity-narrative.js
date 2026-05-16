// ─────────────────────────────────────────────────────────────────
//  ACTIVITY NARRATIVE — plain-language read of a month's activity
//
//  composeActivityNarrative(monthTxs, groupBundle) → { sentences: [{key, vars}] }
//
//  groupBundle is the { groups, tail } object returned by
//  activity-groups.groupActivity. The narrative reads from it
//  rather than re-deriving group membership so "the biggest
//  single charge" sentence picks from the same notable list the
//  page renders, not from raw debits — otherwise predictable
//  rent / mortgage payments would always win that sentence.
//
//  2-3 sentences, mirror of the Portfolio Read on the Intelligence
//  page. Voice rules from [[intelligence-voice-and-hierarchy]]:
//  second-person possessive, real numbers, named merchants when
//  one stands out, no jargon.
//
//  Sentence structure:
//    1. Headline   — in / out / kept (or "spent more than you brought in")
//    2. Income     — salary date when present, else N sources
//    3. Spending   — the single most notable charge OR card-settlement
//                    summary, whichever is the most informative
//
//  Empty month gets a single short sentence.
// ─────────────────────────────────────────────────────────────────

export function composeActivityNarrative(monthTxs, groupBundle) {
  if (!Array.isArray(monthTxs) || monthTxs.length === 0) {
    return { sentences: [{ key: 'activity.narrative.empty', vars: {} }] };
  }
  const groups = (groupBundle && groupBundle.groups) || [];

  // Recompute totals here from the raw month rather than relying on
  // group sums — the narrative wants strict in / out figures, and
  // the tail in the grouping engine is a net signed total.
  const inflow  = monthTxs.filter(t => t.direction === 'credit').reduce((s, t) => s + (t.amount || 0), 0);
  const outflow = monthTxs.filter(t => t.direction === 'debit').reduce((s, t) => s + (t.amount || 0), 0);
  const net     = inflow - outflow;

  const sentences = [];

  // 1. Headline
  if (net >= 0) {
    sentences.push({
      key:  'activity.narrative.kept',
      vars: { in: inflow, out: outflow, net },
    });
  } else {
    sentences.push({
      key:  'activity.narrative.spent',
      vars: { in: inflow, out: outflow, over: -net },
    });
  }

  // 2. Income context
  const credits = monthTxs.filter(t => t.direction === 'credit');
  if (credits.length > 0) {
    const salary = credits.find(t => t.type === 'salary');
    if (salary) {
      sentences.push({
        key:  'activity.narrative.salary',
        vars: { amount: salary.amount, date: salary.date },
      });
    } else if (credits.length === 1) {
      sentences.push({
        key:  'activity.narrative.incomeSingle',
        vars: { merchant: credits[0].description, amount: credits[0].amount },
      });
    } else {
      sentences.push({
        key:  'activity.narrative.incomeMulti',
        vars: { count: credits.length, total: inflow },
      });
    }
  }

  // 3. Spending — pick the single most informative sentence.
  //
  // Priority: the biggest item from the engine's `notable` group
  // (specific + scannable, and already excludes recurring/cards/
  // transfers so it really is a one-off charge worth surfacing).
  // Falls back to the card-settlement summary when there are no
  // notable charges but cards did settle — quantified and useful.
  const notableGroup = groups.find(g => g.id === 'notable');
  const cardGroup    = groups.find(g => g.id === 'cards');

  if (notableGroup && notableGroup.items.length > 0) {
    const biggest = notableGroup.items[0]; // already sorted desc by amount
    sentences.push({
      key:  'activity.narrative.notable',
      vars: { merchant: biggest.description, amount: biggest.amount },
    });
  } else if (cardGroup && cardGroup.items.length > 0) {
    sentences.push({
      key:  'activity.narrative.cards',
      vars: {
        count: cardGroup.items.length,
        total: cardGroup.total,
      },
    });
  }

  return { sentences };
}
