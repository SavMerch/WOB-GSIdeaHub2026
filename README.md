# The Leadership Collective

A private, real-time workspace where a small leadership group at **Witt O'Brien's** can be honest about where the business is, name what's in the way, imagine what's possible, share what matters, and turn it into a 60/90/120-day plan.

It's built around five questions — and they're the heart of the app:

1. **Are we being honest about where we are?** — 1–10 health ratings (private; group radar once enough people respond), "What's working?", and "What needs to be said?" (anonymous allowed)
2. **What's getting in our way?** — a sticky-note issue board with categories, "This resonates", "Mark significant" (up to 3 each), solution suggestions, filters, and a clustering chart
3. **What could we become?** — "What should we be known for?" and "Where could we grow?" with optional *what would it take* prompts
4. **What matters most to us?** — a private drag-and-drop ranking (keyboard and arrow alternatives), "How well are we doing at providing it?", and group importance-vs-experience results
5. **What are we willing to build together?** — focus list nominated from any dashboard, a 60/90/120-day roadmap with volunteers and owners, and "What do we need from each other?" that can become shared commitments

Plus a home page (**Where We're Headed**), cross-dashboard links between any issue, idea, or action, live updates and presence, and a full admin area.

### Business units, Executive View, and 2027 planning

The whole exercise runs separately in five business units: **WOB Corporate Solutions, WOB Government Advisory, WOB Emergency Management & Disaster Recovery, WOB Caribe (USVI/PR), and WOB Admin**.

- **Each unit sees only its own content.** Posts, discussions, ratings, the roadmap, and the 2027 plan all belong to one unit. The database refuses reads and writes across units, including over the API and live updates.
- **Unit picker.** People with access to more than one unit choose where to start after signing in, and can switch from the sidebar. Everyone else goes straight into their unit.
- **Cross-cutting members.** Turn this on per person in Admin → People. They can see and contribute in every unit, plus the **Executive View**. Administrators always have this access.
- **Executive View** (`/exec`) rolls everything up as **Corporate Solutions** vs **Government Solutions** (GA, EMDR, Caribe, Admin), with a per-unit breakdown:
  - participation
  - health ratings
  - priorities vs. how well they're provided
  - most-supported barriers
  - actions under way
  - 2027 BD totals
  - names that appear in more than one unit's plan

  A unit below the privacy threshold is left out of segment totals, so its answers can't be worked out by subtraction.
- **2027 Business Development** (`/u/<unit>/planning`) has three sheets:
  - **Clients:** Retain, Grow, Surrender
  - **Associations:** Member, Sponsor, Partnership
  - **Conferences:** Attend, Booth, Sponsor

  Add a row inline and choose the category and **sponsor/owner** from dropdowns; priority, status, 2026/2027 dollars, and a key date are editable in place. **Double-click a row** (or press Enter, or click the arrow) to open a detail panel with guided **Who / What / Why / Next steps** questions and a discussion thread. The detail panel detects edit conflicts; saving after someone else's change applies only the fields you edited.
- **Units are configurable** in Admin → Business Units: rename, move between segments, reorder, or switch off.

---

## Contents

- [Architecture](#architecture)
- [Security model](#security-model)
- [Setup and deployment](#setup-and-deployment) (steps 1–10)
- [Local development](#local-development)
- [Tests](#tests)
- [Branding](#branding)
- [Known limitations](#known-limitations)
- [Project layout](#project-layout)

---

## Architecture

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui-style components on Radix primitives, Lucide icons, Recharts, dnd-kit, TanStack Query |
| Data | Supabase Postgres with Row Level Security on every table |
| Auth | Supabase Auth (email + password); usernames are the visible identity |
| Live | Supabase Realtime — one **private** channel (`workspace:main`) for row changes and presence |
| Server | Netlify Functions (`/api/gate`, `/api/register`, `/api/login`, `/api/heartbeat`, `/api/password-reset`, `/api/admin`, scheduled `purge-logs`) |
| Hosting | Netlify, deployed from GitHub `main` |

**How writes work.** The browser never writes tables directly. No client role has `INSERT`/`UPDATE`/`DELETE` on any table. Every change goes through a `SECURITY DEFINER` Postgres function (e.g. `create_contribution`, `toggle_reaction`, `admin_set_status`). Each one re-checks the caller's **current** membership in the database before doing anything. Reads go through RLS-filtered `SELECT`s. The browser only ever holds the publishable (anon) key.

**Concurrency.** Comments are append-only. Cards are independently editable with a `version` column. An edit made from a stale copy is rejected (`LC409`) instead of silently overwriting someone. Creates carry a client request ID, so double-clicks and network retries can't create duplicates.

---

## Security model

| Requirement | How it's implemented |
|---|---|
| Invitation gate verified server-side | `/api/gate` compares against an **scrypt hash** stored in `invitation_codes`, a table no client role can read. The code never appears in client code. |
| Short-lived, single-use registration authorization | The gate returns an HMAC-SHA256 token (15 min) whose `jti` is recorded. `/api/register` atomically consumes it, so a token can't be reused. |
| A valid code never grants access | Registration creates a **pending** membership. Pending users can read nothing (enforced by RLS and tested). |
| No public signup bypass | Turn off Supabase public sign-ups (step 3). Defense in depth: an account created any other way has no membership, so RLS returns nothing. |
| Roles enforced server-side | `is_admin()` and `can_contribute()` run inside the database for every read policy and write function. Users can't change their own role or status (tested). |
| Immediate deprovisioning | Every protected query checks live membership status, not a JWT claim. Suspension also bans the user in Supabase Auth (refresh tokens stop working), revokes sessions where permitted, signs the browser out via a realtime event, and is audit-logged. |
| Rate limiting | Database-backed buckets on the gate (8 / 15 min per IP, 300 / hour globally), login (20 / 15 min per IP, 8 per email), registration, and password reset. |
| Trusted IP collection | Netlify's `context.ip` only. `X-Forwarded-For` and other client headers are ignored. IPs are described as networks, never devices. |
| Anonymous posts | No author column, foreign key, log row, or audit entry is written for anonymous posts. Even an admin with database access can't look it up through the app's data. The author can't edit it later. |
| Private survey answers | Ratings and rankings are readable only by their owner — not by other members and not by admins. Groups see aggregates only when at least N people have responded (admin-configurable, hard floor of 3). |
| Exports | General exports exclude anonymous identity, individual answers, and IPs. The security export is separate and admin-only. CSV cells are formula-escaped. |
| XSS | React escaping only (no `dangerouslySetInnerHTML`). Strict CSP and security headers in `netlify.toml`. Server-side text cleaning strips control characters. |
| CSRF | Auth uses bearer tokens, not cookies. Functions also reject cross-origin `Origin` headers. |
| Audit | Every admin action is written to `administrative_audit_logs`, which nobody can modify through the API. |
| Log retention | `purge-logs` runs daily and deletes security events older than the configured number of days (default 30). |

---

## Setup and deployment

You'll need a Supabase account, a Netlify account, a GitHub account, and Node 20.19+ locally.

### 1. Create a Supabase project
Create a new project at supabase.com. From **Project Settings → API**, note the **Project URL**, the **publishable key** (or legacy `anon` key), and the **secret key** (or legacy `service_role` key). Keep the secret key private.

### 2. Apply the database migrations
**Option A — SQL editor (simplest):** open **SQL Editor**, then paste and run each file in `supabase/migrations/` **in filename order** (0001 → 0005).

**Option B — Supabase CLI:**
```bash
npx supabase init            # once; keeps the existing migrations folder
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 3. Configure authentication
In the Supabase dashboard:
- **Authentication → Sign In / Providers:** keep **Email** enabled, and turn **off** "Allow new users to sign up". Accounts are created only by the server function after the invitation gate, or by an admin.
- **Authentication → URL Configuration:** set **Site URL** to your Netlify URL. Add `https://<your-site>/reset-password` to **Redirect URLs** (used by password reset and invitation emails).
- **Authentication → Emails:** for reliable invitation and reset emails, configure **custom SMTP**. Supabase's built-in sender is heavily rate-limited.
- *(Recommended)* Shorten the access-token lifetime (JWT expiry) to 15–30 minutes, so a banned user's last token expires sooner. Database checks already block them immediately.
- **Realtime → Settings:** turn **off** "Allow public access", so only private, authorized channels work.

### 4. Create the first administrator
There's no default admin and no default password. Pick one of these:

**A. Script (also sets the first invitation password):**
```bash
npm install
SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=sb_secret_… npm run bootstrap-admin
```

**B. Dashboard only:** **Authentication → Users → Add user** (enter your email and a strong password; tick "Auto confirm"). Then in the SQL editor:
```sql
select public.bootstrap_first_admin('you@example.com', 'your.username', 'Your Name');
```
`bootstrap_first_admin` refuses to run once any administrator exists, and only the SQL editor or the secret key can call it.

### Upgrading an existing installation to business units

If you already ran 0001–0004:

1. In Supabase → **SQL Editor**, run **`20261106000005_business_units.sql`** once.
   - Existing content is assigned to **WOB Corporate Solutions**.
   - Existing members are added to Corporate Solutions.
   - Existing administrators become cross-cutting.
2. Push the updated files to GitHub. Netlify redeploys automatically.
3. Open **Admin → People** and set each person's business unit with the pencil icon. Turn on **Cross-cutting** for the 1–2 people who should see everything.

### 5. Set the invitation password
Sign in, go to **Admin → Access & Security → Invitation password**, and set one (8+ characters). You can replace it, set an expiry or maximum uses, or disable it at any time. Only a hash is stored, so it can't be read back, only replaced.

### 6. Configure Netlify environment variables
In **Netlify → Site configuration → Environment variables**:

| Variable | Value | Scope |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | Builds |
| `VITE_SUPABASE_ANON_KEY` | Publishable / anon key | Builds |
| `SUPABASE_URL` | Project URL | Functions |
| `SUPABASE_ANON_KEY` | Publishable / anon key | Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret / service-role key — **mark as secret** | Functions |
| `REGISTRATION_TOKEN_SECRET` | 48+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | Functions |
| `APP_URL` *(optional)* | Your public URL if you use a custom domain | Functions |

Never prefix the secret key with `VITE_`, because anything with that prefix is bundled into the browser.

### 7. Push to GitHub
```bash
git init && git add . && git commit -m "The Leadership Collective"
git branch -M main
git remote add origin git@github.com:<you>/leadership-collective.git
git push -u origin main
```
`.env` files are git-ignored. Nothing secret lives in the repository.

### 8. Connect GitHub to Netlify
**Add new site → Import an existing project → GitHub →** choose the repo. Netlify reads `netlify.toml` (build `npm run build`, publish `dist`, functions `netlify/functions`). Set the production branch to `main` so every push deploys.

### 9. Deploy and verify
Trigger a deploy, then run the production checks from your computer:
```bash
SITE_URL=https://<your-site>.netlify.app \
VITE_SUPABASE_URL=https://xyz.supabase.co VITE_SUPABASE_ANON_KEY=sb_publishable_… \
npm run check:prod
```
This confirms that public sign-up is off, anonymous REST/RPC calls are refused, the SPA fallback and security headers work, the gate rejects a wrong code, functions have their environment variables, and no secret key is in the bundle.

### 10. Test with multiple users
Use three browsers (or private windows):
1. **Browser A (admin):** sign in.
2. **Browser B:** visit the site, enter the invitation password, and request an account. You should see *Awaiting approval*. Try visiting `/home` — you'll be sent back.
3. **A:** go to **Admin → People** and approve B. B's screen moves into the workspace by itself within about 30 seconds.
4. **Browser C:** repeat steps 2–3.
5. **A:** add an issue in *What's getting in our way?*. It appears for B and C without a refresh.
6. **C:** comment on it. A and B see the comment count and thread update.
7. **B:** post anonymously in *What needs to be said?*. Check that A (admin) sees "Anonymous" in the card, in **Admin → Content**, and in exports.
8. **A, B, C:** each submit a ranking in *What matters most to us?*. Group results appear only once the third one lands.
9. **A:** suspend B. B is signed out, and any request with B's old token returns nothing.
10. **A:** open **Admin → Access & Security** to see sign-ins with IP addresses. Confirm that B and C can't reach `/admin`, and that their REST calls to `authentication_events` return `[]`.

---

## Local development

```bash
cp .env.example .env      # fill in a development Supabase project
npm install
npm run dev               # frontend only, http://localhost:5173
```
The `/api/*` functions need the Netlify runtime. To run everything together:
```bash
npx netlify-cli dev       # serves the app and functions on http://localhost:8888
```

**Demo data (development only).** After bootstrapping an admin, run `supabase/seed-demo.sql` in a **development** project to populate the boards. Every demo row is tagged, and `supabase/reset-demo.sql` removes exactly those rows. Survey answers are never seeded, so charts always reflect real responses.

---

## Tests

```bash
npm test                  # unit + function-handler tests (no database needed)
npm run db:test:setup     # starts a throwaway local Postgres on port 54329
npm run test:db           # authorization tests against real Postgres + the real migrations
npm run build             # type-check + production build
```

**What the tests cover.**
- `tests/db/` (64 tests): runs every migration against a real Postgres, with a small shim for Supabase's `auth.uid()` and roles. Each query runs as `anon`, `authenticated`, or `service_role`, exactly as the Supabase API does. Covers acceptance scenarios 1, 2, 4, 5, 6, 8, and 9 at the database level:
  - unauthenticated access is refused
  - pending users see nothing
  - approval grants access
  - cross-user edits are refused
  - viewers are read-only
  - edit conflicts are detected
  - duplicate reactions and invalid rankings are blocked
  - anonymous posts leave no trace of their author anywhere
  - individual answers are hidden from everyone, including admins
  - aggregate thresholds hold
  - a suspended user's live session is refused immediately
  - only admins can read security logs
  - general exports contain no IPs
  - retention purge works
  - registration tokens are single-use
  - rate limiting works
  - the bootstrap function locks after first use
  - business units:
    - members can't read, write, react, comment, or link across units
    - realtime topics are authorized per unit
    - profiles are limited to shared units
    - cross-cutting access and the Executive View
    - only assigned members answer surveys
    - segment roll-ups exclude units below the threshold
    - BD rows (category/kind rules, owner must be in the unit, merged detail edits, version conflicts, isolation, comments, delete rights)
    - overlap detection
    - BD export
    - unit assignment on approval
- `tests/unit/` (21 tests):
  - invitation-code hashing
  - token signing, tampering, and expiry
  - trusted-IP parsing
  - input validation
  - CSV formula-injection escaping
  - the gate and login handlers end to end, using a fake Supabase: wrong code is logged with IP, right code gets a token, closed registration, rate limit, cross-site refusal, generic login errors, and a suspended user's session being revoked

**Not covered by automated tests.** These need a live Supabase project and Netlify, so they're for you to verify with steps 9–10 above:
- Supabase Auth itself (GoTrue sign-in, bans, emails)
- Realtime delivery and presence
- the Netlify Functions runtime (`context.ip`)

---

## Branding

- Logos are in `public/brand/`: `witt-obriens-logo-dark.png` for light backgrounds and `witt-obriens-logo-white.png` for dark ones. Both were generated from the logo file you supplied. Paths and names are in `src/brand.ts`.
- Colors and fonts are tokens in the `@theme` block at the top of `src/index.css`. The palette uses the logo's near-black for text and primary buttons, a muted teal accent, and blue / amber / green / purple / teal for the five dashboards. Headings use Montserrat (a geometric sans that pairs with the wordmark) and body text uses Inter.
- **To apply the official brand-guide colors:** change the hex values in that `@theme` block. Every component uses the tokens, so nothing else needs editing. Keep text colors at 4.5:1 contrast or better on white.

---

## Known limitations

These are stated honestly so nobody is surprised:

- **Anonymity in a small group** can't be absolute. Writing style and timing can identify people, and whoever operates the hosting platform could correlate request logs. The in-app privacy notice says so.
- **Aggregates over time.** If one person changes a rating and someone compares results before and after, they could infer that change. Thresholds, rounding, coarse buckets, and the absence of filters reduce this risk but don't eliminate it.
- **Email ownership isn't verified** at registration, because admin approval is the gate. Approvers should recognize each requester's email.
- **Direct Supabase sign-in.** A member could sign in by calling Supabase Auth directly with the publishable key, bypassing `/api/login`. That sign-in wouldn't be rate-limited or logged as a login by this app, though Supabase's own limits still apply. Their session is still logged by the heartbeat (with IP), and every permission still applies.
- **Session revocation on hosted Supabase.** Deleting rows from `auth.sessions` may not be permitted, so the admin panel says when it couldn't. The Auth ban plus database checks still cut access off immediately.
- **Rate limiting** is per IP. Many people behind one office network share a bucket, so the limits are deliberately generous.

---

## Project layout

```
netlify/functions/      gate, register, login, heartbeat, password-reset, admin, purge-logs (scheduled)
netlify/lib/            shared server helpers (security.ts is pure and unit-tested)
supabase/migrations/    0001 schema · 0002 functions/RPCs · 0003 grants, RLS, realtime · 0004 defaults · 0005 business units, Executive View, 2027 BD
supabase/seed-demo.sql  development-only demo data (+ reset-demo.sql)
scripts/                bootstrap-admin, check-production, test-db
src/pages/              public auth pages, UnitPicker, Home, five dashboards, Planning (2027 BD), Exec, admin/*
src/components/         ui/ (component library), layout/, collab/ (boards, cards, discussion, links)
src/hooks/              auth, realtime (private channel + presence), data queries & mutations
tests/                  db/ (Postgres authorization) and unit/
```
