// ─────────────────────────────────────────────────────────────────
//  VALUE HISTORY — read-only modal showing how a long-term
//  investment product has grown across the user's saved snapshots.
//
//  Each save in edit-amount.js appends `{date, value}` to the entry's
//  `valueHistory` array; the very first point is seeded by the
//  store.js migration from `updatedAt` + `currentValue`. So the
//  chart is empty only for snapshots that pre-date the migration
//  AND have no `currentValue` to seed from — extremely rare.
//
//  Entry into this modal is the "View history" link inside the
//  edit-amount modal (see edit-amount.js _renderViewHistoryLink).
//  This module reuses the same #modal-overlay shell but does NOT
//  engage the modal.js pending-action machinery: there's nothing
//  to save here, so the Save button is hidden and Cancel becomes
//  "Close".
//
//  A note on the % shown: the user's products grow both from market
//  returns AND from deposits (standing orders, salary allocations).
//  The "total growth" number blends the two by design — it answers
//  "did this product grow?" honestly. Separating returns from
//  contributions would require tracking deposits per snapshot,
//  which is not a tradeoff the user opted into.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { getAppData } from '../state.js';
import { formatCurrency } from '../utils.js';

const CHART_WIDTH  = 560;
const CHART_HEIGHT = 220;
const CHART_PAD    = { top: 18, right: 16, bottom: 30, left: 56 };


// ── Public API ───────────────────────────────────────────────────

export function openValueHistoryModal(entryId) {
  const entry = getAppData().entries.find(e => e.id === entryId);
  if (!entry) return;

  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtnEl = document.getElementById('modal-save-btn');
  const cancelEl  = document.getElementById('modal-cancel-btn');

  const displayName = currentLang === 'he'
    ? (entry.name   || entry.nameEn || '')
    : (entry.nameEn || entry.name   || '');

  titleEl.textContent     = displayName
    ? `${displayName} — ${t('valueHistory.title')}`
    : t('valueHistory.title');

  // Read-only view: no save action. Cancel becomes "Close".
  saveBtnEl.style.display = 'none';
  cancelEl.textContent    = t('valueHistory.close');
  overlay.classList.remove('modal-overlay--wide');

  const history = Array.isArray(entry.valueHistory)
    ? [...entry.valueHistory].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    : [];

  bodyEl.innerHTML = _renderBody(history);
  overlay.classList.add('open');
}


// ── Rendering ────────────────────────────────────────────────────

