# Somnium: talk script

Two versions: the 5-minute live presentation, and a 2-minute script for the recorded video if we make the top 6.

The numbers below came from running the demo files through the real code and clicking the path once in a browser on 17 Oct 2026. Rule counts include the "signal too faint" rule. Do one full dry run right before presenting and fix any number or label that moved.

## Setup before you go on

- Run `npm run serve` and open two tabs: `http://127.0.0.1:8080/app.html` and `http://127.0.0.1:8080/study.html`. Keep `trailer.html` in a third tab as the fallback.
- Browser zoom around 125% so the map squares are readable from the back.
- Turn hardware acceleration on (the app warns if it's off).
- Ignore the "Your account" card at the bottom of `app.html`. We won't sign in live.

## 5-minute version

### 0:00–0:30 · The hook (no screen, or the landing hero)

> You have forty sleep recordings from forty people's bedrooms. Which ones can you trust?
>
> A preprint from this June looked at 100 home recordings from a sleep headband. 74 were fine. 16 were partly bad. 10 failed completely, seven of those flat from the moment recording started. That's one night in four, and usually nobody finds out until the analysis, weeks later.

### 0:30–1:00 · Who has this problem

> Two kinds of people. A study coordinator who mailed out headbands and needs to know, this morning, who to call. And a student or hobbyist with one recording and no idea if it's any good.
>
> The tools that exist, autoreject, EEGLAB, PREP, are good, and they're written for people who code in Python or MATLAB. Our users don't. So we built a checker where they write the rules themselves.

### 1:00–2:45 · Demo 1: one recording (`app.html`)

1. Click **Try the demo recording** (or open `app.html?demo`).
   > This is a made-up recording, but it's built to look like real EEG: background activity, alpha rhythm that drops when the eyes open, blinks. Five minutes, six channels, three faults we planted. It's read in the browser. Nothing is uploaded.
2. Point at the verdict: **This recording is usable**. "Your 5 rules flag 6% of the recording."
   > It starts with a checklist from a lab on 50 Hz power, the European standard. So it has no rule for 60 Hz hum.
3. On the map, click a red square in the **C3** row around 1:30.
   > Every flag has a reason. Here the signal went flat because the sensor lost contact. Underneath it says the same thing in plain words, and shows the raw trace.
4. Click a red square in the **O1** row around 3:30.
   > Big swings, over 600 microvolts. That's the head moving on the pillow.
5. Point at the **Try it** box, then click a square in the **C4** row after 2:30.
   > This one says clean. But look at the trace: thick and fuzzy. Sixty hertz hum makes up 83% of it. This recording was made on 60 Hz power, and the checklist doesn't know about 60 Hz.
6. Drag across the **C4** row from 2:30 to the end. Click **Teach a rule from selection**.
   > I don't need to know the right number. I just drag across the part that looks wrong. Somnium finds the measurement that sets it apart from everything else and suggests a rule: 60 Hz hum above 42%. Before I add it, it shows what it would catch, two and a half minutes on one channel, and tells me it would change the verdict.
7. Optional: change the number in the box and let the preview marks move, then set it back.
   > I can tune it. I could also have typed it, "flag 60 Hz hum above 15%", and got the same kind of preview.
8. Click **Add rule**.
   > The verdict flips to **usable after fixes**, and the line under it names my rule: usable to usable after fixes, 6% to 14% flagged. I taught it something its starting checklist didn't know.
9. Point at **Export**.
   > The checklist is a small file. I can send it to the next student, and they run the same standard.

### 2:45–3:45 · Demo 2: a study (`study.html`)

1. Switch tabs (or click **Apply these rules to a study →**).
   > It says **Using your checklist: 6 rules**. The rule I just taught grades the whole study. The two tabs stay in sync, and **Reset to default** goes back to the built-in checklist.
2. Click **Try a sample study (8 participants)**.
   > Now the coordinator. Eight participants, one night each. These are made-up hour-long nights on the same two forehead channels the ZMax headband uses, with sleep stages, spindles, K-complexes and slow waves, so the faults sit on top of something that looks like sleep.
3. Read the heading: **Follow up with 4 of 8 participants**, and the bar under it: 3 not worn properly, 1 check this one, 4 worn properly.
4. Click the **P04** button under "Who to contact".
   > P04: electrical interference, and the signal was lost from 9 minutes in until the end. Under "Tell them" is what to say, already written. **Copy full message** puts a friendly note on the clipboard.
5. Scroll to **P05** in the "Worn properly" group.
   > P05 passes, but one of the two sensors was bad for half the night. A pass/fail score would hide that.
6. Tick **Only show follow-ups**, then point at **Download as spreadsheet (CSV)**.
   > The cut-offs, 75% clean is fine and under 50% is a fail, come from that preprint.

### 3:45–4:20 · Why this is "meta", and what's new

> The theme is tools that let people build the software they want. Every lab already has quality rules. They live in someone's script or someone's head. Here the expert builds their own checker by saying it, showing it or tuning it. Each rule is plain data over named measurements, never generated code, so every flag traces back to a rule you can read.
>
> We looked at autoreject, EEGLAB's clean_rawdata and ICLabel, PREP, YASA, vendor apps, clinical PSG software. They answer "which epochs do I drop?" None of them we found tell a coordinator who to contact this morning and what to say.

### 4:20–4:50 · What's next

> Honest status: our measurements are simple, and they're not validated yet. In the next two weeks: run them against PyPREP and YASA on a public sleep dataset and publish the agreement, and move file parsing into a Web Worker so a folder of full nights doesn't freeze the page. In three months: shareable checklist links, an LLM that writes rules but only in our rule format, and a pilot with two or three home sleep studies. In six months, a validation preprint and methods-section text generated from your checklist.

### 4:50–5:00 · Close

> Somnium. Write your lab's standard in your own words, and know by breakfast which nights to keep.

### If the live demo breaks

Switch to `trailer.html` and play it (one minute, sound on), then talk over the README screenshots. Don't debug on stage.

## 2-minute version (recorded video)

Screen-record at 1080p with the cursor visible. Voice-over, no face cam needed.

**0:00–0:15** · Landing page first screen: "Can you trust this night of sleep?", slow scroll.
> One home sleep recording in four comes back partly bad or dead. A 2026 study of 100 home headband recordings found exactly that. Somnium checks them in your browser before you analyze anything.

**0:15–0:55** · `app.html?demo`.
- Click a red C3 square.
> Every flag has a reason in plain English. This sensor lost contact.
- Click a C4 square after 2:30. It says clean, but the trace is fuzzy.
> This lab's checklist was written for 50 Hz power. The recording has 60 Hz hum it doesn't catch.
- Drag across C4 from 2:30 to the end, **Teach a rule from selection**, **Add rule**. Hold on the verdict line.
> So I show it. Drag across what looks wrong, Somnium suggests the rule, I add it, and the verdict changes from usable to usable after fixes.

**0:55–1:35** · `study.html`, sample study.
- Show **Using your checklist**, then click **Try a sample study**. Hold on the heading.
> For a study coordinator, the same rules grade every night at once. Four of eight participants need a follow-up.
- Click the **P04** button, then **Copy full message**.
> Here's what went wrong, what to do, and a message for the participant, already written. Nothing is uploaded. It runs on your laptop.

**1:35–2:00** · Back to the checklist file, or the roadmap slide.
> Tools like autoreject and EEGLAB are for people who code. Somnium is for the person who knows what a bad night looks like and wants their own checker. Next: validation against PyPREP and YASA, shared checklist links, and a pilot with real home sleep studies.
