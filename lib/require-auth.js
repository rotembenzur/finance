// ─────────────────────────────────────────────────────────────────
//  REQUIRE-AUTH — shared gate for the Vercel serverless functions
//
//  The browser bundle is public, so the API routes can't trust the
//  caller. This verifies the Supabase access token the client sends in
//  the Authorization header against Supabase's own auth endpoint
//  (/auth/v1/user) — no SDK dependency, just fetch — and confirms the
//  authenticated email is on the allowlist.
//
//  Returns the Supabase user object on success, or null. Callers must
//  treat null as 401 and stop.
//
//  Config comes from env when set, with the project's public values as
//  fallback (the anon key and project URL are not secrets — they ship
//  in the browser too). ALLOWED_EMAILS is a comma-separated list.
// ─────────────────────────────────────────────────────────────────

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://gkebcozgbczxrjakkknx.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'rotem.benzur@gmail.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

async function requireUser(req) {
  const header =
    req.headers['authorization'] || req.headers['Authorization'] || '';
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : null;
  if (!token) return null;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const user = await r.json();
    const email = (user && user.email ? user.email : '').toLowerCase();
    return ALLOWED_EMAILS.includes(email) ? user : null;
  } catch (e) {
    // Network/parse failure → treat as unauthorized; never fail open.
    return null;
  }
}

module.exports = { requireUser };