function _renderBody(history) {
  if (history.length === 0) {
    return `
      <div class="value-history">
        <p class="value-history-empty">${t('valueHistory.empty')}</p>
      </div>
    `;
  }

  if (history.length === 1) {
    const only = history[0];
    return `
      <div class="value-history">
        <div class="value-history-stats">
          <div class="value-history-stat">
            <div class="value-history-stat-label">${t('valueHistory.currentValue')}</div>
            <div class="value-history-stat-value">${formatCurrency(only.value)}</div>
            <div class="value-history-stat-meta">${_esc(only.date)}</div>
          </div>
        </div>
        <p class="value-history-empty">${t('valueHistory.singlePoint')}</p>
      </div>
    `;
  }

  const first = history[0];
  const last  = history[history.length - 1];
  const change = last.value - first.value;
  const pct = first.value > 0 ? (change / first.value) * 100 : null;

  const changeSign = change > 0 ? '+' : (change < 0 ? '−' : '');
  const changeCls  = change > 0 ? 'is-positive' : (change < 0 ? 'is-negative' : '');
  const pctStr     = pct == null
    ? ''
    : `${change >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;

  return `
    <div class="value-history">
      <div class="value-history-stats">
        <div class="value-history-stat">
          <div class="value-history-stat-label">${t('valueHistory.totalGrowth')}</div>
          <div class="value-history-stat-value ${changeCls}">
            ${changeSign}${formatCurrency(Math.abs(change))}
          </div>
          ${pct == null ? '' : `<div class="value-history-stat-meta ${changeCls}">${pctStr}</div>`}
        </div>
        <div class="value-history-stat">
          <div class="value-history-stat-label">${t('valueHistory.span')}</div>
          <div class="value-history-stat-value">
            ${formatCurrency(first.value)} → ${formatCurrency(last.value)}
          </div>
          <div class="value-history-stat-meta">${_esc(first.date)} → ${_esc(last.date)}</div>
        </div>
      </div>

      ${_renderChart(history)}

      <details class="value-history-details">
        <summary>${t('valueHistory.snapshots')} (${history.length})</summary>
        <ul class="value-history-snapshots">
          ${history.slice().reverse().map(p => `
            <li>
              <span class="value-history-snapshot-date">${_esc(p.date)}</span>
              <span class="value-history-snapshot-value">${formatCurrency(p.value)}</span>
            </li>
          `).join('')}
        </ul>
      </details>

      <p class="value-history-disclaimer">${t('valueHistory.disclaimer')}</p>
    </div>
  `;
}


// ── Chart (inline SVG, no library) ──────────────────────────────
//
// Linear line + filled area. X axis is calendar time (so two saves
// a week apart sit closer than two saves a year apart), Y axis is
// value with a small headroom above the max so the line never
// touches the top edge. RTL flips the visual direction so the
// earliest point sits on the right when the UI is in Hebrew.

function _renderChart(history) {
  const innerW = CHART_WIDTH  - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_HEIGHT - CHART_PAD.top  - CHART_PAD.bottom;

  const xs = history.map(p => _dateToMs(p.date));
  const ys = history.map(p => p.value);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  // Padding so the line doesn't kiss the top/bottom edges.
  const yPad = (yMax - yMin) * 0.12 || Math.max(yMax * 0.05, 1);
  const yLo  = Math.max(0, yMin - yPad);
  const yHi  = yMax + yPad;

  const xSpan = (xMax - xMin) || 1;
  const ySpan = (yHi - yLo)   || 1;

  const xAt = (ms) => CHART_PAD.left + ((ms - xMin) / xSpan) * innerW;
  const yAt = (v)  => CHART_PAD.top  + (1 - (v - yLo) / ySpan) * innerH;

  const pts = history.map(p => `${xAt(_dateToMs(p.date)).toFixed(1)},${yAt(p.value).toFixed(1)}`);
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `${linePath} L ${xAt(xMax).toFixed(1)},${(CHART_PAD.top + innerH).toFixed(1)} L ${xAt(xMin).toFixed(1)},${(CHART_PAD.top + innerH).toFixed(1)} Z`;

  // Y gridlines: three evenly spaced ticks across the value range.
  const ticks = [yLo, (yLo + yHi) / 2, yHi];
  const gridLines = ticks.map(v => {
    const y = yAt(v).toFixed(1);
    const labelX = (CHART_PAD.left - 6).toFixed(1);
    return `
      <line class="value-history-chart-grid" x1="${CHART_PAD.left}" x2="${CHART_PAD.left + innerW}" y1="${y}" y2="${y}" />
      <text class="value-history-chart-axis" x="${labelX}" y="${y}" text-anchor="end" dominant-baseline="central">${_compactNum(v)}</text>
    `;
  }).join('');

  // X axis: first + last date labels, with a midpoint if the span is wide.
  const xLabels = `
    <text class="value-history-chart-axis" x="${xAt(xMin).toFixed(1)}" y="${(CHART_PAD.top + innerH + 16).toFixed(1)}" text-anchor="start">${_esc(history[0].date)}</text>
    <text class="value-history-chart-axis" x="${xAt(xMax).toFixed(1)}" y="${(CHART_PAD.top + innerH + 16).toFixed(1)}" text-anchor="end">${_esc(history[history.length - 1].date)}</text>
  `;

  const dots = history.map(p => `
    <circle class="value-history-chart-dot"
            cx="${xAt(_dateToMs(p.date)).toFixed(1)}"
            cy="${yAt(p.value).toFixed(1)}"
            r="3.5">
      <title>${_esc(p.date)} — ${formatCurrency(p.value)}</title>
    </circle>
  `).join('');

  return `
    <div class="value-history-chart-wrap" dir="ltr">
      <svg class="value-history-chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${_esc(t('valueHistory.chartAria'))}">
        ${gridLines}
        <path class="value-history-chart-area" d="${areaPath}" />
        <path class="value-history-chart-line" d="${linePath}" />
        ${dots}
        ${xLabels}
      </svg>
    </div>
  `;
}


// ── Helpers ──────────────────────────────────────────────────────

function _dateToMs(iso) {
  // 'YYYY-MM-DD' → ms. Z suffix keeps timezone out of the picture so
  // two snapshots with the same date string always coincide on the
  // x-axis regardless of where the user runs the app.
  if (!iso) return 0;
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) ? t : 0;
}

function _compactNum(v) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000)     return Math.round(v / 1_000) + 'K';
  return String(Math.round(v));
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
