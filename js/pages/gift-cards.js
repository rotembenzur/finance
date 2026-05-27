// ─────────────────────────────────────────────────────────────────
//  VOUCHERS & GIFT CARDS — restricted store-credit assets
//
//  Vouchers don't belong on the main dashboard: they're not cash,
//  not invested, not a future deposit. But their remaining value
//  IS money the user can use, so it counts toward net worth as a
//  separate restricted bucket (see calcGiftCardsTotal in utils.js).
//
//  Slice 1 scaffolds the section with an empty-state. Add/edit,
//  upload, search/filter/sort, and net-worth wiring land in later
//  slices.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';

export function renderGiftCards(data) {
  const cards = Array.isArray(data.giftCards) ? data.giftCards : [];

  if (cards.length === 0) {
    return `
      <section class="section" id="gift-cards">
        <div class="section-header">
          <div class="section-header-text">
            <h2 class="section-title">${t('vouchers.title')}</h2>
            <p class="section-intro">${t('vouchers.intro')}</p>
          </div>
        </div>
        <div class="empty-state">${t('vouchers.empty')}</div>
      </section>
    `;
  }

  // List rendering lands in slice 3. For now, render a stub block
  // so the section anchor exists once vouchers are present.
  return `
    <section class="section" id="gift-cards">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('vouchers.title')}</h2>
          <p class="section-intro">${t('vouchers.intro')}</p>
        </div>
      </div>
      <div class="empty-state">${cards.length} voucher(s) — list UI coming next slice.</div>
    </section>
  `;
}
