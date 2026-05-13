// ─────────────────────────────────────────────────────────────────
//  IBI BROKER REPORT PARSER
//
//  Recognizes the holdings report exported from IBI's broker portal
//  (Hebrew column headers, one row per security). Maps each row to
//  a holding entry in the app's local taxonomy and derives portfolio
//  totals from the holdings.
//
//  Strict rule: only fields present (or directly derivable) from the
//  file end up in the result. No invented metrics, no estimates.
// ─────────────────────────────────────────────────────────────────

// Map of expected Hebrew header text → local field key. Lookup is by
// header text rather than fixed column letter, so a future IBI export
// that reorders columns will still parse.
const _IBI_HEADERS = {
  'שם נייר':              'name',
  'מספר נייר':            'ibiSecurityId',
  'סימבול':               'ticker',
  'סוג נייר':             'ibiType',
  'מטבע':                 'ibiCurrency',
  'כמות נוכחית':          'quantity',
  'שער':                  'rate',
  '% שינוי':              'dailyChangePercent',
  'שווי נוכחי':           'currentValue',
  'רווח/הפסד יומי':       'dailyChange',
  'שינוי מעלות':          'gain',
  'שינוי מעלות ב%':       'gainPercent',
  'עלות':                 'invested',
  'אחוז אחזקה':           'allocationPct',
};

// Required headers for confident IBI detection. If any are missing, we
// don't proceed — better to fail clearly than guess.
const _IBI_REQUIRED_HEADERS = ['שם נייר', 'מספר נייר', 'שווי נוכחי', 'עלות'];

// IBI's "type" string → our internal type + asset class hint.
// `isTechnical: true` marks system/protection instruments that should
// never appear as real exposure (e.g. tax shields). Those rows still
// import — the data is preserved — but they're filtered out of the
// holdings list and the allocation chart.
const _IBI_TYPE_MAP = {
  'מט"ח מזומן':           { type: 'cash_position',   assetClass: 'cash'         },
  'תפ"ס/פח"ק':            { type: 'tax_shield',      assetClass: null,          isTechnical: true },
  'מניה':                 { type: 'stock_portfolio', assetClass: 'single_stock' },
  'מניה זרה בחו"ל':       { type: 'stock_portfolio', assetClass: 'single_stock' },
  'קרנות נאמנות':         { type: 'etf',             assetClass: null           },
  'קרנות נאמנות זרות':    { type: 'etf',             assetClass: null           },
  'אגרות חוב':            { type: 'bond',            assetClass: 'bonds'        },
};

// Currency abbreviation extracted from IBI's verbose currency strings
// like "שקל חדש                    000" / "דולר אמריקאי               001".
function _normalizeCurrency(raw) {
  if (!raw) return null;
  if (raw.includes('שקל'))  return 'ILS';
  if (raw.includes('דולר')) return 'USD';
  if (raw.includes('יורו')) return 'EUR';
  return null;
}

// Asset-class refinement from name + ticker. Conservative: returns
// null when uncertain rather than guessing.
function _deriveAssetClass(name, ticker, ibiType) {
  if (ibiType && (ibiType.includes('מט"ח') || ibiType.includes('פח"ק'))) return 'cash';
  if (ibiType && ibiType.includes('אגרות חוב'))                          return 'bonds';

  const text = `${name || ''} ${ticker || ''}`.toUpperCase();

  // Specific tickers first — order matters (VT before VTI before generic).
  if (/\bAAPL\b|AAPLE/.test(text))              return 'single_stock';
  if (/\bBND\b/.test(text))                     return 'bonds';
  if (/\bVTI\b/.test(text))                     return 'us_equity';
  if (/\bVT\b(?!\w)/.test(text))                return 'global_equity';
  if (/\bVOO\b/.test(text))                     return 'us_equity';
  if (/\bIVW\b|\bIVV\b|\bSPY\b/.test(text))     return 'us_equity';

  // Index families
  if (/NASDAQ/.test(text))                      return 'us_tech';
  if (/S&P\s?500|SP\s?500|SP500/.test(text))    return 'us_equity';

  // Last-resort by IBI type
  if (ibiType && ibiType.includes('מניה'))      return 'single_stock';
  return null;
}

