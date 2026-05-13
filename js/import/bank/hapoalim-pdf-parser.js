// ─────────────────────────────────────────────────────────────────
//  HAPOALIM BANK STATEMENT PARSER  (תנועות עו"ש בחשבון)
//
//  Recognizes the PDF export of a Bank Hapoalim checking-account
//  transaction statement. The PDF is Hebrew (RTL) and uses a
//  five-column table: date, operation, debit (חובה), credit (זכות),
//  balance (יתרה בש"ח). After text extraction, each transaction
//  surfaces as two consecutive lines:
//
//    "<dd/mm/yyyy> <description> <amount> ₪<balance>"
//    "<1|2>"   ← direction tag: 1 = credit (money IN), 2 = debit (OUT)
//
//  Between transactions there's a literal "##" marker (from the
//  table border decoration). We use it as a clean separator. Header
//  lines (account info, column titles, footer pagination) are
//  filtered out with explicit anchors.
//
//  Returns a result shape compatible with the other importers in
//  this folder so the modal flow can consume it uniformly:
//
//    { ok, format, account, period, transactions[], warnings, errors }
// ─────────────────────────────────────────────────────────────────

import { readPdfPages, flattenLines } from './pdf-reader.js';

const ACCOUNT_LINE = /^(\d+)\s+(\d+)\s+12$/;        // accountNum branch bank=12
const HEADER_DATE  = /^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}$/;
const TX_LINE      = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+₪([\d,]+\.\d{2})$/;
const DIRECTION    = /^[12]$/;
const PAGE_FOOTER  = /^\d+\s*מתוך:\s*\d+\s*-/;
const COLUMN_HEAD  = /^תאריך\s+פעולה\s+חובה\s+זכות\s+יתרה/;

export async function parseHapoalimPdf(arrayBuffer) {
  const pages = await readPdfPages(arrayBuffer);
  const lines = flattenLines(pages, { rtl: true });

  const warnings = [];
  const errors   = [];

  const account = _extractAccount(lines, warnings);
  const period  = _extractPeriod(lines);

  // Walk the line stream. A transaction is anchored by a TX_LINE,
  // followed (after possible whitespace) by a single-digit direction
  // marker (1 or 2). Header lines, footers, "##" separators, and
  // empty rows are silently skipped.
  const transactions = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    const m = text.match(TX_LINE);
    if (!m) continue;

    // Look ahead for the direction tag. Allow up to 3 lines of skip
    // because the PDF sometimes interleaves "##" or blank rows
    // between the data and the tag.
    let directionText = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nextText = lines[j].text;
      if (DIRECTION.test(nextText)) { directionText = nextText; break; }
      if (TX_LINE.test(nextText))   { break; }   // next transaction — give up
    }
    if (!directionText) {
      warnings.push({ message: `Row "${text}" missing direction tag — skipped.` });
      continue;
    }

    transactions.push(_buildTransaction(m, directionText));
  }

  if (transactions.length === 0) {
    errors.push({ message: 'No transactions detected — this file may not be a Hapoalim statement.' });
  }

  return {
    ok: errors.length === 0,
    format: 'hapoalim-pdf',
    parsedAt: new Date().toISOString(),
    account,
    period,
    transactions,
    warnings,
    errors,
  };
}

// ─────────────────────────────────────────
//  EXTRACTORS
// ─────────────────────────────────────────

function _extractAccount(lines, warnings) {
  // The PDF header on every page repeats:
  //   *2407 / 03-6532407 bankhapoalim.co.il <today>
  //   שם חשבון חשבון סניף בנק
  //   <accountNumber> <branch> 12
  //   <ownerName>
  let accountInfo = null;
  let ownerName   = null;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const m = lines[i].text.match(ACCOUNT_LINE);
    if (m && !accountInfo) {
      accountInfo = {
        bankId:        'hapoalim',
        branch:        m[2],
        accountNumber: m[1],
      };
      // Owner name is typically the next non-header line.
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const t = lines[j].text;
        if (!t || HEADER_DATE.test(t) || COLUMN_HEAD.test(t) || /^תנועות/.test(t)) continue;
        ownerName = t;
        break;
      }
      break;
    }
  }
  if (!accountInfo) {
    warnings.push({ message: 'Could not detect account / branch / bank number.' });
    return null;
  }
  return {
    id:             `bank-${accountInfo.bankId}-${accountInfo.branch}-${accountInfo.accountNumber}`,
    bankId:         accountInfo.bankId,
    branch:         accountInfo.branch,
    accountNumber:  accountInfo.accountNumber,
    ownerName:      ownerName || null,
  };
}

function _extractPeriod(lines) {
  for (const line of lines) {
    const m = line.text.match(HEADER_DATE);
    if (m) {
      // Period is "DD/MM/YYYY - DD/MM/YYYY". Hapoalim writes it
      // newest-first; normalize so `from <= to`.
      const [a, b] = line.text.split('-').map(s => s.trim());
      const isoA = _parseDate(a);
      const isoB = _parseDate(b);
      if (!isoA || !isoB) return null;
      return isoA <= isoB ? { from: isoA, to: isoB } : { from: isoB, to: isoA };
    }
  }
  return null;
}

// ─────────────────────────────────────────
//  ROW PARSING
// ─────────────────────────────────────────

function _buildTransaction(rowMatch, directionText) {
  const [, rawDate, descriptionRaw, amountRaw, balanceRaw] = rowMatch;
  const date        = _parseDate(rawDate);
  const description = descriptionRaw.replace(/\s+/g, ' ').trim();
  const amount      = _toNumber(amountRaw);
  const balance     = _toNumber(balanceRaw);
  const direction   = directionText === '1' ? 'credit' : 'debit';

  return {
    // Stable id — same row across re-imports collapses to the same
    // record so notes / reconciled flags stick.
    id: _fingerprint(date, description, amount, balance),
    date,
    rawDate,
    description,
    amount,
    direction,
    balance,
    importedFrom: 'pdf:hapoalim',
    importedAt:   new Date().toISOString(),
  };
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _parseDate(text) {
  if (!text) return null;
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function _toNumber(text) {
  if (text == null) return null;
  const s = String(text).replace(/[₪,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Tiny deterministic 32-bit hash → base36. Sufficient for de-dup
// across re-imports; not a cryptographic identifier.
function _fingerprint(date, description, amount, balance) {
  const seed = `${date}|${description}|${amount}|${balance}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'bt-' + (h >>> 0).toString(36);
}
