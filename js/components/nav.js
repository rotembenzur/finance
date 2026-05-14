import { t, currentLang } from '../i18n.js';
import { navigateToSection } from '../app.js';
import { openDataMenu } from './data-io.js';
import { openExpenseImportPicker } from '../import/expense-import-picker.js';

// ─── State ────────────────────────────────────────────────────
let _navReady       = false;
let _sectionObserver = null;
// Tracks the currently-active section so the bottom tab bar can
// reflect the right tab even while it's not in the DOM (re-renders
// inject the bar, but the IntersectionObserver fires across renders).
let _activeSection  = 'dashboard';

// ─── SVG Icons ────────────────────────────────────────────────

const ICONS = {
  dashboard: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor"/>
    <rect x="10.5" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor"/>
    <rect x="1" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor"/>
    <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor"/>
  </svg>`,

  accounts: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 1.5L1.5 5.5H16.5L9 1.5Z" fill="currentColor"/>
    <rect x="2.5" y="6.5" width="3" height="6.5" rx="0.5" fill="currentColor"/>
    <rect x="7.5" y="6.5" width="3" height="6.5" rx="0.5" fill="currentColor"/>
    <rect x="12.5" y="6.5" width="3" height="6.5" rx="0.5" fill="currentColor"/>
    <rect x="1.5" y="14" width="15" height="2" rx="1" fill="currentColor"/>
  </svg>`,

  cards: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="4" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/>
    <line x1="1" y1="8" x2="17" y2="8" stroke="currentColor" stroke-width="1.5"/>
    <rect x="3" y="11" width="3" height="1.5" rx="0.5" fill="currentColor"/>
    <rect x="7.5" y="11" width="2" height="1.5" rx="0.5" fill="currentColor"/>
  </svg>`,

  assets: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polyline points="1,14 5.5,8.5 9.5,11 16,3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="11.5,3.5 16,3.5 16,8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // Future Wealth — circular clock with a forward-leaning hand.
  // Suggests time-horizon / "later" — long-term growth.
  future: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.6"/>
    <path d="M9 5v4l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // Future Deposits — vault/safe with a clock dial. Suggests
  // "locked, will release at a known time".
  futureDeposits: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M9 9l1.5-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  // Transactions — horizontal flow lines suggesting "money moving
  // in and out of the account". Sits between Cards (spending) and
  // Assets (long-term capital) in the nav.
  transactions: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6h10l-2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M15 12H5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  // Intelligence — a stylized analytical-overlay glyph: three vertical
  // bars at differing heights (composition) with a tracking arc
  // connecting them. Reads as "structured analysis" rather than
  // "chatbot" — the editorial tone the page itself targets.
  intelligence: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="9.5" width="2.4" height="6" rx="0.5" fill="currentColor"/>
    <rect x="5.6" y="6" width="2.4" height="9.5" rx="0.5" fill="currentColor"/>
    <rect x="9.2" y="3" width="2.4" height="12.5" rx="0.5" fill="currentColor"/>
    <path d="M3 7.5 Q 8 3.5 13 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>
    <circle cx="13" cy="2.5" r="1.4" fill="currentColor"/>
  </svg>`,

  // "More" tab — three horizontal dots, a universal "additional
  // destinations" affordance.
  more: `<svg class="nav-item-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="3.5" cy="9" r="1.4" fill="currentColor"/>
    <circle cx="9"   cy="9" r="1.4" fill="currentColor"/>
    <circle cx="14.5" cy="9" r="1.4" fill="currentColor"/>
  </svg>`,

  chevronEnd: `<svg class="nav-more-row-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 3l4 4-4 4"/>
  </svg>`,

  database: `<svg class="nav-more-row-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
    <ellipse cx="9" cy="4" rx="6" ry="2"/>
    <path d="M3 4v5c0 1.1 2.7 2 6 2s6-0.9 6-2V4"/>
    <path d="M3 9v5c0 1.1 2.7 2 6 2s6-0.9 6-2V9"/>
  </svg>`,

  globe: `<svg class="nav-more-row-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="9" cy="9" r="7"/>
    <path d="M2 9h14M9 2c2.5 2.6 2.5 11.4 0 14M9 2c-2.5 2.6-2.5 11.4 0 14"/>
  </svg>`,

  upload: `<svg class="nav-more-row-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 12V3"/>
    <path d="M5.5 6.5L9 3l3.5 3.5"/>
    <path d="M3 13v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V13"/>
  </svg>`,
};

