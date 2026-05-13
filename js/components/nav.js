import { t, currentLang } from '../i18n.js';
import { navigateToSection } from '../app.js';

// ─── State ────────────────────────────────────────────────────
let _navReady       = false;
let _sectionObserver = null;

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
};

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

  // (Re)start section observer
  startSectionObserver();
}

// ─── Active section highlight ─────────────────────────────────

function startSectionObserver() {
  if (_sectionObserver) _sectionObserver.disconnect();

  const sections = document.querySelectorAll('.section[id]');

  _sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === entry.target.id);
      });
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
