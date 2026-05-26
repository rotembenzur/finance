// ─────────────────────────────────────────────────────────────────
//  IMPORT DIFF PREVIEW (shared renderer)
//
//  Given a rich upsert payload from charge-merge.js (added[], updated[],
//  kept[]), produce the HTML that answers the user's only real question
//  when reviewing an import:
//
//      "What exactly is going to change if I press Confirm?"
//
//  The renderer answers it explicitly:
//
//    · NEW TRANSACTIONS — every row about to be added, with the reason.
//    · UPDATED TRANSACTIONS — every row about to be modified, with
//      a one-line matching reason and a per-field "from → to" diff.
//    · ≡ X rows already on file (no changes) — fold the no-op re-imports
//      into a single footer line.
//    · X earlier charges kept (not in this file) — acknowledge the
//      existing charges this import preserves.
//
//  Identical re-imports are partitioned out of the Updated list so the
//  user's eye lands on the rows that actually change. The matching logic
//  is explained in a small footer so the user can trust why a row was
//  considered "the same" or "new."
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import { formatChargeDate } from '../dates.js';

// Render a diff section for a single bucket of charges. The caller
// passes a header (title text), a sub-buckets list of upsert rows, and
// optional flow-specific config (currently just the headerSlot for the
// section title, e.g. "for •••• 1234" on multi-card MAX). Returns HTML.
//
// The full payload signature:
//   diff:   { added, updated, kept, addedCount, updatedCount, keptCount }
//   inFile: total count of rows in the file (display label "X in file")
//   inFileTotal: optional currency sum of the file rows (display "· ₪")
//
// `opts.titleSuffix` is appended to "New / Updated" section titles to
// scope them visually when several groups render side by side (e.g.,
// MAX renders per-card groups).
export function renderImportDiff(diff, opts = {}) {
  const { added = [], updated = [], kept = [] } = diff;
  const realUpdated      = updated.filter(u => !u.identical);
  const unchangedReimport = updated.filter(u =>  u.identical);
  const inFile          = (opts.inFile != null) ? opts.inFile : (added.length + updated.length);
  const fileTotal       = opts.inFileTotal;

  const titleSuffix = opts.titleSuffix ? ` ${opts.titleSuffix}` : '';

  const summaryHtml = `
    <div class="import-diff-summary">
      <span class="import-pill import-pill--unchanged">
        ${inFile} ${t('import.diff.inFile')}${
          fileTotal != null ? ` · ${formatCurrency(fileTotal)}` : ''
        }
      </span>
      ${added.length > 0 ? `
        <span class="import-pill import-pill--added">
          +${added.length} ${t('import.diff.new')}
        </span>` : ''}
      ${realUpdated.length > 0 ? `
        <span class="import-pill import-pill--updated">
          ~${realUpdated.length} ${t('import.diff.updated')}
        </span>` : ''}
      ${unchangedReimport.length > 0 ? `
        <span class="import-pill import-pill--reimport">
          ≡${unchangedReimport.length} ${t('import.diff.unchanged')}
        </span>` : ''}
      ${kept.length > 0 ? `
        <span class="import-pill import-pill--kept">
          ${kept.length} ${t('import.diff.kept')}
        </span>` : ''}
    </div>
  `;

  // — New transactions —
  const newSection = added.length > 0 ? `
    <div class="import-diff-section import-diff-section--added">
      <h4 class="import-diff-section-title">
        ${t('import.diff.newTitle').replace('{n}', added.length)}${_esc(titleSuffix)}
      </h4>
      <p class="import-diff-section-note">${t('import.diff.newReason')}</p>
      <ul class="import-diff-list">
        ${added.map(a => _renderAddedRow(a, opts)).join('')}
      </ul>
    </div>
  ` : '';

  // — Updated transactions —
  const updatedSection = realUpdated.length > 0 ? `
    <div class="import-diff-section import-diff-section--updated">
      <h4 class="import-diff-section-title">
        ${t('import.diff.updatedTitle').replace('{n}', realUpdated.length)}${_esc(titleSuffix)}
      </h4>
      <ul class="import-diff-list">
        ${realUpdated.map(u => _renderUpdatedRow(u, opts)).join('')}
      </ul>
    </div>
  ` : '';

  // — Footers for no-op re-imports & kept-not-in-file —
  const unchangedFooter = unchangedReimport.length > 0 ? `
    <p class="import-diff-footer import-diff-footer--unchanged">
      ${t('import.diff.unchangedFooter').replace('{n}', unchangedReimport.length)}
    </p>
  ` : '';

  const keptFooter = kept.length > 0 ? `
    <p class="import-diff-footer import-diff-footer--kept">
      ${t('import.diff.keptFooter').replace('{n}', kept.length)}
    </p>
  ` : '';

  // — Matching-logic explainer —
  const explain = (added.length + realUpdated.length + unchangedReimport.length) > 0
    ? `<p class="import-diff-explain">${t('import.diff.matchingNote')}</p>`
    : '';

  return `
    <section class="import-diff">
      ${summaryHtml}
      ${newSection}
      ${updatedSection}
      ${unchangedFooter}
      ${keptFooter}
      ${explain}
    </section>
  `;
}

// ── Row renderers ────────────────────────────────────────────────

function _renderAddedRow(a, opts) {
  const c = a.parsed || a.built || {};
  return `
    <li class="import-diff-row import-diff-row--added">
      <span class="import-diff-marker" aria-hidden="true">+</span>
      <div class="import-diff-identity">
        ${_renderIdentity(c, opts)}
      </div>
    </li>
  `;
}

