// ─────────────────────────────────────────────────────────────────
//  TOAST — global, non-intrusive failure notifications
//
//  Lightweight stand-alone component. Lives outside the modal stack
//  and outside the section re-render path: a single host container
//  is appended to <body> lazily, and each toast is one child node
//  inside it. Re-renders of #app-content never wipe toasts.
//
//  Usage:
//    showToast({
//      message: 'Could not sync Bank Hapoalim market data',
//      details: 'Status: 403\nError: CORS blocked request',
//      tone:    'error' | 'info',   // optional, defaults to 'error'
//    });
//
//  Behaviour:
//    · Auto-dismisses after 12s for info, 20s for error (long enough
//      to read the technical details).
//    · Manual dismiss via the × button.
//    · "Details" expander reveals the technical payload; Copy button
//      writes it to the clipboard for pasting into a bug report.
//    · Stacks bottom-end-of-page (bottom-right LTR, bottom-left RTL)
//      via CSS logical positioning.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';

const HOST_ID = 'toast-host';

const AUTO_DISMISS_MS = {
  info:  8000,
  error: 20000,
};

function _ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  return host;
}

export function showToast({ message, details = '', tone = 'error' } = {}) {
  const host = _ensureHost();

  const toast = document.createElement('div');
  toast.className = `toast toast--${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.dir = currentLang === 'he' ? 'rtl' : 'ltr';

  const iconHtml = tone === 'error' ? _iconError : _iconInfo;
  const detailsId = `toast-details-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon" aria-hidden="true">${iconHtml}</span>
      <span class="toast-message">${_escapeHtml(message)}</span>
      <button type="button" class="toast-dismiss icon-btn" aria-label="${t('toast.dismiss')}">×</button>
    </div>
    ${details ? `
      <div class="toast-body">
        <button type="button" class="toast-toggle" aria-expanded="false" aria-controls="${detailsId}">
          ${t('toast.showDetails')}
        </button>
        <div class="toast-details" id="${detailsId}" hidden>
          <pre class="toast-details-text" dir="ltr">${_escapeHtml(details)}</pre>
          <button type="button" class="toast-copy">${t('toast.copy')}</button>
        </div>
      </div>
    ` : ''}
  `;

  // ── Wire up handlers ────────────────────────────────────────────
  const dismissBtn = toast.querySelector('.toast-dismiss');
  dismissBtn.addEventListener('click', () => _removeToast(toast));

  const toggleBtn = toast.querySelector('.toast-toggle');
  const detailsEl = toast.querySelector('.toast-details');
  if (toggleBtn && detailsEl) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = !detailsEl.hidden;
      detailsEl.hidden = isOpen;
      toggleBtn.setAttribute('aria-expanded', String(!isOpen));
      toggleBtn.textContent = isOpen ? t('toast.showDetails') : t('toast.hideDetails');
    });
  }

  const copyBtn = toast.querySelector('.toast-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(details);
        copyBtn.textContent = t('toast.copied');
        setTimeout(() => { copyBtn.textContent = t('toast.copy'); }, 1500);
      } catch {
        copyBtn.textContent = t('toast.copyFailed');
      }
    });
  }

  host.appendChild(toast);

  // ── Auto-dismiss ────────────────────────────────────────────────
  const ttl = AUTO_DISMISS_MS[tone] ?? AUTO_DISMISS_MS.error;
  const dismissTimer = setTimeout(() => _removeToast(toast), ttl);
  // Pause auto-dismiss while the user hovers the toast.
  toast.addEventListener('mouseenter', () => clearTimeout(dismissTimer));

  // Fade in on next frame so the CSS transition fires.
  requestAnimationFrame(() => toast.classList.add('is-visible'));
}

function _removeToast(toast) {
  toast.classList.remove('is-visible');
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), 250);
}

function _escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const _iconError = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none"/></svg>`;
const _iconInfo  = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="4.5" r="0.6" fill="currentColor" stroke="none"/></svg>`;
