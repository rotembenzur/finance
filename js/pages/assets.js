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
  formatCurrency, formatNumber, formatPercent,
  _iconSync, _iconPortfolio, _iconEdit, _iconInfo,
} from '../utils.js';
import { buildEntryMeta, renderMetaStack } from '../components/asset-meta.js';
import { getStockQuote, STOCK_QUOTES } from '../stock-quotes.js';
import { computeRiskProfile } from '../risk-model.js';

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

// ── Allocation chart (donut + legend) ────────────────────────────

function _renderAllocation(data, portfolio) {
  const allocation = buildPortfolioAllocation(data, portfolio.id);
  if (allocation.segments.length === 0) return '';

  return `
    <div class="allocation">
      <div class="allocation-header">
        <span class="allocation-title">${t('allocation.title')}</span>
      </div>
      <div class="allocation-body">
        ${_renderAllocationDonut(allocation)}
        ${_renderAllocationLegend(allocation)}
      </div>
    </div>
  `;
}

// SVG donut. One <circle> per segment, positioned around the ring
// using stroke-dasharray for arc length and stroke-dashoffset to
// stack each segment after the previous one. Rotated -90° so the
// first segment starts at 12 o'clock.
function _renderAllocationDonut(allocation) {
  const size         = 160;
  const radius       = 60;
  const strokeWidth  = 14;
  const cx           = size / 2;
  const cy           = size / 2;
  const C            = 2 * Math.PI * radius;

  let cumulative = 0;
  const segments = allocation.segments.map(s => {
    const arcLength = (s.pct / 100) * C;
    const offset    = -cumulative;
    cumulative += arcLength;
    return `
      <circle
        class="allocation-segment"
        data-segment="${s.category.id}"
        cx="${cx}" cy="${cy}" r="${radius}"
        stroke="${s.category.color}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${arcLength.toFixed(2)} ${(C - arcLength).toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}"
        fill="none"
      />
    `;
  }).join('');

  return `
    <svg class="allocation-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <g transform="rotate(-90 ${cx} ${cy})">
        ${segments}
      </g>
    </svg>
  `;
}

