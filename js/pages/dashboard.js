// ─────────────────────────────────────────────────────────────────
//  HOME — Reading View, organized by life-tier
//
//  Six elements with massive air between them:
//    1. Today's date
//    2. Net worth display
//    3. One-line sentiment (color reserved for here)
//    4. Liquidity stripe — Available / Invested / Future proportions
//    5. Stripe legend
//    6. Four destination rows: Available, Invested, Cards, Future
//
//  The tier classification (vs. the old category-based one) is the
//  organizing principle: how this money exists in daily life, not
//  how an institution classifies it.
//
//  The gray meta line under each row uses the shared meta-stack
//  component (js/components/asset-meta.js): a reassuring headline,
//  a supporting fact, and an optional progress bar.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatToday, formatMilestone } from '../dates.js';
import {
  calcAvailableTotal, calcInvestedTotal, calcFutureWealthTotal,
  calcFutureDepositsTotal, calcCardsOutstanding, calcNetWorth,
  getBankAccountEntries, getCashEntries, getCards,
  getSalary, salaryIsConfigured, nextDepositDate, daysUntilNextDeposit,
  getSalaryDestinationEntry, getBank, getBankDisplayName,
  formatCurrency,
} from '../utils.js';
import { formatRelative } from '../dates.js';
import { buildHomeTierMeta, renderMetaStack } from '../components/asset-meta.js';

