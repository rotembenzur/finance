// ─────────────────────────────────────────────────────────────────
//  APP — entry module
//
//  index.html loads this file with <script type="module">. Everything
//  else fans out from here via static imports. Three responsibilities:
//
//    1. Define init() (re-render full app HTML on every state change)
//       and the small mutation surface still in use (updateEntry —
//       only the cash inline-edit flow currently mutates state from
//       the UI; entry add/edit/delete is intentionally out for now).
//    2. Bridge every inline-on* handler name onto `window` — this
//       is the only place we touch the global scope. Renderers still
//       emit HTML strings with `onclick="foo(...)"`, and HTML resolves
//       those names against the global object.
//    3. Boot once the DOM is ready.
// ─────────────────────────────────────────────────────────────────

import { getAppData, replaceAppData } from './state.js';
import { loadData, saveData, todayISO } from './store.js';
import { setLanguage as _setLanguage, t } from './i18n.js';
import { initNav } from './components/nav.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderAccounts, enterCashEdit, saveCashEdit, exitCashEdit } from './pages/accounts.js';
import { renderCards, flipCard, initCardsWallet, focusCardAt, viewActiveCardCharges } from './pages/cards.js';
import { renderAssets, highlightAllocationSegment, clearAllocationHighlight } from './pages/assets.js';
import { renderFuture } from './pages/future.js';
import { renderFutureDeposits } from './pages/future-deposits.js';
import { renderCardCharges } from './pages/card-charges.js';
import { renderCashHistory } from './pages/cash-history.js';
import { renderTransactions } from './pages/transactions.js';
import { openBankImportFlow } from './import/bank/bank-import-flow.js';

import { closeModal, handleModalSave } from './components/modal.js';
import { openDataMenu, exportDataToFile, openImportFlow, reloadFromDataFile } from './components/data-io.js';
import { openEditAmountModal } from './components/edit-amount.js';
import { openEditCardSpendingModal } from './components/edit-card-spending.js';
import { openIBIImportFlow } from './import/import-flow.js';
import { openIsracardImportFlow } from './import/isracard-flow.js';
import { openMaxImportFlow } from './import/max-flow.js';
import { openExpenseImportPicker } from './import/expense-import-picker.js';
import { openEditChargeModal } from './components/edit-charge.js';
import { openEditSalaryModal } from './components/edit-salary.js';
import { openQuickExpenseModal } from './components/quick-expense.js';
import { openEditCashModal } from './components/edit-cash.js';
import { openEditPortfolioCashModal } from './components/edit-portfolio-cash.js';
import { refreshRatesIfStale } from './fx.js';
import { refreshStockQuote, StockQuoteError } from './stock-quotes.js';
import { showToast } from './components/toast.js';


// ── View state ────────────────────────────────────────────────────
//
// The default 'dashboard' view renders all sections into #app-content.
// Drilldown views (currently just a card's monthly charges page) swap
// the dashboard out and render their own content into the same root.
// The sidebar/topbar stay; only the content area changes. Navigating
// to any section via the sidebar or via navigateToSection() resets to
// the dashboard automatically.

let _currentView = { type: 'dashboard' };


// ── Render ────────────────────────────────────────────────────────

export async function init() {
  // Load once; subsequent re-renders (cash edit, sync, language switch,
  // data import) reuse in-memory state.
  const isFirstBoot = !getAppData();
  if (isFirstBoot) replaceAppData(await loadData());
  const data = getAppData();

  const root = document.getElementById('app-content');

  if (_currentView.type === 'card-charges') {
    root.innerHTML = renderCardCharges(data, _currentView.cardId);
  } else if (_currentView.type === 'cash-history') {
    root.innerHTML = renderCashHistory(data, _currentView.entryId, _currentView.monthOverride);
  } else {
    root.innerHTML = [
      renderDashboard(data),
      renderAccounts(data),
      renderCards(data),
      renderAssets(data),
      renderFuture(data),
      renderFutureDeposits(data),
      renderTransactions(data),
    ].join('');
  }

  initNav();

  // Wallet carousel needs imperative scroll + click wiring after each
  // re-render (innerHTML wipes listeners). Idempotent — does nothing
  // if the listeners were already bound for this DOM.
  initCardsWallet();

  // Kick off (or no-op cache-hit) the live FX refresh once per boot.
  // The first render uses cached/static rates; when fresh rates land
  // we re-render so foreign-currency cash cards update silently.
  //
  // Stock quotes are NOT auto-refreshed on boot — they are pulled
  // only in response to an explicit user action (the per-row sync
  // icon or the portfolio Market Sync button).
  if (isFirstBoot) {
    _refreshRatesAndMaybeRerender(data);
  }
}

let _ratesRefreshInflight = false;
function _refreshRatesAndMaybeRerender(data) {
  if (_ratesRefreshInflight) return;
  _ratesRefreshInflight = true;
  refreshRatesIfStale(data)
    .then(result => {
      _ratesRefreshInflight = false;
      // Only re-render when we actually pulled fresh values from the
      // network. A cache hit or fallback already matches what's on
      // screen, so a re-render would just flash for nothing.
      if (result && result.source === 'network') init();
    })
    .catch(() => { _ratesRefreshInflight = false; });
}

