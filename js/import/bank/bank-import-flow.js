// ─────────────────────────────────────────────────────────────────
//  BANK STATEMENT IMPORT FLOW
//
//  User clicks "Import bank statement" → hidden .pdf picker opens →
//  parse via Hapoalim parser → classify each row → render a preview
//  modal → on Apply, merge into data.bankTransactions[] keyed by
//  stable fingerprint id (so re-importing the same statement is
//  idempotent and user-edits on existing rows survive).
//
//  Today this only supports Bank Hapoalim PDFs. The flow is set up
//  so additional banks can register their own parsers in the future
//  (CSV/XLSX/OCR/sync APIs) — bank-import-flow stays the orchestrator,
//  each format adds itself to the parser registry below.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../../state.js';
import { saveData, todayISO } from '../../store.js';
import { init } from '../../app.js';
import { t, currentLang } from '../../i18n.js';
import { formatCurrency } from '../../utils.js';
import { formatChargeDate } from '../../dates.js';
import { parseHapoalimPdf } from './hapoalim-pdf-parser.js';
import { classifyTransaction, BANK_TX_TYPES } from './classifier.js';
import { getIncomeCategoryById } from '../../data/income-categories.js';

// Dedupe matching window — how many days apart manual entry and
// imported transaction can be while still being considered "the
// same money." Bit transfers and direct deposits typically settle
// within 1-2 days; ±3 covers most weekend cases without producing
// many false positives.
const DEDUPE_DAYS = 3;

// Format registry. Today: PDF → Hapoalim. Adding a new bank or
// format means registering it here; bank-import-flow stays generic.
const PARSERS = [
  { match: f => /\.pdf$/i.test(f.name),  parse: parseHapoalimPdf, format: 'hapoalim-pdf' },
];

let _pendingImport = null;        // { result, classified[], existingCount }

// ── Public entry point ─────────────────────────────────────────

export function openBankImportFlow() {
  let input = document.getElementById('bank-file-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.id = 'bank-file-input';
    input.style.display = 'none';
    input.addEventListener('change', _handleFileSelected);
    document.body.appendChild(input);
  }
  input.value = '';
  input.click();
}

async function _handleFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const parser = PARSERS.find(p => p.match(file));
  if (!parser) {
    _showImportError(t('bankImport.errorUnsupported'));
    return;
  }

  // Open a busy state — PDF loading + pdf.js boot can take a second,
  // so the user sees something happening immediately.
  _showBusy();

  try {
    const buffer = await file.arrayBuffer();
    const result = await parser.parse(buffer);
    if (!result.ok) {
      _showImportError(result.errors[0]?.message || t('bankImport.errorGeneric'));
      return;
    }

    // Tag each transaction with classifier output. Preserved as part
    // of the parsed payload so the preview can group/count by type
    // without re-classifying on every render.
    const classified = result.transactions.map(tx => ({
      ...tx,
      ...classifyTransaction(tx),
    }));

    // How many of these IDs already exist in state? Drives the
    // preview's "new vs updated" count without committing anything.
    const data = getAppData();
    const existingIds = new Set((data.bankTransactions || []).map(t => t.id));
    const newCount     = classified.filter(t => !existingIds.has(t.id)).length;
    const updatedCount = classified.length - newCount;

    // Dedupe candidates: pair each incoming credit with the closest
    // existing manual income at the same bank, exact amount, within
    // the date window. Default per-pair choice is "merge" — the
    // common case is "I added the gift manually, now I'm importing
    // the statement that includes it." The user can flip a pair to
    // "keep_both" if the match is wrong.
    const matches = _findManualMatches(classified, data, result.account);
    const choices = new Map(matches.map(m => [m.incomingId, 'merge']));

    _pendingImport = { result, classified, newCount, updatedCount, matches, choices };
    _openPreviewModal();
  } catch (err) {
    console.error('Bank import failed:', err);
    _showImportError(err.message || t('bankImport.errorGeneric'));
  }
}

