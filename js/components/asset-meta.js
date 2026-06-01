// ─────────────────────────────────────────────────────────────────
//  ASSET META — the gray descriptive line under each asset.
//
//  One module produces, for every "product" entry and every home
//  dashboard tier, a structured meta object:
//
//    {
//      headline,           // reassuring sentence (always shown)
//      subline,            // supporting fact (institution, track, dates)
//      progress?,          // optional thin bar { pct, variant }
//      trend?,             // 'up'|'down'|'neutral' — colors headline
//      infoType?,          // attaches an (i) tooltip to the headline
//    }
//
//  `renderMetaStack(meta)` turns that into the two-tier HTML stack
//  used inside `.home-row-meta` and `.holding-row-meta`. For entries
//  outside the "product" set (individual stocks, generic funds, bank
//  checking, etc.) `buildEntryMeta` returns null so the caller keeps
//  its existing one-line rendering.
//
//  Headlines are reassuring sentences (per the user's chosen tone):
//  the goal is comprehension at a glance + emotional clarity, not
//  just denser data.
// ─────────────────────────────────────────────────────────────────

import { t, currentLang } from '../i18n.js';
import { formatMilestone } from '../dates.js';
import {
  calcDaysUntil, entryValue,
  calcCashTotal, calcTotalGain, calcTotalGainPercent,
  calcCardPendingCharges,
  getAvailableEntries, getFutureWealthEntries, getFutureDepositsEntries,
  getInvestedEntries, getBankAccountEntries, getWalletEntries,
  getBank,
  formatCurrency,
  _iconInfo,
} from '../utils.js';

// ─────────────────────────────────────────
//  PUBLIC: ENTRY META
// ─────────────────────────────────────────

export function buildEntryMeta(entry, data) {
  switch (entry.type) {
    case 'pension':          return _pensionMeta(entry, data);
    case 'study_fund':       return _studyFundMeta(entry, data);
    case 'investment_gemel': return _investmentGemelMeta(entry, data);
    case 'provident_fund':   return _providentMeta(entry, data);
    case 'military_deposit': return _militaryMeta(entry, data);
    case 'savings':
      return (entry.isLocked && entry.maturityDate) ? _lockedSavingsMeta(entry, data) : null;
    default:
      return null;
  }
}

function _pensionMeta(entry, data) {
  // Tracks flow INLINE with the institution on the subline — same
  // visual rhythm as other products. Previously they lived on their
  // own `notes` row beneath, which made the pension row twice as tall
  // as everything else around it. Joining with " · " keeps the line
  // compact:  הראל · מסלול מניות — ₪83,062 · גיל 50 ומטה — ₪20,669
  //
  // For mobile chips: each track is further split into a name-chip
  // and an amount-chip so the dense "X — ₪Y" pair becomes two
  // discrete tokens. Desktop keeps the joined string for compactness.
  const sub      = [];
  const subParts = [];
  if (entry.institution) {
    sub.push(entry.institution);
    subParts.push(entry.institution);
  }

  if (entry.tracks && entry.tracks.length > 0) {
    for (const tr of entry.tracks) {
      const line = _formatPensionTrackLine(tr);
      if (line) sub.push(line);
      // Mobile chips: name and value as separate tokens.
      const name = currentLang === 'he'
        ? (tr.name || tr.nameEn || '')
        : (tr.nameEn || tr.name || '');
      if (name) subParts.push(name);
      if (tr.value != null) subParts.push(formatCurrency(tr.value));
    }
  } else {
    const trackName = currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName);
    if (trackName) {
      sub.push(trackName);
      subParts.push(trackName);
    }
  }

  // Recurring transfer (if any) still gets its own descriptive
  // sentence beneath — those are full sentences, not metadata tokens,
  // and the pension currently has none so notes stays empty here.
  const notes = [];
  const rec = _findMonthlyRecurring(data, entry.id);
  if (rec) notes.push(_formatRecurringSentence(rec, data));
  const pensionDesc = _descNote(entry);
  if (pensionDesc) notes.push(pensionDesc);

  return {
    headline: t('meta.pension.headline'),
    subline:  sub.join(' · '),
    subParts,
    notes,
    infoType: 'pension',
  };
}

