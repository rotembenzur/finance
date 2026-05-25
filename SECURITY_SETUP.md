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

## What protects what (summary)

| Layer | Protects | Enforced by |
|------|----------|-------------|
| Supabase RLS (Step 1) | Your financial data in `app_state` | Postgres — can't be bypassed from the browser |
| Login gate (`js/auth.js`) | The UI rendering for strangers | Client — convenience/UX |
| API token check (`lib/require-auth.js`) | Your Anthropic spend + Yahoo proxy | Each serverless function |

The login gate is the visible part, but **Step 1 is what makes the data private.**
Don't skip it.
