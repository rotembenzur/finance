// ─────────────────────────────────────────────────────────────────
//  SPENDING — where the money goes, by category
//
//  Spending-side counterpart to the wealth-side Intelligence page.
//  Reads the spending engine (intelligence/spending.js) and renders:
//
//    1. Hero — month switcher + total spent + month-over-month delta
//       + charge count.
//    2. Breakdown — categories sorted by spend, each a row with
//       emoji · name · proportional bar · total · % of spend, tap
//       to expand the subcategory rows beneath.
//
//  Insights ("biggest category", "subscriptions rose 40%", spikes)
//  land in slice B (spending-insights.js). This slice is the
//  breakdown + month switcher.
//
//  Module-local _selectedMonth + _expanded survive init() re-renders
//  so unrelated state changes don't reset the user's month/expansion.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency } from '../utils.js';
import { getAppData } from '../state.js';
import {
  buildSpendingProfile, availableSpendingMonths,
  UNCATEGORIZED, NO_SUBCATEGORY,
} from '../intelligence/spending.js';
import {
  categoryDisplay, subcategoryDisplay,
} from '../data/expense-categories.js';

let _selectedMonth = null;
const _expanded = new Set();   // category IDs currently expanded

export function renderSpending(data) {
  const months = availableSpendingMonths(data);
  if (months.length === 0) return _renderEmpty();

  if (_selectedMonth == null || !months.includes(_selectedMonth)) {
    _selectedMonth = months[0];
  }

  const profile = buildSpendingProfile(data, _selectedMonth);
  const idx     = months.indexOf(_selectedMonth);
  const hasPrev = idx < months.length - 1; // older
  const hasNext = idx > 0;                  // newer

  return `
    <section class="section" id="spending">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('spending.title')}</h2>
          <p class="section-intro">${t('spending.intro')}</p>
        </div>
      </div>

      ${_renderHero(profile, _selectedMonth, hasPrev, hasNext)}
      ${_renderBreakdown(profile)}

    </section>
  `;
}


// ── Hero — month switcher + total + delta ────────────────────────

function _renderHero(profile, ym, hasPrev, hasNext) {
  const monthLabel = _formatMonthLabel(ym);

  // Compact directional delta chip beside the total (spending up reads
  // red, down reads green — for an expenses view, less is the good news).
  // The full "vs last month" sentence rides along as the accessible label.
  let deltaChip = '';
  if (profile.deltaPct == null) {
    deltaChip = `<span class="spending-hero-delta spending-hero-delta--flat">${t('spending.noPrev')}</span>`;
  } else if (Math.abs(profile.deltaPct) < 0.5) {
    deltaChip = `<span class="spending-hero-delta spending-hero-delta--flat">${t('spending.flat')}</span>`;
  } else {
    const up    = profile.delta > 0;
    const tone  = up ? 'up' : 'down';
    const arrow = up ? '↑' : '↓';
    const pct   = Math.abs(profile.deltaPct).toFixed(0);
    const full  = t(up ? 'spending.moreThanLast' : 'spending.lessThanLast').replace('{pct}', pct);
    deltaChip = `<span class="spending-hero-delta spending-hero-delta--${tone}" title="${_esc(full)}" aria-label="${_esc(full)}">${arrow} ${pct}%</span>`;
  }

  const avg = profile.count > 0 ? Math.round(profile.total / profile.count) : 0;

  return `
    <section class="spending-hero">
      <header class="spending-hero-top">
        <span class="spending-hero-label">${t('spending.totalLabel')}</span>
        <div class="spending-hero-month">
          <button type="button" class="spending-month-chev"
                  onclick="onSpendingMonthStep(-1)" ${hasPrev ? '' : 'disabled'}
                  aria-label="${t('spending.prevMonth')}">‹</button>
          <span class="spending-month-label">${monthLabel}</span>
          <button type="button" class="spending-month-chev"
                  onclick="onSpendingMonthStep(1)" ${hasNext ? '' : 'disabled'}
                  aria-label="${t('spending.nextMonth')}">›</button>
        </div>
      </header>

      <div class="spending-hero-amount">
        <span class="spending-hero-total">${formatCurrency(profile.total)}</span>
        ${deltaChip}
      </div>

      <div class="spending-hero-stats">
        <div class="spending-hero-stat">
          <span class="spending-hero-stat-value">${profile.count}</span>
          <span class="spending-hero-stat-label">${t('spending.statCharges')}</span>
        </div>
        <div class="spending-hero-stat">
          <span class="spending-hero-stat-value">${formatCurrency(avg)}</span>
          <span class="spending-hero-stat-label">${t('spending.statAvg')}</span>
        </div>
      </div>
    </section>
  `;
}


