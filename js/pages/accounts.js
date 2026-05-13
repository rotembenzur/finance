import { t, TRANSLATIONS } from '../i18n.js';
import { todayISO } from '../store.js';
import { formatReportDate } from '../dates.js';
import {
  calcAvailableTotal, getCashEntries, getBankAccountEntries, getBanks,
  entryValue, entryValueILS, accountCardClass, typeBadgeClass, typeLabel,
  getBankDisplayName, formatCurrency,
  _iconCash, _iconEdit, _iconLock,
} from '../utils.js';
import { formatForeignAmount } from '../fx.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';
import { updateEntry } from '../app.js';

export function renderAccounts(data) {
  const total          = calcAvailableTotal(data);
  const cashEntries    = getCashEntries(data);
  const bankEntries    = getBankAccountEntries(data);
  const banks          = getBanks(data);
  const bankAcctCount  = bankEntries.length;

  const cashHtml = cashEntries.map(e => _renderCashCard(e, data)).join('');
  const addCashHtml = `
    <button class="cash-add-btn" type="button" onclick="openEditCashModal()">
      <span class="cash-add-btn-plus" aria-hidden="true">+</span>
      <span class="cash-add-btn-label">${t('cash.add')}</span>
    </button>
  `;

  // Group bank/wallet entries by bankId; collect ungrouped separately
  const grouped = banks.map(bank => ({
    bank,
    entries: bankEntries.filter(e => e.bankId === bank.id),
  })).filter(g => g.entries.length > 0);

  const ungrouped = bankEntries.filter(e => !e.bankId || !banks.find(b => b.id === e.bankId));

  const groupsHtml = grouped.map(({ bank, entries }) => {
    const bankTotal   = entries.reduce((sum, e) => sum + entryValue(e), 0);
    const iconClass   = `bank-icon--${bank.id}${bank.logo ? ' bank-icon--has-logo' : ''}`;
    const displayName = getBankDisplayName(bank);
    const iconBody    = bank.logo
      ? `<img class="bank-icon-img" src="${bank.logo}" alt="" />`
      : (displayName || '').charAt(0).toUpperCase();
    const primaryBadge = bank.isPrimary
      ? `<span class="badge badge--blue">${t('accounts.primary')}</span>`
      : '';

    // Split operational accounts (checking, regular savings) from
    // locked term-deposit-style products. Locked products visit a
    // bank but they aren't bank accounts you operate from day to
    // day — they're maturing-soon balances. Mixing them inside the
    // same equal-cell grid stretched the small checking card to
    // match the taller savings card; rendering them as a slim row
    // list beneath the grid keeps each visual lane honest.
    const operational = entries.filter(e => !e.isLocked);
    const locked      = entries.filter(e =>  e.isLocked);

    const cardsHtml = operational.length > 0
      ? `<div class="bank-accounts-grid">${operational.map(_renderAccountCard).join('')}</div>`
      : '';

    const lockedHtml = locked.length > 0
      ? `<div class="bank-locked-list">${locked.map(_renderLockedRow).join('')}</div>`
      : '';

    return `
      <div class="bank-group">
        <div class="bank-group-header">
          <div class="bank-icon ${iconClass}">${iconBody}</div>
          <div class="bank-group-info">
            <div class="bank-group-name">${displayName} ${primaryBadge}</div>
            <div class="bank-group-branch">${t('accounts.branch')} ${bank.branch} · ${bank.location}</div>
          </div>
          <div class="bank-group-total">${formatCurrency(bankTotal)}</div>
        </div>
        ${cardsHtml}
        ${lockedHtml}
      </div>
    `;
  }).join('');

  const ungroupedHtml = ungrouped.length > 0 ? `
    <div class="bank-group">
      <div class="bank-accounts-grid">
        ${ungrouped.map(_renderAccountCard).join('')}
      </div>
    </div>
  ` : '';

  const accountWord = bankAcctCount === 1 ? t('accounts.account') : t('accounts.accounts');

  return `
    <section class="section" id="accounts">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('accounts.title')}</h2>
        </div>
      </div>

      ${cashHtml}
      ${addCashHtml}
      ${groupsHtml}
      ${ungroupedHtml}

      <div class="accounts-total-footer">
        <span class="accounts-footer-label">${t('accounts.total')}</span>
        <span class="accounts-footer-value">${formatCurrency(total)}</span>
        <span class="accounts-footer-count">${bankAcctCount} ${accountWord}</span>
      </div>

    </section>
  `;
}

