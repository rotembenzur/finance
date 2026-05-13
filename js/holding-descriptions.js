// ─────────────────────────────────────────────────────────────────
//  HOLDING DESCRIPTIONS
//
//  Per-security plain-language explanations, paired in Hebrew and
//  English. Keyed by ibiSecurityId so the description survives every
//  broker re-sync (the security id is the stable identifier; name,
//  ticker, and even type can shift across syncs).
//
//  Treated as data, not UI. The info-icon modal in assets.js looks
//  up the entry's id here and renders whatever it finds. If no
//  description exists, no icon is shown — silent rather than blank.
//
//  Hebrew copy uses Hebrew gershayim (״) — the typographically
//  correct mark inside Hebrew abbreviations like נאסד״ק / ארה״ב /
//  אג״ח — rather than ASCII double-quote. Embedded English tokens
//  (Apple, Microsoft, NVIDIA, etc.) sit inline within the RTL
//  paragraph; the browser's bidi algorithm handles them when the
//  paragraph carries dir="rtl". The modal renderer also wraps ticker
//  symbols in <bdi> so multi-segment tickers like NDX100.IBI.K stay
//  one unit.
// ─────────────────────────────────────────────────────────────────

export const HOLDING_DESCRIPTIONS = {
  // NASDAQ 100 קרן IBI (NDX100.IBI.K)
  '5129283': {
    he: 'קרן ישראלית שעוקבת אחרי מדד נאסד״ק 100, כלומר בעיקר חברות טכנולוגיה אמריקאיות גדולות כמו Apple, Microsoft ו-NVIDIA.',
    en: 'Israeli fund tracking the NASDAQ 100 index, focused mainly on large American technology companies such as Apple, Microsoft, and NVIDIA.',
  },

  // Vanguard S&P 500 (VOO)
  '60604105': {
    he: 'ETF אמריקאי של Vanguard שעוקב אחרי 500 החברות הגדולות בארה״ב ונחשב לאחד ממדדי המניות המרכזיים בעולם.',
    en: 'A Vanguard ETF tracking the 500 largest U.S. companies, considered one of the world’s core stock market indexes.',
  },

  // Vanguard Total Bond (BND)
  '1062520': {
    he: 'ETF אג״ח אמריקאי שמפזר השקעה על אלפי אג״ח ממשלתיות וקונצרניות בארה״ב כדי לתת יציבות יחסית לתיק.',
    en: 'A U.S. bond ETF diversified across thousands of government and corporate bonds to provide relative portfolio stability.',
  },

  // S&P 500 IBI (SP500.IBI)
  '1148162': {
    he: 'קרן ישראלית שעוקבת אחרי מדד S&P 500 ומאפשרת חשיפה לשוק האמריקאי דרך הבורסה בישראל.',
    en: 'Israeli fund tracking the S&P 500 index, providing exposure to the U.S. stock market through the Israeli exchange.',
  },

  // NASDAQ 100 IBI (NDX100.IBI)
  '1200450': {
    he: 'קרן ישראלית נוספת שעוקבת אחרי מדד נאסד״ק 100 ומתמקדת בעיקר בחברות טכנולוגיה וצמיחה.',
    en: 'Another Israeli fund tracking the NASDAQ 100 index, mainly focused on technology and growth companies.',
  },

  // Vanguard Total World (VT)
  '60194669': {
    he: 'ETF עולמי של Vanguard שמחזיק אלפי מניות מכל העולם, גם מארה״ב וגם משווקים בינלאומיים.',
    en: 'A global Vanguard ETF holding thousands of stocks from both the U.S. and international markets.',
  },

  // דולב ארה״ב
  '99028': {
    he: 'קרן כספית/דולרית שמיועדת בעיקר להחזקה דולרית סולידית יחסית ולא לחשיפה מנייתית.',
    en: 'A USD-linked conservative cash-style fund intended mainly for relatively stable dollar exposure rather than stock exposure.',
  },

  // Vanguard Total Stock (VTI)
  '60062783': {
    he: 'ETF שמחזיק כמעט את כל שוק המניות האמריקאי, כולל חברות גדולות, בינוניות וקטנות.',
    en: 'An ETF covering nearly the entire U.S. stock market, including large, mid, and small-cap companies.',
  },

  // Apple Inc. (AAPL)
  '103788': {
    he: 'מניה בודדת של חברת Apple, אחת מחברות הטכנולוגיה הגדולות בעולם.',
    en: 'A single stock of Apple, one of the world’s largest technology companies.',
  },

  // iShares S&P 500 (IVW)
  '60076072': {
    he: 'ETF של iShares שנותן חשיפה לחברות צמיחה גדולות מתוך מדד S&P 500.',
    en: 'An iShares ETF focused on large growth companies within the S&P 500 index.',
  },
};

// Lookup helper. Resolves by ibiSecurityId first (most stable), falls
// back to ticker as a courtesy in case a future non-IBI holding shares
// a ticker with one of the IBI funds. Returns null when no match — the
// row renderer treats null as "no info icon".
export function getHoldingDescription(entry) {
  if (!entry) return null;

  if (entry.ibiSecurityId && HOLDING_DESCRIPTIONS[entry.ibiSecurityId]) {
    return HOLDING_DESCRIPTIONS[entry.ibiSecurityId];
  }

  return null;
}
