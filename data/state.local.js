// ─────────────────────────────────────────────────────────────────
//  FINANCIAL STATE — LOCAL / REAL DATA
//
//  Real personal financial state. GITIGNORED — never commit this
//  file. js/store.js dynamically imports this file at startup; if
//  present, its export replaces the demo state from state.example.js
//  before the app finishes loading.
//
//  If this file is missing on a given machine, the dynamic import
//  rejects (silent), and the app boots from state.example.js with
//  redacted demo data instead.
// ─────────────────────────────────────────────────────────────────

export const FINANCIAL_STATE = {

  meta: {
    name:        'רתם',
    nameEn:      'Rotem',
    currency:    'ILS',
    lastUpdated: '2026-05-08',
    version:      5,
  },

  rates: { USD: 3.72, EUR: 4.05 },

  // ── Monthly salary (income tier) ─────────────────────────────────
  // null = not yet configured. UI surfaces a CTA in that case.
  salary: null,

  // ── Bank registry ────────────────────────────────────────────────
  banks: [
    {
      id:        'hapoalim',
      name:      'בנק הפועלים',
      nameEn:    'Bank Hapoalim',
      branch:    '661',
      location:  'אחוזה, רעננה',
      logo:      'assets/logos/hapoalim.jpg',
      isPrimary: true,
    },
    {
      id:        'international',
      name:      'הבנק הבינלאומי',
      nameEn:    'The International Bank',
      branch:    '092',
      location:  'אחוזה, רעננה',
      logo:      'assets/logos/habenleumi.jpg',
      isPrimary: false,
    },
  ],

  // ── Provider registry ─────────────────────────────────────────
  // Non-bank financial institutions that issue products (pensions,
  // gemels, study funds, brokerage accounts). Entries link via
  // `providerId`. Same shape as banks[] minus branch/location since
  // these don't have geographic context. Logo lives here so a single
  // provider's products all share one source-of-truth visual.
  providers: [
    {
      id:     'harel',
      name:   'הראל',
      nameEn: 'Harel',
      logo:   'assets/logos/harel_logo.png',
    },
    {
      id:     'menora',
      name:   'מנורה מבטחים',
      nameEn: 'Menora Mivtachim',
      logo:   'assets/logos/menora_logo.png',
    },
    {
      id:     'altshuler',
      name:   'אלטשולר שחם',
      nameEn: 'Altshuler Shaham',
      logo:   'assets/logos/altshuler_logo.png',
    },
    {
      id:     'ibi',
      name:   'IBI',
      nameEn: 'IBI',
      logo:   'assets/logos/ibi_logo.svg.png',
    },
    // Synthetic provider — represents externally / family-managed
    // holdings that don't have a real institutional brand. The icon is
    // a generic certificate/savings emblem so future family-fund
    // entries can reuse it without each needing its own logo.
    {
      id:     'family',
      name:   'משפחתי',
      nameEn: 'Family',
      logo:   'assets/logos/family.png',
    },
    // IDF — issuer of the military discharge deposit. Future
    // military-related entries (additional deposit instruments,
    // service-related savings) can reuse this provider.
    {
      id:     'idf',
      name:   'צה״ל',
      nameEn: 'IDF',
      logo:   'assets/logos/idf.jpg',
    },
  ],

  // ── Investment portfolios (self-managed brokerage accounts) ──────
  // Holdings link via `portfolioId` on the entry. Portfolio-level totals
  // are broker-provided snapshots — authoritative for net-worth math
  // even when the holdings list is incomplete.
  portfolios: [
    {
      id:         'ibi',
      providerId: 'ibi',
      name:       'IBI',
      nameEn:     'IBI',
      broker:     'IBI',
      type:       'self_managed',
      isPrimary:  true,

      // Holdings-only math (what the user thinks of as their portfolio).
      // Excludes broker's uninvested cash and the technical tax shield.
      // Reset to zero — repopulated on the next Excel sync.
      totalValue:          0,
      totalInvested:       0,
      totalGain:           0,
      totalGainPercent:    0,

      // Broker's free cash balance — sits alongside the portfolio but is
      // NOT part of investable holdings. Shown separately in the hero.
      cashAvailable:       0,

      // IBI's 1–10 risk classification of the portfolio's posture.
      riskScore:             6.7,

      // Daily change is unknown from this snapshot — leave null until
      // an import provides it.
      dailyChange:         null,
      dailyChangePercent:  null,

      currency:  'ILS',
      isActive:   true,
      updatedAt: '2026-05-09',
    },
  ],

  // ── Financial entries (accounts, holdings, savings) ─────────────
  entries: [

    // ─── Liquid: Physical cash (wallet) ─────────────────────────────
    // First-class liquid asset, not tied to any bank.
    // `isCash` flag reserves room for future multi-wallet / foreign-cash
    // entries and cash-transaction history without a schema migration.

    {
      id:          'cash-physical',
      name:        'מזומן',
      institution: null,
      bankId:       null,
      type:        'cash',
      category:    'liquid',
      tier:        'available',
      balance:      2300,
      currentValue: null,
      currency:    'ILS',
      isCash:       true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-09',
    },

    // ─── Liquid: Checking accounts ─────────────────────────────────

    {
      id:          'acct-hapoalim-checking',
      name:        'עו"ש',
      institution: 'בנק הפועלים',
      bankId:      'hapoalim',
      type:        'checking',
      category:    'liquid',
      tier:        'available',
      balance:      8882.85,
      currentValue: null,
      currency:    'ILS',
      isPrimary:    true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-08',
    },

    {
      id:          'acct-international-checking',
      name:        'עו"ש',
      institution: 'הבנק הבינלאומי',
      bankId:      'international',
      type:        'checking',
      category:    'liquid',
      tier:        'available',
      balance:      954.68,
      currentValue: null,
      currency:    'ILS',
      isPrimary:    false,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-08',
    },

    // ─── Semi-liquid: IBI portfolio holdings (broker source-of-truth) ───
    // 11 raw holdings, exactly as the broker reports them. IDs use the
    // IBI security number so future broker syncs match (no duplicates).
    // Per-holding `invested` is intentionally null — broker total is at
    // portfolio.totalInvested.

    {
      id:                 'inv-ibi-99028',
      ibiSecurityId:      '99028',
      name:               'דולב ארה"ב',
      nameEn:             'Dolev USA',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'investment_fund',
      category:           'semi_liquid',
      tier:               'invested',
      // USD-linked Israeli mutual fund — gives US/dollar exposure.
      // Treated as US equity exposure for the allocation chart so it
      // sits with the rest of the US-large-cap bucket. Override later
      // if a more specific bucket fits.
      assetClass:         'us_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:              null,
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-103788',
      ibiSecurityId:      '103788',
      name:               'Apple Inc.',
      nameEn:             'Apple Inc.',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'stock_portfolio',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'single_stock',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'AAPL',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-1062520',
      ibiSecurityId:      '1062520',
      name:               'Vanguard Total Bond (BND)',
      nameEn:             'Vanguard Total Bond (BND)',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'bond',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'bonds',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'BND',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-1148162',
      ibiSecurityId:      '1148162',
      name:               'S&P 500 IBI',
      nameEn:             'S&P 500 IBI',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'SP500.IBI',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-1200450',
      ibiSecurityId:      '1200450',
      name:               'NASDAQ 100 IBI',
      nameEn:             'NASDAQ 100 IBI',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_tech',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'NDX100.IBI',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-5129283',
      ibiSecurityId:      '5129283',
      name:               'NASDAQ 100 קרן IBI',
      nameEn:             'IBI NASDAQ 100 Fund',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_tech',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'NDX100.IBI.K',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-9993983',
      ibiSecurityId:      '9993983',
      name:               '26 מגן מס',
      nameEn:             '26 Tax Shield',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'tax_shield',
      category:           'semi_liquid',
      tier:               'invested',
      // Technical tax/protection instrument — real value is ₪0,
      // not real exposure. Hidden from holdings list and excluded
      // from allocation math via the isTechnical flag.
      isTechnical:        true,
      assetClass:          null,
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:              null,
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-60062783',
      ibiSecurityId:      '60062783',
      name:               'Vanguard Total Stock (VTI)',
      nameEn:             'Vanguard Total Stock (VTI)',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_equity',
      // VTI is technically US Total Stock Market, but in this
      // portfolio it functions as the broad/diversified bucket
      // alongside VT — categorize it there for the exposure chart.
      categoryOverride:   'global_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'VTI',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-60076072',
      ibiSecurityId:      '60076072',
      name:               'iShares S&P 500 (IVW)',
      nameEn:             'iShares S&P 500 (IVW)',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'IVW',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-60194669',
      ibiSecurityId:      '60194669',
      name:               'Vanguard Total World (VT)',
      nameEn:             'Vanguard Total World (VT)',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'global_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'VT',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    {
      id:                 'inv-ibi-60604105',
      ibiSecurityId:      '60604105',
      name:               'Vanguard S&P 500 (VOO)',
      nameEn:             'Vanguard S&P 500 (VOO)',
      institution:        'IBI',
      portfolioId:        'ibi',
      bankId:              null,
      type:               'etf',
      category:           'semi_liquid',
      tier:               'invested',
      assetClass:         'us_equity',
      balance:             null,
      currentValue:        0,
      invested:            null,
      ticker:             'VOO',
      quantity:            0,
      currency:           'ILS',
      isActive:            true,
      isLiability:         false,
      updatedAt:          '2026-05-09',
    },

    // ─── Semi-liquid: Bank-held single stock (not part of IBI) ───

    {
      id:           'inv-hapoalim-mr1',
      name:         'בנק הפועלים מר1',
      institution:  'בנק הפועלים',
      bankId:       'hapoalim',
      portfolioId:   null,
      type:         'stock_portfolio',
      category:     'semi_liquid',
      tier:         'invested',
      assetClass:   'single_stock',
      balance:       null,
      currentValue:  333,
      invested:      null,
      ticker:       'POLI.MR1',
      quantity:      4,
      allocationPct: 100,
      currency:     'ILS',
      isActive:      true,
      isLiability:   false,
      updatedAt:    '2026-05-08',
    },

    // ─── Non-liquid: Family-managed investment ───────────────────

    {
      id:               'inv-family-ayalon-bonds',
      name:             'איילון אג"ח והנפקות',
      institution:      'חשבון השקעות משפחתי',
      providerId:       'family',
      bankId:           null,
      portfolioId:       null,
      type:             'investment_fund',
      category:         'non_liquid',
      tier:             'invested',
      balance:          null,
      currentValue:     18280,
      invested:         null,
      fundNumber:       '5109673',
      unitPrice:        1.8335,
      quantity:         9970,
      ownershipType:    'family',
      isExternal:       true,
      sharedAccountTotal: 76494,
      currency:         'ILS',
      isActive:         true,
      isLiability:      false,
      updatedAt:        '2026-05-07',
    },

    // ─── Non-liquid: Locked savings ──────────────────────────────

    {
      id:          'sav-hapoalim-discharge',
      name:        '15,000 ש"ח עד השחרור',
      institution: 'בנק הפועלים',
      bankId:      'hapoalim',
      portfolioId:  null,
      type:        'savings',
      category:    'non_liquid',
      tier:        'available',
      balance:      null,
      currentValue: 15525,
      invested:     15000,
      profit:       525,
      maturityDate: '2026-06-01',
      currency:    'ILS',
      isLocked:     true,
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-08',
    },

    // ─── Non-liquid: Pension (Harel) ─────────────────────────────
    // Internal track allocation lives on `tracks[]`. Sum of track
    // values matches `currentValue`. Future detail view will surface
    // tracks; V1 just shows the total.

    {
      id:          'pension-harel',
      name:        'קרן פנסיה',
      nameEn:      'Pension Fund',
      institution: 'הראל',
      providerId:  'harel',
      bankId:       null,
      portfolioId:  null,
      type:        'pension',
      category:    'non_liquid',
      tier:        'future_wealth',
      balance:      null,
      currentValue: 103731,
      invested:     null,
      tracks: [
        { name: 'מסלול מניות',  nameEn: 'Stocks Track',       value: 83062.36, fee: 0.33 },
        { name: 'גיל 50 ומטה', nameEn: 'Age 50 and Under',   value: 20668.95, fee: 0.47 },
      ],
      currency:    'ILS',
      isActive:     true,
      isLiability:  false,
      updatedAt:   '2026-05-09',
    },

    // ─── Non-liquid: Study fund (Harel, locks until 2030) ────────

    {
      id:           'study-harel',
      name:         'קרן השתלמות',
      nameEn:       'Study Fund',
      institution:  'הראל',
      providerId:   'harel',
      bankId:        null,
      portfolioId:   null,
      type:         'study_fund',
      category:     'non_liquid',
      tier:         'future_wealth',
      balance:       null,
      currentValue:  16951,
      invested:      null,
      trackName:    'מדד S&P 500',
      trackNameEn:  'S&P 500 index',
      maturityDate: '2030-03-31',
      currency:     'ILS',
      isActive:      true,
      isLiability:   false,
      updatedAt:    '2026-05-09',
    },

    // ─── Non-liquid: Investment Gemel (Altshuler — recurring + annual limit) ───

    {
      id:                'inv-gemel-altshuler',
      name:              'גמל להשקעה',
      nameEn:            'Investment Provident Fund',
      institution:       'אלטשולר שחם',
      providerId:        'altshuler',
      bankId:             null,
      portfolioId:        null,
      type:              'investment_gemel',
      category:          'non_liquid',
      tier:              'future_wealth',
      balance:            null,
      currentValue:       15606,
      invested:           null,
      trackName:         'מסלול חיסכון פלוס — מחקה מדדי מניות',
      trackNameEn:       'Savings Plus — Equity Index Tracking',
      // Tax context — surfaced in the row meta so the user reads
      // this product as long-term retirement-oriented, not short-term.
      description: {
        he: 'פטור ממס בפרישה',
        en: 'Tax-exempt at retirement',
      },
      // Annual deposit allowance (tax-advantaged contribution tracking)
      annualLimit:        83641,
      yearlyDeposited:    14965,
      remainingAllowance: 68676,
      limitReferenceDate:'2026-05-09',
      currency:          'ILS',
      isActive:           true,
      isLiability:        false,
      updatedAt:         '2026-03-31',
    },

    // ─── Non-liquid: Provident funds (Altshuler + Menora) ────────

    {
      id:           'gemel-altshuler',
      name:         'קופת גמל',
      nameEn:       'Provident Fund',
      institution:  'אלטשולר שחם',
      providerId:   'altshuler',
      bankId:        null,
      portfolioId:   null,
      type:         'provident_fund',
      category:     'non_liquid',
      tier:         'future_wealth',
      balance:       null,
      currentValue:  3053,
      invested:      null,
      trackName:    'גמל — גיל 50 ומטה',
      trackNameEn:  'Gemel — Age 50 and Under',
      currency:     'ILS',
      isActive:      true,
      isLiability:   false,
      updatedAt:    '2026-03-31',
    },

    {
      id:           'gemel-menora',
      name:         'קופת גמל',
      nameEn:       'Provident Fund',
      institution:  'מנורה מבטחים',
      providerId:   'menora',
      bankId:        null,
      portfolioId:   null,
      type:         'provident_fund',
      category:     'non_liquid',
      tier:         'future_wealth',
      balance:       null,
      currentValue:  3023.98,
      invested:      null,
      trackName:    'מור — גיל 50 ומטה',
      trackNameEn:  'Mor — Age 50 and Under',
      currency:     'ILS',
      isActive:      true,
      isLiability:   false,
      updatedAt:    '2026-05-07',
    },

    // ─── Non-liquid: Military discharge deposit (future-access) ──
    // Auto-transferred ~60 business days after 5 years post-discharge.
    // The exact transfer date is estimated, hence maturityDateEstimated.

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
      currentValue:           20811.21,
      invested:               null,
      maturityDate:          '2028-03-30',
      maturityDateEstimated:  true,
      currency:              'ILS',
      isActive:               true,
      isLiability:            false,
      updatedAt:             '2026-05-09',
    },

  ],

  // ── Credit and debit cards ───────────────────────────────────────
  cards: [

    {
      id:              'card-haver-mastercard',
      name:            'מסטרקארד גולד',
      nameEn:          'Mastercard Gold',
      club:            'חבר משרתי קבע',
      network:         'mastercard',
      tier:            'gold',
      cardType:        'non_bank',
      processor:       'isracard',
      bankId:          'hapoalim',
      institution:     'בנק הפועלים',
      last4:           '9367',
      skin:            'black',
      expiry:          '03/2029',
      creditLimit:     35000,
      currentSpending: 2214.55,
      billingDay:      2,
      nextBilling:     '2026-06-02',
      isDebit:         false,
      fees: {
        foreignTxn:  { eur: 1.00, usd: 1.00, other: 1.00 },
        foreignCash: { eur: 3.50, usd: 3.50, other: 3.50 },
      },
      isActive:        true,
      image:           'assets/cards/9367.png',
      updatedAt:       '2026-05-08',
      charges: [],
    },

    {
      id:              'card-haver-amex',
      name:            'אמריקן אקספרס',
      nameEn:          'American Express',
      club:            'חבר משרתי קבע',
      network:         'amex',
      tier:            'standard',
      cardType:        'non_bank',
      bankId:          'hapoalim',
      institution:     'בנק הפועלים',
      last4:           '1907',
      skin:            'dark-blue',
      expiry:          '03/2029',
      creditLimit:     5000,
      currentSpending: 0,
      billingDay:      2,
      nextBilling:     '2026-06-02',
      isDebit:         false,
      fees: {
        foreignTxn:  { eur: 0.95, usd: 0.95, other: 0.95 },
        foreignCash: { eur: 3.50, usd: 3.50, other: 3.50 },
      },
      isActive:        true,
      image:           'assets/cards/1907.png',
      updatedAt:       '2026-05-08',
      charges: [],
    },

    {
      id:              'card-max-visa',
      name:            'ויזה בהצדעה',
      nameEn:          'MAX Visa',
      club:            'MAX',
      network:         'visa',
      tier:            'standard',
      cardType:        'international',
      processor:       'max',
      bankId:          null,
      institution:     'MAX',
      last4:           '0317',
      skin:            'blue',
      expiry:          '02/2032',
      creditLimit:     27000,
      currentSpending: null,
      billingDay:      2,
      nextBilling:     '2026-06-02',
      isDebit:         false,
      isActive:        true,
      image:           'assets/cards/0317.png',
      updatedAt:       '2026-05-08',
      charges: [],
    },

    {
      id:              'card-poalim-direct',
      name:            'יותר לחיילים',
      nameEn:          'Yoter LaHayelim',
      club:            'יותר לחיילים',
      network:         'mastercard',
      tier:            'standard',
      cardType:        'bank',
      processor:       'isracard',
      bankId:          'hapoalim',
      institution:     'בנק הפועלים',
      last4:           '0447',
      skin:            'red',
      expiry:          '11/2026',
      creditLimit:     null,
      currentSpending: null,
      billingDay:      null,
      nextBilling:     null,
      isDebit:         true,
      isActive:        true,
      image:           'assets/cards/0447.png',
      updatedAt:       '2026-05-08',
      charges: [],
    },

    {
      id:              'card-international-visa',
      name:            'ויזה גולד',
      nameEn:          'Visa Gold',
      club:            null,
      network:         'visa',
      tier:            'gold',
      cardType:        'bank',
      processor:       'max',
      bankId:          'international',
      institution:     'הבנק הבינלאומי',
      last4:           '3327',
      skin:            'black',
      expiry:          '02/2032',
      creditLimit:     27000,
      currentSpending: null,
      billingDay:      10,
      nextBilling:     '2026-06-10',
      isDebit:         false,
      isActive:        true,
      image:           'assets/cards/3327.png',
      updatedAt:       '2026-05-10',
      charges: [],
    },

  ],

  // ── Recurring obligations (auto deposits / withdrawals / bills) ──
  // Each entry references `toEntryId` for inflow targets (e.g. monthly
  // contribution to an investment) and `fromBankId` for the source.
  // Future: add `nextRunDate`, history, projected growth.
  recurring: [
    {
      id:          'rec-altshuler-investment',
      name:        'הפקדה חודשית — גמל להשקעה אלטשולר',
      nameEn:      'Monthly contribution — Altshuler Investment Gemel',
      amount:       400,
      cycle:       'monthly',
      fromBankId:  'hapoalim',
      toEntryId:   'inv-gemel-altshuler',
      type:        'investment_contribution',
      currency:    'ILS',
      isActive:     true,
    },
  ],

};
