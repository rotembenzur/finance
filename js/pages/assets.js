// ─────────────────────────────────────────────────────────────────
//  INVESTED — long-term capital actively at work
//
//  Reading-View list of tier='invested' wealth:
//    1. The IBI portfolio (calm hero, no trader chrome)
//    2. Other invested — bank-held stock (MR1) + Investment Gemel
//
//  Future-tier products (pension, gemels, study, family fund,
//  military deposit) live on the separate Future page (#future).
//  Available-tier near-maturity savings live on the Available page.
//
//  Calm-by-design:
//    – No daily-change pill on the hero
//    – No per-holding daily%
//    – Total return + cost basis stay (long-term metrics)
// ─────────────────────────────────────────────────────────────────

import { t, currentLang, TRANSLATIONS } from '../i18n.js';
import { categorizeHolding, buildPortfolioAllocation } from '../portfolio-allocation.js';
import { getHoldingDescription } from '../holding-descriptions.js';
import {
  getPortfolios, getStandaloneInvested, getPortfolioHoldings,
  getPortfolio, getPortfolioDisplayName, getProvider, getBank,
  entryValue, typeLabel, gainClass,
  formatCurrency, formatNumber,
  calcGainFromCostBasis,
  _iconSync, _iconPortfolio, _iconEdit, _iconInfo,
} from '../utils.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';
import { getStockQuote, STOCK_QUOTES } from '../stock-quotes.js';
import { computeRiskProfile } from '../risk-model.js';
import { isExpanded } from '../ux-disclosure.js';

// UX v2: top-N holdings visible per portfolio; the long tail is
// available via a "Show all N holdings" expander. Captures the
// "your top positions tell most of the story" idea without removing
// any data — the tail is one click away. Mobile already collapses
// each row to a compact "name · value" line (see the document-level
// handler in app.js); v2 brings that same behavior to desktop.
const PORTFOLIO_HOLDINGS_TOP_N = 5;

export function renderAssets(data) {
  const portfolios = getPortfolios(data);
  const standalone = getStandaloneInvested(data);

  const portfoliosHtml = portfolios.map(p => _renderPortfolio(data, p)).join('');
  const standaloneHtml = standalone.length > 0 ? _renderStandaloneSection(data, standalone) : '';

  return `
    <section class="section" id="assets">

      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('assets.title')}</h2>
          <p class="section-intro">${t('assets.intro')}</p>
        </div>
      </div>

      ${portfoliosHtml}
      ${standaloneHtml}

    </section>
  `;
}

// ── IBI portfolio (calm long-term capital, not trading) ─────────

function _renderPortfolio(data, portfolio) {
  const holdings = getPortfolioHoldings(data, portfolio.id)
    .slice()
    .sort((a, b) => entryValue(b) - entryValue(a));

  return `
    <div class="portfolio-block">
      ${_renderPortfolioHero(data, portfolio, holdings)}
      ${_renderAllocation(data, portfolio)}
      ${_renderPortfolioHoldings(holdings, portfolio)}
    </div>
  `;
}

// ── Allocation — horizontal composition stripe + clean legend ────
//
// Replaces the old SVG donut + perspective-style legend with a
// horizontal stripe (matching the Intelligence page's composition
// pattern). Stripe segments are sized by share and colored per
// category. The legend below lists each segment as a one-line row:
// dot · name · holdings · value · percentage. Hover any stripe
// segment or any legend row → other segments dim, isolating the
// selected category visually.

function _renderAllocation(data, portfolio) {
  const allocation = buildPortfolioAllocation(data, portfolio.id);
  if (allocation.segments.length === 0) return '';

  const segments = allocation.segments.map(s => `
    <div class="alloc-stripe-seg"
         data-segment="${s.category.id}"
         style="width: ${s.pct}%; background: ${s.category.color}"
         onmouseenter="highlightAllocationSegment('${s.category.id}')"
         onmouseleave="clearAllocationHighlight()"
         title="${t(s.category.nameKey)} · ${s.pct.toFixed(1)}%"></div>
  `).join('');

  const rows = allocation.segments.map(s => {
    const tickers = s.holdings.map(h => h.ticker || h.name).join(' · ');
    return `
      <div class="alloc-row"
           data-segment="${s.category.id}"
           onmouseenter="highlightAllocationSegment('${s.category.id}')"
           onmouseleave="clearAllocationHighlight()">
        <span class="alloc-row-dot" style="background: ${s.category.color}"></span>
        <span class="alloc-row-name">${t(s.category.nameKey)}</span>
        <span class="alloc-row-holdings">${tickers}</span>
        <span class="alloc-row-value">${formatCurrency(s.value)}</span>
        <span class="alloc-row-pct">${s.pct.toFixed(1)}%</span>
      </div>
    `;
  }).join('');

  return `
    <div class="allocation">
      <div class="allocation-header">
        <span class="allocation-title">${t('allocation.title')}</span>
      </div>
      <div class="alloc-stripe">${segments}</div>
      <div class="alloc-legend">${rows}</div>
    </div>
  `;
}

