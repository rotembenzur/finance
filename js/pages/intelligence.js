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

  return `
    <section class="section intel" id="intelligence">
      ${_renderHeadline()}
      ${_renderPortfolioRead(profile, read)}
      ${_renderAssistantPanel()}
      ${_renderPriorityFindings(priority)}
      ${_renderObservations(observations)}
      <p class="intel-footer">${t('intel.footer')}</p>
    </section>
  `;
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

function _renderPortfolioRead(profile, read) {
  if (!read || !read.sentences || !read.sentences.length) return '';

  // Compose paragraph from the sentence array. Each sentence is
  // looked up in i18n and interpolated. Output is a single flowing
  // paragraph — the engine controls which sentences appear; the
  // page just renders them in order.
  const paragraph = read.sentences
    .map(s => _interpolate(t(s.key), _formatBodyVars(_resolveLocalizedVars(s.vars || {}))))
    .filter(Boolean)
    .join(' ');

  const a   = profile.aggregate;
  const age = profile.meta && profile.meta.age;
  const tail = [
    formatCurrencyCompact(a.total),
    age != null ? `${t('intel.age')} ${age}` : null,
  ].filter(Boolean).join(' · ');

  return `
    <section class="intel-read">
      <p class="intel-read-paragraph">${paragraph}</p>
      <div class="intel-read-tail">${tail}</div>
      ${_renderRiskSurface(profile)}
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

function _renderRiskSurface(profile) {
  const rd = profile.riskDimensions;
  if (!rd) return '';

  const dims = ['volatility', 'concentration', 'diversification', 'suitability', 'liquidity'];
  const rows = dims.map(key => {
    const d = rd[key];
    if (!d) return '';
    const explain = _interpolate(t(d.explainKey), d.explainVars || {});
    const tone    = _dimensionTone(key, d.level);
    return `
      <div class="intel-riskdim-row">
        <span class="intel-riskdim-label">${t(d.labelKey)}</span>
        <span class="intel-riskdim-level intel-riskdim-level--${tone}">${t(d.levelKey)}</span>
        <span class="intel-riskdim-explain">${explain}</span>
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

  return `
    <section class="intel-ask" id="intel-ask">
      <header class="intel-ask-header">
        <h2 class="intel-ask-title">${t('assistant.title')}</h2>
        <p class="intel-ask-subtitle">${t('assistant.subtitle')}</p>
      </header>
      <div class="intel-ask-suggestions">
        <span class="intel-ask-suggested-label">${t('assistant.suggested')}:</span>
        ${suggestions}
      </div>
      <form class="intel-ask-form" id="intel-ask-form" onsubmit="onIntelAskSubmit(event)">
        <input type="text" class="intel-ask-input" id="intel-ask-input"
               placeholder="${t('assistant.placeholder')}"
               autocomplete="off" />
        <button type="submit" class="intel-ask-send btn btn-primary">${t('assistant.send')}</button>
      </form>
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
    const body  = _interpolate(t(i.bodyKey),  _formatBodyVars(_resolveLocalizedVars(i.bodyVars || {})));
    const label = i.labelKey ? `<span class="intel-obs-label intel-obs-label--${_labelTone(i.labelKey)}">${t(i.labelKey)}</span>` : '';
    return `
      <li class="intel-obs intel-obs--${i.severity}">
        <span class="intel-dot intel-dot--${i.severity}"></span>
        <span class="intel-obs-text">
          <span class="intel-obs-title">${title}.</span>
          <span class="intel-obs-body">${body}</span>
        </span>
        ${label}
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
  const body     = _interpolate(t(insight.bodyKey), bodyVars);
  const label    = insight.labelKey
    ? `<span class="intel-card-label intel-card-label--${_labelTone(insight.labelKey)}">${t(insight.labelKey)}</span>`
    : '';

  const whyMatters = insight.whyMattersKey
    ? `<p class="intel-card-why"><span class="intel-card-why-label">${t('intel.whyMatters')}:</span> ${_interpolate(t(insight.whyMattersKey), bodyVars)}</p>`
    : '';

  const suggestion = insight.suggestionKey
    ? `<p class="intel-card-suggestion"><span class="intel-card-suggestion-label">${t('intel.suggestion')}:</span> ${_interpolate(t(insight.suggestionKey), bodyVars)}</p>`
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
        <span class="intel-dot intel-dot--${insight.severity}"></span>
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
