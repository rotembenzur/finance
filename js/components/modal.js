// ─────────────────────────────────────────────────────────────────
//  MODAL — shared shell for confirmation flows
//
//  The modal-overlay element in index.html is reused by:
//    · IBI sync preview      (see js/import/import-flow.js)
//    · Manual data import    (see js/components/data-io.js)
//    · Manual data menu      (see js/components/data-io.js)
//
//  This module owns only the close + save-router behavior. Each
//  consumer paints its own contents directly into #modal-body and
//  toggles the overlay's `open` class. The save button routes here
//  via inline onclick, and we forward to whichever pending flow
//  wants to apply.
// ─────────────────────────────────────────────────────────────────

import {
  hasPendingImport, applyPendingImport, clearPendingImport,
} from '../import/import-flow.js';
import {
  hasPendingIsracardImport, applyPendingIsracardImport, clearPendingIsracardImport,
} from '../import/isracard-flow.js';
import {
  hasPendingMaxImport, applyPendingMaxImport, clearPendingMaxImport,
} from '../import/max-flow.js';
import {
  hasPendingDataImport, applyPendingDataImport, clearPendingDataImport,
  hasPendingReload, applyPendingReload, clearPendingReload,
} from './data-io.js';
import {
  hasPendingAmountEdit, applyPendingAmountEdit, clearPendingAmountEdit,
} from './edit-amount.js';
import {
  hasPendingCardSpendingEdit, applyPendingCardSpendingEdit, clearPendingCardSpendingEdit,
} from './edit-card-spending.js';
import {
  hasPendingChargeEdit, applyPendingChargeEdit, clearPendingChargeEdit,
} from './edit-charge.js';
import {
  hasPendingSalaryEdit, applyPendingSalaryEdit, clearPendingSalaryEdit,
} from './edit-salary.js';
import {
  hasPendingQuickExpense, applyPendingQuickExpense, clearPendingQuickExpense,
} from './quick-expense.js';
import {
  hasPendingCashEdit, applyPendingCashEdit, clearPendingCashEdit,
} from './edit-cash.js';
import {
  hasPendingPortfolioCashEdit, applyPendingPortfolioCashEdit, clearPendingPortfolioCashEdit,
} from './edit-portfolio-cash.js';
import {
  hasPendingBankImport, applyPendingBankImport, clearPendingBankImport,
} from '../import/bank/bank-import-flow.js';
import {
  hasPendingReconcile, applyPendingReconcile, clearPendingReconcile,
} from '../import/reconcile-flow.js';

export function closeModal(event) {
  // Allow direct calls; block click events that didn't land on the backdrop
  if (event && event.type === 'click' && event.target !== document.getElementById('modal-overlay')) return;
  _dismissModal();
}

export function handleModalSave() {
  if (hasPendingImport())            { applyPendingImport();            return; }
  if (hasPendingIsracardImport())    { applyPendingIsracardImport();    return; }
  if (hasPendingMaxImport())         { applyPendingMaxImport();         return; }
  if (hasPendingDataImport())        { applyPendingDataImport();        return; }
  if (hasPendingAmountEdit())        { applyPendingAmountEdit();        return; }
  if (hasPendingCardSpendingEdit())  { applyPendingCardSpendingEdit();  return; }
  if (hasPendingChargeEdit())        { applyPendingChargeEdit();        return; }
  if (hasPendingSalaryEdit())        { applyPendingSalaryEdit();        return; }
  if (hasPendingQuickExpense())      { applyPendingQuickExpense();      return; }
  if (hasPendingCashEdit())          { applyPendingCashEdit();          return; }
  if (hasPendingPortfolioCashEdit()) { applyPendingPortfolioCashEdit(); return; }
  if (hasPendingBankImport())        { applyPendingBankImport();        return; }
  if (hasPendingReconcile())         { applyPendingReconcile();         return; }
  if (hasPendingReload())            { applyPendingReload();            return; }
  // No pending action → nothing to do. Save button is hidden in
  // states that have no save action (data menu, error screens), so
  // this branch is unreachable in practice.
}

function _dismissModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  clearPendingImport();
  clearPendingIsracardImport();
  clearPendingMaxImport();
  clearPendingDataImport();
  clearPendingAmountEdit();
  clearPendingCardSpendingEdit();
  clearPendingChargeEdit();
  clearPendingSalaryEdit();
  clearPendingQuickExpense();
  clearPendingCashEdit();
  clearPendingPortfolioCashEdit();
  clearPendingBankImport();
  clearPendingReconcile();
  clearPendingReload();
}

// Close on Escape — applies to every consumer of this shell
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('modal-overlay');
  if (overlay && overlay.classList.contains('open')) _dismissModal();
});