// Hover handlers — global so the inline onmouseenter/onmouseleave
// attributes survive every init() re-render without rewiring. The
// selector covers both the stripe segments and the legend rows so
// hovering either side highlights the matched element on both.
export function highlightAllocationSegment(id) {
  document.querySelectorAll('.alloc-stripe-seg, .alloc-row').forEach(el => {
    el.classList.toggle('is-dimmed', el.dataset.segment !== id);
  });
}

export function clearAllocationHighlight() {
  document.querySelectorAll('.alloc-stripe-seg, .alloc-row').forEach(el => {
    el.classList.remove('is-dimmed');
  });
}

// Hero section — calm two-tier composition:
//
//   1. Header band — logo + name + sublabel + sync chip, hairline
//                    divider below.
//   2. Headline    — ₪value (calmest moment) + composite gain line
//                    ("↑ ₪5,000 · +11.1% · cost basis ₪45,000").
//   3. Context row — one quiet line at the bottom carrying the two
//                    supporting facts users care about most:
//                    Cash available (editable) and Risk score with
//                    interpretation. No 3-stat grid clutter, no
//                    full risk-profile block — the Intelligence
//                    page now carries the multi-dimensional Risk
//                    Surface and the per-account comparison.
//
// Daily P/L stays out — long-term capital, not trading.
function _renderPortfolioHero(data, portfolio, holdings) {
  const value     = portfolio.totalValue;
  const invested  = portfolio.totalInvested;
  const gain      = portfolio.totalGain;
  const gainPct   = portfolio.totalGainPercent;
  const positions = holdings.length;

  const provider = getProvider(data, portfolio.providerId);
  const heroIcon = provider && provider.logo
    ? `<span class="portfolio-hero-logo portfolio-hero-logo--brand">
         <img class="provider-mark-img" src="${provider.logo}" alt="" />
       </span>`
    : `<span class="portfolio-hero-logo">${_iconPortfolio}</span>`;

  return `
    <div class="portfolio-hero">

      ${_renderHeroHeader(portfolio, heroIcon)}

      <div class="portfolio-hero-headline">
        <div class="portfolio-hero-amount">
          <span class="portfolio-amount-symbol">₪</span>
          <span class="portfolio-amount-number">${formatNumber(value)}</span>
        </div>
        ${_renderHeroGain(gain, gainPct, invested, positions)}
      </div>

      ${_renderHeroContext(data, portfolio)}

    </div>
  `;
}

// Header band: logo + identity + Excel-sync chip, all on one
// baseline, thin hairline beneath. Excel import is the single
// portfolio-update mechanism — there is no Yahoo Finance integration
// at the portfolio level.
function _renderHeroHeader(portfolio, heroIcon) {
  const sublabel = _portfolioSublabel(portfolio);
  return `
    <div class="portfolio-hero-header">
      <div class="portfolio-hero-identity">
        ${heroIcon}
        <div class="portfolio-hero-identity-text">
          <span class="portfolio-hero-name">${getPortfolioDisplayName(portfolio)}</span>
          <span class="portfolio-hero-sublabel">${sublabel}</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm portfolio-hero-sync"
              onclick="openIBIImportFlow()"
              title="${t('import.syncFromBroker')}">
        ${_iconSync} ${t('import.syncFromBroker')}
      </button>
    </div>
  `;
}

