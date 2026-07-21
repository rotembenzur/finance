// ─────────────────────────────────────────────────────────────────
//  ISRACARD STATEMENT PARSER
//
//  Recognizes the monthly statement XLSX that Isracard exports from
//  its consumer portal. The file is RTL Hebrew with a fixed structure:
//
//    Row 2     : "פירוט עסקאות"  + statement month ("יוני 2026")
//    Row 5  A  : card identity line — "‫גולד - מסטרקארד‬ - 9367"
//                (last 4 digits are how we match the card in state)
//    Row 5  H  : month total      — "₪ 3,696.41"
//    Row 8     : credit limit + remaining (informational only)
//
//    Row 12    : section banner   — "עסקאות שטרם נקלטו"   (pending)
//    Row 13    : pending column headers (4 cols)
//    Row 14+   : pending charges
//    Row N     : subtotal line    — "סה"כ עסקאות שטרם נקלטו"
//
//    Row 18    : section banner   — "עסקאות למועד חיוב"   (committed)
//    Row 19    : committed column headers (8 cols)
//    Row 20+   : committed charges
//    Row N     : grand total      — "סה"כ לחיוב החודש בכרטיס בש"ח"
//
//    Rest      : legal disclaimers — discarded.
//
//  We anchor on section headers + column headers rather than fixed
//  row numbers so a future Isracard export that adds an extra title
//  or footer row still parses.
// ─────────────────────────────────────────────────────────────────

// Column header text → field key. Two separate tables because the
// pending section omits the ILS-amount and voucher columns.
const _COMMITTED_HEADERS = {
  'תאריך רכישה':  'date',
  'שם בית עסק':   'merchant',
  'סכום עסקה':    'originalAmount',
  'מטבע עסקה':    'originalCurrencySymbol',
  'סכום חיוב':    'amount',
  'מטבע חיוב':    'currencySymbol',
  'מס\' שובר':    'voucher',
  'מס׳ שובר':     'voucher',   // alternate quote glyph just in case
  'פירוט נוסף':   'note',
};

const _PENDING_HEADERS = {
  'תאריך רכישה':  'date',
  'שם בית עסק':   'merchant',
  'סכום עסקה':    'amount',
  'מטבע עסקה':    'currencySymbol',
};

// Section banner text → which section it opens.
const _SECTION_BANNERS = {
  'עסקאות שטרם נקלטו':   'pending',
  'עסקאות למועד חיוב':    'committed',
};

// Sub/grand-total rows that share the data-row columns but aren't
// real transactions. Skipping is by exact match against col B text.
const _TOTAL_ROW_LABELS = new Set([
  'סה"כ עסקאות שטרם נקלטו',
  'סה״כ עסקאות שטרם נקלטו',
  'סה"כ לחיוב החודש בכרטיס בש"ח',
  'סה״כ לחיוב החודש בכרטיס בש״ח',
]);

const _CURRENCY_SYMBOLS = {
  '₪': 'ILS',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '฿': 'THB',
};

// Hebrew month names Isracard uses in the title row.
const _HEBREW_MONTHS = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
};

// Detect whether a parsed rows array looks like an Isracard statement.
// Used by the import flow to route to this parser vs. fall back with
// a clear error.
export function detectIsracardFormat(rows) {
  // Scan up to 30 rows for the committed-section header signature.
  const scanLimit = Math.min(rows.length, 30);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const a = (row.A || '').toString().trim();
    if (_SECTION_BANNERS[a]) return true;
  }
  return false;
}

