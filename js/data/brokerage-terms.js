// ─────────────────────────────────────────────────────────────────
//  BROKERAGE TERMS — the commercial terms behind each trading venue
//
//  Every number on the Assets page is a *position*. This registry
//  holds the other half of the picture: what each venue charges to
//  hold and move those positions. Commissions, custody, FX spread,
//  and the caveats that decide whether a small trade is worth making
//  at all.
//
//  Why it's a registry and not a hardcoded blob:
//
//    · It expires. Fee schedules are renegotiated and benefit tracks
//      lapse, so every record carries `asOf` — the date the terms
//      were last confirmed — and the UI leads with it. A fee sheet
//      with no date is a guess.
//    · It's editable. The user renegotiates; the app must not need a
//      deploy to keep up. See js/components/broker-terms.js.
//    · It's queryable. Living on `data` means it round-trips to the
//      Supabase JSONB with everything else, so the assistant's
//      read-only SQL tool can answer "what do I pay to trade in the
//      US?" from the same source the UI renders.
//
//  Anchoring: a record points at a portfolio (`portfolioId`) and/or a
//  bank (`bankId`). Whichever surface shows that venue picks up the
//  ⓘ automatically — nothing hardcodes where the icon appears.
//
//  Shape:
//    { id, name, nameEn, accountRef, portfolioId, bankId,
//      asOf, effectiveFrom, source, sourceEn,
//      sections: [{ title, titleEn, items: [{ label, labelEn, value }] }],
//      notes: [{ text, textEn }],
//      updatedAt }
//
//  `value` is deliberately one bilingual string: these are figures
//  like "0.08%" or "1¢ per share, min $7.50" that read the same in
//  both languages, and splitting them would double the editing work
//  for no gain.
// ─────────────────────────────────────────────────────────────────

// Seeded from the user's signed IBI appendix and Hapoalim benefits
// report. Only terms that actually bear on a decision are here —
// what it costs to trade, to hold, and to convert currency, plus the
// caveats that change the answer. Incidental line items from the
// source documents (chequebook discounts, non-execution waivers,
// per-security withdrawal fees) were left out on purpose: they would
// pad the panel without ever changing what the user does.
export const BROKERAGE_TERMS_SEED = [
  {
    id:          'ibi-self-managed',
    name:        'IBI — חשבון מסחר עצמאי',
    nameEn:      'IBI — self-managed trading account',
    accountRef:  '124951',
    portfolioId: 'ibi',
    bankId:      null,
    asOf:          '2024-06-02',
    effectiveFrom: null,
    source:   'נספח ח׳ לחוזה החתום',
    sourceEn: 'Appendix H to the signed agreement',
    sections: [
      {
        title: 'מסחר בישראל', titleEn: 'Israeli market',
        items: [
          { label: 'מניות, המירים, תעודות סל ואג״ח', labelEn: 'Stocks, convertibles, ETFs, bonds', value: '0.08%' },
          { label: 'מק״מ',            labelEn: 'T-bills (Makam)',   value: '0.06%' },
          { label: 'קרנות נאמנות',    labelEn: 'Mutual funds',      value: '0.08%, min ₪5' },
          { label: 'מינימום לעסקה',   labelEn: 'Minimum per trade', value: '₪2.35' },
        ],
      },
      {
        title: 'מסחר בחו״ל', titleEn: 'Foreign markets',
        items: [
          { label: 'ארה״ב',              labelEn: 'United States',      value: '1¢ / share, min $7.50, no cap' },
          { label: 'קרנות רשומות בחו״ל', labelEn: 'Foreign-listed funds', value: '0.275% + foreign agent cost' },
          { label: 'אג״ח בינלאומי',      labelEn: 'International bonds', value: '0.225%, min 20' },
          { label: 'שווקים אחרים',       labelEn: 'Other markets',       value: '0.3%, min 30' },
        ],
      },
      {
        title: 'המרת מט״ח', titleEn: 'FX conversion',
        items: [
          { label: 'מתחת ל־$15,000', labelEn: 'Under $15,000', value: '0.7%' },
          { label: 'מעל $15,000',    labelEn: 'Over $15,000',  value: '0.5%' },
        ],
      },
      {
        title: 'עלויות קבועות', titleEn: 'Standing costs',
        items: [
          { label: 'דמי משמרת',        labelEn: 'Custody fee',   value: 'פטור מלא / Fully waived' },
          { label: 'ציטוט ישראל',      labelEn: 'IL quote feed', value: '₪15 / month — offset against commissions accrued that month' },
          { label: 'ציטוט ארה״ב מורחב', labelEn: 'US quote feed (extended)', value: '₪0' },
          { label: 'ריבית על יתרת חובה שקלית', labelEn: 'ILS debit balance interest', value: 'Prime + 3.75%' },
        ],
      },
    ],
    notes: [
      {
        text:   'בפתיחת החשבון סוכם פטור לשנה מדמי הניהול החודשיים. הפטור אמור היה להסתיים סביב מאי 2025, ולא ברור מאיזה חודש אתה מחויב בפועל — שווה לברר מול IBI.',
        textEn: 'A one-year waiver on the monthly management fee was agreed at account opening. It should have ended around May 2025, and it is unclear which month billing actually started — worth confirming with IBI.',
      },
    ],
  },

  {
    id:          'hapoalim-securities',
    name:        'בנק הפועלים — מסלול הייטקזון',
    nameEn:      'Bank Hapoalim — Hi-Tech Zone track',
    accountRef:  null,
    portfolioId: null,
    bankId:      'hapoalim',
    asOf:          '2026-07-02',
    effectiveFrom: '2026-07-06',
    source:   'דיווח ההטבות מ־02/07/2026',
    sourceEn: 'Benefits report dated 02/07/2026',
    sections: [
      {
        title: 'מסחר', titleEn: 'Trading',
        items: [
          { label: 'מניות ואג״ח בת״א (כולל אינטרנט)', labelEn: 'TASE stocks & bonds (incl. online)', value: '0.20%' },
          { label: 'ניירות ערך בבורסות ארה״ב',        labelEn: 'US-listed securities',              value: '0.25%' },
          { label: 'קרנות נאמנות הנסחרות בחו״ל',      labelEn: 'Foreign-traded mutual funds',       value: '0.25%' },
          { label: 'אג״ח ומק״מ חו״ל',                 labelEn: 'Foreign bonds & T-bills',           value: '0.25%' },
          { label: 'פדיון ניירות המופקדים למשמרת',    labelEn: 'Redemption of securities in custody', value: '0.20%' },
        ],
      },
      {
        title: 'דמי ניהול פיקדון ני״ע', titleEn: 'Securities custody fee',
        items: [
          { label: 'ת״א, קרנות ישראליות, ניירות בחו״ל', labelEn: 'TASE, Israeli funds, foreign securities', value: '0.0375% — likely quarterly, ≈0.15% / year' },
        ],
      },
      {
        title: 'מט״ח', titleEn: 'Foreign exchange',
        items: [
          { label: 'עמלת חליפין',   labelEn: 'Exchange commission', value: '60% discount, all directions incl. FX-to-FX and direct deals' },
          { label: 'הטבת שער חליפין', labelEn: 'Exchange rate benefit', value: '0.4%' },
        ],
      },
    ],
    notes: [
      {
        text:   'ההטבות אינן חלות על עמלות המינימום והמקסימום. בכל פעולה קטנה אתה משלם את המינימום לפי התעריפון המלא של הבנק — והמספר הזה עדיין לא ידוע.',
        textEn: 'The discounts do not apply to minimum or maximum commissions. On any small trade you pay the bank’s full-tariff minimum — and that figure is still unknown.',
      },
      {
        text:   'ייתכן שנגבית עמלת ברוקר נפרדת על מסחר בארה״ב. גם היא לא מופיעה במסמך ההטבות.',
        textEn: 'A separate broker fee may be charged on US trading. It does not appear in the benefits document either.',
      },
    ],
  },
];

