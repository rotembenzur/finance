// ─────────────────────────────────────────────────────────────────
//  EDIT SALARY — modal for configuring monthly income
//
//  Fields:
//    · netAmount   — what lands in the account (required)
//    · grossAmount — before tax + deductions (optional)
//    · toEntryId   — destination account (checking/savings entry)
//    · depositDay  — 1..31, day of month
//    · employer    — optional free text (he + en)
//    · provisions  — optional reference percentages, tucked into a
//                    collapsible section: pension + study-fund (keren
//                    hishtalmut) employee/employer shares. Stored but
//                    not used in any balance math — surfaced as quiet
//                    "dry detail" on the dashboard salary row.
//    · notes       — optional free text
//
//  Empty state: salary === null on open. Submitting an empty form
//  keeps it null. Clearing a configured salary nukes it back to null
//  via the "Clear salary" button.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { init } from '../app.js';
import {
  getSalary, getSalaryDestinationEntry,
  getAvailableEntries,
} from '../utils.js';

let _open = false;
let _clearing = false;

// ── Public API ────────────────────────────────────────────────

export function openEditSalaryModal() {
  _open = true;
  _clearing = false;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  titleEl.textContent     = t('salary.edit.title');
  saveBtnEl.style.display = '';
  saveBtnEl.textContent   = t('modal.save');
  saveBtnEl.className     = 'btn btn-primary';
  cancelEl.textContent    = t('modal.cancel');
  overlay.classList.remove('modal-overlay--wide');

  const data    = getAppData();
  const salary  = getSalary(data);
  const accounts = _eligibleDestinationAccounts(data);

  bodyEl.innerHTML = _renderForm(salary, accounts);

  // Wire the inline "Clear salary" button — sets a flag the modal
  // save router reads, then re-uses the same Save click to commit.
  const clearBtn = document.getElementById('f-salary-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _clearing = true;
      applyPendingSalaryEdit();
    });
  }

  overlay.classList.add('open');
  setTimeout(() => document.getElementById('f-salary-amount')?.focus(), 50);
}

export function hasPendingSalaryEdit()   { return _open; }
export function clearPendingSalaryEdit() { _open = false; _clearing = false; }

export function applyPendingSalaryEdit() {
  if (!_open) return false;

  const data = getAppData();

  if (_clearing) {
    data.salary = null;
    data.meta.lastUpdated = todayISO();
    saveData(data);
    init();
    _open = false;
    _clearing = false;
    document.getElementById('modal-overlay').classList.remove('open');
    return true;
  }

  const form = _readForm();
  if (!form) return false;   // validation already surfaced inline

  data.salary = {
    netAmount:            form.netAmount,
    grossAmount:          form.grossAmount,
    currency:             'ILS',
    toEntryId:            form.toEntryId,
    depositDay:           form.depositDay,
    employer:             form.employer   || null,
    employerEn:           form.employerEn || null,
    pensionEmployeePct:   form.pensionEmployeePct,
    pensionEmployerPct:   form.pensionEmployerPct,
    studyFundEmployeePct: form.studyFundEmployeePct,
    studyFundEmployerPct: form.studyFundEmployerPct,
    notes:                form.notes      || null,
    isActive:             true,
    updatedAt:            todayISO(),
  };
  data.meta.lastUpdated = todayISO();
  saveData(data);
  init();

  _open = false;
  document.getElementById('modal-overlay').classList.remove('open');
  return true;
}

// ── Form rendering ───────────────────────────────────────────

