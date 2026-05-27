// ─────────────────────────────────────────────────────────────────
//  DISPLAY STATE — public demo dataset for `?v_display`
//
//  This file is loaded ONLY when the URL carries `?v_display`. The
//  real authenticated app never imports it. js/store.js short-circuits
//  loadData() to return a deep clone of DISPLAY_STATE in demo mode
//  and silently no-ops saveData(), so the demo session is fully
//  in-memory and reverts on refresh.
//
//  Every value here is fictional. Banks/providers are real public
//  Israeli institutions (logos already in the repo). Account numbers,
//  card last-4s, balances, holdings, transactions and recurring lines
//  are invented for display purposes only — they intentionally do NOT
//  resemble the app owner's real portfolio (different composition,
//  different totals, different cards, different cadence).
//
//  Two exports:
//    DISPLAY_STATE  — the FINANCIAL_STATE-shaped dataset (every page
//                     renders from this in demo mode).
//    DEMO_AI        — the pre-baked AI surface for the Intelligence
//                     page (insightSurface + assistantQA, bilingual).
//                     Avoids any /api/ai/* calls in demo mode.
// ─────────────────────────────────────────────────────────────────

export const DISPLAY_STATE = {

  meta: {
    name:        'דמו',
    nameEn:      'Demo',
    currency:    'ILS',
    lastUpdated: '2026-05-20',
    version:      5,
    // Birth year drives the `age` field on the Intelligence page —
    // here we synthesize a fictional 31-year-old viewer.
    birthYear:   1994,
  },

  rates: { USD: 3.68, EUR: 3.98, GBP: 4.65 },

  salary: {
    netAmount:  18500,
    currency:   'ILS',
    toEntryId:  'acct-discount-checking',
    depositDay: 9,
    employer: { he: 'מעסיק לדוגמה', en: 'Sample Employer Ltd.' },
    notes: null,
  },

  banks: [
    {
      id:        'discount',
      name:      'בנק דיסקונט',
      nameEn:    'Bank Discount',
      branch:    '076',
      location:  'תל אביב',
      logo:      'assets/logos/discount.png',
      isPrimary: true,
    },
    {
      id:        'mizrahi',
      name:      'מזרחי טפחות',
      nameEn:    'Mizrahi Tefahot',
      branch:    '418',
      location:  'הרצליה',
      logo:      'assets/logos/mizrahi.png',
      isPrimary: false,
    },
  ],

  providers: [
    {
      id:     'migdal',
      name:   'מגדל',
      nameEn: 'Migdal',
      logo:   'assets/logos/migdal_logo.png',
    },
    {
      id:     'phoenix',
      name:   'הפניקס',
      nameEn: 'The Phoenix',
      logo:   'assets/logos/phoenix_logo.png',
    },
    {
      id:     'yelin',
      name:   'ילין לפידות',
      nameEn: 'Yelin Lapidot',
      logo:   'assets/logos/yelin_logo.png',
    },
    {
      id:     'meitav',
      name:   'מיטב',
      nameEn: 'Meitav',
      logo:   'assets/logos/meitav_logo.png',
    },
    {
      id:     'idf',
      name:   'צה״ל',
      nameEn: 'IDF',
      logo:   'assets/logos/idf.jpg',
    },
  ],

  portfolios: [
    {
      id:         'meitav',
      providerId: 'meitav',
      name:       'מיטב טרייד',
      nameEn:     'Meitav Trade',
      broker:     'Meitav',
      type:       'self_managed',
      isPrimary:  true,

      totalValue:         182000,
      totalInvested:      160000,
      totalGain:           22000,
      totalGainPercent:    13.75,

      cashAvailable:        2400,

      dailyChange:         null,
      dailyChangePercent:  null,

      currency:  'ILS',
      isActive:   true,
      updatedAt: '2026-05-20',
    },
  ],

  entries: [

    // ─── Liquid: physical cash ───
    {
      id:          'cash-physical',
      name:        'מזומן',
      nameEn:      'Cash',
      institution: null,
      bankId:       null,
      type:        'cash',
      category:    'liquid',
      tier:        'available',
      balance:      820,
      currentValue: null,
      currency:    'ILS',
      isCash:       true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
      charges: [
        { id: 'cash-1', amount: 200.00, direction: 'in',  date: '2026-05-10', description: 'משיכת כספומט', incomeCategoryId: 'transfer' },
        { id: 'cash-2', amount:  38.00, direction: 'out', date: '2026-05-08', merchant: 'מכולת השכונה',           categoryId: 'food_drinks', subcategoryId: 'supermarket' },
        { id: 'cash-3', amount:  40.00, direction: 'out', date: '2026-05-13', merchant: 'דמי שירות',              description: 'תיקון אופניים', categoryId: 'miscellaneous', subcategoryId: 'uncategorized' },
        { id: 'cash-4', amount:  30.00, direction: 'out', date: '2026-05-15', merchant: 'מסעדה אסיאתית',           description: 'טיפ למלצר', categoryId: 'food_drinks', subcategoryId: 'restaurants' },
        { id: 'cash-5', amount:  14.00, direction: 'out', date: '2026-05-17', merchant: 'קיוסק',                  description: 'קפה ועוגייה', categoryId: 'food_drinks', subcategoryId: 'coffee_shops' },
        { id: 'cash-6', amount:  25.00, direction: 'out', date: '2026-05-19', merchant: 'חניון רחוב',             categoryId: 'transportation', subcategoryId: 'parking' },
      ],
    },

    // ─── Liquid: digital wallets ───
    {
      id:           'wallet-bit',
      name:         'Bit',
      nameEn:       'Bit',
      institution:  null,
      bankId:       null,
      type:         'digital_wallet',
      category:     'liquid',
      tier:         'available',
      balance:       340,
      currentValue: null,
      currency:     'ILS',
      isWallet:     true,
      isActive:     true,
      isLiability:  false,
      logo:         'assets/logos/bit_logo.png',
      updatedAt:    '2026-05-20',
      charges: [
        { id: 'bit-1', amount:  65.00, direction: 'out', date: '2026-05-07', merchant: 'נגה',    description: 'תשלום ביט לנגה',           categoryId: 'entertainment',  subcategoryId: 'friends_social' },
        { id: 'bit-2', amount:  90.00, direction: 'in',  date: '2026-05-10', merchant: 'איתי',   description: 'החזר חלוקת הוצאות',         incomeCategoryId: 'refund' },
        { id: 'bit-3', amount: 300.00, direction: 'out', date: '2026-05-12', merchant: 'אבא',    description: 'מתנה ליום הולדת',            categoryId: 'gifts_events',   subcategoryId: 'birthdays' },
        { id: 'bit-4', amount: 120.00, direction: 'out', date: '2026-05-15', merchant: 'יונתן',  description: 'תשלום ביט ליונתן',           categoryId: 'entertainment',  subcategoryId: 'friends_social' },
        { id: 'bit-5', amount:  35.00, direction: 'in',  date: '2026-05-17', merchant: 'אורי',   description: 'החזר מאורי — מונית משותפת', incomeCategoryId: 'refund' },
        { id: 'bit-6', amount:  80.00, direction: 'out', date: '2026-05-19', merchant: 'נועה',   description: 'העברה לנועה — ארוחת ערב משותפת', categoryId: 'food_drinks', subcategoryId: 'restaurants' },
      ],
    },
    {
      id:           'wallet-paybox',
      name:         'Paybox',
      nameEn:       'Paybox',
      institution:  null,
      bankId:       null,
      type:         'digital_wallet',
      category:     'liquid',
      tier:         'available',
      balance:       180,
      currentValue: null,
      currency:     'ILS',
      isWallet:     true,
      isActive:     true,
      isLiability:  false,
      logo:         'assets/logos/paybox_logo.jpg',
      updatedAt:    '2026-05-20',
      charges: [
        { id: 'pbx-1', amount:  50.00, direction: 'out', date: '2026-05-05', merchant: 'דנה',                  description: 'העברה לדנה',                       categoryId: 'entertainment', subcategoryId: 'friends_social' },
        { id: 'pbx-2', amount:  80.00, direction: 'out', date: '2026-05-09', merchant: 'השתתפות במתנה',         description: 'מתנה משותפת לחתונה',                categoryId: 'gifts_events',  subcategoryId: 'weddings' },
        { id: 'pbx-3', amount:  45.00, direction: 'in',  date: '2026-05-14', merchant: 'קופה משותפת',           description: 'החזר מהקופה',                       incomeCategoryId: 'refund' },
        { id: 'pbx-4', amount: 150.00, direction: 'out', date: '2026-05-18', merchant: 'קופה משותפת',           description: 'Paybox — קופה לארוחת חברים',         categoryId: 'food_drinks',   subcategoryId: 'restaurants' },
      ],
    },

    // ─── Liquid: checking ───
    {
      id:          'acct-discount-checking',
      name:        'עו"ש',
      nameEn:      'Checking',
      institution: 'בנק דיסקונט',
      bankId:      'discount',
      type:        'checking',
      category:    'liquid',
      tier:        'available',
      balance:     22400,
      currentValue: null,
      currency:    'ILS',
      isPrimary:    true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
    },
    {
      id:          'acct-mizrahi-checking',
      name:        'עו"ש',
      nameEn:      'Checking',
      institution: 'מזרחי טפחות',
      bankId:      'mizrahi',
      type:        'checking',
      category:    'liquid',
      tier:        'available',
      balance:      3200,
      currentValue: null,
      currency:    'ILS',
      isPrimary:    false,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
    },

    // ─── Liquid: USD cash sleeve ───
    {
      id:          'cash-usd',
      name:        'מזומן דולרי',
      nameEn:      'USD cash',
      institution: 'בנק דיסקונט',
      bankId:      'discount',
      type:        'cash',
      category:    'liquid',
      tier:        'available',
      balance:      1200,
      currentValue: null,
      currency:    'USD',
      isCash:       true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
    },

    // ─── Semi-liquid: brokerage holdings (US broad index leaning) ───
    {
      id:                 'inv-meitav-voo',
      name:               'Vanguard S&P 500 (VOO)',
      nameEn:             'Vanguard S&P 500 (VOO)',
      institution:        'Meitav',
      portfolioId:        'meitav',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_equity',
      balance:             null,
      currentValue:        82000,
      invested:            72000,
      ticker:             'VOO',
      quantity:             45,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-20',
    },
    {
      id:                 'inv-meitav-vt',
      name:               'Vanguard Total World (VT)',
      nameEn:             'Vanguard Total World (VT)',
      institution:        'Meitav',
      portfolioId:        'meitav',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'global_equity',
      balance:             null,
      currentValue:        46000,
      invested:            41000,
      ticker:             'VT',
      quantity:            148,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-20',
    },
    {
      id:                 'inv-meitav-vea',
      name:               'Vanguard Developed Markets (VEA)',
      nameEn:             'Vanguard Developed Markets (VEA)',
      institution:        'Meitav',
      portfolioId:        'meitav',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'developed_ex_us',
      balance:             null,
      currentValue:        18000,
      invested:            16500,
      ticker:             'VEA',
      quantity:             80,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-20',
    },
    {
      id:                 'inv-meitav-agg',
      name:               'iShares Core Aggregate Bond (AGG)',
      nameEn:             'iShares Core Aggregate Bond (AGG)',
      institution:        'Meitav',
      portfolioId:        'meitav',
      bankId:              null,
      type:               'bond',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'bonds',
      balance:             null,
      currentValue:        28000,
      invested:            28500,
      ticker:             'AGG',
      quantity:             92,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-20',
    },
    {
      id:                 'inv-meitav-btc',
      name:               'Bitcoin sleeve',
      nameEn:             'Bitcoin sleeve',
      institution:        'Meitav',
      portfolioId:        'meitav',
      bankId:              null,
      type:               'crypto',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'crypto',
      balance:             null,
      currentValue:         8000,
      invested:             4200,
      ticker:             'BTC',
      quantity:            0.045,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-20',
    },

    // ─── Non-liquid: locked savings ───
    {
      id:          'sav-discount-locked',
      name:        'פיקדון נעול 12 חודשים',
      nameEn:      'Locked Deposit (12mo)',
      institution: 'בנק דיסקונט',
      bankId:      'discount',
      portfolioId:  null,
      type:        'savings',
      category:    'non_liquid',
      tier:        'available',
      balance:      null,
      currentValue: 18000,
      invested:     18000,
      profit:        420,
      maturityDate: '2026-11-09',
      currency:    'ILS',
      isLocked:     true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
    },

    // ─── Non-liquid: pension (Migdal) ───
    {
      id:          'pension-migdal',
      name:        'קרן פנסיה',
      nameEn:      'Pension Fund',
      institution: 'מגדל',
      providerId:  'migdal',
      bankId:       null,
      portfolioId:  null,
      type:        'pension',
      category:    'non_liquid',
      tier:        'future_wealth',
      balance:      null,
      currentValue: 184000,
      invested:     null,
      tracks: [
        { name: 'מסלול מניות',           nameEn: 'Stocks Track',         value: 138000, fee: 0.34 },
        { name: 'מסלול עוקב S&P 500',    nameEn: 'S&P 500 Tracking',    value:  46000, fee: 0.45 },
      ],
      currency:    'ILS',
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-20',
    },

    // ─── Non-liquid: study fund (Phoenix) ───
    {
      id:           'study-phoenix',
      name:         'קרן השתלמות',
      nameEn:       'Study Fund',
      institution:  'הפניקס',
      providerId:   'phoenix',
      bankId:        null,
      portfolioId:   null,
      type:         'study_fund',
      category:     'non_liquid',
      tier:         'future_wealth',
      balance:       null,
      currentValue:  72000,
      invested:      null,
      trackName:    'מסלול מנייתי',
      trackNameEn:  'Equity Track',
      maturityDate: '2027-08-01',
      currency:     'ILS',
      isActive:      true,
      isLiability:   false,
      updatedAt:    '2026-05-20',
    },

    // ─── Non-liquid: investment gemel (Yelin) ───
    {
      id:                'inv-gemel-yelin',
      name:              'גמל להשקעה',
      nameEn:            'Investment Provident Fund',
      institution:       'ילין לפידות',
      providerId:        'yelin',
      bankId:             null,
      portfolioId:        null,
      type:              'investment_gemel',
      category:          'non_liquid',
      tier:              'future_wealth',
      balance:            null,
      currentValue:       42000,
      invested:           null,
      trackName:         'מסלול מנייתי כללי',
      trackNameEn:       'General Equity Track',
      description: {
        he: 'פטור ממס בפרישה',
        en: 'Tax-exempt at retirement',
      },
      annualLimit:        81000,
      yearlyDeposited:    24000,
      remainingAllowance: 57000,
      limitReferenceDate:'2026-05-20',
      currency:          'ILS',
      isActive:           true,
      isLiability:        false,
      updatedAt:         '2026-05-20',
    },

    // ─── Non-liquid: military discharge deposit ───
    {
      id:                    'military-discharge-deposit',
      name:                  'פיקדון צבאי',
      nameEn:                'Military Deposit',
      institution:            null,
      providerId:            'idf',
      bankId:                 null,
      portfolioId:            null,
      type:                  'military_deposit',
      category:              'non_liquid',
      tier:                  'future_deposits',
      balance:                null,
      currentValue:           14500,
      invested:               null,
      maturityDate:          '2027-03-01',
      maturityDateEstimated:  true,
      currency:              'ILS',
      isActive:               true,
      isLiability:            false,
      updatedAt:             '2026-05-20',
    },

  ],

  cards: [
    {
      id:              'card-demo-discount-credit',
      name:            'דיסקונט פלטינום',
      nameEn:          'Discount Platinum',
      club:            null,
      network:         'mastercard',
      tier:            'platinum',
      cardType:        'bank',
      bankId:          'discount',
      institution:     'בנק דיסקונט',
      last4:           '5821',
      skin:            'black',
      expiry:          '08/2029',
      creditLimit:     22000,
      currentSpending:  6420,
      billingDay:      9,
      nextBilling:     '2026-06-09',
      isDebit:         false,
      fees: {
        foreignTxn:  { eur: 1.20, usd: 1.20, other: 1.20 },
        foreignCash: { eur: 3.50, usd: 3.50, other: 3.50 },
      },
      isActive:        true,
      image:           null,
      updatedAt:       '2026-05-20',
      // 28 charges across the May cycle. Sum matches currentSpending
      // (6420.00). Mix: groceries, restaurants/coffee, fuel/parking,
      // delivery, pharmacy, subscriptions, electronics, clothing,
      // cinema — so the spending breakdown looks meaningful.
      charges: [
        { id: 'chg-d-01', amount:  32.00, date: '2026-05-01', time: '08:42', merchant: 'Cofix',              description: 'חטיף בוקר',                  categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-02', amount: 487.30, date: '2026-05-02', time: '10:15', merchant: 'שופרסל',             description: 'קניות שבוע',                  categoryId: 'food_drinks',       subcategoryId: 'supermarket' },
        { id: 'chg-d-03', amount: 318.00, date: '2026-05-03', time: '17:22', merchant: 'דלק פז',             description: 'מילוי דלק',                   categoryId: 'transportation',    subcategoryId: 'fuel' },
        { id: 'chg-d-04', amount:  38.00, date: '2026-05-04', time: '09:30', merchant: 'ארומה',              description: 'קפה הפוך וקרואסון',         categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-05', amount:  22.00, date: '2026-05-04', time: '14:05', merchant: 'חניון העיר',         description: 'חניה במרכז',                   categoryId: 'transportation',    subcategoryId: 'parking' },
        { id: 'chg-d-06', amount: 184.50, date: '2026-05-05', time: '20:48', merchant: 'Wolt',                description: 'משלוח מסעדה תאילנדית',       categoryId: 'food_drinks',       subcategoryId: 'delivery' },
        { id: 'chg-d-07', amount: 142.80, date: '2026-05-06', time: '11:18', merchant: 'סופר-פארם',           description: 'תרופות וטיפוח',                categoryId: 'health',            subcategoryId: 'medicine' },
        { id: 'chg-d-08', amount: 412.00, date: '2026-05-07', time: '21:10', merchant: 'מסעדה דאלמא',         description: 'ארוחת ערב עם רעות',             categoryId: 'food_drinks',       subcategoryId: 'restaurants' },
        { id: 'chg-d-09', amount:  49.90, date: '2026-05-08',                merchant: 'Spotify',             description: 'מנוי משפחתי חודשי',           categoryId: 'subscriptions',     subcategoryId: 'fitness_sports_sub' },
        { id: 'chg-d-10', amount:  64.50, date: '2026-05-09', time: '08:50', merchant: 'Cafe Landwer',        description: 'קפה עם לקוח',                  categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-11', amount: 425.00, date: '2026-05-10', time: '19:30', merchant: 'Zara',                description: 'חולצה ומכנסיים',                categoryId: 'personal_shopping', subcategoryId: 'clothing' },
        { id: 'chg-d-12', amount: 538.20, date: '2026-05-11', time: '18:42', merchant: 'רמי לוי',             description: 'קניות שבוע',                    categoryId: 'food_drinks',       subcategoryId: 'supermarket' },
        { id: 'chg-d-13', amount:  48.00, date: '2026-05-12', time: '12:18', merchant: 'חניון תל אביב',       description: 'חניה ארוכה',                    categoryId: 'transportation',    subcategoryId: 'parking' },
        { id: 'chg-d-14', amount: 295.00, date: '2026-05-13', time: '08:07', merchant: 'דלק סונול',            description: 'מילוי דלק',                     categoryId: 'transportation',    subcategoryId: 'fuel' },
        { id: 'chg-d-15', amount: 218.40, date: '2026-05-14', time: '20:55', merchant: 'Wolt',                 description: 'משלוח סושי',                    categoryId: 'food_drinks',       subcategoryId: 'delivery' },
        { id: 'chg-d-16', amount: 365.00, date: '2026-05-15', time: '17:40', merchant: 'H&M',                  description: 'בגדי קיץ',                       categoryId: 'personal_shopping', subcategoryId: 'clothing' },
        { id: 'chg-d-17', amount: 489.00, date: '2026-05-15', time: '19:12', merchant: 'IKEA',                 description: 'מנורת קריאה',                   categoryId: 'home_expenses',     subcategoryId: 'home_equipment' },
        { id: 'chg-d-18', amount:  36.00, date: '2026-05-16', time: '09:05', merchant: 'Cofix',                description: 'בוקר קצר',                       categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-19', amount:  42.00, date: '2026-05-17', time: '08:32', merchant: 'ארומה',                description: 'קפה ועוגיה',                     categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-20', amount: 412.60, date: '2026-05-17', time: '11:48', merchant: 'שופרסל',              description: 'קניות לאמצע שבוע',              categoryId: 'food_drinks',       subcategoryId: 'supermarket' },
        { id: 'chg-d-21', amount:  84.00, date: '2026-05-18', time: '10:22', merchant: 'בית קפה מזל',          description: 'קפה ומאפה',                       categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-22', amount: 188.00, date: '2026-05-18', time: '21:25', merchant: 'יס פלאנט',             description: 'סרט עם בני',                      categoryId: 'entertainment',     subcategoryId: 'cinema' },
        { id: 'chg-d-23', amount: 162.40, date: '2026-05-19', time: '20:14', merchant: 'דומינוס פיצה',         description: 'הזמנה בערב',                      categoryId: 'food_drinks',       subcategoryId: 'delivery' },
        { id: 'chg-d-24', amount:  38.00, date: '2026-05-19', time: '22:02', merchant: 'חניון דיזנגוף',         description: 'חניה ליציאה',                     categoryId: 'transportation',    subcategoryId: 'parking' },
        { id: 'chg-d-25', amount: 287.90, date: '2026-05-20', time: '20:48', merchant: 'מסעדת ביסטרו 56',       description: 'ארוחת ערב חברים',                 categoryId: 'food_drinks',       subcategoryId: 'restaurants' },
        { id: 'chg-d-26', amount:  41.50, date: '2026-05-20', time: '08:20', merchant: 'ארומה',                description: 'קפה',                              categoryId: 'food_drinks',       subcategoryId: 'coffee_shops' },
        { id: 'chg-d-27', amount: 698.00, date: '2026-05-19', time: '14:30', merchant: 'נילי רהיטים',          description: 'כיסא משרדי',                      categoryId: 'home_expenses',     subcategoryId: 'home_equipment' },
        { id: 'chg-d-28', amount: 300.00, date: '2026-05-20', time: '13:08', merchant: 'מסעדת קלרו',           description: 'ארוחת צהריים',                    categoryId: 'food_drinks',       subcategoryId: 'restaurants' },
      ],
    },
    {
      id:              'card-demo-max-visa',
      name:            'מקס ויזה אינפיניט',
      nameEn:          'MAX Visa Infinite',
      club:            null,
      network:         'visa',
      tier:            'gold',
      cardType:        'international',
      bankId:          null,
      institution:     'MAX',
      last4:           '7203',
      skin:            'blue',
      expiry:          '04/2031',
      creditLimit:     18000,
      currentSpending:  3540,
      billingDay:      2,
      nextBilling:     '2026-06-02',
      isDebit:         false,
      fees: {
        foreignTxn:  { eur: 0.95, usd: 0.95, other: 0.95 },
        foreignCash: { eur: 3.20, usd: 3.20, other: 3.20 },
      },
      isActive:        true,
      image:           null,
      updatedAt:       '2026-05-20',
      // 8 charges across the cycle (sum = 3540.00, matches
      // currentSpending). The MAX card carries the travel + subscriptions
      // bucket so the Discount card stays grounded in everyday flow.
      charges: [
        { id: 'chg-m-1', amount:   78.00, date: '2026-04-29',                merchant: 'ChatGPT Plus',         description: 'מנוי חודשי',                       categoryId: 'subscriptions',  subcategoryId: 'ai' },
        { id: 'chg-m-2', amount:  156.00, date: '2026-05-04', time: '20:14', merchant: 'Wolt',                 description: 'הזמנה משותפת — חברים',           categoryId: 'food_drinks',    subcategoryId: 'delivery' },
        { id: 'chg-m-3', amount: 1488.00, date: '2026-05-06', time: '15:42', merchant: 'IKEA',                 description: 'מדפים + מנורת רצפה',              categoryId: 'home_expenses',  subcategoryId: 'home_equipment' },
        { id: 'chg-m-4', amount:  660.00, date: '2026-05-09',                merchant: 'Booking.com',          description: 'מקדמה למלון באתונה',              categoryId: 'travel_vacations', subcategoryId: 'hotels' },
        { id: 'chg-m-5', amount:   54.00, date: '2026-05-11', time: '08:45', merchant: 'Cafe Landwer',         description: 'קפה עם לקוח',                      categoryId: 'food_drinks',    subcategoryId: 'coffee_shops' },
        { id: 'chg-m-6', amount:  198.00, date: '2026-05-14', time: '17:18', merchant: 'Steimatzky',           description: 'ספר לטיסה',                          categoryId: 'hobbies',        subcategoryId: 'books' },
        { id: 'chg-m-7', amount:   46.00, date: '2026-05-17', time: '08:32', merchant: 'ארומה תל אביב',         description: 'קפה',                                categoryId: 'food_drinks',    subcategoryId: 'coffee_shops' },
        { id: 'chg-m-8', amount:  860.00, date: '2026-05-18', time: '13:00', merchant: 'El Al',                description: 'טיסה לאתונה — מחצית מחיר',         categoryId: 'travel_vacations', subcategoryId: 'flights' },
      ],
    },
    {
      id:              'card-demo-debit',
      name:            'כרטיס חיוב מיידי',
      nameEn:          'Debit Card',
      club:            null,
      network:         'mastercard',
      tier:            'standard',
      cardType:        'bank',
      bankId:          'mizrahi',
      institution:     'מזרחי טפחות',
      last4:           '4960',
      skin:            'red',
      expiry:          '11/2028',
      creditLimit:     null,
      currentSpending: null,
      billingDay:      null,
      nextBilling:     null,
      isDebit:         true,
      isActive:        true,
      image:           null,
      updatedAt:       '2026-05-20',
      charges: [],
    },
  ],

  recurring: [
    {
      id:          'rec-disp-rent',
      name:        'שכר דירה',
      nameEn:      'Rent',
      amount:       5400,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'fixed_expense',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-electricity',
      name:        'הוראת קבע — חשמל',
      nameEn:      'Electricity standing order',
      amount:        360,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'fixed_expense',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-water',
      name:        'הוראת קבע — מים',
      nameEn:      'Water standing order',
      amount:        180,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'fixed_expense',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-arnona',
      name:        'הוראת קבע — ארנונה',
      nameEn:      'Municipal tax standing order',
      amount:        260,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'fixed_expense',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-internet',
      name:        'הוראת קבע — בזק אינטרנט',
      nameEn:      'Bezeq internet',
      amount:        169,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'subscription',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-phone',
      name:        'הוראת קבע — חברת סלולר',
      nameEn:      'Mobile carrier',
      amount:         85,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'subscription',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-gym',
      name:        'מנוי חדר כושר',
      nameEn:      'Gym subscription',
      amount:        199,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'subscription',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-health-insurance',
      name:        'ביטוח בריאות משלים',
      nameEn:      'Supplementary health insurance',
      amount:        145,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   null,
      type:        'insurance',
      currency:    'ILS',
      isActive:     true,
    },
    {
      id:          'rec-disp-gemel',
      name:        'הפקדה חודשית — גמל להשקעה',
      nameEn:      'Monthly contribution — Investment Gemel',
      amount:       1500,
      cycle:       'monthly',
      fromBankId:  'discount',
      toEntryId:   'inv-gemel-yelin',
      type:        'investment_contribution',
      currency:    'ILS',
      isActive:     true,
    },
  ],

  // Bank-transaction stream for the demo. Registered against the
  // Discount checking account so the Activity / Transactions pages
  // render two months of realistic monthly cadence: salary in, card
  // settlements out, standing orders, investment contribution, the
  // occasional Bit transfer and an interest credit. Every entry is
  // `source: 'manual'` so the import-dedup pass leaves them alone.
  bankAccounts: [
    {
      id:             'bank-discount-076-3854',
      bankId:         'discount',
      branch:         '076',
      accountNumber:  '3854',
      ownerName:      'דמו',
      lastImportedAt: '2026-05-20',
    },
  ],

  bankTransactions: [
    // ── May 2026 ─────────────────────────────────────────────────
    { id: 'bt-disp-2026-05-01-rent',   source: 'manual', date: '2026-05-01', direction: 'debit',  amount: 5400.00, description: 'הוראת קבע — שכר דירה',                  type: 'outgoing_transfer',     icon: '🏠', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'home_equipment' },
    { id: 'bt-disp-2026-05-02-max',    source: 'manual', date: '2026-05-02', direction: 'debit',  amount: 2680.00, description: 'חיוב MAX ויזה אינפיניט',                type: 'card_settlement',       icon: '💳', isRecurring: true,  isInternal: false },
    { id: 'bt-disp-2026-05-02-gym',    source: 'manual', date: '2026-05-02', direction: 'debit',  amount:  199.00, description: 'הוראת קבע — מנוי חדר כושר',             type: 'direct_debit_charge',   icon: '💪', isRecurring: true,  isInternal: false, categoryId: 'fitness_sports', subcategoryId: 'gym' },
    { id: 'bt-disp-2026-05-05-elec',   source: 'manual', date: '2026-05-05', direction: 'debit',  amount:  340.00, description: 'הוראת קבע — חשמל',                       type: 'direct_debit_charge',   icon: '💡', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'electricity' },
    { id: 'bt-disp-2026-05-07-water',  source: 'manual', date: '2026-05-07', direction: 'debit',  amount:  180.00, description: 'הוראת קבע — מים',                        type: 'direct_debit_charge',   icon: '💧', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'water' },
    { id: 'bt-disp-2026-05-08-arnona', source: 'manual', date: '2026-05-08', direction: 'debit',  amount:  260.00, description: 'הוראת קבע — ארנונה',                     type: 'direct_debit_charge',   icon: '🏛', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'municipal_tax' },
    { id: 'bt-disp-2026-05-09-salary', source: 'manual', date: '2026-05-09', direction: 'credit', amount:18500.00, description: 'משכורת חודשית',                          type: 'salary',                icon: '💼', isRecurring: true,  isInternal: false, incomeCategoryId: 'salary' },
    { id: 'bt-disp-2026-05-09-disct',  source: 'manual', date: '2026-05-09', direction: 'debit',  amount: 5870.00, description: 'חיוב כרטיס אשראי דיסקונט פלטינום',     type: 'card_settlement',       icon: '💳', isRecurring: true,  isInternal: false },
    { id: 'bt-disp-2026-05-09-phone',  source: 'manual', date: '2026-05-09', direction: 'debit',  amount:   85.00, description: 'הוראת קבע — חברת סלולר',                type: 'direct_debit_charge',   icon: '📱', isRecurring: true,  isInternal: false, categoryId: 'subscriptions', subcategoryId: 'fitness_sports_sub' },
    { id: 'bt-disp-2026-05-10-int',    source: 'manual', date: '2026-05-10', direction: 'debit',  amount:  169.00, description: 'הוראת קבע — בזק אינטרנט',                type: 'direct_debit_charge',   icon: '🌐', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'internet' },
    { id: 'bt-disp-2026-05-11-meitav', source: 'manual', date: '2026-05-11', direction: 'debit',  amount: 1500.00, description: 'העברה לחשבון השקעות מיטב',              type: 'investment_contribution', icon: '📈', isRecurring: true,  isInternal: true },
    { id: 'bt-disp-2026-05-12-bit-in', source: 'manual', date: '2026-05-12', direction: 'credit', amount:  240.00, description: 'Bit — העברה נכנסת מאורי',                type: 'bit_transfer',          icon: '⚡', isRecurring: false, isInternal: false, incomeCategoryId: 'refund' },
    { id: 'bt-disp-2026-05-12-ins',    source: 'manual', date: '2026-05-12', direction: 'debit',  amount:  145.00, description: 'ביטוח בריאות משלים',                     type: 'insurance',             icon: '🛡', isRecurring: true,  isInternal: false, categoryId: 'health', subcategoryId: 'medical_insurance' },
    { id: 'bt-disp-2026-05-14-tomz',   source: 'manual', date: '2026-05-14', direction: 'debit',  amount:  800.00, description: 'העברה למזרחי טפחות',                     type: 'outgoing_transfer',     icon: '↗️', isRecurring: false, isInternal: true },
    { id: 'bt-disp-2026-05-16-refund', source: 'manual', date: '2026-05-16', direction: 'credit', amount:  320.00, description: 'זיכוי — החזר ביטוח רכב',                 type: 'refund',                icon: '🎉', isRecurring: false, isInternal: false, incomeCategoryId: 'refund' },
    { id: 'bt-disp-2026-05-18-in',     source: 'manual', date: '2026-05-18', direction: 'credit', amount:  550.00, description: 'העברה נכנסת — שירן',                     type: 'incoming_transfer',     icon: '↘️', isRecurring: false, isInternal: false, incomeCategoryId: 'transfer' },
    { id: 'bt-disp-2026-05-20-bitout', source: 'manual', date: '2026-05-20', direction: 'debit',  amount:   80.00, description: 'Bit — העברה לנועה',                       type: 'bit_transfer',          icon: '⚡', isRecurring: false, isInternal: false },

    // ── April 2026 ───────────────────────────────────────────────
    { id: 'bt-disp-2026-04-01-rent',   source: 'manual', date: '2026-04-01', direction: 'debit',  amount: 5400.00, description: 'הוראת קבע — שכר דירה',                  type: 'outgoing_transfer',     icon: '🏠', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'home_equipment' },
    { id: 'bt-disp-2026-04-02-max',    source: 'manual', date: '2026-04-02', direction: 'debit',  amount: 2410.00, description: 'חיוב MAX ויזה אינפיניט',                type: 'card_settlement',       icon: '💳', isRecurring: true,  isInternal: false },
    { id: 'bt-disp-2026-04-02-gym',    source: 'manual', date: '2026-04-02', direction: 'debit',  amount:  199.00, description: 'הוראת קבע — מנוי חדר כושר',             type: 'direct_debit_charge',   icon: '💪', isRecurring: true,  isInternal: false, categoryId: 'fitness_sports', subcategoryId: 'gym' },
    { id: 'bt-disp-2026-04-05-elec',   source: 'manual', date: '2026-04-05', direction: 'debit',  amount:  380.00, description: 'הוראת קבע — חשמל',                       type: 'direct_debit_charge',   icon: '💡', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'electricity' },
    { id: 'bt-disp-2026-04-07-water',  source: 'manual', date: '2026-04-07', direction: 'debit',  amount:  175.00, description: 'הוראת קבע — מים',                        type: 'direct_debit_charge',   icon: '💧', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'water' },
    { id: 'bt-disp-2026-04-08-arnona', source: 'manual', date: '2026-04-08', direction: 'debit',  amount:  260.00, description: 'הוראת קבע — ארנונה',                     type: 'direct_debit_charge',   icon: '🏛', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'municipal_tax' },
    { id: 'bt-disp-2026-04-09-salary', source: 'manual', date: '2026-04-09', direction: 'credit', amount:18500.00, description: 'משכורת חודשית',                          type: 'salary',                icon: '💼', isRecurring: true,  isInternal: false, incomeCategoryId: 'salary' },
    { id: 'bt-disp-2026-04-09-disct',  source: 'manual', date: '2026-04-09', direction: 'debit',  amount: 5240.00, description: 'חיוב כרטיס אשראי דיסקונט פלטינום',     type: 'card_settlement',       icon: '💳', isRecurring: true,  isInternal: false },
    { id: 'bt-disp-2026-04-09-phone',  source: 'manual', date: '2026-04-09', direction: 'debit',  amount:   85.00, description: 'הוראת קבע — חברת סלולר',                type: 'direct_debit_charge',   icon: '📱', isRecurring: true,  isInternal: false, categoryId: 'subscriptions', subcategoryId: 'fitness_sports_sub' },
    { id: 'bt-disp-2026-04-10-int',    source: 'manual', date: '2026-04-10', direction: 'debit',  amount:  169.00, description: 'הוראת קבע — בזק אינטרנט',                type: 'direct_debit_charge',   icon: '🌐', isRecurring: true,  isInternal: false, categoryId: 'home_expenses', subcategoryId: 'internet' },
    { id: 'bt-disp-2026-04-11-meitav', source: 'manual', date: '2026-04-11', direction: 'debit',  amount: 1500.00, description: 'העברה לחשבון השקעות מיטב',              type: 'investment_contribution', icon: '📈', isRecurring: true,  isInternal: true },
    { id: 'bt-disp-2026-04-12-ins',    source: 'manual', date: '2026-04-12', direction: 'debit',  amount:  145.00, description: 'ביטוח בריאות משלים',                     type: 'insurance',             icon: '🛡', isRecurring: true,  isInternal: false, categoryId: 'health', subcategoryId: 'medical_insurance' },
    { id: 'bt-disp-2026-04-14-bit',    source: 'manual', date: '2026-04-14', direction: 'debit',  amount:  150.00, description: 'Bit — תשלום ליונתן',                     type: 'bit_transfer',          icon: '⚡', isRecurring: false, isInternal: false },
    { id: 'bt-disp-2026-04-18-int+',   source: 'manual', date: '2026-04-18', direction: 'credit', amount:   28.00, description: 'ריבית זכות',                              type: 'interest',              icon: '💹', isRecurring: false, isInternal: false, incomeCategoryId: 'other_income' },
    { id: 'bt-disp-2026-04-20-fee',    source: 'manual', date: '2026-04-20', direction: 'debit',  amount:   18.00, description: 'עמלות בנק',                                type: 'fee',                   icon: '🧾', isRecurring: false, isInternal: false, categoryId: 'finance_investments', subcategoryId: 'bank_fees' },
    { id: 'bt-disp-2026-04-22-in',     source: 'manual', date: '2026-04-22', direction: 'credit', amount:  320.00, description: 'העברה נכנסת — שירן',                     type: 'incoming_transfer',     icon: '↘️', isRecurring: false, isInternal: false, incomeCategoryId: 'transfer' },
  ],

  deletedBankTxIds:    [],
  deletedBankTxKeys:   [],
  deletedChargeIds:    [],
};


// ─────────────────────────────────────────────────────────────────
//  DEMO_AI — pre-baked AI surface for the Intelligence page
//
//  Mirrors the normalized shape that /api/ai/insights returns (after
//  insights-normalize.js): { lang, generatedAt, portfolioRead,
//  summaryMetrics, riskSurface, cards }. Two language tracks (he/en)
//  because the AI prose is language-specific. The renderer picks the
//  one matching the current UI language.
//
//  assistantQA is consulted by askAssistant() in demo mode — the
//  user's question is matched (case-insensitive substring) against
//  each entry's `matches` array; first hit wins; otherwise the
//  fallback for that language is returned.
// ─────────────────────────────────────────────────────────────────

// `generatedAt` is computed at module-load so the "Updated X ago"
// line shows "just now" on the first paint of a fresh demo session.
const _GENERATED_AT = new Date().toISOString();

export const DEMO_AI = {

  insightSurface: {
    en: {
      lang: 'en',
      generatedAt: _GENERATED_AT,
      portfolioRead: {
        sentences: [
          'Most of your money — about 80% — sits in stocks, mostly through VOO and VT. The remaining ~14% is in bonds via AGG, with a small Bitcoin sleeve on top.',
          'Two holdings (VOO and VT) make up roughly 70% of the brokerage portfolio. Diversified by name, but the exposure underneath leans heavily on US large-cap.',
        ],
      },
      summaryMetrics: [
        { key: 'stocks',        label: 'in stocks' },
        { key: 'concentration', label: 'in top holdings' },
        { key: 'cash',          label: 'in cash' },
        { key: 'cashBuffer',    label: 'months of runway' },
      ],
      riskSurface: {
        volatility:      'A stock-heavy mix for a 31-year-old is normal — you have decades for drawdowns to recover.',
        concentration:   'Two ETFs carry most of the weight; the names diversify well but the underlying tilts hard to US large-cap.',
        diversification: 'Broad US + a global slice + bonds — a reasonable index-led shape, light on emerging markets and small-cap.',
        suitability:     'Equity-led growth matches a long horizon; the bond sleeve provides a small but real ballast.',
        liquidity:       'Several months of expenses sit in available cash and wallets — a comfortable buffer.',
      },
      insightCards: [
        {
          id:    'demo-vt-overlap',
          tier:  'priority',
          severity: 'notice',
          label: 'attention',
          confidence: 'high',
          title: 'VOO and VT overlap meaningfully',
          summary: 'VOO is the S&P 500. VT is a global fund that is roughly 60% the same US large-caps — so a chunk of your "diversification" is the same companies twice.',
          whyItMatters: 'Holding both can feel diversified while still leaving you concentrated in the same names underneath.',
          whatCouldImproveIt: 'If long-term simplicity matters, consolidating toward one of them and adding to VEA for ex-US exposure would sharpen the picture.',
          evidence: { kind: 'holdings', holdingsRef: ['Vanguard S&P 500 (VOO)', 'Vanguard Total World (VT)'] },
        },
        {
          id:    'demo-cash-buffer',
          tier:  'priority',
          severity: 'info',
          label: 'positive',
          confidence: 'high',
          title: 'Cash buffer looks healthy',
          summary: 'Across checking, wallets and physical cash you hold a comfortable few-month buffer of fixed expenses — enough breathing room without leaving the money lazy.',
          whyItMatters: 'Enough runway to absorb a job change or a slow stretch without forcing you to sell into a drawdown.',
          whatCouldImproveIt: null,
          evidence: null,
        },
        {
          id:    'demo-bonds-sleeve',
          tier:  'observation',
          severity: 'info',
          label: 'healthy',
          confidence: 'high',
          title: 'Bond sleeve is small but consistent',
          summary: 'AGG sits at roughly 14% of the brokerage — light by classic 60/40 standards but reasonable for a long horizon.',
          whyItMatters: 'Even a thin bond layer dampens portfolio volatility in sharp equity drawdowns.',
          whatCouldImproveIt: null,
          evidence: { kind: 'holdings', holdingsRef: ['iShares Core Aggregate Bond (AGG)'] },
        },
        {
          id:    'demo-btc-sleeve',
          tier:  'observation',
          severity: 'notice',
          label: 'attention',
          confidence: 'medium',
          title: 'Bitcoin sleeve is small but volatile',
          summary: 'About 4% of the brokerage is in a Bitcoin position — minor in size, but it carries outsized swing on monthly P&L.',
          whyItMatters: 'A 4% sleeve that moves ±30% in a quarter can dominate the look of returns even when the rest of the portfolio is calm.',
          whatCouldImproveIt: 'A pre-decided cap (e.g. trim back if it crosses 5–6% of the portfolio) keeps the volatility from creeping into a real allocation.',
          evidence: { kind: 'holdings', holdingsRef: ['Bitcoin sleeve'] },
        },
      ],
    },

    he: {
      lang: 'he',
      generatedAt: _GENERATED_AT,
      portfolioRead: {
        sentences: [
          'רוב הכסף שלך — בערך 80% — נמצא במניות, בעיקר דרך VOO ו־VT. כ־14% נוספים נמצאים באג"ח דרך AGG, ועוד פלח קטן בביטקוין.',
          'שני מוצרים (VOO ו־VT) מהווים יחד כ־70% מתיק ההשקעות בברוקר. מבחינת שמות זה מגוון, אבל החשיפה מתחת נשענת חזק על מניות גדולות בארה״ב.',
        ],
      },
      summaryMetrics: [
        { key: 'stocks',        label: 'במניות' },
        { key: 'concentration', label: 'בריכוז העליון' },
        { key: 'cash',          label: 'במזומן' },
        { key: 'cashBuffer',    label: 'חודשי כיסוי' },
      ],
      riskSurface: {
        volatility:      'תיק מוטה מניות בגיל 31 הוא לגיטימי — יש מספיק שנים לספוג ירידות ולחזור.',
        concentration:   'שני ETFים נושאים את רוב המשקל; השמות מגוונים, אבל החשיפה מתחת נשענת חזק על מניות גדולות בארה״ב.',
        diversification: 'ארה״ב רחב + פלח גלובלי + אג"ח — צורה אינדקסית סבירה, פחות חשופה לשווקים מתעוררים ולחברות קטנות.',
        suitability:     'הטיה מנייתית מתאימה לאופק ארוך; פלח האג"ח מספק עוגן קטן אבל ממשי.',
        liquidity:       'מספר חודשי הוצאות במזומן ובארנקים — כרית נוחה.',
      },
      insightCards: [
        {
          id:    'demo-vt-overlap',
          tier:  'priority',
          severity: 'notice',
          label: 'attention',
          confidence: 'high',
          title: 'חפיפה משמעותית בין VOO ל־VT',
          summary: 'VOO זה ה־S&P 500. VT זה קרן עולמית שבערך 60% ממנה זה אותן מניות גדולות בארה״ב — אז חלק מ"הגיוון" הוא בעצם אותן חברות פעמיים.',
          whyItMatters: 'אפשר להרגיש מגוון אבל להישאר מרוכז באותם שמות מתחת.',
          whatCouldImproveIt: 'אם פשטות לטווח ארוך חשובה, איחוד לאחד מהם והגדלה של VEA לחשיפה אל מחוץ לארה״ב יחדדו את התמונה.',
          evidence: { kind: 'holdings', holdingsRef: ['Vanguard S&P 500 (VOO)', 'Vanguard Total World (VT)'] },
        },
        {
          id:    'demo-cash-buffer',
          tier:  'priority',
          severity: 'info',
          label: 'positive',
          confidence: 'high',
          title: 'כרית המזומן נראית בריאה',
          summary: 'בין עו"ש, ארנקים ומזומן פיזי יש לך כרית של כמה חודשי הוצאות קבועות — נוח, ולא הופך להון רדום.',
          whyItMatters: 'מספיק חמצן לעבור החלפת עבודה או תקופה איטית בלי להיאלץ למכור באמצע ירידה.',
          whatCouldImproveIt: null,
          evidence: null,
        },
        {
          id:    'demo-bonds-sleeve',
          tier:  'observation',
          severity: 'info',
          label: 'healthy',
          confidence: 'high',
          title: 'רכיב האג"ח קטן אבל יציב',
          summary: 'AGG עומד על כ־14% מהברוקרij — נמוך לעומת תיק 60/40 קלאסי, אבל סביר לאופק ארוך.',
          whyItMatters: 'גם שכבת אג"ח דקה ממתנת תנודתיות בירידות חדות בשוק המניות.',
          whatCouldImproveIt: null,
          evidence: { kind: 'holdings', holdingsRef: ['iShares Core Aggregate Bond (AGG)'] },
        },
        {
          id:    'demo-btc-sleeve',
          tier:  'observation',
          severity: 'notice',
          label: 'attention',
          confidence: 'medium',
          title: 'הביטקוין קטן אבל תנודתי',
          summary: 'בערך 4% מהברוקר נמצאים בפוזיציית ביטקוין — קטן בגודל, אבל מביא תזוזה חזקה ל־P&L חודשי.',
          whyItMatters: 'פלח של 4% שיכול לזוז ב־30% ברבעון משתלט על מראה התשואות גם כשהשאר רגוע.',
          whatCouldImproveIt: 'תקרה שנקבעת מראש (למשל קיצוץ אם זה חוצה 5–6% מהתיק) שומרת על התנודתיות בקצוות.',
          evidence: { kind: 'holdings', holdingsRef: ['Bitcoin sleeve'] },
        },
      ],
    },
  },

  assistantQA: {
    en: {
      fallback: 'In this demo I can answer a few set questions — try one of the suggestions above. In the live app the assistant reads your full financial state and answers freely.',
      pairs: [
        {
          matches: ['concentrat', 'overweight', 'too much', 'two holdings', 'top 2'],
          answer:
            'Yes — VOO and VT together are about 70% of the brokerage. The names look diversified, but VT is roughly 60% US large-cap, so the underlying exposure leans even harder on the same companies. The portfolio is concentrated in US large-cap more than the holding list suggests.',
        },
        {
          matches: ['diversif', 'spread', 'broaden', 'global'],
          answer:
            'The shape is broad US + a global tilt via VT + a small developed-ex-US sleeve in VEA + bonds via AGG. It is reasonably diversified by region, but emerging markets and small-caps are largely absent. If broadening is the goal, growing VEA (or adding an emerging-markets fund) shifts the mix more than adding another US large-cap product.',
        },
        {
          matches: ['add to', 'buy more', 'put in', 'extra cash', 'spare cash'],
          answer:
            'From a portfolio-construction perspective, adding more to VOO would reinforce the US large-cap tilt without changing the shape. Adding to VEA or AGG would actually shift the picture — VEA broadens the geography, AGG raises the bond cushion. If long-term simplicity matters more than perfect optimization, consolidating VOO + VT into one of them and using the cash to top up the others is the move that changes the most for the least friction.',
        },
        {
          matches: ['cash', 'runway', 'emergency', 'buffer'],
          answer:
            'Available cash across checking, wallets, and physical sits at a few months of fixed expenses. That is a comfortable buffer — enough to absorb a job change or a slow stretch without forcing a sale into a drawdown, without being so high that the money is sitting idle.',
        },
        {
          matches: ['bitcoin', 'btc', 'crypto'],
          answer:
            'The Bitcoin sleeve is small — about 4% of the brokerage. The size is reasonable, but the volatility is outsized: a 4% position that swings ±30% in a quarter can dominate the look of returns even when the rest of the portfolio is calm. A pre-decided cap (e.g. trim back if it crosses 5–6%) is what keeps it from quietly turning into a real allocation.',
        },
        {
          matches: ['bond', 'agg', 'fixed income'],
          answer:
            'AGG sits at roughly 14% of the brokerage portfolio. That is light compared with a classic 60/40, but reasonable for a 31-year-old with a long horizon. Its job here is dampening — even a thin bond layer takes the edge off sharp equity drawdowns. Raising it makes sense as the horizon shortens, not now.',
        },
      ],
    },

    he: {
      fallback: 'בדמו אני יודע לענות על כמה שאלות מוכנות — נסה אחת ההצעות למעלה. באפליקציה החיה, האסיסטנט קורא את כל המצב הפיננסי שלך ועונה חופשי.',
      pairs: [
        {
          matches: ['ריכוז', 'מרוכז', 'יותר מדי', 'שני המוצרים', 'דומיננטי'],
          answer:
            'כן — VOO ו־VT יחד מהווים כ־70% מתיק הברוקר. השמות נראים מגוונים, אבל VT הוא בערך 60% מניות גדולות בארה״ב, אז החשיפה האמיתית מתחת מתרכזת אפילו יותר על אותן חברות. התיק מרוכז במניות גדולות בארה״ב יותר ממה שרשימת המוצרים מסגירה.',
        },
        {
          matches: ['גיוון', 'לפזר', 'גלובלי', 'בעולם'],
          answer:
            'הצורה היא ארה״ב רחב + הטיה גלובלית דרך VT + פלח קטן של מדינות מפותחות מחוץ לארה״ב ב־VEA + אג"ח דרך AGG. מבחינה גיאוגרפית זה סביר, אבל שווקים מתעוררים ומניות קטנות כמעט לא קיימות. אם המטרה לפזר רחב יותר, הגדלה של VEA (או הוספת קרן שווקים מתעוררים) משנה את התמונה יותר מהוספה של עוד מוצר אמריקאי.',
        },
        {
          matches: ['להוסיף', 'לקנות עוד', 'כסף פנוי', 'במה להשקיע'],
          answer:
            'מבחינת בניית תיק, להוסיף ל־VOO רק יחזק את ההטיה למניות גדולות בארה״ב בלי לשנות את הצורה. להוסיף ל־VEA או ל־AGG ישנה את התמונה — VEA מרחיב גיאוגרפית, AGG מעלה את הכרית. אם פשטות לטווח ארוך חשובה יותר מאופטימיזציה מדויקת, איחוד של VOO ו־VT לאחד מהם ושימוש בכסף הפנוי לחזק את האחרים הוא המהלך עם השפעה גדולה וחיכוך קטן.',
        },
        {
          matches: ['מזומן', 'חירום', 'חמצן', 'כרית'],
          answer:
            'המזומן הזמין בין עו"ש, ארנקים ופיזי שווה ערך לכמה חודשי הוצאות קבועות. זו כרית נוחה — מספיק כדי לעבור החלפת עבודה או תקופה איטית בלי להיאלץ למכור באמצע ירידה, ולא כל כך גבוהה שהכסף יושב רדום.',
        },
        {
          matches: ['ביטקוין', 'קריפטו', 'btc'],
          answer:
            'הפלח של הביטקוין קטן — כ־4% מהברוקר. הגודל סביר, אבל התנודתיות גדולה במיוחד: פוזיציה של 4% שזזה ב־30% ברבעון יכולה להשתלט על מראה התשואות גם כשהשאר רגוע. תקרה שנקבעת מראש (קיצוץ אם זה חוצה 5–6%) שומרת על זה כפלח, לא כהקצאה אמיתית.',
        },
        {
          matches: ['אג"ח', 'אגח', 'agg'],
          answer:
            'AGG עומד על כ־14% מהתיק. נמוך לעומת תיק 60/40 קלאסי, אבל סביר בגיל 31 עם אופק ארוך. התפקיד שלו פה הוא ספיגת זעזועים — גם שכבה דקה של אג"ח מרככת ירידות חדות במניות. הגיוני להגדיל אותו כשהאופק יתקצר, לא עכשיו.',
        },
      ],
    },
  },
};


// Resolve a free-form user question to a pre-baked answer.
// Returns the first matching pair's `answer`, or the language-specific
// fallback if nothing matches. Bilingual: pass lang='he'|'en'.
// Case-insensitive substring match against each pair's `matches` array.
export function lookupDemoAnswer(question, lang) {
  const tracks = DEMO_AI.assistantQA || {};
  const track = tracks[lang === 'he' ? 'he' : 'en'] || tracks.en;
  if (!track) return '';
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return track.fallback;
  for (const pair of track.pairs || []) {
    for (const needle of pair.matches || []) {
      if (q.includes(String(needle).toLowerCase())) return pair.answer;
    }
  }
  return track.fallback;
}
