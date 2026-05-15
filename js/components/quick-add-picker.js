// ─────────────────────────────────────────────────────────────────
//  QUICK ADD — chooser between Expense and Income
//
//  Single tiny picker rendered into the modal-overlay. Two big tiles
//  side-by-side. Tap either one to close the picker and open the
//  corresponding capture modal. Cancel button just dismisses.
//
//  Triggered from:
//    • the mobile FAB (+ button)
//    • the dashboard's "+ Quick add" button
//
//  Both used to call openQuickExpenseModal directly; they now route
//  through the picker so the user picks the direction first. The
//  picker reuses the standard modal shell — no new overlay, no
//  custom dismiss logic.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { openQuickExpenseModal } from './quick-expense.js';
import { openQuickIncomeModal }  from './quick-income.js';

export function openQuickAddPicker() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');
  if (!overlay) return;

  titleEl.textContent     = t('quickAdd.title');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  bodyEl.innerHTML = `
    <div class="quick-add-tiles">
      <button type="button" class="quick-add-tile quick-add-tile--expense" data-kind="expense">
        <span class="quick-add-tile-emoji" aria-hidden="true">💳</span>
        <span class="quick-add-tile-title">${t('quickAdd.expense')}</span>
        <span class="quick-add-tile-sub">${t('quickAdd.expenseSub')}</span>
      </button>
      <button type="button" class="quick-add-tile quick-add-tile--income" data-kind="income">
        <span class="quick-add-tile-emoji" aria-hidden="true">💰</span>
        <span class="quick-add-tile-title">${t('quickAdd.income')}</span>
        <span class="quick-add-tile-sub">${t('quickAdd.incomeSub')}</span>
      </button>
    </div>
  `;
  overlay.classList.add('open');

  bodyEl.querySelectorAll('.quick-add-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const kind = tile.dataset.kind;
      // Close the picker first so the underlying modal opens cleanly
      // — both target the same overlay DOM, so closing first avoids
      // a flicker where two modal bodies briefly overlap.
      overlay.classList.remove('open');
      if (kind === 'income') {
        openQuickIncomeModal();
      } else {
        openQuickExpenseModal();
      }
    });
  });
}
