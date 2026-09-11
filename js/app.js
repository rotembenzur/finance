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
import { guard, signOut } from './auth.js';
import { setLanguage as _setLanguage, t } from './i18n.js';
import { initNav, setActiveSection, sectionLabel } from './components/nav.js';
import { isDemoMode } from './demo-mode.js';

import { renderDashboard } from './pages/dashboard.js';
import {
  renderAccounts,
  enterCashEdit, saveCashEdit, exitCashEdit,
  enterWalletEdit, saveWalletEdit, exitWalletEdit,
} from './pages/accounts.js';
import { renderCards, flipCard, initCardsWallet, focusCardAt, viewActiveCardCharges, editActiveCard } from './pages/cards.js';
import { renderAssets, highlightAllocationSegment, clearAllocationHighlight } from './pages/assets.js';
import { renderIntelligence, setAIInsights, setIntelRefreshing,
         setAIFingerprint, getAIFingerprint, clearAIInsights,
         computeIntelFingerprint } from './pages/intelligence.js';
import { askAssistant } from './intelligence/assistant.js';
import { refreshAIInsights } from './intelligence/insights-ai.js';
import { saveCachedInsights, clearCachedInsights } from './intelligence/insights-cache.js';
import { normalizeDashes } from './intelligence/insights-normalize.js';
import { renderSpending, onSpendingMonthStep, onSpendingCategoryToggle } from './pages/spending.js';
import { renderFuture } from './pages/future.js';
import { renderFutureDeposits } from './pages/future-deposits.js';
import {
  renderGiftCards, handleVoucherAction,
  setVoucherSearch, setVoucherSort,
} from './pages/gift-cards.js';
import { openEditGiftCardModal } from './components/edit-gift-card.js';
import { openEditDepositModal } from './components/edit-deposit.js';
import { openEditProductModal } from './components/edit-product.js';
import { openEditFutureDepositModal } from './components/edit-future-deposit.js';
import { openEditStandaloneInvestmentModal } from './components/edit-standalone-investment.js';
import { openBrokerTermsModal, openEditBrokerTermsModal } from './components/broker-terms.js';
import { openEditCreditCardModal } from './components/edit-credit-card.js';
import { renderCardCharges } from './pages/card-charges.js';
import { renderCashHistory } from './pages/cash-history.js';
import {
  renderAdmin, adminSelectList, adminMoveItem, adminToggleActive, adminDeleteItem,
  adminSaveSettings,
} from './pages/admin.js';
import { openConfigItemModal } from './components/edit-config-item.js';
import { renderTransactions, onActivityMonthStep, onActivityTailToggle } from './pages/transactions.js';
import { openBankImportFlow } from './import/bank/bank-import-flow.js';

import { closeModal, handleModalSave } from './components/modal.js';
import { exportDataToFile, openImportFlow, reloadFromDataFile } from './components/data-io.js';
import { openEditAmountModal } from './components/edit-amount.js';
import { openEditCardSpendingModal } from './components/edit-card-spending.js';
import { openIBIImportFlow } from './import/import-flow.js';
import { openIsracardImportFlow } from './import/isracard-flow.js';
import { openMaxImportFlow } from './import/max-flow.js';
import { openCalImportFlow } from './import/cal-flow.js';
import { openExpenseImportPicker } from './import/expense-import-picker.js';
import { openEditChargeModal } from './components/edit-charge.js';
import { openEditCardLinkModal } from './components/edit-card-link.js';
import { openEditTransactionModal } from './components/edit-transaction.js';
import { openEditCashChargeModal } from './components/edit-cash-charge.js';
import { openEditSalaryModal } from './components/edit-salary.js';
import { openQuickExpenseModal } from './components/quick-expense.js';
import { openQuickIncomeModal }  from './components/quick-income.js';
import { openQuickBankExpenseModal } from './components/quick-bank-expense.js';
import { openQuickAddPicker }    from './components/quick-add-picker.js';
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


// ── Mobile screen router ──────────────────────────────────────────
//
// On desktop the ten sections are one long editorial document and the
// nav rail scroll-jumps between them. That model is wrong on a phone:
// tapping "Cards" used to smooth-scroll several thousand pixels past
// everything in between, the active tab strobed through three states
// on the way, and every state change re-rendered all ten sections.
//
// At the phone tier we render exactly ONE screen into #app-content and
// swap it on navigation, which is what makes the bottom bar behave
// like real tab bar: instant, with per-screen scroll memory and a
// stable selected state. Nothing is removed — every section is still
// reachable, via the tab bar or the More sheet. Desktop and tablet
// keep the long-document model untouched.
//
// The renderers are exactly the ones init() composes on desktop, so
// there is no second rendering path to keep in sync — only a choice
// of how many of them are mounted at once.

const MOBILE_SCREENS = {
  'dashboard':       renderDashboard,
  'accounts':        renderAccounts,
  'cards':           renderCards,
  'assets':          renderAssets,
  'future':          renderFuture,
  'future-deposits': renderFutureDeposits,
  'gift-cards':      renderGiftCards,
  'transactions':    renderTransactions,
  'spending':        renderSpending,
  'intelligence':    renderIntelligence,
};

let _mobileScreen = 'dashboard';

// Per-screen scroll offsets, so returning to a tab lands where the
// user left it instead of at the top — the single detail that most
// separates "tab bar" from "anchor links".
const _screenScroll = Object.create(null);

export function isPhone() {
  return _phoneMQ.matches;
}

export function currentMobileScreen() {
  return _mobileScreen;
}

// Screen id ⇄ URL hash. `#/cards` rather than `#cards` on purpose: a
// bare fragment matching a section id would make the browser scroll to
// that element on load, fighting our own scroll restore.
function _screenFromHash() {
  const m = /^#\/([a-z-]+)$/.exec(window.location.hash || '');
  return m && MOBILE_SCREENS[m[1]] ? m[1] : null;
}

// Push (or replace) an entry so the hardware/gesture Back button walks
// back through screens instead of leaving the app on the first press.
// Phone-only: on desktop we never touch history, so that model is
// exactly as it was.
// How many entries this app has pushed. Lets the nav-bar back button
// choose between "pop the stack" and "there is nothing to pop, go
// home" instead of blindly calling history.back() and walking the user
// out of the app.
let _historyDepth = 0;

