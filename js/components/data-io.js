// ─────────────────────────────────────────────────────────────────
//  DATA I/O — manual backup / restore
//
//  Local, browser-only export and import of the full app state.
//  Export downloads a JSON envelope wrapping the current appData;
//  Import reads such a file, validates it, asks for confirmation,
//  and replaces localStorage state with the imported snapshot.
//
//  No backend, no sync, no auth. The user holds their own backups.
//
//  Reuses the existing #modal-overlay shell so we don't introduce a
//  second modal system. Confirmation routes through handleModalSave
//  via hasPendingDataImport() / applyPendingDataImport(), mirroring
//  the IBI import flow.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { STORE_KEY, saveData, migratePersistedState, todayISO, resetToInitialState } from '../store.js';
import { getAppData, replaceAppData } from '../state.js';
import { init } from '../app.js';

const _DATA_IO_SCHEMA_VERSION = 1;

// Holds the validated payload between preview render and Apply click.
let _pendingDataImport = null;
// True while the reload-from-data-file confirmation modal is open.
let _pendingReload = false;


// ── Public API ───────────────────────────────────────────────────

// Sidebar-footer button entry point.
export function openDataMenu() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('data.title');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('data.close');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = `
    <div class="data-menu">
      <div class="data-menu-section">
        <div class="data-menu-heading">${t('data.export')}</div>
        <p class="data-menu-description">${t('data.exportDescription')}</p>
        <button class="btn btn-primary" onclick="exportDataToFile()">${t('data.exportButton')}</button>
      </div>
      <div class="data-menu-section">
        <div class="data-menu-heading">${t('data.import')}</div>
        <p class="data-menu-description">${t('data.importDescription')}</p>
        <button class="btn btn-ghost" onclick="openImportFlow()">${t('data.importButton')}</button>
      </div>
      <div class="data-menu-section">
        <div class="data-menu-heading">${t('data.reload')}</div>
        <p class="data-menu-description">${t('data.reloadDescription')}</p>
        <button class="btn btn-ghost" onclick="reloadFromDataFile()">${t('data.reloadButton')}</button>
      </div>
    </div>
  `;
  overlay.classList.add('open');
}

// Reload-from-data-file: discard the localStorage snapshot and
// re-bootstrap from data/state.local.js (or state.example.js).
// Useful after editing the data file directly — the cached state
// in localStorage doesn't auto-refresh, so this is the explicit
// "apply file changes" action.
export function reloadFromDataFile() {
  _pendingReload = true;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('data.reloadTitle');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('data.reloadConfirmButton');
  saveBtnEl.className     = 'btn btn-danger';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${t('data.reloadText')}</p>
    <p class="modal-confirm-text data-confirm-warning">${t('data.reloadWarning')}</p>
  `;
  overlay.classList.add('open');
}

export function hasPendingReload() {
  return _pendingReload;
}

export function clearPendingReload() {
  _pendingReload = false;
}

export function applyPendingReload() {
  if (!_pendingReload) return false;
  _pendingReload = false;
  // Clear the cached snapshot (localStorage + Supabase row), then
  // force a full page refresh. The browser re-fetches every JS module
  // on reload, which means store.js's dynamic
  // `import('../data/state.local.js')` re-runs against the current
  // file on disk — picking up any edits made while the tab was open.
  // With both stores cleared, loadData() falls through to the
  // freshly-imported FINANCIAL_STATE on next boot. We await the
  // Supabase clear so the reload doesn't race ahead of it.
  Promise.resolve(resetToInitialState()).finally(() => {
    window.location.reload();
  });
  return true;
}

export function hasPendingDataImport() {
  return _pendingDataImport !== null;
}

export function clearPendingDataImport() {
  _pendingDataImport = null;
}

// Called from handleModalSave when the user confirms the import.
export function applyPendingDataImport() {
  if (!_pendingDataImport) return false;

  const data = _pendingDataImport.data;

  // Primary write — fail-loud (user-facing error) if localStorage is
  // unavailable. We do this directly rather than via saveData so the
  // user sees a clear error before any cloud side-effects.
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to write imported state to localStorage:', e);
    _showDataIoError(t('data.errorWrite'));
    _pendingDataImport = null;
    return false;
  }

  // Normalize shape (same migrations loadData() would apply) and adopt
  // as the live in-memory state. We can't round-trip through loadData()
  // anymore because it now reads Supabase first — that would return the
  // pre-import cloud state and silently revert the user's import.
  migratePersistedState(data);
  replaceAppData(data);

  // Push to cloud so other devices and the next boot pick up the
  // import. saveData also re-writes localStorage with migrated data —
  // harmless, and means the persisted copy always matches in-memory.
  saveData(data);

  _pendingDataImport = null;
  document.getElementById('modal-overlay').classList.remove('open');
  init();
  return true;
}


// ── Export ───────────────────────────────────────────────────────

export function exportDataToFile() {
  const envelope = {
    schemaVersion: _DATA_IO_SCHEMA_VERSION,
    appName:       'Personal Finance Dashboard',
    storeKey:      STORE_KEY,
    exportedAt:    new Date().toISOString(),
    data:          getAppData(),
  };

  const json = JSON.stringify(envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = `finance-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// ── Import: file picker → validate → confirmation ────────────────

export function openImportFlow() {
  let input = document.getElementById('data-import-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.id     = 'data-import-file-input';
    input.style.display = 'none';
    input.addEventListener('change', _handleImportFileSelected);
    document.body.appendChild(input);
  }
  input.value = '';     // allow re-selecting the same file
  input.click();
}

async function _handleImportFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error('Could not read import file:', err);
    _showDataIoError(t('data.errorRead'));
    return;
  }

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    _showDataIoError(t('data.errorInvalidJson'));
    return;
  }

  const validation = _validateEnvelope(envelope);
  if (!validation.ok) {
    _showDataIoError(validation.message);
    return;
  }

  _pendingDataImport = envelope;
  _openImportConfirmModal(envelope);
}


