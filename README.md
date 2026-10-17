# Somnium

**Describe your standard. See what passes.**

Somnium is a browser-based trust check for EEG recordings, built for new researchers and home-sleep data.
Drop in an EDF file and get a channel × time map of what's usable, with plain-English evidence for every flag.
The meta part: you write the quality rules yourself, three ways, and save them as a shareable checklist.

- **Say it**: type "flag 60 Hz hum above 15%" and preview what it would flag.
- **Show it**: drag across a region you consider bad; Somnium proposes the metric and threshold that separate it from the rest.
- **Tune it**: edit metric, direction and threshold with a live preview.
- **Keep it**: save an analysis to the sidebar and reopen it later. With "Keep the
  recording" ticked the EDF is stored too, so the report comes back exactly as it was —
  including the checklist you scored it with.

Parsing and analysis always run in the browser. A recording is only uploaded when you
tick "Keep the recording" **and** are signed in; checklists and analysis metadata sync
to your account either way.

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
  RLS and database grants protect checklist, analysis and recording data.
  There is no privileged key in the app.

## Supabase setup for a different project

1. Create a Supabase project, then apply every file in `supabase/migrations/`
   in filename order using the SQL Editor or the Supabase CLI migration workflow. This creates two tables — `checklists`
   and `analyses` — with owner-only SELECT, INSERT and DELETE policies, plus a private
   `recordings` Storage bucket. Saved rows are immutable snapshots; saving again creates
   a new row. No public read or update access is granted. `analyses.local_id` is generated
   by the browser and unique per user, so re-syncing the same analysis never duplicates it.
   The second migration restricts API access to the optional automatic-RLS trigger helper;
   the fourth adds the checklist/storage columns and the bucket policies.
   Storage policies are scoped to a `<user_id>/` prefix, so one account can never read,
   overwrite or delete another's recording.
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
Signing out clears cloud state, while the current recording, working checklist and
locally saved analyses remain in the tab. Cloud loads ask before replacing the working
checklist. Named rule snapshots, analysis metadata and — only if you ask for it — the
recording itself are stored.

### Previous analyses and stored recordings

The sidebar keeps analyses in IndexedDB, so saving, listing and reopening all work
signed out and offline. A saved analysis records the filename, date, length, channel
count, sample rate, the checklist it was scored with, and whether a recording is kept.

Opening one restores the recording **and** the checklist, so the verdict is reproducible
rather than re-scored against whatever rules are current. The recording is read from this
browser first and from the account second, so a different device can reopen it too.

Signing in syncs both ways: anything saved on this device is uploaded, anything saved on
another device is pulled down. Deleting an analysis removes the row and the stored object.
The status line reports the result and **Sync** retries on demand; a failed upload keeps
the local copy and retries next time.

**Size limits.** `MAX_RECORDING_BYTES` (1 GiB) is the app's ceiling and the database
check. `UPLOAD_LIMIT_BYTES` (50 MiB) is what this project's Storage plan actually accepts —
the API refuses a higher per-file limit on the free plan ("upgrade the project to a paid
plan to unlock higher file size limits"). Files above the effective limit are saved with
their details only, and the sidebar says so instead of failing after a long upload. On a
paid project, raise the global file size limit, the bucket's `file_size_limit` in the
fourth migration, and `UPLOAD_LIMIT_BYTES` together. Note that the free plan also caps
total storage at 1 GB, so one maximum-size recording would fill it.

Anonymous analyses belong to the browser, not to an account: signing in as a different
user never shows or uploads the previous user's history.

`npm test` executes the migrations in an embedded Postgres (PGlite) database and
checks owner isolation, anonymous denial, grants, malformed rule rejection, the
`analyses` storage columns, the bucket configuration and Storage prefix isolation —
across `checklists`, `analyses` and `storage.objects`.
Browser tests use mocked Supabase HTTP responses and exercise the actual SDK, including
uploading a recording and reopening it from a second browser context.
The connected project also passed real two-account login, checklist isolation,
validation, owner CRUD, recovery-token/password update, and browser session checks.
Temporary verification users and their checklists were removed afterward.
Supabase Security Advisor reports zero errors after the applied migrations. Its one
warning is `auth_leaked_password_protection` (Auth setting, unrelated to these tables);
enable leaked-password protection in Auth → Providers to clear it.

The `analyses` and recordings migrations were applied to the hosted project through the
Supabase Management API. Verified on the live database: RLS enabled, three owner-only
policies, `authenticated` holds SELECT/INSERT/DELETE and no UPDATE, `anon` holds nothing,
both indexes exist, the `checklist`/`storage_path`/`size_bytes` columns are present, the
`recordings` bucket is private with a 50 MiB object limit, and exactly three
prefix-scoped policies exist on `storage.objects`. PostgREST returns permission-denied
for anonymous requests against both the table and the bucket. A live signed-in
insert/upload has not been run against the hosted project yet; run
`scripts/verify-backend.mjs` with a server key to cover it.

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
recovery. Dropping `public.analyses` removes all saved analysis history; dropping
`public.checklists` and then `private.valid_checklist_rules(jsonb)` removes saved
checklists; deleting the `recordings` bucket removes every stored recording. All are
destructive — export/back up data before doing so.

## How it works

| File | Role |
|---|---|
| `src/edf.js` | 16-bit EDF parser |
| `src/edfWrite.js` | 16-bit EDF encoder, used to turn the demo into a real saveable file |
| `src/metrics.js` | per-window flatline, peak-to-peak, kurtosis, 50/60 Hz share |
| `src/rules.js` | rules as plain data over those metrics, plain-language parser, "show it" proposal, verdict |
| `src/map.js` | map geometry: windows → grid columns, and the canvas pixel budget |
| `src/analyses.js` | previous-analysis records: validation, merge, formatting, size limits, DB column mapping |
| `src/analysisStore.js` | the storage service: IndexedDB (metadata + recording blobs) + Supabase rows and Storage |
| `src/history.js` | the sidebar UI (save, list, open, remove, sync) |
| `src/app.js` | UI |

Rules are data over five documented metrics, never generated code, so every flag can be inspected.

## Limits (MVP)

- 16-bit EDF only (no BDF/FIF yet); metrics are per channel, no cross-channel checks.
- The recording map gets a fixed pixel budget, so a long recording aggregates windows into columns (one column ≈ 3 min of a full night, `src/map.js`). Clicking a column inspects the earliest flagged window in it. Zooming into per-window detail is on the roadmap.
- Saved analyses keep the checklist they were scored with, so reopening reproduces the
  verdict. The recording is kept only when asked for and only up to the storage plan's
  limit; a larger file keeps its details and says so in the sidebar.
- Reopening a recording re-parses the whole file and re-renders the report. There is no
  incremental or partial restore, and no way to open one without its recording.
- Plain-language parsing uses templates; an LLM translation step is the planned upgrade.
- "Show it" thresholds are proposals from few examples. Check the preview before adding.
- Not validated against PREP/PyPREP yet, and not for clinical use.

## Roadmap

Shared checklist library, BDF/FIF support, neighbor-channel correlation, LLM rule translation, methods-section text generated from a checklist.

`src/edf.js` and `src/metrics.js` were drafted by a free DeepSeek worker via OpenSlave, then reviewed and fixed here.