function _syncHistory(mode) {
  if (!isPhone()) return;
  const state = { fin: true, view: _currentView, screen: _mobileScreen };
  const url = _currentView.type === 'dashboard' ? `#/${_mobileScreen}` : `#/${_currentView.type}`;
  try {
    if (mode === 'replace') {
      history.replaceState(state, '', url);
    } else {
      history.pushState(state, '', url);
      _historyDepth++;
    }
  } catch (_) { /* history is best-effort; never block navigation */ }
}

window.addEventListener('popstate', (e) => {
  const state = e.state;
  if (!isPhone() || !state || !state.fin) return;
  _historyDepth = Math.max(0, _historyDepth - 1);
  _currentView  = state.view || { type: 'dashboard' };
  _mobileScreen = MOBILE_SCREENS[state.screen] ? state.screen : 'dashboard';
  _pendingScrollTop = _currentView.type === 'dashboard'
    ? (_screenScroll[_mobileScreen] || 0)
    : 0;
  init();
  _playScreenTransition();
});

// Nav-bar back. Routing it through history keeps the button and the
// platform's own back gesture on one stack, so they can never disagree
// about where "back" is.
export function navigateBack() {
  if (_historyDepth > 0) { history.back(); return; }
  navigateToSection('dashboard');
}

// Cross-fade + lift on the content root. Deliberately short (200ms) —
// long enough to read as "a screen replaced another", short enough
// that it never sits between the user and their data.
function _playScreenTransition() {
  const root = document.getElementById('app-content');
  if (!root || !isPhone()) return;
  root.classList.remove('screen-enter');
  void root.offsetWidth;            // force reflow so the animation restarts
  root.classList.add('screen-enter');
}

// Where the NEXT init() should leave the viewport. init() otherwise
// preserves the current offset (so an in-place re-render is
// invisible), which is wrong for a navigation: the outgoing screen's
// offset would be painted onto the incoming screen for a frame before
// any correction landed. Setting this before init() lets the scroll
// happen in the same synchronous pass as the render, so there is
// nothing to correct and nothing to flash.
let _pendingScrollTop = null;


// ── Render ────────────────────────────────────────────────────────

export async function init() {
  // Load once; subsequent re-renders (cash edit, sync, language switch,
  // data import) reuse in-memory state.
  const isFirstBoot = !getAppData();
  if (isFirstBoot) replaceAppData(await loadData());
  const data = getAppData();

  const root = document.getElementById('app-content');

  // Preserve the window scroll position across the rebuild. Replacing
  // #app-content via innerHTML momentarily empties it, collapsing the
  // document height so the browser clamps the scroll to the top — the
  // "jumps upward" symptom. Capturing scrollTop here and restoring it
  // after the swap makes a same-view re-render visually transparent
  // (what a virtual-DOM framework does for you). Intentional navigations
  // (drilldowns, navigateToSection) set scroll AFTER init() returns, so
  // they still take precedence.
  const scroller = document.scrollingElement || document.documentElement;
  // A navigation states its own target (see _pendingScrollTop); every
  // other render is a same-view rebuild that must not move the page.
  const targetScrollTop = _pendingScrollTop != null ? _pendingScrollTop : scroller.scrollTop;
  _pendingScrollTop = null;

  // Tag the body with the current view type so CSS can react.
  // The mobile topbar nav-bar reads this to know whether to show
  // a section title (dashboard view) or hide itself entirely
  // (drilldown views own their own back-bar header).
  document.body.dataset.view = _currentView.type;

  // Which screen the phone shell is on. Drives the nav-bar title, the
  // selected tab, and per-screen CSS. Empty on desktop, where the
  // whole document is mounted at once and no single screen is "the"
  // screen.
  const phone = isPhone();
  document.body.dataset.screen = phone && _currentView.type === 'dashboard'
    ? _mobileScreen
    : '';

  if (_currentView.type === 'card-charges') {
    root.innerHTML = renderCardCharges(data, _currentView.cardId);
  } else if (_currentView.type === 'cash-history') {
    root.innerHTML = renderCashHistory(data, _currentView.entryId, _currentView.monthOverride);
  } else if (_currentView.type === 'admin') {
    root.innerHTML = renderAdmin(data, _currentView.listKey);
  } else if (phone) {
    // One screen at a time (see "Mobile screen router" above).
    const renderScreen = MOBILE_SCREENS[_mobileScreen] || renderDashboard;
    root.innerHTML = renderScreen(data);
    // The tab bar can't infer the selection from scroll position when
    // only one section is mounted, so state it outright.
    setActiveSection(_mobileScreen);
  } else {
    root.innerHTML = [
      renderDashboard(data),
      renderAccounts(data),
      renderCards(data),
      renderAssets(data),
      renderFuture(data),
      renderFutureDeposits(data),
      renderGiftCards(data),
      renderTransactions(data),
      renderSpending(data),
      renderIntelligence(data),
    ].join('');
  }

  initNav();
  _updateShellChrome();

  // Wallet carousel needs imperative scroll + click wiring after each
  // re-render (innerHTML wipes listeners). Idempotent — does nothing
  // if the listeners were already bound for this DOM.
  initCardsWallet();

  // Demo mode — install (or refresh) the subtle "Demo data" pill.
  // Idempotent: re-runs after every init() to keep the label in sync
  // with the current language. No-op in real mode.
  _ensureDemoBadge();

  // Reading/writing scrollTop forces layout, so the new DOM's height
  // is resolved here — the offset lands (or clamps) correctly in the
  // same pass that rendered it.
  scroller.scrollTop = targetScrollTop;

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

  // Lets shell-level listeners (currently the nav-bar condense state)
  // re-evaluate after a render that changed the document height
  // without emitting a scroll event.
  window.dispatchEvent(new CustomEvent('finance:rendered'));
}

// Keep the fixed shell (nav bar back button + title) in step with what
// is actually mounted. On the tab screens the title comes from
// nav.js's setActiveSection; drilldowns aren't tabs, so they name
// themselves here from their own rendered heading.
function _updateShellChrome() {
  const backBtn = document.getElementById('topbar-back');
  const titleEl = document.getElementById('topbar-title');
  const headEl  = document.getElementById('screen-head');
  const bigEl   = document.getElementById('screen-title');
  const isDrilldown = _currentView.type !== 'dashboard';

  if (backBtn) backBtn.hidden = !isDrilldown;
  document.body.classList.toggle('has-back', isDrilldown);

  if (isDrilldown && titleEl) {
    // `.card-charges-name` is shared by the charges and cash-history
    // screens; Admin titles itself with a section-title in its topbar.
    const src = document.querySelector('.card-charges-name, .admin-topbar .section-title');
    titleEl.textContent = src ? src.textContent.trim() : '';
  }

  // Large title. Every tab screen gets one EXCEPT the dashboard, where
  // the net-worth hero is already the screen's identity and a word
  // above it would just be chrome restating the selected tab.
  if (headEl && bigEl) {
    const wants = isPhone() && !isDrilldown && _mobileScreen !== 'dashboard';
    headEl.hidden = !wants;
    bigEl.textContent = wants ? sectionLabel(_mobileScreen) : '';
  }
}