function _renderAllocationLegend(allocation) {
  return `
    <div class="allocation-legend">
      ${allocation.segments.map(s => {
        const tickers = s.holdings
          .map(h => h.ticker || h.name)
          .join(' · ');
        return `
          <div class="allocation-row"
               data-segment="${s.category.id}"
               onmouseenter="highlightAllocationSegment('${s.category.id}')"
               onmouseleave="clearAllocationHighlight()">
            <span class="allocation-dot" style="background: ${s.category.color}"></span>
            <div class="allocation-row-info">
              <div class="allocation-row-top">
                <span class="allocation-row-name">${t(s.category.nameKey)}</span>
                <span class="allocation-row-value">${formatCurrency(s.value)}</span>
              </div>
              <div class="allocation-row-bottom">
                <span class="allocation-row-holdings">${tickers}</span>
                <span class="allocation-row-pct">${s.pct.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Hover handlers — global so the inline onmouseenter/onmouseleave
// attributes survive every init() re-render without rewiring.
export function highlightAllocationSegment(id) {
  document.querySelectorAll('.allocation-segment').forEach(seg => {
    seg.classList.toggle('is-dimmed', seg.dataset.segment !== id);
  });
  document.querySelectorAll('.allocation-row').forEach(row => {
    row.classList.toggle('is-dimmed', row.dataset.segment !== id);
  });
}

export function clearAllocationHighlight() {
  document.querySelectorAll('.allocation-segment, .allocation-row').forEach(el => {
    el.classList.remove('is-dimmed');
  });
}

// Hero section — three composed tiers:
//
//   1. Header band  — logo + name + type-derived sublabel + sync
//                     chip, all on a single baseline above a
//                     hairline divider. Logo is part of the
//                     identity, not a floating corner ornament.
//
//   2. Headline    — ₪value (the biggest, calmest moment) and a
//                     composite gain line directly below it:
//                     "↑ ₪16,829 · +8.3% · lifetime". The gain is
//                     read AS PART OF the value, not as a separate
//                     stat — that's the primary story.
//
//   3. Stats grid  — three columns with identical label/value/sub
//                     anatomy: Cost basis, Cash available, Risk
//                     profile. Risk gets a contextual descriptor
//                     ("Growth"/"Balanced"/etc.) so the number has
//                     meaning. Same rhythm as the cards-hero strip,
//                     so the design language carries across pages.
//
// Daily P/L stays out — this is long-term capital, not trading.
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
        ${_renderHeroGain(gain, gainPct)}
      </div>

      ${_renderHeroStats(portfolio, invested, positions)}
      ${_renderRiskProfile(data, portfolio)}

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
// + context. Bound to the headline, not the supporting stats grid.
function _renderHeroGain(gain, gainPct) {
  if (gain == null || gainPct == null) return '';
  const cls    = gainClass(gain);
  const arrow  = gain > 0 ? '↑' : gain < 0 ? '↓' : '·';
  const sign   = gain >= 0 ? '+' : '−';
  return `
    <div class="portfolio-hero-gain ${cls}">
      <span class="portfolio-hero-gain-arrow" aria-hidden="true">${arrow}</span>
      <span class="portfolio-hero-gain-amount">${formatCurrency(Math.abs(gain))}</span>
      <span class="portfolio-hero-gain-sep" aria-hidden="true">·</span>
      <span class="portfolio-hero-gain-pct">${sign}${Math.abs(gainPct).toFixed(1)}%</span>
      <span class="portfolio-hero-gain-sep" aria-hidden="true">·</span>
      <span class="portfolio-hero-gain-context">${t('portfolio.lifetime')}</span>
    </div>
  `;
}

// Three-column supporting-stats grid. Cost basis, Cash available,
// Risk profile — each with label / value / sub anatomy. Cells with
// no data drop out cleanly; if fewer than three are present the
// remaining columns close ranks (1fr each).
function _renderHeroStats(portfolio, invested, positions) {
  const stats = [];

  if (invested != null) {
    const positionWord = positions === 1
      ? t('portfolio.acrossPosition')
      : t('portfolio.acrossPositions');
    stats.push({
      label: t('portfolio.costBasis'),
      value: formatCurrency(invested),
      sub:   `${positions} ${positionWord}`,
    });
  }

  // Cash available is the one user-mutable figure on the hero — the
  // user adjusts it manually between broker syncs. Other stats here
  // (cost basis, risk score) come from data the user doesn't enter
  // by hand, so only this one carries an edit affordance.
  if (portfolio.cashAvailable != null) {
    stats.push({
      label: t('portfolio.cashAvailable'),
      value: formatCurrency(portfolio.cashAvailable),
      sub:   t('portfolio.uninvested'),
      editOnClick: `openEditPortfolioCashModal('${portfolio.id}')`,
    });
  } else {
    // Even with no current value, give the user a way to set one —
    // a small "Set" affordance in place of the missing stat.
    stats.push({
      label:       t('portfolio.cashAvailable'),
      value:       '—',
      sub:         t('portfolio.setCash'),
      editOnClick: `openEditPortfolioCashModal('${portfolio.id}')`,
      placeholder: true,
    });
  }

  // Risk profile no longer lives in the 3-up stats grid — it gets
  // its own block below (_renderRiskProfile) so the band label,
  // factor chips, and age-aware summary have room to breathe.

  if (stats.length === 0) return '';

  return `
    <div class="portfolio-hero-stats" style="--portfolio-hero-stat-count: ${stats.length}">
      ${stats.map(s => `
        <div class="portfolio-hero-stat ${s.placeholder ? 'is-placeholder' : ''} ${s.editOnClick ? 'is-editable' : ''}">
          <span class="portfolio-hero-stat-label">${s.label}</span>
          <span class="portfolio-hero-stat-value-line">
            <span class="portfolio-hero-stat-value">${s.value}</span>
            ${s.editOnClick ? `
              <button class="portfolio-hero-stat-edit icon-btn"
                      onclick="${s.editOnClick}"
                      title="${t('action.edit')}"
                      aria-label="${t('action.edit')}">${_iconEdit}</button>
            ` : ''}
          </span>
          <span class="portfolio-hero-stat-sub">${s.sub}</span>
        </div>
      `).join('')}
    </div>
  `;
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

// ── Risk profile block ────────────────────────────────────────────
//
// Standalone block beneath the stats grid. Composition:
//
//   [Band label] · [score/10] · [pencil edit DOB]
//   [chip] [chip] [chip] ...                ← factor tokens
//   One-line age-aware summary
//
// When DOB is missing we render the band + chips anyway (composition
// alone is enough) and replace the summary line with a CTA that
// prompts for date of birth, so the user can opt into the age-
// adjusted reading without us hiding the rest of the analysis.
function _renderRiskProfile(data, portfolio) {
  const profile = computeRiskProfile(portfolio, data.entries || [], data.meta || {});
  if (!profile) return '';

  const bandLabel = t('portfolio.risk.' + profile.band);

  const chipsHtml = (profile.factors || [])
    .map(f => _renderRiskChip(f))
    .join('');

  let summaryHtml;
  if (profile.horizonKey) {
    const tmpl = t(profile.horizonKey);
    summaryHtml = `<span class="risk-summary">${tmpl.replace('{age}', profile.age)}</span>`;
  } else {
    summaryHtml = `<button class="risk-dob-cta" onclick="editDateOfBirth()">${t('portfolio.risk.dobMissingCta')}</button>`;
  }

  return `
    <div class="portfolio-hero-risk">
      <span class="portfolio-hero-risk-header">
        <span class="portfolio-hero-risk-label">${t('portfolio.riskScore')}</span>
        <span class="portfolio-hero-risk-value-line">
          <span class="portfolio-hero-risk-band">${bandLabel}</span>
          <span class="portfolio-hero-risk-score">${profile.score.toFixed(1)} / 10</span>
          <button class="portfolio-hero-stat-edit icon-btn"
                  onclick="editDateOfBirth()"
                  title="${t('portfolio.risk.dobEdit')}"
                  aria-label="${t('portfolio.risk.dobEdit')}">${_iconEdit}</button>
        </span>
      </span>
      ${chipsHtml ? `<span class="risk-chips">${chipsHtml}</span>` : ''}
      ${summaryHtml}
    </div>
  `;
}

function _renderRiskChip(factor) {
  // Each factor key is either bare (no params) or carries {value} +
  // optionally {name}. We resolve the i18n string and interpolate.
  let text = t(factor.key);
  if (factor.value != null) text = text.replace('{value}', factor.value);
  if (factor.holdingName)   text = text.replace('{name}',  factor.holdingName);
  return `<span class="risk-chip risk-chip--${factor.kind || 'neutral'}">${text}</span>`;
}

function _renderPortfolioHoldings(holdings, portfolio) {
  if (holdings.length === 0) return '';

  return `
    <div class="portfolio-holdings">
      <div class="portfolio-holdings-header">
        <span class="portfolio-holdings-title">${t('portfolio.holdings')}</span>
        <span class="portfolio-holdings-count">${holdings.length}</span>
      </div>
      <div class="holding-row-list">
        ${holdings.map(h => _renderHoldingRow(h, portfolio)).join('')}
      </div>
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

// Stack the total above the daily-change pill (₪324.12 / +0.65%).
// `daily change` uses the same .holding-row-return + sentiment-color
// classes the IBI portfolio holdings use, so the visual language is
// consistent across the page. The edit button stays accessible.
//
// The small sync icon next to edit triggers a force-refresh of this
// ticker's quote — useful when the cached price is up to 15 min old
// and the user wants to see the latest tick on demand. It also acts
// as the only escape hatch when the boot fetch failed (CORS, network)
// and no quote exists yet — so we always render it for live-tracked
// tickers, even when `quote` is null.
function _renderLiveValueStack(total, quote, entry) {
  const usesCents = quote != null;
  const amountHtml = `<span class="holding-row-amount">${formatCurrency(total, { cents: usesCents })}</span>`;

  let pctHtml = '';
  if (quote) {
    const pct  = quote.changePct;
    const cls  = gainClass(pct);
    const sign = pct >= 0 ? '+' : '−';
    pctHtml = `<span class="holding-row-return ${cls}">${sign}${Math.abs(pct).toFixed(2)}%</span>`;
  }

  return `
    <div class="holding-row-value holding-row-value--stack">
      ${amountHtml}
      ${pctHtml}
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