// Build a single track's descriptive line. Format: "Name — ₪Amount".
// Management fees are stored on the data but intentionally not
// surfaced — the user found them visual noise and asked to drop them.
function _formatPensionTrackLine(tr) {
  const name = currentLang === 'he'
    ? (tr.name || tr.nameEn || '')
    : (tr.nameEn || tr.name || '');
  if (!name) return '';

  // "₪value" plus the allocation share when the track is managed by
  // percentage — e.g. "Stocks — ₪80,000 · 80%".
  let amount = tr.value != null ? formatCurrency(tr.value) : '';
  if (Number.isFinite(tr.pct)) {
    const pct = Math.round(tr.pct * 100) / 100;
    amount += (amount ? ' · ' : '') + `${pct}%`;
  }
  const parts = [name];
  if (amount) parts.push(amount);
  return parts.join(' — ');
}

// Build "Name — ₪value" lines from an entry's tracks[] (any product
// type). Returns null when the entry has no structured tracks, so
// callers fall back to the legacy single `trackName` string.
function _trackLines(entry) {
  if (!Array.isArray(entry.tracks) || entry.tracks.length === 0) return null;
  const lines = entry.tracks.map(_formatPensionTrackLine).filter(Boolean);
  return lines.length ? lines : null;
}

// User-authored description / status text, language-aware. Accepts the
// bilingual { he, en } object or a plain string.
function _descNote(entry) {
  const d = entry.description;
  if (!d) return null;
  const txt = typeof d === 'string' ? d : (d[currentLang] || d.he || d.en);
  return txt || null;
}

function _studyFundMeta(entry, data) {
  const sub = [];
  if (entry.institution) sub.push(entry.institution);
  const trackLines = _trackLines(entry);
  if (trackLines) {
    sub.push(...trackLines);
  } else {
    const trackName = currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName);
    if (trackName) sub.push(trackName);
  }

  const days = entry.maturityDate ? calcDaysUntil(entry.maturityDate) : null;
  const isNear = days != null && days >= 0 && days <= 365;

  if (entry.maturityDate) {
    const date = formatMilestone(entry.maturityDate);
    const rel  = _formatLongRelative(days);
    sub.push(rel ? `${t('meta.unlocks')} ${date} · ${rel}` : `${t('meta.unlocks')} ${date}`);
  }

  const notes = [];
  const desc = _descNote(entry);
  if (desc) notes.push(desc);

  return {
    headline: isNear ? t('meta.studyFund.headlineNear') : t('meta.studyFund.headline'),
    subline:  sub.join(' · '),
    subParts: sub.slice(),
    notes,
    infoType: 'study_fund',
  };
}

function _investmentGemelMeta(entry, data) {
  const sub = [];
  if (entry.institution) sub.push(entry.institution);

  // Surface the investment path(s) — meaningful financial structure
  // the user wants visible.
  const trackLines = _trackLines(entry);
  if (trackLines) {
    sub.push(...trackLines);
  } else {
    const trackName = currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName);
    if (trackName) sub.push(trackName);
  }

  // The recurring monthly transfer is the day-to-day signal that
  // actually matters here. The yearly contribution allowance
  // (yearlyDeposited / annualLimit / remainingAllowance) is still
  // stored on the entry for future drill-downs, but it doesn't
  // belong in the main row — it competes with the meaningful info
  // and the user is unlikely to reach the cap.
  const notes = [];
  const rec = _findMonthlyRecurring(data, entry.id);
  if (rec) notes.push(_formatRecurringSentence(rec, data));
  const desc = _descNote(entry);
  if (desc) notes.push(desc);

  return {
    headline: t('meta.investmentGemel.headline'),
    subline:  sub.join(' · '),
    subParts: sub.slice(),
    notes,
    infoType: 'investment_gemel',
  };
}

function _providentMeta(entry, data) {
  const sub = [];
  if (entry.institution) sub.push(entry.institution);
  const trackLines = _trackLines(entry);
  if (trackLines) {
    sub.push(...trackLines);
  } else {
    const trackName = currentLang === 'he' ? entry.trackName : (entry.trackNameEn || entry.trackName);
    if (trackName) sub.push(trackName);
  }

  const notes = [];
  const rec = _findMonthlyRecurring(data, entry.id);
  if (rec) notes.push(_formatRecurringSentence(rec, data));
  const desc = _descNote(entry);
  if (desc) notes.push(desc);

  return {
    headline: t('meta.providentFund.headline'),
    subline:  sub.join(' · '),
    subParts: sub.slice(),
    notes,
    infoType: 'provident_fund',
  };
}