// Composite gain line — reads as one sentence: arrow + amount + pct
// + (cost basis · N positions). The cost basis was its own stat
// card in the old layout; folding it inline here keeps the headline
// tight without losing the anchor figure long-term investors want.
function _renderHeroGain(gain, gainPct, invested, positions) {
  if (gain == null || gainPct == null) return '';
  const cls    = gainClass(gain);
  const arrow  = gain > 0 ? '↑' : gain < 0 ? '↓' : '·';
  const sign   = gain >= 0 ? '+' : '−';
  const contextParts = [];
  if (invested != null) {
    contextParts.push(`${t('portfolio.sinceCostBasis')} ${formatCurrency(invested)}`);
  } else {
    contextParts.push(t('portfolio.lifetime'));
  }
  if (positions > 0) {
    const positionWord = positions === 1
      ? t('portfolio.acrossPosition')
      : t('portfolio.acrossPositions');
    contextParts.push(`${positions} ${positionWord}`);
  }
  return `
    <div class="portfolio-hero-gain ${cls}">
      <span class="portfolio-hero-gain-arrow" aria-hidden="true">${arrow}</span>
      <span class="portfolio-hero-gain-amount">${formatCurrency(Math.abs(gain))}</span>
      <span class="portfolio-hero-gain-sep" aria-hidden="true">·</span>
      <span class="portfolio-hero-gain-pct">${sign}${Math.abs(gainPct).toFixed(1)}%</span>
      <span class="portfolio-hero-gain-sep" aria-hidden="true">·</span>
      <span class="portfolio-hero-gain-context">${contextParts.join(' · ')}</span>
    </div>
  `;
}

// ── Hero context row — quiet, single-line carrier ────────────────
//
// Replaces the 3-stat grid + standalone risk block from the older
// hero. Two items on one line:
//   • Cash available (editable affordance — the one user-mutable
//     figure on the hero)
//   • Risk score + interpretation (collapsed to one sentence; the
//     Intelligence page now carries the full Risk Surface with five
//     dimensions, so the deep read lives there)
//
// Cost basis + position count moved up into the gain-line context
// where they're more naturally read as part of the headline story.
function _renderHeroContext(data, portfolio) {
  const items = [];

  // Cash available — editable. Renders "—" when unset, with the
  // same edit affordance so the user can establish a value.
  const cashValue = portfolio.cashAvailable != null
    ? formatCurrency(portfolio.cashAvailable)
    : '—';
  items.push(`
    <span class="portfolio-hero-context-item">
      <span class="portfolio-hero-context-label">${t('portfolio.cashAvailable')}</span>
      <span class="portfolio-hero-context-value ${portfolio.cashAvailable == null ? 'is-placeholder' : ''}">${cashValue}</span>
      <button class="icon-btn portfolio-hero-context-edit"
              onclick="openEditPortfolioCashModal('${portfolio.id}')"
              title="${t('action.edit')}"
              aria-label="${t('action.edit')}">${_iconEdit}</button>
    </span>
  `);

  // Risk profile — collapsed to one line. The Intelligence page's
  // Risk Surface carries the per-dimension breakdown, so we keep
  // just the score + the composed interpretation sentence here as
  // a quick read at the portfolio level.
  const risk = computeRiskProfile(portfolio, data.entries || []);
  if (risk) {
    const tmpl = t('risk.interpretation.template');
    const interp = tmpl
      .replace('{tier}', t(risk.interpretation.tierKey))
      .replace('{vol}',  t(risk.interpretation.volKey))
      .replace('{div}',  t(risk.interpretation.divKey));
    items.push(`
      <span class="portfolio-hero-context-item">
        <span class="portfolio-hero-context-label">${t('portfolio.riskScore')}</span>
        <span class="portfolio-hero-context-value">${risk.score.toFixed(1)} / 10</span>
        <span class="portfolio-hero-context-sub">${interp}</span>
      </span>
    `);
  }

  return `<div class="portfolio-hero-context">${items.join('')}</div>`;
}

// Maps portfolio.type → readable header sublabel. Reaches into a
// small dict so today's 'self_managed' shows "Self-managed brokerage"
// and any future types can be added without touching the renderer.
function _portfolioSublabel(portfolio) {
  if (portfolio.type) {
    const key = 'portfolio.type.' + portfolio.type;
    const label = t(key);
    if (label !== key) return label;
  }
  return t('portfolio.label');
}

