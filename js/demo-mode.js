// ─────────────────────────────────────────────────────────────────
//  DEMO MODE — single detector for `?v_display`
//
//  This module is the SOLE source of truth for "is this page running
//  in the public display/demo mode?" — used by auth, store, AI helpers,
//  FX, stock-quotes, the intelligence page, and the header. Every
//  reader calls isDemoMode() at the moment of the decision; the result
//  is never cached, never stored, never persisted.
//
//  Single signal: the `?v_display` query string parameter. Anything
//  else (storage, cookies, hostnames) is intentionally ignored so the
//  demo path can never silently linger after the user removes the
//  param — removing it must return them straight to the real-auth flow.
//
//  Fail-closed: any failure to parse the URL (degenerate environments,
//  exotic embeddings) defaults to FALSE — real-mode auth required.
//  The demo path is opt-in only.
// ─────────────────────────────────────────────────────────────────

export function isDemoMode() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    return new URLSearchParams(window.location.search).has('v_display');
  } catch {
    return false;
  }
}
