// ─────────────────────────────────────────────────────────────────
//  IMPORT FLOW  (orchestration + preview UI)
//
//  Click Sync → hidden <input type="file"> opens → parse + diff →
//  reuse the existing modal shell to render a preview screen →
//  confirm applies, cancel discards.
//
//  All errors are surfaced inline in the preview rather than thrown
//  at the user as raw exceptions. Existing portfolio state is never
//  mutated until the user clicks Apply.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { t } from '../i18n.js';
import { formatCurrency, formatPercent, entryValue } from '../utils.js';
import { readXLSX } from './xlsx-reader.js';
import { parseIBIReport } from './ibi-parser.js';
import { computeImportDiff, applyImportDiff } from './import-apply.js';

let _pendingDiff = null;       // ImportDiff held between preview render and Apply click

// Public entry point — wired from the Sync button on the portfolio hero.
export function openIBIImportFlow() {
  let input = document.getElementById('ibi-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.id = 'ibi-file-input';
    input.style.display = 'none';
    input.addEventListener('change', _handleFileSelected);
    document.body.appendChild(input);
  }
  input.value = '';     // allow re-selecting the same file
  input.click();
}

async function _handleFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const rows   = await readXLSX(buffer);
    const result = parseIBIReport(rows);

    if (!result.ok) {
      _showImportError(result.errors[0]?.message || 'Could not parse file.');
      return;
    }

    const diff = computeImportDiff(getAppData(), result);
    _pendingDiff = diff;
    _openImportPreviewModal(diff);
  } catch (err) {
    console.error('IBI import failed:', err);
    _showImportError(err.message || 'Unexpected error while reading file.');
  }
}

// ── Preview modal (reuses #modal-overlay shell) ──────────────────

function _openImportPreviewModal(diff) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent   = t('import.previewTitle');
  saveBtnEl.textContent = t('import.applyButton');
  saveBtnEl.className   = 'btn btn-primary';
  cancelEl.textContent  = t('modal.cancel');

  bodyEl.innerHTML = _renderImportPreview(diff);
  overlay.classList.add('open');
  overlay.classList.add('modal-overlay--wide');
}

function _closeImportPreviewModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.classList.remove('modal-overlay--wide');
  _pendingDiff = null;
}

// Called from the modal's Apply button (handleModalSave routes to this
// when there's a pending import diff).
export function applyPendingImport() {
  if (!_pendingDiff) return false;
  applyImportDiff(_pendingDiff);
  _closeImportPreviewModal();
  return true;
}

export function hasPendingImport() {
  return _pendingDiff !== null;
}

export function clearPendingImport() {
  _pendingDiff = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}

// ── Preview rendering ────────────────────────────────────────────

function _renderImportPreview(diff) {
  const p   = diff.parsedPortfolio;
  const pf  = diff.portfolio;

  const totalsHtml = _renderTotalsSection(pf, p);
  const summary    = _renderHoldingsSummary(diff);
  const changes    = _renderHoldingsChanges(diff);
  const warnings   = _renderWarnings(diff.warnings);

  return `
    <div class="import-preview">
      ${totalsHtml}
      ${summary}
      ${changes}
      ${warnings}
    </div>
  `;
}

function _renderTotalsSection(existing, parsed) {
  const rows = [
    [t('portfolio.currentValue'),  existing?.totalValue,        parsed.totalValue,        formatCurrency],
    [t('portfolio.costBasis'),     existing?.totalInvested,     parsed.totalInvested,     formatCurrency],
    [t('portfolio.totalReturn'),   existing?.totalGain,         parsed.totalGain,         formatCurrency],
    [t('assets.totalReturn'),      existing?.totalGainPercent,  parsed.totalGainPercent,  v => v == null ? '—' : formatPercent(v)],
    [t('portfolio.todayChange'),   existing?.dailyChange,       parsed.dailyChange,       formatCurrency],
  ];

  const rowHtml = rows.map(([label, before, after, fmt]) => {
    const changed = before == null || (typeof after === 'number' && Math.abs(after - (before || 0)) >= 0.005);
    return `
      <div class="import-totals-row ${changed ? 'is-changed' : ''}">
        <span class="import-totals-label">${label}</span>
        <span class="import-totals-before">${before == null ? '—' : fmt(before)}</span>
        <span class="import-totals-arrow">→</span>
        <span class="import-totals-after">${after == null ? '—' : fmt(after)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="import-section">
      <div class="import-section-title">${t('import.portfolioTotals')}</div>
      <div class="import-totals">${rowHtml}</div>
    </div>
  `;
}

function _renderHoldingsSummary(diff) {
  const total    = diff.added.length + diff.updated.length + diff.removed.length;
  const noChange = diff.parseResult.holdings.length - diff.added.length - diff.updated.length;

  return `
    <div class="import-section">
      <div class="import-section-title">${t('import.holdingsChanges')}</div>
      <div class="import-summary-pills">
        <span class="import-pill import-pill--added">+${diff.added.length} ${t('import.added')}</span>
        <span class="import-pill import-pill--updated">~${diff.updated.length} ${t('import.updated')}</span>
        <span class="import-pill import-pill--removed">−${diff.removed.length} ${t('import.removed')}</span>
        ${noChange > 0 ? `<span class="import-pill import-pill--unchanged">${noChange} ${t('import.unchanged')}</span>` : ''}
      </div>
      ${total === 0 ? `<div class="import-empty">${t('import.noChanges')}</div>` : ''}
    </div>
  `;
}

function _renderHoldingsChanges(diff) {
  const rows = [];

  for (const h of diff.added) {
    rows.push(_renderChangeRow('added', h.name, formatCurrency(h.currentValue || 0), null));
  }
  for (const { existing, parsed, changes } of diff.updated) {
    const valChange = changes.find(c => c.field === 'currentValue');
    const detail = valChange
      ? `${formatCurrency(valChange.before || 0)} → ${formatCurrency(valChange.after || 0)}`
      : changes.map(c => c.field).join(', ');
    rows.push(_renderChangeRow('updated', parsed.name, formatCurrency(parsed.currentValue || 0), detail));
  }
  for (const e of diff.removed) {
    rows.push(_renderChangeRow('removed', e.name, formatCurrency(entryValue(e)), null));
  }

  if (rows.length === 0) return '';

  return `
    <div class="import-section">
      <div class="import-changes-list">${rows.join('')}</div>
    </div>
  `;
}

function _renderChangeRow(kind, name, value, detail) {
  const marker = kind === 'added' ? '+' : kind === 'removed' ? '−' : '~';
  return `
    <div class="import-change-row import-change-row--${kind}">
      <span class="import-change-marker">${marker}</span>
      <span class="import-change-name">${name}</span>
      <span class="import-change-value">${value}</span>
      ${detail ? `<span class="import-change-detail">${detail}</span>` : ''}
    </div>
  `;
}

function _renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return `
    <div class="import-section">
      <div class="import-section-title import-section-title--warning">${t('import.warnings')}</div>
      <ul class="import-warnings">
        ${warnings.map(w => `<li>${w.message}</li>`).join('')}
      </ul>
    </div>
  `;
}

// ── Error display ────────────────────────────────────────────────

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent   = t('import.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent  = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${message}</p>
    <p class="modal-confirm-text import-error-hint">${t('import.errorHint')}</p>
  `;
  overlay.classList.add('open');
  // Save button is restored at the start of the next openModal() call.
}