// ─── Bottom-tab primary destinations ──────────────────────────
// Five tabs is the iOS sweet spot. "More" opens a sheet that hosts
// the remaining destinations + the language toggle and data tools.
// Ordering matches the natural finance journey: where I stand →
// what I can spend → what I owe → what I own → everything else.
const BOTTOM_TABS = [
  { key: 'nav.dashboard', icon: 'dashboard', section: 'dashboard' },
  { key: 'nav.accounts',  icon: 'accounts',  section: 'accounts'  },
  { key: 'nav.cards',     icon: 'cards',     section: 'cards'     },
  { key: 'nav.assets',    icon: 'assets',    section: 'assets'    },
  { key: 'nav.more',      icon: 'more',      section: '__more__'  },
];

// Destinations that aren't on the bottom bar — surfaced in the
// "More" sheet. Anything on the bottom bar is intentionally
// excluded here to avoid duplicates.
const MORE_SECTIONS = [
  { key: 'nav.intelligence',   icon: 'intelligence',   section: 'intelligence'    },
  { key: 'nav.transactions',   icon: 'transactions',   section: 'transactions'    },
  { key: 'nav.future',         icon: 'future',         section: 'future'          },
  { key: 'nav.futureDeposits', icon: 'futureDeposits', section: 'future-deposits' },
];

// ─── Nav rendering ────────────────────────────────────────────

export function renderNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  const items = [
    { key: 'nav.dashboard',      icon: ICONS.dashboard,      section: 'dashboard'        },
    { key: 'nav.accounts',       icon: ICONS.accounts,       section: 'accounts'         },
    { key: 'nav.transactions',   icon: ICONS.transactions,   section: 'transactions'     },
    { key: 'nav.cards',          icon: ICONS.cards,          section: 'cards'            },
    { key: 'nav.assets',         icon: ICONS.assets,         section: 'assets'           },
    { key: 'nav.future',         icon: ICONS.future,         section: 'future'           },
    { key: 'nav.futureDeposits', icon: ICONS.futureDeposits, section: 'future-deposits'  },
    { key: 'nav.intelligence',   icon: ICONS.intelligence,   section: 'intelligence'     },
  ];

  // Rail is icon-only; the section label is announced via the
  // tooltip and (in the future) screen-reader aria-label.
  nav.innerHTML = items.map(item => `
    <button class="nav-item" data-section="${item.section}" title="${t(item.key)}" aria-label="${t(item.key)}">
      ${item.icon}
    </button>
  `).join('');

  // Update translated text outside #app-content
  const footerLabel = document.getElementById('sidebar-footer-label');
  if (footerLabel) footerLabel.textContent = t('sidebar.footer');

  // Sync language toggle button active state
  const btnEn = document.getElementById('lang-btn-en');
  const btnHe = document.getElementById('lang-btn-he');
  if (btnEn && btnHe) {
    btnEn.classList.toggle('active', currentLang === 'en');
    btnHe.classList.toggle('active', currentLang === 'he');
  }

  // Wire scroll-to-section on nav item click. Routes through the
  // view-aware navigateToSection so the click works even when the
  // user is currently inside a drilldown view (e.g. the charges
  // page) — that wrapper switches back to the dashboard first, then
  // scrolls to the requested section.
  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToSection(btn.dataset.section);
      if (window.innerWidth <= 860) closeSidebar();
    });
  });

  renderBottomTabs();

  // (Re)start section observer
  startSectionObserver();
}

// ─── Bottom tab bar (mobile primary nav) ──────────────────────
//
// Rendered on every init() because the i18n labels can change
// when the user toggles language. Tap handlers are inline-bound
// (small N, no listener accumulation since innerHTML wipes them).
// The "More" tab opens a sheet hosting secondary destinations;
// every other tab maps to a real section id and scrolls to it.

export function renderBottomTabs() {
  const bar = document.getElementById('bottom-tabs');
  if (!bar) return;

  bar.innerHTML = BOTTOM_TABS.map(item => `
    <button
      class="bottom-tab${_activeSection === item.section ? ' active' : ''}"
      type="button"
      data-section="${item.section}"
      aria-label="${t(item.key)}"
    >
      ${ICONS[item.icon]
        .replace('class="nav-item-icon"', 'class="bottom-tab-icon"')}
      <span class="bottom-tab-label">${t(item.key)}</span>
    </button>
  `).join('');

  bar.querySelectorAll('.bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (section === '__more__') {
        openMoreSheet();
        return;
      }
      navigateToSection(section);
    });
  });
}

