// ─────────────────────────────────────────────────────────────────
//  CASH HISTORY — drilldown view for a single cash entry.
//
//  Cash entries now hold their own `charges: []` array (mirroring
//  the card schema). This page is the dedicated history surface:
//   · Header — entry name + current balance
//   · Month picker (defaults to current month)
//   · Selected-month total + category breakdown
//   · 12-month rolling history (bar list)
//   · Charges list for the selected month
//
//  Reached via app.js's _currentView = { type: 'cash-history',
//  entryId }. The "View History" button on the cash card sets this
//  view; the Back button on the page returns to the Accounts section.
//
//  Charge shape mirrors card.charges, so the same renderers (and
//  future enrichment flows) work for both surfaces without forks.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatChargeDate } from '../dates.js';
import { formatCurrency, isCashLikeEntry } from '../utils.js';
import { getCategoryById, getIncomeCategoryById } from '../config/registry.js';
import { reimbursementStatus, reimbursementRemaining } from '../reimbursements.js';

// Signed amount for a cash-history entry: expenses subtract, income
// entries (direction='in') add. Legacy charges without a direction
// field are implicitly expenses ('out').
function _signedAmount(c) {
  const amt = Number(c.amount) || 0;
  return c.direction === 'in' ? amt : -amt;
}
function _isIncome(c) {
  return c && c.direction === 'in';
}

// The drilldown is always for one cash entry — capture its id at the
// top of each render so the per-row edit button can reference it
// without threading it through every helper.
let _entryId = null;

export function renderCashHistory(data, entryId, monthOverride = null) {
  _entryId = entryId;
  const entry = (data.entries || []).find(e =>
    e.id === entryId && isCashLikeEntry(e)
  );
  if (!entry) return _renderNotFound();

  const charges = (entry.charges || []).slice();

  // The selected period defaults to the current calendar month but can
  // be overridden by the month-picker on the page (the picker writes
  // to _currentView.monthOverride and triggers a re-render).
  const selectedMonth = monthOverride && /^\d{4}-\d{2}$/.test(monthOverride)
    ? monthOverride
    : _currentMonth();

  const inMonth = charges.filter(c => _isoMonth(c.date) === selectedMonth);
  // "Spent this month" is gross expenses only — income must NOT net it
  // down, or the figure under an "expenses" label reads wrong (and goes
  // negative on a net-inflow month). Income is surfaced on its own line.
  // monthTotal (net = out − in) is reserved for the transactions rollup
  // and the 12-month trend, which intentionally read wallet change.
  const monthSpend = inMonth.filter(c => !_isIncome(c)).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const monthIncome = inMonth.filter(_isIncome).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const monthTotal = monthSpend - monthIncome;

  const sortedCharges = inMonth.slice().sort(_sortChargesDescending);
  const yearTrend     = _buildTrailingTwelveMonths(charges, selectedMonth);
  // Category breakdown shows expense categories only — income gets a
  // separate single-line summary above the breakdown.
  const categories    = _categoryBreakdown(inMonth.filter(c => !_isIncome(c)));

  const displayName = currentLang === 'he'
    ? (entry.name   || entry.nameEn || t('cashHistory.defaultName'))
    : (entry.nameEn || entry.name   || t('cashHistory.defaultName'));

  return `
    <section class="section cash-history-page">

      <div class="card-charges-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="navigateToSection('accounts')">
          <span class="card-charges-back-arrow" aria-hidden="true">←</span>
          ${t('cashHistory.back')}
        </button>
      </div>

      <header class="card-charges-header">
        <div class="card-charges-identity">
          <div class="card-charges-name">${_esc(displayName)}</div>
          <div class="card-charges-meta">
            ${t('cashHistory.currentBalance')} · ${formatCurrency(entry.balance || 0)}
          </div>
        </div>
      </header>

      <div class="cash-history-controls">
        ${_renderPeriodPicker(entry.id, selectedMonth)}
        <div class="cash-history-month-totals">
          <span class="cash-history-month-total">
            ${t('cashHistory.spentThisMonth')} · ${formatCurrency(monthSpend)}
          </span>
          ${monthIncome > 0 ? `
            <span class="cash-history-month-total cash-history-month-total--income">
              ${t('cashHistory.receivedThisMonth')} · +${formatCurrency(monthIncome)}
            </span>
          ` : ''}
        </div>
      </div>

      ${_renderCategoryBreakdown(categories, monthSpend)}

      ${_renderTwelveMonthTrend(yearTrend, selectedMonth)}

      <div class="card-charges-section">
        <div class="card-charges-section-head">
          <h3 class="card-charges-section-title">${t('cashHistory.thisMonth')}</h3>
          ${inMonth.length > 0 ? `
            <span class="card-charges-section-total">
              ${inMonth.length} ${inMonth.length === 1 ? t('cashHistory.itemOne') : t('cashHistory.itemMany')}
              ·
              ${formatCurrency(monthTotal, { cents: true })}
            </span>
          ` : ''}
        </div>

        ${sortedCharges.length === 0
          ? `<div class="empty-state">${t('cashHistory.emptyMonth')}</div>`
          : `<div class="charges-list">${sortedCharges.map(_renderChargeRow).join('')}</div>`}
      </div>

    </section>
  `;
}


