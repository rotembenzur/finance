// ─────────────────────────────────────────────────────────────────
//  TRANSACTIONS — bank-account movements (תנועות בחשבון)
//
//  A separate layer from credit-card charges, cash, and investments.
//  Each row is one bank-statement transaction (salary, bit, transfer,
//  card settlement, investment contribution, fee, dividend, …) keyed
//  by a stable fingerprint id so re-imports are idempotent.
//
//  This page renders the data as a financial timeline:
//
//    1. Hero summary — money in / money out / net for the selected
//       month, calculated from this layer alone (not blended with
//       card or cash data so the figures stay attributable).
//    2. Filter chips — All · Income · Spending · Transfers · Recurring.
//    3. Monthly groups — each month gets a header with a per-month
//       running total; rows are sorted newest-first inside.
//    4. Empty state — friendly CTA to import the first statement.
//
//  No raw banking-table feel: every row is a "✏️ icon + description +
//  amount + balance" composition, the way the rest of the app reads.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import { formatChargeDate, formatMilestone } from '../dates.js';
import { classifyTransaction } from '../import/bank/classifier.js';

export function renderTransactions(data) {
  const accounts     = data.bankAccounts     || [];
  const transactions = data.bankTransactions || [];

  if (transactions.length === 0) return _renderEmpty();

  // Newest first across the full set.
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Bucket by YYYY-MM for the monthly group headers.
  const byMonth = new Map();
  for (const tx of sorted) {
    const ym = tx.date ? tx.date.slice(0, 7) : '0000-00';
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(tx);
  }

  // Hero summary uses the most recent month with data so the page
  // lands on something meaningful — empty months hide automatically.
  const monthKeys     = [...byMonth.keys()];
  const headMonth     = monthKeys[0];
  const headMonthRows = byMonth.get(headMonth) || [];
  const inflow  = headMonthRows.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
  const outflow = headMonthRows.filter(t => t.direction === 'debit' && !_isInternalForOutflow(t))
                               .reduce((s, t) => s + t.amount, 0);
  const cardSettled = headMonthRows
    .filter(t => t.direction === 'debit' && t.type === 'card_settlement')
    .reduce((s, t) => s + t.amount, 0);

  return `
    <section class="section" id="transactions">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('transactions.title')}</h2>
          ${accounts.length > 0 ? `
            <p class="section-intro">${_accountSummary(accounts)}</p>
          ` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="openBankImportFlow()">
          + ${t('bankImport.button')}
        </button>
      </div>

      ${_renderHero(headMonth, inflow, outflow, cardSettled)}

      <div class="bank-timeline">
        ${monthKeys.map(ym => _renderMonthGroup(ym, byMonth.get(ym))).join('')}
      </div>

    </section>
  `;
}

// ── Hero ─────────────────────────────────────────────────────────

