// Standalone test for the assistant Markdown renderer in js/app.js.
// Run with:  node js/markdown-render.test.js
//
// app.js is a browser ES module with DOM/import dependencies, so we can't
// require() it here. Instead we extract the pure renderer functions by
// name and eval them — the same trick used while developing them. No
// framework: plain assertions, non-zero exit on failure.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function grab(name) {
  const m = src.match(new RegExp('function ' + name + '\\s*\\([^]*?\\n\\}', 'm'));
  if (!m) throw new Error('could not extract function ' + name + ' from app.js');
  return m[0];
}
// Order doesn't matter (function declarations hoist), but list the deps.
const NAMES = [
  '_esc', '_mdInline',
  '_mdTableRow', '_isTableSep', '_mdTableAligns', '_renderMarkdownTable',
  '_looksLikePipeRow', '_collapseTableBlanks', '_renderMarkdown',
];
// _renderMarkdown now calls normalizeDashes, which lives in
// js/intelligence/insights-normalize.js — the same dash rule the
// insights surface enforces. Pull it in so the renderer under test is
// the real one, not a stub.
const normSrc = fs.readFileSync(
  path.join(__dirname, 'intelligence', 'insights-normalize.js'), 'utf8');
const dashFn = normSrc.match(/export function normalizeDashes\s*\([^]*?\n\}/m);
if (!dashFn) throw new Error('could not extract normalizeDashes');

eval(NAMES.map(grab).join('\n') + '\n' + dashFn[0].replace('export ', ''));

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('✗ ' + label); }
}

// ── The real assistant output: blank lines between EVERY table row ──
// (header, separator, data — exactly as reported, in Hebrew/RTL.)
const REAL = [
  '| תאריך | תיאור | סכום |',
  '',
  '|-------|-------|------|',
  '',
  '| 19/05 | טיסה לדובאי — ישראייר | ₪2,149 |',
].join('\n');

let h = _renderMarkdown(REAL);
check('real output → a <table>',            h.includes('<table class="intel-ask-table">'));
check('real output → scroll wrapper',       h.includes('<div class="intel-ask-table-wrap">'));
check('real output → NOT raw text',         !h.includes('|-------|'));
check('real output → 3 header cells',       (h.match(/<th[ >]/g) || []).length === 3);
check('real output → Hebrew headers',       h.includes('<th>תאריך</th>') && h.includes('<th>סכום</th>'));
check('real output → data cells',           h.includes('<td>19/05</td>') &&
                                            h.includes('<td>טיסה לדובאי — ישראייר</td>') &&
                                            h.includes('<td>₪2,149</td>'));

// ── Each kind of blank-line gap, individually ──
check('blank between header & separator', _renderMarkdown('| A | B |\n\n|---|---|\n| 1 | 2 |').includes('<table'));
check('blank between separator & data',   _renderMarkdown('| A | B |\n|---|---|\n\n| 1 | 2 |').includes('<td>1</td>'));
check('blank between data rows',          (_renderMarkdown('| A |\n|---|\n| 1 |\n\n| 2 |').match(/<tr>/g) || []).length === 3);
check('multiple blanks between rows',     _renderMarkdown('| A |\n\n\n|---|\n\n\n| 1 |').includes('<td>1</td>'));

// ── Regressions: the adjacent (no-blank) form still works ──
check('adjacent table still works', _renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |').includes('<table'));

// ── Surrounding prose is preserved and not merged into the table ──
h = _renderMarkdown('Here are your trips:\n\n| A |\n\n|---|\n\n| x |\n\nThat is all.');
check('prose before table kept as paragraph', h.includes('<p class="intel-ask-a">Here are your trips:</p>'));
check('prose after table kept as paragraph',  h.includes('<p class="intel-ask-a">That is all.</p>'));
check('table rendered between prose',         h.includes('<table') && h.includes('<td>x</td>'));

// ── XSS still escaped after the blank-collapse pass ──
h = _renderMarkdown('| H |\n\n|---|\n\n| <img src=x onerror=alert(1)> |');
check('cell HTML still escaped', h.includes('&lt;img') && !h.includes('<img'));

// ── Streaming: header + blank + separator (data not yet arrived) ──
check('streaming header+separator → table', _renderMarkdown('| תאריך | סכום |\n\n|---|---|').includes('<th>תאריך</th>'));
check('streaming header alone → not a table yet', !_renderMarkdown('| תאריך | סכום |\n').includes('<table'));

// ── A real "---" horizontal rule with blank lines is NOT a table ──
check('--- rule is not a table', !_renderMarkdown('Intro.\n\n---\n\nMore.').includes('<table'));

// ── Dash sanitisation reaches the rendered answer ──
h = _renderMarkdown('רוב הכסף שלך — בערך 80% — נמצא במניות');
check('em dash becomes a comma in prose', h.includes('שלך, בערך') && !h.includes('—'));
h = _renderMarkdown('Two funds – VOO and VT – dominate');
check('en dash becomes a comma in prose', h.includes('funds, VOO') && !h.includes('–'));
h = _renderMarkdown('ex-dividend ו-POLI.MR1 נשארים');
check('hyphens inside identifiers survive', h.includes('ex-dividend') && h.includes('ו-POLI.MR1'));
h = _renderMarkdown('| A | B |\n|---|---|\n| x | y |');
check('table separator row untouched by dash rule', h.includes('<table') && h.includes('<td>x</td>'));

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
