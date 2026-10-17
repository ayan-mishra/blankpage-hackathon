# Judge Q&A prep

Short, honest answers. If we don't know, we say so and say how we'd find out. Code references are there so whoever answers can point at the actual file.

## Neurologist (founder of an EEG/sleep analysis company)

Expect the hardest questions here. Don't oversell.

**How do your metrics compare to established QC like PREP, autoreject or ASR?**
They're simpler. We compute a few things per window per channel (`src/metrics.js`): the longest run of identical samples as a share of the window, peak-to-peak amplitude, excess kurtosis, and the share of variance at exactly 50 Hz and 60 Hz (a single-frequency projection). PREP adds correlation with neighbours, RANSAC prediction and robust referencing. Autoreject learns per-sensor thresholds by cross-validation. ASR reconstructs bad subspaces. We picked metrics a non-expert can read one at a time. What's new in Somnium is who writes the rules and what the output says. We don't claim better detection.

**Is it validated?**
No. That's the first roadmap item. The plan is to run Somnium's flags and PyPREP's noisy-channel output on the same public sleep recordings (Sleep-EDF on PhysioNet is the obvious start), and YASA's artifact rejection on the same nights, then publish agreement per metric, including where we're worse.

**Your flat-line metric counts identical samples. A dry electrode that loses contact often gives low-amplitude noise, not a perfect flat line.**
Right, and the flat-line metric alone would miss that: it only counts exactly repeated samples, and the preprint we cite found failed nights with median std under 1 µV, which is jittery, not constant. So the built-in checklist now has a "signal too faint" rule for contact loss that still sends faint noise. It catches headbands that never touched the skin. The threshold is conservative and still needs tuning on real ZMax or Dreem nights (`docs/research/evidence.md`, R1). Users can tune it by typing, e.g. "flag signal below 3 µV".

**Five-second windows? Sleep is scored in 30-second epochs.**
The single-recording page uses 5 s so short faults show up on the map. The study page uses 10 s. Neither lines up with AASM epochs yet. Making the window length 30 s for sleep data is easy; we'd do it alongside validation so the numbers compare.

**On F7-Fpz and F8-Fpz you'll get eye movements and blinks. Won't kurtosis flag REM as "spikes"?**
It might. We haven't tested on real REM data. That's exactly what validation should show. The user can raise the spikiness threshold or drop that rule, and the per-flag explanation makes it obvious which rule is firing. Cross-channel and EOG-aware checks aren't built.

**How does "Show it" pick a threshold?**
For each metric it compares the windows you selected with everything else. It keeps a metric only if the 25th percentile inside your selection is above the 95th percentile outside, scores the gap, and proposes the midpoint (`proposeRule` in `src/rules.js`). It only proposes "greater than" rules. It's a heuristic from a handful of examples, so it always shows a preview before you add it.

**Where do the 75% / 50% cut-offs come from?**
Parry and Briganti, medRxiv June 2026, on 100 Wearanize+ ZMax recordings: OK ≥75% usable epochs, WARN 50–74%, FAIL <50%. Their "usable" is epoch std between 10 and 500 µV. Ours is "at least half the channels pass the checklist in that window", which is different. We borrowed the bands, not their definition. And it's a preprint.

**Is this for clinical use?**
No. Research QC only. We make no diagnostic claims, and the landing page and README say "not for clinical use".

## Harvard psychology founder (behavioral therapy company)

**How does this improve participant adherence?**
The coordinator learns the next morning that a headband wasn't worn properly, with the likely cause, and gets a short, non-blaming message to send: "Please move chargers and cables away from the bed and put the headband back on." Feedback that arrives the same day and names one specific thing to do is more useful than an email weeks later saying the data was unusable. We haven't measured an adherence effect yet. The pilot would measure re-recorded nights and how many people have repeat failures after getting a message.

**Did you test the message wording with participants?**
No. The messages are fixed text per cause (`src/wear.js`). Testing wording, tone and timing with real participants is part of the pilot. We'd welcome advice on it.

