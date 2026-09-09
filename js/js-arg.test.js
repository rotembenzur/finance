// Standalone test for jsArg() in js/utils.js.
// Run with:  node js/js-arg.test.js
//
// utils.js is a browser ES module, so — same trick as
// markdown-render.test.js — we extract the pure function by name and
// eval it rather than importing the module.
//
// What this guards: renderers emit `onclick="fn('${jsArg(x)}')"`, a JS
// string literal nested inside an HTML attribute. Get the escaping
// wrong and the handler doesn't merely misbehave, it fails to PARSE —
// the element ends up with no onclick at all and is silently
// unclickable. Card-charge ids embed the raw merchant name, and Hebrew
// merchants routinely carry an ASCII apostrophe (ג'מבו, צ'ק פוינט), so
// this is a live path, not a hypothetical.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');
const m = src.match(/export function jsArg\s*\([^]*?\n\}/m);
if (!m) { console.error('could not extract jsArg from utils.js'); process.exit(1); }
eval(m[0].replace(/^export /, ''));

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else      { fail++; console.log('  FAIL ' + label); }
}

// Simulates what the browser actually does with `attr="...'${v}'..."`:
// the HTML parser decodes entities in the attribute value FIRST, and
// only then is the result parsed as JavaScript. Any escaping scheme has
// to survive both passes.
function decodeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');   // last: an encoded &amp;lt; must not double-decode
}
function roundTrip(value) {
  const attr = "handler('" + jsArg(value) + "')";
  let captured, threw = null;
  try {
    // eslint-disable-next-line no-new-func
    new Function('handler', decodeAttr(attr))(v => { captured = v; });
  } catch (e) { threw = e; }
  return { threw, captured };
}

console.log('jsArg round-trip through attribute decode + JS parse:\n');

const CASES = [
  ['plain ascii',            'chg-d-01'],
  ['hebrew',                 'cal-2026-05-20-רמי לוי-90'],
  ['hebrew geresh',          "cal-2026-04-30-ג'מבו-129.9"],
  ['english apostrophe',     "max-2026-05-20-1234-McDonald's-40"],
  ['double quote',           'say "hi"'],
  ['ampersand',              'Marks & Spencer'],
  ['angle brackets',         'a <b> c'],
  ['backslash',              'path\\to\\thing'],
  ['backslash before quote', "esc\\'d"],
  ['newline',                'line1\nline2'],
  ['quote soup',             `'"\\&<>`],
  ['empty',                  ''],
];

for (const [label, value] of CASES) {
  const { threw, captured } = roundTrip(value);
  check(`${label}: parses`, !threw);
  check(`${label}: round-trips exactly`, captured === value);
}

// null/undefined must not become the strings "null"/"undefined"
check('null → empty string',      roundTrip(null).captured === '');
check('undefined → empty string', roundTrip(undefined).captured === '');

// The failure this exists to prevent: HTML-escaping alone is NOT enough,
// because the attribute decode hands the apostrophe back before JS parses.
function htmlEscOnly(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                  .replace(/</g, '&lt;').replace(/'/g, '&#39;');
}
let htmlOnlyThrew = false;
try {
  new Function('handler', decodeAttr("handler('" + htmlEscOnly("ג'מבו") + "')"))(() => {});
} catch (e) { htmlOnlyThrew = true; }
check('regression: HTML-escaping alone still breaks the parse', htmlOnlyThrew);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
