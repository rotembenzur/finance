import { t, TRANSLATIONS } from '../i18n.js';
import { todayISO } from '../store.js';
import { formatReportDate } from '../dates.js';
import {
  calcAvailableTotal, calcCardsOutstanding, getCashEntries,
  getBankAccountEntries, getBanks, getWalletEntries,
  entryValue, entryValueILS, accountCardClass, typeBadgeClass, typeLabel,
  getBankDisplayName, formatCurrency, calcCardChargesForBank, getUnlinkedPendingCards,
  _iconCash, _iconEdit, _iconLock,
} from '../utils.js';
import { formatForeignAmount } from '../fx.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';
import { updateEntry } from '../app.js';

export function renderAccounts(data) {
  const grossAvailable = calcAvailableTotal(data);
  const pendingCards   = calcCardsOutstanding(data);
  const total          = grossAvailable - pendingCards;  // net of pending card charges
  const cashEntries    = getCashEntries(data);
  const bankEntries    = getBankAccountEntries(data);
  const banks          = getBanks(data);
  const bankAcctCount  = bankEntries.length;
  // Hero — the page's headline number sits at the TOP now, not the
  // bottom. Counts the distinct bank institutions the user has
  // accounts at so the meta reads accurately even when one bank
  // hosts multiple accounts.
  const bankInstCount = banks.filter(b => bankEntries.some(e => e.bankId === b.id)).length;
  const heroHtml      = _renderAvailableHero(total, grossAvailable, pendingCards, bankEntries.length, bankInstCount, cashEntries.length);

  const cashHtml = cashEntries.map(e => _renderCashCard(e, data)).join('');
  // Standardized "+ Add cash" affordance — uses the same .btn-ghost
  // pattern as every other "+" action across the app (Quick income,
  // Quick expense, Import statement). Was its own bespoke
  // .cash-add-btn pill before; now visually consistent.
  const addCashHtml = `
    <div class="accounts-add-cash">
      <button class="btn btn-ghost btn-sm" type="button" onclick="openEditCashModal()">
        + ${t('cash.add')}
      </button>
    </div>
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

    // One cohesive panel per bank: a header (icon · name/branch ·
    // total) over a hairline-separated list of account rows. Operational
    // accounts (checking, regular savings) come first; locked
    // term-deposit-style products — "maturing soon" balances you don't
    // operate day to day — follow, marked with a lock so the visual
    // distinction survives without splitting the list into two lanes.
    // Keeping everything in one aligned row list puts each balance on a
    // shared rail directly beneath the bank total, so the account name
    // and its balance read as a single unit at a glance.
    const operational = entries.filter(e => !e.isLocked);
    const locked      = entries.filter(e =>  e.isLocked);

    const rowsHtml = [
      ...operational.map(e => _renderAccountRow(e, data)),
      ...locked.map(_renderLockedRow),
    ].join('');

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
        <div class="bank-account-list">${rowsHtml}</div>
      </div>
    `;
  }).join('');

  const ungroupedHtml = ungrouped.length > 0 ? `
    <div class="bank-group">
      <div class="bank-account-list">
        ${ungrouped.map(e => _renderAccountRow(e, data)).join('')}
      </div>
    </div>
  ` : '';

  // Digital wallets (Bit, Paybox) — sit below accounts / deposits /
  // cash because the balances are usually small and the section is
  // mostly a manual top-up surface, not the daily-driver list.
  const walletEntries = getWalletEntries(data);
  const walletsHtml   = walletEntries.length > 0 ? _renderWalletsSection(walletEntries) : '';

  return `
    <section class="section" id="accounts">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('accounts.title')}</h2>
        </div>
      </div>

      ${heroHtml}

      ${_renderUnlinkedNotice(data)}

      ${cashHtml}
      ${addCashHtml}
      ${groupsHtml}
      ${ungroupedHtml}
      ${walletsHtml}

    </section>
  `;
}

// ── Hero — Available total at the top of the page ───────────────
//
// The page's primary number lives here, not in a footer. One big
// figure + a quiet meta line listing the composition (N accounts ·
// M banks · K cash entries). Falls back gracefully when one of the
// constituents is empty — no point printing "0 cash entries" when
// the user just doesn't track cash.

function _renderAvailableHero(total, grossAvailable, pendingCards, bankCount, bankInstCount, cashCount) {
  const parts = [];
  if (bankCount > 0) {
    const key = bankCount === 1 ? 'accounts.heroMeta.account' : 'accounts.heroMeta.accounts';
    parts.push(t(key).replace('{count}', String(bankCount)));
  }
  if (bankInstCount > 0) {
    const key = bankInstCount === 1 ? 'accounts.heroMeta.bank' : 'accounts.heroMeta.banks';
    parts.push(t(key).replace('{count}', String(bankInstCount)));
  }
  if (cashCount > 0) {
    const key = cashCount === 1 ? 'accounts.heroMeta.cashOne' : 'accounts.heroMeta.cashMany';
    parts.push(t(key).replace('{count}', String(cashCount)));
  }
  const metaText = parts.join(' · ');

  // Breakdown — only when there's actually pending card spending to
  // explain why the headline is lower than the raw liquid balance.
  const breakdown = pendingCards > 0
    ? t('accounts.heroBreakdown')
        .replace('{gross}', formatCurrency(grossAvailable))
        .replace('{pending}', formatCurrency(pendingCards))
    : '';

  return `
    <div class="accounts-hero">
      <span class="accounts-hero-label">${t('accounts.heroLabel')}</span>
      <span class="accounts-hero-value">${formatCurrency(total)}</span>
      ${breakdown ? `<span class="accounts-hero-breakdown">${breakdown}</span>` : ''}
      ${metaText ? `<span class="accounts-hero-meta">${metaText}</span>` : ''}
    </div>
  `;
}

