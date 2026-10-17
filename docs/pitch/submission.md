# Somnium: written submission

Somnium checks EEG recordings before anyone analyzes them. You drop in an EDF file and get a map of which stretches are usable, with a plain-English reason for every flag. The quality rules belong to the user. You can type one in words, drag across a stretch you think is bad and have Somnium suggest one, or set the numbers yourself. The rules save as a checklist file you can hand to the next person.

Live pages: `index.html` (landing), `app.html` (one recording), `study.html` (a whole study), `trailer.html` (60-second trailer).

## Problem statement

Home sleep EEG is getting cheap. A study coordinator can mail forty dry-electrode headbands to participants and get forty nights of EDF files back. A lot of those nights are bad, and nobody finds out until the analysis.

The clearest recent number comes from a 2026 medRxiv preprint (Parry and Briganti, University of Mons; not yet peer reviewed). It screened 100 home recordings from the Wearanize+ dataset, made with a ZMax headband on F7-Fpz and F8-Fpz. 74 were OK, 16 were partly degraded and 10 failed outright, mostly from signal dropout. Seven of the ten failures had near-zero signal from the start, and the authors note that a quick quality check before lights-off would probably have caught most of them. [1]

So about one night in four can't be fully trusted. The people who need to know this are rarely signal-processing experts. They fall into two groups:

1. **Study coordinators** running home sleep-headband studies (insomnia trials, sleep-extension studies). Each morning they need to know who wore the headband properly, what went wrong, and what to tell that participant before tonight.
2. **First-time and hobby researchers**: students, citizen scientists, people with a consumer headband. They have one recording and no way to tell whether it is any good.

The existing tools are built for a third group: people who write MATLAB or Python, think in epochs and ICA components, and already know what a kurtosis threshold of 8 means.

## What it does (as built)

### `app.html`: one recording

- Parses 16-bit EDF. Signed-in users keep their analyses, and optionally the recordings, in a private Supabase account.
- Cuts each channel into 5-second windows and computes a few documented measurements per window: flat-line share, peak-to-peak amplitude, kurtosis (spikiness), and the share of power at 50 Hz and at 60 Hz (`src/metrics.js`). An 8-hour, 6-channel recording at 256 Hz is measured and checked in about a quarter of a second on our laptop.
- Applies a built-in checklist (flat line over 50%, 50 or 60 Hz hum over 20%, swings over 300 µV, spikiness over 8, and a "signal too faint" rule, standard deviation under 2 µV, that catches headbands that never touched the skin [9]) and gives an overall verdict: usable, usable after fixes, or not usable.
- Draws a recording map: one row per channel, one square per window (long recordings group windows into columns so the canvas fits). Clicking a square shows the measurement, the rule that tripped, the usual cause, an "In plain words" line and the raw trace for that window.
- Lets you write your own rules three ways, each with a live preview on the map before you add it:
  - **Say it.** Type "flag 60 Hz hum above 15%". A small template parser turns it into a rule over one of the metrics, or tells you it couldn't read it.
  - **Show it.** Drag across a stretch on the map and click "Teach a rule from selection". Somnium finds the metric that best separates your selection from the rest of the recording and proposes a threshold. Then "Add rule".
  - **Tune it.** Change the metric, direction or number by hand and watch the flagged squares move.
- A guided demo (`app.html?demo`). The recording looks like real resting EEG (1/f background, alpha that drops when the eyes open, blinks) with three planted faults. It starts with a checklist from a lab on 50 Hz power, so it has no 60 Hz rule. Out of the box it flags C3 losing contact and O1 moving, and reads "usable". The "Try it" box has the visitor click C4, see hum the checklist misses, drag across it and teach a rule. The suggestion is "60 Hz hum above 42%"; after "Add rule" the verdict changes to "usable after fixes" (6% → 14% flagged), with a line naming the rule that did it.
- Exports and imports the checklist as `somnium-checklist.json`. Imported files are validated field by field. Every edit is also kept in the browser, so `study.html` picks it up ("Apply these rules to a study →").
- Optional accounts (Supabase): sign in to save named checklist snapshots. Only the rules and the name are stored, under owner-only row-level security. Recordings are never stored.
- A glossary in everyday words.

### `study.html`: a whole study