// ── Period picker ──────────────────────────────────────────────
// Chevron-prev · readable-label-pill · chevron-next, with a
// dropdown anchored to the pill that lists the last 24 months as
// natural-language entries (toLocaleDateString picks the right
// format per language: "מאי 2026" / "May 2026"). Outside-click and
// Escape close the dropdown — handled in js/app.js once at module
// load, scoped to .period-picker.is-open.
function _renderPeriodPicker(entryId, selectedMonth) {
  const cur = _currentMonth();
  const atCurrent = selectedMonth >= cur;
  const idEsc = _esc(entryId);

  const options = _trailingMonths(selectedMonth, 24).map(m => {
    const selected = m === selectedMonth;
    return `
      <button type="button"
              class="period-picker-option ${selected ? 'is-selected' : ''}"
              role="option"
              aria-selected="${selected}"
              data-month="${m}"
              onclick="onCashHistoryMonthSelect('${m}', '${idEsc}')">
        <span class="period-picker-option-label">${_esc(_humanMonth(m))}</span>
        ${selected ? `<span class="period-picker-option-check" aria-hidden="true">✓</span>` : ''}
      </button>
    `;
  }).join('');

  return `
    <div class="period-picker" data-entry-id="${idEsc}">
      <button class="period-picker-step"
              type="button"
              aria-label="${t('cashHistory.prevMonth')}"
              onclick="onCashHistoryMonthStep(-1, '${idEsc}')">
        ${_chevronIcon('start')}
      </button>

      <button class="period-picker-label"
              type="button"
              aria-haspopup="listbox"
              aria-expanded="false"
              onclick="onCashHistoryToggleDropdown(this)">
        <span class="period-picker-label-text">${_esc(_humanMonth(selectedMonth))}</span>
        <span class="period-picker-label-caret" aria-hidden="true">▾</span>
      </button>

      <button class="period-picker-step"
              type="button"
              aria-label="${t('cashHistory.nextMonth')}"
              ${atCurrent ? 'disabled' : ''}
              onclick="onCashHistoryMonthStep(1, '${idEsc}')">
        ${_chevronIcon('end')}
      </button>

      <div class="period-picker-menu" role="listbox">
        ${options}
      </div>
    </div>
  `;
}

// Chevrons — direction-aware. The `direction` param picks "start"
// (older / inline-start side) or "end" (newer / inline-end side).
// In RTL the chevrons flip via CSS, so the SVG points the right way
// in both reading directions.
function _chevronIcon(direction) {
  const path = direction === 'start'
    ? 'M10 2 L4 8 L10 14'   // chevron-left
    : 'M6 2 L12 8 L6 14';   // chevron-right
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function _humanMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  const date   = new Date(y, m - 1, 1);
  return date.toLocaleDateString(
    currentLang === 'he' ? 'he-IL' : 'en-US',
    { month: 'long', year: 'numeric' }
  );
}

