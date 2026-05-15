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

export function getIncomeCategoryById(id) {
  return id ? _BY_ID.get(id) || null : null;
}

export function incomeCategoryDisplay(id, lang) {
  const cat = getIncomeCategoryById(id);
  if (!cat) return null;
  return { emoji: cat.emoji, name: cat.name[lang] || cat.name.en };
}