- Takes many EDF files at once, one per participant-night (named like `P012_night1.edf`).
- Grades with your own checklist: the one you edited in `app.html` (the two tabs stay in sync) or an imported JSON file. The page says "Using your checklist: N rules · Reset to default".
- For each night, marks a 10-second window as good when at least half the channels pass the checklist, then grades the night with the preprint's cut-offs: 75% or more good is "Worn properly", 50–74% is "Check this one", under 50% is "Not worn properly". [1]
- Finds the main cause (lost contact, electrical hum, movement), the longest problem stretch, and whether the signal was lost until the end of the night. It also catches one sensor failing while the other works.
- Shows a headline that counts participants ("Follow up with 4 of 8 participants"), a status bar (3 not worn properly, 1 check this one, 4 worn properly on the sample), "Who to contact" buttons that jump to each person, rows grouped by status with a night timeline each, what to do, and a "Tell them" box with a "Copy full message" button that copies a note for the participant.
- Exports the table as CSV, with formula-injection protection on cells that come from file names and channel labels.

### What it does not do yet

- 16-bit EDF only (no BDF or FIF). Metrics are per channel with no cross-channel checks.
- Cloud-saved checklists are private to the owner. Sharing today means passing the JSON file.
- The plain-language parser is templates, not an LLM.
- Not validated against PREP/PyPREP or any expert-labelled dataset. Not for clinical use.
- The demo and sample study are synthetic, though built to look like real EEG: the sample nights have sleep stages, spindles, K-complexes and slow waves under the planted faults (`src/demo.js`). The sample nights are one hour long.

## Why it is "meta"

The theme asks for tools that let people make the software they want. EEG quality control is a good test case, because every lab already has its own rules ("we drop any epoch over 150 µV", "our headband's 50 Hz is always a bit high, ignore it under 30%"). Those rules usually live in a postdoc's MATLAB script or in nobody's head.

Somnium lets the domain expert build that QC program without writing code:

- They describe the rule in words, show it with an example, or set the number.
- Every rule is plain data over named metrics (`{metric, op, value}`), never generated code. You can read every flag back to the rule that caused it.
- The finished checklist is a small file. It is the lab's quality standard in a form you can version, email, import, apply to a whole study, and (on the roadmap) turn into methods-section text.

The person who knows what a bad night looks like ends up with their own checker, without a programmer in between.

## What exists already, and what is different

| Tool | What it does | Who it's for | Gap for our users |
|---|---|---|---|
| MNE autoreject [2] | Learns per-sensor peak-to-peak thresholds by cross-validation, then interpolates or drops bad epochs | Python users on MNE, epoched MEG/EEG | Code only; thresholds are learned, not written by the user; no wear or participant view |
| EEGLAB clean_rawdata (ASR) and ICLabel [3] | Detects and repairs bad stretches/channels (ASR); classifies ICA components as brain, eye, muscle, etc. Default plugins since EEGLAB 2019.1 | MATLAB users | Needs MATLAB and preprocessing know-how; repairs data rather than explaining it |
| PREP / PyPREP [4][5] | Standardized early pipeline: noisy-channel detection (correlation, deviation, RANSAC), robust re-referencing | Large-scale EEG analysis, coders | Channel-level, code only, not sleep-headband specific |
| YASA [6] | Open-source sleep staging, with artifact rejection on single or multi-channel EEG | Python users, sleep researchers | Code only; artifact rejection is a means to staging, not a coordinator report |
| Vendor headband apps (e.g. Dreem) [7] | Proprietary per-night quality score | Device owners | Closed and device-specific; a Utah study simply filtered to nights the Dreem algorithm scored above 75% |
| Clinical PSG systems [8] | Technologist workflows with bedside impedance checks and autoscoring | Sleep labs | Built around a tech at the bedside, which home studies don't have; we found no public documentation of an automated, user-editable QC step |

What we did not find in any of these: a no-install, no-code checker where the user writes the rules (in words, by example or by number), where each flag carries a readable reason, and where the output for a study is a list of participants to contact and what to say to them. The coordinator view is the most original part. Existing tools answer "which epochs should I drop?"; Somnium also answers "who do I call this morning, and what do I tell them?"

We are not claiming better artifact detection than these tools. Our metrics are deliberately simple. The difference is who can use and change the rules, and what the output says.

## How it was built