// Demo-mode visual marker. Tiny pill fixed at the bottom-inline-end
// of the viewport, visible across all screen sizes. Created once and
// updated in place on language switches so it never stacks up.
function _ensureDemoBadge() {
  if (!isDemoMode()) return;
  let el = document.getElementById('demo-badge');
  if (!el) {
    el = document.createElement('span');
    el.id = 'demo-badge';
    el.className = 'demo-badge';
    document.body.appendChild(el);
  }
  el.textContent = t('demo.badge');
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

// Re-render a SINGLE dashboard section in place, leaving the rest of
// #app-content untouched. Local UI toggles (expand a spending category,
// step the transactions month) use this instead of init() so a small
// change updates only its own section — the document height barely
// shifts and the window scroll stays exactly where it was, rather than
// the whole page rebuilding. Falls back to a full init() when the
// section isn't currently mounted (e.g. we're inside a drilldown view).
export function rerenderSection(id, html) {
  const el = document.getElementById(id);
  if (!el) { init(); return; }
  el.outerHTML = String(html).trim();
  // The section element was replaced, so re-point the nav's
  // IntersectionObserver (and refresh the rail/tabs) at the new node.
  initNav();
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

    // Bake the synced market value into entry.currentValue so the
    // persisted state matches the displayed value. Without this, a
    // previously-edited manual amount lingers in state — invisible
    // most of the time (entryValue() prefers the live cache) but
    // resurfacing wherever the cache is unavailable: the edit-amount
    // prefill, a fresh device, or after browser data is cleared.
    // The mental model is "manual edit = temporary override UNTIL
    // sync"; this write makes that contract real instead of cosmetic.
    const data = getAppData();
    let touched = false;
    for (const entry of (data && data.entries) || []) {
      if (entry.ticker === ticker && typeof entry.quantity === 'number') {
        const synced = quote.price * entry.quantity;
        if (entry.currentValue !== synced) {
          entry.currentValue = synced;
          entry.updatedAt    = todayISO();
          touched = true;
        }
      }
    }
    if (touched) {
      data.meta.lastUpdated = todayISO();
      saveData(data);
    }
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
// Honours prefers-reduced-motion for programmatic scrolling. The CSS
// `scroll-behavior: auto !important` in the reduced-motion block does
// not apply to an explicit `behavior: 'smooth'` passed to the API.
function _scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function navigateToSection(id) {
  // Phone: a tab switch, not a scroll. Swap the mounted screen, park
  // the outgoing screen's scroll offset, and restore the incoming
  // one's. See the "Mobile screen router" block above.
  if (isPhone()) {
    const target    = MOBILE_SCREENS[id] ? id : 'dashboard';
    const onScreens = _currentView.type === 'dashboard';

    // Re-tapping the tab you're already on scrolls that screen to the
    // top — the iOS convention, and the fastest way back to the hero
    // number from deep inside a long list.
    if (onScreens && target === _mobileScreen) {
      window.scrollTo({ top: 0, behavior: _scrollBehavior() });
      return;
    }

    if (onScreens) _screenScroll[_mobileScreen] = window.scrollY;
    _currentView      = { type: 'dashboard' };
    _mobileScreen     = target;
    _pendingScrollTop = _screenScroll[target] || 0;
    init();
    _playScreenTransition();
    _syncHistory('push');
    return;
  }

  if (_currentView.type !== 'dashboard') {
    _currentView = { type: 'dashboard' };
    init();
  }
  // Wait for the layout to settle before measuring scroll target.
  // A user who asked the OS to reduce motion gets the jump, not the
  // glide — CSS can't reach a scrollIntoView option, so it's read here.
  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: _scrollBehavior(), block: 'start' });
  });
}

// Drilldown into a card's monthly charges. Resets scroll because the
// charges page is its own self-contained screen.
export function navigateToCardCharges(cardId) {
  if (isPhone() && _currentView.type === 'dashboard') {
    _screenScroll[_mobileScreen] = window.scrollY;
  }
  _currentView      = { type: 'card-charges', cardId };
  _pendingScrollTop = 0;
  init();
  _playScreenTransition();
  _syncHistory('push');
}

// Drilldown into a cash entry's transaction history. Same pattern as
// the card-charges drilldown — replaces the dashboard content with a
// dedicated screen. The Back button on that screen returns via
// navigateToSection('accounts').
export function navigateToCashHistory(entryId) {
  if (isPhone() && _currentView.type === 'dashboard') {
    _screenScroll[_mobileScreen] = window.scrollY;
  }
  _currentView      = { type: 'cash-history', entryId, monthOverride: null };
  _pendingScrollTop = 0;
  init();
  _playScreenTransition();
  _syncHistory('push');
}

