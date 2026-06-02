# Security setup — locking down the dashboard

The app code now has a login gate (Google + email magic link, restricted to
`rotem.benzur@gmail.com`). **But the code alone does not secure your data.**
The browser bundle ships a public Supabase anon key, so the data is only safe
once Supabase itself refuses to hand out the `app_state` row without a logged-in,
allow-listed token.

Do **Step 1 first** — it is the part that actually protects your data. Steps 2–3
make the login buttons work.

> Replace `rotem.benzur@gmail.com` below if you ever change the allowed email.
> The app URL referenced throughout is `https://finance-xi-gules.vercel.app`.

---

## Step 1 — Lock the database with Row-Level Security (REQUIRED, do this first)

This is the real lock. Until it's done, anyone can read/write your data with the
public anon key, login screen or not.

1. Open the Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste and **Run** this:

```sql
-- Turn on RLS. Once enabled, NO role can touch the table until a policy
-- explicitly allows it — so the anon key is locked out by default.
alter table public.app_state enable row level security;

-- Only the signed-in owner email may read the row.
create policy "owner can read app_state"
on public.app_state for select
to authenticated
using ( (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );

-- ...and update it.
create policy "owner can update app_state"
on public.app_state for update
to authenticated
using      ( (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' )
with check ( (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );

-- ...and (re)create it if the row is ever missing.
create policy "owner can insert app_state"
on public.app_state for insert
to authenticated
with check ( (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );
```

3. **Remove any older permissive policy.** Go to **Authentication → Policies**
   (or **Database → Policies**) for `app_state`. If you see anything like
   "Enable read access for all users" / a policy targeting the `anon` or
   `public` role / `using (true)`, **delete it** — it would override the lock
   above.

4. **Verify the lock.** In an incognito window (logged out), open the browser
   console on the site and run:

   ```js
   const r = await fetch(
     "https://gkebcozgbczxrjakkknx.supabase.co/rest/v1/app_state?select=data&id=eq.primary",
     { headers: {
         apikey: "sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I",
         Authorization: "Bearer sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I",
     }}
   );
   console.log(r.status, await r.json());
   ```

   You want an **empty array `[]`** (RLS hides the row) — that means a stranger
   gets nothing. If you see your data, RLS is not locked yet; recheck steps 1–3.

---

## Step 2 — Turn on the magic-link (email) login

This needs no external accounts and works immediately.

1. Supabase → **Authentication → Providers → Email**: ensure **Enabled**.
   (You can turn **Confirm email** off — magic link verifies the address anyway.)
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `https://finance-xi-gules.vercel.app`
   - **Redirect URLs:** add both:
     - `https://finance-xi-gules.vercel.app`
     - `http://localhost:3000` (only if you run it locally)
3. That's it — the "Email me a login link" button will now work. The built-in
   Supabase mailer is rate-limited but fine for a single user. (Optional: set up
   custom SMTP under **Authentication → Emails** if links ever get throttled.)

---

## Step 3 — Turn on Google sign-in