// Idempotent seed. Adds the registry for snapshots that predate it and
// back-fills any seed record the user hasn't got, but never touches a
// record that already exists — those carry the user's own edits and
// this function must never be the thing that reverts them.
//
// `includeDefaults: false` creates the empty registry and stops there.
// That is what the public demo passes: BROKERAGE_TERMS_SEED holds the
// real, personally negotiated rates and a real account number, and the
// demo dataset must never be a route by which those reach a shared
// link. data/display-state.js supplies its own fictional record.
export function seedBrokerageTerms(data, { includeDefaults = true } = {}) {
  if (!Array.isArray(data.brokerageTerms)) data.brokerageTerms = [];
  if (!includeDefaults) return;
  for (const seed of BROKERAGE_TERMS_SEED) {
    if (data.brokerageTerms.some(r => r && r.id === seed.id)) continue;
    data.brokerageTerms.push(JSON.parse(JSON.stringify(seed)));
  }
}

export function getBrokerageTerms(data) {
  return Array.isArray(data && data.brokerageTerms) ? data.brokerageTerms : [];
}

export function getBrokerageTermsById(data, id) {
  return getBrokerageTerms(data).find(r => r && r.id === id) || null;
}

// Which record (if any) describes the venue a given surface is showing.
// Portfolios match on portfolioId; bank-held positions match on bankId,
// falling back to the entry's free-text institution so a holding that
// predates the bankId field still finds its terms.
export function findTermsForPortfolio(data, portfolioId) {
  if (!portfolioId) return null;
  return getBrokerageTerms(data).find(r => r && r.portfolioId === portfolioId) || null;
}

export function findTermsForEntry(data, entry) {
  if (!entry) return null;
  const records = getBrokerageTerms(data);
  if (entry.portfolioId) {
    const byPortfolio = records.find(r => r && r.portfolioId === entry.portfolioId);
    if (byPortfolio) return byPortfolio;
  }
  if (entry.bankId) {
    const byBank = records.find(r => r && r.bankId === entry.bankId);
    if (byBank) return byBank;
  }
  // Holdings that predate the bankId field carry only a free-text
  // institution. Resolve it through data.banks rather than comparing
  // against the record's own name — the record is named for the track
  // ("Bank Hapoalim — Hi-Tech Zone track"), which would never equal a
  // plain "Bank Hapoalim" on the holding.
  if (entry.institution) {
    const inst = _norm(entry.institution);
    const banks = Array.isArray(data && data.banks) ? data.banks : [];
    const byBankName = records.find(r => {
      if (!r || !r.bankId) return false;
      const bank = banks.find(b => b && b.id === r.bankId);
      if (!bank) return false;
      // Substring, not equality: a holding's institution is often the
      // bank name with a qualifier appended by whoever entered it.
      const bn = _norm(bank.name), be = _norm(bank.nameEn);
      return (bn && inst.includes(bn)) || (be && inst.includes(be));
    });
    if (byBankName) return byBankName;

    const byName = records.find(r => r && (_norm(r.name) === inst || _norm(r.nameEn) === inst));
    if (byName) return byName;
  }
  return null;
}

// Institution names arrive from parsers and hand entry alike, so
// compare on a normalized form rather than exact bytes.
function _norm(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}
