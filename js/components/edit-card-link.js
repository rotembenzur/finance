// ─────────────────────────────────────────────────────────────────
//  EDIT CARD LINK — choose which checking account a card bills from
//
//  A credit card's pending charges are subtracted from the projected
//  balance of the checking account it bills from (see
//  calcCardChargesForBank). The link is stored as `card.bankId`,
//  matched against each checking account's `bankId`. This modal lets
//  the user set or change that link — or clear it ("not linked").
//
//  Targets are the distinct banks that have an active checking
//  account (linking is by bank, since the projection matches on
//  bankId and each bank holds one checking account here). A blank
//  option clears the link.
//
//  Rides the shared modal shell; modal.js routes the save through
//  hasPendingCardLinkEdit / applyPendingCardLinkEdit.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import { getBankAccountEntries, getBank, getBankDisplayName } from '../utils.js';

let _editCardId = null;

// ── Public API ────────────────────────────────────────────────

export function openEditCardLinkModal(cardId) {
  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === cardId);
  if (!card) return;

  _editCardId = cardId;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('cardLink.title');
  saveBtnEl.style.display  = '';
  saveBtnEl.textContent    = t('modal.save');
  saveBtnEl.className       = 'btn btn-primary';
  cancelEl.textContent     = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = _renderForm(card, data);
  overlay.classList.add('open');
}

export function hasPendingCardLinkEdit()   { return _editCardId !== null; }
export function clearPendingCardLinkEdit() { _editCardId = null; }

export function applyPendingCardLinkEdit() {
  if (!_editCardId) return false;

  const data = getAppData();
  const card = (data.cards || []).find(c => c.id === _editCardId);
  if (!card) { _editCardId = null; return false; }

  const sel = document.querySelector('input[name="card-link"]:checked');
  card.bankId = sel && sel.value ? sel.value : null;
  card.updatedAt = todayISO();
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _editCardId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form ──────────────────────────────────────────────────────

function _renderForm(card, data) {
  const displayName = currentLang === 'he' ? card.name : (card.nameEn || card.name);
  const targets     = _linkTargets(data);

  const options = targets.map(tg => `
    <label class="card-link-option">
      <input type="radio" name="card-link" value="${_esc(tg.bankId)}" ${card.bankId === tg.bankId ? 'checked' : ''} />
      <span class="card-link-option-text">${_esc(tg.label)}</span>
    </label>
  `).join('');

  // "Not linked" is selected when the card has no bankId, or a bankId
  // that no longer matches any checking account (stale link).
  const noneChecked = !card.bankId || !targets.some(tg => tg.bankId === card.bankId);

  return `
    <div class="card-link">
      <div class="card-link-card">${_esc(displayName)} · ${card.last4}</div>
      <p class="card-link-intro">${card.isDebit ? t('cardLink.introDebit') : t('cardLink.intro')}</p>
      <div class="card-link-options">
        ${options}
        <label class="card-link-option">
          <input type="radio" name="card-link" value="" ${noneChecked ? 'checked' : ''} />
          <span class="card-link-option-text">${t('cardLink.none')}</span>
        </label>
      </div>
    </div>
  `;
}

// Distinct banks that have an active checking account — one option per
// bank (the projection links by bankId). Labelled "<bank> · <account>".
function _linkTargets(data) {
  const checking = getBankAccountEntries(data)
    .filter(e => e.type === 'checking' && e.isActive !== false && e.bankId);

  const seen = new Set();
  const out = [];
  for (const acct of checking) {
    if (seen.has(acct.bankId)) continue;
    seen.add(acct.bankId);
    const bank     = getBank(data, acct.bankId);
    const bankName = bank ? getBankDisplayName(bank) : acct.bankId;
    const acctName = currentLang === 'he' ? (acct.name || '') : (acct.nameEn || acct.name || '');
    out.push({ bankId: acct.bankId, label: [bankName, acctName].filter(Boolean).join(' · ') });
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
