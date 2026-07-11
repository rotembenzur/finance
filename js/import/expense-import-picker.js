// ─────────────────────────────────────────────────────────────────
//  EXPENSE IMPORT PICKER
//
//  Single entry point for "Import Expenses From File". Opens a modal
//  with tiles (Isracard / MAX / CAL); clicking a tile closes the modal
//  and hands off to the issuer-specific flow that already exists.
//
//  This module owns NO parsing or state mutation — it just routes
//  the user to the right downstream flow. Reusing the existing
//  modal-overlay shell keeps the visual language consistent with the
//  IBI sync preview, manual data import, and per-charge edit modal.
// ─────────────────────────────────────────────────────────────────

import { t } from '../i18n.js';
import { openIsracardImportFlow } from './isracard-flow.js';
import { openMaxImportFlow } from './max-flow.js';
import { openCalImportFlow } from './cal-flow.js';

export function openExpenseImportPicker() {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('importPicker.title');
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('modal.cancel');

  bodyEl.innerHTML = `
    <p class="modal-confirm-text">${t('importPicker.prompt')}</p>
    <div class="expense-picker-grid">
      <button class="expense-picker-tile" type="button" data-source="isracard">
        <span class="expense-picker-tile-mark">IC</span>
        <span class="expense-picker-tile-name">${t('importPicker.isracard')}</span>
        <span class="expense-picker-tile-hint">${t('importPicker.isracardHint')}</span>
      </button>
      <button class="expense-picker-tile" type="button" data-source="max">
        <span class="expense-picker-tile-mark">MAX</span>
        <span class="expense-picker-tile-name">${t('importPicker.max')}</span>
        <span class="expense-picker-tile-hint">${t('importPicker.maxHint')}</span>
      </button>
      <button class="expense-picker-tile" type="button" data-source="cal">
        <span class="expense-picker-tile-mark">CAL</span>
        <span class="expense-picker-tile-name">${t('importPicker.cal')}</span>
        <span class="expense-picker-tile-hint">${t('importPicker.calHint')}</span>
      </button>
    </div>
  `;

  // Bind once per render — the modal body is replaced on every open,
  // so previous listeners disappear with their owning elements.
  bodyEl.querySelectorAll('.expense-picker-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      const source = btn.dataset.source;
      _closePicker();
      // Defer one tick so the picker modal's close animation doesn't
      // race the issuer flow's file-input click (some browsers block
      // file pickers triggered during a closing dialog frame).
      setTimeout(() => {
        if (source === 'isracard') openIsracardImportFlow();
        else if (source === 'max') openMaxImportFlow();
        else if (source === 'cal') openCalImportFlow();
      }, 0);
    });
  });

  overlay.classList.add('open');
}

function _closePicker() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
}
