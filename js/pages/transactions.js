// ─────────────────────────────────────────────────────────────────
//  TRANSACTIONS — money activity intelligence
//
//  Not a bank-statement viewer. The page consumes the grouping engine
//  (activity-groups.js) and the narrative composer (activity-narrative.js)
//  and renders 4 tiers, top-down:
//
//    1. Activity Read (hero) — plain-language paragraph for the
//       selected month + a 3-fact quantified strip + a prev/next
//       month switcher.
//    2. Group feed — each group (income / recurring / cards /
//       transfers / notable) rendered as a card with title, total,
//       and a list of compact dense rows.
//    3. Tail — "everything else" collapsed by default, expandable.
//    4. Empty state — when no transactions are tracked yet.
//
//  No flat-chronological toggle; the grouping IS the view. The Cards
//  drill-down already provides a per-card timeline when needed.
//
//  Module-local state:
//    _selectedMonth   — YYYY-MM string, the month the page is reading
//    _tailExpanded    — boolean; persists across re-renders so cash
//                       edits / language switches / other init() runs
//                       don't collapse the user's open tail.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency, _iconNote } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { classifyTransaction } from '../import/bank/classifier.js';
import { resolveIncomeCategoryId } from '../data/income-categories.js';
import { incomeCategoryDisplay, txTypeLabel, txTypeIcon } from '../config/registry.js';
import { iconForType } from '../brand-marks.js';
import { groupActivity } from '../intelligence/activity-groups.js';
import { getAppData } from '../state.js';
// composeActivityNarrative is intentionally not used on the page —
// the hero is a 3-stat snapshot now, and the grouped feed below
// carries the detail. The narrative composer stays in the engine
// for the future LLM assistant to consume as month-summary grounding.

let _selectedMonth = null;
let _tailExpanded  = false;

export function renderTransactions(data) {
  const transactions = data.bankTransactions || [];
  if (transactions.length === 0) return _renderEmpty();

  // Defensive classify-on-read for any pre-classifier rows so the
  // grouping engine sees a populated `type` on every row.
  for (const tx of transactions) {
    if (!tx.type) Object.assign(tx, classifyTransaction(tx));
  }

  // Available months, newest first.
  const months = _availableMonths(transactions);
  if (_selectedMonth == null || !months.includes(_selectedMonth)) {
    _selectedMonth = months[0];
  }

  const monthTxs = transactions.filter(t =>
    (t.date || '').slice(0, 7) === _selectedMonth
  );

  // History before the selected month — drives recurring detection
  // in the grouping engine. Three months back is enough for the
  // heuristic; broader windows mostly add noise.
  const cutoffMs = _firstOfMonthMs(_selectedMonth, -3);
  const historyBeforeMonth = transactions.filter(t => {
    if (!t.date) return false;
    const d = new Date(t.date).getTime();
    return d < _firstOfMonthMs(_selectedMonth, 0) && d >= cutoffMs;
  });

  const groupBundle      = groupActivity(monthTxs, historyBeforeMonth);
  const { groups, tail } = groupBundle;

  // Month nav — disable next/prev when we'd run off the end of the
  // data; better than rendering a chevron that does nothing.
  const idx       = months.indexOf(_selectedMonth);
  const hasPrev   = idx < months.length - 1; // older
  const hasNext   = idx > 0;                  // newer

  return `
    <section class="section" id="transactions">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('transactions.title')}</h2>
        </div>
        <div class="section-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openQuickIncomeModal()" title="${t('quickIncome.button')}">
            + ${t('quickIncome.button')}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openQuickBankExpenseModal()" title="${t('quickBankExpense.button')}">
            + ${t('quickBankExpense.button')}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openBankImportFlow()">
            + ${t('bankImport.button')}
          </button>
        </div>
      </div>

      ${_renderHero(monthTxs, groups, _selectedMonth, hasPrev, hasNext)}

      <div class="activity-feed">
        ${groups.map(_renderGroup).join('')}
        ${_renderTail(tail)}
      </div>

    </section>
  `;
}


// ── Hero — month pulse ───────────────────────────────────────────
//
// Snapshot, not paragraph. Three numbers (in · out · net) read in
// 2 seconds. Beneath, a quiet row of count chips lists which
// groups fired this month. The grouped cards below carry the
// detail — the hero only needs to give the pulse.

