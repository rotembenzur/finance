-- ─────────────────────────────────────────────────────────────────
--  exec_readonly_sql — safe read-only SQL gateway for the AI assistant
--
--  ONE-TIME SETUP: paste this whole file into the Supabase SQL editor
--  (Dashboard → SQL Editor → New query → Run) once. It is idempotent
--  (create or replace), so re-running it is safe.
--
--  WHAT IT DOES
--  The AI assistant (api/ai/explain.js) may generate a SELECT/WITH
--  query to answer a question that needs live data. The server calls
--  this function over PostgREST (/rest/v1/rpc/exec_readonly_sql),
--  forwarding the signed-in user's JWT. The query has already passed
--  the JS guard in lib/sql-guard.js; this function adds the database-
--  level guarantees:
--
--    1. Owner check         — only the allow-listed email may run it.
--    2. statement_timeout   — 5s hard cap on the query.
--    3. Subquery wrap       — the query runs in subquery position, so
--                             only a SELECT/WITH-returning expression
--                             is valid; Postgres rejects data-modifying
--                             CTEs (WITH x AS (DELETE ...)) outside the
--                             top level. This is the structural guard.
--    4. LIMIT 1000          — row cap, baked into the wrap.
--
--  Returns a JSON array of result rows: [] when empty.
--
--  If you ever change the allowed email, update the literal below to
--  match the RLS policies in SECURITY_SETUP.md.
-- ─────────────────────────────────────────────────────────────────

create or replace function public.exec_readonly_sql(query text)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  -- 1. Owner check. SECURITY DEFINER means this runs with elevated
  --    rights, so we must verify the caller ourselves. auth.jwt() is
  --    the forwarded user's token (PostgREST sets it from the Bearer
  --    header). Reject anyone who is not the owner.
  if coalesce(auth.jwt() ->> 'email', '') <> 'rotem.benzur@gmail.com' then
    raise exception 'unauthorized';
  end if;

  -- Belt-and-suspenders: a single statement only. The JS guard already
  -- forbids internal semicolons, but re-check here so the function is
  -- safe even if called directly.
  if position(';' in rtrim(rtrim(query), ';')) > 0 then
    raise exception 'only a single statement is allowed';
  end if;

  -- 3 + 4. Run the (already-validated) query in subquery position with
  --        a hard row cap, aggregating rows into a JSON array.
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb)
       from (select * from (%s) _q limit 1000) t',
    rtrim(rtrim(query), ';')
  )
  into result;

  return result;
end;
$$;

-- Callable by signed-in users; the owner check above is the real gate.
revoke all on function public.exec_readonly_sql(text) from public, anon;
grant execute on function public.exec_readonly_sql(text) to authenticated;