// ── Validation ───────────────────────────────────────────────────

function _validateEnvelope(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, message: t('data.errorInvalidFormat') };
  }
  if (env.schemaVersion !== _DATA_IO_SCHEMA_VERSION) {
    return { ok: false, message: t('data.errorWrongSchema') };
  }
  if (env.storeKey !== STORE_KEY) {
    return { ok: false, message: t('data.errorWrongStoreKey') };
  }

  const d = env.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { ok: false, message: t('data.errorMissingData') };
  }
  if (!Array.isArray(d.entries)) {
    return { ok: false, message: t('data.errorMissingEntries') };
  }
  if (d.entries.some(e => !e || typeof e !== 'object' || !e.id)) {
    return { ok: false, message: t('data.errorMalformedEntry') };
  }
  if (!Array.isArray(d.cards)) {
    return { ok: false, message: t('data.errorMissingCards') };
  }

  // Optional collections — must be arrays if defined, but absent is OK
  // (allows for older / minimal exports without explicit empty arrays).
  for (const key of ['banks', 'providers', 'portfolios', 'recurring']) {
    if (d[key] !== undefined && !Array.isArray(d[key])) {
      return { ok: false, message: t('data.errorMalformedCollection').replace('{key}', key) };
    }
  }

  return { ok: true };
}


// ── Confirmation modal ───────────────────────────────────────────

function _openImportConfirmModal(envelope) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  const d = envelope.data;
  const exportedAt = _formatExportTimestamp(envelope.exportedAt);

  titleEl.textContent     = t('data.confirmTitle');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('data.confirmButton');
  saveBtnEl.className     = 'btn btn-danger';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${t('data.confirmText')}</p>
    <ul class="data-confirm-list">
      <li><span>${t('data.confirmExportedAt')}</span><span>${exportedAt}</span></li>
      <li><span>${t('data.confirmEntries')}</span><span>${d.entries.length}</span></li>
      <li><span>${t('data.confirmCards')}</span><span>${d.cards.length}</span></li>
    </ul>
    <p class="modal-confirm-text data-confirm-warning">${t('data.confirmWarning')}</p>
  `;
  overlay.classList.add('open');
}

function _formatExportTimestamp(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const locale = currentLang === 'he' ? 'he-IL' : 'en-US';
    return d.toLocaleString(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit',  minute: '2-digit',
    });
  } catch {
    return iso;
  }
}


// ── Error display (reuses #modal-overlay) ────────────────────────

function _showDataIoError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('data.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${message}</p>
    <p class="modal-confirm-text import-error-hint">${t('data.errorHint')}</p>
  `;
  overlay.classList.add('open');
}