// Admin / Management screen — a dedicated drilldown view (not in the
// dashboard sections). `listKey` selects which configuration list is
// shown; defaults to the first editable list. Re-invoked to switch
// lists. The Back button returns via navigateToSection('dashboard').
export function navigateToAdmin(listKey = null) {
  const entering = _currentView.type !== 'admin';
  if (isPhone() && _currentView.type === 'dashboard') {
    _screenScroll[_mobileScreen] = window.scrollY;
  }
  _currentView      = { type: 'admin', listKey };
  _pendingScrollTop = 0;
  init();
  _playScreenTransition();
  // Switching lists inside Admin re-invokes this; only the initial
  // entry deserves its own history entry, otherwise Back would walk
  // through every list the user browsed.
  if (entering) _syncHistory('push');
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


// ── AI assistant — Ask panel on the Intelligence page ───────────
//
// The page's inline form posts via onIntelAskSubmit. We read the
// current state, call the engine + serverless endpoint via
// assistant.js, and render the result into the output region.
//
// Error policy:
//   - The user never sees an error code, a stack trace, or a raw
//     server snippet. They see one of a handful of friendly
//     sentences mapped from the result.code via i18n.
//   - Every failure is logged to console.error with the full
//     structured result, including the raw body snippet, content
//     type, and status — that's the dev/prod observability path.
//   - On localhost we also surface a small <details> block under
//     the friendly message so debugging doesn't require opening
//     DevTools. Hidden by default; never rendered in production.

const _askInflight = new WeakSet();

// Map of assistant.js failure codes → user-facing i18n keys. New
// codes added to assistant.js MUST get a key here; the fallback is
// the generic "something went wrong" message rather than the code.
const ASSISTANT_ERR_KEY = {
  empty:           'assistant.err.generic',
  no_data:         'assistant.err.generic',
  network:         'assistant.err.network',
  read_failed:     'assistant.err.unavailable',
  non_json:        'assistant.err.unavailable',
  parse:           'assistant.err.parse',
  invalid_shape:   'assistant.err.parse',
  empty_answer:    'assistant.err.empty',
  not_configured:  'assistant.err.notConfigured',
  rate_limited:    'assistant.err.rateLimited',
  auth_failed:     'assistant.err.unavailable',
  upstream_error:  'assistant.err.unavailable',
  timeout:         'assistant.err.timeout',
  too_large:       'assistant.err.tooLarge',
  bad_request:     'assistant.err.generic',
  build_failed:    'assistant.err.generic',
  http_error:      'assistant.err.unavailable',
};

function _isDevHost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}

// Progress stages reported by the streaming assistant. Each maps to an
// icon, an i18n label, and a rough progress-bar fill so the user always
// sees motion. Deep analytical questions legitimately take longer; this
// makes that visible instead of a frozen spinner.
const ASK_STAGE_META = {
  understanding: { icon: '🧠', key: 'assistant.stage.understanding', pct: 15 },
  querying:      { icon: '📊', key: 'assistant.stage.querying',      pct: 45 },
  analyzing:     { icon: '🔎', key: 'assistant.stage.analyzing',     pct: 72 },
  writing:       { icon: '✍️', key: 'assistant.stage.writing',       pct: 90 },
};

function _renderAskProgress(output, stage, elapsedSec) {
  const meta = ASK_STAGE_META[stage] || ASK_STAGE_META.understanding;
  const label = t(meta.key);
  const hint  = `${t('assistant.stage.estimate')} · ${elapsedSec}s`;
  output.innerHTML = `
    <div class="intel-ask-progress" role="status" aria-live="polite">
      <div class="intel-ask-progress-row">
        <span class="intel-ask-progress-icon">${meta.icon}</span>
        <span class="intel-ask-progress-label">${_esc(label)}</span>
      </div>
      <div class="intel-ask-progress-bar"><i style="width:${meta.pct}%"></i></div>
      <p class="intel-ask-progress-hint">${_esc(hint)}</p>
    </div>`;
}

// Inline Markdown → HTML for a single line/segment. ALWAYS escapes
// first (XSS-safe), then layers in only known-safe tags. The assistant
// already emits this formatting; we just reflect it visually.
function _mdInline(s) {
  let out = _esc(s);
  // **bold**  → <strong>  (content has no '*', so pairs are unambiguous)
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // *italic* / _italic_  (only matched pairs; lone markers stay literal)
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1<em>$2</em>');
  // `code`
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  return out;
}

// Split one Markdown table row into trimmed cells. Strips the optional
// outer pipes and treats an escaped \| as a literal pipe.
function _mdTableRow(line) {
  const SENT = '\u0000';
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, SENT);
  return s.split('|').map(c => c.split(SENT).join('|').trim());
}

// A table separator row is all dash-cells (with optional :align: colons)
// and must contain at least one pipe — so a plain "---" rule never qualifies.
function _isTableSep(line) {
  if (!line.includes('|')) return false;
  const cells = _mdTableRow(line);
  return cells.length >= 1 && cells.every(c => /^:?-+:?$/.test(c));
}

// Per-column alignment from the separator row's colons (null = default,
// which CSS renders as logical `start` so RTL stays clean).
function _mdTableAligns(sepLine) {
  return _mdTableRow(sepLine).map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return null;
  });
}