// ── Modal lifecycle ───────────────────────────────────────────

function _openPreviewModal() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.previewTitle');
  saveBtnEl.textContent   = t('import.applyButton');
  saveBtnEl.className     = 'btn btn-primary';
  saveBtnEl.style.display = '';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = _renderPreview(_pendingImport);
  overlay.classList.add('open');
  overlay.classList.add('modal-overlay--wide');

  _wireDedupeToggles();
}

// Per-pair Merge / Keep-both toggles inside the duplicates section.
// We re-attach after every innerHTML write because the modal body is
// rendered as a string. Single delegate would also work; this is
// just as small and keeps the wiring local to the dedupe feature.
function _wireDedupeToggles() {
  const bodyEl = document.getElementById('modal-body');
  if (!bodyEl || !_pendingImport) return;
  bodyEl.querySelectorAll('[data-dedupe-incoming]').forEach(input => {
    input.addEventListener('change', () => {
      const incomingId = input.dataset.dedupeIncoming;
      _pendingImport.choices.set(incomingId, input.checked ? 'merge' : 'keep_both');
    });
  });
}

function _closePreviewModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.classList.remove('modal-overlay--wide');
  _pendingImport = null;
}

export function hasPendingBankImport()   { return _pendingImport !== null; }
export function clearPendingBankImport() {
  _pendingImport = null;
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('modal-overlay--wide');
}
export function applyPendingBankImport() {
  if (!_pendingImport) return false;
  _applyToState(_pendingImport);
  _closePreviewModal();
  return true;
}

// ── Dedupe: find manual income entries that match incoming credits ─
//
// "Match" here is intentionally narrow:
//   • Both are credits (money in)
//   • At the same bank (bankId equality — handles the namespace gap
//     where manual.accountId is an entries[] id and import.accountId
//     is a bankAccounts[] id)
//   • Exact amount match (±1 agorot tolerance for floating-point)
//   • Within DEDUPE_DAYS of each other on the date axis
//   • The pair isn't already in the manual's rejectedMatches list
//     (i.e., the user hasn't dismissed it in a prior import)
//
// Greedy one-to-one assignment: each incoming claims the closest
// unmatched manual entry (by absolute day delta). Avoids one manual
// being suggested as a match for two incomings.
function _findManualMatches(classified, data, importAccount) {
  if (!importAccount || !importAccount.bankId) return [];

  const existing = (data.bankTransactions || []).filter(t =>
    t.source === 'manual' && t.direction === 'credit' && t.bankId === importAccount.bankId
  );
  if (!existing.length) return [];

  const incomings = classified.filter(t => t.direction === 'credit');
  const candidates = [];
  for (const incoming of incomings) {
    for (const manual of existing) {
      if (manual._claimed) continue;
      if (Array.isArray(manual.rejectedMatches) && manual.rejectedMatches.includes(incoming.id)) continue;
      if (Math.abs((manual.amount || 0) - (incoming.amount || 0)) > 0.01) continue;
      const days = _daysBetween(manual.date, incoming.date);
      if (days === null || days > DEDUPE_DAYS) continue;
      candidates.push({ incoming, manual, days });
    }
  }
  // Sort by smallest day delta first so each incoming claims the
  // closest still-unclaimed manual entry — greedy but stable.
  candidates.sort((a, b) => a.days - b.days);

  const claimed = new Set();
  const matches = [];
  for (const cand of candidates) {
    if (claimed.has(cand.manual.id)) continue;
    if (matches.find(m => m.incomingId === cand.incoming.id)) continue;
    claimed.add(cand.manual.id);
    matches.push({
      incomingId: cand.incoming.id,
      manualId:   cand.manual.id,
      incomingTx: cand.incoming,
      manualTx:   cand.manual,
      daysDelta:  cand.days,
    });
  }
  return matches;
}

function _daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(String(isoA).slice(0, 10));
  const b = new Date(String(isoB).slice(0, 10));
  if (isNaN(a) || isNaN(b)) return null;
  return Math.abs(Math.round((a - b) / (1000 * 60 * 60 * 24)));
}


