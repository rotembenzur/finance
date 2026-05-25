// ─────────────────────────────────────────────────────────────────
//  HAPOALIM BANK STATEMENT PARSER — XLSX  (תדפיס פירוט תנועות עו"ש)
//
//  Recognizes the Excel (.xlsx) export of a Bank Hapoalim checking-
//  account transaction list — the "תנועות בחשבון" sheet you get from
//  the web/app "export to Excel" button, as opposed to the printed
//  PDF that hapoalim-pdf-parser.js handles.
//
//  Layout (Hebrew, right-to-left sheet; columns are logical A–J and
//  are mapped by HEADER TEXT, not letter, so a column reorder still
//  parses):
//
//    Row 1  תנועות בחשבון                          ← title
//    Row 2  מספר חשבון  12-661-406239  תאריך הפקה …  ← account header
//    Row 3  תאריך · הפעולה · פרטים · אסמכתא ·         ← column headers
//           חובה · זכות · יתרה בש"ח · תאריך ערך ·
//           לטובת · עבור
//    Row 4+ data rows
//
//  Two structural differences from the PDF format this folder already
//  supports:
//    · Direction lives in SEPARATE columns — exactly one of חובה
//      (debit / money out) or זכות (credit / money in) carries a
//      number per row; the other is blank. (The PDF used a single
//      amount column plus a "1"/"2" direction tag.)
//    · Dates are Excel serial numbers (1900 date system), not
//      dd/mm/yyyy strings. Amounts are bare numbers (no ₪, no commas).
//
//  Returns the same result shape as the other importers so the modal
//  flow (bank-import-flow.js) consumes it uniformly:
//
//    { ok, format, account, period, transactions[], warnings, errors }
// ─────────────────────────────────────────────────────────────────

import { readXLSX } from '../xlsx-reader.js';

// Column header text → internal field. Anchored on the header text so
// a future column reorder still maps correctly. 'תאריך' (transaction
// date) is matched EXACTLY so it isn't shadowed by 'תאריך ערך' (value
// date); the balance header ("יתרה בש''ח") is matched by prefix.
const HEADER_TO_FIELD = [
  { field: 'date',        match: (h) => h === 'תאריך' },
  { field: 'operation',   match: (h) => h === 'הפעולה' },
  { field: 'details',     match: (h) => h === 'פרטים' },
  { field: 'reference',   match: (h) => h === 'אסמכתא' },
  { field: 'debit',       match: (h) => h === 'חובה' },
  { field: 'credit',      match: (h) => h === 'זכות' },
  { field: 'balance',     match: (h) => h.startsWith('יתרה') },
  { field: 'valueDate',   match: (h) => h === 'תאריך ערך' },
  { field: 'beneficiary', match: (h) => h === 'לטובת' },
  { field: 'forWhom',     match: (h) => h === 'עבור' },
];

// A row only counts as the header row if it carries every load-bearing
// column. Guards against matching a stray cell in the title/account rows.
const REQUIRED_FIELDS = ['date', 'debit', 'credit', 'balance'];

// "12-661-406239" → bank 12 (Hapoalim), branch 661, account 406239.
const ACCOUNT_RE = /(\d{1,3})-(\d{2,3})-(\d{3,})/;

export async function parseHapoalimXlsx(arrayBuffer) {
  let rows;
  try {
    rows = await readXLSX(arrayBuffer);
  } catch (e) {
    return _fail(`Could not read the Excel file: ${e.message}`);
  }

  const header = _findHeaderRow(rows);
  if (!header) {
    return _fail(
      'No recognizable column headers (תאריך / חובה / זכות / יתרה) — ' +
      'this may not be a Bank Hapoalim Excel statement.'
    );
  }

  const warnings = [];
  const errors   = [];
  const col      = header.map;

  const account = _extractAccount(rows, header.rowIndex, warnings);

  const transactions = [];
  for (let i = header.rowIndex + 1; i < rows.length; i++) {
    const tx = _buildTransaction(rows[i], col, warnings);
    if (tx) transactions.push(tx);
  }

  if (transactions.length === 0) {
    errors.push({ message: 'No transactions detected in the Excel file.' });
  }

  return {
    ok: errors.length === 0,
    format: 'hapoalim-xlsx',
    parsedAt: new Date().toISOString(),
    account,
    period: _derivePeriod(transactions),
    transactions,
    warnings,
    errors,
  };
}

// ─────────────────────────────────────────
//  STRUCTURE DETECTION
// ─────────────────────────────────────────

function _findHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row) continue;
    const map = _buildHeaderMap(row);
    if (REQUIRED_FIELDS.every((f) => map[f])) return { rowIndex: i, map };
  }
  return null;
}

function _buildHeaderMap(row) {
  const map = {};
  for (const [colLetter, value] of Object.entries(row)) {
    const text = _cellText(value);
    if (!text) continue;
    for (const { field, match } of HEADER_TO_FIELD) {
      if (!map[field] && match(text)) { map[field] = colLetter; break; }
    }
  }
  return map;
}