// ── Manual user-triggered sync ────────────────────────────────────
// Per-holding sync icon (currently used only by the Bank Hapoalim
// MR1 row). Spins the clicked button immediately, re-renders when
// the fetch settles, and surfaces a toast with structured
// diagnostics on failure. No silent failures — the user explicitly
// asked to sync, they get to see what went wrong.

const _quoteManualInflight = new Set();
async function refreshStockQuoteManual(ticker) {
  if (_quoteManualInflight.has(ticker)) return;
  _quoteManualInflight.add(ticker);
  document.querySelectorAll(`.holding-quote-refresh[data-ticker="${ticker}"]`)
    .forEach(b => b.classList.add('is-refreshing'));

  try {
    const quote = await refreshStockQuote(ticker);
    console.log(`[stock-quotes] ${ticker} → sync success. ${quote.currency} ${quote.price.toFixed(4)} per unit, change ${quote.changePct.toFixed(2)}%`);
  } catch (err) {
    const details = err instanceof StockQuoteError
      ? err.toDetailsString()
      : `Endpoint: (unknown)\nError: ${err?.message || String(err)}`;
    console.error(`[stock-quotes] ${ticker} → manual sync failed:`, err);
    showToast({
      tone:    'error',
      message: _friendlyStockSyncMessage(ticker),
      details,
    });
  } finally {
    _quoteManualInflight.delete(ticker);
    init();
  }
}

function _friendlyStockSyncMessage(ticker) {
  const data    = getAppData();
  const entries = (data && data.entries) || [];
  const entry   = entries.find(e => e.ticker === ticker);
  const label   = (entry && entry.name) || ticker;
  return t('stockSync.failureTitle').replace('{name}', label);
}


// ── View navigation ───────────────────────────────────────────────