// Build the last `count` months ending at `endMonth` (YYYY-MM),
// newest first.
function _trailingMonths(endMonth, count) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ref = new Date(y, m - 1 - i, 1);
    out.push(`${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}


// ── Internal rendering ─────────────────────────────────────────

function _renderCategoryBreakdown(categories, expenseTotal) {
  if (categories.length === 0) return '';

  const rows = categories.slice(0, 6).map(c => {
    const pct = expenseTotal > 0 ? Math.round((c.total / expenseTotal) * 100) : 0;
    return `
      <div class="cash-category-row">
        <span class="cash-category-emoji" aria-hidden="true">${c.emoji}</span>
        <span class="cash-category-name">${_esc(c.label)}</span>
        <span class="cash-category-amount">${formatCurrency(c.total)}</span>
        <span class="cash-category-pct">${pct}%</span>
      </div>
    `;
  }).join('');

  return `
    <div class="card-charges-section">
      <div class="card-charges-section-head">
        <h3 class="card-charges-section-title">${t('cashHistory.byCategory')}</h3>
      </div>
      <div class="cash-category-list">${rows}</div>
    </div>
  `;
}

function _renderTwelveMonthTrend(trend, selectedMonth) {
  const max = trend.reduce((m, x) => Math.max(m, x.total), 0);
  if (max === 0 && trend.every(x => x.total === 0)) return '';

  const rows = trend.map(m => {
    const pct  = max > 0 ? Math.round((m.total / max) * 100) : 0;
    const isCurrent = m.month === selectedMonth;
    return `
      <div class="cash-trend-row ${isCurrent ? 'is-current' : ''}">
        <span class="cash-trend-label">${m.label}</span>
        <span class="cash-trend-bar">
          <span class="cash-trend-bar-fill" style="width: ${pct}%"></span>
        </span>
        <span class="cash-trend-amount">${formatCurrency(m.total)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="card-charges-section">
      <div class="card-charges-section-head">
        <h3 class="card-charges-section-title">${t('cashHistory.trailing12')}</h3>
      </div>
      <div class="cash-trend-list">${rows}</div>
    </div>
  `;
}

function _renderChargeRow(charge) {
  const primary = _primaryLineFor(charge);
  const meta    = _metaLineFor(charge, primary);
  const income  = _isIncome(charge);
  // Income rows render with a + sign and a positive tone so the eye
  // separates "money in" from "money out" without reading the meta.
  // formatCurrency itself doesn't take a sign hint, so we prepend.
  const amountStr = income
    ? `+${formatCurrency(charge.amount, { cents: true })}`
    : formatCurrency(charge.amount, { cents: true });

  const chargeId = _esc(charge.id || '');
  const entryId  = _esc(_entryId || '');

  // Expense rows show their reimbursement status; income rows that were
  // linked as a settlement show a quiet "settlement" tag so it's clear
  // they're not counted as real income.
  const reimbChip = income
    ? (charge.isReimbursement ? `<span class="reimb-chip reimb-chip--settle">↩ ${t('reimbursement.chip.settlement')}</span>` : '')
    : _reimbChip(charge);

  return `
    <button type="button" class="charge-row ${income ? 'charge-row--income' : ''}"
            data-charge-id="${chargeId}" data-entry-id="${entryId}"
            onclick="openEditCashChargeModal('${entryId}', '${chargeId}')">
      <div class="charge-row-info">
        <div class="charge-row-name">${primary}</div>
        ${meta || reimbChip ? `<div class="charge-row-meta">${reimbChip}${meta ? `<span class="charge-row-meta-text">${meta}</span>` : ''}</div>` : ''}
      </div>
      <div class="charge-row-amount">${amountStr}</div>
    </button>
  `;
}

function _reimbChip(charge) {
  const st = reimbursementStatus(charge);
  if (st === 'none') return '';
  const label = st === 'full'
    ? t('reimbursement.chip.full')
    : t('reimbursement.chip.' + st).replace('{remaining}', formatCurrency(reimbursementRemaining(charge)));
  return `<span class="reimb-chip reimb-chip--${st}">↩ ${label}</span>`;
}

function _primaryLineFor(charge) {
  if (charge.merchant)    return _esc(charge.merchant);
  if (charge.description) return _esc(charge.description);
  return t('cashHistory.unknownCharge');
}

function _metaLineFor(charge, primary) {
  const parts = [];
  if (charge.date) parts.push(formatChargeDate(charge.date));
  // Income rows reference the income-categories registry; expenses
  // continue to use expense-categories. Categories are stored under
  // different fields (incomeCategoryId vs categoryId) so the two
  // taxonomies never collide.
  if (_isIncome(charge) && charge.incomeCategoryId) {
    const cat = getIncomeCategoryById(charge.incomeCategoryId);
    if (cat) {
      const label = cat.name[currentLang] || cat.name.en;
      parts.push(`${cat.emoji} ${_esc(label)}`);
    }
  } else if (charge.categoryId) {
    const cat = getCategoryById(charge.categoryId);
    if (cat) {
      const label = cat.name[currentLang] || cat.name.en;
      parts.push(`${cat.emoji} ${_esc(label)}`);
    }
  }
  if (charge.description && primary !== _esc(charge.description)) {
    parts.push(_esc(charge.description));
  }
  return parts.join(' · ');
}

function _renderNotFound() {
  return `
    <section class="section cash-history-page">
      <div class="card-charges-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="navigateToSection('accounts')">
          <span class="card-charges-back-arrow" aria-hidden="true">←</span>
          ${t('cashHistory.back')}
        </button>
      </div>
      <div class="empty-state">${t('cashHistory.notFound')}</div>
    </section>
  `;
}


// ── Aggregation ────────────────────────────────────────────────

function _categoryBreakdown(charges) {
  const byCat = new Map();
  let uncategorizedTotal = 0;

  for (const c of charges) {
    const amt = c.amount || 0;
    if (!c.categoryId) { uncategorizedTotal += amt; continue; }
    byCat.set(c.categoryId, (byCat.get(c.categoryId) || 0) + amt);
  }

  const rows = Array.from(byCat.entries()).map(([id, total]) => {
    const cat = getCategoryById(id);
    return {
      id,
      total,
      emoji: cat ? cat.emoji : '•',
      label: cat ? (cat.name[currentLang] || cat.name.en) : id,
    };
  });

  if (uncategorizedTotal > 0) {
    rows.push({
      id: '__uncategorized__',
      total: uncategorizedTotal,
      emoji: '•',
      label: t('cashHistory.uncategorized'),
    });
  }

  return rows.sort((a, b) => b.total - a.total);
}

// Trailing 12 months ending at `endMonth` (YYYY-MM). Includes empty
// months so the trend bar stays a consistent length even when the
// user only has data for a few of them.
function _buildTrailingTwelveMonths(charges, endMonth) {
  const [y, m] = endMonth.split('-').map(Number);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(y, m - 1 - i, 1);
    const ym  = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
    // Net spend for the month: expenses minus income. The 12-month
    // bar chart reads "how much your wallet shrank this month" so
    // months with more income than expense show as negative spend
    // (i.e. net inflow).
    const total = charges
      .filter(c => _isoMonth(c.date) === ym)
      .reduce((s, c) => {
        const amt = Number(c.amount) || 0;
        return _isIncome(c) ? s - amt : s + amt;
      }, 0);
    months.push({
      month: ym,
      label: ref.toLocaleDateString(
        currentLang === 'he' ? 'he-IL' : 'en-US',
        { month: 'short', year: 'numeric' }
      ),
      total,
    });
  }
  return months;
}


// ── Helpers ────────────────────────────────────────────────────

function _isoMonth(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  // Charge dates are ISO YYYY-MM-DD; slice 0..7 → YYYY-MM.
  return dateStr.slice(0, 7);
}

function _currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _sortChargesDescending(a, b) {
  if (a.date && b.date) return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  if (a.date && !b.date) return -1;
  if (!a.date && b.date) return 1;
  return 0;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
