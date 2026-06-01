// ─────────────────────────────────────────────────────────────────
//  INCOME CATEGORIES
//
//  Mirrors the expense-categories registry: bilingual names + emoji,
//  embedded in the data (not i18n keys) so the taxonomy lives in
//  one place. No subcategories in V1 — income types are narrower
//  than expense types and the top-level set is enough.
//
//  Stored on transactions/charges as:
//    charge.incomeCategoryId    → 'gift'
//    transaction.incomeCategoryId → 'salary'
//
//  Helpers below resolve IDs to display info. Kept parallel to
//  expense-categories so future refactors can unify both behind a
//  single "categorize me" lookup if it ever makes sense.
// ─────────────────────────────────────────────────────────────────

export const INCOME_CATEGORIES = [
  {
    id:    'salary',
    emoji: '💼',
    name:  { en: 'Salary',            he: 'משכורת' },
  },
  {
    id:    'gift',
    emoji: '🎁',
    name:  { en: 'Gift',              he: 'מתנה' },
  },
  {
    id:    'refund',
    emoji: '↩️',
    name:  { en: 'Refund',            he: 'החזר' },
  },
  {
    id:    'transfer',
    emoji: '↪️',
    name:  { en: 'Transfer received', he: 'העברה שהתקבלה' },
  },
  {
    id:    'cashback',
    emoji: '💰',
    name:  { en: 'Cashback',          he: 'קאשבק' },
  },
  {
    id:    'investment',
    emoji: '📈',
    name:  { en: 'Investment income', he: 'תשואת השקעה' },
  },
  {
    id:    'social_security',
    emoji: '🏛️',
    name:  { en: 'Social security',   he: 'ביטוח לאומי' },
  },
  {
    id:    'other_income',
    emoji: '✨',
    name:  { en: 'Other',             he: 'אחר' },
  },
];

const _BY_ID = new Map(INCOME_CATEGORIES.map(c => [c.id, c]));

// Cash wallets only ever receive a narrow slice of income: a cash
// gift, a cash refund, a Bit/Paybox-style transfer, or something
// odd ("other"). Salary, cashback, investment payouts and social
// security all land in bank accounts, never as physical cash — so
// the cash income picker (quick-income on a cash destination, and
// the cash-charge editor) is restricted to this subset. Bank + card
// income keep the full registry above.
export const CASH_INCOME_CATEGORY_IDS = ['gift', 'refund', 'transfer', 'other_income'];

export function getCashIncomeCategories() {
  return INCOME_CATEGORIES.filter(c => CASH_INCOME_CATEGORY_IDS.includes(c.id));
}

export function getIncomeCategoryById(id) {
  return id ? _BY_ID.get(id) || null : null;
}

export function incomeCategoryDisplay(id, lang) {
  const cat = getIncomeCategoryById(id);
  if (!cat) return null;
  return { emoji: cat.emoji, name: cat.name[lang] || cat.name.en };
}

// ── Income category ⇄ bank-transaction type bridges ──────────────
//
// `incomeCategoryId` (this registry) is the USER-FACING classification
// of incoming money, parallel to how an expense uses `categoryId`. The
// bank-transaction `type` (BANK_TX_TYPES in import/bank/classifier.js)
// is the TECHNICAL classification. The two used to be conflated; these
// helpers keep them aligned without coupling the modules. Type ids are
// referenced as plain string literals so this data module imports
// nothing.

// When persisting a MANUAL income transaction, pick the closest valid
// technical type for the chosen category. Categories with no clean
// technical equivalent fall back to the generic incoming transfer — the
// income category still carries the meaning.
const _INCOME_TO_TX_TYPE = {
  salary:          'salary',
  refund:          'refund',
  social_security: 'social_security',
};
export function incomeCategoryToTxType(incomeCategoryId) {
  return _INCOME_TO_TX_TYPE[incomeCategoryId] || 'incoming_transfer';
}

// Best-effort income category for a credit transaction whose category
// wasn't set explicitly (e.g. an imported row classified only by type).
// Returns null when the type doesn't map to a recognizable income kind,
// so internal/ambiguous credits aren't mislabeled. Used as a display
// fallback + edit default so imported and manual income line up.
const _TX_TYPE_TO_INCOME = {
  salary:            'salary',
  incoming_transfer: 'transfer',
  bit_transfer:      'transfer',
  refund:            'refund',
  dividend:          'investment',
  interest:          'investment',
  securities_sell:   'investment',
  social_security:   'social_security',
};
export function txTypeToIncomeCategory(type) {
  return _TX_TYPE_TO_INCOME[type] || null;
}

// The income category to SHOW/EDIT for a transaction: the explicit
// field when set, otherwise derived from the technical type. Only
// credit (incoming) rows have an income category; debits return null.
export function resolveIncomeCategoryId(tx) {
  if (!tx || tx.direction !== 'credit') return null;
  return tx.incomeCategoryId || txTypeToIncomeCategory(tx.type);
}