// ── Breakdown — category rows, expandable to subcategories ───────

function _renderBreakdown(profile) {
  if (!profile.categories.length) {
    return `<div class="spending-empty-month">${t('spending.emptyMonth')}</div>`;
  }

  const rows = profile.categories.map(cat => _renderCategoryRow(cat, profile.total)).join('');

  return `
    <div class="spending-breakdown">
      <h3 class="spending-breakdown-title">${t('spending.whereItWent')}</h3>
      ${rows}
    </div>
  `;
}

function _renderCategoryRow(cat, monthTotal) {
  const display = cat.categoryId === UNCATEGORIZED
    ? { emoji: '•', name: t('spending.uncategorized') }
    : (categoryDisplay(cat.categoryId, currentLang) || { emoji: '•', name: cat.categoryId });

  const expanded = _expanded.has(cat.categoryId);
  const pct      = monthTotal > 0 ? (cat.total / monthTotal) * 100 : 0;
  const hasSubs  = cat.subcategories.some(s => s.subcategoryId !== NO_SUBCATEGORY)
                 || cat.subcategories.length > 1;

  const subRows = expanded
    ? `<div class="spending-subrows">${cat.subcategories.map(s => _renderSubRow(s, cat.categoryId)).join('')}</div>`
    : '';

  return `
    <div class="spending-cat ${expanded ? 'is-expanded' : ''}" data-category-id="${_esc(cat.categoryId)}">
      <button type="button" class="spending-cat-row"
              onclick="onSpendingCategoryToggle('${_esc(cat.categoryId)}')"
              ${hasSubs ? '' : 'data-no-expand="1"'}>
        <span class="spending-cat-emoji" aria-hidden="true">${display.emoji}</span>
        <span class="spending-cat-name">${_esc(display.name)}</span>
        <span class="spending-cat-bar" aria-hidden="true">
          <span class="spending-cat-bar-fill" style="width: ${pct.toFixed(1)}%"></span>
        </span>
        <span class="spending-cat-total">${formatCurrency(cat.total)}</span>
        <span class="spending-cat-pct">${pct.toFixed(0)}%</span>
        ${hasSubs ? `<span class="spending-cat-chev" aria-hidden="true">${expanded ? '▾' : '▸'}</span>` : '<span class="spending-cat-chev"></span>'}
      </button>
      ${subRows}
    </div>
  `;
}

function _renderSubRow(sub, categoryId) {
  let name;
  if (sub.subcategoryId === NO_SUBCATEGORY) {
    name = t('spending.noSubcategory');
  } else {
    const disp = subcategoryDisplay(sub.subcategoryId, currentLang);
    name = disp ? disp.name : sub.subcategoryId;
  }
  return `
    <div class="spending-subrow">
      <span class="spending-subrow-name">${_esc(name)}</span>
      <span class="spending-subrow-total">${formatCurrency(sub.total)}</span>
    </div>
  `;
}


// ── Inline-handler bridges (wired on window in app.js) ──────────

export function onSpendingMonthStep(delta) {
  const data = getAppData();
  const months = availableSpendingMonths(data || {});
  if (!months.length) return;
  const idx = months.indexOf(_selectedMonth);
  // months newest-first: +1 delta → newer (lower index).
  const nextIdx = idx - delta;
  if (nextIdx < 0 || nextIdx >= months.length) return;
  _selectedMonth = months[nextIdx];
  // Collapse expansions when changing months so the new month opens clean.
  _expanded.clear();
}

export function onSpendingCategoryToggle(categoryId) {
  if (_expanded.has(categoryId)) _expanded.delete(categoryId);
  else _expanded.add(categoryId);
}


// ── Empty + helpers ──────────────────────────────────────────────

function _renderEmpty() {
  return `
    <section class="section" id="spending">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('spending.title')}</h2>
        </div>
      </div>
      <div class="empty-state">${t('spending.empty')}</div>
    </section>
  `;
}

function _formatMonthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 15);
  return d.toLocaleDateString(currentLang === 'he' ? 'he-IL' : 'en-US', {
    year: 'numeric', month: 'long',
  });
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
