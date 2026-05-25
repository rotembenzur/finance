// ─────────────────────────────────────────────────────────────────
//  INTELLIGENCE — analytical view + AI assistant
//
//  Page reads top-down as a thesis:
//
//    ┌─ Portfolio Read ───────────────────────────────────┐
//    │   plain-language paragraph (composed by            │
//    │   narrative.js from real percentages and product   │
//    │   names — passes the 3-second understanding test)  │
//    │   trailing line: ₪total · age                      │
//    └─────────────────────────────────────────────────────┘
//
//    Ask the Assistant  (inline panel, grounded on the engine)
//
//    Important            ← impact='high' insight cards
//        each card has:
//          • title · priority label
//          • plain-language finding
//          • "Why this matters" sub-line
//          • optional "What might shift it" sub-line
//          • evidence (only when it carries weight)
//
//    Worth noting         ← impact='medium' | 'low' compact rows
//        single-sentence body each, no evidence panels
//
//  Hierarchy is asserted by the page. Lower-impact insights are
//  intentionally quieter so the high-impact ones read first.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatCurrency, formatCurrencyCompact } from '../utils.js';
import { buildFinancialProfile } from '../intelligence/profile.js';
import { buildInsights } from '../intelligence/insights.js';
import { composePortfolioRead } from '../intelligence/narrative.js';

// ── AI insight state (session-scoped) ────────────────────────────
//
// The "Refresh insights" action replaces the deterministic surface
// with an AI-authored one. We hold the normalized payload in module
// state so it survives the page-level init() re-renders (rates pull,
// edits) within a session. Phase 2 adds localStorage persistence +
// staleness. The engine output is always the fallback: when no AI
// payload is active, the page renders exactly as it did before.
let _aiInsights   = null;   // normalized payload from insights-ai.js, or null
let _aiRefreshing = false;  // true while a refresh call is in flight

export function setAIInsights(payload) { _aiInsights = payload || null; }
export function getAIInsights()        { return _aiInsights; }
export function clearAIInsights()      { _aiInsights = null; }
export function setIntelRefreshing(v)  { _aiRefreshing = !!v; }

// AI prose is language-specific; only honor a cached payload when it
// matches the current UI language. On a language switch we fall back
// to the (language-correct) deterministic render until the next refresh.
function _activeAIInsights() {
  if (!_aiInsights) return null;
  if (_aiInsights.lang && _aiInsights.lang !== currentLang) return null;
  return _aiInsights;
}

export function renderIntelligence(data) {
  const profile = buildFinancialProfile(data);
  if (!profile) {
    return `
      <section class="section intel" id="intelligence">
        <header class="intel-headline">
          <span class="intel-eyebrow">${t('intel.eyebrow')}</span>
          <h1 class="intel-title">${t('intel.title')}</h1>
        </header>
        <div class="intel-empty">${t('intel.empty')}</div>
      </section>
    `;
  }

  const read     = composePortfolioRead(profile);
  const insights = buildInsights(profile, data);
  const priority = insights.filter(i => i.impact === 'high');
  const observations = insights.filter(i => i.impact !== 'high');

  // When an AI refresh is active (and language-consistent), the engine
  // still computes everything — it stays the fallback and the number
  // source — but the AI payload drives what the user reads.
  const ai = _activeAIInsights();

  const busyClass = _aiRefreshing ? ' is-refreshing' : '';

  return `
    <section class="section intel${busyClass}" id="intelligence">
      ${_renderHeadline()}
      ${_renderToolbar(ai)}
      ${_renderPortfolioRead(profile, read, ai)}
      ${_renderAssistantPanel()}
      ${ai ? _renderPriorityFindingsAI(ai) : _renderPriorityFindings(priority)}
      ${ai ? _renderObservationsAI(ai)     : _renderObservations(observations)}
      <p class="intel-footer">${t('intel.footer')}</p>
    </section>
  `;
}


// ── Toolbar — Refresh insights + source / last-updated line ──────
//
// The single control that turns the deterministic surface into an
// AI-authored one. Sits under the headline so it reads as a page-level
// action, not a per-card one. The meta line states the current source
// (engine vs AI) and, once refreshed, when it was generated.

