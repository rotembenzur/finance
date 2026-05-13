// ─────────────────────────────────────────────────────────────────
//  PDF READER  (browser, pdf.js from CDN)
//
//  Thin wrapper around Mozilla's pdf.js that returns positioned text
//  items per page. Bank PDFs use multi-column layouts where the
//  reading order of the raw text stream doesn't match the logical
//  table rows — we always need the (x, y) of each glyph run to
//  reconstruct the original layout. This module hides the pdf.js
//  bootstrap (CDN load + worker URL) so the bank parsers can just
//  ask `readPdfPages(arrayBuffer)` and get a clean shape back.
//
//  Returned shape:
//
//    [
//      {
//        pageNumber: 1,
//        width, height,
//        items: [
//          { str, x, y, height, width },
//          …
//        ],
//      },
//      …
//    ]
//
//  All coordinates are in PDF user space (origin at bottom-left).
// ─────────────────────────────────────────────────────────────────

// Pinned to a known-good version so CDN drift doesn't break parsing.
const PDFJS_VERSION = '4.7.76';
const PDFJS_BASE    = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let _pdfjsModule = null;

async function _getPdfjs() {
  if (_pdfjsModule) return _pdfjsModule;
  const mod = await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`);
  if (mod.GlobalWorkerOptions) {
    mod.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
  }
  _pdfjsModule = mod;
  return mod;
}

export async function readPdfPages(arrayBuffer) {
  const pdfjs = await _getPdfjs();
  const data  = new Uint8Array(arrayBuffer);
  const doc   = await pdfjs.getDocument({ data }).promise;

  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page    = await doc.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    // pdf.js text items carry a transform matrix [a, b, c, d, e, f]
    // where (e, f) is the translation. We surface (x, y) directly so
    // callers don't need to know about the matrix.
    const items = content.items.map(it => ({
      str:    it.str,
      x:      it.transform ? it.transform[4] : 0,
      y:      it.transform ? it.transform[5] : 0,
      height: it.height || 0,
      width:  it.width  || 0,
    }));

    out.push({
      pageNumber: p,
      width:  viewport.width,
      height: viewport.height,
      items,
    });
  }
  return out;
}

// Convenience — flatten the per-page items into one stream of lines.
// Lines are grouped by their y coordinate (rounded) so glyph runs
// that landed on the same visual row end up together. Within each
// line, items are sorted by descending x because Hapoalim PDFs are
// authored right-to-left (Hebrew); reading them right→left yields
// the human-readable text order.
export function flattenLines(pages, { rtl = true } = {}) {
  const lines = [];
  for (const page of pages) {
    const groups = new Map();
    for (const it of page.items) {
      const y = Math.round(it.y);
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(it);
    }
    const yKeys = [...groups.keys()].sort((a, b) => b - a);
    for (const y of yKeys) {
      const row = groups.get(y).slice().sort((a, b) => rtl ? b.x - a.x : a.x - b.x);
      const text = row.map(x => x.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push({ pageNumber: page.pageNumber, y, text, items: row });
    }
  }
  return lines;
}