function _renderMarkdownTable(lines) {
  const aligns = _mdTableAligns(lines[1]);
  const head   = _mdTableRow(lines[0]);
  const body   = lines.slice(2).map(_mdTableRow);
  const attr   = (i) => aligns[i] ? ` style="text-align:${aligns[i]}"` : '';

  let h = '<div class="intel-ask-table-wrap"><table class="intel-ask-table"><thead><tr>';
  head.forEach((c, i) => { h += `<th${attr(i)}>${_mdInline(c)}</th>`; });
  h += '</tr></thead><tbody>';
  for (const row of body) {
    h += '<tr>';
    for (let i = 0; i < head.length; i++) h += `<td${attr(i)}>${_mdInline(row[i] || '')}</td>`;
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  return h;
}

// A line that looks like a Markdown table row: bordered (starts/ends with
// a pipe), a separator, or multi-column (≥2 pipes). Used only to decide
// whether blank lines between rows should be collapsed.
function _looksLikePipeRow(line) {
  const t = line.trim();
  if (!t || !t.includes('|')) return false;
  return t.startsWith('|') || t.endsWith('|') || _isTableSep(t) ||
         (t.match(/\|/g) || []).length >= 2;
}

// The assistant sometimes emits blank lines between table rows (header,
// separator, data). Collapse blank lines that sit BETWEEN two pipe-rows
// so the whole table parses as one block. Blank lines elsewhere (e.g.
// between the table and surrounding prose) are left untouched.
function _collapseTableBlanks(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      const prev = out.length ? out[out.length - 1] : '';
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const next = j < lines.length ? lines[j] : '';
      if (_looksLikePipeRow(prev) && _looksLikePipeRow(next)) continue; // drop blank between rows
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

// Render the assistant's Markdown answer into safe HTML. Supports tables,
// headings (#..###), a wholly-bold line as a section title, bullet
// lists (-, *, •), numbered lists (1. / 1)), bold/italic/code, and
// preserves paragraph spacing + single-line breaks. Tolerant of the
// partial Markdown that arrives mid-stream.
function _renderMarkdown(md) {
  // Same dash rule as the insights surface: the system prompt forbids
  // em/en dashes because they are bidi-neutral and drift to the wrong
  // side of a Hebrew clause, but a prompt is a request, not a
  // guarantee — so it is enforced on the way to the screen as well.
  // Applied per line so it can't disturb table pipes or code fences.
  const cleaned = String(md == null ? '' : md)
    .split('\n')
    .map(line => (line.includes('|') || line.startsWith('    ')) ? line : normalizeDashes(line))
    .join('\n');
  const text   = _collapseTableBlanks(cleaned.replace(/\r\n?/g, '\n'));
  const blocks = text.split(/\n{2,}/);
  const html   = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (!lines.length) continue;

    // Whole block is a Markdown table? (header row + dash separator).
    // Detected once the separator line has streamed in; body rows may
    // still be arriving — we render whatever rows exist so far.
    if (lines.length >= 2 && lines[0].includes('|') && _isTableSep(lines[1])) {
      html.push(_renderMarkdownTable(lines));
      continue;
    }

    // Whole block is a bullet list?
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
      html.push('<ul class="intel-ask-ul">' +
        lines.map(l => `<li>${_mdInline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('') +
        '</ul>');
      continue;
    }
    // Whole block is a numbered list?
    if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) {
      html.push('<ol class="intel-ask-ol">' +
        lines.map(l => `<li>${_mdInline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('') +
        '</ol>');
      continue;
    }

    // Otherwise a prose block: headings and wholly-bold lines become
    // section titles; consecutive plain lines join with <br>.
    let para = [];
    const flush = () => {
      if (para.length) { html.push(`<p class="intel-ask-a">${para.join('<br>')}</p>`); para = []; }
    };
    for (const line of lines) {
      const trimmed = line.trim();
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const boldOnly = /^\*\*([^*].*?)\*\*$/.exec(trimmed);
      if (heading) {
        flush();
        const level = Math.min(heading[1].length, 3);
        html.push(`<p class="intel-ask-h intel-ask-h${level}">${_mdInline(heading[2])}</p>`);
      } else if (boldOnly) {
        flush();
        html.push(`<p class="intel-ask-h intel-ask-h2">${_mdInline(boldOnly[1])}</p>`);
      } else {
        para.push(_mdInline(trimmed));
      }
    }
    flush();
  }

  return html.join('');
}

function _renderAskAnswer(output, question, answerText, streaming) {
  const qHtml = `<div class="intel-ask-q">${_esc(question)}</div>`;
  const aHtml = _renderMarkdown(answerText);
  const cls = streaming ? 'intel-ask-exchange is-streaming' : 'intel-ask-exchange';
  output.innerHTML = `<div class="${cls}">${qHtml}${aHtml}</div>`;
}

async function onIntelAskSubmit(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();

  const form = document.getElementById('intel-ask-form');
  if (!form || _askInflight.has(form)) return;
  const input  = document.getElementById('intel-ask-input');
  const output = document.getElementById('intel-ask-output');
  if (!input || !output) return;

  const question = (input.value || '').trim();
  if (!question) return;

  _askInflight.add(form);
  output.classList.add('is-busy');

  // Staged progress: show the current stage with a live elapsed timer
  // until the answer starts streaming in.
  const startedAt = Date.now();
  let currentStage = 'understanding';
  let streamingAnswer = false;
  const tick = () => {
    if (streamingAnswer) return;
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    _renderAskProgress(output, currentStage, elapsedSec);
  };
  tick();
  const timer = setInterval(tick, 1000);

  const data = getAppData();
  const result = await askAssistant(question, data, {
    onStage: (stage) => {
      currentStage = stage;
      streamingAnswer = false;
      tick();
    },
    onToken: (answerSoFar) => {
      streamingAnswer = true;
      _renderAskAnswer(output, question, answerSoFar, true);
    },
  });

  clearInterval(timer);
  _askInflight.delete(form);
  output.classList.remove('is-busy');

  if (!result.ok) {
    // Always log the full result for diagnostics. The user never
    // sees the code, message, or rawSnippet.
    console.error('[assistant] request failed', result);

    const keyToUse  = ASSISTANT_ERR_KEY[result.code] || 'assistant.err.generic';
    const friendly  = t(keyToUse);

    // On localhost only: surface a small expandable details block
    // so the developer can see what actually broke without opening
    // DevTools. In production this stays hidden — the user gets the
    // friendly sentence and nothing else.
    let devDetails = '';
    if (_isDevHost()) {
      const lines = [
        `code: ${result.code}`,
        result.status ? `status: ${result.status}` : null,
        result.contentType ? `content-type: ${result.contentType}` : null,
        result.message ? `message: ${result.message}` : null,
        result.rawSnippet ? `body: ${result.rawSnippet}` : null,
      ].filter(Boolean).map(_esc).join('\n');

      // Add a one-line hint for the most common dev cause: the API
      // function isn't being executed by the dev server.
      const hint = result.code === 'non_json'
        ? `\n\nhint: /api functions aren't running on this server. Use "vercel dev" (or your Vercel deployment) to enable the assistant.`
        : '';

      devDetails = `
        <details class="intel-ask-debug">
          <summary>Dev details</summary>
          <pre>${lines}${_esc(hint)}</pre>
        </details>
      `;
    }

    output.innerHTML = `
      <p class="intel-ask-error">${_esc(friendly)}</p>
      ${devDetails}
    `;
    return;
  }

  // Success — render the final answer as plain paragraphs (replaces any
  // streamed-in partial). The assistant is instructed to avoid bullet
  // lists by default, so this splits on blank lines only.
  _renderAskAnswer(output, question, result.answer, false);

  input.value = '';
  input.focus();
}

// Suggested-question chips populate the input and submit. Bound on
// the document so it survives every init() re-render.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.intel-ask-suggestion');
  if (!chip) return;
  const input = document.getElementById('intel-ask-input');
  if (!input) return;
  input.value = chip.dataset.question || chip.textContent.trim();
  const form = document.getElementById('intel-ask-form');
  if (form) form.requestSubmit ? form.requestSubmit() : onIntelAskSubmit({ preventDefault(){} });
});

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ── AI insights — "Refresh insights" on the Intelligence page ────
//
// Deliberate, user-triggered: builds the grounded fact sheet, calls the
// serverless endpoint, and on success swaps the deterministic surface
// for the AI-authored one (held in intelligence.js module state). On
// any failure the deterministic cards stay exactly as they were and the
// user sees one friendly toast — never a code or a raw body.
//
// During the call we toggle the busy state directly on the DOM (button
// spinner + section dim) instead of re-rendering, so the Ask panel and
// scroll position survive the in-flight window. The full section re-
// render happens once, on success.