function _extractAccount(rows, headerRowIndex, warnings) {
  // The account line sits in the title rows above the header, e.g.
  //   "מספר חשבון  12-661-406239  תאריך הפקה  25.05.2026"
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const value of Object.values(row)) {
      const m = _cellText(value).match(ACCOUNT_RE);
      if (!m) continue;
      const [, bankCode, branch, accountNumber] = m;
      const bankId = bankCode === '12' ? 'hapoalim' : `bank${bankCode}`;
      return {
        // Same id scheme as the PDF parser, so importing the XLSX of an
        // account already imported from PDF updates the SAME account
        // record instead of creating a duplicate.
        id:            `bank-${bankId}-${branch}-${accountNumber}`,
        bankId,
        branch,
        accountNumber,
        // ownerName intentionally omitted: the Excel header doesn't
        // carry it, and emitting `null` would clobber a name set by a
        // prior PDF import (bank-import-flow spreads result.account).
      };
    }
  }
  warnings.push({ message: 'Could not detect the account number from the Excel header.' });
  return null;
}

// ─────────────────────────────────────────
//  ROW PARSING
// ─────────────────────────────────────────

function _buildTransaction(row, col, warnings) {
  if (!row) return null;

  // No parseable date → title / column-header / footer / blank row.
  const date = _serialToISO(row[col.date]);
  if (!date) return null;

  // Exactly one of debit/credit is populated per row. Debit checked
  // first; if a malformed row had both, treating it as money-out is
  // the safe default (and we flag it).
  const debit  = _toNumber(row[col.debit]);
  const credit = _toNumber(row[col.credit]);

  let direction, amount;
  if (debit != null && debit > 0) {
    direction = 'debit';  amount = debit;
    if (credit != null && credit > 0) {
      warnings.push({ message: `Row dated ${date} has both debit and credit — treated as debit.` });
    }
  } else if (credit != null && credit > 0) {
    direction = 'credit'; amount = credit;
  } else {
    return null;   // zero / blank money row (e.g. an informational line)
  }

  const balance     = _toNumber(row[col.balance]);
  const reference    = _normalizeReference(row[col.reference]);
  const description = _composeDescription(
    _cellText(row[col.operation]),
    _cellText(row[col.details]),
  );

  return {
    // Stable id so a re-import of the same statement collapses to the
    // same record (notes / reconciled flags survive). The bank's
    // asmachta (reference) is unique per transaction; date+amount+
    // balance back it up if it's ever missing.
    id: _fingerprint(date, amount, balance, reference),
    date,
    rawDate:      _isoToDisplay(date),
    description,
    amount,
    direction,
    balance,
    reference:    reference || null,
    importedFrom: 'xlsx:hapoalim',
    importedAt:   new Date().toISOString(),
  };
}

function _composeDescription(operation, details) {
  return [operation, details]
    .map((s) => (s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' — ');
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _cellText(v) {
  return v == null ? '' : String(v).trim();
}

function _toNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[₪,\s]/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Big asmachta numbers come through as scientific notation
// ("1.078436891233E12"); render them as a plain integer string so the
// value (and the fingerprint built from it) is stable across exports.
function _normalizeReference(v) {
  const s = _cellText(v);
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) >= 1e6 ? String(Math.round(n)) : s;
}

// Excel serial date (1900 system) → "YYYY-MM-DD". Excel's day 0 is
// 1899-12-30, so serial 25569 = 1970-01-01 (the Unix epoch); the
// offset already absorbs Excel's fictional 1900-02-29 for every date
// after 1900-03-01 (all real bank dates qualify). The 20000–80000
// guard (~1954–2119) rejects non-date cells so header/footer rows and
// stray numbers are skipped rather than turning into bogus dates.
function _serialToISO(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  if (isNaN(d.getTime())) return null;
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function _isoToDisplay(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function _derivePeriod(transactions) {
  if (!transactions.length) return null;
  let from = transactions[0].date;
  let to   = transactions[0].date;
  for (const t of transactions) {
    if (t.date < from) from = t.date;
    if (t.date > to)   to   = t.date;
  }
  return { from, to };
}

// Tiny deterministic 32-bit FNV-1a hash → base36. Same scheme + 'bt-'
// prefix as the PDF parser so all bank transactions share one id
// namespace. Sufficient for de-dup across re-imports; not cryptographic.
function _fingerprint(date, amount, balance, reference) {
  const seed = `${date}|${amount}|${balance}|${reference || ''}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'bt-' + (h >>> 0).toString(36);
}

function _fail(message) {
  return {
    ok: false,
    format: 'hapoalim-xlsx',
    parsedAt: new Date().toISOString(),
    account: null,
    period: null,
    transactions: [],
    warnings: [],
    errors: [{ message }],
  };
}