// Military discharge deposit — known 5-year lock. We anchor "0%" to
// 5 years before the maturity date so the bar fills as the wait
// passes, even though we don't store the discharge date.
function _militaryMeta(entry, data) {
  const days = entry.maturityDate ? calcDaysUntil(entry.maturityDate) : null;
  const isNear = days != null && days >= 0 && days <= 180;

  const sub = [];
  if (entry.institution) sub.push(entry.institution);

  let progress = null;
  if (days != null) {
    const date   = formatMilestone(entry.maturityDate);
    const prefix = entry.maturityDateEstimated ? '~' : '';
    const rel    = _formatLongRelative(days);
    sub.push(rel ? `${rel} · ${prefix}${date}` : `${prefix}${date}`);

    const TOTAL = 5 * 365;
    const elapsed = Math.max(0, TOTAL - days);
    progress = {
      pct:     Math.min(100, Math.max(0, Math.round((elapsed / TOTAL) * 100))),
      variant: 'warm',
    };
  }

  return {
    headline: isNear ? t('meta.military.headlineNear') : t('meta.military.headline'),
    subline:  sub.join(' · '),
    subParts: sub.slice(),
    progress,
    infoType: 'military_deposit',
  };
}

function _lockedSavingsMeta(entry, data) {
  const days = calcDaysUntil(entry.maturityDate);
  // Three states by proximity to the release date. "Ready" is purely
  // visual — the deposit never auto-releases into the checking account.
  const isReady = days <= 0;                 // on / past the release date
  const isNear  = days > 0 && days <= 60;    // closing in

  const sub = [];
  if (entry.institution) sub.push(entry.institution);

  const date = formatMilestone(entry.maturityDate);
  const rel  = _formatLongRelative(days);
  sub.push(rel ? `${t('meta.unlocks')} ${date} · ${rel}` : `${t('meta.unlocks')} ${date}`);

  // Optional free-text status the user typed in the deposit editor —
  // surfaced as a discrete note line beneath the subline.
  const notes = [];
  if (entry.depositStatus) notes.push(entry.depositStatus);

  let headline;
  if (isReady)     headline = t('meta.lockedSavings.headlineReady');
  else if (isNear) headline = t('meta.lockedSavings.headlineNear');
  else             headline = t('meta.lockedSavings.headline');

  return {
    headline,
    subline:  sub.join(' · '),
    subParts: sub.slice(),
    notes,
    trend:    isReady ? 'up' : undefined,
  };
}

// ─────────────────────────────────────────
//  PUBLIC: HOME DASHBOARD TIER META
// ─────────────────────────────────────────

export function buildHomeTierMeta(tier, data) {
  switch (tier) {
    case 'available':        return _availableTierMeta(data);
    case 'invested':         return _investedTierMeta(data);
    case 'future_wealth':    return _futureWealthTierMeta(data);
    case 'future_deposits':  return _futureDepositsTierMeta(data);
    case 'cards':            return _cardsTierMeta(data);
    default: return null;
  }
}