function _renderToolbar(ai) {
  const refreshIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2v3h-3"/></svg>`;

  const meta = ai
    ? `<span class="intel-refresh-meta">
         <span class="intel-source-ai">${t('intel.sourceAI')}</span>
         <span class="intel-refresh-sep">·</span>
         <span class="intel-refresh-time">${t('intel.lastUpdated')} ${_formatTime(ai.generatedAt)}</span>
       </span>`
    : `<span class="intel-refresh-meta intel-refresh-meta--muted">${t('intel.sourceEngine')}</span>`;

  const busy   = _aiRefreshing;
  const label  = busy ? t('intel.refreshing') : t('intel.refresh');
  const disAttr = busy ? ' disabled' : '';

  return `
    <div class="intel-toolbar">
      ${meta}
      <button type="button" class="intel-refresh-btn${busy ? ' is-busy' : ''}" id="intel-refresh-btn"
              onclick="onRefreshIntelligence()"${disAttr}>
        <span class="intel-refresh-icon" aria-hidden="true">${refreshIcon}</span>
        <span class="intel-refresh-label">${label}</span>
      </button>
    </div>
  `;
}

function _formatTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(currentLang === 'he' ? 'he-IL' : 'en-US',
      { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}


// ── Headline (page eyebrow + title) ──────────────────────────────

function _renderHeadline() {
  return `
    <header class="intel-headline">
      <span class="intel-eyebrow">${t('intel.eyebrow')}</span>
      <h1 class="intel-title">${t('intel.title')}</h1>
    </header>
  `;
}


// ── Portfolio Read (hero card) ───────────────────────────────────

function _renderPortfolioRead(profile, read, ai) {
  const a   = profile.aggregate;
  const age = profile.meta && profile.meta.age;
  if (!a) return '';

  // Stat strip — AI picks which metrics to surface and labels them, but
  // the numeric values are authoritative (re-attached by the normalizer
  // from the deterministic facts). Falls back to the engine's metric set.
  const statItems = (ai && ai.summaryMetrics && ai.summaryMetrics.length)
    ? ai.summaryMetrics.map(m => ({ label: m.label, value: m.value, suffix: m.suffix }))
    : ((read && read.metrics)
        ? read.metrics.map(m => ({ label: t(m.labelKey), value: m.value, suffix: t(m.suffixKey) }))
        : []);

  // Prose — AI lines (already localized) or the deterministic narrative.
  // Both run through the same escape → emphasize pipeline so figures and
  // tickers lift out identically regardless of source.
  const proseLines = (ai && ai.portfolioRead && ai.portfolioRead.lines && ai.portfolioRead.lines.length)
    ? ai.portfolioRead.lines.map(line => _emphasizeTickers(_emphasizeNumbers(_escapeHtml(line))))
    : ((read && read.sentences)
        ? read.sentences
            .map(s => _interpolate(t(s.key), _formatBodyVars(_resolveLocalizedVars(s.vars || {}))))
            .filter(Boolean)
            .map(line => _emphasizeTickers(_emphasizeNumbers(line)))
        : []);

  if (!proseLines.length && !statItems.length) return '';

  // Context line — the portfolio this analysis is about (size + age).
  const meta = `
    <div class="intel-read-meta">
      <span class="intel-read-meta-total">${formatCurrencyCompact(a.total)}</span>
      ${age != null ? `<span class="intel-read-meta-age">${t('intel.age')} ${age}</span>` : ''}
    </div>
  `;

  const stats = statItems.length
    ? `<div class="intel-read-stats">
        ${statItems.map(m => `
          <div class="intel-read-stat">
            <span class="intel-read-stat-value">${m.value}<span class="intel-read-stat-unit">${_escapeHtml(m.suffix)}</span></span>
            <span class="intel-read-stat-label">${_escapeHtml(m.label)}</span>
          </div>
        `).join('')}
      </div>`
    : '';

  const prose = proseLines.map(line => `<p class="intel-read-line">${line}</p>`).join('');

  return `
    <section class="intel-read">
      ${meta}
      ${stats}
      <div class="intel-read-prose">${prose}</div>
      ${_renderRiskSurface(profile, ai && ai.riskSurface)}
    </section>
  `;
}


// ── Risk Surface (5 qualitative dimensions) ──────────────────────
//
// Sits inside the Portfolio Read card, below the paragraph + tail.
// Five rows: label · level chip · explanation. The level chip is
// color-coded by position on its dimension's scale, but the colors
// are gentle — "elevated volatility" for a 24-year-old isn't bad,
// just descriptive; the explanation line carries the verdict.

function _renderRiskSurface(profile, aiRiskSurface) {
  const rd = profile.riskDimensions;
  if (!rd) return '';

  const dims = ['volatility', 'concentration', 'diversification', 'suitability', 'liquidity'];
  const rows = dims.map(key => {
    const d = rd[key];
    if (!d) return '';
    // The level + color tone always stay deterministic (the engine owns
    // the classification). Only the explanation prose is AI-authored
    // when a refresh is active.
    const aiText = (aiRiskSurface && typeof aiRiskSurface[key] === 'string') ? aiRiskSurface[key] : null;
    const explain = aiText
      ? _emphasizeTickers(_emphasizeNumbers(_escapeHtml(aiText)))
      : _emphasizeTickers(_emphasizeNumbers(_interpolate(t(d.explainKey), d.explainVars || {})));
    const tone    = _dimensionTone(key, d.level);
    return `
      <div class="intel-riskdim-row">
        <div class="intel-riskdim-head">
          <span class="intel-riskdim-label">${t(d.labelKey)}</span>
          <span class="intel-riskdim-level intel-riskdim-level--${tone}">${t(d.levelKey)}</span>
        </div>
        <p class="intel-riskdim-explain">${explain}</p>
      </div>
    `;
  }).join('');

  return `
    <div class="intel-riskdim">
      <h3 class="intel-riskdim-title">${t('intel.riskSurface')}</h3>
      ${rows}
    </div>
  `;
}

// Maps each (dimension, level) to a tone keyword for the chip color.
// "Position 1" is the calm/strong/well-suited end of each dimension's
// scale; "position 3" is the elevated/narrow/mismatch/thin end. The
// tone names are dimension-agnostic so the CSS can style them once.
function _dimensionTone(dim, level) {
  const map = {
    volatility:      { low: 'a',   moderate: 'b',     elevated: 'c'   },
    concentration:   { low: 'a',   moderate: 'b',     elevated: 'c'   },
    diversification: { broad: 'a', moderate: 'b',     narrow: 'c'     },
    suitability:     { wellSuited: 'a', appropriate: 'b', cautious: 'b', mismatch: 'c' },
    liquidity:       { strong: 'a', adequate: 'b',   thin: 'c'        },
  };
  return (map[dim] && map[dim][level]) || 'unknown';
}


// ── Ask the Assistant — inline panel ─────────────────────────────
//
// Rendered into a placeholder; the dynamic chat behavior is wired
// up by assistant.js after the DOM exists. The page only ships the
// shell + suggested-questions chips.

function _renderAssistantPanel() {
  const suggestions = ['assistant.q1', 'assistant.q2', 'assistant.q3', 'assistant.q4']
    .map(k => `<button type="button" class="intel-ask-suggestion" data-question="${_escapeHtml(t(k))}">${t(k)}</button>`)
    .join('');

  // Assistant mark (a quiet 4-point spark) + an up-arrow send glyph.
  // Monochrome / single-accent — "intelligent assistant," not chatbot.
  const sparkIcon = `<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 1l1.2 5.8L15 8l-5.8 1.2L8 15l-1.2-5.8L1 8l5.8-1.2z"/></svg>`;
  const sendIcon  = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.6V3.6M4.4 7.2 8 3.6l3.6 3.6"/></svg>`;

  return `
    <section class="intel-ask" id="intel-ask">
      <header class="intel-ask-header">
        <span class="intel-ask-avatar" aria-hidden="true">${sparkIcon}</span>
        <div class="intel-ask-heading">
          <h2 class="intel-ask-title">${t('assistant.title')}</h2>
          <p class="intel-ask-subtitle">${t('assistant.subtitle')}</p>
        </div>
      </header>

      <form class="intel-ask-form" id="intel-ask-form" onsubmit="onIntelAskSubmit(event)">
        <div class="intel-ask-field">
          <input type="text" class="intel-ask-input" id="intel-ask-input"
                 placeholder="${t('assistant.placeholder')}"
                 autocomplete="off" />
          <button type="submit" class="intel-ask-send" aria-label="${_escapeHtml(t('assistant.send'))}">
            ${sendIcon}
          </button>
        </div>
      </form>

      <div class="intel-ask-suggestions">
        <span class="intel-ask-suggested-label">${t('assistant.suggested')}</span>
        <div class="intel-ask-chips">
          ${suggestions}
        </div>
      </div>

      <div class="intel-ask-output" id="intel-ask-output"></div>
    </section>
  `;
}


// ── Priority Findings tier ───────────────────────────────────────

function _renderPriorityFindings(insights) {
  if (!insights.length) return '';
  const cards = insights.map(i => _renderInsightCard(i)).join('');
  return `
    <section class="intel-tier intel-tier--priority">
      <h2 class="intel-tier-title">${t('intel.priorityFindings')}</h2>
      <div class="intel-cards">
        ${cards}
      </div>
    </section>
  `;
}


// ── Observations rail ────────────────────────────────────────────

function _renderObservations(insights) {
  if (!insights.length) return '';
  const rows = insights.map(i => {
    const title = _interpolate(t(i.titleKey), _resolveLocalizedVars(i.titleVars || {}));
    const body  = _emphasizeNumbers(
      _interpolate(t(i.bodyKey), _formatBodyVars(_resolveLocalizedVars(i.bodyVars || {})))
    );
    const label = i.labelKey
      ? `<span class="intel-obs-chip intel-obs-chip--${_labelTone(i.labelKey)}">${t(i.labelKey)}</span>`
      : '';
    return `
      <li class="intel-obs intel-obs--${i.severity}">
        <div class="intel-obs-head">
          <h3 class="intel-obs-title">${title}</h3>
          ${label}
        </div>
        <p class="intel-obs-body">${body}</p>
      </li>
    `;
  }).join('');

  return `
    <section class="intel-tier intel-tier--observations">
      <h2 class="intel-tier-title">${t('intel.observations')}</h2>
      <ul class="intel-obs-list">${rows}</ul>
    </section>
  `;
}


// ── Insight card (priority tier only) ────────────────────────────

function _renderInsightCard(insight) {
  const title    = _interpolate(t(insight.titleKey), _resolveLocalizedVars(insight.titleVars || {}));
  const bodyVars = _formatBodyVars(_resolveLocalizedVars(insight.bodyVars || {}));
  const body     = _emphasizeNumbers(_interpolate(t(insight.bodyKey), bodyVars));
  const label    = insight.labelKey
    ? `<span class="intel-card-label intel-card-label--${_labelTone(insight.labelKey)}">${t(insight.labelKey)}</span>`
    : '';

  // "Why it matters" (context) and "What might shift it" (action) are
  // each their own soft panel with an eyebrow label, so the two no
  // longer blend into one gray block.
  const whyMatters = insight.whyMattersKey
    ? `<div class="intel-card-note intel-card-note--why">
         <span class="intel-card-note-label">${t('intel.whyMatters')}</span>
         <p class="intel-card-note-text">${_emphasizeNumbers(_interpolate(t(insight.whyMattersKey), bodyVars))}</p>
       </div>`
    : '';

  const suggestion = insight.suggestionKey
    ? `<div class="intel-card-note intel-card-note--action">
         <span class="intel-card-note-label">${t('intel.suggestion')}</span>
         <p class="intel-card-note-text">${_emphasizeNumbers(_interpolate(t(insight.suggestionKey), bodyVars))}</p>
       </div>`
    : '';

  // Confidence qualifier — only rendered when not "high". Keeps the
  // page clean by default; surfaces honestly that a finding depends
  // on heuristics (e.g., pension-track composition estimates).
  const confidence = (insight.confidence && insight.confidence !== 'high')
    ? `<p class="intel-card-confidence"><span class="intel-card-confidence-label">${t('intel.confidence')}:</span> ${t('intel.confidence.' + insight.confidence)}</p>`
    : '';

  const evidence = _renderEvidence(insight.evidence);

  return `
    <article class="intel-card intel-card--${insight.severity}">
      <header class="intel-card-header">
        <h3 class="intel-card-title">${title}</h3>
        ${label}
      </header>
      <p class="intel-card-body">${body}</p>
      ${whyMatters}
      ${suggestion}
      ${confidence}
      ${evidence}
    </article>
  `;
}


// ── AI render paths ──────────────────────────────────────────────
//
// These mirror the deterministic renderers exactly — same DOM, same CSS
// classes — but read already-localized literal strings from the AI
// payload instead of i18n keys. That is what keeps the design byte-for-
// byte identical when an AI refresh is active: only the text source
// differs. Every string is escaped before the number/ticker emphasis
// runs, and evidence holdings carry engine-resolved values only.

function _renderPriorityFindingsAI(ai) {
  const cards = (ai.cards || []).filter(c => c.tier === 'priority');
  if (!cards.length) return '';
  return `
    <section class="intel-tier intel-tier--priority">
      <h2 class="intel-tier-title">${t('intel.priorityFindings')}</h2>
      <div class="intel-cards">
        ${cards.map(_renderInsightCardAI).join('')}
      </div>
    </section>
  `;
}

function _renderObservationsAI(ai) {
  const cards = (ai.cards || []).filter(c => c.tier !== 'priority');
  if (!cards.length) return '';
  const rows = cards.map(c => {
    const body  = _emphasizeNumbers(_escapeHtml(c.summary));
    const label = `<span class="intel-obs-chip intel-obs-chip--${c.label}">${t('priority.' + c.label)}</span>`;
    return `
      <li class="intel-obs intel-obs--${c.severity}">
        <div class="intel-obs-head">
          <h3 class="intel-obs-title">${_escapeHtml(c.title)}</h3>
          ${label}
        </div>
        <p class="intel-obs-body">${body}</p>
      </li>
    `;
  }).join('');

  return `
    <section class="intel-tier intel-tier--observations">
      <h2 class="intel-tier-title">${t('intel.observations')}</h2>
      <ul class="intel-obs-list">${rows}</ul>
    </section>
  `;
}

function _renderInsightCardAI(card) {
  const body  = _emphasizeNumbers(_escapeHtml(card.summary));
  const label = `<span class="intel-card-label intel-card-label--${card.label}">${t('priority.' + card.label)}</span>`;

  const whyMatters = card.whyItMatters
    ? `<div class="intel-card-note intel-card-note--why">
         <span class="intel-card-note-label">${t('intel.whyMatters')}</span>
         <p class="intel-card-note-text">${_emphasizeNumbers(_escapeHtml(card.whyItMatters))}</p>
       </div>`
    : '';

  const suggestion = card.whatCouldImproveIt
    ? `<div class="intel-card-note intel-card-note--action">
         <span class="intel-card-note-label">${t('intel.suggestion')}</span>
         <p class="intel-card-note-text">${_emphasizeNumbers(_escapeHtml(card.whatCouldImproveIt))}</p>
       </div>`
    : '';

  const confidence = (card.confidence && card.confidence !== 'high')
    ? `<p class="intel-card-confidence"><span class="intel-card-confidence-label">${t('intel.confidence')}:</span> ${t('intel.confidence.' + card.confidence)}</p>`
    : '';

  const evidence = _renderEvidence(card.evidence);

  return `
    <article class="intel-card intel-card--${card.severity}">
      <header class="intel-card-header">
        <h3 class="intel-card-title">${_escapeHtml(card.title)}</h3>
        ${label}
      </header>
      <p class="intel-card-body">${body}</p>
      ${whyMatters}
      ${suggestion}
      ${confidence}
      ${evidence}
    </article>
  `;
}


// ── Evidence renderers ───────────────────────────────────────────

function _renderEvidence(ev) {
  if (!ev) return '';
  switch (ev.kind) {
    case 'holdings':    return _evHoldings(ev);
    case 'contrast':    return _evContrast(ev);
    default:            return '';
  }
}

function _evHoldings(ev) {
  if (!ev.items || !ev.items.length) return '';
  const rows = ev.items.map(item => `
    <li class="intel-holding-row">
      <span class="intel-holding-name">
        ${_escapeHtml(item.name)}
        ${item.sub ? `<span class="intel-holding-sub">${_escapeHtml(item.sub)}</span>` : ''}
      </span>
      <span class="intel-holding-value">${formatCurrency(item.value)}</span>
      <span class="intel-holding-pct">${(item.pct * 100).toFixed(item.pct < 0.10 ? 1 : 0)}%</span>
    </li>
  `).join('');
  return `
    <div class="intel-evidence">
      <span class="intel-evidence-label">${t('intel.evidenceTitle')}</span>
      <ul class="intel-holdings">${rows}</ul>
    </div>
  `;
}

function _evContrast(ev) {
  if (!ev.pair || ev.pair.length !== 2) return '';
  const cell = (row) => {
    const label = currentLang === 'he' ? row.label : (row.labelEn || row.label);
    const eq = (row.equityPct || 0) * 100;
    const bd = (row.bondPct   || 0) * 100;
    const cs = (row.cashPct   || 0) * 100;
    return `
      <div class="intel-contrast-cell">
        <div class="intel-contrast-head">
          <span class="intel-contrast-label">${_escapeHtml(label)}</span>
          <span class="intel-contrast-score">${eq.toFixed(0)}% ${t('intel.comp.equity')}</span>
        </div>
        <div class="intel-compbar intel-compbar--mini">
          <div class="intel-compbar-seg intel-compbar-seg--equity" style="width: ${eq}%"></div>
          <div class="intel-compbar-seg intel-compbar-seg--bonds"  style="width: ${bd}%"></div>
          <div class="intel-compbar-seg intel-compbar-seg--cash"   style="width: ${cs}%"></div>
        </div>
      </div>
    `;
  };
  return `
    <div class="intel-evidence intel-contrast">
      ${cell(ev.pair[0])}
      ${cell(ev.pair[1])}
    </div>
  `;
}


// ── Helpers ──────────────────────────────────────────────────────

// Label tone — drives the CSS background color for the priority chip.
function _labelTone(labelKey) {
  switch (labelKey) {
    case 'priority.important': return 'important';
    case 'priority.attention': return 'attention';
    case 'priority.positive':  return 'positive';
    default:                   return 'healthy';
  }
}

// Emphasize the key figures (percentages and ₪ amounts, incl. compact
// "₪34K") inside an already-interpolated insight body, so the numbers a
// reader scans for lift out of the prose without bolding whole phrases.
// Bodies are plain text (no markup), so wrapping by regex is safe;
// product names like "S&P 500" or "NASDAQ" carry no % or ₪ and are left
// untouched.
function _emphasizeNumbers(text) {
  if (!text) return text;
  return String(text)
    .replace(/(\d[\d,]*(?:\.\d+)?\s*%)/g, '<span class="intel-num">$1</span>')
    .replace(/(-?₪\s?\d[\d,]*(?:\.\d+)?[KM]?)/g, '<span class="intel-num">$1</span>');
}

// Lift product / index tickers out of the running prose so they read as
// instruments, not stray words. Matches uppercase-led Latin runs —
// "VOO", "IBI", "NASDAQ", "S&P 500", "NASDAQ 100" — which inside this
// Hebrew-first copy are always instruments; lowercase words and single
// letters never match, so ordinary text is untouched. Runs after
// _emphasizeNumbers (the two target disjoint patterns).
function _emphasizeTickers(text) {
  if (!text) return text;
  return String(text).replace(/([A-Z][A-Z0-9&]+(?:\s\d+)?)/g, '<span class="intel-ticker">$1</span>');
}

function _formatBodyVars(vars) {
  const out = { ...vars };
  // Format ILS-amount fields as compact currency at render time.
  for (const key of ['total', 'idle', 'avail', 'recurring']) {
    if (typeof out[key] === 'number') out[key] = formatCurrencyCompact(out[key]);
  }
  return out;
}

function _interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? _escapeHtml(v) : String(v);
  });
}

function _resolveLocalizedVars(vars) {
  const out = { ...vars };
  if (out.nameEn !== undefined || out.nameHe !== undefined) {
    out.name = currentLang === 'he' ? (out.nameHe || out.nameEn) : (out.nameEn || out.nameHe);
  }
  if (out.aLabelEn !== undefined) {
    out.aLabel = currentLang === 'he' ? out.aLabel : (out.aLabelEn || out.aLabel);
  }
  if (out.bLabelEn !== undefined) {
    out.bLabel = currentLang === 'he' ? out.bLabel : (out.bLabelEn || out.bLabel);
  }
  return out;
}

function _escapeHtml(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
