// ─────────────────────────────────────────────────────────────────
//  CARDS — wallet view
//
//  A calm horizontal "card holder" rather than a gallery grid. The
//  page is structured as three quiet layers:
//
//    1. Hero strip      — outstanding · utilization · next billing.
//                          Tells you about the WALLET, not any single
//                          card. Calm, never the loudest thing.
//
//    2. Wallet carousel — horizontal scroll-snap. The card whose
//                          center sits closest to the viewport's
//                          center is rendered full-size + full
//                          opacity; neighboring cards "peek" behind
//                          it at scale 0.86, opacity 0.5. Tap a peek
//                          to slide it into focus; tap the focused
//                          card to flip and reveal its back details
//                          (limit / spending / billing / fees).
//
//    3. Wallet footer   — position dots + one contextual button
//                          ("View charges of •••• 9367 →") that
//                          tracks whichever card is centered.
//
//  Per-card chrome (usage bar, "View charges" button) was removed
//  from the front of each card — those duplicated metadata across
//  every tile and turned the section into a gallery. The same
//  information now lives once on the back of the active card
//  (limit / spending) and once below the wallet (the contextual
//  charges button).
//
//  Module-level _activeCardId persists across re-renders so unrelated
//  state changes (cash edits, imports, etc.) don't reset the user's
//  swipe position back to the first card.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatMilestone, formatCardExpiry, formatRelative } from '../dates.js';
import {
  getCards, getBank, getBankDisplayName,
  formatCurrency, networkLogoHtml,
  calcDaysUntil,
  _iconEdit, _iconSync,
} from '../utils.js';

let _activeCardId = null;

export function renderCards(data) {
  const cards = getCards(data);
  if (cards.length === 0) return _renderEmpty();

  // Preserve active card across re-renders. If the previous active
  // card was removed/disabled, fall back to the first one.
  if (!_activeCardId || !cards.find(c => c.id === _activeCardId)) {
    _activeCardId = cards[0].id;
  }
  const activeCard = cards.find(c => c.id === _activeCardId);

  return `
    <section class="section" id="cards">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('cards.title')}</h2>
        </div>
        <div class="cards-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openQuickExpenseModal()" title="${t('quickExpense.button')}">
            + ${t('quickExpense.button')}
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openExpenseImportPicker()" title="${t('importPicker.button')}">
            ${_iconSync} ${t('importPicker.button')}
          </button>
        </div>
      </div>

      ${_renderHero(cards)}

      <div class="cards-wallet" data-wallet-init="0" aria-label="${t('cards.walletLabel')}">
        ${cards.map(c => _renderCardItem(c, data, c.id === _activeCardId)).join('')}
      </div>

      ${_renderFooter(cards, activeCard)}

    </section>
  `;
}

function _renderEmpty() {
  return `
    <section class="section" id="cards">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('cards.title')}</h2>
        </div>
      </div>
      <div class="empty-state">${t('cards.empty')}</div>
    </section>
  `;
}

// ── Hero ─────────────────────────────────────────────────────────