// ── Bank account card ───────────────────────────────────────────

function _renderAccountCard(entry) {
  const value         = entryValue(entry);
  const cardMod       = accountCardClass(entry);
  const badgeMod      = typeBadgeClass(entry.type);
  const typeLabelText = typeLabel(entry.type);

  // Skip the name line when it would just repeat the type word that
  // the badge already shows (e.g. checking account named "עו״ש").
  // We compare against both languages' type labels so the dedup works
  // regardless of which language is currently active.
  const heLabel  = (TRANSLATIONS.he && TRANSLATIONS.he['type.' + entry.type] || '').trim();
  const enLabel  = (TRANSLATIONS.en && TRANSLATIONS.en['type.' + entry.type] || '').trim();
  const name     = (entry.name || '').trim();
  const showName = name && name !== heLabel && name !== enLabel;

  // Locked savings (e.g. the discharge deposit) get the two-tier
  // meta-stack: a reassuring headline plus an unlock date. Regular
  // checking/savings without a maturityDate render nothing here —
  // the badge + updated-at already say everything.
  const meta = buildEntryMeta(entry, null);
  const metaHtml = meta ? `<div class="account-card-meta">${renderMetaStack(meta)}</div>` : '';

  return `
    <div class="account-card card ${cardMod}">
      <div class="account-card-header">
        <span class="badge ${badgeMod}">${typeLabelText}</span>
        <div class="account-card-header-right">
          ${entry.type === 'checking' ? `<button class="icon-btn" onclick="editAmount('${entry.id}')" title="${t('action.edit')}">${_iconEdit}</button>` : ''}
          <span class="account-date">${t('accounts.updated')} ${formatReportDate(entry.updatedAt)}</span>
        </div>
      </div>
      ${showName ? `<div class="account-name">${name}</div>` : ''}
      <div class="account-balance">${formatCurrency(value)}</div>
      ${metaHtml}
    </div>
  `;
}

// ── Locked-savings slim row ──────────────────────────────────────
//
// Renders a single locked term-deposit-style entry beneath its bank
// group. We reuse the `.holding-row` skeleton so this row visually
// rhymes with the Future Wealth / Future Deposits lists — same
// "mark + info + value" rhythm, no extra component to maintain.
// The meta-stack already knows how to describe a locked savings
// (headline + "unlocks <date> · in N days"), so we route through it.
function _renderLockedRow(entry) {
  const value    = entryValue(entry);
  const meta     = buildEntryMeta(entry, null);
  const metaHtml = meta ? renderMetaStack(meta) : '';

  return `
    <div class="holding-row bank-locked-row" data-entry-id="${entry.id}">
      <div class="holding-row-mark">
        <span class="bank-locked-mark" aria-hidden="true">${_iconLock}</span>
      </div>
      <div class="holding-row-info">
        <div class="holding-row-name-line">
          <span class="holding-row-name" title="${_esc(entry.name || '')}">${_esc(entry.name || '')}</span>
        </div>
        <div class="holding-row-meta">${metaHtml}</div>
      </div>
      <div class="holding-row-value">${formatCurrency(value)}</div>
    </div>
  `;
}

// ── Cash card ────────────────────────────────────────────────────
//
// ILS cash keeps its inline-edit shortcut (click amount → input) so
// the most common case stays one tap. Foreign-currency cash routes
// every interaction through the edit-cash modal, which is where the
// currency picker + live ILS preview live.
function _renderCashCard(entry, data) {
  const native = entryValue(entry);
  const code   = entry.currency || 'ILS';
  const isILS  = code === 'ILS';
  const displayName = entry.name || (isILS ? t('cash.title') : `${code} ${t('cash.title')}`);

  return isILS
    ? _renderILSCashCard(entry, displayName, native)
    : _renderForeignCashCard(entry, data, displayName, native, code);
}