// Smooth-scroll to a section on the dashboard. If we're currently in
// a drilldown view, switch back first and scroll once the dashboard
// has rendered. Used by every clickable destination in the app — home
// rows, sidebar nav buttons, "back to cards" on the charges page, etc.
export function navigateToSection(id) {
  if (_currentView.type !== 'dashboard') {
    _currentView = { type: 'dashboard' };
    init();
  }
  // Wait for the layout to settle before measuring scroll target.
  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Drilldown into a card's monthly charges. Resets scroll because the
// charges page is its own self-contained screen.
export function navigateToCardCharges(cardId) {
  _currentView = { type: 'card-charges', cardId };
  init();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Drilldown into a cash entry's transaction history. Same pattern as
// the card-charges drilldown — replaces the dashboard content with a
// dedicated screen. The Back button on that screen returns via
// navigateToSection('accounts').
export function navigateToCashHistory(entryId) {
  _currentView = { type: 'cash-history', entryId, monthOverride: null };
  init();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Cash-history period picker handlers — three small functions that
// drive the chevron stepper + label dropdown on the cash-history
// page. All three resolve the "current" selected month from view
// state (falling back to today when nothing's overridden), apply
// their delta/selection, and trigger a re-render.

function _cashHistoryActiveMonth() {
  if (_currentView.type !== 'cash-history') return null;
  if (_currentView.monthOverride && /^\d{4}-\d{2}$/.test(_currentView.monthOverride)) {
    return _currentView.monthOverride;
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const next = new Date(y, m - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

// Step one month back/forward. Clamps "next" to the current real-
// world month so the user can't pick a future period.
export function onCashHistoryMonthStep(delta, entryId) {
  if (_currentView.type !== 'cash-history' || _currentView.entryId !== entryId) return;
  const active  = _cashHistoryActiveMonth();
  const stepped = _shiftMonth(active, delta);
  const today = new Date();
  const cur   = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  _currentView.monthOverride = stepped > cur ? cur : stepped;
  init();
}

// Pick a specific month from the dropdown.
export function onCashHistoryMonthSelect(month, entryId) {
  if (_currentView.type !== 'cash-history' || _currentView.entryId !== entryId) return;
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  _currentView.monthOverride = month;
  init();
}

// Toggle the period-picker dropdown. Mirrors the holding-info-wrap
// pattern: a class toggle that CSS animates, with one open at a
// time and outside-click / Esc handled by document-level listeners
// below.
export function onCashHistoryToggleDropdown(btnEl) {
  const wrap = btnEl.closest('.period-picker');
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('is-open');
  document.querySelectorAll('.period-picker.is-open').forEach(el => {
    if (el !== wrap) el.classList.remove('is-open');
  });
  wrap.classList.toggle('is-open', !wasOpen);
  btnEl.setAttribute('aria-expanded', String(!wasOpen));
}


// ── Mutation: amount-only field edits ────────────────────────────
//
// The cash card's inline editor calls updateEntry with `{ balance }`.
// Entry shape (name, type, institution, etc.) is treated as data
// for now — no UI for adding, editing, or deleting financial
// products themselves. IBI sync mutates appData.entries directly
// (see js/import/import-apply.js) without going through this path.

export function updateEntry(id, fields) {
  const data = getAppData();
  const idx = data.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  data.entries[idx] = { ...data.entries[idx], ...fields };
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();
}


// ── Inline-handler bridge ────────────────────────────────────────
//
// Renderers emit HTML strings containing `onclick="foo(...)"` etc.
// HTML resolves those bare names against the global object — modules
// don't put their declarations there, so we attach each one explicitly.
// This is the ONLY window pollution in the app.

// Wrapper around i18n.setLanguage that re-renders. Splits "update
// state" (the i18n module's job) from "trigger UI refresh" (this
// module's job) so i18n doesn't need to import init() — that would
// otherwise create a cycle.
function setLanguage(lang) {
  _setLanguage(lang);
  init();
}

// Holding-info tooltip — click handler for touch devices. Desktop
// uses pure CSS :hover / :focus-within on .holding-info-wrap. The
// same handler still works for mouse users who prefer click: it
// toggles .is-open, and the document-level listeners below close
// the popover on outside click or Escape.
function toggleHoldingTooltip(btnEl) {
  const wrap = btnEl.closest('.holding-info-wrap');
  if (!wrap) return;
  const wasOpen = wrap.classList.contains('is-open');
  // Single-popover-at-a-time: close any other open one first.
  document.querySelectorAll('.holding-info-wrap.is-open').forEach(el => {
    if (el !== wrap) el.classList.remove('is-open');
  });
  wrap.classList.toggle('is-open', !wasOpen);
}

// Outside-click + Esc — close any open transient popover (holding-
// info tooltips, cash-history period picker dropdowns). Registered
// once at module load; survives every init() re-render because the
// listener lives on `document`, not on rendered nodes.
const _POPOVER_SELECTORS = ['.holding-info-wrap.is-open', '.period-picker.is-open'];
const _POPOVER_PARENTS   = ['.holding-info-wrap',         '.period-picker'];

document.addEventListener('click', (e) => {
  for (let i = 0; i < _POPOVER_SELECTORS.length; i++) {
    if (e.target.closest(_POPOVER_PARENTS[i])) continue;
    document.querySelectorAll(_POPOVER_SELECTORS[i]).forEach(el => el.classList.remove('is-open'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const sel of _POPOVER_SELECTORS) {
    document.querySelectorAll(sel).forEach(el => el.classList.remove('is-open'));
  }
});

Object.assign(window, {
  // Modal flow
  closeModal,
  handleModalSave,

  // Section navigation + language toggle
  navigateToSection,
  setLanguage,

  // Cards / accounts / allocation interactions
  flipCard,
  enterCashEdit,
  saveCashEdit,
  exitCashEdit,
  highlightAllocationSegment,
  clearAllocationHighlight,

  // Per-entry amount edit (the only structural mutation surface
  // currently exposed). Targets balance/currentValue, plus per-track
  // values for products that hold multiple investment paths.
  editAmount: openEditAmountModal,

  // Card-spending edit + drilldown into a card's monthly charges.
  editCardSpending: openEditCardSpendingModal,
  navigateToCardCharges,

  // Cash transaction history — drilldown + period-picker handlers
  // (step prev/next, jump to a specific month, toggle the dropdown).
  navigateToCashHistory,
  onCashHistoryMonthStep,
  onCashHistoryMonthSelect,
  onCashHistoryToggleDropdown,

  // Wallet carousel — dots + contextual "View charges" button
  focusCardAt,
  viewActiveCardCharges,

  // Per-charge edit modal (opens from a charges-page row click)
  openEditChargeModal,

  // Holding info popover — hover on desktop, tap on touch. The tap
  // handler also doubles as a click-toggle for mouse users who prefer
  // click. See toggleHoldingTooltip below + the matching styles.
  toggleHoldingTooltip,

  // Salary edit modal (opens from the income row on the home page)
  openEditSalaryModal,

  // Quick-expense modal (mobile-first "I just paid for X, log it")
  openQuickExpenseModal,

  // Multi-currency cash entry — modal handles create / edit / remove
  openEditCashModal,

  // Portfolio cash-available edit (the "Cash available" hero stat)
  openEditPortfolioCashModal,

  // Data tools (sync, manual backup/restore, reload from file)
  openIBIImportFlow,
  openIsracardImportFlow,
  openMaxImportFlow,
  openExpenseImportPicker,
  openBankImportFlow,
  openDataMenu,
  exportDataToFile,
  openImportFlow,
  reloadFromDataFile,

  // Manual single-ticker refresh — triggered by the small sync icon
  // on the live stock-quote row in the Invested section.
  refreshStockQuoteManual,
});


// ── Boot ─────────────────────────────────────────────────────────
// Module scripts are deferred, so by the time this runs the DOM is
// already parsed. The readyState check covers the edge case where a
// later refactor pulls boot earlier in the load cycle.

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