function _renderHero(monthTxs, groups, ym, hasPrev, hasNext) {
  const inflow  = monthTxs.filter(t => t.direction === 'credit').reduce((s, t) => s + (t.amount || 0), 0);
  const outflow = monthTxs.filter(t => t.direction === 'debit').reduce((s, t) => s + (t.amount || 0), 0);
  const net     = inflow - outflow;

  // Net stat picks its label by sign — "positive month" / "negative
  // month" carries the verdict so the value cell can stay a clean
  // signed number. Tone class drives color (green / red / neutral).
  //
  // The hero shows the full amount (₪13,402), not the compact ₪13K
  // used elsewhere: this is the headline financial figure and the
  // feed rows below it are all full-precision, so a rounded "K" here
  // reads as approximate and slightly untrustworthy next to them. We
  // prepend our own verdict sign (+ / −) and pass the absolute value
  // so formatCurrency renders a clean "₪13,402".
  const isPos     = net >= 0;
  const netLabel  = isPos ? t('activity.stat.netPositive') : t('activity.stat.netNegative');
  const netSign   = isPos ? '+' : '−';
  const netTone   = isPos ? 'positive' : 'negative';
  const netValue  = `${netSign}${formatCurrency(Math.abs(net))}`;

  // Count chips — one per group that fired, in feed order. Numbers
  // up front so the eye reads "how many" before reading what.
  // Singular/plural i18n is handled by separate keys so 1 income
  // doesn't read as "1 incomes" in Hebrew.
  const countChips = groups
    .map(g => {
      const count = g.items.length;
      const key = `activity.chip.${_groupKey(g.id)}.${count === 1 ? 'one' : 'many'}`;
      return `<span class="activity-count-chip">${_interpolate(t(key), { count })}</span>`;
    })
    .join('');

  const monthLabel = _formatMonthLabel(ym);

  return `
    <section class="activity-read">
      <header class="activity-read-top">
        <span class="activity-read-eyebrow">${netLabel}</span>
        <div class="activity-read-month">
          <button type="button"
                  class="activity-month-chev"
                  onclick="onActivityMonthStep(-1)"
                  ${hasPrev ? '' : 'disabled'}
                  aria-label="${t('activity.switcher.prev')}">‹</button>
          <span class="activity-month-label">${monthLabel}</span>
          <button type="button"
                  class="activity-month-chev"
                  onclick="onActivityMonthStep(1)"
                  ${hasNext ? '' : 'disabled'}
                  aria-label="${t('activity.switcher.next')}">›</button>
        </div>
      </header>

      <div class="activity-read-net ${netTone}">${netValue}</div>

      <div class="activity-stats">
        <div class="activity-stat">
          <span class="activity-stat-label">${t('activity.stat.in')}</span>
          <span class="activity-stat-value">${formatCurrency(inflow)}</span>
        </div>
        <div class="activity-stat">
          <span class="activity-stat-label">${t('activity.stat.out')}</span>
          <span class="activity-stat-value">${formatCurrency(outflow)}</span>
        </div>
      </div>

      ${countChips ? `<div class="activity-counts">${countChips}</div>` : ''}
    </section>
  `;
}

// Small template helper for the count chips ({count} substitution
// only). Kept local because there's a more elaborate narrative
// interpolator that handled monetary formatting too — that one
// went unused when the paragraph was dropped, so we inline a
// minimal substitution here.
function _interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '');
}


// ── Group card ───────────────────────────────────────────────────

function _renderGroup(group) {
  const titleKey  = `activity.group.${_groupKey(group.id)}`;
  const subtitle  = _groupSubtitle(group);
  const titleText = t(titleKey);

  return `
    <article class="activity-group activity-group--${group.id}">
      <header class="activity-group-header">
        <h3 class="activity-group-title">${titleText}</h3>
        <span class="activity-group-total">${_groupTotalText(group)}</span>
        ${subtitle ? `<span class="activity-group-sub">${subtitle}</span>` : ''}
      </header>
      <ul class="activity-rows">
        ${group.items.map(_renderRow).join('')}
      </ul>
    </article>
  `;
}

function _groupKey(id) {
  // Direct map for the i18n suffix — keeps the keys short and clean
  // on the i18n table.
  return ({
    income:     'income',
    recurring:  'recurring',
    cards:      'cards',
    transfers:  'transfers',
    notable:    'notable',
    tail:       'tail',
  })[id] || id;
}

function _groupSubtitle(group) {
  if (group.id === 'cards') {
    return t('activity.group.cardCount').replace('{count}', String(group.items.length));
  }
  if (group.id === 'recurring') {
    return t('activity.group.recurringSub');
  }
  if (group.id === 'income' && group.items.length > 1) {
    return t('activity.group.sources').replace('{count}', String(group.items.length));
  }
  if (group.id === 'transfers') {
    return t('activity.group.transfersSub');
  }
  return null;
}

function _groupTotalText(group) {
  // Income totals already read as positive currency. Recurring +
  // cards + transfers + notable are debit-side; the engine stores
  // amounts as positive numbers (direction='debit'), so we show
  // the absolute value with the page-wide convention.
  return formatCurrency(group.total);
}


// ── Compact single transaction row ───────────────────────────────