function _renderHero(cards) {
  const credit   = cards.filter(c => !c.isDebit);
  const spending = credit.reduce((s, c) => s + (c.currentSpending || 0), 0);
  const limit    = credit.reduce((s, c) => s + (c.creditLimit    || 0), 0);
  const util     = limit > 0 ? (spending / limit) * 100 : null;

  const upcoming = credit
    .filter(c => c.currentSpending && c.nextBilling)
    .map(c => ({ days: calcDaysUntil(c.nextBilling), card: c }))
    .filter(x => x.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  const utilTone = util == null ? 'neutral'
                 : util > 90 ? 'high'
                 : util > 60 ? 'mid'
                 :             'low';

  // Every column shares the same 3-row anatomy:
  //   1. label  — small caps, muted
  //   2. value-line — primary number (+ inline bar on utilization)
  //   3. sub  — small, muted supporting fact
  // This is what makes the strip read as a single composed unit
  // rather than three differently-shaped widgets.
  const cardCount  = credit.length;
  const outSub     = cardCount === 1
    ? t('cards.hero.across').replace('{count}', '1') + ' ' + t('cards.hero.cardOne')
    : t('cards.hero.across').replace('{count}', String(cardCount)) + ' ' + t('cards.hero.cardMany');

  const utilSub    = limit > 0
    ? t('cards.hero.ofLimit').replace('{limit}', formatCurrency(limit))
    : t('cards.hero.noLimit');

  const billingSub = upcoming
    ? (formatRelative(upcoming.days) || '')
    : '';

  return `
    <div class="cards-hero">
      <div class="cards-hero-stat">
        <span class="cards-hero-label">${t('cards.hero.outstanding')}</span>
        <span class="cards-hero-value-line">
          <span class="cards-hero-value">${formatCurrency(spending)}</span>
        </span>
        <span class="cards-hero-sub">${outSub}</span>
      </div>

      <div class="cards-hero-stat cards-hero-stat--utilization">
        <span class="cards-hero-label">${t('cards.hero.utilization')}</span>
        <span class="cards-hero-value-line">
          <span class="cards-hero-value">${util == null ? '—' : util.toFixed(0) + '%'}</span>
          ${util != null ? `
            <span class="cards-hero-bar" role="progressbar"
                  aria-valuenow="${util.toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
              <span class="cards-hero-bar-fill cards-hero-bar-fill--${utilTone}" style="width: ${Math.min(100, util).toFixed(1)}%"></span>
            </span>
          ` : ''}
        </span>
        <span class="cards-hero-sub">${utilSub}</span>
      </div>

      <div class="cards-hero-stat">
        <span class="cards-hero-label">${t('cards.hero.nextBilling')}</span>
        <span class="cards-hero-value-line">
          <span class="cards-hero-value">${upcoming ? formatMilestone(upcoming.card.nextBilling) : '—'}</span>
        </span>
        <span class="cards-hero-sub">${upcoming ? billingSub : t('cards.hero.noUpcoming')}</span>
      </div>
    </div>
  `;
}

// ── Card item ────────────────────────────────────────────────────

function _renderCardItem(card, data, isActive) {
  const bank        = card.bankId ? getBank(data, card.bankId) : null;
  const bankName    = bank ? getBankDisplayName(bank) : (card.institution || '');
  const displayName = currentLang === 'he' ? card.name : (card.nameEn || card.name);

  return `
    <div class="card-item ${isActive ? 'is-active' : ''}"
         data-card-id="${card.id}"
         data-card-last4="${card.last4}"
         role="group" aria-roledescription="card"
         aria-label="${displayName} •••• ${card.last4}">
      <div class="card-flipper" title="${t('cards.flipHint')}">
        <div class="card-flipper-inner">
          <div class="card-flipper-front">${_renderCardFront(card)}</div>
          <div class="card-flipper-back">${_renderCardBack(card, bankName)}</div>
        </div>
      </div>
      <div class="card-item-name">${displayName} · ${card.last4}</div>
    </div>
  `;
}

// Front face — the photo when one is set, CSS-drawn fallback otherwise.
function _renderCardFront(card) {
  if (card.image) {
    return `<img class="credit-card-img" src="${card.image}" alt="" />`;
  }

  const clubLabel = card.club || (currentLang === 'he' ? card.name : card.nameEn);
  const tierTag   = _renderTierTag(card);

  return `
    <div class="credit-card credit-card--${card.skin}">
      <div class="credit-card-head">
        <span class="credit-card-club">${clubLabel}</span>
        ${networkLogoHtml(card.network)}
      </div>
      <div class="credit-card-number">•••• •••• •••• ${card.last4}</div>
      <div class="credit-card-foot">
        ${tierTag}
        <span class="credit-card-expiry">${formatCardExpiry(card.expiry)}</span>
      </div>
    </div>
  `;
}

// Back face — three layered groups: identity strip, facts, fees.
// Unchanged from the gallery layout — the back-of-card content still
// works; only the surrounding wallet chrome changed.
function _renderCardBack(card, bankName) {
  const topLabel = card.club || bankName || '';
  const typeText = card.cardType ? t('cards.type.' + card.cardType) : '';
  const headLeft = [topLabel, typeText].filter(Boolean).join(' · ');
  const head = `
    <div class="credit-card-back-head">
      <span class="credit-card-back-club">${headLeft}</span>
      <span class="credit-card-back-last4">•••• ${card.last4}</span>
    </div>
  `;

  const factRows = [];
  if (card.creditLimit !== null && card.creditLimit !== undefined) {
    factRows.push(_backRow(t('cards.limit'), formatCurrency(card.creditLimit)));
  }
  if (card.currentSpending !== null && card.currentSpending !== undefined && !card.isDebit) {
    factRows.push(_backRow(t('cards.spending'), formatCurrency(card.currentSpending), {
      onclick: `editCardSpending('${card.id}')`,
    }));
  }
  if (card.nextBilling) {
    factRows.push(_backRow(t('cards.nextBilling'), formatMilestone(card.nextBilling)));
  }
  if (card.expiry) {
    factRows.push(_backRow(t('cards.expiry'), formatCardExpiry(card.expiry)));
  }

  const factsHtml = factRows.length > 0
    ? `<div class="credit-card-back-rows">${factRows.join('')}</div>`
    : '';

  let feesHtml = '';
  if (card.fees && (card.fees.foreignTxn || card.fees.foreignCash)) {
    const feeRows = [];
    if (card.fees.foreignTxn) {
      feeRows.push(_backRow(t('cards.foreignTxn'), _formatFeeRate(card.fees.foreignTxn)));
    }
    if (card.fees.foreignCash) {
      feeRows.push(_backRow(t('cards.foreignCash'), _formatFeeRate(card.fees.foreignCash)));
    }
    feesHtml = `<div class="credit-card-back-rows credit-card-back-fees">${feeRows.join('')}</div>`;
  }

  return `${head}${factsHtml}${feesHtml}`;
}

function _backRow(label, value, opts = {}) {
  if (opts.onclick) {
    return `
      <span class="credit-card-back-label">${label}</span>
      <span class="credit-card-back-value credit-card-back-value--clickable" onclick="event.stopPropagation(); ${opts.onclick}">${value}</span>
    `;
  }
  return `
    <span class="credit-card-back-label">${label}</span>
    <span class="credit-card-back-value">${value}</span>
  `;
}

function _formatFeeRate(feeObj) {
  if (!feeObj) return '';
  const { eur, usd, other } = feeObj;
  if (eur === usd && usd === other) {
    return `${Number(eur).toFixed(2)}%`;
  }
  return `EUR ${eur}% · USD ${usd}% · ${t('cards.other')} ${other}%`;
}

function _renderTierTag(card) {
  if (card.isDebit) {
    return `<span class="credit-card-debit-tag">${t('cards.debitCard')}</span>`;
  }
  if (card.tier === 'gold') {
    return `<span class="credit-card-type-tag">${t('cards.gold')}</span>`;
  }
  return `<span></span>`;
}

// ── Footer (dots + active-card action) ──────────────────────────

function _renderFooter(cards, activeCard) {
  const dots = cards.length > 1
    ? `
      <div class="cards-wallet-dots" role="tablist" aria-label="${t('cards.walletDotsLabel')}">
        ${cards.map((c, i) => `
          <button type="button"
                  class="cards-wallet-dot ${c.id === _activeCardId ? 'is-active' : ''}"
                  data-card-index="${i}"
                  aria-label="${c.last4}"
                  onclick="focusCardAt(${i})"></button>
        `).join('')}
      </div>
    `
    : '';

  const last4 = activeCard ? activeCard.last4 : '';
  return `
    ${dots}
    <div class="cards-wallet-action">
      <button id="cards-wallet-action-btn"
              class="btn btn-ghost btn-sm cards-wallet-action-btn"
              data-card-id="${activeCard ? activeCard.id : ''}"
              onclick="viewActiveCardCharges()">
        ${t('cards.viewChargesOf')}
        <span class="cards-wallet-action-label">•••• <span class="cards-wallet-action-last4">${last4}</span></span>
        <span class="cards-wallet-action-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  `;
}

// ─────────────────────────────────────────
//  WALLET RUNTIME — scroll tracking + taps
// ─────────────────────────────────────────

// Re-attaches the carousel's scroll listener + click delegation after
// every render. Idempotent — checks data-wallet-init so we don't
// double-bind. Called from app.js's init() pipeline.
export function initCardsWallet() {
  const wallet = document.querySelector('.cards-wallet');
  if (!wallet) return;
  if (wallet.dataset.walletInit === '1') {
    // Already initialized; just bring the active card back into view
    // in case the layout changed under us.
    _scrollActiveIntoCenter(wallet, /* smooth */ false);
    return;
  }
  wallet.dataset.walletInit = '1';

  // Scroll: detect which card is centered, mark .is-active, update
  // dots + contextual button.
  let ticking = false;
  wallet.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      _updateActiveFromScroll(wallet);
      ticking = false;
    });
  }, { passive: true });

  // Click: tap a peek to focus, tap the focused card to flip.
  wallet.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card-item');
    if (!cardEl) return;
    if (cardEl.classList.contains('is-active')) {
      const flipper = cardEl.querySelector('.card-flipper');
      if (flipper) flipCard(flipper);
    } else {
      cardEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  // Position the previously-active card at center on first init,
  // without animation so the page lands settled.
  _scrollActiveIntoCenter(wallet, /* smooth */ false);
}

