// ─────────────────────────────────────────────────────────────────
//  CARD CHARGES — full-screen drilldown for a single card's monthly
//  charges. Replaces the dashboard content (not a modal) via app.js's
//  view-state machine: when _currentView is set to
//  { type: 'card-charges', cardId }, init() routes through
//  renderCardCharges instead of the dashboard renderers.
//
//  Each row is a tappable surface that opens the edit-charge modal,
//  where the user can override the displayed name, attach a note,
//  mark the charge as a recurring monthly, and assign a
//  category/subcategory from the EXPENSE_CATEGORIES taxonomy.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatChargeDate } from '../dates.js';
import { formatCurrency, getBank, getBankDisplayName, _iconSync } from '../utils.js';
import { categoryDisplay, subcategoryDisplay } from '../data/expense-categories.js';

export function renderCardCharges(data, cardId) {
  const card = (data.cards || []).find(c => c.id === cardId);
  if (!card) return _renderNotFound();

  const displayName = currentLang === 'he' ? card.name : (card.nameEn || card.name);
  const bank        = card.bankId ? getBank(data, card.bankId) : null;
  const bankName    = bank ? getBankDisplayName(bank) : (card.institution || '');

  const charges = (card.charges || []).slice().sort(_sortChargesDescending);
  const total   = charges.reduce((s, c) => s + (c.amount || 0), 0);

  const usageHtml = _renderUsageSummary(card);

  return `
    <section class="section card-charges-page">

      <div class="card-charges-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="navigateToSection('cards')">
          <span class="card-charges-back-arrow" aria-hidden="true">←</span>
          ${t('charges.back')}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openQuickExpenseModal('${cardId}')" title="${t('quickExpense.button')}">
          + ${t('quickExpense.button')}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openExpenseImportPicker()" title="${t('importPicker.button')}">
          ${_iconSync} ${t('importPicker.button')}
        </button>
      </div>

      <header class="card-charges-header">
        <div class="card-charges-identity">
          <div class="card-charges-name">${_esc(displayName)}</div>
          <div class="card-charges-meta">
            ${bankName ? _esc(bankName) + ' · ' : ''}•••• ${card.last4}
          </div>
        </div>
        ${usageHtml}
      </header>

      <div class="card-charges-section">
        <div class="card-charges-section-head">
          <h3 class="card-charges-section-title">${t('charges.thisMonth')}</h3>
          ${charges.length > 0 ? `
            <span class="card-charges-section-total">
              ${charges.length} ${charges.length === 1 ? t('charges.itemOne') : t('charges.itemMany')}
              ·
              ${formatCurrency(total, { cents: true })}
            </span>
          ` : ''}
        </div>

        ${charges.length === 0
          ? `<div class="empty-state">${t('charges.empty')}</div>`
          : `<div class="charges-list">${charges.map(ch => _renderChargeRow(card.id, ch)).join('')}</div>`}
      </div>

    </section>
  `;
}


// ── Internal rendering ──────────────────────────────────────────

function _renderUsageSummary(card) {
  if (card.creditLimit == null || card.creditLimit <= 0) return '';

  const spent = Number(card.currentSpending) || 0;
  const limit = Number(card.creditLimit);
  const pct   = Math.max(0, Math.min(100, (spent / limit) * 100));
  const tone  = _usageTone(pct);

  return `
    <div class="card-charges-usage">
      <div class="card-usage-bar">
        <div class="card-usage-bar-fill card-usage-bar-fill--${tone}" style="width: ${pct.toFixed(2)}%"></div>
      </div>
      <div class="card-usage-meta">
        <span class="card-usage-meta-amount">${formatCurrency(spent)} / ${formatCurrency(limit)}</span>
        <span class="card-usage-meta-pct">${pct.toFixed(1)}%</span>
      </div>
    </div>
  `;
}