let _intelRefreshInflight = false;

async function onRefreshIntelligence() {
  if (_intelRefreshInflight) return;

  const data = getAppData();

  // Skip the API call when the fingerprint of the current state matches
  // the fingerprint stored with the existing AI surface — there's
  // genuinely nothing to refresh. The toast acknowledges the click;
  // a real user-driven force-refresh can be added later if needed.
  const currentFp = computeIntelFingerprint(data);
  const storedFp  = getAIFingerprint();
  if (storedFp && currentFp && storedFp === currentFp) {
    showToast({ tone: 'info', message: t('intel.upToDate') });
    return;
  }

  _intelRefreshInflight = true;
  setIntelRefreshing(true);

  const section = document.getElementById('intelligence');
  const btn     = document.getElementById('intel-refresh-btn');
  const btnLbl  = btn && btn.querySelector('.intel-refresh-label');
  if (section) section.classList.add('is-refreshing');
  if (btn) { btn.classList.add('is-busy'); btn.disabled = true; }
  if (btnLbl) btnLbl.textContent = t('intel.refreshing');

  const result = await refreshAIInsights(data);

  _intelRefreshInflight = false;
  setIntelRefreshing(false);

  if (!result.ok) {
    console.error('[intel] refresh failed', result);
    // Restore the resting button/section state (no re-render needed —
    // the deterministic surface is untouched).
    if (section) section.classList.remove('is-refreshing');
    if (btn) { btn.classList.remove('is-busy'); btn.disabled = false; }
    if (btnLbl) btnLbl.textContent = t('intel.refresh');

    const key = ASSISTANT_ERR_KEY[result.code] || 'assistant.err.generic';
    showToast({ tone: 'error', message: t(key) });
    return;
  }

  // Success — adopt the AI payload, persist it with the fingerprint of
  // the state it was authored against, and re-render the Intelligence
  // section so it picks up the new surface (clears the busy state too).
  setAIInsights(result.insights);
  setAIFingerprint(currentFp);
  saveCachedInsights({ insights: result.insights, fingerprint: currentFp });
  rerenderSection('intelligence', renderIntelligence(getAppData()));
}


// Revert — drop the AI surface (session + persisted), fall back to the
// deterministic engine view. No network call. The next refresh will
// fetch a fresh AI surface from scratch.
function onRevertIntelligence() {
  clearAIInsights();
  clearCachedInsights();
  rerenderSection('intelligence', renderIntelligence(getAppData()));
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
  enterWalletEdit,
  saveWalletEdit,
  exitWalletEdit,
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

  // Admin / Management screen — drilldown view + per-list/per-item
  // handlers, and the shared config-item editor opener.
  navigateToAdmin,
  adminSelectList,
  adminMoveItem,
  adminToggleActive,
  adminDeleteItem,
  adminSaveSettings,
  openConfigItemModal,

  // Transactions page — month switcher + tail expander handlers.
  // Mutate the page-local state, then re-render ONLY the transactions
  // section in place (not the whole dashboard) so the viewport stays put.
  onActivityMonthStep: (delta) => { onActivityMonthStep(delta); rerenderSection('transactions', renderTransactions(getAppData())); },
  onActivityTailToggle: () => { onActivityTailToggle(); rerenderSection('transactions', renderTransactions(getAppData())); },

  // Spending page — month switcher + category expand/collapse. Same
  // pattern: mutate the page-local state, then re-render just its section.
  onSpendingMonthStep: (delta) => { onSpendingMonthStep(delta); rerenderSection('spending', renderSpending(getAppData())); },
  onSpendingCategoryToggle: (id) => { onSpendingCategoryToggle(id); rerenderSection('spending', renderSpending(getAppData())); },
  onCashHistoryToggleDropdown,

  // Wallet carousel — dots + contextual "View charges" button
  focusCardAt,
  viewActiveCardCharges,
  editActiveCard,

  // Per-charge edit modal (opens from a charges-page row click)
  openEditChargeModal,
  // Card → checking-account link modal (opens from the Cards page
  // footer and the Accounts "unlinked card" notice).
  openEditCardLinkModal,
  // Bank-transaction edit modal (opens from a transactions-page row
  // click) — rename / recategorize / annotate a checking-account row.
  openEditTransactionModal,
  // Sign out — clears the Supabase session and reloads to the gate.
  signOut,
  // Cash wallet charge edit — rename / recategorize a saved cash
  // expense or income from a cash-history row click.
  openEditCashChargeModal,

  // Holding info popover — hover on desktop, tap on touch. The tap
  // handler also doubles as a click-toggle for mouse users who prefer
  // click. See toggleHoldingTooltip below + the matching styles.
  toggleHoldingTooltip,

  // Salary edit modal (opens from the income row on the home page)
  openEditSalaryModal,

  // Quick-expense modal (mobile-first "I just paid for X, log it")
  openQuickExpenseModal,
  openQuickIncomeModal,
  openQuickBankExpenseModal,
  openQuickAddPicker,

  // Multi-currency cash entry — modal handles create / edit / remove
  openEditCashModal,

  // Portfolio cash-available edit (the "Cash available" hero stat)
  openEditPortfolioCashModal,

  // Vouchers / gift cards — open the add/edit modal. The page uses
  // event delegation (see the document handler below) for per-card
  // actions, so only the open-modal entry point lives on window.
  openEditGiftCardModal,

  // Locked savings / deposits — open the add/edit/delete modal. The
  // Accounts page emits onclick="openEditDepositModal(...)" on the
  // locked-row edit button and the per-bank "+ deposit" button.
  openEditDepositModal,

  // Future Wealth products — full add/edit/delete modal. The Future
  // and Assets pages emit onclick="openEditProductModal(...)" on the
  // row edit button and the "+ Add product" button.
  openEditProductModal,

  // Future Deposits — edit/delete a locked-with-release-date deposit.
  // The Future Deposits page emits onclick="openEditFutureDepositModal(...)".
  openEditFutureDepositModal,

  // Other Invested — add/edit/delete a standalone investment entry
  // (tier: 'invested', no portfolio). The Assets page emits
  // onclick="openEditStandaloneInvestmentModal(...)" on the "+" header
  // button and on each row's edit button.
  openEditStandaloneInvestmentModal,

  // Credit / debit cards — full add/edit/delete modal. The Cards page
  // emits onclick="openEditCreditCardModal(...)" on the "+ Add card"
  // header button, the empty-state button, and the per-card edit button.
  openEditCreditCardModal,

  // Data tools (sync, manual backup/restore, reload from file)
  openIBIImportFlow,
  openIsracardImportFlow,
  openMaxImportFlow,
  openCalImportFlow,
  openExpenseImportPicker,
  openBankImportFlow,
  exportDataToFile,
  openImportFlow,
  reloadFromDataFile,

  // Manual single-ticker refresh — triggered by the small sync icon
  // on the live stock-quote row in the Invested section.
  refreshStockQuoteManual,

  // AI assistant — Ask panel submit handler on the Intelligence page.
  onIntelAskSubmit,

  // Brokerage terms — the ⓘ beside a trading venue opens the panel of
  // what that venue charges (commissions, custody, FX) and when those
  // terms were last confirmed. Editable from inside the panel; the
  // record lives on data.brokerageTerms.
  openBrokerTermsModal,
  openEditBrokerTermsModal,

  // AI insights — "Refresh insights" action on the Intelligence page.
  onRefreshIntelligence,
  // AI insights — "Revert to engine analysis" toggle, clears the cached
  // AI surface and re-renders the deterministic view.
  onRevertIntelligence,
});