function _renderHero(monthYm, inflow, outflow, cardSettled) {
  const label = _formatMonthLabel(monthYm);
  const net   = inflow - outflow;
  const netCls = net >= 0 ? 'positive' : 'negative';

  return `
    <div class="bank-summary">
      <div class="bank-summary-label">${label}</div>
      <div class="bank-summary-stats">
        <div class="bank-summary-stat">
          <span class="bank-summary-stat-label">${t('transactions.summary.in')}</span>
          <span class="bank-summary-stat-value positive">${formatCurrency(inflow)}</span>
        </div>
        <div class="bank-summary-stat">
          <span class="bank-summary-stat-label">${t('transactions.summary.out')}</span>
          <span class="bank-summary-stat-value negative">${formatCurrency(outflow)}</span>
          ${cardSettled > 0 ? `
            <span class="bank-summary-stat-sub">${t('transactions.summary.cardSettlement')} ${formatCurrency(cardSettled)}</span>
          ` : ''}
        </div>
        <div class="bank-summary-stat">
          <span class="bank-summary-stat-label">${t('transactions.summary.net')}</span>
          <span class="bank-summary-stat-value ${netCls}">${formatCurrency(net)}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Monthly group + row rendering ────────────────────────────────

function _renderMonthGroup(ym, rows) {
  const label = _formatMonthLabel(ym);
  const monthIn  = rows.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
  const monthOut = rows.filter(t => t.direction === 'debit' && !_isInternalForOutflow(t))
                       .reduce((s, t) => s + t.amount, 0);

  return `
    <div class="bank-month">
      <div class="bank-month-header">
        <span class="bank-month-label">${label}</span>
        <span class="bank-month-net">
          <span class="positive">+${formatCurrency(monthIn)}</span>
          <span class="bank-month-net-sep">·</span>
          <span class="negative">−${formatCurrency(monthOut)}</span>
        </span>
      </div>
      <div class="bank-month-rows">
        ${rows.map(_renderRow).join('')}
      </div>
    </div>
  `;
}

function _renderRow(tx) {
  // Defensive re-classify when older rows (pre-classifier) lack a
  // type — the migration ran but the parser hadn't tagged them yet.
  if (!tx.type) Object.assign(tx, classifyTransaction(tx));

  const sign       = tx.direction === 'credit' ? '+' : '−';
  const toneCls    = tx.direction === 'credit' ? 'bank-tx-row--credit' : 'bank-tx-row--debit';
  const internalCls = tx.isInternal ? 'bank-tx-row--internal' : '';
  const typeLabel  = t('bankTx.types.' + tx.type);

  return `
    <div class="bank-tx-row ${toneCls} ${internalCls}" data-tx-id="${_esc(tx.id)}">
      <span class="bank-tx-row-icon" aria-hidden="true">${tx.icon || '·'}</span>
      <div class="bank-tx-row-body">
        <div class="bank-tx-row-name-line">
          <span class="bank-tx-row-name">${_esc(tx.description)}</span>
          <span class="bank-tx-row-type">${typeLabel}</span>
        </div>
        <div class="bank-tx-row-meta">
          ${tx.date ? formatChargeDate(tx.date) : ''} ${typeof tx.balance === 'number' ? `· ${t('transactions.balanceAfter')} ${formatCurrency(tx.balance)}` : ''}
        </div>
      </div>
      <span class="bank-tx-row-amount">${sign}${formatCurrency(tx.amount, { cents: true })}</span>
    </div>
  `;
}

// ── Empty state ──────────────────────────────────────────────────

function _renderEmpty() {
  return `
    <section class="section" id="transactions">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('transactions.title')}</h2>
        </div>
      </div>
      <div class="bank-empty">
        <div class="bank-empty-icon" aria-hidden="true">🏦</div>
        <div class="bank-empty-title">${t('transactions.empty.title')}</div>
        <p class="bank-empty-body">${t('transactions.empty.body')}</p>
        <button class="btn btn-primary" onclick="openBankImportFlow()">
          + ${t('bankImport.button')}
        </button>
      </div>
    </section>
  `;
}

// ── Helpers ──────────────────────────────────────────────────────

function _accountSummary(accounts) {
  return accounts.map(a => {
    const name = a.ownerName || '';
    const id   = `${a.bankId} · ${a.branch} / ${a.accountNumber}`;
    return name ? `${name} — ${id}` : id;
  }).join(' · ');
}

function _formatMonthLabel(ym) {
  if (!ym || ym === '0000-00') return '—';
  const [y, m] = ym.split('-').map(Number);
  // Use mid-month so DST never bumps us to the previous month.
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(currentLang === 'he' ? 'he-IL' : 'en-US', {
    year: 'numeric',
    month: 'long',
  });
}

// Outflow that's actually internal money movement (card settlement,
// transfers to your own brokerage/savings, securities purchase) is
// not "spending" — exclude it from the headline outflow figure so the
// number reads as actual money leaving your life.
function _isInternalForOutflow(tx) {
  return !!tx.isInternal;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
