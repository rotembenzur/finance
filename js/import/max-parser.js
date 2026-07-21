// ─────────────────────────────────────────────────────────────────
//  MAX STATEMENT PARSER
//
//  MAX exports a flat 16-column table where each row carries the
//  last-4 of the card it belongs to (column D). One file may mix
//  rows from multiple cards, so the parser groups by last4 and the
//  importer routes each group to its matching card record.
//
//  Recognized layout (Hebrew, RTL):
//    Row 1     : "כל המשתמשים (N)"
//    Row 2     : "כל הכרטיסים (N)"
//    Row 3     : "MM/YYYY"               — statement month
//    Row 4     : column headers (16 cols A–P)
//    Row 5+    : transaction rows
//    Tail      : "סך הכל" + grand total
//
//  Column map (anchored on header text, not letter, so a future
//  reorder still works):
//    A תאריך עסקה          → date          (DD-MM-YYYY)
//    B שם בית העסק          → merchant
//    C קטגוריה              → maxCategory   (raw, not used for routing)
//    D 4 ספרות אחרונות …    → cardLast4     (routing key)
//    E סוג עסקה             → maxType       ("רגילה", etc.)
//    F סכום חיוב            → amount        (billed)
//    G מטבע חיוב            → currencySymbol
//    H סכום עסקה מקורי      → originalAmount
//    I מטבע עסקה מקורי      → originalCurrencySymbol
//    J תאריך חיוב           → billingDate   (DD-MM-YYYY)
//    K הערות                → note
//    L תיוגים               → tags          (raw)
//    M מועדון הנחות         → club          (raw)
//    N מפתח דיסקונט         → discountKey   (raw)
//    O אופן ביצוע ההעסקה    → channel       (e.g. "אינטרנט")
//    P שער המרה …           → fxRate
// ─────────────────────────────────────────────────────────────────

const _MAX_HEADERS = {
  'תאריך עסקה':                              'date',
  'שם בית העסק':                              'merchant',
  'קטגוריה':                                  'maxCategory',
  '4 ספרות אחרונות של כרטיס האשראי':           'cardLast4',
  'סוג עסקה':                                 'maxType',
  'סכום חיוב':                                'amount',
  'מטבע חיוב':                                'currencySymbol',
  'סכום עסקה מקורי':                          'originalAmount',
  'מטבע עסקה מקורי':                          'originalCurrencySymbol',
  'תאריך חיוב':                               'billingDate',
  'הערות':                                    'note',
  'תיוגים':                                   'tags',
  'מועדון הנחות':                             'club',
  'מפתח דיסקונט':                             'discountKey',
  'אופן ביצוע ההעסקה':                        'channel',
  'שער המרה ממטבע מקור/התחשבנות לש"ח':         'fxRate',
  'שער המרה ממטבע מקור/התחשבנות לש״ח':         'fxRate',  // alt geresh
};

// Required headers for confident MAX detection. The card-last4 column
// is the most distinctive — it's the routing key and the most likely
// thing to change in a future export, so we anchor on it explicitly.
const _MAX_REQUIRED = [
  'תאריך עסקה',
  'שם בית העסק',
  '4 ספרות אחרונות של כרטיס האשראי',
  'סכום חיוב',
];

const _CURRENCY_SYMBOLS = {
  '₪': 'ILS',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '฿': 'THB',
};

export function detectMaxFormat(rows) {
  // Scan up to 10 rows for the header row signature.
  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = Object.values(row).map(v => _cellText(v));
    const present = _MAX_REQUIRED.every(h => cells.includes(h));
    if (present) return { headerRowIndex: i };
  }
  return null;
}

export function parseMaxStatement(rows, filename = '') {
  const detected = detectMaxFormat(rows);
  if (!detected) {
    return {
      ok: false,
      format: null,
      errors: [{ message: 'This file does not look like a MAX export (required Hebrew headers not found).' }],
      warnings: [],
      statementMonth: null,
      chargesByCard: {},
      charges: [],
      totals: {},
    };
  }

  const { headerRowIndex } = detected;
  const headerMap = _buildHeaderMap(rows[headerRowIndex]);
  const warnings = [];

  const statementMonth = _extractStatementMonth(rows, headerRowIndex);

  const charges = [];
  const chargesByCard = Object.create(null);

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (_isBlankRow(row)) continue;

    // Footer row — first cell is "סך הכל", the next row is the total
    // value. Either way both should be skipped, and there are no real
    // charge rows after them.
    const aText = _cellText(row[headerMap.date || 'A']);
    if (aText === 'סך הכל' || aText === 'סה"כ' || aText === 'סה״כ') break;

    const charge = _parseRow(row, headerMap);
    if (!charge) continue;

    if (!charge.cardLast4) {
      warnings.push({ row: i + 1, message: `Row "${charge.merchant || '?'}" has no card number — skipped.` });
      continue;
    }

    charges.push(charge);
    (chargesByCard[charge.cardLast4] = chargesByCard[charge.cardLast4] || []).push(charge);
  }

  _disambiguateDuplicateIds(charges);

  const totals = {
    overall:    charges.reduce((s, c) => s + (c.amount || 0), 0),
    byCard:     Object.fromEntries(
      Object.entries(chargesByCard).map(([last4, list]) => [
        last4,
        list.reduce((s, c) => s + (c.amount || 0), 0),
      ]),
    ),
  };

  return {
    ok: true,
    format: 'max-xlsx',
    parsedAt: new Date().toISOString(),
    statementMonth,
    chargesByCard,
    charges,
    totals,
    warnings,
    errors: [],
  };
}