function _renderILSCashCard(entry, displayName, value) {
  return `
    <div class="cash-card card" data-cash-id="${entry.id}">
      <div class="cash-card-left">
        <span class="cash-card-icon">${_iconCash}</span>
        <div class="cash-card-text">
          <div class="cash-card-label">${_esc(displayName)}</div>
          <div class="cash-card-meta">${t('cash.subtitle')}</div>
        </div>
      </div>
      <div class="cash-card-right">
        <div class="cash-card-value-wrap">
          <span class="cash-card-amount" id="cash-display-${entry.id}"
                onclick="enterCashEdit('${entry.id}')"
                title="${t('cash.editHint')}">${formatCurrency(value)}</span>
          <input
            class="cash-card-input"
            id="cash-input-${entry.id}"
            type="number" step="1" min="0"
            value="${value}"
            onkeydown="if (event.key==='Enter') { event.preventDefault(); this.blur(); } else if (event.key==='Escape') { exitCashEdit('${entry.id}'); }"
            onblur="saveCashEdit('${entry.id}')"
            style="display:none"
          />
        </div>
        <button class="icon-btn cash-card-edit-btn" onclick="openEditCashModal('${entry.id}')" title="${t('action.edit')}">${_iconEdit}</button>
      </div>
      <div class="cash-card-footer">
        <button class="btn btn-ghost btn-sm cash-card-history-btn"
                onclick="navigateToCashHistory('${entry.id}')">
          ${t('cash.viewHistory')}
          <span class="cash-card-history-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  `;
}

function _renderForeignCashCard(entry, data, displayName, native, code) {
  const ils    = entryValueILS(entry, data);
  const ilsTxt = ils != null ? `≈ ${formatCurrency(ils)}` : t('cash.noRate');

  return `
    <div class="cash-card card cash-card--foreign" data-cash-id="${entry.id}"
         onclick="openEditCashModal('${entry.id}')" role="button" tabindex="0">
      <div class="cash-card-left">
        <span class="cash-card-icon">${_iconCash}</span>
        <div class="cash-card-text">
          <div class="cash-card-label">${_esc(displayName)}</div>
          <div class="cash-card-meta">${t('cash.foreignSubtitle').replace('{code}', code)}</div>
        </div>
      </div>
      <div class="cash-card-right cash-card-right--stacked">
        <span class="cash-card-amount cash-card-amount--native">${_esc(formatForeignAmount(native, code))}</span>
        <span class="cash-card-equivalent">${_esc(ilsTxt)}</span>
      </div>
    </div>
  `;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

// ── Cash inline-edit handlers (called from inline onclick/onkeydown) ──

let _cashEditCancelling = false;

export function enterCashEdit(id) {
  const display = document.getElementById(`cash-display-${id}`);
  const input   = document.getElementById(`cash-input-${id}`);
  if (!display || !input) return;
  display.style.display = 'none';
  input.style.display   = '';
  input.focus();
  input.select();
}

export function saveCashEdit(id) {
  if (_cashEditCancelling) {
    _cashEditCancelling = false;
    return;
  }
  const input = document.getElementById(`cash-input-${id}`);
  if (!input) return;
  const value = parseFloat(input.value);
  if (isNaN(value) || value < 0) return;

  // updateEntry triggers init() → re-render replaces the input element
  updateEntry(id, { balance: value, updatedAt: todayISO() });
}

export function exitCashEdit(id) {
  _cashEditCancelling = true;
  const display = document.getElementById(`cash-display-${id}`);
  const input   = document.getElementById(`cash-input-${id}`);
  if (!display || !input) return;
  input.blur();             // triggers onblur → saveCashEdit (no-op due to flag)
  display.style.display = '';
  input.style.display   = 'none';
}