function _renderForm(salary, accounts) {
  const acctOptions = accounts.length === 0
    ? `<option value="">${t('salary.edit.noAccounts')}</option>`
    : [
        `<option value="">${t('salary.edit.pickAccount')}</option>`,
        ...accounts.map(e => `
          <option value="${e.id}" ${salary?.toEntryId === e.id ? 'selected' : ''}>
            ${_esc(_accountLabel(e))}
          </option>
        `),
      ].join('');

  const clearBtnHtml = salary
    ? `<button type="button" class="btn btn-ghost btn-sm edit-salary-clear" id="f-salary-clear">${t('salary.edit.clear')}</button>`
    : '';

  return `
    <form class="edit-salary-form" id="f-salary-form" onsubmit="event.preventDefault()">

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-salary-amount">${t('salary.edit.netAmount')}</label>
          <div class="input-with-symbol">
            <span class="currency-symbol">₪</span>
            <input class="form-input" id="f-salary-amount"
                   type="number" min="0" step="1"
                   value="${salary?.netAmount ?? ''}"
                   placeholder="${t('salary.edit.netAmountPlaceholder')}" />
          </div>
          <small class="form-hint">${t('salary.edit.netAmountHint')}</small>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-salary-gross">${t('salary.edit.grossAmount')}</label>
          <div class="input-with-symbol">
            <span class="currency-symbol">₪</span>
            <input class="form-input" id="f-salary-gross"
                   type="number" min="0" step="1"
                   value="${salary?.grossAmount ?? ''}"
                   placeholder="${t('salary.edit.grossAmountPlaceholder')}" />
          </div>
          <small class="form-hint">${t('salary.edit.grossAmountHint')}</small>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-salary-account">${t('salary.edit.toAccount')}</label>
          <select class="form-select" id="f-salary-account" ${accounts.length === 0 ? 'disabled' : ''}>
            ${acctOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-salary-day">${t('salary.edit.depositDay')}</label>
          <input class="form-input" id="f-salary-day"
                 type="number" min="1" max="31" step="1"
                 value="${salary?.depositDay ?? ''}"
                 placeholder="${t('salary.edit.depositDayPlaceholder')}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="f-salary-employer">${t('salary.edit.employer')}</label>
          <input class="form-input" id="f-salary-employer" type="text"
                 value="${_esc(salary?.employer || '')}"
                 placeholder="${t('salary.edit.employerPlaceholder')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-salary-employer-en">${t('salary.edit.employerEn')}</label>
          <input class="form-input" id="f-salary-employer-en" type="text"
                 value="${_esc(salary?.employerEn || '')}"
                 placeholder="${t('salary.edit.employerEnPlaceholder')}" />
        </div>
      </div>

      <details class="edit-salary-provisions" ${_hasProvisions(salary) ? 'open' : ''}>
        <summary class="edit-salary-provisions-summary">${t('salary.edit.provisions')}</summary>
        <p class="form-hint edit-salary-provisions-hint">${t('salary.edit.provisionsHint')}</p>

        <div class="form-group">
          <span class="form-label">${t('salary.edit.pension')}</span>
          <div class="form-row">
            ${_pctField('f-salary-pension-emp',  'salary.edit.employeeShare', salary?.pensionEmployeePct)}
            ${_pctField('f-salary-pension-empr', 'salary.edit.employerShare', salary?.pensionEmployerPct)}
          </div>
        </div>

        <div class="form-group">
          <span class="form-label">${t('salary.edit.studyFund')}</span>
          <div class="form-row">
            ${_pctField('f-salary-study-emp',  'salary.edit.employeeShare', salary?.studyFundEmployeePct)}
            ${_pctField('f-salary-study-empr', 'salary.edit.employerShare', salary?.studyFundEmployerPct)}
          </div>
        </div>
      </details>

      <div class="form-group">
        <label class="form-label" for="f-salary-notes">${t('salary.edit.notes')}</label>
        <textarea class="form-input edit-salary-notes" id="f-salary-notes" rows="2"
                  placeholder="${t('salary.edit.notesPlaceholder')}">${_esc(salary?.notes || '')}</textarea>
      </div>

      <p id="f-salary-error" class="form-error" style="display:none"></p>

      ${clearBtnHtml}
    </form>
  `;
}

// ── Form reading + validation ────────────────────────────────

