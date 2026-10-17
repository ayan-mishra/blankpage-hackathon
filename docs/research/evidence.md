# Somnium: evidence for the pitch

Checked 17 Oct 2026. Every number has a link. Anything I could not open myself this session is marked **[unverified]**. Somnium code was read but not changed.

> **3 stats for the slide**
>
> 1. **About 1 night in 4 is lost.** In an 8-night home study with the Dreem headband, 110 of 419 nights (26%) failed the quality threshold and were dropped. [Qin et al., *Sleep* 2025](https://academic.oup.com/sleep/article/49/3/zsaf329/8296979)
> 2. **Most failures were obvious from the first minute.** Of 100 home ZMax recordings, 16 were degraded and 10 failed. 7 of the 10 failures had near-zero signal from the start, and the authors say a check before lights-off "would likely prevent the majority of recording failures". [Parry & Briganti, medRxiv preprint, June 2026](https://www.medrxiv.org/content/10.64898/2026.06.01.26354591v1)
> 3. **Fast feedback changes behaviour.** In an RCT of 556 CPAP patients, nightly telemonitoring with automated feedback messages raised adherence from 53.5% to 65.6%, and to 73.2% when combined with education. [Hwang et al., *AJRCCM* 2018](https://doi.org/10.1164/rccm.201703-0582oc)

---

## 1. Metrics and default thresholds vs. the literature

What the code does. It uses 5 s windows on the single-recording page (`app.js`) and 10 s windows on the study page (`study.js`). `DEFAULT_CHECKLIST` in `src/rules.js` has five rules:

| Somnium metric (code) | Somnium default | What established tools use | Verdict |
|---|---|---|---|
| `flat` = longest run of exactly identical consecutive samples ÷ window length | > 50% of the window (2.5 s at 5 s, 5 s at 10 s) | EEGLAB `clean_rawdata` FlatlineCriterion **5 s** ([source](https://github.com/sccn/clean_rawdata/blob/master/clean_artifacts.m)). PyPREP flat = 1e-15 V ([docs](https://pyprep.readthedocs.io/en/latest/generated/pyprep.NoisyChannels.html)). MNE `flat` example: peak-to-peak **< 1 µV** ([tutorial](https://mne.tools/stable/auto_tutorials/preprocessing/20_rejecting_bad_data.html)). Parry & Briganti: epoch std **< 10 µV** = flat / contact failure. | **Duration is fine** (it matches clean_rawdata). **Gap:** it only catches digitally constant output. A dry electrode that lifts off skin gives a jittery near-zero signal (Parry: failed nights had median std < 1 µV), and that changes the 16-bit samples, so `flat` never fires. See recommendation R1. |
| `ptp` (peak-to-peak, µV) | > 300 µV | MNE tutorial `reject` example: **100 µV** ("dataset- and hardware-dependent"). Parry & Briganti: epoch **std > 500 µV** = artefact (std, which is much stricter to exceed than ptp). AASM: N3 slow waves are ≥ 75 µV peak-to-peak frontally, and large ones in young sleepers can exceed 200 µV **[unverified: AASM manual is paywalled]**. | **Defensible for sleep.** 100 µV is an awake ERP value and would flag healthy slow-wave sleep. 300 µV sits between that and Parry's limit. Risk: forehead montages (F7-Fpz, Fp1) pick up eye movements of hundreds of µV, so expect some false flags in REM. See R2. |
| `kurtosis` (excess, absolute) | > 8 | FASTER and EEGLAB-style rejection use **relative** z-scores of kurtosis and variance, not absolute values ([Nolan et al. 2010](https://doi.org/10.1016/j.jneumeth.2010.07.015); the commonly cited ±3 SD cut-off is **[unverified]**, full text not opened). YASA `art_detect` uses a z-score of **3** on log std per sleep stage, with 5 s windows ([docs](https://yasa-sleep.org/generated/yasa.art_detect.html)). | **Usable heuristic, non-standard.** Excess kurtosis of 8 is far from Gaussian (0), so it only catches sharp transients. Real spindles and K-complexes raise kurtosis too. Because it is absolute, it can't adapt to each person. See R3. |
| `line50` / `line60` = share of window variance in the exact 50/60 Hz DFT bin | > 20% | `clean_rawdata` LineNoiseCriterion: **4 SD** relative to the other channels. PyPREP HF-noise z > **5**. Both are relative. | **Lenient but defensible.** 20% of all variance in one sinusoid is gross hum, and anything flagged is real. It will miss moderate hum. Many headbands notch-filter on board, so the rule may rarely fire. With 2 channels a relative criterion isn't possible, so absolute is a reasonable MVP choice. See R4. |
| Window length | 5 s / 10 s | YASA `art_detect` default **5 s**. AASM scoring epoch is 30 s (Parry used 30 s). `clean_rawdata` scans windows of ~1 s. | **Defensible.** |
| Night is "good" in a window if ≥ half the channels are clean | n/a | The Dreem PSG validation builds a "virtual channel" from the best-quality frontal channel in each epoch, excluding only windows where every channel is bad (2.1% of windows) ([Arnal et al., *Sleep* 2020](https://academic.oup.com/sleep/article/43/11/zsaa097/5841249)). | **Defensible.** It is the same idea, and Somnium also reports a sensor that fails on its own. |
| `verdict()` usable < 10% bad, "after fixes" < 30% | 10% / 30% | No literature source found. | **Author-chosen.** Say so if asked. |
| Wear status OK ≥ 75%, check 50–74%, bad < 50% | 75 / 50 | See section 2. | **Source verified.** The definition of "clean" differs from the source's. |

General point for the neurologist judge: the reference pipelines (PREP, `clean_rawdata`/ASR, FASTER, autoreject, ICLabel) are built for multi-channel lab caps. Most of their criteria are relative (z-scores across channels, channel correlation, RANSAC, ICA). With 1–2 forehead channels those methods mostly don't apply. ICLabel needs ICA on many channels. autoreject works on MNE `Epochs` and learns per-channel peak-to-peak thresholds by cross-validation ([docs](https://autoreject.github.io/stable/index.html), [Jas et al. 2017](https://arxiv.org/abs/1612.08194)). Absolute, inspectable thresholds are the honest choice for 2-channel headbands, and that is a talking point.

### Recommendations (not applied; code untouched)

- **R1 (the only real gap): add a low-amplitude rule.** No new code is needed, because `ptp` already supports `<`. Add `{ id: 'dead', name: 'Dead signal', metric: 'ptp', op: '<', value: 5 }` to `DEFAULT_CHECKLIST`, with cause `contact`. The 5 µV value is conservative: it sits between MNE's 1 µV and Parry's std-10 µV (roughly 40–60 µV ptp), which would flag low-amplitude REM/wake. Tune it on the demo files and one real ZMax/Dreem night. Without it, the main home failure mode (electrode never seated, near-zero but noisy) can be graded "Worn properly". Note: `rules.js` gives each metric one `cause`, so `ptp` maps to `loose`. A dead-signal rule would report the wrong cause unless the cause is picked per rule or per direction.
- **R2:** Keep 300 µV. Consider 400–500 µV for forehead (Fp/F7-Fpz) devices, or ship a per-device checklist preset.
- **R3:** Longer term, make spikes relative: z > 3 against the same channel's windows that night, as YASA does.
- **R4:** Optionally lower hum to 0.1, and only enable the local mains frequency (50 Hz EU/Asia, 60 Hz Americas) so one rule doesn't silently do nothing.

---

## 2. Source of the 75% / 50% wear cut-offs: verified

- **Source:** Parry Y.D., Briganti G. "Signal Quality Screening and Automated Sleep Stage Agreement in Home EEG: A Systematic Comparison of Dreamento and YASA on the Wearanize+ Dataset." medRxiv, posted 3 June 2026, **not peer reviewed**. [Link](https://www.medrxiv.org/content/10.64898/2026.06.01.26354591v1). I read the PDF text directly.
- **Methods 2.2 (verified):** left ZMax channel F7-Fpz, 30 s epochs. Std < 10 µV = flat, std > 500 µV = artefact, 10–500 µV = usable. Subjects are flagged **OK (≥ 75%), WARN (50–74%), FAIL (< 50%)** by the share of usable epochs.
- **Results (verified):** 74 OK, 16 WARN, 10 FAIL out of 100. In FAIL, 7 were near-dead from onset, 2 lost signal mid-night and 1 had persistent artefact. The distribution was bimodal ("either succeeds or fails").
- **Caveats to say out loud:**
  - The 75/50 bands carry **no citation** in that paper. They are the authors' own choice.
  - Somnium uses the bands with a **different** definition of "clean": checklist rules on 10 s windows and ≥ half of channels, not std 10–500 µV on one channel. The bands are borrowed; the metric is not.
- **Suggested study.html wording** (replacing "These are the same cut-offs a 2026 home-sleep study used."):
  > We borrowed these bands from a 2026 study of 100 home headband recordings (Parry & Briganti, medRxiv preprint, not yet peer reviewed). That study measured "clean" differently, so treat the bands as a starting point you can change.

---

## 3. Why it matters: home data loss and cost

- **26% of home nights dropped (Dreem, older adults).** 49 participants, 8 nights each: 419 nights recorded, 110 discarded (quality index < 80% or > 20% off-head), 7 more for other reasons, 302 (72%) kept. [Qin et al., *Sleep* 49(3), 2025](https://academic.oup.com/sleep/article/49/3/zsaf329/8296979)
- **26% degraded or failed, 10% total loss (ZMax, home).** [Parry & Briganti 2026](https://www.medrxiv.org/content/10.64898/2026.06.01.26354591v1), preprint.
- **Even in a sleep lab, fit fails.** Waveband in-lab multicenter study: 3 of 44 nights (6.8%) excluded for low quality, attributed to "poor fitment, usually due to improper band size adjustment". [Frati Savietto et al., *Sleep* 2026](https://academic.oup.com/sleep/article/49/7/zsag069/8554146). Dreem in-lab: 2.1% of windows unusable on all channels. The authors expected home quality to be worse "due to the negligence of the subject". [Arnal et al. 2020](https://academic.oup.com/sleep/article/43/11/zsaa097/5841249)
- **Unattended clinical sleep studies:** repeat rates for signal loss of "5 and 20%" across authors. This comes from a secondary summary in a Brazilian unattended-PSG paper; I did not open the primary. **[unverified]**
- **Cost of a night:**
  - 2026 Medicare national payment is about **$674** for in-lab diagnostic PSG (CPT 95810) and about **$103** for a home sleep apnea test (95806). Source: [Cadwell 2026 table](https://www.cadwell.com/wp-content/uploads/2026/03/Cadwell-Medicare-Reimbursement-2026-SLEEP-web.pdf), a vendor summary of the CMS fee schedule; check the [CMS PFS lookup](https://www.cms.gov/medicare/physician-fee-schedule/search) before quoting.
  - **I found no peer-reviewed per-night cost for a lost research night.** The honest framing is that a lost night costs a re-run night, staff time and participant burden. Qin et al. had to offer extension nights (up to 12) to make up losses.

---

## 4. The niche: who else does pre-analysis QC

| Tool | What it does | Gap relative to Somnium |
|---|---|---|
| EEGLAB `clean_rawdata`/ASR, ICLabel | Channel and burst cleaning for lab caps | MATLAB. Relative criteria need many channels. |
| PREP / PyPREP | Standardised bad-channel detection | Python. Built for dense caps (correlation, RANSAC). |
| MNE `reject`/`flat`, `annotate_amplitude`, autoreject | Thresholds on epochs, learned thresholds | Requires coding. Not sleep-specific. |
| [YASA](https://yasa-sleep.org/generated/yasa.art_detect.html) `art_detect` | Sleep artefact detection (z-score, per stage) | Python library. No participant-facing output. |
| [Automagic](https://doi.org/10.1016/j.neuroimage.2019.06.046) (Pedroni et al. 2019) | Rates datasets with **user-set quality cut-offs** (README) | Closest precedent for "your own rules". MATLAB GUI for lab EEG, not home sleep. |
| [Luna](https://github.com/remnrem/luna-base) (sleep EEG toolkit) | Scriptable epoch masks and artefact checks for sleep | Command line. Researchers only. Specific commands not re-verified. |
| Vendor tools ([Beacon Pal for Dreem 3S](https://beacon.bio/dreem-3s/), Dreem quality index) | Checks headband placement "prior to data collection" in real time | Proprietary. One device only. Rules are not inspectable. |

- **Honest gap statement:** I found no tool that combines all of these: **runs in the browser, works with any device's EDF export, uses no-code inspectable rules, and gives per-participant follow-up text for a study coordinator.** That combination is the niche. Individually, every piece exists somewhere.
- **Somnium's own gaps (say them before a judge does):**
  - Not validated against expert labels or PREP.
  - No impedance data.
  - 16-bit EDF only.
  - Absolute thresholds.
  - The dead-signal blind spot (R1).
  - The participant message has not been tested for any effect on adherence.

---

## 5. The behavioural angle (for the psych judge)

- **Automated nightly feedback improves adherence (RCT):** Tele-OSA, n = 556 on CPAP. Telemonitoring with automated feedback messages raised 90-day use from 3.8 to 4.4 h/night and Medicare adherence from 53.5% to 65.6% (73.2% with education). [Hwang et al. 2018](https://doi.org/10.1164/rccm.201703-0582oc)
- **Daily data review plus a phone call when there's a problem (RCT):** n = 75. Mean PAP use was 191 vs 105 min/day at 3 months. [Fox et al., *Sleep* 2012](https://doi.org/10.5665/sleep.1728). This is the Somnium workflow: the device data is reviewed, and the coordinator calls when something is wrong.
- **Patient-facing app feedback (large but observational):** 128,037 patients. Adherence was 87.3% with app engagement vs 70.4% with usual care (propensity-matched, retrospective, ResMed authors). [Malhotra et al., *Chest* 2018](https://doi.org/10.1016/j.chest.2017.11.005)
- **Simple messages work across chronic disease:** a meta-analysis of 16 RCTs found that text messaging roughly doubled the odds of medication adherence (OR 2.11, 95% CI 1.52–2.93), though adherence was mostly self-reported. [Thakkar et al., *JAMA Intern Med* 2016](https://doi.org/10.1001/jamainternmed.2015.7667)
- **Direct precedent in home EEG:** Qin et al. checked Dreem data daily and called participants when quality was below 80%, offering extra nights. They did **not** measure whether the calls helped. Parry & Briganti argue that a pre-lights-off check would prevent most failures.
- **Nuance a psychologist will appreciate:** feedback is not automatically good. Kluger & DeNisi's meta-analysis found feedback interventions improve performance on average, but about a third of them made it worse. Feedback aimed at the task ("reseat the strap") does better than feedback aimed at the person. [Psych Bull 1996](https://doi.org/10.1037/0033-2909.119.2.254). The effect size (d ≈ 0.41) and the one-third figure are from memory; the abstract could not be fetched. **[unverified]** That is why Somnium's message names one concrete action and doesn't grade the person.
- **Honest gap:** I found **no trial of next-morning signal-quality feedback for home EEG specifically.** The evidence comes from PAP and medication adherence. Pitch it as "transfer from well-tested adherence interventions", not as proven for EEG.
