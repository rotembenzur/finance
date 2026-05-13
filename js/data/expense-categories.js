// ─────────────────────────────────────────────────────────────────
//  EXPENSE CATEGORIES
//
//  Single source of truth for the category/subcategory taxonomy used
//  to tag imported credit-card charges. Names are embedded in the
//  data (not i18n keys) because:
//
//    · the taxonomy IS the data — keeping names alongside IDs and
//      emojis avoids drift between three separate files
//    · 14 × ~5 entries × 2 languages = ~140 strings; folding them
//      into i18n.js bloats it without giving the taxonomy a real home
//
//  Charge storage references categories by ID:
//    charge.categoryId    → 'food_drinks'
//    charge.subcategoryId → 'restaurants'
//  Helpers below resolve those IDs back to display info.
// ─────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  {
    id: 'food_drinks',
    emoji: '🍔',
    name: { en: 'Food & Drinks', he: 'אוכל ושתייה' },
    subcategories: [
      { id: 'restaurants',     name: { en: 'Restaurants',     he: 'מסעדות'         } },
      { id: 'coffee_shops',    name: { en: 'Coffee Shops',    he: 'בתי קפה'        } },
      { id: 'delivery',        name: { en: 'Delivery',        he: 'משלוחים'        } },
      { id: 'supermarket',     name: { en: 'Supermarket',     he: 'סופרמרקט'       } },
      { id: 'snacks_drinks',   name: { en: 'Snacks & Drinks', he: 'חטיפים ומשקאות' } },
    ],
  },
  {
    id: 'entertainment',
    emoji: '🎉',
    name: { en: 'Entertainment & Leisure', he: 'בילוי ופנאי' },
    subcategories: [
      { id: 'friends_social',  name: { en: 'Friends & Social', he: 'חברים וחברה'   } },
      { id: 'bars_parties',    name: { en: 'Bars & Parties',   he: 'ברים ומסיבות'  } },
      { id: 'cinema',          name: { en: 'Cinema',           he: 'קולנוע'         } },
      { id: 'concerts',        name: { en: 'Concerts',         he: 'הופעות'         } },
      { id: 'attractions',     name: { en: 'Attractions',      he: 'אטרקציות'       } },
    ],
  },
  {
    id: 'gifts_events',
    emoji: '🎁',
    name: { en: 'Gifts & Events', he: 'מתנות ואירועים' },
    subcategories: [
      { id: 'birthdays',       name: { en: 'Birthdays', he: 'ימי הולדת' } },
      { id: 'weddings',        name: { en: 'Weddings',  he: 'חתונות'    } },
      { id: 'holidays',        name: { en: 'Holidays',  he: 'חגים'      } },
      { id: 'donations',       name: { en: 'Donations', he: 'תרומות'    } },
    ],
  },
  {
    id: 'fitness_sports',
    emoji: '💪',
    name: { en: 'Fitness & Sports', he: 'כושר וספורט' },
    subcategories: [
      { id: 'gym',                 name: { en: 'Gym',                he: 'חדר כושר'        } },
      { id: 'swimming',            name: { en: 'Swimming',           he: 'שחייה'            } },
      { id: 'running_group',       name: { en: 'Running Group',      he: 'קבוצת ריצה'      } },
      { id: 'races_competitions',  name: { en: 'Races & Competitions', he: 'מירוצים ותחרויות' } },
      { id: 'sports_equipment',    name: { en: 'Sports Equipment',   he: 'ציוד ספורט'      } },
      { id: 'supplements',         name: { en: 'Supplements',        he: 'תוספי תזונה'     } },
    ],
  },
  {
    id: 'subscriptions',
    emoji: '🔁',
    name: { en: 'Subscriptions', he: 'מנויים' },
    subcategories: [
      { id: 'ai',                  name: { en: 'AI',                he: 'בינה מלאכותית' } },
      { id: 'fitness_sports_sub',  name: { en: 'Fitness & Sports',  he: 'כושר וספורט'   } },
    ],
  },
  {
    id: 'electronics',
    emoji: '📱',
    name: { en: 'Electronics', he: 'אלקטרוניקה' },
    subcategories: [
      { id: 'phones_accessories',     name: { en: 'Phones & Accessories',     he: 'טלפונים ואביזרים'    } },
      { id: 'computers_peripherals',  name: { en: 'Computers & Peripherals',  he: 'מחשבים וציוד היקפי' } },
      { id: 'headphones',             name: { en: 'Headphones',               he: 'אוזניות'             } },
      { id: 'smart_watches',          name: { en: 'Smart Watches',            he: 'שעונים חכמים'        } },
    ],
  },
  {
    id: 'hobbies',
    emoji: '🎯',
    name: { en: 'Hobbies', he: 'תחביבים' },
    subcategories: [
      { id: 'books',         name: { en: 'Books',         he: 'ספרים'          } },
      { id: 'courses',       name: { en: 'Courses',       he: 'קורסים'         } },
      { id: 'gaming',        name: { en: 'Gaming',        he: 'גיימינג'        } },
      { id: 'photography',   name: { en: 'Photography',   he: 'צילום'          } },
      { id: 'other_hobbies', name: { en: 'Other Hobbies', he: 'תחביבים אחרים' } },
    ],
  },
  {
    id: 'transportation',
    emoji: '🚗',
    name: { en: 'Transportation', he: 'תחבורה' },
    subcategories: [
      { id: 'fuel',                  name: { en: 'Fuel',                  he: 'דלק'           } },
      { id: 'parking',               name: { en: 'Parking',               he: 'חניה'          } },
      { id: 'toll_roads',            name: { en: 'Toll Roads',            he: 'כבישי אגרה'    } },
      { id: 'public_transportation', name: { en: 'Public Transportation', he: 'תחבורה ציבורית' } },
      { id: 'taxis',                 name: { en: 'Taxis',                 he: 'מוניות'        } },
    ],
  },
  {
    id: 'health',
    emoji: '🏥',
    name: { en: 'Health', he: 'בריאות' },
    subcategories: [
      { id: 'doctors',             name: { en: 'Doctors',             he: 'רופאים'         } },
      { id: 'medicine',            name: { en: 'Medicine',            he: 'תרופות'         } },
      { id: 'dental_treatments',   name: { en: 'Dental Treatments',   he: 'טיפולי שיניים'  } },
      { id: 'medical_insurance',   name: { en: 'Medical Insurance',   he: 'ביטוח בריאות'   } },
    ],
  },
  {
    id: 'personal_shopping',
    emoji: '👕',
    name: { en: 'Personal Shopping', he: 'קניות אישיות' },
    subcategories: [
      { id: 'clothing',       name: { en: 'Clothing',       he: 'בגדים'          } },
      { id: 'shoes',          name: { en: 'Shoes',          he: 'נעליים'         } },
      { id: 'personal_care',  name: { en: 'Personal Care',  he: 'טיפוח אישי'     } },
      { id: 'haircut',        name: { en: 'Haircut',        he: 'תספורת'         } },
    ],
  },
  {
    id: 'home_expenses',
    emoji: '🏠',
    name: { en: 'Home Expenses', he: 'הוצאות בית' },
    subcategories: [
      { id: 'electricity',     name: { en: 'Electricity',     he: 'חשמל'      } },
      { id: 'water',           name: { en: 'Water',           he: 'מים'        } },
      { id: 'internet',        name: { en: 'Internet',        he: 'אינטרנט'   } },
      { id: 'municipal_tax',   name: { en: 'Municipal Tax',   he: 'ארנונה'    } },
      { id: 'home_equipment',  name: { en: 'Home Equipment',  he: 'ציוד לבית' } },
    ],
  },
  {
    id: 'travel_vacations',
    emoji: '✈️',
    name: { en: 'Travel & Vacations', he: 'נסיעות וחופשות' },
    subcategories: [
      { id: 'flights',            name: { en: 'Flights',            he: 'טיסות'         } },
      { id: 'hotels',             name: { en: 'Hotels',             he: 'מלונות'        } },
      { id: 'travel_insurance',   name: { en: 'Travel Insurance',   he: 'ביטוח נסיעות'  } },
      { id: 'travel_attractions', name: { en: 'Attractions',        he: 'אטרקציות בחו"ל' } },
      { id: 'shopping_abroad',    name: { en: 'Shopping Abroad',    he: 'קניות בחו"ל'   } },
    ],
  },
  {
    id: 'finance_investments',
    emoji: '💰',
    name: { en: 'Finance & Investments', he: 'פיננסים והשקעות' },
    subcategories: [
      { id: 'investments',       name: { en: 'Investments',       he: 'השקעות'        } },
      { id: 'bank_fees',         name: { en: 'Bank Fees',         he: 'עמלות בנק'     } },
      { id: 'credit_card_fees',  name: { en: 'Credit Card Fees',  he: 'עמלות אשראי'   } },
      { id: 'interest',          name: { en: 'Interest',          he: 'ריבית'         } },
      { id: 'taxes',             name: { en: 'Taxes',             he: 'מיסים'         } },
    ],
  },
  {
    id: 'learning_development',
    emoji: '🎓',
    name: { en: 'Learning & Development', he: 'למידה והתפתחות' },
    subcategories: [
      { id: 'learning_courses',     name: { en: 'Courses',             he: 'קורסים'           } },
      { id: 'professional_books',   name: { en: 'Professional Books',  he: 'ספרי מקצוע'       } },
      { id: 'certifications',       name: { en: 'Certifications',      he: 'הסמכות'           } },
    ],
  },
  {
    id: 'miscellaneous',
    emoji: '📦',
    name: { en: 'Miscellaneous', he: 'שונות' },
    subcategories: [
      { id: 'uncategorized', name: { en: 'Uncategorized Expenses', he: 'הוצאות לא מסווגות' } },
    ],
  },
];