function _toNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Strings like "-17.4%" — strip % then parse.
  const s = String(raw).replace(/[%,\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Build a header map: { 'name': 'A', 'ibiSecurityId': 'B', ... }
function _buildHeaderMap(headerRow) {
  const map = {};
  if (!headerRow) return map;
  for (const [col, text] of Object.entries(headerRow)) {
    const key = _IBI_HEADERS[(text || '').trim()];
    if (key) map[key] = col;
  }
  return map;
}

// Detect that the rows came from an IBI report. Returns null if no
// match, or { headerMap, headerRowIndex } if confident.
export function detectIBIFormat(rows) {
  // Expect headers in row 1 (index 0). Be lenient: scan the first 3
  // rows in case there's a leading blank or title row.
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const row = rows[i];
    if (!row) continue;
    const headerMap = _buildHeaderMap(row);
    const present = _IBI_REQUIRED_HEADERS.every(h => {
      const key = _IBI_HEADERS[h];
      return headerMap[key] !== undefined;
    });
    if (present) return { headerMap, headerRowIndex: i };
  }
  return null;
}

// Parse a fully-loaded IBI report (`rows` from readXLSX) into the
// app's import shape.
export function parseIBIReport(rows) {
  const detected = detectIBIFormat(rows);
  if (!detected) {
    return {
      ok: false,
      format: null,
      errors: [{ message: 'This file does not look like an IBI portfolio report (required Hebrew headers not found).' }],
      warnings: [],
      portfolio: null,
      holdings: [],
    };
  }

  const { headerMap, headerRowIndex } = detected;
  const get = (row, field) => {
    const col = headerMap[field];
    return col ? (row?.[col] ?? null) : null;
  };

  const holdings = [];
  const warnings = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const id   = String(get(row, 'ibiSecurityId') || '').trim();
    const name = String(get(row, 'name') || '').trim();

    // Skip rows missing identity — could be a totals row or padding.
    if (!id && !name) continue;
    if (!id) {
      warnings.push({ row: i + 1, message: `Row "${name}" has no security ID — skipped to avoid duplicate-on-resync.` });
      continue;
    }

    const ibiType    = (get(row, 'ibiType')     || '').trim();
    const ticker     = (get(row, 'ticker')      || '').trim() || null;
    const ibiCurr    = get(row, 'ibiCurrency')  || '';
    const currency   = _normalizeCurrency(ibiCurr);

    const quantity     = _toNumber(get(row, 'quantity'));
    const currentValue = _toNumber(get(row, 'currentValue'));
    const invested     = _toNumber(get(row, 'invested'));
    const gain         = _toNumber(get(row, 'gain'));
    const gainPercent  = _toNumber(get(row, 'gainPercent'));
    const dailyAbs     = _toNumber(get(row, 'dailyChange'));
    const dailyPct     = _toNumber(get(row, 'dailyChangePercent'));
    const allocPct     = _toNumber(get(row, 'allocationPct'));

    const typeInfo = _IBI_TYPE_MAP[ibiType] || { type: 'investment_fund', assetClass: null };
    const assetClass = _deriveAssetClass(name, ticker, ibiType) || typeInfo.assetClass;

    holdings.push({
      ibiSecurityId:      id,
      name,
      ticker,
      ibiType,
      type:               typeInfo.type,
      assetClass,
      isTechnical:        typeInfo.isTechnical || false,
      currency:           currency || 'ILS',
      quantity,
      currentValue,
      invested,
      gain,
      gainPercent,
      dailyChange:        dailyAbs,
      dailyChangePercent: dailyPct,
      allocationPct:      allocPct,
    });
  }

  // Derive portfolio totals from holdings — strictly from data present
  // in the file. A holding's currentValue/invested may be null; we sum
  // only what's there.
  const sum = (key) => holdings.reduce((acc, h) => acc + (h[key] || 0), 0);

  const totalValue    = sum('currentValue');
  const totalInvested = sum('invested');
  const totalGain     = totalInvested ? (totalValue - totalInvested) : null;
  const totalGainPct  = totalInvested ? (totalGain / totalInvested) * 100 : null;
  const dailyChange   = sum('dailyChange');

  return {
    ok: true,
    format: 'ibi-xlsx',
    parsedAt: new Date().toISOString(),
    portfolio: {
      totalValue,
      totalInvested,
      totalGain,
      totalGainPercent: totalGainPct,
      dailyChange,
      dailyChangePercent: null,   // not present in this report shape
    },
    holdings,
    warnings,
    errors: [],
  };
}