// Same-day/card/merchant/amount rows share a fingerprint id (MAX has no
// voucher numbers). Suffix repeats by row order so each charge stays
// individually editable, and re-parsing the same file is idempotent.
function _disambiguateDuplicateIds(charges) {
  const seen = new Map();
  for (const charge of charges) {
    const count = (seen.get(charge.id) || 0) + 1;
    seen.set(charge.id, count);
    if (count > 1) charge.id = `${charge.id}-${count}`;
  }
}

// ─────────────────────────────────────────
//  ROW PARSING
// ─────────────────────────────────────────

function _parseRow(row, headerMap) {
  const get = (field) => {
    const col = headerMap[field];
    return col ? row[col] : null;
  };

  const dateRaw   = _cellText(get('date'));
  const dateISO   = _parseMaxDate(dateRaw);
  if (!dateISO) return null;     // header / footer / styled separator

  const merchant  = _cellText(get('merchant')).replace(/\s+/g, ' ').trim();
  const cardLast4 = _normalizeLast4(_cellText(get('cardLast4')));
  const amount    = _toNumber(get('amount'));
  const currency  = _normalizeCurrencySymbol(_cellText(get('currencySymbol'))) || 'ILS';
  const originalAmount   = _toNumber(get('originalAmount'));
  const originalCurrency = _normalizeCurrencySymbol(_cellText(get('originalCurrencySymbol')));
  const billingDate      = _parseMaxDate(_cellText(get('billingDate')));
  const note             = _cellText(get('note')).replace(/\s+/g, ' ').trim() || null;
  const maxCategory      = _cellText(get('maxCategory')) || null;
  const maxType          = _cellText(get('maxType')) || null;
  const channel          = _cellText(get('channel')) || null;
  const fxRate           = _toNumber(get('fxRate'));

  if (amount == null && originalAmount == null) return null;

  // MAX rows don't carry a voucher number; build a stable fingerprint
  // from the fields that uniquely identify the transaction. Re-imports
  // of the same file collapse to the same id.
  const id = `max-${dateISO}-${cardLast4 || 'na'}-${merchant}-${amount}`;

  return {
    id,
    date:             dateISO,
    rawDate:          dateRaw,
    merchant,
    cardLast4,
    amount:           amount != null ? amount : null,
    currency:         currency || 'ILS',
    originalAmount,
    originalCurrency,
    billingDate,
    note,
    maxCategory,
    maxType,
    channel,
    fxRate,
    status:           'committed',     // MAX exports don't separate pending
    importedFrom:     'max-xlsx',
    importedAt:       new Date().toISOString(),
  };
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _buildHeaderMap(headerRow) {
  const map = {};
  if (!headerRow) return map;
  for (const [col, value] of Object.entries(headerRow)) {
    const text = _cellText(value);
    const field = _MAX_HEADERS[text];
    if (field) map[field] = col;
  }
  return map;
}

function _extractStatementMonth(rows, headerRowIndex) {
  // Look in the rows above the header for "MM/YYYY".
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const v of Object.values(row)) {
      const text = _cellText(v);
      const m = text.match(/^(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
    }
  }
  return null;
}

function _isBlankRow(row) {
  for (const v of Object.values(row || {})) {
    if (_cellText(v)) return false;
  }
  return true;
}

function _cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')  // bidi control marks
    .trim();
}

function _toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/[₪$€£¥฿,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function _normalizeCurrencySymbol(text) {
  if (!text) return null;
  const stripped = text.replace(/\s/g, '');
  return _CURRENCY_SYMBOLS[stripped] || null;
}

// "10-05-2026" → "2026-05-10". MAX always emits 4-digit years.
function _parseMaxDate(text) {
  if (!text) return null;
  const m = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// MAX writes last-4 as a string ("0317") but Excel sometimes loses the
// leading zero when numbers-stored-as-text gets re-interpreted. Pad to
// 4 digits when we get a pure-numeric value shorter than 4.
function _normalizeLast4(text) {
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length < 4 ? digits.padStart(4, '0') : digits.slice(-4);
}
