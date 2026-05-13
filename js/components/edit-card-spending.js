// ─────────────────────────────────────────────────────────────────
//  EDIT CARD SPENDING — minimal modal for the monthly used-amount
//  on a credit card. Mirrors the edit-amount.js pattern but writes
//  to card.currentSpending instead of an entry's balance.
//
//  This is the only field on a card that's currently editable
//  through the UI; everything else (limit, billing day, etc.) is
//  treated as data and lives in the persisted snapshot.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';

let _editCardId = null;


// ── Public API ───────────────────────────────────────────────────

export function openEditCardSpendingModal(cardId) {
  const card = getAppData().cards.find(c => c.id === cardId);
  if (!card) return;

  _editCardId = cardId;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('editCardSpending.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  const displayName = currentLang === 'he' ? card.name : (card.nameEn || card.name);
  const value       = card.currentSpending != null ? card.currentSpending : 0;
  const limitHint   = card.creditLimit != null
    ? `<small class="form-hint">${t('editCardSpending.limit')} ₪${Number(card.creditLimit).toLocaleString('en-US')}</small>`
    : '';

  bodyEl.innerHTML = `
    <div class="edit-amount">
      <div class="edit-amount-name">${_esc(displayName)} · ${card.last4}</div>
      <div class="form-group">
        <label class="form-label" for="f-spending">${t('editCardSpending.amount')}</label>
        <div class="input-with-symbol">
          <span class="currency-symbol">₪</span>
          <input class="form-input" id="f-spending" type="number" min="0" step="0.01" value="${value}" />
        </div>
        ${limitHint}
      </div>
      <p id="f-edit-error" class="form-error" style="display:none"></p>
    </div>
  `;
  overlay.classList.add('open');

  setTimeout(() => {
    const inp = document.getElementById('f-spending');
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

export function hasPendingCardSpendingEdit() {
  return _editCardId !== null;
}

export function clearPendingCardSpendingEdit() {
  _editCardId = null;
}

export function applyPendingCardSpendingEdit() {
  if (!_editCardId) return false;

  const data = getAppData();
  const card = data.cards.find(c => c.id === _editCardId);
  if (!card) { _editCardId = null; return false; }

  const inp = document.getElementById('f-spending');
  const v   = parseFloat(inp?.value);
  if (isNaN(v) || v < 0) {
    const errorEl = document.getElementById('f-edit-error');
    if (errorEl) { errorEl.textContent = t('editAmount.invalid'); errorEl.style.display = 'block'; }
    inp?.focus?.();
    return false;
  }

  card.currentSpending = v;
  card.updatedAt = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);

  _editCardId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  init();
  return true;
}


// ── Helpers ──────────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
