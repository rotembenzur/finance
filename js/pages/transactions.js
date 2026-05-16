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
import { formatCurrency, formatCurrencyCompact } from '../utils.js';
import { formatChargeDate } from '../dates.js';
import { classifyTransaction } from '../import/bank/classifier.js';
import { groupActivity } from '../intelligence/activity-groups.js';
import { composeActivityNarrative } from '../intelligence/activity-narrative.js';
import { getAppData } from '../state.js';

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
  const narrative        = composeActivityNarrative(monthTxs, groupBundle);

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
          <button class="btn btn-ghost btn-sm" onclick="openBankImportFlow()">
            + ${t('bankImport.button')}
          </button>
        </div>
      </div>

      ${_renderHero(narrative, monthTxs, groups, _selectedMonth, hasPrev, hasNext)}

      <div class="activity-feed">
        ${groups.map(_renderGroup).join('')}
        ${_renderTail(tail)}
      </div>

    </section>
  `;
}


// ── Hero — Activity Read ─────────────────────────────────────────

function _renderHero(narrative, monthTxs, groups, ym, hasPrev, hasNext) {
  // Resolve the narrative sentences against i18n + format amount
  // vars to compact currency. Same pattern the Intelligence page
  // uses for its Portfolio Read.
  const paragraph = narrative.sentences
    .map(s => _interpolateNarrative(t(s.key), s.vars))
    .filter(Boolean)
    .join(' ');

  // 3-fact strip: net kept, recurring monthly weight, notable count.
  // Picks the most informative chips for this month — the engine
  // already knows what's present.
  const inflow  = monthTxs.filter(t => t.direction === 'credit').reduce((s, t) => s + (t.amount || 0), 0);
  const outflow = monthTxs.filter(t => t.direction === 'debit').reduce((s, t) => s + (t.amount || 0), 0);
  const net     = inflow - outflow;
  const recurring = groups.find(g => g.id === 'recurring');
  const notable   = groups.find(g => g.id === 'notable');

  const chips = [];
  chips.push(`<span class="activity-strip-chip">${net >= 0
    ? `<strong>${formatCurrencyCompact(net)}</strong> ${t('activity.strip.kept')}`
    : `<strong>${formatCurrencyCompact(-net)}</strong> ${t('activity.strip.over')}`}</span>`);
  if (recurring) {
    chips.push(`<span class="activity-strip-chip">
      <strong>${recurring.items.length}</strong> ${t('activity.strip.recurring')} ·
      ${formatCurrencyCompact(recurring.total)}${t('activity.strip.perMonthSuffix')}
    </span>`);
  }
  if (notable) {
    chips.push(`<span class="activity-strip-chip">
      <strong>${notable.items.length}</strong> ${t('activity.strip.notable')}
    </span>`);
  }

  const monthLabel = _formatMonthLabel(ym);

  return `
    <section class="activity-read">
      <header class="activity-read-header">
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
      <p class="activity-read-paragraph">${paragraph}</p>
      <div class="activity-strip">
        ${chips.join('')}
      </div>
    </section>
  `;
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
  const icon  = tx.icon || '·';
  const typeLabel = t('bankTx.types.' + tx.type);

  // Single-line layout on desktop: icon · description · type · date · amount.
  // The type label is rendered as a small caption beside the description so
  // a scan can read "what kind of transaction" without leaving the line.
  return `
    <li class="activity-row ${tone}" data-tx-id="${_esc(tx.id)}">
      <span class="activity-row-icon" aria-hidden="true">${icon}</span>
      <span class="activity-row-name">${_esc(tx.description)}</span>
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

function _interpolateNarrative(template, vars) {
  if (!template) return '';
  const v = { ...vars };
  // Pre-format monetary vars so the i18n table stays free of
  // formatting concerns.
  for (const key of ['in', 'out', 'net', 'over', 'amount', 'total']) {
    if (typeof v[key] === 'number') v[key] = formatCurrencyCompact(v[key]);
  }
  // Date var → readable date string.
  if (v.date) v.date = formatChargeDate(v.date);
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const val = v[k];
    if (val == null) return '';
    return typeof val === 'string' ? _esc(val) : String(val);
  });
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