function _renderUpdatedRow(u, opts) {
  const c     = u.parsed || u.built || {};
  const match = _matchedByLabel(u.matchedBy, u.prior, opts);
  const changesHtml = (u.changes || []).length > 0
    ? `<ul class="import-diff-changes">${u.changes.map(ch => _renderChange(ch, opts)).join('')}</ul>`
    : '';
  return `
    <li class="import-diff-row import-diff-row--updated">
      <span class="import-diff-marker" aria-hidden="true">~</span>
      <div class="import-diff-body">
        <div class="import-diff-identity">
          ${_renderIdentity(c, opts)}
        </div>
        <div class="import-diff-match">${match}</div>
        ${changesHtml}
      </div>
    </li>
  `;
}

function _renderIdentity(c, opts) {
  const dateText = c.date ? formatChargeDate(c.date) : (c.rawDate || '');
  const amount   = _formatAmount(c, opts);
  const fxText   = c.originalCurrency && c.originalCurrency !== c.currency
    ? ` <span class="import-diff-fx">${_esc(String(c.originalAmount ?? ''))} ${_esc(c.originalCurrency)}</span>`
    : '';
  // The "merchant" column carries the row's identity text. For charges
  // that's `merchant`; for bank transactions it's `description`. Same
  // visual slot, different source field.
  const label = c.merchant || c.description || '';
  return `
    <span class="import-diff-date">${_esc(dateText)}</span>
    <span class="import-diff-merchant">${_esc(label)}</span>
    <span class="import-diff-amount">${amount}${fxText}</span>
  `;
}

// Format the row's primary amount for the identity line. Bank-style
// flows (opts.signed = true) prefix with +/− based on the row's
// direction; charge-style flows leave the value unsigned (the merchant
// column already implies direction).
function _formatAmount(c, opts) {
  if (c.amount == null) return '';
  const value = formatCurrency(c.amount, { cents: true });
  if (opts && opts.signed) {
    if (c.direction === 'credit') return `+${value}`;
    if (c.direction === 'debit')  return `−${value}`;
  }
  return value;
}

function _matchedByLabel(matchedBy, prior, opts) {
  if (!matchedBy) return t('import.diff.matchedByUnknown');

  // Per-call override: bank-import passes its own label map so its
  // "balance" / "idFallback" reasons get bank-specific wording.
  if (opts && opts.matchedByLabels && opts.matchedByLabels[matchedBy]) {
    return opts.matchedByLabels[matchedBy];
  }

  // Look up `import.diff.matchedBy.{key}` from i18n. Falls through to
  // legacy keys for back-compat with the original charge-specific
  // labels (`matchedById` / `matchedByFingerprint`).
  const namespaceKey = `import.diff.matchedBy.${matchedBy}`;
  const namespaced = t(namespaceKey);
  if (namespaced !== namespaceKey) {
    return _appendIdHint(namespaced, matchedBy, prior);
  }
  if (matchedBy === 'id')          return _appendIdHint(t('import.diff.matchedById'), matchedBy, prior);
  if (matchedBy === 'fingerprint') return t('import.diff.matchedByFingerprint');
  return t('import.diff.matchedByUnknown');
}

function _appendIdHint(label, matchedBy, prior) {
  if (matchedBy !== 'id' && matchedBy !== 'idFallback') return label;
  if (!prior || !prior.id) return label;
  return `${label} <span class="import-diff-match-id">(${_esc(prior.id)})</span>`;
}

function _renderChange(change, opts) {
  const label = _fieldLabel(change.field);
  return `
    <li class="import-diff-change">
      <span class="import-diff-change-field">${_esc(label)}</span>
      <span class="import-diff-change-from">${_formatValue(change.field, change.from, opts)}</span>
      <span class="import-diff-change-arrow" aria-hidden="true">→</span>
      <span class="import-diff-change-to">${_formatValue(change.field, change.to, opts)}</span>
    </li>
  `;
}

// ── Field labels + value formatting ──────────────────────────────

function _fieldLabel(field) {
  const key = `import.diff.field.${field}`;
  const value = t(key);
  // t() returns the key itself when missing — fall back to a humanized
  // version of the field name so the UI never shows the raw key.
  if (value === key) return _humanize(field);
  return value;
}

function _humanize(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

function _formatValue(field, value, opts) {
  if (value == null || value === '') {
    return `<span class="import-diff-change-empty">${t('import.diff.empty')}</span>`;
  }

  // Allow the calling flow to override per-field formatting (e.g.,
  // bank flow renders `type` via a classifier-aware label resolver).
  if (opts && typeof opts.formatFieldValue === 'function') {
    const custom = opts.formatFieldValue(field, value);
    if (custom != null) return custom;
  }

  if (field === 'amount' || field === 'originalAmount' || field === 'balance') {
    const n = Number(value);
    if (Number.isFinite(n)) return formatCurrency(n, { cents: true });
  }
  if (field === 'fxRate') {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toFixed(4);
  }
  if (field === 'date' || field === 'billingDate'
   || field === 'valueDate' || field === 'processedDate') {
    return _esc(formatChargeDate(String(value)) || String(value));
  }
  if (field === 'status') {
    const k = `import.diff.value.status.${value}`;
    const v = t(k);
    return _esc(v === k ? String(value) : v);
  }
  return _esc(String(value));
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
