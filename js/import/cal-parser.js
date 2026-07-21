// ─────────────────────────────────────────────────────────────────
//  CAL STATEMENT PARSER
//
//  CAL (כאל) exports a flat 7-column XLSX per-card statement.
//  Each row is a single transaction; there's no pending/committed
//  split — all rows are treated as committed.
//
//  Recognized layout (Hebrew, RTL):
//    Row 1  : title — "פירוט עסקאות לחשבון <bank> לכרטיס מאסט..."
//    Row 3  : billing summary — "עסקאות לחיוב ב-DD/MM/YYYY: NNN ₪"
//    Row 4  : column headers (7 cols A–G)
//    Row 5+ : transaction rows
//    Tail   : disclaimer text (ignored)
//
//  Column map (header-anchored, whitespace-normalized):
//    A  תאריך עסקה  → date          (Excel serial or ISO datetime)
//    B  שם בית עסק  → merchant
//    C  סכום עסקה   → originalAmount (transaction amount)
//    D  סכום חיוב   → amount         (billed amount in ILS)
//    E  סוג עסקה    → calType        ("רגילה", "תשלומים", etc.)
//    F  ענף          → calCategory   (CAL's own category label)
//    G  הערות        → note
//
//  Detection anchor: a header row containing both "שם בית עסק"
//  and "ענף" — the "ענף" (branch/category) column is unique to CAL
//  and distinguishes it from Isracard and MAX files.
// ─────────────────────────────────────────────────────────────────

const _CAL_HEADERS = {
  'תאריך עסקה': 'date',
  'שם בית עסק': 'merchant',
  'סכום עסקה':  'originalAmount',
  'סכום חיוב':  'amount',
  'סוג עסקה':   'calType',
  'ענף':         'calCategory',
  'הערות':       'note',
};

// Detection: both these headers must be present in the same row.
const _CAL_REQUIRED = ['שם בית עסק', 'ענף'];

export function detectCalFormat(rows) {
  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = Object.values(row).map(v => _normalizeHeader(v));
    const allPresent = _CAL_REQUIRED.every(h => cells.includes(h));
    if (allPresent) return { headerRowIndex: i };
  }
  return null;
}

export function parseCalStatement(rows, filename = '') {
  const detected = detectCalFormat(rows);
  if (!detected) {
    return {
      ok: false,
      format: null,
      errors: [{ message: 'This file does not look like a CAL statement (required Hebrew headers not found).' }],
      warnings: [],
      cardLast4: null,
      statementMonth: null,
      billingDate: null,
      totals: {},
      charges: [],
    };
  }

  const { headerRowIndex } = detected;
  const headerMap = _buildHeaderMap(rows[headerRowIndex]);
  const warnings = [];

  // Card last4 — CAL doesn't embed it prominently in the file,
  // so the filename is the primary source ("... 2739 - ...").
  const cardLast4 = _extractLast4FromFilename(filename)
                 || _extractLast4FromTitle(rows);
  if (!cardLast4) {
    warnings.push({ message: 'Could not detect the card number — manual selection will be required.' });
  }

  const { billingDate, billingTotal, statementMonth } = _extractBillingSummary(rows, headerRowIndex);

  const charges = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (_isBlankRow(row)) continue;

    const charge = _parseChargeRow(row, headerMap);
    if (!charge) continue;
    charges.push(charge);
  }

  _disambiguateDuplicateIds(charges);

  const summed = charges.reduce((s, c) => s + (c.amount || 0), 0);
  if (billingTotal != null && Math.abs(summed - billingTotal) > 0.5) {
    warnings.push({
      message: `File total (₪${billingTotal.toFixed(2)}) doesn't match sum of parsed rows (₪${summed.toFixed(2)}).`,
    });
  }

  return {
    ok: true,
    format: 'cal-xlsx',
    parsedAt: new Date().toISOString(),
    cardLast4,
    statementMonth,
    billingDate,
    totals: {
      billed:     billingTotal ?? summed,
      billedFromSum: summed,
    },
    charges,
    warnings,
    errors: [],
  };
}

// Same-day/merchant/amount rows share a fingerprint id (CAL has no
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
//  ROW-LEVEL PARSING
// ─────────────────────────────────────────

