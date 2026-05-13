// ─────────────────────────────────────────────────────────────────
//  FUTURE DEPOSITS — locked money with a known release date
//
//  Different mental category from Future Wealth: this isn't
//  retirement compounding, it's "money already mine, will land in
//  my account on a specific date". The row meta leads with how
//  far through the lock window we are, not provider/track/return.
//
//  Currently: military discharge deposit. Future could include
//  any other time-locked principal-only deposit.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import {
  getFutureDepositsEntries, getProvider, getBank,
  entryValue, formatCurrency, calcDaysUntil,
} from '../utils.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';

export function renderFutureDeposits(data) {
  const entries = getFutureDepositsEntries(data)
    .slice()
    .sort((a, b) => {
      // Soonest unlock first; entries without a date go last
      const aDays = a.maturityDate ? calcDaysUntil(a.maturityDate) : Infinity;
      const bDays = b.maturityDate ? calcDaysUntil(b.maturityDate) : Infinity;
      return aDays - bDays;
    });

  if (entries.length === 0) {
    return `
      <section class="section" id="future-deposits">
        <div class="section-header">
          <div class="section-header-text">
            <h2 class="section-title">${t('futureDeposits.title')}</h2>
          </div>
        </div>
        <div class="empty-state">${t('futureDeposits.empty')}</div>
      </section>
    `;
  }

  return `
    <section class="section" id="future-deposits">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('futureDeposits.title')}</h2>
          <p class="section-intro">${t('futureDeposits.intro')}</p>
        </div>
      </div>

      <div class="holding-row-list">
        ${entries.map(e => _renderDepositRow(data, e)).join('')}
      </div>

    </section>
  `;
}

function _renderDepositRow(data, entry) {
  const value    = entryValue(entry);
  const meta     = buildEntryMeta(entry, data);
  const metaHtml = renderMetaStack(meta);

  // Mark resolution mirrors the Future Wealth + Invested pages:
  //   1. Provider logo (military → IDF, etc.)
  //   2. Bank logo     (any bank-held future deposit)
  //   3. Empty
  const provider = getProvider(data, entry.providerId);
  const bank     = entry.bankId ? getBank(data, entry.bankId) : null;
  const logo     = (provider && provider.logo) || (bank && bank.logo) || null;
  const mark     = logo
    ? `<div class="provider-mark"><img class="provider-mark-img" src="${logo}" alt="" /></div>`
    : '';

  // Translated names live on the entry as `nameEn`; `name` always
  // carries the Hebrew. Fall back across the divide if either is
  // missing for a given entry.
  const displayName = currentLang === 'he'
    ? (entry.name   || entry.nameEn || '')
    : (entry.nameEn || entry.name   || '');

  return `
    <div class="holding-row" data-entry-id="${entry.id}">
      <div class="holding-row-mark">${mark}</div>
      <div class="holding-row-info">
        <div class="holding-row-name-line">
          <span class="holding-row-name" title="${displayName.replace(/"/g, '&quot;')}">${displayName}</span>
        </div>
        <div class="holding-row-meta">${metaHtml}</div>
      </div>
      <div class="holding-row-value">${formatCurrency(value)}</div>
    </div>
  `;
}
