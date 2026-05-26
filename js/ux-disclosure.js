// ─────────────────────────────────────────────────────────────────
//  UX v2 — Per-section disclosure state, persisted to localStorage.
//
//  Keys live under the 'ux:disclosure:' namespace so the entire v2
//  preference set is a single localStorage prefix you can clear:
//    Object.keys(localStorage).filter(k => k.startsWith('ux:disclosure:'))
//                              .forEach(k => localStorage.removeItem(k))
//
//  Each consumer (the dashboard tier rows, the intelligence sections,
//  per-bank groups in accounts, etc.) owns its own key. Read once at
//  render time to set the initial .is-expanded / .is-collapsed class;
//  write on toggle to persist the user's choice.
//
//  Values are stored as the strings 'expanded' or 'collapsed'. Falling
//  back to the caller's defaultExpanded keeps "first visit" calm — every
//  caller decides whether its content is visible or hidden by default.
// ─────────────────────────────────────────────────────────────────

const NAMESPACE = 'ux:disclosure:';

export function isExpanded(key, defaultExpanded) {
  try {
    const raw = localStorage.getItem(NAMESPACE + key);
    if (raw === 'expanded')  return true;
    if (raw === 'collapsed') return false;
  } catch (_) { /* private mode etc. — fall through */ }
  return !!defaultExpanded;
}

export function setExpanded(key, expanded) {
  try {
    localStorage.setItem(NAMESPACE + key, expanded ? 'expanded' : 'collapsed');
  } catch (_) { /* swallow: localStorage may be unavailable */ }
}

// Convenience: flip the stored state, return the new value. Used by
// toggle handlers that don't care about the previous value.
export function toggleExpanded(key, defaultExpanded) {
  const next = !isExpanded(key, defaultExpanded);
  setExpanded(key, next);
  return next;
}
