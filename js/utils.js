import { currentLang, t, TRANSLATIONS } from './i18n.js';
import { convertToILS } from './fx.js';
import { getStockQuote } from './stock-quotes.js';

// ─────────────────────────────────────────
//  ENTRY HELPERS
// ─────────────────────────────────────────

// The single source of truth for an entry's current value, IN THE
// ENTRY'S OWN CURRENCY. Investments use currentValue; everything
// else uses balance. Per-row UI calls this directly to render the
// native amount (e.g. "$300" for a USD wallet).
//
// When an entry has a live-tracked ticker AND a cached quote, the
// live `price × quantity` overrides the stored currentValue. This
// flows through every aggregate that sums entryValue() — dashboard
// totals, tier subtotals — so the Bank Hapoalim MR1 holding's live
// price moves with the market everywhere it appears.
export function entryValue(entry) {
  if (entry && entry.ticker && entry.quantity) {
    const quote = getStockQuote(entry.ticker);
    if (quote && typeof quote.price === 'number') {
      return quote.price * entry.quantity;
    }
  }
  return entry.currentValue !== null ? entry.currentValue : entry.balance;
}

// Entry value converted to ILS for cross-currency summation. Non-ILS
// entries route through the FX module; if a rate isn't available the
// caller sees null and decides whether to skip the entry. Sum helpers
// in this file all coerce nulls to 0 so a missing rate just means
// that entry's contribution is temporarily 0 in the headline figure
// — not a render-breaking NaN.
export function entryValueILS(entry, data) {
  const raw = entryValue(entry);
  if (!Number.isFinite(raw)) return null;
  const code = entry.currency || 'ILS';
  if (code === 'ILS') return raw;
  return convertToILS(raw, code, data);
}

// ─────────────────────────────────────────
//  ENTRY FILTERS  (return arrays)
//
//  Two classifications coexist:
//    `category` — structural (liquid / semi_liquid / non_liquid). Rarely changes.
//    `tier`     — mental model (available / invested / future). Can shift over time.
//
//  Almost all UX-facing logic should ask about `tier`. `category` is
//  kept for regulatory/structural questions (and as a future input
//  to `effectiveTier()` once we add date-based tier promotion).
// ─────────────────────────────────────────

// ─── By tier (the user-facing classification) ──────────────────

export function getAvailableEntries(data) {
  return data.entries.filter(e => e.tier === 'available' && e.isActive && !e.isLiability);
}

export function getInvestedEntries(data) {
  return data.entries.filter(e => e.tier === 'invested' && e.isActive && !e.isLiability);
}

// Future tier split into two distinct concepts:
//   future_wealth   — retirement-oriented compounding (pensions, gemels,
//                     study fund, Investment Gemel)
//   future_deposits — locked money with a known release date
//                     (military discharge deposit, etc.)
export function getFutureWealthEntries(data) {
  return data.entries.filter(e => e.tier === 'future_wealth' && e.isActive && !e.isLiability);
}

export function getFutureDepositsEntries(data) {
  return data.entries.filter(e => e.tier === 'future_deposits' && e.isActive && !e.isLiability);
}

// Combined future-style entries (any tier starting with `future`).
// Kept for code paths that don't care about the split.
export function getFutureEntries(data) {
  return data.entries.filter(e =>
    (e.tier === 'future_wealth' || e.tier === 'future_deposits' || e.tier === 'future')
    && e.isActive && !e.isLiability
  );
}

// Standalone invested = invested-tier entries not part of a portfolio.
// Currently MR1 (bank-held single stock) and the Altshuler Investment Gemel.
export function getStandaloneInvested(data) {
  return getInvestedEntries(data).filter(e => !e.portfolioId);
}

// ─── By "shape" within the Available tier ──────────────────────

export function isCashEntry(entry) {
  return entry.type === 'cash' || entry.isCash === true;
}

export function getCashEntries(data) {
  return getAvailableEntries(data).filter(isCashEntry);
}