// Parse a fully-loaded Isracard statement (rows from readXLSX).
// Returns the full result even on partial failure; check `ok` and
// `errors[]` before applying.
export function parseIsracardStatement(rows, filename = '') {
  if (!detectIsracardFormat(rows)) {
    return {
      ok: false,
      format: null,
      errors: [{ message: 'This file does not look like an Isracard statement (no recognized section banners).' }],
      warnings: [],
      cardLast4: null,
      statementMonth: null,
      totals: {},
      charges: [],
    };
  }

  const warnings = [];

  // 1. Card last4 — primary signal lives on the card-identity row
  //    (typically row 5 col A: "‫גולד - מסטרקארד‬ - 9367"). Fallback
  //    is the filename ("9367_06_2026.xlsx" → "9367").
  const cardLast4 = _extractCardLast4(rows) || _extractLast4FromFilename(filename);
  if (!cardLast4) {
    warnings.push({ message: 'Could not detect the card number — manual selection will be required.' });
  }

  // 2. Statement month — "יוני 2026" → "2026-06". Helpful in the
  //    preview header, not used for matching.
  const statementMonth = _extractStatementMonth(rows);

  // 3. Walk rows, switching mode on section banners. Each data row
  //    is interpreted against the active section's header map.
  let mode = null;                  // 'pending' | 'committed' | null
  let headerMap = null;             // current col→field mapping
  const pending = [];
  const committed = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const a = _cellText(row.A);
    const b = _cellText(row.B);

    // Section banner? Switch mode and reset header map; the next row
    // we treat as the column-header row.
    const banner = _SECTION_BANNERS[a];
    if (banner) {
      mode = banner;
      headerMap = null;
      continue;
    }

    // Inside a section but no header map yet → this row IS the header.
    if (mode && !headerMap) {
      headerMap = _buildHeaderMap(row, mode === 'pending' ? _PENDING_HEADERS : _COMMITTED_HEADERS);
      // Guard against a degenerate header row that doesn't match.
      if (Object.keys(headerMap).length === 0) {
        headerMap = null;
      }
      continue;
    }

    // Data rows can only live inside an active section with a header.
    if (!mode || !headerMap) continue;

    // Skip subtotal / grand-total rows.
    if (_TOTAL_ROW_LABELS.has(b)) continue;
    if (_isLikelyTotalRow(row, headerMap)) continue;

    // Skip blank rows.
    if (_isBlankRow(row)) continue;

    const parsed = _parseChargeRow(row, headerMap, mode);
    if (!parsed) continue;

    if (mode === 'pending') pending.push(parsed);
    else committed.push(parsed);
  }

  _disambiguateDuplicateIds([...pending, ...committed]);

  // 4. Surface totals — read directly from the file so the preview
  //    can show "header says X, summed charges say Y" if they ever
  //    disagree, instead of silently trusting one over the other.
  const totals = _extractTotals(rows);
  const summed = {
    pending:   pending.reduce((s, c) => s + (c.amount || 0), 0),
    committed: committed.reduce((s, c) => s + (c.amount || 0), 0),
  };

  if (totals.committedTotal != null && Math.abs(summed.committed - totals.committedTotal) > 0.5) {
    warnings.push({
      message: `Committed total in the file (₪${totals.committedTotal.toFixed(2)}) doesn't match the sum of parsed rows (₪${summed.committed.toFixed(2)}).`,
    });
  }

  return {
    ok: true,
    format: 'isracard-xlsx',
    parsedAt: new Date().toISOString(),
    cardLast4,
    statementMonth,
    totals: {
      pending:           totals.pendingTotal           ?? summed.pending,
      committed:         totals.committedTotal         ?? summed.committed,
      pendingFromSum:    summed.pending,
      committedFromSum:  summed.committed,
    },
    charges: [...pending, ...committed],
    pending,
    committed,
    warnings,
    errors: [],
  };
}

// Rows without a voucher number fall back to a (date, merchant, amount)
// fingerprint, which collides when two same-day charges match exactly.
// Suffix repeats by row order so each charge stays individually editable,
// and re-parsing the same file is idempotent.
function _disambiguateDuplicateIds(charges) {
  const seen = new Map();
  for (const charge of charges) {
    const count = (seen.get(charge.id) || 0) + 1;
    seen.set(charge.id, count);
    if (count > 1) charge.id = `${charge.id}-${count}`;
  }
}

// ─────────────────────────────────────────
//  ROW-LEVEL PARSING
// ─────────────────────────────────────────

function _parseChargeRow(row, headerMap, mode) {
  const get = (field) => {
    const col = headerMap[field];
    return col ? row[col] : null;
  };

  const dateRaw     = _cellText(get('date'));
  const merchantRaw = _cellText(get('merchant'));
  const voucherRaw  = _cellText(get('voucher'));
  const noteRaw     = _cellText(get('note'));

  if (!dateRaw && !merchantRaw && !voucherRaw) return null;

  // Hard requirement: a real charge row begins with an Israeli short
  // date (DD.MM.YY). Anything else is a footer / disclaimer / styled
  // separator and we bail out before doing more work.
  const dateISO = _parseIsraeliShortDate(dateRaw);
  if (!dateISO) return null;
  const merchant = merchantRaw.replace(/\s+/g, ' ').trim();

  // Committed rows have separate "transaction" + "billing" amounts;
  // pending rows only have a transaction amount which is also the
  // billed amount (always ILS in the Isracard pending section).
  let amount, originalAmount, originalCurrency, currency;
  if (mode === 'committed') {
    amount           = _toNumber(get('amount'));                  // ILS amount billed
    currency         = _normalizeCurrencySymbol(_cellText(get('currencySymbol'))) || 'ILS';
    originalAmount   = _toNumber(get('originalAmount'));
    originalCurrency = _normalizeCurrencySymbol(_cellText(get('originalCurrencySymbol')));
  } else {
    amount           = _toNumber(get('amount'));
    currency         = _normalizeCurrencySymbol(_cellText(get('currencySymbol'))) || 'ILS';
    originalAmount   = null;
    originalCurrency = null;
  }

  if (amount == null && originalAmount == null) return null;

  // Build a stable charge ID — voucher number when present, otherwise
  // a fingerprint of (date, merchant, amount) so the same pending row
  // re-imports as the same record. Hebrew survives untouched here;
  // localStorage stores it as JSON, the UI never displays raw IDs.
  const id = voucherRaw
    ? `isr-${voucherRaw}`
    : `isr-fb-${dateISO}-${merchant}-${amount}`;

  return {
    id,
    date:             dateISO || null,
    rawDate:          dateRaw || null,
    merchant,
    amount:           amount != null ? amount : null,
    currency:         currency || 'ILS',
    originalAmount:   originalAmount,
    originalCurrency: originalCurrency,
    voucher:          voucherRaw || null,
    note:             noteRaw ? noteRaw.replace(/\s+/g, ' ').trim() : null,
    status:           mode,                  // 'pending' | 'committed'
    importedFrom:     'isracard-xlsx',
    importedAt:       new Date().toISOString(),
  };
}