function _renderRow(tx) {
  const sign  = tx.direction === 'credit' ? '+' : '−';
  const tone  = tx.direction === 'credit' ? 'is-credit' : 'is-debit';
  const date  = tx.date ? formatChargeDate(tx.date) : '';
  // For credit rows we surface the user-facing INCOME CATEGORY (Salary,
  // Gift, …) — explicit or derived from the type — in place of the
  // technical type label, with its emoji as the row icon. Debit rows
  // keep the classifier's type label + emoji glyph unchanged.
  const incomeCatId = resolveIncomeCategoryId(tx);
  const incomeCat   = incomeCatId ? incomeCategoryDisplay(incomeCatId, currentLang) : null;
  // Prefer the registry's (admin-editable) icon/label; brand marks (Bit)
  // still override the glyph, and the stored tx.icon is the last fallback
  // so legacy rows never go blank.
  const icon  = incomeCat ? incomeCat.emoji : iconForType(tx.type, txTypeIcon(tx.type) || tx.icon || '·');
  const typeLabel = incomeCat ? incomeCat.name : txTypeLabel(tx.type);

  // The user's label wins over the bank's raw description. A note
  // marker (a lined-page glyph, deliberately NOT a pencil — every row
  // is editable, the marker only means "this one has a note") surfaces
  // when they've attached "what is it" context; full text on hover.
  const name = tx.userLabel || tx.description;
  const noteBadge = tx.notes
    ? ` <span class="activity-row-note" title="${_esc(tx.notes)}" aria-label="${_esc(t('editTransaction.notes'))}">${_iconNote}</span>`
    : '';
  const txId = _esc(tx.id);

  // Single-line layout on desktop: icon · description · type · date · amount.
  // The type label is rendered as a small caption beside the description so
  // a scan can read "what kind of transaction" without leaving the line.
  return `
    <li class="activity-row activity-row--editable ${tone}" data-tx-id="${txId}"
        role="button" tabindex="0"
        onclick="openEditTransactionModal('${txId}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openEditTransactionModal('${txId}');}"
        title="${_esc(t('editTransaction.rowHint'))}">
      <span class="activity-row-icon" aria-hidden="true">${icon}</span>
      <span class="activity-row-name">${_esc(name)}${noteBadge}</span>
      <span class="activity-row-type">${typeLabel}</span>
      <span class="activity-row-date">${_esc(date)}</span>
      <span class="activity-row-amount">${sign}${formatCurrency(tx.amount, { cents: true })}</span>
    </li>
  `;
}


// ── Tail (everything else, collapsed by default) ─────────────────

function _renderTail(tail) {
  if (!tail || !tail.items || tail.items.length === 0) return '';

  const count = tail.items.length;
  const totalAbs = Math.abs(tail.total);
  const totalSign = tail.total >= 0 ? '+' : '−';

  if (!_tailExpanded) {
    return `
      <button type="button" class="activity-tail-toggle activity-tail-toggle--collapsed"
              onclick="onActivityTailToggle()">
        ${t('activity.tail.show')
          .replace('{count}', String(count))
          .replace('{total}', `${totalSign}${formatCurrency(totalAbs)}`)}
      </button>
    `;
  }

  return `
    <article class="activity-group activity-group--tail">
      <header class="activity-group-header">
        <h3 class="activity-group-title">${t('activity.group.tail')}</h3>
        <span class="activity-group-total">${totalSign}${formatCurrency(totalAbs)}</span>
        <span class="activity-group-sub">${t('activity.group.tailSub').replace('{count}', String(count))}</span>
      </header>
      <ul class="activity-rows">
        ${tail.items.map(_renderRow).join('')}
      </ul>
      <button type="button" class="activity-tail-toggle activity-tail-toggle--expanded"
              onclick="onActivityTailToggle()">
        ${t('activity.tail.hide')}
      </button>
    </article>
  `;
}


// ── Inline-handler bridges (called via window — see app.js) ──────

export function onActivityMonthStep(delta) {
  // Cycle to the next/previous month that actually has transactions.
  // We never page into empty months — pointless.
  const months = _availableMonthsFromData();
  if (!months.length) return;
  const idx = months.indexOf(_selectedMonth);
  // months is sorted newest-first; +1 delta → move to a NEWER month
  // (lower index), -1 → OLDER (higher index). Match the chevron arrow
  // direction the user sees on screen.
  const nextIdx = idx - delta;
  if (nextIdx < 0 || nextIdx >= months.length) return;
  _selectedMonth = months[nextIdx];
}

export function onActivityTailToggle() {
  _tailExpanded = !_tailExpanded;
}


// ── Empty state ──────────────────────────────────────────────────

function _renderEmpty() {
  return `
    <section class="section" id="transactions">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('transactions.title')}</h2>
        </div>
        <div class="section-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openQuickIncomeModal()">
            + ${t('quickIncome.button')}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openQuickBankExpenseModal()">
            + ${t('quickBankExpense.button')}
          </button>
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

function _availableMonths(transactions) {
  const set = new Set();
  for (const t of transactions) {
    const ym = (t.date || '').slice(0, 7);
    if (ym) set.add(ym);
  }
  // Newest first so the default lands on the most recent month
  // with data, and the +1 step ("next" / newer) moves toward today.
  return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
}

// Used by the month-switcher handler, which doesn't receive `data`
// as an argument. State module is leaf so a static top-level import
// is safe (no circular dep).
function _availableMonthsFromData() {
  const data = getAppData();
  return _availableMonths(data ? (data.bankTransactions || []) : []);
}

function _firstOfMonthMs(ym, deltaMonths) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1 + (deltaMonths || 0), 1).getTime();
}

function _formatMonthLabel(ym) {
  if (!ym || ym === '0000-00') return '—';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(currentLang === 'he' ? 'he-IL' : 'en-US', {
    year:  'numeric',
    month: 'long',
  });
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