function _availableTierMeta(data) {
  const cash      = calcCashTotal(data);
  const bankReady = getBankAccountEntries(data)
    .filter(e => !e.isLocked)
    .reduce((sum, e) => sum + entryValue(e), 0);
  const wallets   = getWalletEntries(data)
    .reduce((sum, e) => sum + (entryValue(e) || 0), 0);
  const liquid    = cash + bankReady + wallets;

  const upcoming = getAvailableEntries(data)
    .filter(e => e.isLocked && e.maturityDate)
    .map(e => ({ entry: e, days: calcDaysUntil(e.maturityDate) }))
    .filter(x => x.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  const sub = [];
  sub.push(`${formatCurrency(liquid)} ${t('meta.available.liquidSuffix')}`);
  if (upcoming) {
    const amount = formatCurrency(entryValue(upcoming.entry));
    const rel    = _formatLongRelative(upcoming.days);
    sub.push(rel ? `${amount} ${t('meta.unlocks')} ${rel}` : `${amount} ${t('meta.unlocks')}`);
  }

  return {
    headline: t('meta.available.headline'),
    subline:  sub.join(' · '),
  };
}

function _investedTierMeta(data) {
  const gain     = calcTotalGain(data);
  const gainPct  = calcTotalGainPercent(data);

  let headline = t('meta.invested.headlineGain');
  let trend    = 'up';
  if (gain == null)       { headline = t('meta.invested.headlineNeutral'); trend = 'neutral'; }
  else if (gain < 0)      { headline = t('meta.invested.headlineLoss');    trend = 'down'; }

  const sub = [];
  if (gain != null && gainPct != null) {
    const arrow   = gain >= 0 ? '↑' : '↓';
    const sign    = gain >= 0 ? '+' : '−';
    const pctStr  = `${sign}${Math.abs(gainPct).toFixed(1)}%`;
    sub.push(`${arrow} ${formatCurrency(Math.abs(gain))} ${t('meta.invested.lifetime')} · ${pctStr}`);
  }

  return { headline, subline: sub.join(' · '), trend };
}

function _futureWealthTierMeta(data) {
  const future = getFutureWealthEntries(data);
  const ids    = new Set(future.map(e => e.id));
  const monthly = (data.recurring || [])
    .filter(r => r.isActive && r.cycle === 'monthly' && ids.has(r.toEntryId))
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  const sub = [];
  if (monthly > 0) sub.push(`+${formatCurrency(monthly)} ${t('meta.perMonth')}`);
  sub.push(`${future.length} ${t('meta.retirementProducts')}`);

  return {
    headline: t('meta.futureWealth.headline'),
    subline:  sub.join(' · '),
  };
}

function _futureDepositsTierMeta(data) {
  const entries = getFutureDepositsEntries(data);
  const upcoming = entries
    .map(e => ({ entry: e, days: e.maturityDate ? calcDaysUntil(e.maturityDate) : null }))
    .filter(x => x.days != null && x.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  if (!upcoming) {
    return {
      headline: t('meta.futureDeposits.headline'),
      subline:  `${entries.length} ${t('meta.products')}`,
    };
  }

  const e      = upcoming.entry;
  const date   = formatMilestone(e.maturityDate);
  const prefix = e.maturityDateEstimated ? '~' : '';
  const rel    = _formatLongRelative(upcoming.days);

  const TOTAL = 5 * 365;
  const elapsed = Math.max(0, TOTAL - upcoming.days);
  const pct = Math.min(100, Math.max(0, Math.round((elapsed / TOTAL) * 100)));

  const headline = pct >= 50
    ? t('meta.futureDeposits.headlineProgressed')
    : t('meta.futureDeposits.headline');

  return {
    headline,
    subline:  rel ? `${rel} · ${prefix}${date}` : `${prefix}${date}`,
    progress: { pct, variant: 'warm' },
  };
}

function _cardsTierMeta(data) {
  const cards    = (data.cards || []).filter(c => c.isActive && !c.isDebit);
  // Pending billing total — sum of each card's in-window charges only.
  // See calcCardPendingCharges in utils.js for the boundary convention.
  const spending = cards.reduce((sum, c) => sum + calcCardPendingCharges(c), 0);
  const limit    = cards.reduce((sum, c) => sum + (c.creditLimit || 0), 0);
  const util     = limit > 0 ? (spending / limit) * 100 : null;

  let headline = t('meta.cards.headlineComfortable');
  let variant  = 'blue';
  if (util != null) {
    if (util > 90)      { headline = t('meta.cards.headlineNearLimit'); variant = 'red';   }
    else if (util > 60) { headline = t('meta.cards.headlineHigh');      variant = 'amber'; }
    else if (util > 30) { headline = t('meta.cards.headlineHealthy');   variant = 'blue';  }
  }

  // Surface the upcoming billing date only for cards that actually
  // have a pending balance to be charged.
  const nextBilling = cards
    .filter(c => calcCardPendingCharges(c) > 0 && c.nextBilling)
    .map(c => ({ card: c, days: calcDaysUntil(c.nextBilling) }))
    .filter(x => x.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  const sub = [];
  if (nextBilling) {
    const date = formatMilestone(nextBilling.card.nextBilling);
    const rel  = _formatLongRelative(nextBilling.days);
    sub.push(rel ? `${t('meta.cards.billed')} ${date} · ${rel}` : `${t('meta.cards.billed')} ${date}`);
  }

  return {
    headline,
    subline:  sub.join(' · '),
    progress: util != null ? { pct: Math.round(util), variant } : null,
  };
}

// ─────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────

export function renderMetaStack(meta) {
  if (!meta || (!meta.headline && !meta.subline && !(meta.notes && meta.notes.length))) return '';

  const trendCls = meta.trend ? ` meta-headline--${meta.trend}` : '';
  const info     = meta.infoType ? _typeInfoIcon(meta.infoType) : '';
  const headline = meta.headline
    ? `<span class="meta-headline${trendCls}">${meta.headline}${info}</span>`
    : '';

  const progress = meta.progress
    ? `<span class="meta-progress meta-progress--${meta.progress.variant || 'neutral'}" role="progressbar" aria-valuenow="${meta.progress.pct}" aria-valuemin="0" aria-valuemax="100"><span class="meta-progress-fill" style="width: ${meta.progress.pct}%"></span></span>`
    : '';

  const subline = meta.subline ? `<span class="meta-subline">${meta.subline}</span>` : '';

  // Mobile rendition of the same data as discrete chips. Hidden by
  // default; mobile.css swaps it in via [data-device="mobile"]. The
  // text content is the same as the joined `subline` so screen-reader
  // experience doesn't regress when one of the two is hidden via
  // display:none.
  const sublineChips = (Array.isArray(meta.subParts) && meta.subParts.length > 0)
    ? `<span class="meta-subline-chips">${meta.subParts.map(p => `<span class="meta-chip">${p}</span>`).join('')}</span>`
    : '';

  const subRow = (progress || subline || sublineChips)
    ? `<span class="meta-subline-row">${progress}${subline}${sublineChips}</span>`
    : '';

  // Notes sit between the subline row and the progress bar. Each
  // note is a full sentence — recurring contributions, yearly
  // allowance progress, etc. They're rendered as separate lines
  // (block-level) so each reads as a discrete piece of context
  // rather than a dot-separated fragment.
  const notesHtml = (meta.notes && meta.notes.length)
    ? meta.notes.map(n => `<span class="meta-note">${n}</span>`).join('')
    : '';

  return `<span class="meta-stack">${headline}${subRow}${notesHtml}</span>`;
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function _findMonthlyRecurring(data, entryId) {
  return (data.recurring || []).find(r =>
    r.toEntryId === entryId && r.isActive && r.cycle === 'monthly'
  );
}

// Build a full descriptive sentence for a recurring contribution.
// Hebrew:  "הוראת קבע חודשית של ₪400 מחשבון העו״ש בבנק הפועלים"
// English: "Monthly standing order of ₪400 from the checking account at Bank Hapoalim"
//
// Hebrew handles the "ב" prefix correctly by stripping a leading
// "ה" (definite article) from the bank's name before prepending —
// so both "בנק הפועלים" and "הבנק הבינלאומי" produce a clean
// "בבנק …" prefix.
function _formatRecurringSentence(rec, data) {
  const cycleKey = `meta.cycle.${rec.cycle || 'monthly'}`;
  const cycle    = t(cycleKey);
  const amount   = formatCurrency(rec.amount || 0);

  const bank = rec.fromBankId ? getBank(data, rec.fromBankId) : null;
  if (!bank) {
    return t('meta.recurring.simple')
      .replace('{cycle}', cycle)
      .replace('{amount}', amount);
  }

  let bankName;
  if (currentLang === 'he') {
    // Strip the definite-article "ה" so the prepended "ב" reads
    // correctly in both "ב + בנק הפועלים" and "ב + הבנק הבינלאומי" cases.
    bankName = (bank.name || '').replace(/^ה/, '');
  } else {
    bankName = bank.nameEn || bank.name || '';
  }

  return t('meta.recurring.fromCheckingAt')
    .replace('{cycle}', cycle)
    .replace('{amount}', amount)
    .replace('{bank}', bankName);
}

// Extended formatRelative — formatRelative() in dates.js returns ''
// past 180 days. We want "in ~3 months" / "in ~4 years" for product
// unlock dates that sit further out.
function _formatLongRelative(days) {
  if (days == null || days < 0) return '';
  if (days === 0)               return t('dates.today');
  if (days === 1)               return t('dates.tomorrow');
  if (days <= 180)              return `${t('dates.in')} ${days} ${t('dates.days')}`;
  if (days < 365 + 30) {
    const months = Math.round(days / 30);
    const word   = months === 1 ? t('dates.month') : t('dates.months');
    return `${t('dates.in')} ~${months} ${word}`;
  }
  const years = Math.round(days / 365);
  const word  = years === 1 ? t('dates.year') : t('dates.years');
  return `${t('dates.in')} ~${years} ${word}`;
}

// (i) tooltip — reads type.{type}.info from i18n; renders nothing
// when no explainer exists. Kept here (not on every page) so all
// asset-meta surfaces stay consistent.
function _typeInfoText(type) {
  const key = 'type.' + type + '.info';
  const text = t(key);
  return text === key ? null : text;
}

function _typeInfoIcon(type) {
  const text = _typeInfoText(type);
  if (!text) return '';
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
  return `<span class="type-info" tabindex="0" role="button" aria-label="${safe}"><span class="type-info-icon">${_iconInfo}</span><span class="type-info-tooltip" role="tooltip">${safe}</span></span>`;
}
