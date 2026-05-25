import { t, TRANSLATIONS } from '../i18n.js';
import { todayISO } from '../store.js';
import { formatReportDate } from '../dates.js';
import {
  calcAvailableTotal, calcCardsOutstanding, getCashEntries,
  getBankAccountEntries, getBanks,
  entryValue, entryValueILS, accountCardClass, typeBadgeClass, typeLabel,
  getBankDisplayName, formatCurrency, calcCardChargesForBank, calcCardPendingCharges,
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
      ? `<div class="bank-accounts-grid">${operational.map(e => _renderAccountCard(e, data)).join('')}</div>`
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
        ${ungrouped.map(e => _renderAccountCard(e, data)).join('')}
      </div>
    </div>
  ` : '';

  return `
    <section class="section" id="accounts">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('accounts.title')}</h2>
        </div>
      </div>

      ${heroHtml}

      ${cashHtml}
      ${addCashHtml}
      ${groupsHtml}
      ${ungroupedHtml}

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

// ── TEMP DEBUG — "remaining after upcoming credit charges" trace ──
//
// Logs the full per-card breakdown behind one checking account's
// projection so the per-account number and the Cards-page grand total
// can be reconciled line by line. Remove once the bank-account
// summary calculation is confirmed.
//
//   • raw balance
//   • every active credit card, INCLUDED (bankId matches this account)
//     or EXCLUDED (+ reason: other bank / no bankId / debit / inactive)
//   • each card's windowed pending vs its all-time charge sum (reveals
//     a card with no billing window falling back to an all-time total)
//   • included total (this account) + excluded-but-pending total
//   • grand pending total (what the Cards page shows)
//   • projected remaining = balance − included
function _debugCardProjection(entry, balance, includedTotal, data) {
  const rows = (data.cards || []).map(c => {
    const active = !!c.isActive;
    const debit  = !!c.isDebit;
    const match  = c.bankId === entry.bankId;
    let status;
    if (!active)        status = 'EXCLUDED · inactive';
    else if (debit)     status = 'EXCLUDED · debit (no billing)';
    else if (match)     status = 'INCLUDED';
    else if (!c.bankId) status = 'EXCLUDED · no bankId (unlinked!)';
    else                status = `EXCLUDED · other bank (${c.bankId})`;

    const list = Array.isArray(c.charges) ? c.charges : [];
    const allTimeSum = list.reduce((s, ch) => {
      const a = Number(ch.amount) || 0;
      return s + (ch.direction === 'in' ? -a : a);
    }, 0);
    return {
      last4: c.last4 || '(?)',
      bankId: c.bankId ?? '(none)',
      status,
      charges: list.length,
      billingDay: c.billingDay ?? '',
      nextBilling: c.nextBilling ?? '',
      allTimeSum: Math.round(allTimeSum),
      pending: Math.round((active && !debit) ? calcCardPendingCharges(c) : 0),
    };
  });

  const excludedPending = rows
    .filter(r => r.status.startsWith('EXCLUDED') && r.pending !== 0)
    .reduce((s, r) => s + r.pending, 0);
  const grandTotal = calcCardsOutstanding(data);

  console.group(`[card-projection] ${entry.name || entry.id} (bankId=${entry.bankId})`);
  console.log('raw balance:', Math.round(balance));
  console.table(rows);
  console.log('INCLUDED total (this account):', Math.round(includedTotal));
  console.log('EXCLUDED-but-pending total:', Math.round(excludedPending),
              '— reduces a different account, or NO account if unlinked');
  console.log('grand pending total (Cards page):', Math.round(grandTotal),
              '=', Math.round(includedTotal), '+', Math.round(excludedPending),
              Math.round(includedTotal + excludedPending) === Math.round(grandTotal) ? '✓ reconciles' : '✗ MISMATCH');
  console.log('projected remaining = balance − included =',
              Math.round(balance), '−', Math.round(includedTotal), '=', Math.round(balance - includedTotal));
  console.groupEnd();
}

// ── Bank account card ───────────────────────────────────────────

function _renderAccountCard(entry, data) {
  const value         = entryValue(entry);
  const cardMod       = accountCardClass(entry);
  const badgeMod      = typeBadgeClass(entry.type);
  const typeLabelText = typeLabel(entry.type);

  // Projected-after-pending-credit-card-charges line for checking
  // accounts. Sums each linked card's current-cycle pending total
  // (calcCardPendingCharges, which already filters to the open
  // billing window) and shows what the balance will read as once
  // the upcoming credit-card debits settle. Hidden when there are
  // no pending charges linked to this bank — no point displaying
  // the same number twice. Savings accounts skip this entirely;
  // credit cards don't debit them.
  let projectedHtml = '';
  if (entry.type === 'checking' && entry.bankId && data) {
    const pendingCharges = calcCardChargesForBank(data, entry.bankId);
    _debugCardProjection(entry, value, pendingCharges, data);   // TEMP — remove after diagnosis
    if (pendingCharges > 0 && Number.isFinite(value)) {
      const projected = value - pendingCharges;
      projectedHtml = `
        <div class="account-balance-projection">
          <span class="account-balance-projection-label">${t('accounts.afterPendingCards')}</span>
          <span class="account-balance-projection-value">${formatCurrency(projected)}</span>
        </div>
      `;
    }
  }

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
      ${projectedHtml}
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
