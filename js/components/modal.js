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
  hasPendingCardLinkEdit, applyPendingCardLinkEdit, clearPendingCardLinkEdit,
} from './edit-card-link.js';
import {
  hasPendingChargeEdit, applyPendingChargeEdit, clearPendingChargeEdit,
} from './edit-charge.js';
import {
  hasPendingTransactionEdit, applyPendingTransactionEdit, clearPendingTransactionEdit,
} from './edit-transaction.js';
import {
  hasPendingCashChargeEdit, applyPendingCashChargeEdit, clearPendingCashChargeEdit,
} from './edit-cash-charge.js';
import {
  hasPendingSalaryEdit, applyPendingSalaryEdit, clearPendingSalaryEdit,
} from './edit-salary.js';
import {
  hasPendingQuickExpense, applyPendingQuickExpense, clearPendingQuickExpense,
} from './quick-expense.js';
import {
  hasPendingQuickIncome, applyPendingQuickIncome, clearPendingQuickIncome,
} from './quick-income.js';
import {
  hasPendingQuickBankExpense, applyPendingQuickBankExpense, clearPendingQuickBankExpense,
} from './quick-bank-expense.js';
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
import {
  hasPendingBankReconcile, applyPendingBankReconcile, clearPendingBankReconcile,
} from '../import/bank/bank-reconcile-flow.js';
import {
  hasPendingGiftCardEdit, applyPendingGiftCardEdit, clearPendingGiftCardEdit,
} from './edit-gift-card.js';
import {
  hasPendingDepositEdit, applyPendingDepositEdit, clearPendingDepositEdit,
} from './edit-deposit.js';
import {
  hasPendingProductEdit, applyPendingProductEdit, clearPendingProductEdit,
} from './edit-product.js';
import {
  hasPendingCreditCardEdit, applyPendingCreditCardEdit, clearPendingCreditCardEdit,
} from './edit-credit-card.js';
import {
  hasPendingConfigItemEdit, applyPendingConfigItemEdit, clearPendingConfigItemEdit,
} from './edit-config-item.js';
import {
  hasPendingFutureDepositEdit, applyPendingFutureDepositEdit, clearPendingFutureDepositEdit,
} from './edit-future-deposit.js';
import {
  hasPendingStandaloneInvestmentEdit, applyPendingStandaloneInvestmentEdit, clearPendingStandaloneInvestmentEdit,
} from './edit-standalone-investment.js';
import {
  hasPendingCalImport, applyPendingCalImport, clearPendingCalImport,
} from '../import/cal-flow.js';

export function closeModal(event) {
  // Allow direct calls; block click events that didn't land on the backdrop
  if (event && event.type === 'click' && event.target !== document.getElementById('modal-overlay')) return;
  _dismissModal();
}

export function handleModalSave() {
  if (hasPendingImport())            { applyPendingImport();            return; }
  if (hasPendingIsracardImport())    { applyPendingIsracardImport();    return; }
  if (hasPendingMaxImport())         { applyPendingMaxImport();         return; }
  if (hasPendingCalImport())         { applyPendingCalImport();         return; }
  if (hasPendingDataImport())        { applyPendingDataImport();        return; }
  if (hasPendingAmountEdit())        { applyPendingAmountEdit();        return; }
  if (hasPendingCardSpendingEdit())  { applyPendingCardSpendingEdit();  return; }
  if (hasPendingCardLinkEdit())      { applyPendingCardLinkEdit();      return; }
  if (hasPendingChargeEdit())        { applyPendingChargeEdit();        return; }
  if (hasPendingTransactionEdit())   { applyPendingTransactionEdit();   return; }
  if (hasPendingCashChargeEdit())    { applyPendingCashChargeEdit();    return; }
  if (hasPendingSalaryEdit())        { applyPendingSalaryEdit();        return; }
  if (hasPendingQuickExpense())      { applyPendingQuickExpense();      return; }
  if (hasPendingQuickIncome())       { applyPendingQuickIncome();       return; }
  if (hasPendingQuickBankExpense())  { applyPendingQuickBankExpense();  return; }
  if (hasPendingCashEdit())          { applyPendingCashEdit();          return; }
  if (hasPendingPortfolioCashEdit()) { applyPendingPortfolioCashEdit(); return; }
  if (hasPendingBankImport())        { applyPendingBankImport();        return; }
  if (hasPendingReconcile())         { applyPendingReconcile();         return; }
  if (hasPendingBankReconcile())     { applyPendingBankReconcile();     return; }
  if (hasPendingGiftCardEdit())      { applyPendingGiftCardEdit();      return; }
  if (hasPendingDepositEdit())       { applyPendingDepositEdit();       return; }
  if (hasPendingProductEdit())       { applyPendingProductEdit();       return; }
  if (hasPendingCreditCardEdit())    { applyPendingCreditCardEdit();    return; }
  if (hasPendingConfigItemEdit())    { applyPendingConfigItemEdit();    return; }
  if (hasPendingFutureDepositEdit())          { applyPendingFutureDepositEdit();          return; }
  if (hasPendingStandaloneInvestmentEdit())   { applyPendingStandaloneInvestmentEdit();   return; }
  if (hasPendingReload())                     { applyPendingReload();                     return; }
  // No pending action → nothing to do. Save button is hidden in
  // states that have no save action (data menu, error screens), so
  // this branch is unreachable in practice.
}

