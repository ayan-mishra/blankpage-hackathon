# Somnium

Somnium checks EEG recordings before you analyze them. Drop in an EDF file and you get a map of the usable stretches, with a plain-English reason for every flag. It's built for first-time researchers and for home-sleep data, where headbands slip and recordings often go bad.

The quality rules are yours to write, in three ways:

- Type one, like "flag 60 Hz hum above 15%", and preview what it would catch before you add it.
- Drag across a stretch you think is bad, and Somnium suggests the metric and threshold that set it apart from the rest.
- Edit the metric, direction and threshold by hand, with a live preview.

You sign in to use the app. Every recording you open is saved to a sidebar of analyses (the demo only if you save it), and reopening one restores the checklist it was scored with. You can also start from a checklist template and type your own numbers. Rules save as a checklist you can share. Parsing and checking always run in the browser. A recording is stored in your private bucket only while "Keep the recording" is ticked. Supabase handles accounts, the private checklist snapshots people choose to save, analysis metadata, and recordings people choose to keep.

## Who it's for

Study coordinators. In an insomnia study with home sleep headbands, `study.html` takes one EDF per participant-night and shows who is wearing the headband properly, what went wrong in plain words, and what to tell them. It grades with the rules you wrote in `app.html`, or a checklist file you import. The table exports as CSV.

Hobby and first-time researchers. `app.html` checks a single recording, explains each result in everyday language, and has a glossary instead of jargon.

## Run

```
npm ci
cp .env.example .env.local  # optional: override the included public project config
npm run serve             # http://127.0.0.1:8080
npm test
npm run test:e2e           # first run: npx playwright install chromium
npm run build             # deploy dist/ to a static host
```

Node 22.12+ (Node 24 recommended). Click "Try the demo recording" (or open `app.html?demo`)
for a synthetic file with three known faults; the "Try it" box walks you through
teaching it a 60 Hz rule. `study.html?sample` opens the sample study. The app defaults to the Somnium Supabase project below.
To use another project, override the two public values in `.env.local`. Set both to
empty strings to disable accounts; the app pages then show a "not configured" message instead of opening.

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
signed out and offline. On a wide screen it stays pinned as the report scrolls, and
scrolls internally if the list outgrows the window; on a phone it stacks above the
report and scrolls normally. A saved analysis records the filename, date, length, channel
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
| `src/rules.js` | rules as plain data over those metrics, the plain-language parser, the "show it" proposal, the verdict |
| `src/wear.js` | the headband wear check for a whole night: status, cause, what to tell the participant, CSV |
| `src/study.js` | the study page (many files, one table) |
| `src/map.js` | map geometry: windows to grid columns, and the canvas pixel budget |
| `src/app.js` | the single-recording page |
| `src/checklists.js` | checklist validation, and the working checklist shared by both pages in this browser |
| `src/demo.js` | seeded synthetic EEG for the demo and the sample study, with planted faults |
| `src/analyses.js` | previous-analysis records: validation, merge, formatting, database column mapping |
| `src/analysisStore.js` | the storage service: IndexedDB (metadata and recording files) plus Supabase rows and Storage |
| `src/history.js` | the previous-analyses panel (save, list, open, remove, sync) |
| `src/edfWrite.js` | encodes signals as an EDF file, so the demo can be saved and reopened |
| `src/gpu.js` | detects software rendering and shows how to turn hardware acceleration on |

Rules are plain data over documented metrics, never generated code, so you can inspect every flag. `src/checklists.js` keeps the working checklist in the browser, so a rule you add in `app.html` also grades nights in `study.html`, including a tab that's already open.

## Limits (MVP)

- It reads 16-bit EDF only (no BDF or FIF yet). Metrics are per channel, with no cross-channel checks.
- The recording map has a fixed pixel budget, so a long recording is grouped into columns (about 3 minutes each for a full night; see `src/map.js`). Clicking a column opens the earliest flagged window in it. Zooming to single windows is on the roadmap.
- Saved analyses keep the checklist they were scored with, so reopening reproduces the verdict. The recording is kept only when asked for, up to the storage plan's limit; a larger file keeps its details and says so.
- Reopening re-parses the whole file. There's no way to reopen an analysis without its recording.
- Plain-language rules are parsed with templates. An LLM translation step is planned.
- "Show it" proposals come from a handful of examples, so check the preview before adding one.
- The wear-check cut-offs (75% clean is fine, under 50% is not worn properly) come from a 2026 medRxiv preprint on home sleep EEG that hasn't been peer reviewed.
- It isn't validated against PREP or PyPREP yet, and it's not for clinical use.

## Roadmap

Next 2 weeks:

- Move EDF parsing and measuring into a Web Worker, so a folder of full nights doesn't freeze the page.
- First validation pass: compare Somnium's flags with PyPREP noisy channels and YASA artifact rejection on a public sleep dataset, and publish the agreement.
- 30-second windows for sleep data, and tuning the "signal too faint" threshold on real headband nights.
- Zoom from a grouped map column down to single windows.
- A two-minute check before lights-off, since most outright failures in the cited preprint were bad from the start.

Next 3 months: opt-in share links for saved checklists and a starter library per headband; LLM rule translation that outputs the same `{metric, op, value}` rules and still requires a preview; BDF, EDF+ annotations and neighbor-channel correlation; a pilot with two or three home sleep studies, measuring QC time and re-recorded nights.

Next 6 months: a validation write-up against expert-labelled data, methods-section text generated from a checklist, multi-night trends per participant, and an audit trail of which checklist version graded which file. It stays research-use only.

Pitch and submission materials are in `docs/pitch/`.

`src/edf.js` and `src/metrics.js` were first drafted by a free DeepSeek worker through OpenSlave, then reviewed and fixed here.
