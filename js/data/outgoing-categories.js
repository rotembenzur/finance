// ─────────────────────────────────────────────────────────────────
//  OUTGOING (BANK) CATEGORIES
//
//  The "kind" picker for a MANUALLY entered outgoing bank transaction
//  — the expense-side mirror of income-categories.js. A real bank
//  account holds movements that are neither credit-card charges nor
//  recurring debits: a transfer to a person, a transfer to savings or
//  investment, a supplier payment, a one-time fee, a cash withdrawal.
//
//  Each kind is the USER-FACING label of the movement. It bridges to
//  two downstream classifiers stored on the bank transaction:
//
//    · type  — the TECHNICAL classification (a real BANK_TX_TYPE from
//              import/bank/classifier.js). Drives timeline grouping.
//    · categoryId/subcategoryId — the expense taxonomy that drives the
//              Spending breakdown. Only attached for `spendable` kinds.
//
//  Two flags decide downstream behaviour:
//    · isInternal — money moving inside the user's own financial life
//                   (to savings / investment / their own cash). Excluded
//                   from Spending. NOTE: we carry this here EXPLICITLY
//                   rather than reading classifier.typeMeta() — some
//                   types (internal_savings) have no classifier rule and
//                   would resolve to isInternal:false.
//    · spendable  — true → reveal the expense-category picker and let the
//                   row count toward Spending; false → internal/transfer
//                   movement with no expense category.
//
//  Bilingual names + emoji are embedded in the data (not i18n keys),
//  matching income-categories.js and expense-categories.js so the
//  taxonomy lives in one place. Pure data module — imports nothing.
// ─────────────────────────────────────────────────────────────────

export const OUTGOING_KINDS = [
  {
    id:    'payment',
    emoji: '💸',
    name:  { en: 'Payment',            he: 'תשלום' },
    type:       'direct_debit_charge',
    isInternal: false,
    spendable:  true,
  },
  {
    id:    'transfer_person',
    emoji: '➖',
    name:  { en: 'Transfer to someone', he: 'העברה לאדם' },
    type:       'outgoing_transfer',
    isInternal: false,
    spendable:  true,
  },
  {
    id:    'to_savings',
    emoji: '🏦',
    name:  { en: 'To savings',          he: 'לחיסכון' },
    type:       'internal_savings',
    isInternal: true,
    spendable:  false,
  },
  {
    id:    'to_investment',
    emoji: '📈',
    name:  { en: 'To investment',       he: 'להשקעה' },
    type:       'investment_contribution',
    isInternal: true,
    spendable:  false,
  },
  {
    id:    'fee',
    emoji: '🧾',
    name:  { en: 'Fee',                 he: 'עמלה' },
    type:       'fee',
    isInternal: false,
    spendable:  true,
  },
  {
    id:    'cash_withdrawal',
    emoji: '💵',
    name:  { en: 'Cash withdrawal',     he: 'משיכת מזומן' },
    // Modelled single-leg: reduces the bank balance and is flagged
    // internal (the money lands in the user's own cash, not spent).
    // There is no dedicated withdrawal BANK_TX_TYPE, so it rides the
    // generic outgoing-transfer type with isInternal forced on here.
    type:       'outgoing_transfer',
    isInternal: true,
    spendable:  false,
  },
  {
    id:    'other',
    emoji: '✨',
    name:  { en: 'Other',               he: 'אחר' },
    type:       'unclassified',
    isInternal: false,
    spendable:  true,
  },
];

const _BY_ID = new Map(OUTGOING_KINDS.map(k => [k.id, k]));

export function getOutgoingKindById(id) {
  return id ? _BY_ID.get(id) || null : null;
}

export function outgoingKindDisplay(id, lang) {
  const kind = getOutgoingKindById(id);
  if (!kind) return null;
  return { emoji: kind.emoji, name: kind.name[lang] || kind.name.en };
}
