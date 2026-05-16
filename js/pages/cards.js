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
  calcDaysUntil, calcCardPendingCharges,
  _iconEdit, _iconSync, _iconInfo,
} from '../utils.js';

let _activeCardId = null;

export function renderCards(data) {
  const cards = getCards(data);
  if (cards.length === 0) return _renderEmpty();

  // Preserve active card across re-renders. If the previous active
  // card was removed/disabled, default to the most-used card —
  // highest pending-billing total among credit cards — rather than
  // the first by index. This makes the carousel land on the card
  // the user most likely came here to look at.
  if (!_activeCardId || !cards.find(c => c.id === _activeCardId)) {
    _activeCardId = _pickDefaultActiveCard(cards);
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
        <div class="cards-wallet-stage">
          ${_renderStage(cards, data, _activeCardId)}
        </div>
        ${_renderFooter(cards, activeCard)}
      </div>

    </section>
  `;
}

// Render every card as an absolute-positioned stage element with
// offset + abs-offset CSS variables. The CSS reads those to compute
// the translateX / scale / opacity / z-index from a single source —
// updating them at runtime (via _setActive) animates the carousel
// smoothly without a full re-render.
function _renderStage(cards, data, activeId) {
  const activeIdx = Math.max(0, cards.findIndex(c => c.id === activeId));
  return cards.map((c, i) => {
    const offset = i - activeIdx;
    return _renderCardItem(c, data, offset);
  }).join('');
}

// Highest pending-billing total among credit cards wins. Debit
// cards never win the default (they have no pending). All ties
// resolve to the first-by-index card so the choice stays stable
// across re-renders when no card has any pending charges yet.
function _pickDefaultActiveCard(cards) {
  const credit = cards.filter(c => !c.isDebit);
  if (credit.length === 0) return cards[0].id;
  let best = credit[0];
  let bestPending = calcCardPendingCharges(best);
  for (let i = 1; i < credit.length; i++) {
    const p = calcCardPendingCharges(credit[i]);
    if (p > bestPending) { best = credit[i]; bestPending = p; }
  }
  return best.id;
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
  // Pending-only total: sum each card's in-window charges. See
  // calcCardPendingCharges for the boundary convention.
  const spending = credit.reduce((s, c) => s + calcCardPendingCharges(c), 0);
  const limit    = credit.reduce((s, c) => s + (c.creditLimit || 0), 0);
  const util     = limit > 0 ? (spending / limit) * 100 : null;

  // "Next billing" highlights the card with the soonest billing
  // date among cards that actually have pending charges — cards
  // with zero pending don't need to be surfaced here.
  const upcoming = credit
    .filter(c => calcCardPendingCharges(c) > 0 && c.nextBilling)
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
  //
  // Outstanding column carries the most ambiguity-prone number on
  // the page — it's "what hasn't been billed yet across all cards,"
  // *not* a lifetime total. The label says "Pending billing", the
  // sub leads with "Not yet billed", and an info-icon tooltip spells
  // out the per-card calculation for users who want the detail.
  const cardCount  = credit.length;
  const acrossN    = cardCount === 1
    ? t('cards.hero.across').replace('{count}', '1') + ' ' + t('cards.hero.cardOne')
    : t('cards.hero.across').replace('{count}', String(cardCount)) + ' ' + t('cards.hero.cardMany');
  const outSub     = `${t('cards.hero.notBilledYet')} · ${acrossN}`;

  const utilSub    = limit > 0
    ? t('cards.hero.ofLimit').replace('{limit}', formatCurrency(limit))
    : t('cards.hero.noLimit');

  const billingSub = upcoming
    ? (formatRelative(upcoming.days) || '')
    : '';

  // Inline info tooltip reusing the holding-info-wrap pattern that
  // assets.js uses for per-holding descriptions. Click on the icon
  // toggles .is-open (handled by app.js's toggleHoldingTooltip);
  // desktop also surfaces on hover via the existing CSS.
  const tipDir  = currentLang === 'he' ? 'rtl' : 'ltr';
  const tipLang = currentLang === 'he' ? 'he' : 'en';
  const tipText = t('cards.hero.calcTooltip');
  const tipBtn  = `
    <span class="holding-info-wrap cards-hero-tip-wrap">
      <button class="icon-btn holding-info-btn"
              type="button"
              aria-label="${t('cards.hero.calcTooltipLabel')}"
              onclick="toggleHoldingTooltip(this)">${_iconInfo}</button>
      <span class="holding-info-tip"
            role="tooltip"
            dir="${tipDir}"
            lang="${tipLang}">${tipText}</span>
    </span>
  `;

  return `
    <div class="cards-hero">
      <div class="cards-hero-stat">
        <span class="cards-hero-label cards-hero-label--with-tip">
          ${t('cards.hero.outstanding')}
          ${tipBtn}
        </span>
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

      <div class="cards-hero-stat cards-hero-stat--next-billing">
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

// Per-card stage element. `offset` is the signed index distance from
// the active card (0 = active, -1 = left peek, +1 = right peek, etc.)
// — emitted as a CSS variable so the stylesheet derives the visual
// transform from a single source. abs-offset is also emitted so the
// stylesheet doesn't need an abs() function (broader support).
function _renderCardItem(card, data, offset) {
  const bank        = card.bankId ? getBank(data, card.bankId) : null;
  const bankName    = bank ? getBankDisplayName(bank) : (card.institution || '');
  const displayName = currentLang === 'he' ? card.name : (card.nameEn || card.name);
  const absOffset   = Math.abs(offset);
  const isActive    = offset === 0;
  // Cards more than 2 steps away from the active stay in the DOM
  // (so the active-index handler can find them by id) but they're
  // hidden by CSS so they don't paint or capture taps.
  const isFar       = absOffset > 2 ? '1' : '0';

  return `
    <div class="card-item ${isActive ? 'is-active' : ''}"
         data-card-id="${card.id}"
         data-card-last4="${card.last4}"
         data-far="${isFar}"
         style="--offset: ${offset}; --abs-offset: ${absOffset};"
         role="group" aria-roledescription="card"
         aria-label="${displayName} •••• ${card.last4}">
      <div class="card-flipper" title="${t('cards.flipHint')}">
        <div class="card-flipper-inner">
          <div class="card-flipper-front">${_renderCardFront(card)}</div>
          <div class="card-flipper-back">${_renderCardBack(card, bankName)}</div>
        </div>
      </div>
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
  if (!card.isDebit) {
    // Show the in-window pending total — same value the hero adds up.
    // The manual-edit modal only makes sense when there are no
    // imported charges driving the calculation; once `charges[]` is
    // populated, charges themselves are the source of truth and the
    // pencil affordance would drift out of sync with the displayed
    // number, so we don't expose it here.
    const pending = calcCardPendingCharges(card);
    const hasCharges = Array.isArray(card.charges) && card.charges.length > 0;
    const opts = hasCharges ? {} : { onclick: `editCardSpending('${card.id}')` };
    if (pending !== 0 || card.currentSpending != null) {
      factRows.push(_backRow(t('cards.spending'), formatCurrency(pending), opts));
    }
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
// The footer sits inside the wallet container, flowing right below
// the card stage. Width matches the active card so the dots + button
// read as one visual unit with the centered card above them.

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
    <div class="cards-wallet-footer">
      ${dots}
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
//  WALLET RUNTIME — tap + swipe carousel
// ─────────────────────────────────────────
//
// The new carousel doesn't scroll. Each card is absolute-positioned
// in the stage; its visual offset from the active card is driven by
// CSS variables (--offset, --abs-offset) and the stylesheet derives
// transform / opacity / z-index from them. _setActive shifts those
// variables in place so the CSS transition animates the change.
//
// Interactions:
//   • tap a peek    → make it active
//   • tap the active → flip
//   • tap a dot     → make that card active
//   • horizontal swipe (touch) → advance ±1
//
// Idempotent via data-wallet-init so the every-render init() pass
// from app.js doesn't double-bind.

export function initCardsWallet() {
  const wallet = document.querySelector('.cards-wallet');
  if (!wallet) return;
  if (wallet.dataset.walletInit === '1') return;
  wallet.dataset.walletInit = '1';

  const stage = wallet.querySelector('.cards-wallet-stage');
  if (!stage) return;

  // Tap delegation — peek → setActive, active → flip.
  stage.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card-item');
    if (!cardEl) return;
    const cardId = cardEl.dataset.cardId;
    if (cardEl.classList.contains('is-active')) {
      const flipper = cardEl.querySelector('.card-flipper');
      if (flipper) flipCard(flipper);
      return;
    }
    _setActive(stage, cardId);
  });

  // Touch swipe — horizontal drag past a small threshold advances
  // the carousel by one. RTL aware: swipe right means "previous
  // card" in LTR / "next card" in RTL, matching the visual
  // intuition of dragging the active card off in that direction.
  let swipeStart = null;
  stage.addEventListener('touchstart', (e) => {
    swipeStart = e.touches[0]?.clientX ?? null;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (swipeStart == null) return;
    const endX = e.changedTouches[0]?.clientX;
    const start = swipeStart;
    swipeStart = null;
    if (endX == null) return;
    const delta = endX - start;
    if (Math.abs(delta) < 40) return; // small movement → treat as tap
    const isRtl = document.documentElement.dir === 'rtl';
    const dir = (delta > 0 ? -1 : 1) * (isRtl ? -1 : 1);
    _advance(stage, dir);
  }, { passive: true });
}


// Update CSS variables on every card so the transition animates,
// without re-rendering the page. Cheap and smooth.
function _setActive(stage, cardId) {
  if (!stage) return;
  const cards = [...stage.querySelectorAll('.card-item')];
  const newIdx = cards.findIndex(c => c.dataset.cardId === cardId);
  if (newIdx === -1) return;
  _activeCardId = cardId;
  cards.forEach((el, i) => {
    const offset    = i - newIdx;
    const absOffset = Math.abs(offset);
    el.style.setProperty('--offset',     String(offset));
    el.style.setProperty('--abs-offset', String(absOffset));
    el.dataset.far = absOffset > 2 ? '1' : '0';
    el.classList.toggle('is-active', offset === 0);
    // Reset the flipper when a card becomes a peek — a flipped peek
    // would show its back face from the side, which looks wrong.
    if (offset !== 0) {
      const flipper = el.querySelector('.card-flipper');
      if (flipper) flipper.classList.remove('is-flipped');
    }
  });
  // Sync dots.
  document.querySelectorAll('.cards-wallet-dot').forEach((d, i) => {
    d.classList.toggle('is-active', i === newIdx);
  });
  // Update the contextual "View charges" button.
  const btn = document.getElementById('cards-wallet-action-btn');
  if (btn) {
    btn.dataset.cardId = cardId;
    const last4El = btn.querySelector('.cards-wallet-action-last4');
    if (last4El) last4El.textContent = cards[newIdx].dataset.cardLast4 || '';
  }
}

function _advance(stage, delta) {
  if (!stage) return;
  const cards = [...stage.querySelectorAll('.card-item')];
  const curIdx = cards.findIndex(c => c.dataset.cardId === _activeCardId);
  const nextIdx = Math.max(0, Math.min(cards.length - 1, curIdx + delta));
  if (nextIdx === curIdx) return;
  _setActive(stage, cards[nextIdx].dataset.cardId);
}

// ── Inline-handler exports (wired on window in app.js) ─────────

// Toggle the flip on the active card. Kept exported for the bridge.
export function flipCard(flipperEl) {
  if (!flipperEl) return;
  flipperEl.classList.toggle('is-flipped');
}

// Dots handler — set the card at `index` as active. The CSS
// transitions on each card's transform animate the change.
export function focusCardAt(index) {
  const stage = document.querySelector('.cards-wallet-stage');
  if (!stage) return;
  const cards = [...stage.querySelectorAll('.card-item')];
  if (index < 0 || index >= cards.length) return;
  _setActive(stage, cards[index].dataset.cardId);
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