// ── Apply: upsert into data.bankTransactions ───────────────────

function _applyToState({ result, classified, matches, choices }) {
  const data = getAppData();

  // Ensure the account record exists. Updating overwrites the lazy
  // metadata (ownerName, lastImportedAt) without touching anything
  // else attached to the same id.
  if (result.account) {
    const accounts = (data.bankAccounts = data.bankAccounts || []);
    const idx = accounts.findIndex(a => a.id === result.account.id);
    const next = {
      ...(idx >= 0 ? accounts[idx] : {}),
      ...result.account,
      lastImportedAt: todayISO(),
    };
    if (idx >= 0) accounts[idx] = next; else accounts.push(next);
  }

  // Upsert transactions by stable id. Imported metadata always
  // refreshes from the file; user-owned fields (notes,
  // reconciledStatus, reconciledWith, plus the income category from
  // a prior manual merge) carry over so a re-import doesn't blow
  // away manual enrichment.
  const existing = data.bankTransactions = data.bankTransactions || [];
  const byId = new Map(existing.map(t => [t.id, t]));

  for (const incoming of classified) {
    const prior = byId.get(incoming.id);
    const merged = {
      ...incoming,
      accountId: result.account ? result.account.id : null,
      // User-owned enrichment (preserved across re-imports)
      notes:             prior?.notes              ?? null,
      userLabel:         prior?.userLabel          ?? incoming.userLabel ?? null,
      reconciledStatus:  prior?.reconciledStatus   ?? null,
      reconciledWith:    prior?.reconciledWith     ?? [],
      incomeCategoryId:  prior?.incomeCategoryId   ?? null,
      // Refresh imported metadata
      importedAt:        incoming.importedAt,
    };
    // Honor a manual category correction: keep the user's type, icon,
    // and grouping flags instead of the classifier's fresh guess.
    if (prior?.typeOverride) {
      merged.type              = prior.type;
      merged.icon              = prior.icon;
      merged.isInternal        = prior.isInternal;
      merged.isRecurring       = prior.isRecurring;
      merged.isReconcileTarget = prior.isReconcileTarget;
      merged.typeOverride      = true;
    }
    byId.set(incoming.id, merged);
  }

  // Apply per-pair dedupe choices:
  //   merge      → enrich the imported tx with the manual's user
  //                fields (income category, notes — and the manual's
  //                description as a userLabel when the bank's text
  //                is generic), then remove the manual.
  //   keep_both  → leave both records in place; remember the manual
  //                rejected this pairing so the next import doesn't
  //                suggest it again.
  const manualIdsToRemove = new Set();
  if (matches && choices) {
    for (const m of matches) {
      const choice = choices.get(m.incomingId) || 'merge';
      const imported = byId.get(m.incomingId);
      const manual   = byId.get(m.manualId);
      if (!imported || !manual) continue;

      if (choice === 'merge') {
        imported.incomeCategoryId = manual.incomeCategoryId || imported.incomeCategoryId || null;
        imported.notes            = manual.notes || imported.notes || null;
        if (manual.description && manual.description !== imported.description) {
          imported.userLabel = manual.description;
        }
        // Audit trail — preserves the manual's id on the imported
        // record so downstream consumers can show "this was a merge"
        // if they want, and re-imports won't try to merge twice.
        imported.mergedManualId = manual.id;
        manualIdsToRemove.add(manual.id);
      } else {
        manual.rejectedMatches = Array.from(new Set([
          ...(manual.rejectedMatches || []),
          m.incomingId,
        ]));
      }
    }
  }

  data.bankTransactions = [...byId.values()].filter(t => !manualIdsToRemove.has(t.id));

  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
}

// ── Preview rendering ─────────────────────────────────────────

