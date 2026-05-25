// ─────────────────────────────────────────────────────────────────
//  AUTH — login gate for the dashboard
//
//  The data is protected server-side by Supabase Row-Level Security
//  (see SECURITY_SETUP.md): the anon key can't read or write the
//  app_state row without a JWT whose email is on the allowlist. This
//  module is the matching front door — it keeps the UI from rendering
//  for anyone who isn't that user, and supplies the bearer token the
//  serverless API routes verify.
//
//  Two ways in, both restricted to ALLOWED_EMAILS:
//    · Google OAuth          (supabase.auth.signInWithOAuth)
//    · Email magic link      (supabase.auth.signInWithOtp)
//
//  guard(onAuthorized) is the entry point: it boots the app exactly
//  once when an allowed session is present, and otherwise paints the
//  login screen. It re-evaluates on every auth state change, so a
//  fresh sign-in (or the OAuth/magic-link redirect landing back here)
//  transitions straight into the app.
// ─────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';
import { t } from './i18n.js';

// The single account allowed to use this deployment. This is a UX
// guard only — the authoritative check is the Supabase RLS policy.
const ALLOWED_EMAILS = ['rotem.benzur@gmail.com'];

let _denied = null;   // email of a rejected (non-allowlisted) sign-in

// ── Session helpers ───────────────────────────────────────────

function _emailOf(session) {
  return (session && session.user && session.user.email || '').toLowerCase();
}

export function isAllowed(session) {
  return ALLOWED_EMAILS.includes(_emailOf(session));
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data ? data.session : null;
}

// Bearer header for the serverless API routes. Empty object when there
// is no session, so callers can spread it unconditionally.
export async function authHeader() {
  const session = await getSession();
  return session && session.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

// ── Sign-in / sign-out ────────────────────────────────────────

export async function signInWithGoogle() {
  _denied = null;
  _setStatus('');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) _setStatus(error.message, 'error');
}

export async function sendMagicLink(rawEmail) {
  _denied = null;
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email) { _setStatus(t('auth.enterEmail'), 'error'); return; }
  // Don't email a login link to anyone who couldn't get in anyway.
  if (!ALLOWED_EMAILS.includes(email)) { _setStatus(t('auth.notAllowed'), 'error'); return; }

  _setStatus(t('auth.sending'));
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });
  if (error) { _setStatus(error.message, 'error'); return; }
  _setStatus(t('auth.sent').replace('{email}', email), 'ok');
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();   // clears in-memory state cleanly
}

// ── Boot guard ────────────────────────────────────────────────

export function guard(onAuthorized) {
  let booted = false;

  const evaluate = async () => {
    const session = await getSession();

    if (session && isAllowed(session)) {
      _removeLoginScreen();
      if (!booted) { booted = true; onAuthorized(); }
      return;
    }

    // Signed in with the wrong account → record it, sign out, and let
    // the resulting auth-change re-render the login with the notice.
    if (session && !isAllowed(session)) {
      _denied = session.user.email;
      await supabase.auth.signOut();
      return;
    }

    // Mid-redirect (returning from Google / a magic link), the session
    // isn't established yet — supabase-js is still exchanging the code
    // and will fire SIGNED_IN momentarily. Hold the screen blank rather
    // than flashing the login form for a split second.
    if (!session && _redirectInProgress()) return;

    _renderLoginScreen();
  };

  // React to sign-in, sign-out, and the OAuth/magic-link redirect.
  supabase.auth.onAuthStateChange(() => { evaluate(); });
  evaluate();
}

// ── Login screen ──────────────────────────────────────────────

function _renderLoginScreen() {
  let el = document.getElementById('auth-gate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-gate';
    document.body.appendChild(el);
  }

  el.innerHTML = `
    <div class="auth-card" role="dialog" aria-labelledby="auth-title">
      <div class="auth-mark" aria-hidden="true">🔐</div>
      <h1 class="auth-title" id="auth-title">${t('auth.title')}</h1>
      <p class="auth-sub">${t('auth.subtitle')}</p>

      ${_denied ? `<p class="auth-denied">${t('auth.denied').replace('{email}', _esc(_denied))}</p>` : ''}

      <button type="button" class="btn btn-primary auth-google" id="auth-google">
        ${t('auth.google')}
      </button>

      <div class="auth-divider"><span>${t('auth.or')}</span></div>

      <form class="auth-magic" id="auth-magic-form">
        <input class="form-input" id="auth-email" type="email"
               inputmode="email" autocomplete="email"
               placeholder="${_esc(t('auth.emailPlaceholder'))}" />
        <button type="submit" class="btn btn-ghost">${t('auth.magic')}</button>
      </form>

      <p class="auth-status" id="auth-status" aria-live="polite"></p>
    </div>
  `;

  document.getElementById('auth-google')
    .addEventListener('click', () => signInWithGoogle());
  document.getElementById('auth-magic-form')
    .addEventListener('submit', (e) => {
      e.preventDefault();
      sendMagicLink(document.getElementById('auth-email').value);
    });
}

function _removeLoginScreen() {
  document.getElementById('auth-gate')?.remove();
}

// True while a Google/magic-link redirect is still being exchanged for
// a session (params live in the URL until supabase-js consumes them).
function _redirectInProgress() {
  return /[?&]code=/.test(window.location.search)
      || /(access_token|error)=/.test(window.location.hash);
}

function _setStatus(message, tone) {
  const el = document.getElementById('auth-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'auth-status' + (tone ? ` auth-status--${tone}` : '');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