// Bank/wallet accounts — Available entries that aren't physical cash.
// Now includes the discharge savings (because it's tier='available'),
// which has bankId='hapoalim' and renders inside the Hapoalim group.
export function getBankAccountEntries(data) {
  return getAvailableEntries(data).filter(e => !isCashEntry(e));
}

export function getLiabilityEntries(data) {
  return data.entries.filter(e => e.isLiability && e.isActive);
}

// ─────────────────────────────────────────
//  TOTALS
// ─────────────────────────────────────────

export function calcAvailableTotal(data) {
  return getAvailableEntries(data).reduce(
    (sum, e) => sum + (entryValueILS(e, data) || 0),
    0,
  );
}

// "Available" net of pending credit-card charges. Money that has been
// spent on a credit card but not yet billed is no longer truly liquid
// — it's committed and will leave the account on the next billing
// date. So any figure that claims to be "available / ready to use"
// should subtract it. Net worth already accounts for this separately
// (see calcNetWorth), so do NOT feed this into net-worth math.
export function calcAvailableNet(data) {
  return calcAvailableTotal(data) - calcCardsOutstanding(data);
}

export function calcInvestedTotal(data) {
  return getInvestedEntries(data).reduce((sum, e) => sum + entryValue(e), 0);
}

export function calcFutureWealthTotal(data) {
  return getFutureWealthEntries(data).reduce((sum, e) => sum + entryValue(e), 0);
}

export function calcFutureDepositsTotal(data) {
  return getFutureDepositsEntries(data).reduce((sum, e) => sum + entryValue(e), 0);
}

export function calcFutureTotal(data) {
  return calcFutureWealthTotal(data) + calcFutureDepositsTotal(data);
}

export function calcCashTotal(data) {
  return getCashEntries(data).reduce(
    (sum, e) => sum + (entryValueILS(e, data) || 0),
    0,
  );
}

export function calcLiabilitiesTotal(data) {
  return getLiabilityEntries(data).reduce((sum, e) => sum + entryValue(e), 0);
}

export function calcCardsOutstanding(data) {
  if (!data.cards) return 0;
  return data.cards
    .filter(c => c.isActive && !c.isDebit)
    .reduce((sum, c) => sum + calcCardPendingCharges(c), 0);
}

// Pending billing total across every active credit card linked to a
// specific bank (by card.bankId). Used by the Accounts page to show
// each checking account's projected balance once the current billing
// cycle settles. Cards with no bankId (international / MAX cards not
// pinned to a specific Israeli bank) are excluded — they don't debit
// from any particular checking account, so they shouldn't reduce any
// account's projected balance.
export function calcCardChargesForBank(data, bankId) {
  if (!data || !data.cards || !bankId) return 0;
  return data.cards
    .filter(c => c.isActive && !c.isDebit && c.bankId === bankId)
    .reduce((sum, c) => sum + calcCardPendingCharges(c), 0);
}