// ── Unlinked-pending safeguard ──────────────────────────────────
//
// A credit card with no bank link (or a bank with no checking account)
// has pending charges that appear in the Cards-page total but reduce
// NO account's "remaining after" projection — money silently leaving
// the picture. Surface it here so it's caught and the link fixed.
function _renderUnlinkedNotice(data) {
  const unlinked = getUnlinkedPendingCards(data);
  if (unlinked.length === 0) return '';

  const total = unlinked.reduce((s, x) => s + x.pending, 0);
  const cardRows = unlinked.map(({ card, pending }) => {
    const nick  = card.nickname || card.name || '';
    const last4 = card.last4 ? `····${card.last4}` : '';
    const label = _esc([nick, last4].filter(Boolean).join(' '));
    return `
      <div class="accounts-unlinked-card">
        <span class="accounts-unlinked-card-name">${label} · ${formatCurrency(pending)}</span>
        <button type="button" class="btn btn-ghost btn-sm"
                onclick="openEditCardLinkModal('${_esc(card.id)}')">${t('cardLink.linkAction')}</button>
      </div>
    `;
  }).join('');

  return `
    <div class="accounts-unlinked-notice" role="status">
      <span class="accounts-unlinked-notice-icon" aria-hidden="true">⚠</span>
      <div class="accounts-unlinked-notice-text">
        <span class="accounts-unlinked-notice-headline">${
          t('accounts.unlinkedPending').replace('{amount}', formatCurrency(total))
        }</span>
        <div class="accounts-unlinked-cards">${cardRows}</div>
      </div>
    </div>
  `;
}

// ── Bank account row ────────────────────────────────────────────
//
// A dense, full-width row inside the bank panel:
//
//   [badge] account name ················· ₪balance  [✎]
//           updated <date> · after pending cards ₪X
//
// The name and balance share one baseline (right-aligned balance on a
// rail with every other row in the panel), with secondary facts — the
// last-updated date and, for checking accounts, the projected balance
// after pending card charges — tucked on a quiet sub-line directly
// beneath. This replaces the previous boxed card floating in a wide
// auto-fill grid, which left half the row empty for single-account
// banks and pushed the balance far from its name.
function _renderAccountRow(entry, data) {
  const value         = entryValue(entry);
  const cardMod       = accountCardClass(entry);
  const badgeMod      = typeBadgeClass(entry.type);
  const typeLabelText = typeLabel(entry.type);

  // Projected-after-pending-credit-card-charges fragment for checking
  // accounts. Sums each linked card's current-cycle pending total
  // (calcCardChargesForBank, already filtered to the open billing
  // window) and shows what the balance will read as once the upcoming
  // debits settle. Hidden when nothing's pending against this bank.
  let projHtml = '';
  if (entry.type === 'checking' && entry.bankId && data) {
    const pendingCharges = calcCardChargesForBank(data, entry.bankId);
    if (pendingCharges > 0 && Number.isFinite(value)) {
      const projected = value - pendingCharges;
      projHtml = `
        <span class="acct-row-proj">
          ${t('accounts.afterPendingCards')}
          <span class="acct-row-proj-value">${formatCurrency(projected)}</span>
        </span>
      `;
    }
  }

  // Skip the name when it would just repeat the type word the badge
  // already shows (e.g. a checking account literally named "עו״ש").
  // Compared against both languages so the dedup holds regardless of
  // the active language.
  const heLabel  = (TRANSLATIONS.he && TRANSLATIONS.he['type.' + entry.type] || '').trim();
  const enLabel  = (TRANSLATIONS.en && TRANSLATIONS.en['type.' + entry.type] || '').trim();
  const name     = (entry.name || '').trim();
  const showName = name && name !== heLabel && name !== enLabel;
  const nameHtml = showName ? `<span class="acct-row-name">${_esc(name)}</span>` : '';

  const editHtml = entry.type === 'checking'
    ? `<button class="icon-btn acct-row-edit" onclick="editAmount('${entry.id}')" title="${t('action.edit')}">${_iconEdit}</button>`
    : '';

  const dateHtml = `<span class="acct-row-date">${t('accounts.updated')} ${formatReportDate(entry.updatedAt)}</span>`;

  return `
    <div class="acct-row ${cardMod}" data-entry-id="${entry.id}">
      <span class="badge acct-row-badge ${badgeMod}">${typeLabelText}</span>
      <div class="acct-row-body">
        <div class="acct-row-top">
          ${nameHtml}
          <span class="acct-row-balance">${formatCurrency(value)}</span>
        </div>
        <div class="acct-row-sub">${dateHtml}${projHtml}</div>
      </div>
      ${editHtml}
    </div>
  `;
}

