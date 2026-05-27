// ─────────────────────────────────────────────────────────────────
//  VOUCHERS & GIFT CARDS — restricted store-credit assets
//
//  Page layout:
//    · Header strip — total remaining + active count + expiring-soon count
//    · Toolbar     — search input · filter chips · sort dropdown · "+ Add"
//    · Card grid   — per-voucher card with quick details and view-file action
//
//  Voucher value joins net worth via calcGiftCardsTotal (utils.js).
//  Files live in Supabase Storage as paths on attachment.ref; we
//  mint a signed URL on demand when the user clicks "View file".
//
//  Filter / sort / search state is module-local and survives
//  re-renders within the same dashboard view (similar to the
//  spending and transactions pages' month-step state).
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency, calcGiftCardsTotal } from '../utils.js';
import { formatForeignAmount } from '../fx.js';
import { getAttachmentURL } from '../voucher-storage.js';
import { getAppData } from '../state.js';
import { showToast } from '../components/toast.js';
import { openEditGiftCardModal } from '../components/edit-gift-card.js';

function _formatVoucherAmount(amount, currency) {
  const code = currency || 'ILS';
  return code === 'ILS' ? formatCurrency(amount) : formatForeignAmount(amount, code);
}

// ── Page-local filter/sort/search state ──────────────────────
//
// Persisting state across re-renders so a search or filter
// selection survives the dashboard rebuild that follows any
// state-mutating action (e.g. add voucher → init() → re-render).

let _state = {
  search: '',
  filter: 'all',   // all | active | expiringSoon | partial | used | expired
  sort:   'expSoonest',
};

const EXPIRING_SOON_DAYS = 30;

// Exported so app.js can wire input handlers without renaming.
export function setVoucherSearch(value) {
  _state.search = String(value || '').trim();
}
export function setVoucherFilter(value) {
  if (typeof value === 'string') _state.filter = value;
}
export function setVoucherSort(value) {
  if (typeof value === 'string') _state.sort = value;
}

// ── Status helpers ───────────────────────────────────────────

function _todayISO() { return new Date().toISOString().slice(0, 10); }

