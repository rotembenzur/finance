// Tiny standalone test for lib/sql-guard.js — run with: node lib/sql-guard.test.js
// No framework: plain assertions, non-zero exit on failure.

const { validateReadonlySql } = require('./sql-guard.js');

let pass = 0, fail = 0;
function check(label, sql, expectOk) {
  const r = validateReadonlySql(sql);
  const ok = r.ok === expectOk;
  if (ok) { pass++; }
  else {
    fail++;
    console.error(`✗ ${label}\n    sql: ${String(sql).slice(0, 80)}\n    expected ok=${expectOk}, got`, r);
  }
}

// ── Allowed ──────────────────────────────────────────────────────
check('plain select', 'SELECT 1 AS x', true);
check('select with trailing semicolon', 'SELECT 1;', true);
check('lowercase select', 'select count(*) from app_state', true);
check('WITH cte', 'WITH c AS (SELECT 1 AS n) SELECT n FROM c', true);
check('column names containing keywords',
  "SELECT (charge->>'updatedAt') AS u, created_at, deleted_flag FROM app_state", true);
check('realistic charges aggregate',
  `WITH charges AS (
     SELECT (charge->>'amount')::numeric AS amount
     FROM app_state,
          LATERAL jsonb_array_elements(data->'cards') card,
          LATERAL jsonb_array_elements(card->'charges') charge
   )
   SELECT count(*), avg(amount) FROM charges`, true);
check('block comment then select', '/* hi */ SELECT 1', true);

// ── Rejected ─────────────────────────────────────────────────────
check('empty', '   ', false);
check('non-string', 12345, false);
check('insert', "INSERT INTO app_state VALUES ('x')", false);
check('update', "UPDATE app_state SET data = '{}'", false);
check('delete', 'DELETE FROM app_state', false);
check('drop', 'DROP TABLE app_state', false);
check('truncate', 'TRUNCATE app_state', false);
check('alter', 'ALTER TABLE app_state ADD c int', false);
check('set', 'SET statement_timeout = 0', false);
check('stacked statements', 'SELECT 1; DROP TABLE app_state', false);
check('data-modifying CTE', 'WITH x AS (DELETE FROM app_state RETURNING *) SELECT * FROM x', false);
check('comment-hidden drop', 'SELECT 1 /* ; DROP TABLE app_state */', true); // comment stripped → just SELECT 1
check('comment then stacked', 'SELECT 1; -- ok\n DROP TABLE app_state', false);
check('grant', 'GRANT ALL ON app_state TO public', false);
check('copy', "COPY app_state TO '/tmp/x'", false);
check('not a select (values)', 'VALUES (1)', false);
check('oversized', 'SELECT ' + '1,'.repeat(5000) + '1', false);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