function _dismissModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  clearPendingImport();
  clearPendingIsracardImport();
  clearPendingMaxImport();
  clearPendingCalImport();
  clearPendingDataImport();
  clearPendingAmountEdit();
  clearPendingCardSpendingEdit();
  clearPendingCardLinkEdit();
  clearPendingChargeEdit();
  clearPendingTransactionEdit();
  clearPendingCashChargeEdit();
  clearPendingSalaryEdit();
  clearPendingQuickExpense();
  clearPendingQuickIncome();
  clearPendingQuickBankExpense();
  clearPendingCashEdit();
  clearPendingPortfolioCashEdit();
  clearPendingBankImport();
  clearPendingReconcile();
  clearPendingBankReconcile();
  clearPendingGiftCardEdit();
  clearPendingDepositEdit();
  clearPendingProductEdit();
  clearPendingCreditCardEdit();
  clearPendingConfigItemEdit();
  clearPendingFutureDepositEdit();
  clearPendingStandaloneInvestmentEdit();
  clearPendingReload();
}

// Close on Escape — applies to every consumer of this shell
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('modal-overlay');
  if (overlay && overlay.classList.contains('open')) _dismissModal();
});


// ─── Bottom-sheet open/close side effects ─────────────────────
//
// When the modal opens on a phone it renders as a bottom sheet
// (see components.css). The FAB and any other ambient UI should
// step out of the way. We mirror the overlay's `open` class to
// `body.sheet-open` via a MutationObserver so this works for
// every consumer without each one having to opt in.

(function initSheetBodyClass() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;

  const sync = () => {
    document.body.classList.toggle('sheet-open', overlay.classList.contains('open'));
  };
  sync();

  new MutationObserver(sync).observe(overlay, {
    attributes: true,
    attributeFilter: ['class'],
  });
})();


// ─── Swipe-to-dismiss (phone bottom sheet) ────────────────────
//
// Listens for touch drags on the grabber and the header — those
// are the "chrome" areas safe to grab; the body itself owns
// vertical scrolling so we leave it alone. The card follows the
// finger 1:1 while dragging; on release we either commit
// (dismiss + clear pending flow) or snap back.
//
// Thresholds: distance ≥ 88px, OR downward velocity ≥ 0.55 px/ms
// in the last 100ms of motion. The velocity branch catches a
// quick flick.
//
// Gated by viewport width — on desktop the modal is centered and
// drag-dismiss makes no sense.

(function initSheetDrag() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  const card = overlay.querySelector('.modal-card');
  if (!card) return;

  const phoneMQ = window.matchMedia('(max-width: 640px)');
  const DRAG_HANDLE_SELECTOR = '.modal-grabber, .modal-header';
  const DISMISS_DISTANCE_PX  = 88;
  const DISMISS_VELOCITY     = 0.55; // px/ms

  let startY        = 0;
  let lastY         = 0;
  let lastT         = 0;
  let velocity      = 0;
  let activePointer = null;

  function onStart(e) {
    if (!phoneMQ.matches) return;
    // Only grab when the touch begins on a handle — drags
    // started inside the body should scroll the body.
    if (!e.target.closest(DRAG_HANDLE_SELECTOR)) return;
    // Never engage the drag if the touch starts on an interactive
    // element inside the header (most importantly: the close X).
    // Without this guard the drag-state side effects (is-dragging
    // class, captured pointer) competed with the button's tap on
    // iOS Safari and the close button sometimes did nothing.
    if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const t = e.touches[0];
    activePointer = t.identifier;
    startY = lastY = t.clientY;
    lastT  = e.timeStamp;
    velocity = 0;
    card.classList.add('is-dragging');
  }

  function onMove(e) {
    if (activePointer === null) return;
    const t = [...e.touches].find(x => x.identifier === activePointer);
    if (!t) return;
    const dy = t.clientY - startY;
    if (dy <= 0) {
      // Upward drag — keep the card pinned. (We could let it
      // overshoot, but for a dismiss-only gesture pinning is
      // calmer.)
      card.style.transform = 'translateY(0)';
      return;
    }
    card.style.transform = `translateY(${dy}px)`;
    const dt = e.timeStamp - lastT;
    if (dt > 0) velocity = (t.clientY - lastY) / dt;
    lastY = t.clientY;
    lastT = e.timeStamp;
    // Prevent the page from scrolling while we drag the sheet.
    e.preventDefault();
  }

  function onEnd(e) {
    if (activePointer === null) return;
    const ended = [...e.changedTouches].find(x => x.identifier === activePointer);
    activePointer = null;
    card.classList.remove('is-dragging');
    const dy = ended ? (ended.clientY - startY) : 0;
    const shouldDismiss = dy >= DISMISS_DISTANCE_PX || velocity >= DISMISS_VELOCITY;
    // Clear the inline transform either way so the CSS class
    // (centered or .open translateY) takes over again.
    card.style.transform = '';
    if (shouldDismiss) _dismissModal();
  }

  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove',  onMove,  { passive: false });
  card.addEventListener('touchend',   onEnd);
  card.addEventListener('touchcancel', onEnd);
})();
