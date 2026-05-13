// ─────────────────────────────────────────────────────────────────
//  STATE — owner of the in-memory app data object
//
//  Module-private `appData` ref so consumers can't accidentally
//  reassign it (ES module imports are read-only bindings). Anyone
//  who needs to read state goes through getAppData(); the only
//  call sites that fully replace the object live in app.js (init)
//  and components/data-io.js (manual restore).
//
//  Field-level mutations (push to entries, edit a field) happen on
//  the returned object directly — that's by design, mirrors the
//  pre-module pattern, and keeps the renderer-input shape intact.
// ─────────────────────────────────────────────────────────────────

let _appData = null;

export function getAppData() {
  return _appData;
}

export function replaceAppData(next) {
  _appData = next;
}