function _renderPortfolioHoldings(holdings, portfolio) {
  if (holdings.length === 0) return '';

  // Split into primary (top N by value) and tail. The split only
  // matters for v2 visual behavior — the JSX still renders every
  // row so v1 keeps the full list visible. Keys are namespaced per
  // portfolio so each one remembers its own state.
  const top  = holdings.slice(0, PORTFOLIO_HOLDINGS_TOP_N);
  const tail = holdings.slice(PORTFOLIO_HOLDINGS_TOP_N);

  const storageKey = `assets.portfolio.${portfolio.id}.holdings`;
  const tailOpen   = isExpanded(storageKey, false);
  const hasTail    = tail.length > 0;

  const topHtml  = top.map(h => _renderHoldingRow(h, portfolio)).join('');
  const tailHtml = tail.map(h => _renderHoldingRow(h, portfolio)).join('');

  // The tail wrapper carries the expansion state; v1 ignores
  // .is-expanded (no v1 CSS rule reads it) and renders the rows
  // unconditionally because v1 has no v2 disclosure CSS.
  const tailBlock = hasTail
    ? `
      <div class="portfolio-holdings-tail${tailOpen ? ' is-expanded' : ''}"
           data-portfolio-tail="${portfolio.id}"
           id="portfolio-tail-${portfolio.id}">
        ${tailHtml}
      </div>
      <button class="portfolio-holdings-toggle" type="button"
              onclick="onPortfolioHoldingsToggle('${portfolio.id}')"
              aria-controls="portfolio-tail-${portfolio.id}"
              aria-expanded="${tailOpen ? 'true' : 'false'}">
        <span class="portfolio-holdings-toggle-label"
              data-label-expanded="${t('portfolio.hideHoldings').replace('{n}', tail.length)}"
              data-label-collapsed="${t('portfolio.showAllHoldings').replace('{n}', tail.length)}">${
                tailOpen
                  ? t('portfolio.hideHoldings').replace('{n}', tail.length)
                  : t('portfolio.showAllHoldings').replace('{n}', tail.length)
              }</span>
        <span class="portfolio-holdings-toggle-chev" aria-hidden="true">▾</span>
      </button>`
    : '';

  return `
    <div class="portfolio-holdings" data-portfolio-holdings="${portfolio.id}">
      <div class="portfolio-holdings-header">
        <span class="portfolio-holdings-title">${t('portfolio.holdings')}</span>
        <span class="portfolio-holdings-count">${holdings.length}</span>
      </div>
      <div class="holding-row-list">
        ${topHtml}
      </div>
      ${tailBlock}
    </div>
  `;
}