function _readForm() {
  const amountRaw = document.getElementById('f-salary-amount')?.value || '';
  const grossRaw  = document.getElementById('f-salary-gross')?.value || '';
  const toId      = document.getElementById('f-salary-account')?.value || '';
  const dayRaw    = document.getElementById('f-salary-day')?.value || '';
  const employer  = (document.getElementById('f-salary-employer')?.value || '').trim();
  const employerEn = (document.getElementById('f-salary-employer-en')?.value || '').trim();
  const notes     = (document.getElementById('f-salary-notes')?.value || '').trim();
  const errorEl   = document.getElementById('f-salary-error');

  const amount = parseFloat(amountRaw);
  const day    = parseInt(dayRaw, 10);

  if (!Number.isFinite(amount) || amount <= 0) {
    return _formError(errorEl, t('salary.edit.invalidAmount'), 'f-salary-amount');
  }
  if (!toId) {
    return _formError(errorEl, t('salary.edit.missingAccount'), 'f-salary-account');
  }
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return _formError(errorEl, t('salary.edit.invalidDay'), 'f-salary-day');
  }

  // Gross is optional; when present it must be a positive number.
  const grossAmount = _optionalAmount(grossRaw);
  if (grossAmount === false) {
    return _formError(errorEl, t('salary.edit.invalidAmount'), 'f-salary-gross');
  }

  // Provision percentages are all optional; when present, 0–100.
  const pcts = {
    pensionEmployeePct:   _optionalPct('f-salary-pension-emp'),
    pensionEmployerPct:   _optionalPct('f-salary-pension-empr'),
    studyFundEmployeePct: _optionalPct('f-salary-study-emp'),
    studyFundEmployerPct: _optionalPct('f-salary-study-empr'),
  };
  for (const [field, val] of Object.entries(pcts)) {
    if (val === false) {
      return _formError(errorEl, t('salary.edit.invalidPct'),
        field.startsWith('pension') ? 'f-salary-pension-emp' : 'f-salary-study-emp');
    }
  }

  return {
    netAmount:  amount,
    grossAmount,
    toEntryId:  toId,
    depositDay: day,
    employer,
    employerEn,
    notes,
    ...pcts,
  };
}

// Parse an optional currency field: '' → null, valid positive → number,
// invalid/negative → false (signals a validation error).
function _optionalAmount(raw) {
  if (!raw.trim()) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : false;
}

// Parse an optional percentage input by element id: '' → null, valid
// 0..100 → number, invalid → false (signals a validation error).
function _optionalPct(id) {
  const raw = (document.getElementById(id)?.value || '').trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : false;
}

function _formError(errorEl, message, focusId) {
  if (errorEl) {
    errorEl.textContent  = message;
    errorEl.style.display = 'block';
  }
  document.getElementById(focusId)?.focus();
  return null;
}

// ── Helpers ──────────────────────────────────────────────────

// Accounts the salary can land in: עו"ש / checking accounts only.
// Cash, digital wallets, and locked/term savings (like the discharge
// deposit "15,000 ש"ח עד השחרור") are NOT bank accounts a salary
// gets deposited into — they're parked balances, not operational.
function _eligibleDestinationAccounts(data) {
  return getAvailableEntries(data).filter(e => e.type === 'checking');
}

function _accountLabel(entry) {
  const inst = entry.institution || '';
  // Example: "Bank Hapoalim · עו"ש"  (institution + the account's own short name)
  return inst ? `${inst} · ${entry.name}` : entry.name;
}

// One percentage input (employee/employer share). Reused for both
// pension and study-fund rows so the markup stays in one place.
function _pctField(id, labelKey, value) {
  return `
    <div class="form-group">
      <label class="form-label form-label--sub" for="${id}">${t(labelKey)}</label>
      <div class="input-with-symbol input-with-symbol--suffix">
        <input class="form-input" id="${id}"
               type="number" min="0" max="100" step="0.01"
               value="${value ?? ''}" placeholder="0" />
        <span class="currency-symbol">%</span>
      </div>
    </div>
  `;
}

// Whether any provision percentage is set — drives the <details>
// open-by-default so configured users see their numbers at a glance.
function _hasProvisions(salary) {
  if (!salary) return false;
  return [
    salary.pensionEmployeePct, salary.pensionEmployerPct,
    salary.studyFundEmployeePct, salary.studyFundEmployerPct,
  ].some(v => Number.isFinite(v));
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