// ── Device class ─────────────────────────────────────────────────
//
// Sets body[data-device="mobile"|"desktop"] based on viewport width.
// The 640px breakpoint matches the phone tier in CSS where the
// bottom tab bar + FAB take over. Components that need to branch on
// device (modal → bottom sheet, tooltip → tap, etc.) read this
// attribute or query the mq directly. Tablet (641–860px) stays on
// the desktop class but uses the hamburger drawer — that middle band
// gets the existing pattern.
//
// We listen to the matchMedia change event rather than polling
// resize so orientation changes and viewport resizes both update
// without rebinding listeners.

const _phoneMQ = window.matchMedia('(max-width: 640px)');

function _applyDeviceClass() {
  // Set on documentElement so the inline pre-paint script in
  // index.html and this listener target the same node. CSS rules
  // in variables.css and mobile.css are scoped on [data-device]
  // (matches anywhere in the tree) so attribute placement is
  // irrelevant for styling — but consistency is nice for debug.
  document.documentElement.dataset.device = _phoneMQ.matches ? 'mobile' : 'desktop';
}

// Crossing the phone breakpoint changes WHAT is mounted, not just how
// it looks: phone renders one screen, desktop renders all ten. A
// resize or an orientation flip therefore needs a real re-render, or
// the user is left on a desktop layout holding a single section (or a
// phone layout holding all ten).
_phoneMQ.addEventListener('change', () => {
  _applyDeviceClass();
  if (!getAppData()) return;   // not booted yet — init() will handle it
  init();
  if (_phoneMQ.matches) _syncHistory('replace');
});


// ── Nav-bar condense on scroll ───────────────────────────────────
//
// The phone shell uses the iOS large-title pattern: each screen opens
// with its name set large in the content, and the fixed nav bar is
// transparent and title-less. Once that large title scrolls away, the
// bar fades in its own compact title and grows a hairline — so the
// user never loses "where am I" but also never pays for the chrome
// while reading the top of a screen.
//
// rAF-throttled, and it only ever toggles a class; all the visual work
// is in CSS.

(function initNavCondense() {
  const THRESHOLD = 44;
  let pending = false;

  function apply() {
    pending = false;
    document.body.classList.toggle('nav-condensed', window.scrollY > THRESHOLD);
  }

  window.addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(apply);
  }, { passive: true });

  // Navigations reset scroll imperatively, which doesn't always emit a
  // scroll event — re-evaluate on the next frame after any render.
  window.addEventListener('finance:rendered', () => requestAnimationFrame(apply));
})();


// ── Edge swipe-back ──────────────────────────────────────────────
//
// Dragging in from the inline-start edge dismisses a drilldown, the
// way every native stack navigator on both platforms behaves. This is
// the gesture whose absence is felt rather than noticed: without it a
// drilldown is a place you can only leave by aiming at a small button.
//
// Scoped tightly on purpose:
//   · phone tier only, and only inside a drilldown — tab screens are
//     siblings, not a stack, so swiping between them would be lying
//     about the navigation model;
//   · the touch must START within 24px of the edge, so it can never
//     steal a swipe from a horizontally-scrolling child (the card
//     carousel, wide tables);
//   · the direction check runs once, after 10px of travel: a
//     predominantly vertical move hands the gesture back to the
//     scroller and we never look at it again.
//
// It commits through navigateBack(), so the gesture, the nav-bar
// button and the platform's own back all share one history stack.

(function initEdgeSwipeBack() {
  const EDGE      = 24;   // px from the inline-start edge to start in
  const DECIDE    = 10;   // px of travel before we claim the gesture
  const COMMIT    = 78;   // px of travel that dismisses the screen
  const MAX_ANGLE = 0.8;  // |dy| must stay under this fraction of |dx|

  let startX = 0, startY = 0, id = null, active = false, decided = false, dx = 0;

  // In RTL the inline-start edge is the right one, and "back" travels
  // to the left — so the sign of a valid drag flips with direction.
  const backSign = () => (document.documentElement.dir === 'rtl' ? -1 : 1);
  const root = () => document.getElementById('app-content');

  function reset(animate) {
    const el = root();
    if (el) {
      el.style.transition = animate ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : '';
      el.style.transform = '';
      if (animate) setTimeout(() => { el.style.transition = ''; }, 240);
    }
    id = null; active = false; decided = false; dx = 0;
    document.body.classList.remove('is-swiping-back');
  }

  document.addEventListener('touchstart', (e) => {
    if (!isPhone() || _currentView.type === 'dashboard') return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const fromEdge = backSign() > 0
      ? t.clientX <= EDGE
      : t.clientX >= window.innerWidth - EDGE;
    if (!fromEdge) return;
    id = t.identifier; startX = t.clientX; startY = t.clientY;
    active = true; decided = false; dx = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = [...e.touches].find(x => x.identifier === id);
    if (!t) return;

    const rawX = t.clientX - startX;
    const rawY = t.clientY - startY;

    if (!decided) {
      if (Math.abs(rawX) < DECIDE && Math.abs(rawY) < DECIDE) return;
      // Wrong axis, or dragging away from the edge instead of in from
      // it — not our gesture. Release it and stop tracking.
      if (Math.abs(rawY) > Math.abs(rawX) * MAX_ANGLE || rawX * backSign() <= 0) {
        reset(false);
        return;
      }
      decided = true;
      document.body.classList.add('is-swiping-back');
    }

    // Follow the finger, clamped to the "back" direction only, with
    // resistance past the commit point so the screen doesn't slide
    // arbitrarily far off.
    const travel = Math.max(0, rawX * backSign());
    dx = travel > COMMIT ? COMMIT + (travel - COMMIT) * 0.35 : travel;

    const el = root();
    if (el) {
      el.style.transition = '';
      el.style.transform = `translateX(${dx * backSign()}px)`;
    }
    // The page must not scroll underneath a claimed horizontal drag.
    e.preventDefault();
  }, { passive: false });

  function end() {
    if (!active) return;
    const commit = decided && dx >= COMMIT;
    reset(!commit);            // spring back only when we're staying
    if (commit) navigateBack();
  }

  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();


// ── Service worker ───────────────────────────────────────────────
//
// Registered only in real mode: the public demo (`?v_display`) is
// contractually zero-persistence, and a service worker is persistence.
// Registration is deferred to `load` so it never competes with the
// first paint or the initial Supabase fetch for bandwidth.
//
// Deliberately no auto-reload on `controllerchange`. A new worker
// taking control mid-session leaves this tab running the code it
// booted with — exactly the situation of any long-lived tab with no
// worker at all — and since the worker is network-first, the next
// natural navigation already picks up fresh assets. Yanking the page
// out from under someone half-way through an expense form to save
// them one reload is a bad trade.

function _registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (isDemoMode()) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('[sw] registration failed', err);
    });
  });
}


