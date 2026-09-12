# Combined extension handoff

PR: https://github.com/MikeSchirtzinger/hackathon/pull/1

Branch: `feat/extension-foundation`. Base: `bf79f61945cedbf18eaa061a753c09b548a8ee57`. First local checkpoint: `7cd9293`. Combined draft checkpoint: `ffa49ae`.

RESULT: PASS for the combined local foundation and audio integration. Overall autonomous meeting demo: PARTIAL.

## One install and load path

```sh
npm ci
node scripts/import-assets.mjs /path/to/source/extension
npm run prepare:assets
npm run verify
```

Load this repository's `extension/` folder unpacked. The installer and every browser check use that manifest. `npm run build` writes to `extension/foundation/` and preserves the inherited runtime, models, installer, and asset tools. There is no separate dist manifest.

Voice Lab owns its workers and audio in a persistent tab. The side panel owns context, notes, reminders, review, and sync settings. Real transcript events are validated against the owning tab/document and committed to IndexedDB. PCM remains on the inherited worker/audio queue path. Keep Voice Lab open during capture.

## Reproduce the measured checks

```sh
export CHROME_PATH='/Users/mike/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
npm run verify
npm run test:foundation
npm run test:browser
npm run test:integration
```

Without CHROME_PATH, install the Playwright browser with `npx playwright install chromium`.

| Command | Observed result | Evidence |
|---|---|---|
| `npm run verify` | TypeScript, six focused tests, build, JavaScript/shell syntax, and 362 installed model assets passed | Source checks in `scripts/verify.mjs` and `tests/*.test.ts` |
| `npm run test:foundation` | 13 real-browser checks passed, including native hotkey context, persistence, actual notification, local network observation, rollback, and restart | `docs/evidence/merged-foundation-browser.json` |
| `npm run test:browser` | Real 40-second FIFO audio queue and Nemotron recognition passed | `docs/evidence/inherited-audio-browser.json` |
| `npm run test:integration` | Eight checks passed: same-extension audio workspace, real ASR persistence, Stop cancellation, fresh Kokoro output, Return cancellation with usable ASR, reload, close, and browser restart recovery | `docs/evidence/merged-audio-integration.json` |

The integration run reused Voice Lab with a URL fragment and observed its stop events with no pending speech request after Return. It then verified the late real Kokoro result was discarded and decoded another real clip with the existing ASR worker. Ownership lifecycle fixtures exercise durable begin state without a cleanup callback; they never stand in for successful audio or synthetic transcripts.

The first combined foundation run found a notification icon resolved under `foundation/`. It now uses the root URL; the passing network receipt shows `/icon.png`. The first Return run found URL-filtered `tabs.query` returned no Voice Lab tab. The live comparison in `docs/evidence/owner-discovery.json` found the actual tab via `runtime.getContexts`. Discovery and recovery now match the canonical audio document path, allowing query/fragment changes without adding tabs permission.

Browser screenshots were visually inspected: `.evidence/checkpoint/notes-persisted.png`, `.evidence/checkpoint/meeting-ended.png`, `.evidence/checkpoint/settings-local.png`, `.evidence/audio-integration/transcript-persisted.png`, and `.evidence/audio-integration/kokoro-real-output.png`. Historical premerge evidence remains in `docs/evidence/foundation-browser.json`.

## Assets and provenance

Assets were reconstructed from pinned official releases. Read-only copies were imported from `/Users/mike/.cache/hackathon-audio-assets-20260912/source/extension`. Exact source URLs and SHA256 receipts are in `docs/evidence/audio-download-receipts.json`. The runtime/model licenses and NVIDIA notice remain with the imported assets and are checked by `npm run verify`.

The original hackathon audio was unavailable. The real replacement LibriSpeech clip and CC BY 4.0 credit are documented in `docs/TEST-CLIP.txt`. Both ASR checks use its actual reference text. Model/runtime assets remain ignored by Git; public asset distribution is not completed.

## Remaining integration gaps

No autonomous reasoning or Takeover authority is configured. No live Zoom/BlackHole delivery is claimed. The browser tests do not connect a virtual microphone or send speech to another participant. Transcript offsets are decoded-audio offsets, not aligned absence timestamps; no generated catch-up or action-item summary is claimed.

The Ambiguous REST adapter and durable reviewed outbox use the public schema. External create/readback remains unverified because no identity or approved live records were provided. No captured content was sent. Local mode stops new and queued sends; an unknown write outcome requires reconciliation before another create.