**Coordinators are busy. Will they actually use it?**
The study page is built for a morning routine: drop the night's files, read "Follow up with 4 of 8 participants", click a name, copy the message. No install, no account. The CSV goes into whatever tracking sheet they already keep. Whether it sticks is what the pilot tests.

**Who's the user who knows least?**
The single-recording page assumes no EEG background: every result has an "In plain words" line and there's a glossary. The demo has a three-step "Try it" box that walks you through clicking a square, teaching a rule and watching the verdict change.

## Biotech manufacturing consultant

**What's the data path? Where does patient data go?**
You need an account to use the app. Each analysis, its checklist, and (if "Keep the recording" is on) the EDF itself are stored in Supabase: rows under owner-only row-level security, recordings in a private bucket where each user can only reach their own folder. EDF headers can carry patient identifiers, so for real patient data we'd add de-identification on upload and a data agreement; that's on the roadmap. Saved snapshots can't be edited, only created or deleted.

**Regulatory path?**
Today it's a research tool and we keep it that way: no diagnosis, no treatment decisions, recordings stay local. If a sponsor wanted it inside a regulated trial workflow, we'd need things we don't have yet: an audit trail of which checklist version graded which file, documented validation, and change control. The immutable checklist snapshots are a start on the first. We'd get proper regulatory advice before making any clinical claim.

**How do you know the software does what it says?**
44 automated unit tests and 12 browser tests (all passing as of 17 Oct 2026). The unit tests cover the EDF parser, metrics, rule engine, wear grading, map geometry, checklist validation, the demo signals, and the database migration with its access policies. The browser tests cover the account flow, teaching a rule on the demo, and a rule from `app.html` grading the sample study. That's QA for a prototype, not a validated system.

**Can it scale to a multi-site study?**
Processing is per file on the user's machine, so there's no server cost per recording. An 8-hour, 6-channel night is measured in about a quarter of a second on our laptop, so a site's worth of nights takes seconds. The limit is the person's browser, not us. Multi-site rollups would need shared checklists and a shared results view, which are on the 3- and 6-month roadmap.

## Founder of a LinkedIn alternative

**How do checklists spread? What's the network?**
Today a checklist is a JSON file you export and send. Anyone can import it into the app, and imports are validated. Next is an opt-in share link for a saved snapshot and a small public library of starter checklists per headband. The bet is that a lab's checklist becomes something it cites in a methods section and other labs reuse, the way people share analysis configs now.

**Why would someone share their lab's rules?**
Reproducibility. A methods section that says "we used checklist X, version Y" is easier to defend than "we removed bad epochs". Sharing stays opt-in, because some labs will treat their rules as internal.

**Who pays?**
Not settled. Our guess: free for individuals and single recordings; paid for study teams that want shared checklists, multi-site views and audit history. We haven't tested pricing.

**What's your distribution plan?**
Start where the pain is: coordinators running home headband studies and the labs that publish with ZMax-type headbands. Then the open-source EEG crowd, through a validation write-up they can check. We'd rather be cited than advertised.

## Questions any judge might ask

**Why the browser instead of a Python package?**
Our users don't run Python. A web page means no install and no upload, which is also why the privacy answer is simple.

**Couldn't an LLM just write the QC code?**
It could, and nobody without coding skills could check it. We keep rules as plain data over named metrics, so every flag points at a rule you can read and edit. An LLM step is on the roadmap, but it will output that same rule format and still show a preview.

**What's real and what's demo data?**
The parser, metrics, rules, map and study grading are real and work on any 16-bit EDF. The demo recording and the 8-person sample study are synthetic, with planted faults, and seeded so the demo is the same every time (`src/demo.js`). They're built to look like real EEG: 1/f background, alpha that blocks when the eyes open, blinks, and on the sample nights sleep stages with spindles, K-complexes and slow waves. We haven't run it on a real study yet.

**What's the weakest part right now?**
No validation. That's the first item for the next two weeks. The threshold on the new "signal too faint" rule also needs tuning on real headband nights.

**What did AI do vs. you?**
We built it with AI coding agents. A free DeepSeek model drafted the EDF parser and metrics through our delegation runner; Claude Code and Codex did most of the rest. We reviewed the code and tests, and checked the claims against the papers.
