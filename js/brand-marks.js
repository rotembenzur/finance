// ─────────────────────────────────────────────────────────────────
//  BRAND MARKS — small logos for known transaction types
//
//  A handful of transaction "types" (today: Bit, the de-facto Israeli
//  P2P payment app) are recognized by their brand on sight. For those,
//  the renderer swaps the generic emoji glyph for the actual mark.
//  Every other type continues to use its emoji — no design change.
//
//  The map is the single source of truth: add a future brand here
//  (PayPal, K-Pay, etc.) and every surface that uses iconForType()
//  picks it up automatically. Asset files live under /assets/logos/.
//
//  Output is an <img> tag with explicit width/height so layout doesn't
//  shift while the image decodes; `loading="lazy"` keeps off-screen
//  rows from racing the bundle on first paint.
// ─────────────────────────────────────────────────────────────────

const MARKS = {
  bit_transfer: { name: 'Bit', src: 'assets/logos/bit_logo.png' },
};

export function hasBrandMark(type) {
  return Object.prototype.hasOwnProperty.call(MARKS, type);
}

export function brandMarkHTML(type, { size = 16, className = 'brand-mark' } = {}) {
  const m = MARKS[type];
  if (!m) return '';
  const variant = String(type).replace(/_/g, '-');
  return `<img src="${m.src}" alt="${_esc(m.name)}" `
       + `class="${className} ${className}--${variant}" `
       + `width="${size}" height="${size}" loading="lazy" decoding="async" />`;
}

// Convenience for callers that already have an emoji fallback in hand:
// returns the brand mark when one exists for `type`, otherwise the
// caller's existing glyph. Keeps the icon column rendering one-line.
export function iconForType(type, fallback, opts) {
  return hasBrandMark(type) ? brandMarkHTML(type, opts) : fallback;
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