// Render a single charge row. The whole row is a button-styled div
// that opens the edit-charge modal — categories, custom names, notes,
// and the recurring flag all flow through there.
function _renderChargeRow(cardId, charge) {
  const primary      = _primaryLineFor(charge);
  const meta         = _metaLineFor(charge, primary);
  const category     = charge.categoryId ? categoryDisplay(charge.categoryId, currentLang) : null;
  const subcategory  = charge.subcategoryId ? subcategoryDisplay(charge.subcategoryId, currentLang) : null;
  const tag          = _renderCategoryTag(category, subcategory);
  const badges       = _renderBadges(charge);
  const dataId       = _esc(charge.id || '');
  const dataCard     = _esc(cardId || '');

  return `
    <button class="charge-row" type="button"
            data-charge-id="${dataId}"
            data-card-id="${dataCard}"
            onclick="openEditChargeModal('${dataCard}', '${dataId}')">
      <div class="charge-row-info">
        <div class="charge-row-name-line">
          <span class="charge-row-name">${primary}</span>
          ${badges}
        </div>
        ${meta || tag ? `
          <div class="charge-row-meta">
            ${tag}
            ${meta ? `<span class="charge-row-meta-text">${meta}</span>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="charge-row-amount">${formatCurrency(charge.amount, { cents: true })}</div>
    </button>
  `;
}

// Primary line: the user's custom name when set, otherwise the
// imported merchant. Falls through to a generic label only when
// neither is present.
function _primaryLineFor(charge) {
  if (charge.displayName)  return _esc(charge.displayName);
  if (charge.merchant)     return _esc(charge.merchant);
  if (charge.description)  return _esc(charge.description);
  return t('charges.unknownCharge');
}

// Meta line: date + (original merchant when overridden) + optional
// hand-written description. We avoid repeating whatever appears as
// the primary line.
function _metaLineFor(charge, primary) {
  const parts = [];
  if (charge.date) parts.push(formatChargeDate(charge.date));
  if (charge.time) parts.push(_esc(charge.time));

  // When the user has overridden the name, surface the original in
  // parentheses so the link back to the statement stays visible.
  if (charge.displayName && charge.merchant && charge.merchant !== charge.displayName) {
    parts.push(`(${_esc(charge.merchant)})`);
  }

  if (charge.description && primary !== _esc(charge.description)) {
    parts.push(_esc(charge.description));
  }
  return parts.join(' · ');
}

// Inline category chip: emoji + subcategory (or category) name. Sits
// on the meta line so it doesn't crowd the primary text. Renders
// nothing when no category is set.
function _renderCategoryTag(category, subcategory) {
  if (!category) return '';
  const text = subcategory ? subcategory.name : category.name;
  return `
    <span class="charge-row-category">
      <span class="charge-row-category-emoji" aria-hidden="true">${category.emoji}</span>
      <span class="charge-row-category-text">${_esc(text)}</span>
    </span>
  `;
}

// Small icons next to the name: manual-source + recurring monthly +
// has-note. Quiet presence so they don't compete with the merchant
// text. Tooltips give the long form on hover.
function _renderBadges(charge) {
  const parts = [];
  if (charge.source === 'manual') {
    parts.push(`<span class="charge-row-badge charge-row-badge--manual" title="${t('charges.manualBadge')}" aria-label="${t('charges.manualBadge')}">✏️</span>`);
  }
  if (charge.isRecurringMonthly) {
    parts.push(`<span class="charge-row-badge charge-row-badge--recurring" title="${t('editCharge.recurring')}" aria-label="${t('editCharge.recurring')}">🔁</span>`);
  }
  if (charge.notes) {
    parts.push(`<span class="charge-row-badge charge-row-badge--note" title="${_esc(charge.notes)}" aria-label="${t('editCharge.notes')}">✎</span>`);
  }
  return parts.join('');
}

function _renderNotFound() {
  return `
    <section class="section card-charges-page">
      <div class="card-charges-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="navigateToSection('cards')">
          <span class="card-charges-back-arrow" aria-hidden="true">←</span>
          ${t('charges.back')}
        </button>
      </div>
      <div class="empty-state">${t('charges.cardNotFound')}</div>
    </section>
  `;
}


// ── Helpers ─────────────────────────────────────────────────────

// Date desc, charges without a date sink to the bottom.
function _sortChargesDescending(a, b) {
  if (a.date && b.date) return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  if (a.date && !b.date) return -1;
  if (!a.date && b.date) return 1;
  return 0;
}

function _usageTone(pct) {
  if (pct >= 85) return 'high';
  if (pct >= 60) return 'mid';
  return 'low';
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
