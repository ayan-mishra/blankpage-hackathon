# Somnium

**Describe your standard. See what passes.**

Somnium is a browser-based trust check for EEG recordings, built for new researchers and home-sleep data.
Drop in an EDF file and get a channel × time map of what's usable, with plain-English evidence for every flag.
The meta part: you write the quality rules yourself, three ways, and save them as a shareable checklist.

- **Say it**: type "flag 60 Hz hum above 15%" and preview what it would flag.
- **Show it**: drag across a region you consider bad; Somnium proposes the metric and threshold that separate it from the rest.
- **Tune it**: edit metric, direction and threshold with a live preview.

EEG parsing and analysis run in the browser; recordings are never uploaded.
Supabase handles accounts and private checklist snapshots.

## Run

```
npm ci
cp .env.example .env.local  # optional: override the included public project config
npm run serve             # http://127.0.0.1:8080
npm test
npm run test:e2e           # first run: npx playwright install chromium
npm run build             # deploy dist/ to a static host
```

Node 22.12+ (Node 24 recommended). Click "Try the demo recording" for a synthetic
file with three known faults. The app defaults to the Somnium Supabase project below.
To use another project, override the two public values in `.env.local`. Set both to
empty strings to disable accounts; the demo and local checklist tools still work.

## Connected Supabase project

- Organization: somniumqc (Free)
- Project: Somnium (`czixliadrvvdooktoahe`, US East)
- [Dashboard](https://supabase.com/dashboard/project/czixliadrvvdooktoahe)
- The URL and publishable key in `src/supabase.js` are intentionally public.
  RLS and database grants protect checklist data. There is no privileged key in the app.

## Supabase setup for a different project

1. Create a Supabase project, then apply both files in `supabase/migrations/`
   in filename order using the SQL Editor or the Supabase CLI migration workflow. This creates one table with owner-only
   SELECT, INSERT and DELETE policies. Saved snapshots are immutable; saving again
   creates a new snapshot. No public read or update access is granted. The second
   migration restricts API access to the optional automatic-RLS trigger helper.
2. Copy the project URL and **publishable** key from the dashboard into `.env.local`.
   These two values are public browser configuration. Never use a secret or
   service-role key. Vite includes `VITE_` variables in the browser build.
3. In Authentication → URL Configuration, set the Site URL to your deployed site
   and allow the exact callback URLs `http://127.0.0.1:8080/app.html`,
   `http://localhost:8080/app.html`, and your deployed `/app.html` URL.
4. Keep email/password authentication and email confirmation enabled. Configure
   custom SMTP for real users: the built-in mail service restricts delivery and
   is intended for testing. Check current [Supabase email guidance](https://supabase.com/docs/guides/auth/auth-smtp).
5. Rebuild with the public environment variables on your static host. Both
   `index.html` and `app.html` are build entries; publish the generated `dist/`.
   `vercel.json` supplies these build/output settings for Vercel previews and deployments.

Create an account, confirm its email, then sign in. Password reset emails return
to the app and reveal the new-password form. Sessions persist through reloads.
Signing out clears cloud state, while the current recording and working checklist
remain in the tab. Cloud loads ask before replacing the working checklist.
Only named rule snapshots are stored; there is no recording storage or upload API.

`npm test` executes the migration in an embedded Postgres (PGlite) database and
checks owner isolation, anonymous denial, grants, and malformed rule rejection.
Browser tests use mocked Supabase HTTP responses and exercise the actual SDK.
The connected project also passed real two-account login, checklist isolation,
validation, owner CRUD, recovery-token/password update, and browser session checks.
Temporary verification users and their checklists were removed afterward.
Supabase Security Advisor reported zero errors and zero warnings after both migrations.

To rerun hosted verification against an explicitly chosen project, put its server key
in a protected local file (never in browser configuration or Git), then run:

```sh
SUPABASE_SECRET_KEY_FILE=/path/to/protected-key node scripts/verify-backend.mjs
# Also test the actual browser UI against that backend:
SUPABASE_SECRET_KEY_FILE=/path/to/protected-key SOMNIUM_APP_URL=http://127.0.0.1:8080/app.html?demo node scripts/verify-backend.mjs
```

The script creates and removes two synthetic accounts without sending email.
For another project, also set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and
point the app at that same project. Email confirmation/reset delivery still needs
SMTP configuration for public users; token validation was tested without email.
The hosted schema was applied through SQL Editor because the connected MCP is scoped
to another organization. Before using CLI migrations against this existing project,
mark the two existing migration versions as applied with `supabase migration repair`
after verifying the remote schema; do not reapply the table-creation migration.

Rollback: revert the application commit to remove accounts. Keep the database for
recovery. Dropping `public.checklists` and then `private.valid_checklist_rules(jsonb)`
removes this schema **and all saved checklists**; export/back up data before doing so.

## How it works

| File | Role |
|---|---|
| `src/edf.js` | 16-bit EDF parser |
| `src/metrics.js` | per-window flatline, peak-to-peak, kurtosis, 50/60 Hz share |
| `src/rules.js` | rules as plain data over those metrics, plain-language parser, "show it" proposal, verdict |
| `src/map.js` | map geometry: windows → grid columns, and the canvas pixel budget |
| `src/app.js` | UI |

Rules are data over five documented metrics, never generated code, so every flag can be inspected.

## Limits (MVP)

- 16-bit EDF only (no BDF/FIF yet); metrics are per channel, no cross-channel checks.
- The recording map gets a fixed pixel budget, so a long recording aggregates windows into columns (one column ≈ 3 min of a full night, `src/map.js`). Clicking a column inspects the earliest flagged window in it. Zooming into per-window detail is on the roadmap.
- Plain-language parsing uses templates; an LLM translation step is the planned upgrade.
- "Show it" thresholds are proposals from few examples. Check the preview before adding.
- Not validated against PREP/PyPREP yet, and not for clinical use.

## Roadmap

Shared checklist library, BDF/FIF support, neighbor-channel correlation, LLM rule translation, methods-section text generated from a checklist.

`src/edf.js` and `src/metrics.js` were drafted by a free DeepSeek worker via OpenSlave, then reviewed and fixed here.