// "Pending billing" total for a single credit card. Sums only the
// charges dated within the current billing cycle — between the
// previous billing date (inclusive) and the upcoming billing date
// (exclusive). Past cycles' charges, which have already been
// charged from the bank account, are excluded.
//
// Falls back to the stored `card.currentSpending` only when the
// card has no charges array at all — i.e., a manual-entry card
// the user populated by typing a number. Imports (Isracard, Max,
// Hapoalim) and the quick-expense modal all populate `charges[]`,
// so once any history exists this helper is the source of truth.
//
// Convention: half-open window `[prevBillingDate, nextBillingDate)`.
// Charges on the previous billing date count as the new cycle
// (the previous cycle settled that day); charges on the next
// billing date belong to the cycle after the current one.
// Undated charges are assumed current — quick-expense entries
// typically lack a date.
export function calcCardPendingCharges(card, refDate) {
  if (!card || card.isDebit) return 0;

  const charges = Array.isArray(card.charges) ? card.charges : [];
  if (charges.length === 0) {
    return Number(card.currentSpending) || 0;
  }

  const win = _cardBillingWindow(card, refDate || new Date());

  // Refunds (charges with direction='in') reduce the pending total
  // because the merchant credits the card. Treat each charge as a
  // signed contribution: expenses add, refunds subtract. Legacy
  // charges have no `direction` field and are implicitly 'out'.
  const signedAmount = c => {
    const amt = Number(c.amount) || 0;
    return c.direction === 'in' ? -amt : amt;
  };

  if (!win) {
    // No billingDay or nextBilling on the card — can't compute a window.
    // Conservative fallback: sum every charge with the direction sign
    // applied (matches the prior all-time behaviour rather than
    // silently zeroing out, but still respects refunds).
    return charges.reduce((s, c) => s + signedAmount(c), 0);
  }

  const { prevISO, nextISO } = win;
  return charges.reduce((s, c) => {
    if (!c.date) return s + signedAmount(c);
    const d = String(c.date).slice(0, 10); // tolerate ISO timestamps
    return (d >= prevISO && d < nextISO) ? s + signedAmount(c) : s;
  }, 0);
}

