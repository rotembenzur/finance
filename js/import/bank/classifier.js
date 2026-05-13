// ─────────────────────────────────────────────────────────────────
//  BANK TRANSACTION CLASSIFIER
//
//  Heuristic-only — no ML, no remote service. Each rule looks at the
//  description text + direction and decides which category the row
//  belongs to. Categories drive UI grouping, reconciliation, and
//  future analytics.
//
//  Rule order matters: more specific patterns come first. The first
//  rule that matches wins; the rest are skipped. Default category is
//  'unclassified' so the user sees every imported row, even ones we
//  couldn't tag.
//
//  Each category carries:
//    id            — stable key used in storage + filters
//    icon          — single emoji for the timeline row
//    isInternal    — when true, the row represents money moving
//                    inside the user's own financial life (e.g.,
//                    transfer to their own brokerage, card
//                    settlement covering already-imported charges).
//                    UI uses this to keep such rows from being
//                    counted as "spending".
//    isReconcileTarget — for card_settlement: rows that should
//                    later resolve against imported card charges
//                    instead of standing alone as expenses.
// ─────────────────────────────────────────────────────────────────

// All patterns operate on the raw Hebrew description. Latin tokens
// embedded in Hebrew text ("bit", "BIT") are matched case-insensitively
// at word boundaries.
const RULES = [
  // bit transfers (peer-to-peer, Israel's de-facto Venmo)
  {
    test: (desc) => /\bbit\b/i.test(desc),
    type: 'bit_transfer',
    icon: '⚡',
  },

  // Investment contribution — Altshuler Shaham gemel et al.
  {
    test: (desc) => /אלטשולר/.test(desc),
    type: 'investment_contribution',
    icon: '📈',
    isInternal: true,
    isRecurring: true,
  },

  // Salary — MoFat (military teaching academy) and common Hebrew
  // salary indicators. Direction is always credit; we still match
  // on text first so a hypothetical reversal-row stays classified.
  {
    test: (desc, dir) => dir === 'credit' && /מופ"?ת\s*קבע|משכורת|שכר|שכ\.?\s*עבודה/.test(desc),
    type: 'salary',
    icon: '💼',
    isRecurring: true,
  },

  // Credit-card settlement rows — these are NOT new spending; they
  // pay off charges the user already sees in the cards layer.
  {
    test: (desc) => /ישראכרט|כאל|מקס|אמריקן|אקספרס|פרימיום\s*אקספרס|לאומי\s*קארד|ויזה\s*כאל/.test(desc),
    type: 'card_settlement',
    icon: '💳',
    isInternal: true,
    isReconcileTarget: true,
  },

  // National Insurance Institute — credit = benefit/allowance,
  // debit = self-employed contribution.
  {
    test: (desc) => /בטוח\s*לאומי|ביטוח\s*לאומי/.test(desc),
    type: 'social_security',
    icon: '🏛',
  },

  // Securities purchases / sales / dividends in the bank's brokerage.
  {
    test: (desc) => /ני"?ע[-\s]*דיבידנד|דיבידנד/.test(desc),
    type: 'dividend',
    icon: '🎁',
  },
  {
    test: (desc) => /ני"?ע[-\s]*קני[הת]/.test(desc),
    type: 'securities_buy',
    icon: '🛒',
    isInternal: true,
  },
  {
    test: (desc) => /ני"?ע[-\s]*מכיר[הת]/.test(desc),
    type: 'securities_sell',
    icon: '💱',
    isInternal: true,
  },

  // "דירקט-מצטבר" is Hapoalim's accumulating-savings sweep —
  // transfers between the checking account and the Direct savings
  // product. Internal regardless of direction.
  {
    test: (desc) => /דירקט/.test(desc),
    type: 'internal_savings',
    icon: '🔄',
    isInternal: true,
  },

  // Mobile-bank "Bit-style" transfer to someone else — outgoing.
  {
    test: (desc) => /העב'?\s*לאחר[-\s]*נייד|העברה\s*לאחר/.test(desc),
    type: 'outgoing_transfer',
    icon: '➖',
  },

  // Mobile-bank transfer received OR a deposit.
  {
    test: (desc) => /העברה[-\s]*נייד|העברה\/?\s*הפקדה|הפקדה/.test(desc),
    type: 'incoming_transfer',
    icon: '➕',
  },

  // Fees, interest, refunds, grants.
  { test: (desc) => /עמלה/.test(desc),            type: 'fee',       icon: '🧾' },
  { test: (desc) => /ריבית/.test(desc),           type: 'interest',  icon: '💹' },
  { test: (desc) => /מענק|זיכוי/.test(desc),       type: 'refund',    icon: '🎉' },

  // Generic insurance company line — Harel, Migdal, Menora, etc.
  {
    test: (desc) => /הראל|מגדל|מנורה|הפניקס|כלל\b/.test(desc),
    type: 'insurance',
    icon: '🛡',
  },
];

const DEFAULT_RULE = { type: 'unclassified', icon: '·' };

// Returns { type, icon, isInternal, isRecurring, isReconcileTarget }
// for a transaction. `direction` is 'credit' | 'debit'.
export function classifyTransaction({ description, direction }) {
  const desc = (description || '').trim();
  for (const r of RULES) {
    if (r.test(desc, direction)) {
      return {
        type:               r.type,
        icon:               r.icon,
        isInternal:         !!r.isInternal,
        isRecurring:        !!r.isRecurring,
        isReconcileTarget:  !!r.isReconcileTarget,
      };
    }
  }
  return {
    type: DEFAULT_RULE.type,
    icon: DEFAULT_RULE.icon,
    isInternal: false,
    isRecurring: false,
    isReconcileTarget: false,
  };
}

// Returns a Set of all known type ids — used by the filter chips on
// the timeline page so we don't have to repeat the list.
export const BANK_TX_TYPES = [
  'salary',
  'bit_transfer',
  'incoming_transfer',
  'outgoing_transfer',
  'card_settlement',
  'investment_contribution',
  'securities_buy',
  'securities_sell',
  'dividend',
  'interest',
  'refund',
  'social_security',
  'insurance',
  'internal_savings',
  'fee',
  'unclassified',
];
