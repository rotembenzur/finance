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

## Persistence

Real user data lives in two places:

1. **Supabase** — table `app_state`, row `id = 'primary'`, column
   `data` (jsonb). Source of truth across devices.
2. **`localStorage`** under the key `financeData_v17`. Mirrors the
   Supabase row so the app keeps working offline.

`data/state.example.js` ships in the repo as a redacted demo dataset.
It exercises every feature path so the app renders end-to-end on a
fresh clone with no setup.

### Boot order

On every boot, `js/store.js`'s `loadData()` tries each source in
order and returns the first one that's valid:

1. The Supabase row.
2. `localStorage[financeData_v17]`.
3. The bundled demo state from `data/state.example.js`.

Migrations (`_migratePersistedState`) run on whichever source wins so
the in-memory shape is normalized regardless of where it came from.

### Saving and resetting

Every mutation flows through `saveData(data)`, which writes to
`localStorage` synchronously and pushes the same snapshot to Supabase
fire-and-forget. Cloud failures never block the UI.

The data-menu **Reload data** action clears both stores and refreshes
the page — the next boot falls through to the bundled demo. Use it as
a recovery tool when state is broken; it's not a way to pick up edits
to files on disk, since real data no longer lives on disk.