// Compute the half-open current billing window for a card. Uses
// `card.billingDay` first (it doesn't go stale); falls back to
// the day component of `card.nextBilling`. Returns ISO date
// strings or null when neither field is set.
function _cardBillingWindow(card, refDate) {
  let day = card.billingDay;
  if (!Number.isFinite(day) && card.nextBilling) {
    const m = String(card.nextBilling).match(/^\d{4}-\d{2}-(\d{2})$/);
    if (m) day = Number(m[1]);
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  // Next billing = this month's `day` if today is still before it,
  // else next month's `day`. End-of-month clamps (Feb 30 → Feb 28/29).
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  let nextY = today.getFullYear();
  let nextM = today.getMonth();
  if (today.getDate() >= day) nextM += 1;
  const nextLastDay = new Date(nextY, nextM + 1, 0).getDate();
  const next = new Date(nextY, nextM, Math.min(day, nextLastDay));

  // Previous billing = one calendar month back from next.
  let prevY = next.getFullYear();
  let prevM = next.getMonth() - 1;
  if (prevM < 0) { prevM = 11; prevY -= 1; }
  const prevLastDay = new Date(prevY, prevM + 1, 0).getDate();
  const prev = new Date(prevY, prevM, Math.min(day, prevLastDay));

  return { prevISO: _isoOf(next, prev).prev, nextISO: _isoOf(next, prev).next };
}

function _isoOf(next, prev) {
  const fmt = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  return { next: fmt(next), prev: fmt(prev) };
}

export function calcNetWorth(data) {
  const assets = calcAvailableTotal(data) + calcInvestedTotal(data) + calcFutureTotal(data);
  return assets - calcLiabilitiesTotal(data) - calcCardsOutstanding(data);
}

// ─────────────────────────────────────────
//  INVESTMENT GAIN / LOSS
// ─────────────────────────────────────────

// Cost basis: portfolio.totalInvested is authoritative for portfolio holdings;
// standalone Invested-tier entries fall back to entry.invested.
// Returns null if neither has data.
export function calcTotalInvested(data) {
  const portfolioInvested = (data.portfolios || [])
    .filter(p => p.isActive !== false && p.totalInvested != null)
    .reduce((sum, p) => sum + p.totalInvested, 0);

  const standaloneInvested = getStandaloneInvested(data)
    .filter(e => e.invested != null)
    .reduce((sum, e) => sum + e.invested, 0);

  const hasData = (data.portfolios || []).some(p => p.isActive !== false && p.totalInvested != null) ||
                  getStandaloneInvested(data).some(e => e.invested != null);

  return hasData ? portfolioInvested + standaloneInvested : null;
}

// Gain calculation matches scope: portfolio totals for portfolio holdings,
// per-entry derivation for standalone Invested-tier entries with cost basis.
export function calcTotalGain(data) {
  const portfolioGain = (data.portfolios || [])
    .filter(p => p.isActive !== false && p.totalGain != null)
    .reduce((sum, p) => sum + p.totalGain, 0);

  const standaloneGain = getStandaloneInvested(data)
    .filter(e => e.invested != null)
    .reduce((sum, e) => sum + (entryValue(e) - e.invested), 0);

  const hasData = (data.portfolios || []).some(p => p.isActive !== false && p.totalGain != null) ||
                  getStandaloneInvested(data).some(e => e.invested != null);

  return hasData ? portfolioGain + standaloneGain : null;
}

export function calcTotalGainPercent(data) {
  const invested = calcTotalInvested(data);
  if (!invested) return null;
  const gain = calcTotalGain(data);
  if (gain === null) return null;
  return (gain / invested) * 100;
}

export function calcEntryGain(entry) {
  if (entry.invested === null) return null;
  return entryValue(entry) - entry.invested;
}

export function calcEntryGainPercent(entry) {
  if (!entry.invested) return null;
  return ((entryValue(entry) - entry.invested) / entry.invested) * 100;
}


// ──────────────────────────────────────────────────────────────────
//  COST-BASIS GAIN/LOSS — reusable, for manually-tracked holdings
//
//  Designed for live-tracked entries that don't have a broker
//  reporting `invested` / `gain` / `gainPercent`. The user enters
//  purchase history as `entry.lots`:
//
//      lots: [
//        { date: '2025-09-19', units: 2, pricePerUnit: 61.84 },
//        { date: '2025-12-19', units: 2, pricePerUnit: 75.35 },
//      ]
//
//  calcCostBasis sums those lots. The fallback chain lets the
//  same helper also work for entries that carry only `invested`
//  (a single aggregate cost). Returns null when neither is set.
//
//  calcGainFromCostBasis compares cost basis to the passed
//  currentValue (typically `entryValue(entry)`, which for
//  live-quoted entries is already price × quantity). It returns
//  null when either side is missing — caller should suppress the
//  gain UI in that case rather than render a misleading 0%.
//
//  Both helpers are intentionally narrow: they DO NOT mutate the
//  entry, DO NOT touch portfolio aggregates, and are safe to call
//  inside hot render paths.
// ──────────────────────────────────────────────────────────────────

export function calcCostBasis(entry) {
  if (entry && Array.isArray(entry.lots) && entry.lots.length > 0) {
    let total = 0;
    let any   = false;
    for (const lot of entry.lots) {
      const units = Number(lot && lot.units);
      const price = Number(lot && lot.pricePerUnit);
      if (Number.isFinite(units) && Number.isFinite(price)) {
        total += units * price;
        any   = true;
      }
    }
    if (any) return total;
  }
  if (entry && typeof entry.invested === 'number' && Number.isFinite(entry.invested)) {
    return entry.invested;
  }
  return null;
}

// Returns { cost, gain, gainPct } or null. gainPct is null when
// cost is exactly 0 (avoid division by zero); gain still resolves.
export function calcGainFromCostBasis(entry, currentValue) {
  if (currentValue == null || !Number.isFinite(currentValue)) return null;
  const cost = calcCostBasis(entry);
  if (cost == null || !Number.isFinite(cost)) return null;
  const gain    = currentValue - cost;
  const gainPct = cost === 0 ? null : (gain / cost) * 100;
  return { cost, gain, gainPct };
}

// ─────────────────────────────────────────
//  RECURRING
// ─────────────────────────────────────────

export function calcMonthlyBurn(data) {
  return data.recurring
    .filter(r => r.isActive)
    .reduce((sum, r) => {
      if (r.cycle === 'monthly') return sum + r.amount;
      if (r.cycle === 'yearly')  return sum + r.amount / 12;
      if (r.cycle === 'weekly')  return sum + r.amount * 4.33;
      return sum;
    }, 0);
}

// ─────────────────────────────────────────
//  CURRENCY
// ─────────────────────────────────────────

// `opts.cents` keeps two decimal places — used for transaction-level
// amounts (charges, line items) where rounding to whole shekels would
// lose meaningful precision. Default behaviour is unchanged.
export function formatCurrency(amount, opts = {}) {
  const abs = Math.abs(amount);
  const digits = opts.cents ? 2 : 0;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (amount < 0 ? '-₪' : '₪') + formatted;
}

export function formatNumber(amount) {
  return Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatCurrencyCompact(amount) {
  const abs = Math.abs(amount);
  let compact;
  if (abs >= 1_000_000) {
    compact = (abs / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  } else if (abs >= 10_000) {
    compact = Math.round(abs / 1_000) + 'K';
  } else if (abs >= 1_000) {
    // Sub-10K values keep one decimal: ₪2,214 → ₪2.2K (vs ₪2K, which loses meaningful precision)
    compact = (abs / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  } else {
    compact = Math.round(abs).toString();
  }
  return (amount < 0 ? '-₪' : '₪') + compact;
}

// ─────────────────────────────────────────
//  PERCENTAGES
// ─────────────────────────────────────────

export function formatPercent(value, decimals = 1) {
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(decimals) + '%';
}

// ─────────────────────────────────────────
//  DATES
// ─────────────────────────────────────────

// Date formatting moved to js/dates.js. Use the semantic helpers
// (formatMilestone, formatReportDate, formatCardExpiry, formatRelative,
// formatToday) instead of generic formatDate/formatDateShort/formatDateLong.

// ─────────────────────────────────────────
//  CSS CLASS HELPERS
// ─────────────────────────────────────────

export function gainClass(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

// Returns the badge modifier class for a given entry type
export function typeBadgeClass(type) {
  const map = {
    checking:         'badge--blue',
    savings:          'badge--green',
    cash:             'badge--green',
    digital_wallet:   'badge--neutral',
    foreign_cash:     'badge--gold',
    investment_fund:  'badge--blue',
    stock_portfolio:  'badge--blue',
    etf:              'badge--blue',
    cash_position:    'badge--neutral',
    crypto:           'badge--gold',
    bond:             'badge--neutral',
    deposit:          'badge--green',
    study_fund:       'badge--green',
    provident_fund:   'badge--green',
    pension:          'badge--neutral',
    military_deposit: 'badge--neutral',
    family_savings:   'badge--green',
  };
  return map[type] || 'badge--neutral';
}

// Returns the inline-start border class for an account card
export function accountCardClass(entry) {
  if (entry.tags && entry.tags.includes('emergency')) return 'account-card--emergency';
  if (entry.type === 'checking')       return 'account-card--checking';
  if (entry.type === 'savings')        return 'account-card--savings';
  if (entry.type === 'digital_wallet') return 'account-card--wallet';
  return '';
}

// ─────────────────────────────────────────
//  DISPLAY LABELS  (use t() for i18n)
// ─────────────────────────────────────────

export function typeLabel(type) {
  return t('type.' + type) || type;
}

export function categoryLabel(category) {
  return t('category.' + category) || category;
}

// ─────────────────────────────────────────
//  GREETING
// ─────────────────────────────────────────

export function getGreeting(name) {
  const h = new Date().getHours();
  const key = h < 12 ? 'greeting.morning'
            : h < 18 ? 'greeting.afternoon'
            : 'greeting.evening';
  return `${t(key)}, ${name}`;
}

// ─────────────────────────────────────────
//  BANK HELPERS
// ─────────────────────────────────────────

export function getBanks(data) {
  return (data.banks || []).slice().sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
}

export function getBank(data, bankId) {
  return (data.banks || []).find(b => b.id === bankId) || null;
}

// Provider registry lookup. Returns null when no provider is set
// or the registry doesn't contain a match — callers fall back to
// the type badge.
export function getProvider(data, providerId) {
  if (!providerId) return null;
  return (data.providers || []).find(p => p.id === providerId) || null;
}

export function getProviderDisplayName(provider) {
  if (!provider) return '';
  return typeof currentLang !== 'undefined' && currentLang === 'he'
    ? provider.name
    : provider.nameEn;
}

// Available-tier entries belonging to a specific bank. Used by the
// Available page's bank-grouped layout.
export function getBankLiquidEntries(data, bankId) {
  return getAvailableEntries(data).filter(e => e.bankId === bankId);
}

export function getBankDisplayName(bank) {
  return typeof currentLang !== 'undefined' && currentLang === 'he' ? bank.name : bank.nameEn;
}

// Generic language-aware name: works for any entity that has both
// `name` (Hebrew) and `nameEn` (English).
export function getDisplayName(entity) {
  if (!entity) return '';
  return typeof currentLang !== 'undefined' && currentLang === 'he'
    ? (entity.name || entity.nameEn || '')
    : (entity.nameEn || entity.name || '');
}

// ─────────────────────────────────────────
//  PORTFOLIO HELPERS
// ─────────────────────────────────────────

export function getPortfolios(data) {
  return (data.portfolios || []).filter(p => p.isActive !== false);
}

export function getPortfolio(data, portfolioId) {
  return (data.portfolios || []).find(p => p.id === portfolioId) || null;
}

export function getPortfolioHoldings(data, portfolioId) {
  // Excludes technical instruments (tax shields, system positions).
  // Those are tracked in the data for completeness but not surfaced
  // as real holdings — they don't represent investable exposure.
  return data.entries.filter(e =>
    e.portfolioId === portfolioId
      && e.isActive
      && !e.isLiability
      && !e.isTechnical
  );
}

// Display name respecting current language (Hebrew prefers `name`).
export function getPortfolioDisplayName(portfolio) {
  return typeof currentLang !== 'undefined' && currentLang === 'he'
    ? portfolio.name
    : portfolio.nameEn;
}

// Sum of holdings — used when broker total isn't stored.
export function calcPortfolioCurrentValue(data, portfolioId) {
  return getPortfolioHoldings(data, portfolioId)
    .reduce((sum, e) => sum + entryValue(e), 0);
}

// All active recurring obligations targeting a given entry.
// Used by long-term rows to surface "₪X/mo" meta.
export function getRecurringForEntry(data, entryId) {
  return (data.recurring || []).filter(
    r => r.toEntryId === entryId && r.isActive
  );
}

// ─────────────────────────────────────────
//  CARD HELPERS
// ─────────────────────────────────────────

export function getCards(data) {
  return (data.cards || []).filter(c => c.isActive);
}

export function calcDaysUntil(dateString) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateString + 'T00:00:00');
  const diff = target - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─────────────────────────────────────────
//  SALARY (monthly income)
// ─────────────────────────────────────────

export function getSalary(data) {
  return data && data.salary ? data.salary : null;
}

// "Configured" = enough fields set that the UI can show real numbers.
// Employer + notes are optional; netAmount + destination + deposit day
// are the minimum useful set.
export function salaryIsConfigured(salary) {
  if (!salary) return false;
  if (salary.isActive === false) return false;
  return Number.isFinite(salary.netAmount)
      && salary.netAmount > 0
      && !!salary.toEntryId
      && Number.isFinite(salary.depositDay)
      && salary.depositDay >= 1
      && salary.depositDay <= 31;
}

// Compute the next deposit date ISO string from depositDay relative to
// `from` (defaults to today). If this month's depositDay already passed,
// jumps to next month. depositDay > days-in-target-month clamps to the
// last day of that month (so day=31 for February becomes Feb 28/29).
export function nextDepositDate(salary, from = new Date()) {
  if (!salary || !Number.isFinite(salary.depositDay)) return null;
  const ref = new Date(from);
  ref.setHours(0, 0, 0, 0);
  const target = new Date(ref.getFullYear(), ref.getMonth(), 1);
  let day = salary.depositDay;
  // If this month's deposit is in the past, jump to next month
  const thisMonth = new Date(ref.getFullYear(), ref.getMonth(), Math.min(day, _daysInMonth(ref.getFullYear(), ref.getMonth() + 1)));
  if (thisMonth < ref) {
    target.setMonth(target.getMonth() + 1);
  }
  const clamped = Math.min(day, _daysInMonth(target.getFullYear(), target.getMonth() + 1));
  target.setDate(clamped);
  return _isoFromLocalDate(target);
}

export function daysUntilNextDeposit(salary, from = new Date()) {
  const iso = nextDepositDate(salary, from);
  if (!iso) return null;
  return calcDaysUntil(iso);
}

export function getSalaryDestinationEntry(data, salary) {
  if (!salary || !salary.toEntryId) return null;
  return (data.entries || []).find(e => e.id === salary.toEntryId) || null;
}

function _daysInMonth(year, monthOneBased) {
  // Day 0 of the next month is the last day of this month.
  return new Date(year, monthOneBased, 0).getDate();
}

function _isoFromLocalDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function spendingFillClass(spending, limit) {
  if (!limit || spending === null) return 'spending-fill--low';
  const pct = (spending / limit) * 100;
  if (pct >= 70) return 'spending-fill--high';
  if (pct >= 40) return 'spending-fill--moderate';
  return 'spending-fill--low';
}

export function networkLogoHtml(network) {
  if (network === 'mastercard') {
    return `<span class="net-logo net-mc"><span></span><span></span></span>`;
  }
  if (network === 'visa') {
    return `<span class="net-logo net-visa">VISA</span>`;
  }
  if (network === 'amex') {
    return `<span class="net-logo net-amex">AMEX</span>`;
  }
  return '';
}

// ─────────────────────────────────────────
//  SHARED UI ICONS  (inline SVG strings)
// ─────────────────────────────────────────

export const _iconEdit = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a2.121 2.121 0 1 1 3 3L6 14H2v-4L11.5 2.5z"/></svg>`;
export const _iconDelete = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 13,4"/><path d="M5 4V2h6v2"/><path d="M4 4l.8 9.6a.6.6 0 0 0 .6.4h5.2a.6.6 0 0 0 .6-.4L12 4"/><line x1="6.5" y1="7" x2="6.8" y2="11"/><line x1="9.5" y1="7" x2="9.2" y2="11"/></svg>`;
export const _iconAdd = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>`;

export const _iconExternal = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h5v5M14 2L7 9M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3"/></svg>`;

export const _iconCash = `<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="9" rx="1.5"/><circle cx="9" cy="9.5" r="2"/><path d="M5 7.5v.01M13 11v.01"/></svg>`;

export const _iconSync = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6V2.5L11 5.5"/><path d="M2 8a6 6 0 0 1 11-3.5"/><path d="M2 10v3.5L5 10.5"/><path d="M14 8a6 6 0 0 1-11 3.5"/></svg>`;

export const _iconPortfolio = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V5"/><path d="M2 9h12"/></svg>`;

export const _iconTrendUp = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,11 6,7 9,10 14,4"/><polyline points="10,4 14,4 14,8"/></svg>`;

export const _iconTrendDown = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,5 6,9 9,6 14,12"/><polyline points="10,12 14,12 14,8"/></svg>`;

export const _iconInfo = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><line x1="8" y1="7.5" x2="8" y2="11"/><circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none"/></svg>`;

export const _iconLock = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5 7V4.5a3 3 0 1 1 6 0V7"/></svg>`;

// "Has a note" marker — a lined page, NOT a pencil. The pencil glyph it
// replaces read as "edit", which falsely implied only some rows were
// editable (every row is). Monochrome via currentColor so it stays a
// quiet, muted indicator next to the row title.
export const _iconNote = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="2.5" width="9" height="11" rx="1.2"/><line x1="5.6" y1="5.5" x2="10.4" y2="5.5"/><line x1="5.6" y1="8" x2="10.4" y2="8"/><line x1="5.6" y1="10.5" x2="8.5" y2="10.5"/></svg>`;
