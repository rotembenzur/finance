// ─────────────────────────────────────────────────────────────────
//  XLSX READER  (browser-native, no vendored library)
//
//  XLSX = a ZIP archive of XML files. We parse the ZIP central
//  directory manually, inflate compressed entries with the browser's
//  DecompressionStream API, then walk the worksheet XML with
//  DOMParser. Returns a sparse 2D map of rows where each row is an
//  object keyed by column letter (e.g. row[2] = { A: '…', I: '…' }).
//
//  Scope: handles the typical XLSX structure produced by IBI's
//  broker-portal export. Does not handle ZIP64, encryption, or
//  formula cells (cell values are read directly).
// ─────────────────────────────────────────────────────────────────

export async function readXLSX(arrayBuffer) {
  const files = await _unzip(arrayBuffer);
  const decoder = new TextDecoder('utf-8');

  // Shared strings table (some XLSX files use it; IBI does not, but
  // be ready in case the format ever changes).
  let sharedStrings = [];
  if (files['xl/sharedStrings.xml']) {
    sharedStrings = _parseSharedStrings(decoder.decode(files['xl/sharedStrings.xml']));
  }

  const sheetBytes = files['xl/worksheets/sheet1.xml'] || files['xl/worksheets/sheet01.xml'];
  if (!sheetBytes) throw new Error('XLSX has no readable worksheet (expected xl/worksheets/sheet1.xml)');

  return _parseSheet(decoder.decode(sheetBytes), sharedStrings);
}

// ── ZIP unpacking ────────────────────────────────────────────────

async function _unzip(arrayBuffer) {
  const view  = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const len   = view.byteLength;

  // 1. Locate End of Central Directory Record (signature 0x06054b50).
  //    Search backwards from end of file across the max comment span (64KB).
  const SIG_EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP/XLSX (end-of-central-directory not found)');

  const cdEntries = view.getUint16(eocd + 10, true);
  const cdOffset  = view.getUint32(eocd + 16, true);

  // 2. Walk Central Directory entries.
  const SIG_CD  = 0x02014b50;
  const SIG_LFH = 0x04034b50;
  const decoder = new TextDecoder('utf-8');
  const out = {};

  let cur = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(cur, true) !== SIG_CD) {
      throw new Error(`Invalid central directory entry at offset ${cur}`);
    }
    const compMethod = view.getUint16(cur + 10, true);
    const compSize   = view.getUint32(cur + 20, true);
    const nameLen    = view.getUint16(cur + 28, true);
    const extraLen   = view.getUint16(cur + 30, true);
    const commentLen = view.getUint16(cur + 32, true);
    const lfhOffset  = view.getUint32(cur + 42, true);
    const filename   = decoder.decode(bytes.subarray(cur + 46, cur + 46 + nameLen));

    // 3. Read corresponding Local File Header to find data start.
    if (view.getUint32(lfhOffset, true) !== SIG_LFH) {
      throw new Error(`Invalid local file header for ${filename}`);
    }
    const lfhNameLen  = view.getUint16(lfhOffset + 26, true);
    const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
    const dataStart   = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const compressed  = bytes.subarray(dataStart, dataStart + compSize);

    let data;
    if (compMethod === 0) {
      // Stored — no compression.
      data = compressed;
    } else if (compMethod === 8) {
      // Deflate (raw, no zlib header).
      data = await _inflateRaw(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compMethod} for ${filename}`);
    }
    out[filename] = data;

    cur += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

async function _inflateRaw(deflated) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(deflated);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ── XML parsing ──────────────────────────────────────────────────

function _parseSharedStrings(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(_byLocalName(doc, 'si')).map(si => si.textContent || '');
}

function _parseSheet(xml, sharedStrings) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Worksheet XML failed to parse');
  }
  const rows = [];
  for (const row of _byLocalName(doc, 'row')) {
    const r = parseInt(row.getAttribute('r') || '0', 10);
    if (!r) continue;
    const cells = {};
    for (const c of _byLocalName(row, 'c')) {
      const ref = c.getAttribute('r') || '';
      const col = ref.replace(/[0-9]/g, '');
      if (!col) continue;
      const t  = c.getAttribute('t');
      const v  = _byLocalName(c, 'v')[0];
      const is = _byLocalName(c, 'is')[0];

      let value = null;
      if (is) {
        // Inline string
        value = is.textContent || '';
      } else if (v) {
        const raw = v.textContent || '';
        if (t === 's') {
          value = sharedStrings[parseInt(raw, 10)] || '';
        } else if (t === 'b') {
          value = raw === '1';
        } else {
          value = raw;
        }
      } else if (t === 'str' || t === 'inlineStr') {
        value = c.textContent || '';
      }
      cells[col] = value;
    }
    rows[r - 1] = cells;
  }
  return rows;
}

// Namespace-agnostic tag lookup. XLSX files come in two flavors:
// some writers emit bare `<row>` / `<c>` (e.g. IBI's broker portal),
// others prefix with `<x:row>` / `<x:c>` (Isracard's statements).
// getElementsByTagNameNS('*', name) matches the local name regardless
// of prefix and is supported by every browser DOMParser plus xmldom.
function _byLocalName(node, name) {
  return Array.from(node.getElementsByTagNameNS('*', name));
}
