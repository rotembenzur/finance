// ─────────────────────────────────────────────────────────────────
//  EDIT PORTFOLIO CASH
//
//  A focused single-field modal for adjusting `portfolio.cashAvailable`
//  — the uninvested cash sitting at the broker. The user edits this
//  manually between Sync-from-broker actions; the next Sync will
//  overwrite the figure with whatever the broker reports.
//
//  Same modal-shell pattern as edit-amount / edit-cash / edit-salary:
//  open prefilled → user types → handleModalSave() routes here via
//  hasPendingPortfolioCashEdit() → applyPendingPortfolioCashEdit()
//  mutates state and triggers a re-render.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';

let _portfolioId = null;

// ── Public API ────────────────────────────────────────────────

export function openEditPortfolioCashModal(portfolioId) {
  const data = getAppData();
  const portfolio = (data.portfolios || []).find(p => p.id === portfolioId);
  if (!portfolio) return;

  _portfolioId = portfolioId;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editPortfolioCash.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  const current = portfolio.cashAvailable != null ? portfolio.cashAvailable : '';

  bodyEl.innerHTML = `
    <form class="edit-portfolio-cash" onsubmit="event.preventDefault()">
      <div class="edit-portfolio-cash-portfolio">${portfolio.name || portfolio.nameEn || ''}</div>
      <div class="form-group">
        <label class="form-label" for="f-pc-amount">${t('editPortfolioCash.amount')}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-pc-amount" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${current}"
                 placeholder="${t('editPortfolioCash.placeholder')}" />
        </div>
        <small class="form-hint">${t('editPortfolioCash.hint')}</small>
      </div>
      <p id="f-pc-error" class="form-error" style="display:none"></p>
    </form>
  `;

  overlay.classList.add('open');
  setTimeout(() => {
    const inp = document.getElementById('f-pc-amount');
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

export function hasPendingPortfolioCashEdit()   { return _portfolioId !== null; }
export function clearPendingPortfolioCashEdit() { _portfolioId = null; }

export function applyPendingPortfolioCashEdit() {
  if (!_portfolioId) return false;

  const data = getAppData();
  const idx = (data.portfolios || []).findIndex(p => p.id === _portfolioId);
  if (idx === -1) { _portfolioId = null; return false; }

  const inp = document.getElementById('f-pc-amount');
  const raw = inp ? inp.value : '';
  const parsed = parseFloat(raw);
  const errorEl = document.getElementById('f-pc-error');

  // Empty input clears the field (cashAvailable: null) — the hero
  // stat slot then drops out cleanly via _renderHeroStats's gate.
  let nextValue;
  if (raw === '' || raw == null) {
    nextValue = null;
  } else if (!Number.isFinite(parsed) || parsed < 0) {
    if (errorEl) { errorEl.textContent = t('editPortfolioCash.invalid'); errorEl.style.display = 'block'; }
    inp?.focus();
    return false;
  } else {
    nextValue = parsed;
  }

  data.portfolios[idx] = {
    ...data.portfolios[idx],
    cashAvailable: nextValue,
    updatedAt:     todayISO(),
  };
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _portfolioId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}