1. **Google Cloud Console** (<https://console.cloud.google.com>):
   - Create/choose a project → **APIs & Services → OAuth consent screen**:
     User type **External**, fill the app name + your email, **Save**. Add your
     email under **Test users** (so you can sign in while it's in "testing").
   - **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
     - Application type: **Web application**
     - **Authorized JavaScript origins:**
       `https://finance-xi-gules.vercel.app`
     - **Authorized redirect URIs:**
       `https://gkebcozgbczxrjakkknx.supabase.co/auth/v1/callback`
     - Create → copy the **Client ID** and **Client secret**.
2. **Supabase → Authentication → Providers → Google:** enable it, paste the
   **Client ID** and **Client secret**, **Save**. (The callback URL Supabase
   shows here must match the redirect URI you entered in Google.)
3. The "Continue with Google" button will now work.

> Note: Google sign-in lets *any* Google account complete the OAuth step, but
> Step 1's RLS + the app's allowlist mean only `rotem.benzur@gmail.com` can
> actually load or change data — every other account is rejected and signed out.

---

## Step 4 — (optional, recommended) pin the API allowlist via env

The serverless routes (`api/ai`, `api/market`) already require a valid token for
your email, with the value hard-coded as a fallback. To manage it without code
changes, set these in **Vercel → Project → Settings → Environment Variables**
(then redeploy):

- `ALLOWED_EMAILS = rotem.benzur@gmail.com`
- `SUPABASE_URL = https://gkebcozgbczxrjakkknx.supabase.co`
- `SUPABASE_ANON_KEY = sb_publishable_E8fTplCoPnGV3k_K3xWEGw_uADjxX_I`

---

## Step 5 — (required for the AI assistant's data queries) install the read-only SQL function

The AI assistant can answer data-heavy questions ("what kind of spender am I from my
card data?") by generating a **read-only** SQL query, running it, and writing a prose
answer. The query never reaches the browser and only ever runs through one gated
Postgres function.

**Install it once:** open **Supabase → SQL Editor → New query**, paste the entire
contents of [`db/exec_readonly_sql.sql`](db/exec_readonly_sql.sql), and **Run**. It is
idempotent (`create or replace`), so re-running is safe.

Smoke test (run in the same SQL editor):

```sql
select public.exec_readonly_sql('select 1 as x');   -- → [{"x":1}]
select public.exec_readonly_sql('delete from app_state');  -- → ERROR (rejected)
```

Why it's safe (defense in depth):

- **JS guard** (`lib/sql-guard.js`) — only single `SELECT`/`WITH` statements pass;
  writes/DDL/multi-statement are rejected before the query ever leaves the server.
- **The function** is `SECURITY DEFINER` with `SET statement_timeout = '5s'`, checks
  `auth.jwt() ->> 'email'` is the owner, wraps the query as a subquery (Postgres rejects
  data-modifying CTEs there), and caps results at 1000 rows.
- If you change the allowed email anywhere, update the literal inside
  `db/exec_readonly_sql.sql` too — it must match the RLS policies in Step 1.

> Without this function the assistant still works for everything it can answer from the
> fact sheet; only the live-query path returns an error (which the assistant silently
> falls back from).

---

## Step 6 — (required for card images / voucher files) create the Storage buckets

Custom **card images** (Cards page → Add/Edit card) upload to a private Supabase
Storage bucket named **`card-images`**; voucher/gift-card attachments use
**`voucher-attachments`** the same way. The app stores only the storage **path** in
the record and mints a short-lived **signed URL** on view, so a leaked record JSON
can't fetch the file without an authenticated session. Until the bucket exists, every
feature works *except* image/file upload (you'll get a toast on save). Demo mode
(`?v_display`) never touches Storage — it encodes files inline as data URIs.

1. **Create the buckets.** Supabase dashboard → **Storage** → **New bucket**:
   - Name `card-images`, **Public = off** (private). Repeat for `voucher-attachments`.

2. **Add owner-only access policies.** Open **SQL Editor → New query**, paste and
   **Run** (mirrors the owner-email check from Step 1 — change the email if yours
   differs):

   ```sql
   -- One policy per command, scoped to the two private buckets, owner only.
   create policy "owner manages card/voucher files - select"
   on storage.objects for select to authenticated
   using ( bucket_id in ('card-images','voucher-attachments')
           and (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );

   create policy "owner manages card/voucher files - insert"
   on storage.objects for insert to authenticated
   with check ( bucket_id in ('card-images','voucher-attachments')
                and (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );

   create policy "owner manages card/voucher files - delete"
   on storage.objects for delete to authenticated
   using ( bucket_id in ('card-images','voucher-attachments')
           and (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );
   ```

   > If you already created policies for `voucher-attachments` earlier, just add
   > `card-images` to their `bucket_id in (...)` lists instead of duplicating them.

3. **Smoke test.** On the Cards page, Add a card, upload a small image, Save — it
   should appear on the card face. Reload — it should still show (URL re-signed). The
   app caps uploads at 5 MB and accepts images only.

---

## Step 7 — (required for uploaded institution logos) create the public logos bucket

The logo picker (Management → Financial Institutions, plus banks and future
deposits) lets you **upload a custom logo** instead of picking a bundled one.
Unlike card images, **institution logos are non-sensitive brand marks** rendered
in many places via plain `<img src>` (the picker, the provider grid, account
headers, deposit rows). So they live in a **PUBLIC** bucket named
**`institution-logos`** and the app stores the bucket's **public URL** directly on
the record (`provider.logo` / `bank.logo`) — no signed-URL round-trip, so every
existing renderer just works. Until the bucket exists, picking a bundled logo
still works; only *uploading a new one* fails (you'll get a toast). Demo mode
(`?v_display`) never touches Storage — it encodes the upload inline as a data URI.

1. **Create the bucket.** Supabase dashboard → **Storage** → **New bucket**:
   - Name `institution-logos`, **Public = on**. (Public read is intentional — the
     URLs are embedded in `<img>` tags; nothing private is ever uploaded here.)

2. **Add owner-only *write* policies.** Public read is handled by the bucket's
   public flag; you only need to restrict who can upload/delete. **SQL Editor →
   New query**, paste and **Run** (change the email if yours differs):

   ```sql
   -- Public read comes from the bucket flag; only the owner may write/remove.
   create policy "owner manages institution logos - insert"
   on storage.objects for insert to authenticated
   with check ( bucket_id = 'institution-logos'
                and (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );

   create policy "owner manages institution logos - delete"
   on storage.objects for delete to authenticated
   using ( bucket_id = 'institution-logos'
           and (auth.jwt() ->> 'email') = 'rotem.benzur@gmail.com' );
   ```

3. **Smoke test.** Management → Financial Institutions → edit one → open the logo
   picker → **Upload** a small image → it becomes the selected logo and shows in the
   provider grid. Reload — it still shows (public URL). Uploads are capped at 2 MB,
   images only, and previously-uploaded logos reappear as reusable tiles.

---

## What protects what (summary)

| Layer | Protects | Enforced by |
|------|----------|-------------|
| Supabase RLS (Step 1) | Your financial data in `app_state` | Postgres — can't be bypassed from the browser |
| Login gate (`js/auth.js`) | The UI rendering for strangers | Client — convenience/UX |
| API token check (`lib/require-auth.js`) | Your Anthropic spend + Yahoo proxy | Each serverless function |
| Read-only SQL gate (`lib/sql-guard.js` + `exec_readonly_sql`) | The DB against AI-generated queries | JS validation + a `SECURITY DEFINER` Postgres function (owner check, timeout, SELECT-only) |
| Storage policies (Step 6) | Card images + voucher files in `card-images` / `voucher-attachments` | Postgres RLS on `storage.objects` (owner email) + private buckets served via signed URLs |
| Logo write policies (Step 7) | Who can upload/remove logos in the public `institution-logos` bucket | Postgres RLS on `storage.objects` (owner email); read is public by design (brand marks only) |

The login gate is the visible part, but **Step 1 is what makes the data private.**
Don't skip it.
