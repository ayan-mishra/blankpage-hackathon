# Somnium

**Describe your standard. See what passes.**

Somnium is a browser-based trust check for EEG recordings, built for new researchers and home-sleep data.
Drop in an EDF file and get a channel × time map of what's usable, with plain-English evidence for every flag.
The meta part: you write the quality rules yourself, three ways, and save them as a shareable checklist.

- **Say it**: type "flag 60 Hz hum above 15%" and preview what it would flag.
- **Show it**: drag across a region you consider bad; Somnium proposes the metric and threshold that separate it from the rest.
- **Tune it**: edit metric, direction and threshold with a live preview.

Everything runs in the browser. Nothing is uploaded.

## Run

```
npm run serve   # http://localhost:8080
npm test
```

No build step. Click "Try the demo recording" for a synthetic file with three known faults.

## How it works

| File | Role |
|---|---|
| `src/edf.js` | 16-bit EDF parser |
| `src/metrics.js` | per-window flatline, peak-to-peak, kurtosis, 50/60 Hz share |
| `src/rules.js` | rules as plain data over those metrics, plain-language parser, "show it" proposal, verdict |
| `src/app.js` | UI |

Rules are data over five documented metrics, never generated code, so every flag can be inspected.

## Limits (MVP)

- 16-bit EDF only (no BDF/FIF yet); metrics are per channel, no cross-channel checks.
- Plain-language parsing uses templates; an LLM translation step is the planned upgrade.
- "Show it" thresholds are proposals from few examples. Check the preview before adding.
- Not validated against PREP/PyPREP yet, and not for clinical use.

## Roadmap

Shared checklist library, BDF/FIF support, neighbor-channel correlation, LLM rule translation, methods-section text generated from a checklist.

`src/edf.js` and `src/metrics.js` were drafted by a free DeepSeek worker via OpenSlave, then reviewed and fixed here.
