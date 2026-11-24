# External setup guide

One-time setup of the services the tutoring site depends on. Follow the parts in order; everything is free and needs no credit card.
Never paste keys marked **SECRET** into the repo, a chat, or a screenshot.

| Part | Needed for | Required now? |
|---|---|---|
| 1. Supabase project | Saving calendar events, shared data | **Yes** |
| 2. GitHub variables and secrets | Site connects to Supabase, keep-alive | **Yes** |
| 3. Supabase CLI (optional) | Applying database migrations from your PC | Recommended |
| 4. Google sign-in | Logging in with Google (the tutor, and later tutees) | **Yes** (calendar) |
| 5. Microsoft sign-in | Tutees logging in with Microsoft | Later (shown as "coming soon") |
| 6. Resend (email to you) | Request emails in your mailbox | Later (requests feature) |
| 7. Calendar admin | Making your Google account the tutor | **Yes** (calendar), after Parts 3–4 |

Site URL used throughout: `https://bjornpijpops.github.io/tutoring/`

---

## Part 1 – Supabase project

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. Create an organization (type: Personal, plan: **Free**).
3. **New project**:
   - Name: `tutoring`
   - Database password: generate one and store it in a password manager (**SECRET**; you rarely need it).
   - Region: closest to you (e.g. `West EU (Ireland)` or `Central EU (Frankfurt)`).
   - Plan: Free.
4. Wait ~2 minutes until the project is ready.
5. Collect these values (Project Settings → **API Keys** / **Data API**):
   - **Project URL**, like `https://abcdxyz.supabase.co`
   - **anon / publishable key** (public, safe to ship in the website)
   - Do **not** copy or share the `service_role` / secret key.
6. Allow the site to receive logins: **Authentication → URL Configuration**:
   - **Site URL**: `https://bjornpijpops.github.io/tutoring/`
   - **Redirect URLs**, add both:
     - `https://bjornpijpops.github.io/tutoring/**`
     - `http://localhost:5173/**`
7. Note your **Project ref** (the `abcdxyz` part of the URL); it is needed in Parts 3–6.

## Part 2 – GitHub variables and secrets

Repo → **Settings → Secrets and variables → Actions**.

**Variables** tab → *New repository variable* (public values, baked into the site build):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL from Part 1 |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key from Part 1 |

**Secrets** tab → *New repository secret* (used by the keep-alive workflow that stops the free project from pausing):

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon / publishable key |

Then run **Actions → Supabase keep-alive → Run workflow** once and tell me whether it is green.

## Part 3 – Supabase CLI (optional, recommended)

Lets the database schema (`supabase/migrations/`) be applied reproducibly. The CLI is a dev dependency of this repo (no global install needed): run `npm ci` once, then use `npx supabase ...`.

1. `npx supabase login` (opens browser).
2. In the repo folder: `npx supabase link --project-ref <your-project-ref>` (asks for the database password).
3. Apply migrations: `npx supabase db push --remote`. Without `--remote`, CLI v3 targets a local Docker database and fails with `ECONNREFUSED 127.0.0.1:54322`. If `--remote` fails to connect (IPv6-only direct host on some networks), use the Session pooler string from the dashboard's **Connect** button: `npx supabase db push --db-url "<string>"`.

If you skip this, paste the migration SQL into **Supabase → SQL Editor → Run** instead. You will be told when.

## Part 4 – Google sign-in

1. <https://console.cloud.google.com> → create a project named `tutoring`.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform): User type **External**; app name `Tutoring`; support and developer email: yours. Publish the app (**In production**) so any Google account can sign in; basic scopes (email, profile, openid) need no verification.
3. **Credentials → Create credentials → OAuth client ID** → type **Web application**:
   - **Authorized JavaScript origins**: `https://bjornpijpops.github.io`
   - **Authorized redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret** (**SECRET**).
5. Supabase → **Authentication → Sign In / Providers → Google** → enable, paste both → Save.

## Part 5 – Microsoft sign-in (later)

1. <https://entra.microsoft.com> (or Azure portal) → sign in with a Microsoft account. A personal account works; if asked, create a free tenant.
2. **App registrations → New registration**:
   - Name: `Tutoring`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI (type **Web**): `https://<project-ref>.supabase.co/auth/v1/callback`
3. On the Overview page copy the **Application (client) ID**.
4. **Certificates & secrets → New client secret** → copy the **Value** immediately (**SECRET**; shown once, and it expires, so note the expiry date, max 24 months).
5. **Token configuration → Add optional claim** → ID token → `email` → Add (accept the permissions prompt).
6. Supabase → **Authentication → Sign In / Providers → Azure** → enable; paste Client ID and Secret; Azure tenant URL: `https://login.microsoftonline.com/common` → Save.

## Part 6 – Resend, email to you (later)

1. <https://resend.com> → sign up **with your own mailbox address** (the one that should receive the request emails; the shared sender only delivers to the account's own address).
2. **API Keys → Create API Key** (permission: *Sending access*) → copy it (**SECRET**).
3. In Supabase → **Edge Functions → Secrets** (or `supabase secrets set`), add:
   - `RESEND_API_KEY` = the key
   - `TUTOR_EMAIL` = your mailbox address (same as the Resend account; never commit it, the repo is public)
4. Sender used by the app: `onboarding@resend.dev`. After the first email arrives in Hotmail, mark it **Not junk** and add the sender to your safe senders.

---

## Part 7 – Calendar admin (you are the tutor)

The calendar migration (`supabase/migrations/20261124000000_calendar.sql`) is applied with Part 3 (`npx supabase db push --remote`, or paste the file into the SQL Editor). It creates the `admins` table, which nobody can read or write through the website: only you, in the SQL Editor.

1. In Supabase → **SQL Editor**, run this **once**, replacing the placeholder with the Google address you sign in with (keep that address out of the repo, chat and screenshots):

   ```sql
   insert into public.admins (email) values (lower('<ADMIN_GOOGLE_EMAIL>'));
   ```

2. Supabase → **Authentication → Sign In / Providers**: keep **only Google** enabled. Turn off **Email** sign-ups and **Allow anonymous sign-ins** (Authentication → Sign In / Providers, or Settings). Otherwise someone could register with an email address and, if it matched, gain access.
3. Check **Authentication → URL Configuration** lists `https://bjornpijpops.github.io/tutoring/**` and `http://localhost:5173/**` (Part 1, step 6) and that the GitHub variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exist (Part 2). For local development put the same two values in `.env.local`.
4. Open the site, choose **Sign in → Continue with Google**, then **Calendar**. You should see the calendar manager; any other Google account sees "You don't have access yet".

---

## Checklist to report back

- [ ] Part 1 done (never send keys in chat; just confirm).
- [ ] Part 2 variables and secrets added; keep-alive run result: ____
- [ ] Part 3 CLI installed and linked (yes / no, use SQL Editor)
- [ ] Part 4 Google sign-in configured; Part 7 admin row inserted and email/anonymous sign-in disabled.
- [ ] Parts 5–6: do these when we build Microsoft sign-in and requests.
