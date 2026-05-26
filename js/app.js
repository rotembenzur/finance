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
import { initNav } from './components/nav.js';

import { renderDashboard } from './pages/dashboard.js';
import {
  renderAccounts,
  enterCashEdit, saveCashEdit, exitCashEdit,
  enterWalletEdit, saveWalletEdit, exitWalletEdit,
} from './pages/accounts.js';
import { renderCards, flipCard, initCardsWallet, focusCardAt, viewActiveCardCharges } from './pages/cards.js';
import { renderAssets, highlightAllocationSegment, clearAllocationHighlight } from './pages/assets.js';
import { renderIntelligence, setAIInsights, setIntelRefreshing,
         setAIFingerprint, getAIFingerprint, clearAIInsights,
         computeIntelFingerprint } from './pages/intelligence.js';
import { askAssistant } from './intelligence/assistant.js';
import { refreshAIInsights } from './intelligence/insights-ai.js';
import { saveCachedInsights, clearCachedInsights } from './intelligence/insights-cache.js';
import { renderSpending, onSpendingMonthStep, onSpendingCategoryToggle } from './pages/spending.js';
import { renderFuture } from './pages/future.js';
import { renderFutureDeposits } from './pages/future-deposits.js';
import { renderCardCharges } from './pages/card-charges.js';
import { renderCashHistory } from './pages/cash-history.js';
import { renderTransactions, onActivityMonthStep, onActivityTailToggle } from './pages/transactions.js';
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
import { openEditCardLinkModal } from './components/edit-card-link.js';
import { openEditTransactionModal } from './components/edit-transaction.js';
import { openEditCashChargeModal } from './components/edit-cash-charge.js';
import { openEditSalaryModal } from './components/edit-salary.js';
import { openQuickExpenseModal } from './components/quick-expense.js';
import { openQuickIncomeModal }  from './components/quick-income.js';
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
  const prevScrollTop = scroller.scrollTop;

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
      renderSpending(data),
      renderIntelligence(data),
    ].join('');
  }

  initNav();

  // Wallet carousel needs imperative scroll + click wiring after each
  // re-render (innerHTML wipes listeners). Idempotent — does nothing
  // if the listeners were already bound for this DOM.
  initCardsWallet();

  // Restore scroll now the new (same-view) DOM is laid out, so the
  // re-render is invisible to the user instead of snapping to the top.
  scroller.scrollTop = prevScrollTop;

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
  output.innerHTML = `<p class="intel-ask-thinking">${t('assistant.thinking')}</p>`;

  const data = getAppData();
  const result = await askAssistant(question, data);

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

  // Success — render the answer as plain paragraphs. The assistant
  // is instructed (in the system prompt) to avoid bullet lists by
  // default, so this splits on blank lines only.
  const paragraphs = result.answer
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);

  const qHtml = `<div class="intel-ask-q">${_esc(question)}</div>`;
  const aHtml = paragraphs.map(p => `<p class="intel-ask-a">${_esc(p)}</p>`).join('');
  output.innerHTML = `<div class="intel-ask-exchange">${qHtml}${aHtml}</div>`;

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
  openQuickAddPicker,

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

  // AI assistant — Ask panel submit handler on the Intelligence page.
  onIntelAskSubmit,

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

_phoneMQ.addEventListener('change', _applyDeviceClass);


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
  guard(() => init());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}