export function renderDashboard(data) {
  const netWorth      = calcNetWorth(data);
  const available     = calcAvailableTotal(data);
  const invested      = calcInvestedTotal(data);
  const futureWealth  = calcFutureWealthTotal(data);
  const futureDep     = calcFutureDepositsTotal(data);
  const cardsOut      = calcCardsOutstanding(data);

  // Liquidity stripe — 4 segments now: Available / Invested /
  // Future Wealth / Future Deposits. Mental tiers, not regulatory.
  const totalAssets = available + invested + futureWealth + futureDep;
  const availPct    = totalAssets ? (available    / totalAssets) * 100 : 0;
  const invPct      = totalAssets ? (invested     / totalAssets) * 100 : 0;
  const fwPct       = totalAssets ? (futureWealth / totalAssets) * 100 : 0;
  const fdPct       = totalAssets ? (futureDep    / totalAssets) * 100 : 0;

  // Per-tier metas — all the cleverness lives inside asset-meta.js;
  // the dashboard's job is to lay them out, not to compute them.
  const availMeta  = renderMetaStack(buildHomeTierMeta('available',        data));
  const invMeta    = renderMetaStack(buildHomeTierMeta('invested',         data));
  const fwMeta     = renderMetaStack(buildHomeTierMeta('future_wealth',    data));
  const fdMeta     = renderMetaStack(buildHomeTierMeta('future_deposits',  data));
  const cardsMeta  = renderMetaStack(buildHomeTierMeta('cards',            data));

  // Salary — its own row at the top of the home-rows list. Renders
  // both the configured and empty states; clicking either opens the
  // edit modal.
  const salaryRowHtml = _renderSalaryRow(data);

  return `
    <section class="section home" id="dashboard">

      <div class="home-top-row">
        <span class="home-date">${formatToday()}</span>
        <button class="btn btn-primary btn-quick-add" onclick="openQuickExpenseModal()" title="${t('quickExpense.button')}">
          <span class="btn-quick-add-plus" aria-hidden="true">+</span>
          <span class="btn-quick-add-label">${t('quickExpense.button')}</span>
        </button>
      </div>

      <span class="home-display-eyebrow">${t('dashboard.netWorth')}</span>
      <h1 class="home-display">${formatCurrency(netWorth)}</h1>

      <div class="liquidity-stripe" role="img" aria-label="${t('home.liquidityBreakdown')}">
        <div class="liquidity-segment liquidity-segment--cash"            style="width: ${availPct}%"></div>
        <div class="liquidity-segment liquidity-segment--invested"        style="width: ${invPct}%"></div>
        <div class="liquidity-segment liquidity-segment--future-wealth"   style="width: ${fwPct}%"></div>
        <div class="liquidity-segment liquidity-segment--future-deposits" style="width: ${fdPct}%"></div>
      </div>
      <div class="liquidity-legend">
        ${_liquidityTile({ tone: 'cash',            label: t('home.available'),      amount: available,    pct: availPct, section: 'accounts' })}
        ${_liquidityTile({ tone: 'invested',        label: t('home.invested'),       amount: invested,     pct: invPct,   section: 'assets' })}
        ${_liquidityTile({ tone: 'future-wealth',   label: t('home.futureWealth'),   amount: futureWealth, pct: fwPct,    section: 'future' })}
        ${futureDep > 0 ? _liquidityTile({ tone: 'future-deposits', label: t('home.futureDeposits'), amount: futureDep, pct: fdPct, section: 'future-deposits' }) : ''}
      </div>

      <div class="home-rows">

        ${salaryRowHtml}

        <button class="home-row" onclick="navigateToSection('accounts')">
          <span class="home-row-label">${t('home.available')}</span>
          <span class="home-row-meta">${availMeta}</span>
          <span class="home-row-value">${formatCurrency(available)}</span>
          <span class="home-row-arrow" aria-hidden="true">→</span>
        </button>

        <button class="home-row" onclick="navigateToSection('assets')">
          <span class="home-row-label">${t('home.invested')}</span>
          <span class="home-row-meta">${invMeta}</span>
          <span class="home-row-value">${formatCurrency(invested)}</span>
          <span class="home-row-arrow" aria-hidden="true">→</span>
        </button>

        <button class="home-row" onclick="navigateToSection('future')">
          <span class="home-row-label">${t('home.futureWealth')}</span>
          <span class="home-row-meta">${fwMeta}</span>
          <span class="home-row-value">${formatCurrency(futureWealth)}</span>
          <span class="home-row-arrow" aria-hidden="true">→</span>
        </button>

        ${futureDep > 0 ? `
          <button class="home-row" onclick="navigateToSection('future-deposits')">
            <span class="home-row-label">${t('home.futureDeposits')}</span>
            <span class="home-row-meta">${fdMeta}</span>
            <span class="home-row-value">${formatCurrency(futureDep)}</span>
            <span class="home-row-arrow" aria-hidden="true">→</span>
          </button>
        ` : ''}

      </div>

      ${cardsOut > 0 ? `
        <div class="home-obligations">
          <button class="home-row home-row--obligation" onclick="navigateToSection('cards')">
            <span class="home-row-label">${t('home.cards')}</span>
            <span class="home-row-meta">${cardsMeta}</span>
            <span class="home-row-value home-row-value--owed">${formatCurrency(-cardsOut)}</span>
            <span class="home-row-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      ` : ''}

    </section>
  `;
}

// ─────────────────────────────────────────
//  LIQUIDITY TILE
//  Structured markup so desktop can flow the
//  pieces inline (label · value, pct hidden)
//  while mobile composes them as a 2×2 tile
//  grid. One renderer, two layouts.
// ─────────────────────────────────────────

function _liquidityTile({ tone, label, amount, pct, section }) {
  const pctTxt = pct >= 10 ? Math.round(pct) : pct.toFixed(1);
  // Tile is a real button on mobile (whole surface taps through to
  // the destination section). The duplicate tier rows below the
  // legend are hidden on mobile in mobile.css, so the tiles become
  // the only navigation surface for those four destinations.
  return `
    <button type="button" class="liquidity-legend-item liquidity-legend-item--${tone}" onclick="navigateToSection('${section}')">
      <span class="liquidity-dot liquidity-dot--${tone}"></span>
      <span class="liquidity-legend-label">${label}</span>
      <span class="liquidity-legend-value">${formatCurrency(amount)}</span>
      <span class="liquidity-legend-pct">${pctTxt}%</span>
    </button>
  `;
}

// ─────────────────────────────────────────
//  SALARY ROW
//  Renders both the configured and empty
//  states. Visual treatment mirrors the
//  wealth-tier rows below but with a quiet
//  green tint on the amount, matching how
//  Cards-owed gets a red tint — income vs
//  obligation balance.
// ─────────────────────────────────────────

function _renderSalaryRow(data) {
  const salary = getSalary(data);
  const configured = salaryIsConfigured(salary);

  if (!configured) {
    const meta = renderMetaStack({
      headline: t('salary.empty.headline'),
      subline:  t('salary.empty.subline'),
    });
    return `
      <button class="home-row home-row--income home-row--cta" onclick="openEditSalaryModal()">
        <span class="home-row-label">${t('salary.label')}</span>
        <span class="home-row-meta">${meta}</span>
        <span class="home-row-value home-row-value--cta">${t('salary.empty.cta')}</span>
        <span class="home-row-arrow" aria-hidden="true">→</span>
      </button>
    `;
  }

  // Configured — compute "next deposit" headline + destination subline.
  const isoNext = nextDepositDate(salary);
  const days    = daysUntilNextDeposit(salary);
  const dateStr = isoNext ? formatMilestone(isoNext) : '';
  const rel     = formatRelative(days);

  const destEntry = getSalaryDestinationEntry(data, salary);
  const bank      = destEntry && destEntry.bankId ? getBank(data, destEntry.bankId) : null;
  const bankName  = bank ? getBankDisplayName(bank) : (destEntry?.institution || '');
  const destText  = destEntry
    ? (bankName ? `${bankName} · ${destEntry.name}` : destEntry.name)
    : '';

  const employerText = currentLang === 'he'
    ? (salary.employer || salary.employerEn || '')
    : (salary.employerEn || salary.employer || '');

  const sublineParts = [];
  if (destText)     sublineParts.push(destText);
  if (employerText) sublineParts.push(employerText);

  const meta = renderMetaStack({
    headline: rel ? `${t('salary.configured.nextDeposit')} ${rel}` : `${t('salary.configured.nextDeposit')} ${dateStr}`,
    subline:  sublineParts.join(' · '),
    trend:    'up',
  });

  return `
    <button class="home-row home-row--income" onclick="openEditSalaryModal()">
      <span class="home-row-label">${t('salary.label')}</span>
      <span class="home-row-meta">${meta}</span>
      <span class="home-row-value home-row-value--income">${formatCurrency(salary.netAmount)}</span>
      <span class="home-row-arrow" aria-hidden="true">→</span>
    </button>
  `;
}

// `navigateToSection` is now owned by app.js — the entry module
// needs control over it to handle drilldown view transitions before
// scrolling. The inline `onclick="navigateToSection(...)"` calls in
// rendered HTML still resolve via the global bridge attached there.