- Plain JavaScript ES modules with Vite, no framework. The core logic (`edf.js`, `metrics.js`, `rules.js`, `wear.js`, `map.js`) is pure and runs in Node as well as the browser.
- 44 unit tests with `node --test` and 12 Playwright end-to-end tests (all passing on 17 Oct 2026; the counts grow as the app changes). Unit tests cover the EDF parser, metrics, rules, map geometry, wear grading, checklist validation, the demo signals, and the database migration in an embedded Postgres (PGlite). The browser tests cover the account flow against mocked Supabase responses, teaching a rule on the demo, and a rule added in `app.html` grading the sample study.
- Measuring an 8-hour, 6-channel night went from about 1.5 s to about 0.25 s during the build (the 50/60 Hz terms are tabulated once, and each window takes one pass). Every value came out identical when we compared old and new code on the same signal.
- Supabase for optional accounts: one table, owner-only SELECT/INSERT/DELETE policies, immutable snapshots, server-side validation of rule shape. Supabase Security Advisor reported zero errors and warnings.
- Built in two days by a small team working with AI coding agents (Claude Code for most of the app, landing page and trailer; Codex for the Supabase backend branch). The EDF parser and metrics were first drafted by a free DeepSeek model through our OpenSlave delegation runner, then reviewed and fixed.

## Roadmap

Grounded in what exists today. Each item names the file or gap it starts from.

### Next 2 weeks

- Move EDF parsing and measuring into a Web Worker, so dropping a folder of full nights on `study.html` doesn't freeze the page while it works.
- First validation pass: run Somnium's flags against PyPREP noisy channels and YASA artifact rejection on a public sleep dataset, and publish the agreement numbers, good or bad.
- Use 30-second windows for sleep data so results line up with scored epochs, and tune the "signal too faint" threshold on one real ZMax or Dreem night.
- Zoom from a grouped map column down to single windows (`src/map.js` already aggregates; it needs the reverse).
- A "before lights-off" two-minute check: record briefly, run the flat-line and hum rules, tell the participant to re-seat the band. The preprint suggests this alone would catch most outright failures. [1]

### Next 3 months

- Share links for checklists: an opt-in public snapshot with a read-only URL, on top of the existing immutable snapshot table, and a small library of starter checklists per headband.
- LLM rule translation, constrained to output the same `{metric, op, value}` JSON that the template parser outputs, with the preview still required before adding.
- BDF and EDF+ annotation support; neighbour-channel correlation as a sixth metric.
- Pilot with two or three home sleep studies. Measure: minutes per morning spent on QC, and how many bad nights get re-recorded the next night instead of discovered at analysis.

### Next 6 months

- Write up the validation against expert-labelled data as a preprint.
- Methods-section text generated from a checklist ("Windows of 5 s were flagged when…"), so the rules a lab used are reported exactly.
- Multi-night trends per participant in the study view (the per-participant rollup already exists in `wear.js`).
- An audit trail of which checklist version graded which file, built on the immutable snapshots that already exist.
- Keep the regulatory position simple: research use only, no diagnostic claims, recordings stay on the user's machine. Revisit only if a partner wants to use it in clinical workflow.

## Sources

1. Parry Y.D., Briganti G. "Signal Quality Screening and Automated Sleep Stage Agreement in Home EEG: A Systematic Comparison of Dreamento and YASA on the Wearanize+ Dataset." medRxiv preprint, June 2026. Usable epochs = std 10–500 µV; OK ≥75%, WARN 50–74%, FAIL <50%; 74/16/10 of 100. https://www.medrxiv.org/content/10.64898/2026.06.01.26354591v1
2. Jas M. et al. "Autoreject: Automated artifact rejection for MEG and EEG data." NeuroImage 159 (2017) 417–429. https://pmc.ncbi.nlm.nih.gov/articles/PMC7243972 · https://arxiv.org/abs/1612.08194
3. EEGLAB 2019.1 release notes (clean_rawdata and ICLabel as default plugins). https://sccn.ucsd.edu/pipermail/eeglabnews/2019/000097.html · ASR in sleep EEG review: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10710985/
4. Bigdely-Shamlo N. et al. "The PREP pipeline: standardized preprocessing for large-scale EEG analysis." Front. Neuroinform. 9:16 (2015). https://www.frontiersin.org/journals/neuroinformatics/articles/10.3389/fninf.2015.00016
5. PyPREP NoisyChannels documentation. https://pyprep.readthedocs.io/en/latest/generated/pyprep.NoisyChannels.html
6. YASA (Vallat). https://github.com/raphaelvallat/yasa · Vallat R., Walker M.P., eLife 2021. https://doi.org/10.7554/eLife.70092
7. Dreem 2 sleep-extension study, medRxiv 2023 (nights with Dreem data quality over 75%). https://medrxiv.org/content/10.1101/2023.06.27.23291956
8. Sleep Review, polysomnography buyer's guide (bedside impedance checks). https://sleepreviewmag.com/sleep-diagnostics/in-lab-tests/polysomnography-guide/
9. Our own evidence notes, `docs/research/evidence.md` (section 1, recommendation R1): a lifted dry electrode gives jittery near-zero signal, not an exactly flat line, so the flat-line metric alone misses it.