// Holding row — premium two-line composition for IBI portfolio
// holdings. Renders as a 2-column grid (mark + body); the body
// itself is two flex rows, each `justify-content: space-between`:
//
//   Line 1 (primary):    name ........................ value
//   Line 2 (secondary):  ticker · type · qty ... +gain pct%   alloc%
//
// The unified grouping addresses the "metrics floating off to the
// left" visual disconnect from the previous layout, and the stable
// meta-token order (ticker → type → qty) makes rows scannable even
// when some tokens are absent.
//
// RTL: every numeric token is direction:ltr + unicode-bidi:isolate
// so percent signs, currency symbols, and ticker tokens render in
// correct order regardless of the row's overall reading direction.
// The flex space-between handles Hebrew/English flow automatically.
function _renderHoldingRow(entry, portfolio) {
  const value = entryValue(entry);

  // ── Tag slot ─────────────────────────────────────────────────
  const tag = entry.isPlaceholder
    ? `<span class="holding-row-tag">${t('assets.placeholder')}</span>`
    : '';

  // ── Info-icon tooltip (hover on desktop, tap on touch) ───────
  // See js/components/holding-info-modal.js predecessor → now pure
  // CSS hover via js/app.js's toggleHoldingTooltip for the tap path.
  const desc = getHoldingDescription(entry);
  let infoBtn = '';
  if (desc) {
    const tipText = currentLang === 'he' ? desc.he : desc.en;
    const tipDir  = currentLang === 'he' ? 'rtl' : 'ltr';
    const tipLang = currentLang === 'he' ? 'he' : 'en';
    const tipId   = `holding-tip-${entry.id}`;
    infoBtn = `
      <span class="holding-info-wrap">
        <button class="icon-btn holding-info-btn"
                type="button"
                aria-describedby="${tipId}"
                aria-label="${t('holdingInfo.tooltip')}"
                onclick="toggleHoldingTooltip(this)">${_iconInfo}</button>
        <span class="holding-info-tip"
              id="${tipId}"
              role="tooltip"
              dir="${tipDir}"
              lang="${tipLang}">${_esc(tipText)}</span>
      </span>
    `;
  }

  // ── Mark dot (allocation-category color for visual continuity
  //    with the donut chart). Empty placeholder keeps the column
  //    width consistent across rows whose holding has no category. ─
  const category = typeof categorizeHolding === 'function' ? categorizeHolding(entry) : null;
  const mark = category
    ? `<span class="holding-row-dot" style="background: ${category.color}"></span>`
    : `<span class="holding-row-dot holding-row-dot--empty"></span>`;

  // ── Meta tokens (stable order: ticker → type → qty) ──────────
  // Each token is a span so we can style the ticker distinctly and
  // bidi-isolate the LTR numerics. Joined with a styled separator
  // span instead of a literal " · " so the separator's color isn't
  // tied to the text content's color.
  const metaTokens = [];
  if (entry.ticker) {
    metaTokens.push(`<span class="meta-ticker"><bdi>${_esc(entry.ticker)}</bdi></span>`);
  }
  if (!_nameRepeatsType(entry)) {
    metaTokens.push(`<span class="meta-type">${typeLabel(entry.type)}</span>`);
  }
  if (entry.quantity) {
    metaTokens.push(`<span class="meta-qty"><bdi>${entry.quantity.toLocaleString('en-US')}</bdi> ${t('assets.units')}</span>`);
  }
  const sep = `<span class="meta-sep" aria-hidden="true"> · </span>`;
  const metaHtml = metaTokens.length > 0
    ? `<span class="holding-row-meta">${metaTokens.join(sep)}</span>`
    : '<span class="holding-row-meta"></span>';

  // ── Performance: gain ₪ · return %, plus allocation ──────────
  // Prefer broker-reported gain/gainPercent. Fall back to
  // currentValue − invested if the broker only sent cost basis.
  let gain    = entry.gain;
  let gainPct = entry.gainPercent;
  if ((gain == null || gainPct == null)
      && entry.invested != null && value != null && entry.invested > 0) {
    if (gain    == null) gain    = value - entry.invested;
    if (gainPct == null) gainPct = ((value - entry.invested) / entry.invested) * 100;
  }

  let returnHtml = '';
  if (gain != null) {
    const cls    = gainClass(gain);
    const sign   = gain >= 0 ? '+' : '−';
    const absStr = formatCurrency(Math.abs(gain));
    const pctHtml = gainPct != null
      ? `<span class="return-pct">${gain >= 0 ? '+' : '−'}${Math.abs(gainPct).toFixed(1)}%</span>`
      : '';
    returnHtml = `
      <span class="holding-row-return ${cls}">
        <span class="return-amount">${sign}${absStr}</span>
        ${pctHtml}
      </span>
    `;
  }

  // Allocation %: prefer broker value, fall back to currentValue /
  // portfolio.totalValue so existing rows show a usable figure even
  // before a re-import. Technical instruments (tax shields) opt out.
  let allocPct = entry.allocationPct;
  if (allocPct == null && portfolio && portfolio.totalValue > 0 && value != null) {
    allocPct = (value / portfolio.totalValue) * 100;
  }
  const allocHtml = (!entry.isTechnical && allocPct != null && allocPct > 0)
    ? `<span class="holding-row-allocation">${allocPct.toFixed(1)}%</span>`
    : '';

  const perfHtml = (returnHtml || allocHtml)
    ? `<span class="holding-row-perf">${returnHtml}${allocHtml}</span>`
    : '<span class="holding-row-perf"></span>';

  return `
    <div class="holding-row holding-row--portfolio" data-entry-id="${entry.id}">
      <div class="holding-row-mark">${mark}</div>
      <div class="holding-row-body">
        <div class="holding-row-line holding-row-line--primary">
          <div class="holding-row-name-line">
            <span class="holding-row-name" title="${_esc(entry.name)}">${entry.name}</span>
            ${infoBtn}
            ${tag}
          </div>
          <span class="holding-row-value">${formatCurrency(value)}</span>
        </div>
        <div class="holding-row-line holding-row-line--secondary">
          ${metaHtml}
          ${perfHtml}
        </div>
      </div>
    </div>
  `;
}