function _daysUntil(iso) {
  if (!iso) return Infinity;
  const today = new Date(_todayISO());
  const exp   = new Date(iso);
  const ms    = exp - today;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Effective status derived from the record. Order matters: expired
// dominates "remaining" (an expired card with leftover credit is
// still unusable in practice), and "used" dominates partial.
export function effectiveStatus(card) {
  if (!card) return 'used';
  const remaining = Number(card.remainingAmount) || 0;
  const original  = Number(card.originalAmount)  || 0;
  if (card.expirationDate && card.expirationDate < _todayISO()) return 'expired';
  if (remaining <= 0) return 'used';
  if (original > 0 && remaining < original) return 'partial';
  return 'active';
}

function _statusLabel(status) {
  switch (status) {
    case 'expired': return t('vouchers.statusExpired');
    case 'used':    return t('vouchers.statusUsed');
    case 'partial': return t('vouchers.statusPartial');
    default:        return t('vouchers.statusActive');
  }
}

// ── Search/filter/sort pipeline ──────────────────────────────

function _matchesSearch(card, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [
    card.title, card.titleEn, card.notes, card.code,
    ...(Array.isArray(card.stores) ? card.stores.flatMap(s => [s.he, s.en]) : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

function _matchesFilter(card, filter) {
  const status = effectiveStatus(card);
  if (filter === 'all') return true;
  if (filter === 'active')       return status === 'active' || status === 'partial';
  if (filter === 'partial')      return status === 'partial';
  if (filter === 'used')         return status === 'used';
  if (filter === 'expired')      return status === 'expired';
  if (filter === 'expiringSoon') {
    if (status === 'expired' || status === 'used') return false;
    const d = _daysUntil(card.expirationDate);
    return Number.isFinite(d) && d >= 0 && d <= EXPIRING_SOON_DAYS;
  }
  return true;
}

function _compare(a, b, sort) {
  if (sort === 'remainingDesc') {
    return (Number(b.remainingAmount) || 0) - (Number(a.remainingAmount) || 0);
  }
  if (sort === 'recent') {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }
  if (sort === 'store') {
    const sa = _primaryStoreLabel(a) || '';
    const sb = _primaryStoreLabel(b) || '';
    return sa.localeCompare(sb, currentLang === 'he' ? 'he' : 'en');
  }
  // expSoonest (default): nulls sort last; ascending date.
  const da = a.expirationDate || '9999-12-31';
  const db = b.expirationDate || '9999-12-31';
  return da.localeCompare(db);
}

function _primaryStoreLabel(card) {
  const s = Array.isArray(card.stores) ? card.stores[0] : null;
  if (!s) return '';
  return currentLang === 'he' ? (s.he || s.en || '') : (s.en || s.he || '');
}

// ── Render ───────────────────────────────────────────────────

export function renderGiftCards(data) {
  const cards     = Array.isArray(data.giftCards) ? data.giftCards : [];
  const total     = calcGiftCardsTotal(data);
  const visible   = cards
    .filter(c => _matchesSearch(c, _state.search))
    .filter(c => _matchesFilter(c, _state.filter))
    .slice()
    .sort((a, b) => _compare(a, b, _state.sort));

  const activeCount = cards.filter(c => {
    const s = effectiveStatus(c);
    return s === 'active' || s === 'partial';
  }).length;

  const expiringCount = cards.filter(c => {
    const s = effectiveStatus(c);
    if (s === 'expired' || s === 'used') return false;
    const d = _daysUntil(c.expirationDate);
    return Number.isFinite(d) && d >= 0 && d <= EXPIRING_SOON_DAYS;
  }).length;

  return `
    <section class="section" id="gift-cards">
      <div class="section-header">
        <div class="section-header-text">
          <h2 class="section-title">${t('vouchers.title')}</h2>
          <p class="section-intro">${t('vouchers.intro')}</p>
        </div>
        <button class="btn btn-primary requires-write" type="button"
                onclick="openEditGiftCardModal()">+ ${t('vouchers.addBtn')}</button>
      </div>

      ${cards.length === 0 ? `
        <div class="empty-state">${t('vouchers.empty')}</div>
      ` : `
        <div class="voucher-summary">
          <div class="voucher-summary-stat">
            <span class="voucher-summary-label">${t('vouchers.headerTotal')}</span>
            <span class="voucher-summary-value">${formatCurrency(total)}</span>
          </div>
          <div class="voucher-summary-stat">
            <span class="voucher-summary-label">${t('vouchers.headerActive')}</span>
            <span class="voucher-summary-value">${activeCount}</span>
          </div>
          <div class="voucher-summary-stat">
            <span class="voucher-summary-label">${t('vouchers.headerExpiringSoon')}</span>
            <span class="voucher-summary-value">${expiringCount}</span>
          </div>
        </div>

        ${_renderToolbar()}

        ${visible.length === 0 ? `
          <div class="empty-state">${t('vouchers.empty')}</div>
        ` : `
          <div class="voucher-grid">
            ${visible.map(_renderVoucherCard).join('')}
          </div>
        `}
      `}
    </section>
  `;
}

function _renderToolbar() {
  const chips = [
    ['all',          t('vouchers.filterAll')],
    ['active',       t('vouchers.filterActive')],
    ['expiringSoon', t('vouchers.filterExpiringSoon')],
    ['partial',      t('vouchers.filterPartial')],
    ['used',         t('vouchers.filterUsed')],
    ['expired',      t('vouchers.filterExpired')],
  ].map(([key, label]) => `
    <button type="button" class="voucher-chip ${_state.filter === key ? 'is-active' : ''}"
            data-voucher-filter="${key}">${label}</button>
  `).join('');

  const sortOpts = [
    ['expSoonest',    t('vouchers.sortExpSoonest')],
    ['remainingDesc', t('vouchers.sortRemainingDesc')],
    ['recent',        t('vouchers.sortRecent')],
    ['store',         t('vouchers.sortStore')],
  ].map(([key, label]) =>
    `<option value="${key}" ${_state.sort === key ? 'selected' : ''}>${label}</option>`
  ).join('');

  return `
    <div class="voucher-toolbar">
      <input type="search" class="form-input voucher-search" id="voucher-search"
             placeholder="${t('vouchers.searchPlaceholder')}"
             value="${_esc(_state.search)}" />
      <div class="voucher-chips">${chips}</div>
      <label class="voucher-sort">
        <span>${t('vouchers.sortLabel')}:</span>
        <select class="form-select" id="voucher-sort">${sortOpts}</select>
      </label>
    </div>
  `;
}

function _renderVoucherCard(card) {
  const status      = effectiveStatus(card);
  const statusClass = `is-${status}`;
  const remaining   = Number(card.remainingAmount) || 0;
  const original    = Number(card.originalAmount)  || 0;
  const stores      = (Array.isArray(card.stores) ? card.stores : [])
    .map(s => currentLang === 'he' ? (s.he || s.en) : (s.en || s.he))
    .filter(Boolean);
  const title       = currentLang === 'he'
    ? (card.title || card.titleEn || '')
    : (card.titleEn || card.title || '');
  const hasFile     = !!(card.attachment && card.attachment.ref);
  const daysLeft    = _daysUntil(card.expirationDate);
  const expHtml     = _expirationHtml(card.expirationDate, daysLeft, status);

  return `
    <article class="voucher-card ${statusClass}" data-voucher-id="${card.id}">
      <header class="voucher-card-head">
        <div class="voucher-card-title-block">
          <h3 class="voucher-card-title">${_esc(title)}</h3>
          <div class="voucher-card-stores">${_esc(stores.join(' · '))}</div>
        </div>
        <span class="voucher-card-status">${_statusLabel(status)}</span>
      </header>

      <div class="voucher-card-amount">
        <span class="voucher-card-remaining">${_formatVoucherAmount(remaining, card.currency)}</span>
        ${original > 0 && original !== remaining
          ? `<span class="voucher-card-of-original">/ ${_formatVoucherAmount(original, card.currency)}</span>`
          : ''}
      </div>

      <footer class="voucher-card-foot">
        ${expHtml}
        <div class="voucher-card-actions">
          ${hasFile
            ? `<button type="button" class="btn btn-ghost btn-sm" data-voucher-view="${card.id}">${t('vouchers.viewAttachment')}</button>`
            : ''}
          <button type="button" class="btn btn-ghost btn-sm requires-write" data-voucher-edit="${card.id}">${t('editVoucher.titleEdit')}</button>
        </div>
      </footer>
    </article>
  `;
}

function _expirationHtml(iso, days, status) {
  if (status === 'expired') {
    return `<span class="voucher-card-exp is-expired">${t('vouchers.expiredOn')} · ${_esc(iso || '')}</span>`;
  }
  if (!iso) return `<span class="voucher-card-exp is-none">—</span>`;
  if (days <= EXPIRING_SOON_DAYS) {
    return `<span class="voucher-card-exp is-soon">${_esc(iso)} · ${t('vouchers.expiresIn').replace('{days}', String(days))}</span>`;
  }
  return `<span class="voucher-card-exp">${_esc(iso)}</span>`;
}

// ── Click + input handler invoked from app.js ────────────────
//
// Action dispatch for the gift-cards page. app.js wires a single
// document-level listener that routes voucher-* attributes to the
// page-local handlers below. Keeps the inline-handler bridge thin.

// Returns true when the click was handled by this page, so the
// document-level delegate in app.js can `return` without falling
// through to other handlers.
export async function handleVoucherAction(target, rerender) {
  const view = target.closest('[data-voucher-view]');
  if (view) {
    await _openAttachment(view.getAttribute('data-voucher-view'));
    return true;
  }
  const edit = target.closest('[data-voucher-edit]');
  if (edit) {
    openEditGiftCardModal(edit.getAttribute('data-voucher-edit'));
    return true;
  }
  const chip = target.closest('[data-voucher-filter]');
  if (chip) {
    setVoucherFilter(chip.getAttribute('data-voucher-filter'));
    if (typeof rerender === 'function') rerender();
    return true;
  }
  return false;
}

async function _openAttachment(cardId) {
  const data = getAppData();
  const list = data && Array.isArray(data.giftCards) ? data.giftCards : [];
  const card = list.find(c => c.id === cardId);
  if (!card || !card.attachment || !card.attachment.ref) return;
  const url = await getAttachmentURL(card.attachment.ref);
  if (!url) {
    showToast({ tone: 'error', message: t('editVoucher.uploadFailed') });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
