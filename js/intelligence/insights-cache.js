// ─────────────────────────────────────────────────────────────────
//  INSIGHTS-CACHE — localStorage persistence + staleness fingerprint
//
//  Stores the last AI-authored insight surface on the device so a page
//  reload doesn't trigger another paid API call. A fingerprint hashed
//  from the deterministic facts goes with it; comparing the hash against
//  the live profile tells us whether the cached insights still describe
//  the current financial state.
//
//  Pure-ish: localStorage IO is wrapped in try/catch and never throws —
//  a missing/quota-exceeded/JSON-corrupt store falls back to "no cache."
//
//  Schema (key 'intelInsights_v1'):
//    {
//      schemaVersion: 1,
//      insights:      <normalized AI payload>,
//      fingerprint:   <FNV-1a hex of buildFingerprintInputs>,
//      savedAt:       ISO timestamp
//    }
//  Bump SCHEMA_VERSION whenever the insights payload shape changes;
//  older snapshots are then ignored instead of crashing the renderer.
// ─────────────────────────────────────────────────────────────────

import { buildFingerprintInputs } from './facts.js';
import { isDemoMode } from '../demo-mode.js';

const STORE_KEY      = 'intelInsights_v1';
const SCHEMA_VERSION = 1;

// FNV-1a 32-bit — cheap, deterministic, ample collision resistance for
// the "has anything meaningful changed" question. Output is 8 hex chars.
export function fnv1aHex(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function computeFingerprint(profile) {
  const inputs = buildFingerprintInputs(profile);
  if (!inputs) return null;
  return fnv1aHex(JSON.stringify(inputs));
}

export function loadCachedInsights() {
  if (typeof localStorage === 'undefined') return null;
  // Demo mode: never touch localStorage; the pre-baked AI surface is
  // delivered fresh on every page load via refreshAIInsights().
  if (isDemoMode()) return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.insights || typeof parsed.insights !== 'object') return null;
    if (typeof parsed.fingerprint !== 'string') return null;
    return parsed;
  } catch (err) {
    // Corrupt JSON, security exception (private mode), etc — treat as
    // "no cache" so the page still renders deterministically.
    console.warn('[insights-cache] load failed', err);
    return null;
  }
}

export function saveCachedInsights({ insights, fingerprint }) {
  if (typeof localStorage === 'undefined') return false;
  // Demo mode: never persist anything to localStorage.
  if (isDemoMode()) return false;
  if (!insights || typeof insights !== 'object' || typeof fingerprint !== 'string') return false;
  try {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      insights,
      fingerprint,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    // Quota exceeded or storage disabled — non-fatal, the session-scoped
    // module state still holds the insights for this tab.
    console.warn('[insights-cache] save failed', err);
    return false;
  }
}

export function clearCachedInsights() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}
