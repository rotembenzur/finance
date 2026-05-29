// ─────────────────────────────────────────────────────────────────
//  SQL-GUARD — read-only validation for AI-generated queries
//
//  The AI assistant (api/ai/explain.js) may decide a question needs
//  live data and emit a SQL query. Before that query ever reaches the
//  database it passes through here. This is the FIRST line of a
//  defense-in-depth chain — the Postgres function exec_readonly_sql
//  (db/exec_readonly_sql.sql) adds the structural guarantees:
//    - wraps the query as a subquery (only SELECT/WITH-returning
//      expressions are valid there; data-modifying CTEs are rejected
//      by Postgres outside the top level)
//    - SET statement_timeout = '5s'
//    - LIMIT baked into the wrap
//    - owner-email check via auth.jwt()
//
//  This module is pure (no I/O) so it can be unit-tested in isolation.
//  validateReadonlySql(sql) → { ok: true, sql } | { ok: false, reason }
//
//  The goal is not to be a full SQL parser — it's a strict gate that
//  only lets through what is unambiguously a single read-only query,
//  and rejects everything it isn't certain about (fail closed).
// ─────────────────────────────────────────────────────────────────

const MAX_SQL_LENGTH = 8000;

// Whole-word blocklist of anything that writes, changes schema, or
// changes session/transaction state. Matched case-insensitively on
// word boundaries against the comment-stripped query.
const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate',
  'create', 'grant', 'revoke', 'copy', 'comment', 'vacuum',
  'merge', 'call', 'do', 'set', 'reset', 'lock', 'refresh',
  'reindex', 'cluster', 'analyze', 'prepare', 'execute', 'declare',
  'listen', 'notify', 'discard', 'security',
];

function validateReadonlySql(sql) {
  if (typeof sql !== 'string') {
    return { ok: false, reason: 'Query must be a string.' };
  }

  const raw = sql.trim();
  if (!raw) {
    return { ok: false, reason: 'Query is empty.' };
  }
  if (raw.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: `Query exceeds ${MAX_SQL_LENGTH} characters.` };
  }

  // Strip comments so they can't be used to smuggle keywords or
  // statement separators past the checks below.
  //   -- line comments   →  removed to end of line
  //   /* block comments */ → removed (non-greedy, across newlines)
  const stripped = raw
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();

  if (!stripped) {
    return { ok: false, reason: 'Query has no executable statement.' };
  }

  // Single statement only. A trailing semicolon is fine; anything
  // after it (a second statement) is not. We forbid any internal ';'.
  const withoutTrailingSemi = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemi.includes(';')) {
    return { ok: false, reason: 'Only a single statement is allowed (no ";").' };
  }

  // Must be a read query: start with SELECT or WITH.
  if (!/^\s*(select|with)\b/i.test(withoutTrailingSemi)) {
    return { ok: false, reason: 'Only SELECT / WITH queries are allowed.' };
  }

  // Whole-word blocklist. \b boundaries mean column names that merely
  // contain a substring (e.g. "created_at", "updatedAt") are NOT
  // matched — only the bare keyword is.
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(withoutTrailingSemi)) {
      return { ok: false, reason: `Disallowed keyword: "${kw}".` };
    }
  }

  // Normalise to a single trailing-semicolon-free form for the caller;
  // the RPC wraps it as a subquery, where a trailing ';' would break.
  return { ok: true, sql: withoutTrailingSemi };
}

module.exports = { validateReadonlySql, MAX_SQL_LENGTH, FORBIDDEN_KEYWORDS };
