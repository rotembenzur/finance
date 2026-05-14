// ─────────────────────────────────────────────────────────────────
//  LLM CONTEXT — Markdown fact sheet for the assistant
//
//  Pure function buildFactSheet(profile, insights) → Markdown string.
//
//  This is the single source of truth the AI assistant reads. The
//  fact sheet is structured, dense, and unambiguous: total wealth,
//  composition, per-account breakdown, cash position, concentration,
//  active insights — each section rendered as a small Markdown table
//  or bullet list.
//
//  Critical: the LLM grounds its answers on this fact sheet. New
//  analytical capabilities (in profile.js / insights.js) extend the
//  fact sheet here, not the system prompt itself. That keeps the
//  prompt stable (and prompt-cacheable) while the engine evolves.
// ─────────────────────────────────────────────────────────────────

export function buildFactSheet(profile, insights = []) {
  if (!profile) return '(no portfolio data available)';

  const a    = profile.aggregate || {};
  const r    = profile.risk      || {};
  const c    = profile.concentration || {};
  const cash = profile.cash || {};
  const age  = profile.meta && profile.meta.age;

  const lines = [];

  // ── Top-line ─────────────────────────────────────────────
  lines.push('## Portfolio summary');
  lines.push(`- Total wealth: ${_ils(a.total)}`);
  if (age != null) lines.push(`- Owner age: ${age}`);
  lines.push(`- Number of accounts/products tracked: ${profile.accounts.length}`);
  lines.push('');

  // ── Composition ──────────────────────────────────────────
  lines.push('## Aggregate composition');
  lines.push(`- Stocks: ${_pct(a.equityPct)} (${_ils(a.equityValue)})`);
  lines.push(`- Bonds: ${_pct(a.bondPct)} (${_ils(a.bondValue)})`);
  lines.push(`- Cash: ${_pct(a.cashPct)} (${_ils(a.cashValue)})`);
  if (r.aggregate && r.aggregate.techPct) {
    lines.push(`- Of which US tech (NASDAQ/S&P 500 large-cap): ${_pct(r.aggregate.techPct)} of total wealth`);
  }
  lines.push('');

  // ── Accounts ─────────────────────────────────────────────
  lines.push('## Accounts and long-term products');
  for (const g of profile.accounts) {
    const eq = Math.round((g.composition.equity || 0) * 100);
    const bd = Math.round((g.composition.bonds  || 0) * 100);
    const cs = Math.round((g.composition.cash   || 0) * 100);
    lines.push(`- **${g.label}** (${g.kind}): ${_ils(g.totalILS)} — ${eq}% stocks / ${bd}% bonds / ${cs}% cash. Composition source: ${g.source}.`);
  }
  lines.push('');

  // ── Cash position ────────────────────────────────────────
  lines.push('## Cash position');
  lines.push(`- Available (checking + cash + foreign cash): ${_ils(cash.availableILS)}`);
  lines.push(`- Tracked recurring monthly outflow: ${_ils(cash.recurringMonthly)}`);
  if (Number.isFinite(cash.monthsOfCover)) {
    lines.push(`- Months of cover (available ÷ recurring): ${cash.monthsOfCover.toFixed(1)}`);
  } else {
    lines.push(`- Months of cover: unbounded (no recurring outflow tracked)`);
  }
  lines.push(`- Idle above a 3-month buffer: ${_ils(cash.idleILS)}`);
  lines.push('');

  // ── Concentration ────────────────────────────────────────
  if (c.holdings && c.holdings.length) {
    lines.push('## Single-name concentration (invested tier)');
    lines.push(`- Top-3 combined weight: ${_pct(c.top || 0)} of named-holdings exposure (${_ils(c.total)})`);
    lines.push(`- Top 5 named positions:`);
    for (const h of c.holdings.slice(0, 5)) {
      lines.push(`  - ${h.name}: ${_ils(h.value)} (${_pct(h.pct)})`);
    }
    lines.push('');
  }

  // ── Index overlap ────────────────────────────────────────
  if (profile.overlap && profile.overlap.length) {
    const meaningful = profile.overlap.filter(g => g.holdings.length >= 2 || g.pct >= 0.15);
    if (meaningful.length) {
      lines.push('## Benchmark exposure');
      for (const g of meaningful) {
        lines.push(`- **${g.nameEn}**: ${g.holdings.length} ${g.holdings.length === 1 ? 'product' : 'products'} totaling ${_ils(g.totalValue)} (${_pct(g.pct)} of benchmark-tagged equity)`);
        for (const h of g.holdings) {
          const wTag = h.weight < 1 ? ` (effective weight ${Math.round(h.weight * 100)}%)` : '';
          lines.push(`  - ${h.name}: ${_ils(h.value)}${wTag}`);
        }
      }
      lines.push('');
    }
  }

  // ── Currency exposure ────────────────────────────────────
  if (profile.currencies && profile.currencies.length > 1) {
    lines.push('## Currency exposure');
    for (const cur of profile.currencies) {
      lines.push(`- ${cur.code}: ${_ils(cur.totalILS)} (${_pct(cur.pct)} of total)`);
    }
    lines.push('');
  }

  // ── Per-account risk scores ──────────────────────────────
  if (r.perAccount && r.perAccount.length) {
    lines.push('## Composition risk per account (0-10 scale)');
    for (const p of r.perAccount) {
      lines.push(`- ${p.label}: ${p.profile.score.toFixed(1)} — ${_pct(p.profile.equityPct)} stocks`);
    }
    if (r.aggregate) {
      lines.push(`- **Aggregate**: ${r.aggregate.score.toFixed(1)} — ${_pct(r.aggregate.equityPct)} stocks across everything`);
    }
    lines.push('');
  }

  // ── Active analytical insights ───────────────────────────
  if (insights && insights.length) {
    lines.push('## Active analytical insights');
    lines.push('Each insight has a stable id, an impact level, a finding, and (when applicable) a why-this-matters and a soft suggestion.');
    lines.push('');
    for (const i of insights) {
      lines.push(`### [${i.impact}] ${i.id} (${i.type})`);
      lines.push(`- Finding: ${_renderTemplate(i.bodyKey, i.bodyVars)}`);
      if (i.whyMattersKey) lines.push(`- Why it matters: ${_renderTemplate(i.whyMattersKey, i.bodyVars)}`);
      if (i.suggestionKey) lines.push(`- What might shift it: ${_renderTemplate(i.suggestionKey, i.bodyVars)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}


// ── Helpers ──────────────────────────────────────────────────────

function _ils(n) {
  if (!Number.isFinite(n)) return '?';
  return '₪' + Math.round(n).toLocaleString('en-US');
}

function _pct(n) {
  if (!Number.isFinite(n)) return '?';
  return (n * 100).toFixed(0) + '%';
}

// Render an i18n template inline without depending on i18n.js (the
// fact sheet is built server-side too and shouldn't reach into the
// browser i18n module). Uses the English variant by convention — the
// assistant's system prompt instructs it to respond in the user's
// language regardless, so the fact sheet is canonically English.
function _renderTemplate(key, vars) {
  // Tiny inline copy of the keys we actually emit — keeps this module
  // browser/server-agnostic. New templates added by rules need a line
  // here too.
  const TEMPLATES = {
    'insights.concentration.body.two':    '{first} and {second} together make up {pct}% of the invested portfolio.',
    'insights.concentration.body.three':  '{first}, {second} and {third} together carry {pct}% of the invested portfolio.',
    'insights.concentration.body.spread': 'Top three holdings together hold {pct}% — reasonably spread.',
    'insights.concentration.why':         'When this much weight sits in a few names, a bad month for any one of them moves the whole portfolio more than the market would.',
    'insights.concentration.suggestion':  'A broader index fund alongside these holdings is the typical way to soften single-name concentration.',
    'insights.techBias.body':             '{tech}% of all wealth is in US tech (NASDAQ/S&P 500), out of {equity}% in stocks overall.',
    'insights.techBias.why':              'US tech moves harder than the broad market in both directions — strong tailwind in good years, deeper drawdowns in bad ones.',
    'insights.techBias.suggestion':       'Broad-world or non-US-focused funds (e.g. VT, EFA-style) are the usual way to dilute this without exiting stocks.',
    'insights.overlap.body':              '{count} products all track {nameEn} — together {pct}% of benchmark-tagged stocks ({total}).',
    'insights.overlap.why':               'These move almost in lockstep. Holding more than one isn’t added diversification.',
    'insights.overlap.suggestion':        'Consolidating usually keeps the same exposure with cleaner accounting.',
    'insights.compRisk.body':             '{aLabelEn} sits at {aEquityPct}% stocks while {bLabelEn} is at {bEquityPct}%. Wide gap.',
    'insights.compRisk.why':              'Different accounts can defensibly carry different postures. Worth knowing the spread exists.',
    'insights.cash.body.shortCover':      'Available cash covers only {months} months of monthly outflow.',
    'insights.cash.body.idleOverBuffer':  'Stocks side already doing the long-term work; {idle} sits above the cash buffer needed.',
    'insights.cash.body.idleConservative':'Cash above buffer, but portfolio not stocks-heavy — conservative posture, not inefficiency.',
    'insights.cash.body.strongBallast':   'Cash covers {months} months of monthly outflow — meaningful ballast against stocks exposure elsewhere.',
    'insights.cash.body.noRecurring':     'Notable cash balance, no recurring monthly outflow tracked yet.',
    'insights.cash.body.adequate':        'Cash covers monthly outflow with room to spare.',
    'insights.cash.why.shortCover':       'A thin buffer concentrates timing risk.',
    'insights.cash.why.idle':             'Capital sitting in checking loses ground to inflation.',
    'insights.cash.why.ballast':          'Cash on hand removes pressure to sell stocks at a low in a drawdown.',
    'insights.cash.suggestion.idle':      'A money-market fund or short-duration savings is the usual middle ground.',
  };
  const tpl = TEMPLATES[key] || key;
  const v = vars || {};
  // Use English labels when both exist (factsheet is canonically English).
  const resolved = { ...v };
  if (v.aLabelEn !== undefined) resolved.aLabelEn = v.aLabelEn || v.aLabel;
  if (v.bLabelEn !== undefined) resolved.bLabelEn = v.bLabelEn || v.bLabel;
  if (v.nameEn   !== undefined) resolved.nameEn   = v.nameEn   || v.nameHe;
  if (typeof resolved.total     === 'number') resolved.total     = _ils(resolved.total);
  if (typeof resolved.idle      === 'number') resolved.idle      = _ils(resolved.idle);
  if (typeof resolved.avail     === 'number') resolved.avail     = _ils(resolved.avail);
  if (typeof resolved.recurring === 'number') resolved.recurring = _ils(resolved.recurring);
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (resolved[k] !== undefined && resolved[k] !== null ? String(resolved[k]) : ''));
}
