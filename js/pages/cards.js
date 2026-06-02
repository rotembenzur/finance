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
import { getCardImageURL, isStoragePath } from '../card-image-storage.js';
import { skinColor } from '../config/registry.js';

let _activeCardId = null;

// Latest data reference, captured on every render. The scroll handler
// runs outside the render closure (it's bound once in initCardsWallet)
// but needs `data` to re-render the active card's billing-link row when
// the carousel lands on a different card. Kept in sync the same way
// _activeCardId is — set on each renderCards() pass.
let _data = null;

export function renderCards(data) {
  _data = data;
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
          <p class="section-intro">${t('cards.intro')}</p>
        </div>
        <div class="cards-header-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditCreditCardModal()" title="${t('editCard.addCard')}">
            + ${t('editCard.addCard')}
          </button>
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

      ${_renderFooter(cards, activeCard, data)}

    </section>
  `;
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
      <div class="empty-state">
        <p>${t('cards.empty')}</p>
        <button class="btn btn-primary btn-sm" onclick="openEditCreditCardModal()">
          + ${t('editCard.addFirstCard')}
        </button>
      </div>
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
      ${_renderCardUtil(card)}
    </div>
  `;
}

// Front face — the CSS-drawn card is always the base; when a photo is
// set it overlays on top (see .credit-card-img). For Supabase Storage
// paths the <img> ships without a src and _resolveCardImages() fills in
// a signed URL after render, so the CSS card shows until it loads. Data
// URIs (demo) and plain URLs (legacy) get their src inline.
function _renderCardFront(card) {
  const clubLabel = card.club || (currentLang === 'he' ? card.name : card.nameEn);
  const tierTag   = _renderTierTag(card);

  // A custom skin color (admin-set, validated hex) overrides the
  // .credit-card--<skin> CSS gradient; null falls back to it.
  const sc = skinColor(card.skin);
  const skinStyle = sc ? ` style="background:${sc}"` : '';

  const cssCard = `
    <div class="credit-card credit-card--${card.skin}"${skinStyle}>
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

  if (!card.image) return cssCard;

  const imgTag = isStoragePath(card.image)
    ? `<img class="credit-card-img" data-img-ref="${_escCard(card.image)}" alt="" />`
    : `<img class="credit-card-img" src="${_escCard(card.image)}" alt="" />`;
  return `${cssCard}${imgTag}`;
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

// Per-card credit utilization: this card's current monthly (pending)
// charge against its own credit limit. Rendered in the below-card
// metadata strip (under the name line) so it's legible at a glance for
// every card without flipping — the per-card complement to the hero's
// whole-wallet gauge, sharing its tone thresholds and bar-fill colors.
// Only credit cards with a known positive limit qualify — debit cards
// have no cycle/limit, and a zero or absent limit can't produce a
// meaningful percentage, so they get no bar.
function _renderCardUtil(card) {
  if (card.isDebit) return '';
  const limit = card.creditLimit;
  if (!(limit > 0)) return '';

  const pending = calcCardPendingCharges(card);
  const util    = (pending / limit) * 100;
  const tone    = util > 90 ? 'high' : util > 60 ? 'mid' : 'low';
  const pct     = util.toFixed(0);

  return `
    <div class="card-item-util" title="${t('cards.hero.utilization')}: ${pct}%">
      <span class="card-item-util-bar" role="progressbar"
            aria-label="${t('cards.hero.utilization')}"
            aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span class="cards-hero-bar-fill cards-hero-bar-fill--${tone}" style="width: ${Math.min(100, util).toFixed(1)}%"></span>
      </span>
      <span class="card-item-util-pct card-item-util-pct--${tone}">${pct}%</span>
    </div>
  `;
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

function _renderFooter(cards, activeCard, data) {
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
      <button id="cards-wallet-edit-btn"
              class="btn btn-ghost btn-sm cards-wallet-edit-btn"
              data-card-id="${activeCard ? activeCard.id : ''}"
              onclick="editActiveCard()"
              aria-label="${t('editCard.editAction')}" title="${t('editCard.editAction')}">
        ${_iconEdit}
      </button>
    </div>
    <div id="cards-wallet-link-host">${_renderLinkRow(activeCard, data)}</div>
  `;
}

// Billing-account link for the active card — shows which checking
// account this card draws from and opens the link modal. Shown for
// debit cards too: a debit card still bills a specific account, even
// though (unlike credit) it draws immediately rather than via a cycle,
// so it never contributes to the account's pending-charge projection.
function _renderLinkRow(card, data) {
  if (!card) return '';
  const bank       = card.bankId ? getBank(data, card.bankId) : null;
  const linkedName = bank ? getBankDisplayName(bank) : null;
  const valueText  = linkedName || t('cardLink.notLinked');
  return `
    <div class="cards-wallet-link">
      <span class="cards-wallet-link-label">${t('cardLink.linkedTo')}</span>
      <button type="button"
              class="cards-wallet-link-btn ${linkedName ? '' : 'is-unlinked'}"
              onclick="openEditCardLinkModal('${card.id}')">
        <span class="cards-wallet-link-value">${_escCard(valueText)}</span>
        <span class="cards-wallet-link-edit" aria-hidden="true">✎</span>
      </button>
    </div>
  `;
}

function _escCard(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
  // Resolve any storage-path card images to signed URLs on every render
  // pass (the wallet DOM is rebuilt each render, so the <img> elements
  // are fresh and srcless).
  _resolveCardImages(wallet);
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
    // Keep the edit button pointed at the centered card too — like the
    // action button, its target id is baked in at render time.
    const editBtn = document.getElementById('cards-wallet-edit-btn');
    if (editBtn) editBtn.dataset.cardId = newId;
    // Re-render the billing-account link row for the newly-centered
    // card. Crucial for correctness: the link button bakes the target
    // card id into its openEditCardLinkModal('…') handler at render
    // time, so without this the editor would open against (and save
    // to) whichever card was active when the footer was last rendered —
    // not the card on screen. Re-rendering also refreshes the displayed
    // linked-account name and hides the row entirely for debit cards.
    const linkHost = document.getElementById('cards-wallet-link-host');
    if (linkHost && _data) {
      const newCard = getCards(_data).find(c => c.id === newId);
      linkHost.innerHTML = _renderLinkRow(newCard, _data);
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

// Open the full add/edit/delete editor for the centered card. Reads the
// edit button's data-card-id (kept in sync by the scroll handler).
export function editActiveCard() {
  const btn = document.getElementById('cards-wallet-edit-btn');
  const cardId = btn?.dataset.cardId;
  if (cardId && typeof window.openEditCreditCardModal === 'function') {
    window.openEditCreditCardModal(cardId);
  }
}

// Signed-URL cache so repeated renders within the 1 h TTL don't re-sign
// the same storage path. Keyed by the stored ref.
const _signedUrlCache = new Map();

// Fill in the src for any srcless card-image <img> (storage paths). Runs
// after each render. Data URIs / plain URLs already carry their src and
// are skipped. Failures leave the CSS card fallback visible.
async function _resolveCardImages(wallet) {
  const imgs = wallet.querySelectorAll('img.credit-card-img[data-img-ref]');
  for (const img of imgs) {
    if (img.getAttribute('src')) continue;
    const ref = img.getAttribute('data-img-ref');
    if (!ref) continue;
    let url = _signedUrlCache.get(ref);
    if (!url) {
      url = await getCardImageURL(ref);
      if (url) _signedUrlCache.set(ref, url);
    }
    if (url) img.src = url;
  }
}
