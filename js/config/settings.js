// ─────────────────────────────────────────────────────────────────
//  SETTINGS / PROFILE
//
//  User-level personal assumptions + preferences that used to be
//  hardcoded constants. Persisted in `data.settings` so they sync with
//  the rest of the state (Supabase + localStorage) and survive reloads.
//
//  The defaults below ARE the values that were previously baked into
//  code, so seeding is behaviour-preserving: an existing user with no
//  `data.settings` is seeded with exactly their prior values (and their
//  current language) — no calculation changes.
//
//  Calculation-affecting:
//    · dateOfBirth   — drives getUserAge() → risk horizon + suitability
//                      (risk-model.js, risk-dimensions.js, profile.js)
//    · retirementAge — years-to-retirement in the same horizon math
//  Preferences (no calculation impact):
//    · defaultLanguage — mirrors the live language (localStorage 'lang'
//                        stays the first-paint source of truth)
//    · defaultCurrency — home currency for NEW manual records. The app's
//                        accounting base stays ILS — this does NOT rebase
//                        any totals or the display symbol.
// ─────────────────────────────────────────────────────────────────

import { getAppData } from '../state.js';
import { saveData, todayISO } from '../store.js';
import { currentLang } from '../i18n.js';

export const SETTINGS_DEFAULTS = {
  dateOfBirth:     '2001-05-22',   // was USER_DOB in risk-model.js
  retirementAge:   67,             // Israeli statutory; was in risk-model + risk-dimensions
  defaultLanguage: 'he',           // matches i18n's default; seed prefers the live lang
  defaultCurrency: 'ILS',
};

const _ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Idempotent seed — only fills missing keys. Called from store.js
// _migratePersistedState. Existing users (no data.settings) are seeded
// with the prior hardcoded values + their current language.
export function seedSettings(data) {
  if (!data || typeof data !== 'object') return;
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
    if (data.settings[k] === undefined || data.settings[k] === null) {
      data.settings[k] = (k === 'defaultLanguage') ? (currentLang || v) : v;
    }
  }
}

// Full settings object (defaults merged with persisted overrides).
export function getSettings() {
  const data = getAppData();
  return { ...SETTINGS_DEFAULTS, ...((data && data.settings) || {}) };
}

// Single setting with default fallback — safe to call before seeding.
export function getSetting(key) {
  const data = getAppData();
  const v = data && data.settings ? data.settings[key] : undefined;
  return (v === undefined || v === null) ? SETTINGS_DEFAULTS[key] : v;
}

// Validate + persist a patch. Returns { ok, errors:[fieldKeys] }. Does
// NOT apply language (the caller drives setLanguage so the UI re-renders).
export function setSettings(patch) {
  const data = getAppData();
  if (!data) return { ok: false, errors: ['no-data'] };
  const next = { ...getSettings(), ...patch };
  const errors = [];

  if (!_ISO_DATE.test(String(next.dateOfBirth)) || isNaN(new Date(next.dateOfBirth).getTime())) {
    errors.push('dateOfBirth');
  }
  const ra = Number(next.retirementAge);
  if (!Number.isFinite(ra) || ra < 40 || ra > 120) errors.push('retirementAge');
  if (!['he', 'en'].includes(next.defaultLanguage)) errors.push('defaultLanguage');
  if (typeof next.defaultCurrency !== 'string' || !next.defaultCurrency) errors.push('defaultCurrency');

  if (errors.length) return { ok: false, errors };

  data.settings = {
    dateOfBirth:     next.dateOfBirth,
    retirementAge:   ra,
    defaultLanguage: next.defaultLanguage,
    defaultCurrency: next.defaultCurrency,
  };
  if (data.meta && typeof data.meta === 'object') data.meta.lastUpdated = todayISO();
  saveData(data);
  return { ok: true, errors: [] };
}
