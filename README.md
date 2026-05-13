# Personal Finance Dashboard

Vanilla HTML/CSS/JS single-page app for tracking accounts, holdings,
savings, and cards across the four mental tiers: **Available**,
**Invested**, **Future Wealth**, and **Future Deposits**.

No build tools, no frameworks, no npm. The app is built with native
ES modules, so `index.html` must be served over HTTP — opening it via
`file://` will fail with CORS errors.

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Data files

The app boots from a global `FINANCIAL_STATE` object declared in
`data/`. Two files participate, in this order:

| File | Purpose | Tracked in git? |
|---|---|---|
| `data/state.example.js` | Redacted demo dataset. Safe to commit. Exercises every feature path so the app renders end-to-end. | **Yes** |
| `data/state.local.js`   | Real personal financial data. **Gitignored.** | **No** |

`index.html` loads them as two consecutive `<script>` tags:

```html
<script src="data/state.example.js"></script>
<script src="data/state.local.js"></script>
```

Both files declare `var FINANCIAL_STATE = { ... }`. The example loads
first as a baseline; if `state.local.js` exists, it redeclares the
variable and overrides the demo. If `state.local.js` is missing
(e.g., on a fresh clone), the browser logs a 404 and execution
continues — the demo data stays in scope.

After first load, the app persists state to `localStorage` under the
key `financeData_v17`. Subsequent loads come from `localStorage`;
`FINANCIAL_STATE` is only re-read on first run or after reset.

### Setting up your own data

1. Clone the repo. The app boots with demo data out of the box.
2. Copy `data/state.example.js` to `data/state.local.js`.
3. Replace the demo values with your real data. Keep the structure
   identical (same top-level keys, same entry shape).
4. Reload the page. You may need to clear `localStorage` (or use the
   reset action) so the app re-bootstraps from your new file.
