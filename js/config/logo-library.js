// ─────────────────────────────────────────────────────────────────
//  LOGO LIBRARY
//
//  The set of logo assets available for selection (banks, providers,
//  and any other entity that carries a logo). This is the single source
//  the visual logo picker (js/components/logo-input.js) renders as a
//  gallery, so users pick a logo by sight — they never type or see the
//  underlying `assets/logos/...` path.
//
//  This is an ASSET MANIFEST: it mirrors the files in assets/logos/.
//  When a new logo image is added to that folder, add a line here with
//  a friendly bilingual name. (A static site can't list a directory at
//  runtime, so the manifest is the registry.)
// ─────────────────────────────────────────────────────────────────

export const LOGO_LIBRARY = [
  { path: 'assets/logos/hapoalim.jpg',             en: 'Bank Hapoalim',   he: 'בנק הפועלים' },
  { path: 'assets/logos/habenleumi.jpg',           en: 'Beinleumi',       he: 'הבינלאומי' },
  { path: 'assets/logos/discount_bank_logo.jpg',   en: 'Discount',        he: 'דיסקונט' },
  { path: 'assets/logos/mizrahi_tefahot_logo.png', en: 'Mizrahi Tefahot', he: 'מזרחי טפחות' },
  { path: 'assets/logos/harel_logo.png',           en: 'Harel',           he: 'הראל' },
  { path: 'assets/logos/menora_logo.png',          en: 'Menora Mivtachim', he: 'מנורה מבטחים' },
  { path: 'assets/logos/altshuler_logo.png',       en: 'Altshuler Shaham', he: 'אלטשולר שחם' },
  { path: 'assets/logos/ibi_logo.svg.png',         en: 'IBI',             he: 'IBI' },
  { path: 'assets/logos/migdal_logo.png',          en: 'Migdal',          he: 'מגדל' },
  { path: 'assets/logos/fnx_logo.png',             en: 'Phoenix',         he: 'הפניקס' },
  { path: 'assets/logos/meitav_logo.jpeg',         en: 'Meitav',          he: 'מיטב' },
  { path: 'assets/logos/yl_lapidot_logo.png',      en: 'Yelin Lapidot',   he: 'ילין לפידות' },
  { path: 'assets/logos/ayalon_logo.png',          en: 'Ayalon',          he: 'איילון' },
  { path: 'assets/logos/mor_logo.webp',            en: 'Mor',             he: 'מור' },
  { path: 'assets/logos/clal_logo.png',            en: 'Clal',            he: 'כלל' },
  { path: 'assets/logos/bit_logo.png',             en: 'Bit',             he: 'ביט' },
  { path: 'assets/logos/paybox_logo.jpg',          en: 'Paybox',          he: 'Paybox' },
  { path: 'assets/logos/family.png',               en: 'Family',          he: 'משפחה' },
  { path: 'assets/logos/idf.jpg',                  en: 'IDF',             he: 'צה״ל' },
];

const _BY_PATH = new Map(LOGO_LIBRARY.map(l => [l.path, l]));

// Friendly name for a stored logo path (lang-aware). Empty string when
// the path isn't in the library (e.g. a legacy/custom value).
export function logoName(path, lang) {
  const l = path ? _BY_PATH.get(path) : null;
  return l ? (lang === 'he' ? l.he : l.en) : '';
}

export function isKnownLogo(path) {
  return !!(path && _BY_PATH.has(path));
}
