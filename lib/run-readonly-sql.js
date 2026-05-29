// ─────────────────────────────────────────────────────────────────
//  RUN-READONLY-SQL — execute an AI-generated read query, server-side
//
//  runReadonlySql(sql, bearerToken)
//    → { ok: true,  rows, rowCount, truncated }
//    → { ok: false, code, message }
//
//  Validates the query with lib/sql-guard.js, then calls the Supabase
//  RPC public.exec_readonly_sql over PostgREST — the same fetch-based
//  access pattern lib/require-auth.js uses (no SDK, no new dependency).
//  The user's own Bearer token is forwarded, so the function's
//  auth.jwt() owner check (see db/exec_readonly_sql.sql) applies.
//
//  Never throws. Every failure is a structured { ok:false, code } so
//  the caller (api/ai/explain.js) can feed it back to the model as a
//  tool_result and let it recover or answer without the data.
// ─────────────────────────────────────────────────────────────────

const { validateReadonlySql } = require('./sql-guard.js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://gkebcozgbczxrjakkknx.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I';

const RPC_ENDPOINT       = `${SUPABASE_URL}/rest/v1/rpc/exec_readonly_sql`;
const FETCH_TIMEOUT_MS   = 8000;          // > the function's 5s statement_timeout
const MAX_RESULT_BYTES   = 200_000;       // cap what we hand back to the model

async function runReadonlySql(sql, bearerToken) {
  const check = validateReadonlySql(sql);
  if (!check.ok) {
    return { ok: false, code: 'invalid_query', message: check.reason };
  }
  if (!bearerToken) {
    return { ok: false, code: 'unauthorized', message: 'Missing auth token.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(RPC_ENDPOINT, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearerToken}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ query: check.sql }),
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && err.name === 'AbortError';
    return {
      ok:      false,
      code:    isTimeout ? 'timeout' : 'network',
      message: isTimeout
        ? `Query aborted after ${FETCH_TIMEOUT_MS}ms.`
        : `Network error reaching the database: ${(err && err.message) || String(err)}`,
    };
  }
  clearTimeout(timer);

  let bodyText = '';
  try { bodyText = await response.text(); } catch { /* ignore */ }

  if (!response.ok) {
    // PostgREST surfaces Postgres errors (syntax, timeout, the owner
    // RAISE, etc.) as JSON with a "message" field. Pass a short, clean
    // message back so the model knows the query failed and can adjust.
    let message = `Database returned HTTP ${response.status}.`;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed.message === 'string') message = parsed.message;
    } catch { /* keep default */ }
    const code = response.status === 401 || /unauthorized/i.test(message)
      ? 'unauthorized'
      : /statement timeout|canceling statement/i.test(message)
        ? 'query_timeout'
        : 'query_error';
    return { ok: false, code, message: message.slice(0, 300) };
  }

  let rows;
  try {
    rows = JSON.parse(bodyText);
  } catch {
    return { ok: false, code: 'parse_error', message: 'Database response was not valid JSON.' };
  }
  if (!Array.isArray(rows)) {
    // The function always returns a jsonb array; anything else is unexpected.
    rows = rows == null ? [] : [rows];
  }

  // Cap serialized size before handing rows to the model. The SQL wrap
  // already caps at 1000 rows; this guards against a few very wide rows.
  let serialized = JSON.stringify(rows);
  let truncated = false;
  if (serialized.length > MAX_RESULT_BYTES) {
    truncated = true;
    const trimmed = [];
    let size = 2; // for the [] brackets
    for (const row of rows) {
      const piece = JSON.stringify(row);
      if (size + piece.length + 1 > MAX_RESULT_BYTES) break;
      trimmed.push(row);
      size += piece.length + 1;
    }
    rows = trimmed;
    serialized = JSON.stringify(rows);
  }

  return { ok: true, rows, rowCount: rows.length, truncated };
}

module.exports = { runReadonlySql };
