// ─────────────────────────────────────────────────────────────────
//  DATES — centralized formatting for the entire app
//
//  Financial UX principle: a date without a year is dangerous. A
//  military deposit "30 במרץ" could mean 2028 or any year — the
//  difference is meaningful. So every milestone date carries its
//  year. Relative phrasing ("in 23 days") is additive, never a
//  replacement for the calendar date.
//
//  Five semantic formatters, each answering a different question:
//
//    formatMilestone(date)
//      "1 ביוני 2026" / "Jun 1, 2026"
//      Maturity, liquidity, unlock, billing, retirement —
//      anything time-pinned in the future or past.
//
//    formatReportDate(date)
//      "09.05.2026"
//      "Data valid as of" / snapshot timestamps. Numeric DD.MM.YYYY,
//      the convention on Israeli financial statements.
//
//    formatCardExpiry(value)
//      "03/2029"
//      Card expiration. Normalizes MM/YYYY, MM/YY, or YYYY-MM input.
//
//    formatRelative(days)
//      "in 23 days" / "בעוד 23 ימים"
//      Days-from-now phrasing. Use ALONGSIDE a milestone date,
//      not as a replacement. Returns empty for past or far-future
//      (>180 days) — milestone alone is enough then.
//
//    formatToday(input?)
//      "Saturday, May 9, 2026" / "יום שבת, 9 במאי 2026"
//      Long form, year included. Default is today.
// ─────────────────────────────────────────────────────────────────

import { currentLang, t } from './i18n.js';

function _dateLocale() {
  return currentLang === 'he' ? 'he-IL' : 'en-US';
}

function _parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'string') {
    // Accept "YYYY-MM-DD" (anchor at midnight to avoid timezone drift)
    // and other ISO-ish formats.
    const s = input.length === 10 ? input + 'T00:00:00' : input;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Bidi-safe wrap. The formatters in this module return strings that
// mix RTL Hebrew text with LTR numbers ("10 ביוני 2026", "בעוד 23
// ימים", etc.). Without isolation, the surrounding container's
// direction can reorder the parts — most visibly, an LTR-forced
// numeric cell or an injected U+200E LRM marker drags the leading
// day digit to the visual end of the Hebrew reading flow.
//
// `<bdi>` is the standard HTML primitive for this: it creates an
// isolated bidi context with direction auto-resolved from the
// content's first strong character. So "10 ביוני 2026" resolves to
// RTL ("10" anchored at the visual right), while "May 10, 2026"
// resolves to LTR — both correct regardless of where the formatter
// output is dropped. Every consumer in this codebase emits these
// strings into innerHTML, never attributes, so the HTML wrapping
// is safe.
function _bidiSafe(text) {
  return text ? `<bdi>${text}</bdi>` : '';
}

// 1. Milestone — financial event with calendar date. Always year-bearing.
export function formatMilestone(input) {
  const d = _parseDate(input);
  if (!d) return '';
  const formatted = d.toLocaleDateString(_dateLocale(), {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
  return _bidiSafe(formatted);
}

// 2. Report date — DD.MM.YYYY for "data as of" timestamps.
export function formatReportDate(input) {
  const d = _parseDate(input);
  if (!d) return '';
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// 3. Card expiry — MM/YYYY normalized.
export function formatCardExpiry(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}$/.test(s)) {
    const [m, y] = s.split('/');
    return `${m}/20${y}`;
  }
  if (/^\d{4}-\d{2}/.test(s)) {
    const [yyyy, mm] = s.split('-');
    return `${mm}/${yyyy}`;
  }
  return s;
}

// 4. Relative — "in 23 days" / "בעוד 23 ימים". Returns empty for
//    past dates and far-future (>180 days). Wrapped in bdi for the
//    same RTL-safety reason as formatMilestone — the number flanked
//    by Hebrew is otherwise reorder-prone.
export function formatRelative(days) {
  if (days === null || days === undefined) return '';
  if (days < 0 || days > 180) return '';
  let formatted;
  if (days === 0)      formatted = t('dates.today');
  else if (days === 1) formatted = t('dates.tomorrow');
  else                 formatted = `${t('dates.in')} ${days} ${t('dates.days')}`;
  return _bidiSafe(formatted);
}

// 5. Charge date — DD/MM/YYYY for transaction lists.
export function formatChargeDate(input) {
  const d = _parseDate(input);
  if (!d) return '';
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// 6. Today's date — long form, year included.
export function formatToday(input) {
  const d = input ? _parseDate(input) : new Date();
  if (!d) return '';
  const formatted = d.toLocaleDateString(_dateLocale(), {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  });
  return _bidiSafe(formatted);
}