// ─────────────────────────────────────────
//  LOOKUP HELPERS
// ─────────────────────────────────────────

const _CATEGORY_BY_ID = new Map(EXPENSE_CATEGORIES.map(c => [c.id, c]));
const _SUBCATEGORY_TO_CATEGORY = new Map();
for (const cat of EXPENSE_CATEGORIES) {
  for (const sub of cat.subcategories) {
    _SUBCATEGORY_TO_CATEGORY.set(sub.id, { category: cat, subcategory: sub });
  }
}

export function getCategoryById(id) {
  return id ? _CATEGORY_BY_ID.get(id) || null : null;
}

export function getSubcategoryById(id) {
  if (!id) return null;
  const hit = _SUBCATEGORY_TO_CATEGORY.get(id);
  return hit ? hit.subcategory : null;
}

// Convenience for the row renderer: return both the category and the
// subcategory in one call (the row needs the parent's emoji + the
// child's name to display "🍔 Restaurants").
export function resolveCharge(categoryId, subcategoryId) {
  const sub = subcategoryId ? _SUBCATEGORY_TO_CATEGORY.get(subcategoryId) : null;
  if (sub) return sub;
  const cat = categoryId ? _CATEGORY_BY_ID.get(categoryId) : null;
  return cat ? { category: cat, subcategory: null } : null;
}

// Helper for the i18n-aware display layer. Caller passes currentLang
// once and gets back ready-to-render strings.
export function categoryDisplay(categoryId, lang) {
  const cat = getCategoryById(categoryId);
  if (!cat) return null;
  return { emoji: cat.emoji, name: cat.name[lang] || cat.name.en };
}

export function subcategoryDisplay(subcategoryId, lang) {
  const sub = getSubcategoryById(subcategoryId);
  if (!sub) return null;
  return { name: sub.name[lang] || sub.name.en };
}