// Tiny escape for title attribute (full name on hover for truncated rows)
function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Standalone invested (MR1 + Investment Gemel) ────────────────

function _renderStandaloneSection(data, entries) {
  const sorted = entries.slice().sort((a, b) => entryValue(b) - entryValue(a));
  return `
    <div class="assets-subsection">
      <div class="assets-subsection-header">
        <span class="assets-subsection-title">${t('assets.otherInvested')}</span>
      </div>
      <div class="holding-row-list">
        ${sorted.map(e => _renderStandaloneRow(data, e)).join('')}
      </div>
    </div>
  `;
}

// Standalone row — same strict grid as portfolio holdings. Mark is
// provider/bank logo when available. "Product" entries (pension,
// study fund, gemels, etc.) route through the shared meta-stack;
// generic entries (family-managed investment fund, single-bank
// stock) keep the original one-line meta with institution + ticker.
function _renderStandaloneRow(data, entry) {
  // Live market quote — when this entry is live-tracked we surface
  // the daily-change pill, a per-share line, and a manual refresh
  // button. entryValue() already returns price × quantity whenever a
  // quote is cached, so the displayed total stays in sync with any
  // aggregate sum without computing it twice here.
  const isLiveTracked = !!(entry.ticker && entry.quantity && STOCK_QUOTES[entry.ticker]);
  const liveQuote = isLiveTracked ? getStockQuote(entry.ticker) : null;
  const value = entryValue(entry);

  // Try the structured meta first; fall back to the legacy one-line
  // composition when this type isn't a "product" we've authored a
  // reassuring headline for.
  const structuredMeta = buildEntryMeta(entry, data);
  const metaHtml = structuredMeta
    ? renderMetaStack(structuredMeta)
    : _legacyMetaLine(data, entry, liveQuote);

  // Family-managed marker as a tag (when applicable)
  const tag = entry.isExternal
    ? `<span class="holding-row-tag">${t('assets.familyManagedShort')}</span>`
    : '';

  // Value cell: a single-line amount for plain entries; the stack
  // variant (with refresh button) the moment the entry is live-tracked,
  // even before the first quote lands — so the user always has a way
  // to trigger a fetch, including when Yahoo failed silently.
  const valueHtml = isLiveTracked
    ? _renderLiveValueStack(value, liveQuote, entry)
    : `
      <div class="holding-row-value">
        <span class="holding-row-amount">${formatCurrency(value)}</span>
        <button class="icon-btn holding-row-edit-btn" onclick="editAmount('${entry.id}')" title="${t('action.edit')}">${_iconEdit}</button>
      </div>
    `;

  return `
    <div class="holding-row" data-entry-id="${entry.id}">
      <div class="holding-row-mark">${_assetsEntryMark(data, entry)}</div>
      <div class="holding-row-info">
        <div class="holding-row-name-line">
          <span class="holding-row-name" title="${_esc(entry.name)}">${entry.name}</span>
          ${tag}
        </div>
        <div class="holding-row-meta">${metaHtml}</div>
      </div>
      ${valueHtml}
    </div>
  `;
}

// Stack the total above a cost-basis gain pill (₪324.12 / +₪45.66
// +16.64%). The pill represents TOTAL return vs the user's original
// purchase cost basis (sum of `entry.lots[]` or `entry.invested`
// fallback), NOT the day's market movement — daily noise isn't
// useful for a long-term tracked position. The visual treatment
// (.holding-row-return + .return-amount + .return-pct) matches the
// IBI portfolio rows so the visual language is consistent.
//
// When cost basis is unknown (no lots, no `invested`), we suppress
// the return pill rather than fall back to a misleading 0% or to
// daily change. The amount, sync, and edit affordances stay either
// way — the sync icon is the only escape hatch when the boot fetch
// fails, so we always render it for live-tracked tickers.
function _renderLiveValueStack(total, quote, entry) {
  const usesCents = quote != null;
  const amountHtml = `<span class="holding-row-amount">${formatCurrency(total, { cents: usesCents })}</span>`;

  let returnHtml = '';
  const gainInfo = calcGainFromCostBasis(entry, total);
  if (gainInfo) {
    const { gain, gainPct } = gainInfo;
    const cls    = gainClass(gain);
    const sign   = gain >= 0 ? '+' : '−';
    const absStr = formatCurrency(Math.abs(gain));
    const pctHtml = gainPct != null
      ? `<span class="return-pct">${gain >= 0 ? '+' : '−'}${Math.abs(gainPct).toFixed(2)}%</span>`
      : '';
    returnHtml = `
      <span class="holding-row-return ${cls}">
        <span class="return-amount">${sign}${absStr}</span>
        ${pctHtml}
      </span>
    `;
  }

  return `
    <div class="holding-row-value holding-row-value--stack">
      ${amountHtml}
      ${returnHtml}
      <div class="holding-row-actions">
        <button class="icon-btn holding-quote-refresh"
                data-ticker="${_esc(entry.ticker)}"
                onclick="refreshStockQuoteManual('${_esc(entry.ticker)}')"
                title="${t('assets.refreshQuote')}"
                aria-label="${t('assets.refreshQuote')}">${_iconSync}</button>
        <button class="icon-btn holding-row-edit-btn"
                onclick="editAmount('${entry.id}')"
                title="${t('action.edit')}">${_iconEdit}</button>
      </div>
    </div>
  `;
}