// ── Locked-savings row ───────────────────────────────────────────
//
// Same row grammar as an operational account, but marked with a lock
// and carrying the shared meta-stack on its sub-line — a reassuring
// headline plus "unlocks <date> · in N days" — so "what becomes
// available soon" stays legible right next to its balance.
function _renderLockedRow(entry) {
  const value    = entryValue(entry);
  const meta     = buildEntryMeta(entry, null);
  const metaHtml = meta ? renderMetaStack(meta) : '';

  return `
    <div class="acct-row acct-row--locked" data-entry-id="${entry.id}">
      <span class="acct-row-lock" aria-hidden="true">${_iconLock}</span>
      <div class="acct-row-body">
        <div class="acct-row-top">
          <span class="acct-row-name" title="${_esc(entry.name || '')}">${_esc(entry.name || '')}</span>
          <span class="acct-row-balance">${formatCurrency(value)}</span>
        </div>
        ${metaHtml ? `<div class="acct-row-sub acct-row-sub--meta">${metaHtml}</div>` : ''}
      </div>
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

// ── Digital wallets section (Bit, Paybox) ───────────────────────
//
// Compact list — small logo, name, inline-editable ILS balance.
// Sits below the main account/deposit/cash list because the balances
// are typically zero or near-zero and the section is mostly a manual
// top-up surface. Reuses the same edit pattern as the cash card so
// the gesture (tap amount → number input → Enter to save) is the
// same across both surfaces.
function _renderWalletsSection(entries) {
  const rowsHtml = entries.map(_renderWalletRow).join('');
  return `
    <div class="wallets-section">
      <div class="wallets-header">
        <span class="wallets-title">${t('wallets.title')}</span>
        <span class="wallets-subtitle">${t('wallets.subtitle')}</span>
      </div>
      <div class="wallets-list">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function _renderWalletRow(entry) {
  const value = entryValue(entry) || 0;
  const logo  = entry.logo
    ? `<img class="wallet-row-logo" src="${entry.logo}" alt="${_esc(entry.name || '')}" />`
    : `<span class="wallet-row-logo wallet-row-logo--placeholder">${_esc((entry.name || '?').charAt(0))}</span>`;

  // Two distinct tap targets per row:
  //   · left (logo + name)  → drill into the wallet's history page
  //                            (same surface cash uses — categories,
  //                            monthly totals, edit/delete charges)
  //   · right (amount)      → inline-edit the balance directly
  // Keeping them separate so a quick balance correction never costs
  // a navigation, and a history drill-in never costs a stray edit.
  return `
    <div class="wallet-row" data-wallet-id="${entry.id}">
      <button type="button" class="wallet-row-left"
              onclick="navigateToCashHistory('${entry.id}')"
              title="${t('cash.viewHistory')}">
        ${logo}
        <span class="wallet-row-name">${_esc(entry.name || '')}</span>
        <span class="wallet-row-chevron" aria-hidden="true">→</span>
      </button>
      <div class="wallet-row-right">
        <span class="wallet-row-amount" id="wallet-display-${entry.id}"
              onclick="enterWalletEdit('${entry.id}')"
              title="${t('cash.editHint')}">${formatCurrency(value)}</span>
        <input
          class="wallet-row-input"
          id="wallet-input-${entry.id}"
          type="number" step="1" min="0"
          value="${value}"
          onkeydown="if (event.key==='Enter') { event.preventDefault(); this.blur(); } else if (event.key==='Escape') { exitWalletEdit('${entry.id}'); }"
          onblur="saveWalletEdit('${entry.id}')"
          style="display:none"
        />
      </div>
    </div>
  `;
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

// ── Wallet inline-edit handlers (Bit, Paybox) ────────────────────
//
// Same shape as the cash editors above; kept separate because the DOM
// ids use a `wallet-` prefix so the two surfaces can render on the
// same page without colliding.

let _walletEditCancelling = false;

export function enterWalletEdit(id) {
  const display = document.getElementById(`wallet-display-${id}`);
  const input   = document.getElementById(`wallet-input-${id}`);
  if (!display || !input) return;
  display.style.display = 'none';
  input.style.display   = '';
  input.focus();
  input.select();
}

export function saveWalletEdit(id) {
  if (_walletEditCancelling) {
    _walletEditCancelling = false;
    return;
  }
  const input = document.getElementById(`wallet-input-${id}`);
  if (!input) return;
  const value = parseFloat(input.value);
  if (isNaN(value) || value < 0) return;
  updateEntry(id, { balance: value, updatedAt: todayISO() });
}

export function exitWalletEdit(id) {
  _walletEditCancelling = true;
  const display = document.getElementById(`wallet-display-${id}`);
  const input   = document.getElementById(`wallet-input-${id}`);
  if (!display || !input) return;
  input.blur();
  display.style.display = '';
  input.style.display   = 'none';
}
