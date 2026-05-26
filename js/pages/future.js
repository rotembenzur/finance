// ─────────────────────────────────────────────────────────────────
//  FUTURE — long-term security, future freedom
//
//  Tier='future' wealth: pension, study fund, gemels, family-managed
//  fund, military discharge deposit, plus any other locked products
//  not currently part of daily life.
//
//  Tone: calm, optimistic, future-stability. Each row leads with a
//  reassuring headline ("Compounding for retirement", "Tax-shielded
//  growth", …) followed by a supporting fact (institution, track,
//  contribution rate, unlock date). Shared component in
//  js/components/asset-meta.js.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import {
  getFutureWealthEntries, getProvider, getBank,
  entryValue, formatCurrency,
  _iconEdit,
} from '../utils.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';

export function renderFuture(data) {
  const entries = getFutureWealthEntries(data)
    .slice()
    .sort((a, b) => entryValue(b) - entryValue(a));

  if (entries.length === 0) {
    return `
      <section class="section" id="future">
        <div class="section-header">
          <div class="section-header-text">
            <h2 class="section-title">${t('future.title')}</h2>
          </div>
        </div>
        <div class="empty-state">${t('future.empty')}</div>
      </section>
    `;
  }

  return `
    <section class="section" id="future">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('future.title')}</h2>
        </div>
      </div>

      <div class="holding-row-list">
        ${entries.map(e => _renderFutureRow(data, e)).join('')}
      </div>

    </section>
  `;
}

function _renderFutureRow(data, entry) {
  const value = entryValue(entry);
  const meta  = buildEntryMeta(entry, data);
  const metaHtml = renderMetaStack(meta);

  // Tag slot — Family marker (formerly the "external" badge)
  const tag = entry.isExternal
    ? `<span class="holding-row-tag">${t('assets.familyManagedShort')}</span>`
    : '';

  // Pick name based on the current app language — translated names
  // live on the entry as `nameEn`, with `name` always carrying the
  // Hebrew version. Fall back across the divide if either is missing.
  const displayName = currentLang === 'he'
    ? (entry.name   || entry.nameEn || '')
    : (entry.nameEn || entry.name   || '');

  return `
    <div class="holding-row" data-entry-id="${entry.id}">
      <div class="holding-row-mark">${_renderEntryMark(data, entry)}</div>
      <div class="holding-row-info">
        <div class="holding-row-name-line">
          <span class="holding-row-name" title="${displayName.replace(/"/g, '&quot;')}">${displayName}</span>
          ${tag}
        </div>
        <div class="holding-row-meta">${metaHtml}</div>
      </div>
      <div class="holding-row-value">
        <span class="holding-row-amount">${formatCurrency(value)}</span>
        <button class="icon-btn holding-row-edit-btn" onclick="editAmount('${entry.id}')" title="${t('action.edit')}">${_iconEdit}</button>
      </div>
    </div>
  `;
}

// Resolve the row's mark — provider/bank logo or empty. The 32px
// .holding-row-mark wrapper is in the row markup; we return only
// the inner element here.
function _renderEntryMark(data, entry) {
  const logo = _futureResolveLogo(data, entry);
  if (logo) {
    return `<div class="provider-mark"><img class="provider-mark-img" src="${logo}" alt="" /></div>`;
  }
  return '';
}

function _futureResolveLogo(data, entry) {
  const provider = getProvider(data, entry.providerId);
  if (provider && provider.logo) return provider.logo;
  const bank = entry.bankId ? getBank(data, entry.bankId) : null;
  if (bank && bank.logo) return bank.logo;
  return null;
}