// ─── "More" sheet ─────────────────────────────────────────────
//
// Reuses the modal-overlay (which becomes a bottom sheet on mobile
// via CSS) so this destination feels native: it slides up from the
// bottom, dims the page behind, and is dismissed with the same
// gestures as any other modal. The list itself is the secondary
// destinations + language toggle + data tools — anything that
// doesn't deserve a primary tab.

function openMoreSheet() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');
  if (!overlay) return;

  titleEl.textContent     = t('nav.moreTitle');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('data.close') || 'Close';
  overlay.classList.remove('modal-overlay--wide');

  const sectionRows = MORE_SECTIONS.map(item => `
    <button class="nav-more-row" type="button" data-section="${item.section}">
      ${ICONS[item.icon].replace('class="nav-item-icon"', 'class="nav-more-row-icon"')}
      <span class="nav-more-row-label">${t(item.key)}</span>
      ${ICONS.chevronEnd}
    </button>
  `).join('');

  // Language toggle + data menu live below the destinations.
  // Tapping the language row flips to the other language and
  // closes the sheet; tapping data opens the data menu in place
  // of the More sheet.
  const otherLang = currentLang === 'en' ? 'he' : 'en';

  bodyEl.innerHTML = `
    <div class="nav-more-list">
      ${sectionRows}
      <button class="nav-more-row" type="button" data-action="import">
        ${ICONS.upload}
        <span class="nav-more-row-label">${t('importPicker.button')}</span>
        ${ICONS.chevronEnd}
      </button>
      <button class="nav-more-row" type="button" data-action="lang">
        ${ICONS.globe}
        <span class="nav-more-row-label">${t('nav.lang')}</span>
        ${ICONS.chevronEnd}
      </button>
      <button class="nav-more-row" type="button" data-action="data">
        ${ICONS.database}
        <span class="nav-more-row-label">${t('data.title') || 'Data'}</span>
        ${ICONS.chevronEnd}
      </button>
    </div>
  `;

  overlay.classList.add('open');

  bodyEl.querySelectorAll('.nav-more-row').forEach(row => {
    row.addEventListener('click', () => {
      const action = row.dataset.action;
      if (action === 'lang') {
        window.setLanguage(otherLang);
        overlay.classList.remove('open');
        return;
      }
      if (action === 'data') {
        overlay.classList.remove('open');
        openDataMenu();
        return;
      }
      if (action === 'import') {
        overlay.classList.remove('open');
        openExpenseImportPicker();
        return;
      }
      const section = row.dataset.section;
      overlay.classList.remove('open');
      if (section) navigateToSection(section);
    });
  });
}

// ─── Active section highlight ─────────────────────────────────

function _setActiveSection(id) {
  _activeSection = id;
  // Sidebar rail items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === id);
  });
  // Bottom tabs. Sections that aren't on the bar (e.g.
  // 'transactions', 'future', 'future-deposits') leave every tab
  // inactive — which is correct: we're inside "More" territory.
  document.querySelectorAll('.bottom-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === id);
  });
}

function startSectionObserver() {
  if (_sectionObserver) _sectionObserver.disconnect();

  const sections = document.querySelectorAll('.section[id]');

  _sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      _setActiveSection(entry.target.id);
    });
  }, { rootMargin: '-15% 0px -75% 0px' });

  sections.forEach(s => _sectionObserver.observe(s));
}

// ─── Sidebar open / close ─────────────────────────────────────

export function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle  = document.getElementById('menu-toggle');
  sidebar.classList.add('open');
  overlay.classList.add('visible');
  toggle.classList.add('open');
}

export function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle  = document.getElementById('menu-toggle');
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  toggle.classList.remove('open');
}

export function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
}

// ─── One-time event wiring ────────────────────────────────────

export function initNav() {
  renderNav();

  if (_navReady) return;
  _navReady = true;

  const toggle  = document.getElementById('menu-toggle');
  const overlay = document.getElementById('sidebar-overlay');

  if (toggle)  toggle.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
}