function _parseChargeRow(row, headerMap) {
  const get = (field) => {
    const col = headerMap[field];
    return col ? row[col] : null;
  };

  const dateRaw     = get('date');
  const merchantRaw = _cellText(get('merchant'));
  const noteRaw     = _cellText(get('note'));

  // Skip non-data rows (totals, footers, disclaimer lines).
  if (!merchantRaw) return null;

  const dateISO = _parseCalDate(dateRaw);
  if (!dateISO) return null;

  const amount         = _toNumber(get('amount'));
  const originalAmount = _toNumber(get('originalAmount'));
  const calType        = _cellText(get('calType')) || null;
  const calCategory    = _cellText(get('calCategory')) || null;

  if (amount == null && originalAmount == null) return null;

  const merchant = merchantRaw.replace(/\s+/g, ' ').trim();

  // Stable fingerprint — CAL doesn't export voucher numbers.
  const id = `cal-${dateISO}-${merchant}-${amount ?? originalAmount}`;

  return {
    id,
    date:             dateISO,
    merchant,
    amount:           amount != null ? amount : originalAmount,
    currency:         'ILS',
    originalAmount:   originalAmount,
    originalCurrency: 'ILS',
    voucher:          null,
    note:             noteRaw ? noteRaw.replace(/\s+/g, ' ').trim() : null,
    calType,
    calCategory,
    status:           'committed',
    importedFrom:     'cal-xlsx',
    importedAt:       new Date().toISOString(),
  };
}

// ─────────────────────────────────────────
//  EXTRACTORS
// ─────────────────────────────────────────

function _extractLast4FromFilename(filename) {
  if (!filename) return null;
  // "פירוט חיובים לכרטיס מאסטרקארד 2739 - 11.07.26.xlsx"
  const m = filename.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

function _extractLast4FromTitle(rows) {
  const scanLimit = Math.min(rows.length, 5);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const v of Object.values(row)) {
      const text = _cellText(v);
      // "מאסטרקארד 2739" or "... לכרטיס ... 2739"
      const m = text.match(/לכרטיס[^0-9]*(\d{4})\b/) || text.match(/\b(\d{4})\s*$/);
      if (m) return m[1];
    }
  }
  return null;
}

// Row 3 looks like: "עסקאות לחיוב ב-02/07/2026: 389.85 ₪"
// Returns { billingDate, billingTotal, statementMonth }
function _extractBillingSummary(rows, headerRowIndex) {
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const v of Object.values(row)) {
      const text = _cellText(v);
      const m = text.match(/לחיוב\s+ב[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*:\s*([\d,.]+)/);
      if (m) {
        const dd = m[1].padStart(2, '0');
        const mm = m[2].padStart(2, '0');
        const yy = m[3];
        return {
          billingDate:    `${yy}-${mm}-${dd}`,
          billingTotal:   _toNumber(m[4]),
          statementMonth: `${yy}-${mm}`,
        };
      }
    }
  }
  return { billingDate: null, billingTotal: null, statementMonth: null };
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _buildHeaderMap(headerRow) {
  const map = {};
  if (!headerRow) return map;
  for (const [col, value] of Object.entries(headerRow)) {
    const normalized = _normalizeHeader(value);
    const field = _CAL_HEADERS[normalized];
    if (field) map[field] = col;
  }
  return map;
}

// CAL column headers contain embedded newlines ("תאריך\nעסקה").
// Normalize to the bare word run before matching.
function _normalizeHeader(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '') // bidi control marks
    .replace(/[\r\n]+/g, ' ')   // newlines → space
    .replace(/\s+/g, ' ')
    .trim();
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
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trim();
}

function _toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/[₪$€£¥฿,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// CAL stores dates as Excel serial numbers (openpyxl shows them
// as "2026-06-26 00:00:00" because it applies the cell's date format;
// xlsx-reader.js returns the raw serial as a numeric string).
// We handle both: ISO-prefix strings and Excel serials (>40000).
function _parseCalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();

  // ISO datetime prefix: "2026-06-26 00:00:00" or "2026-06-26T…"
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Excel date serial (integer, plausible range 40000–60000 ≈ 2009–2064)
  const serial = parseFloat(str);
  if (Number.isFinite(serial) && serial > 40000 && serial < 60000) {
    // Unix epoch = Excel serial 25569 (accounting for the spurious
    // 1900 leap day Excel introduced for Lotus 1-2-3 compatibility).
    const d = new Date((serial - 25569) * 86400000);
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  return null;
}