// ── Vouchers page: search + sort + click delegation ──────────────
//
// The gift-cards section uses event delegation rather than inline
// onclick handlers so the controls survive every init() re-render.
// Filter chip clicks, View/Edit actions, search input, and sort
// dropdown all route through here. The page module owns the
// filter/search/sort state — we just call its setters and
// re-render in place.

function _rerenderVouchers() {
  rerenderSection('gift-cards', renderGiftCards(getAppData()));
}

document.addEventListener('click', (e) => {
  const inSection = e.target.closest('#gift-cards');
  if (!inSection) return;
  handleVoucherAction(e.target, _rerenderVouchers);
});

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'voucher-search') {
    setVoucherSearch(e.target.value);
    _rerenderVouchers();
    // Restore focus + caret position because rerenderSection swaps
    // the section's outerHTML. Without this the input loses focus
    // after every keystroke.
    requestAnimationFrame(() => {
      const fresh = document.getElementById('voucher-search');
      if (fresh) {
        fresh.focus();
        const len = fresh.value.length;
        try { fresh.setSelectionRange(len, len); } catch (_) {}
      }
    });
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'voucher-sort') {
    setVoucherSort(e.target.value);
    _rerenderVouchers();
  }
});


// ── Mobile holdings: tap-to-expand ───────────────────────────────
//
// On mobile each portfolio holding row collapses to: name · value.
// Tapping the row toggles .is-expanded which reveals the ticker /
// type / qty / gain / allocation line. Single document-level
// delegate — survives every init() re-render because the listener
// is bound once on the document, not on rendered rows.
//
// Gated to mobile via the matchMedia check; on desktop the
// secondary line is always visible and tapping does nothing.

document.addEventListener('click', (e) => {
  if (!_phoneMQ.matches) return;
  const row = e.target.closest('.holding-row.holding-row--portfolio');
  if (!row) return;
  // Don't intercept taps on the per-row icon buttons (info, sync,
  // edit) — those have their own onclick handlers that should win.
  if (e.target.closest('button')) return;
  row.classList.toggle('is-expanded');
});


// ── FAB scroll-quiet ─────────────────────────────────────────────
//
// The FAB fights content when it's at full opacity over a long
// scroll. We fade it down to ~42% while the user is scrolling
// down through content, and restore full opacity once they pause
// or scroll up. Pure CSS handles the visual — JS just toggles
// body.fab-quiet based on scroll direction.
//
// rAF-throttled so we don't read scrollY 60+ times per second.

(function initFabScrollQuiet() {
  let lastY     = 0;
  let pending   = false;
  let quietUntil = 0;

  function tick() {
    pending = false;
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;

    // Active scrolling down (and not at the very top) → fade.
    // Idle / scroll up / near top → restore.
    if (y > 80 && dy > 2) {
      document.body.classList.add('fab-quiet');
      quietUntil = performance.now() + 900;
    } else if (dy < -2 || y <= 40) {
      document.body.classList.remove('fab-quiet');
    }
  }

  // Restore opacity ~900ms after the last downward scroll tick,
  // so when the user stops moving the FAB calmly reappears.
  setInterval(() => {
    if (!document.body.classList.contains('fab-quiet')) return;
    if (performance.now() < quietUntil) return;
    document.body.classList.remove('fab-quiet');
  }, 200);

  window.addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(tick);
  }, { passive: true });
})();


// ── Boot ─────────────────────────────────────────────────────────
// Module scripts are deferred, so by the time this runs the DOM is
// already parsed. The readyState check covers the edge case where a
// later refactor pulls boot earlier in the load cycle.
//
// The app no longer renders unconditionally: guard() shows the login
// screen and only invokes init() once an allow-listed Supabase session
// exists. Data fetches (loadData → Supabase) then run with that
// session, which RLS requires.

function _boot() {
  _applyDeviceClass();
  _registerServiceWorker();

  // One-time wiring for the shell's back button. Lives on the static
  // markup in index.html, so it survives every init() re-render.
  const backBtn = document.getElementById('topbar-back');
  if (backBtn) backBtn.addEventListener('click', navigateBack);

  // Deep link into a screen. Reloading (or reopening the installed
  // app) lands back where the user was rather than always on the
  // dashboard, and the manifest's "Quick expense" shortcut opens
  // straight into the add sheet.
  const fromHash = _screenFromHash();
  if (fromHash) _mobileScreen = fromHash;

  guard(() => {
    init();
    _syncHistory('replace');

    if (new URLSearchParams(window.location.search).get('action') === 'quick-expense'
        && !isDemoMode()) {
      // After the first paint, so the sheet animates over a rendered
      // screen instead of an empty shell.
      requestAnimationFrame(() => openQuickAddPicker());
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}