// Legacy one-line meta — used for standalone invested entries that
// aren't long-term "products" (single stocks, family-managed funds).
// Mirrors the pre-meta-stack composition: type · institution · track
// · ticker · units · per-share (when live) · recurring contribution.
function _legacyMetaLine(data, entry, liveQuote = null) {
  const parts = [];
  if (!_nameRepeatsType(entry)) parts.push(typeLabel(entry.type));
  if (entry.institution) parts.push(entry.institution);

  const trackName = currentLang === 'he'
    ? entry.trackName
    : (entry.trackNameEn || entry.trackName);
  if (trackName) parts.push(trackName);

  if (entry.ticker)   parts.push(`<bdi>${entry.ticker}</bdi>`);
  if (entry.quantity && entry.type === 'stock_portfolio') {
    parts.push(`${entry.quantity.toLocaleString('en-US')} ${t('assets.units')}`);
  }
  if (liveQuote) {
    parts.push(`${formatCurrency(liveQuote.price, { cents: true })} ${t('assets.perShare')}`);
  }

  const recurring = (data.recurring || []).filter(
    r => r.toEntryId === entry.id && r.isActive && r.cycle === 'monthly'
  );
  if (recurring.length > 0) {
    parts.push(`${formatCurrency(recurring[0].amount)}${t('assets.perMonth')}`);
  }

  return parts.join(' · ');
}

// Resolve the row's mark — provider or bank logo when available,
// empty otherwise. The 32px-wide .holding-row-mark wrapper around
// this is in the row's markup, so we return only the inner element.
// Type info is no longer shown as a badge here — it lives in the
// meta line so the mark column stays uniform across all rows.
function _assetsEntryMark(data, entry) {
  const logo = _resolveEntryLogo(data, entry);
  if (logo) {
    return `<div class="provider-mark"><img class="provider-mark-img" src="${logo}" alt="" /></div>`;
  }
  return '';
}

// Pick the most specific logo for an entry — provider first, then
// bank. Returns the path string, or null when neither institution
// has a logo registered.
function _resolveEntryLogo(data, entry) {
  const provider = getProvider(data, entry.providerId);
  if (provider && provider.logo) return provider.logo;

  const bank = entry.bankId ? getBank(data, entry.bankId) : null;
  if (bank && bank.logo) return bank.logo;

  return null;
}

// Whether the row's left mark is a logo (vs the type badge). Used to
// decide whether the type label should also be surfaced in the meta
// line — the badge already names the type, so a logo replacement
// silently drops that information unless we put it back in meta.
function _markIsLogo(data, entry) {
  return _resolveEntryLogo(data, entry) !== null;
}

// Whether the entry's name already conveys the type (e.g. an entry
// named "קרן השתלמות" with type 'study_fund' — the type label
// "קרן השתלמות" would just repeat the name). Compares against both
// languages' type labels so the dedup is language-agnostic.
function _nameRepeatsType(entry) {
  const heLabel = (TRANSLATIONS.he && TRANSLATIONS.he['type.' + entry.type] || '').trim();
  const enLabel = (TRANSLATIONS.en && TRANSLATIONS.en['type.' + entry.type] || '').trim();
  const name    = (entry.name || '').trim();
  return name === heLabel || name === enLabel;
}