function _renderPreview({ result, classified, newCount, updatedCount, matches, choices }) {
  const inflow  = classified.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
  const outflow = classified.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0);

  // Count by type for the breakdown pill row.
  const byType = new Map();
  for (const t of classified) byType.set(t.type, (byType.get(t.type) || 0) + 1);

  const accountLine = result.account
    ? `<div class="bank-import-account">${_esc(result.account.ownerName || '')} · ${_esc(result.account.bankId)} · ${_esc(result.account.branch)} / ${_esc(result.account.accountNumber)}</div>`
    : '';

  const periodLine = result.period
    ? `<div class="bank-import-period">${formatChargeDate(result.period.from)} – ${formatChargeDate(result.period.to)}</div>`
    : '';

  // Sample rows — first 10 (newest dates first) for a quick eyeball.
  const sample = [...classified]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10);

  return `
    <div class="import-preview">

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.detected')}</div>
        ${accountLine}
        ${periodLine}
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.totals')}</div>
        <div class="bank-import-totals">
          <div class="bank-import-total bank-import-total--in">
            <span class="bank-import-total-label">${t('bankImport.inflow')}</span>
            <span class="bank-import-total-value">${formatCurrency(inflow)}</span>
          </div>
          <div class="bank-import-total bank-import-total--out">
            <span class="bank-import-total-label">${t('bankImport.outflow')}</span>
            <span class="bank-import-total-value">${formatCurrency(outflow)}</span>
          </div>
          <div class="bank-import-total bank-import-total--net">
            <span class="bank-import-total-label">${t('bankImport.net')}</span>
            <span class="bank-import-total-value">${formatCurrency(inflow - outflow)}</span>
          </div>
        </div>
      </div>

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.transactions')}</div>
        <div class="import-summary-pills">
          <span class="import-pill import-pill--added">+${newCount} ${t('bankImport.new')}</span>
          ${updatedCount > 0
            ? `<span class="import-pill import-pill--unchanged">${updatedCount} ${t('bankImport.alreadySeen')}</span>`
            : ''}
        </div>
        <div class="bank-import-typebreak">
          ${[...byType.entries()].map(([type, count]) => `
            <span class="bank-import-type-chip">
              <span class="bank-import-type-icon" aria-hidden="true">${_typeIcon(type)}</span>
              ${t('bankTx.types.' + type)} · ${count}
            </span>
          `).join('')}
        </div>
      </div>

      ${_renderDedupeSection(matches, choices)}

      <div class="import-section">
        <div class="import-section-title">${t('bankImport.preview')}</div>
        <div class="import-changes-list">
          ${sample.map(_renderPreviewRow).join('')}
        </div>
      </div>

      ${(result.warnings && result.warnings.length > 0) ? `
        <div class="import-section">
          <div class="import-section-title import-section-title--warning">${t('import.warnings')}</div>
          <ul class="import-warnings">
            ${result.warnings.map(w => `<li>${_esc(w.message)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

// Possible-duplicates section. Hidden entirely when no matches.
// Each pair renders: imported row · ⇄ · manual row · [✓] Merge.
// Default checked = merge. The user can flip per-pair.
function _renderDedupeSection(matches, choices) {
  if (!matches || matches.length === 0) return '';
  const rows = matches.map(m => _renderDedupePair(m, choices)).join('');
  return `
    <div class="import-section">
      <div class="import-section-title">${t('bankImport.dedupe.title')}</div>
      <p class="import-section-intro">${t('bankImport.dedupe.intro')}</p>
      <ul class="bank-import-dedupe-list">
        ${rows}
      </ul>
    </div>
  `;
}

function _renderDedupePair(match, choices) {
  const checked = (choices.get(match.incomingId) || 'merge') === 'merge';
  const incoming = match.incomingTx;
  const manual   = match.manualTx;

  const incomingIcon = incoming.icon || '·';
  const incomingDesc = incoming.description || '';
  const incomingDate = incoming.date ? formatChargeDate(incoming.date) : (incoming.rawDate || '');

  // Manual side: prefer the user-typed description, prefix with the
  // income-category emoji when one was picked so the pair reads "💼
  // Salary" / "🎁 Gift" alongside the bank's row.
  const cat = manual.incomeCategoryId ? getIncomeCategoryById(manual.incomeCategoryId) : null;
  const manualIcon = cat ? cat.emoji : '✍️';
  const manualDesc = manual.description || (cat ? (cat.name[currentLang] || cat.name.en) : '');
  const manualDate = manual.date ? formatChargeDate(manual.date) : '';

  return `
    <li class="bank-import-dedupe-pair">
      <div class="bank-import-dedupe-side bank-import-dedupe-side--incoming">
        <span class="bank-import-row-icon" aria-hidden="true">${incomingIcon}</span>
        <span class="bank-import-dedupe-desc">${_esc(incomingDesc)}</span>
        <span class="bank-import-dedupe-meta">
          ${formatCurrency(incoming.amount, { cents: true })} · ${_esc(incomingDate)}
        </span>
        <span class="bank-import-dedupe-tag">${t('bankImport.dedupe.fromImport')}</span>
      </div>
      <div class="bank-import-dedupe-side bank-import-dedupe-side--manual">
        <span class="bank-import-row-icon" aria-hidden="true">${manualIcon}</span>
        <span class="bank-import-dedupe-desc">${_esc(manualDesc)}</span>
        <span class="bank-import-dedupe-meta">
          ${formatCurrency(manual.amount, { cents: true })} · ${_esc(manualDate)}
        </span>
        <span class="bank-import-dedupe-tag">${t('bankImport.dedupe.fromManual')}</span>
      </div>
      <label class="bank-import-dedupe-toggle">
        <input type="checkbox"
               data-dedupe-incoming="${_esc(match.incomingId)}"
               ${checked ? 'checked' : ''} />
        <span>${t('bankImport.dedupe.merge')}</span>
      </label>
    </li>
  `;
}

function _renderPreviewRow(tx) {
  const sign     = tx.direction === 'credit' ? '+' : '−';
  const toneCls  = tx.direction === 'credit' ? 'is-credit' : 'is-debit';
  const dateText = tx.date ? formatChargeDate(tx.date) : (tx.rawDate || '');
  return `
    <div class="import-change-row bank-import-row ${toneCls}">
      <span class="bank-import-row-icon" aria-hidden="true">${tx.icon || '·'}</span>
      <span class="bank-import-row-desc">${_esc(tx.description)}</span>
      <span class="bank-import-row-amount">${sign}${formatCurrency(tx.amount, { cents: true })}</span>
      <span class="bank-import-row-date">${_esc(dateText)}</span>
    </div>
  `;
}

function _typeIcon(type) {
  // Cheap lookup against the classifier's canonical icons by
  // running an empty description through the rules — keeps icon
  // ↔ type pairings in one place (the classifier).
  const order = [
    ['salary',                 '💼'],
    ['bit_transfer',           '⚡'],
    ['incoming_transfer',      '➕'],
    ['outgoing_transfer',      '➖'],
    ['card_settlement',        '💳'],
    ['investment_contribution','📈'],
    ['securities_buy',         '🛒'],
    ['securities_sell',        '💱'],
    ['dividend',               '🎁'],
    ['interest',               '💹'],
    ['refund',                 '🎉'],
    ['social_security',        '🏛'],
    ['insurance',              '🛡'],
    ['internal_savings',       '🔄'],
    ['fee',                    '🧾'],
    ['unclassified',           '·'],
  ];
  return (order.find(([t]) => t === type) || [, '·'])[1];
}

// ── Busy + error display ──────────────────────────────────────

function _showBusy() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.busyTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${t('bankImport.busyText')}</p>
  `;
  overlay.classList.add('open');
}

function _showImportError(message) {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('bankImport.errorTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${_esc(message)}</p>
    <p class="modal-confirm-text import-error-hint">${t('bankImport.errorHint')}</p>
  `;
  overlay.classList.add('open');
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