function _scrollActiveIntoCenter(wallet, smooth) {
  if (!_activeCardId) return;
  const target = wallet.querySelector(`.card-item[data-card-id="${_activeCardId}"]`);
  if (!target) return;
  target.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    inline: 'center',
    block: 'nearest',
  });
}

function _updateActiveFromScroll(wallet) {
  const walletRect = wallet.getBoundingClientRect();
  const center = (walletRect.left + walletRect.right) / 2;

  const cards = [...wallet.querySelectorAll('.card-item')];
  let bestEl = null;
  let bestDist = Infinity;
  for (const el of cards) {
    const rect = el.getBoundingClientRect();
    const elCenter = (rect.left + rect.right) / 2;
    const dist = Math.abs(elCenter - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestEl = el;
    }
  }
  if (!bestEl) return;

  // Apply .is-active to the chosen card.
  for (const el of cards) {
    el.classList.toggle('is-active', el === bestEl);
  }

  const newId = bestEl.dataset.cardId;
  if (newId !== _activeCardId) {
    _activeCardId = newId;
    // Sync dots.
    const idx = cards.indexOf(bestEl);
    document.querySelectorAll('.cards-wallet-dot').forEach((d, i) => {
      d.classList.toggle('is-active', i === idx);
    });
    // Update the contextual "View charges" button.
    const btn = document.getElementById('cards-wallet-action-btn');
    if (btn) {
      btn.dataset.cardId = newId;
      const last4El = btn.querySelector('.cards-wallet-action-last4');
      if (last4El) last4El.textContent = bestEl.dataset.cardLast4 || '';
    }
  }
}

// ── Inline-handler exports (wired on window in app.js) ─────────

// Toggle the flip on the active card. Kept exported for the bridge.
export function flipCard(flipperEl) {
  if (!flipperEl) return;
  flipperEl.classList.toggle('is-flipped');
}

// Smoothly bring the card at `index` into the wallet's center. Used
// by the dot indicator buttons. The subsequent scroll fires
// _updateActiveFromScroll which takes care of the rest.
export function focusCardAt(index) {
  const wallet = document.querySelector('.cards-wallet');
  if (!wallet) return;
  const target = wallet.querySelectorAll('.card-item')[index];
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

// Drilldown into the currently-active card's monthly charges. Reads
// the action button's data-card-id, which the scroll handler keeps
// in sync with the centered card.
export function viewActiveCardCharges() {
  const btn = document.getElementById('cards-wallet-action-btn');
  const cardId = btn?.dataset.cardId;
  if (cardId && typeof window.navigateToCardCharges === 'function') {
    window.navigateToCardCharges(cardId);
  }
}