// ─────────────────────────────────────────
//  EXTRACTORS (header / month / totals / last4)
// ─────────────────────────────────────────

function _extractCardLast4(rows) {
  // Walk the first 10 rows — Isracard puts the card identity high.
  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const text = _cellText(row.A);
    if (!text) continue;
    // Match a 4-digit run preceded by "- " (the masked card format
    // "‫... - 9367‬"). Loose enough to handle bidi marks and variants.
    const m = text.match(/(\d{4})\s*$/);
    if (m) return m[1];
    const m2 = text.match(/-\s*(\d{4})\b/);
    if (m2) return m2[1];
  }
  return null;
}

function _extractLast4FromFilename(filename) {
  if (!filename) return null;
  const m = filename.match(/(\d{4})[_\-\s]/);
  return m ? m[1] : null;
}

function _extractStatementMonth(rows) {
  // Look for "<Hebrew month> <YYYY>" in the first few rows.
  const scanLimit = Math.min(rows.length, 6);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const key of ['A', 'B', 'C', 'D']) {
      const text = _cellText(row[key]);
      if (!text) continue;
      const m = text.match(/([֐-׿]+)\s+(\d{4})/);
      if (!m) continue;
      const month = _HEBREW_MONTHS[m[1]];
      if (month) return `${m[2]}-${String(month).padStart(2, '0')}`;
    }
  }
  return null;
}

function _extractTotals(rows) {
  const out = { pendingTotal: null, committedTotal: null };
  for (const row of rows) {
    if (!row) continue;
    const label = _cellText(row.B);
    if (!label) continue;
    if (label === 'סה"כ עסקאות שטרם נקלטו' || label === 'סה״כ עסקאות שטרם נקלטו') {
      out.pendingTotal = _toNumber(row.C);
    } else if (label.startsWith('סה"כ לחיוב החודש') || label.startsWith('סה״כ לחיוב החודש')) {
      out.committedTotal = _toNumber(row.E);
    }
  }
  return out;
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _buildHeaderMap(headerRow, schema) {
  const map = {};
  if (!headerRow) return map;
  for (const [col, value] of Object.entries(headerRow)) {
    const text = _cellText(value);
    if (!text) continue;
    const field = schema[text];
    if (field) map[field] = col;
  }
  return map;
}

function _isBlankRow(row) {
  for (const v of Object.values(row || {})) {
    if (_cellText(v)) return false;
  }
  return true;
}

// Heuristic: a row that has an amount but no date AND no merchant is
// almost certainly a summary line (or a blank styled row).
function _isLikelyTotalRow(row, headerMap) {
  const date     = _cellText(row[headerMap.date]);
  const merchant = _cellText(row[headerMap.merchant]);
  return !date && !merchant;
}

// Convert raw cell value (XLSX values can be number, string, '', null)
// to a trimmed string. Strips RTL/LTR control marks that Isracard
// embeds around the card identity line.
function _cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trim();
}

function _toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  // Tolerate "₪ 1,234.56" / "1,234.5" / "-50" / "+30".
  const s = String(value).replace(/[₪$€£¥฿,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function _normalizeCurrencySymbol(text) {
  if (!text) return null;
  const stripped = text.replace(/\s/g, '');
  return _CURRENCY_SYMBOLS[stripped] || null;
}

// "11.05.26" → "2026-05-11". Isracard uses 2-digit years on a
// 20XX timeline; everything in this format is post-2000.
function _parseIsraeliShortDate(text) {
  if (!text) return null;
  const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yy   = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

