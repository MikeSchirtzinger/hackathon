# Combined extension handoff

Branch: `feat/extension-foundation`. Base: `bf79f61` (`origin/main`). First foundation checkpoint: `7cd9293`.

RESULT: PARTIAL. Draft integration is ready for code review. Long audio integration checks are still being completed.

## One extension

Run `npm ci`, import local assets with `node scripts/import-assets.mjs /path/to/source/extension`, and run `npm run prepare:assets` then `npm run verify`. Load this repository's `extension/` folder unpacked. The installer and all browser checks use that same manifest. Build outputs are under `extension/foundation/`. There is no separate dist manifest.

The inherited persistent Voice Lab tab owns its workers, capture, and output. The side panel handles local context, notes, reminders, review, and sync settings. Real transcript events pass through versioned runtime messages into IndexedDB, with tab and document ownership validation. PCM stays on the inherited worker/audio queue path.

## Evidence so far

- `npm run verify`: TypeScript, six focused tests, combined build, JavaScript/shell syntax, and 362 installed model assets passed before final draft changes.
- `npm run test:browser`: the inherited 40-second real IndexedDB queue check and actual Nemotron decoding passed on the combined manifest. The replacement clip text begins "After early nightfall". Original hackathon audio was unavailable; provenance and CC BY 4.0 credit are in `docs/TEST-CLIP.txt`.
- `npm run test:integration`: actual UI sample decoding persisted into the side panel and survived reload. Real Kokoro output was discarded after Stop audio. A fresh explicit request generated audio afterward. The Return cancellation check failed and is being rerun after replacing URL-filtered tab discovery with the extension context inventory. Lifecycle checks follow it.
- `npm run test:foundation`: original foundation passed 13 browser checks. Combined rerun found a root-icon URL regression after nesting the worker. `chrome.runtime.getURL('icon.png')` fixes the packaging; the real notification assertion remains and is being rerun.

Current local reports and inspected screenshots are under `.evidence/checkpoint/` and `.evidence/audio-integration/`. Historical premerge foundation evidence is `docs/evidence/foundation-browser.json`. Final merged reports will be recorded separately.

Local Chrome used for these checks:

```sh
export CHROME_PATH='/Users/mike/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
npm run test:foundation
npm run test:browser
npm run test:integration
```

Without CHROME_PATH, install the Playwright browser with `npx playwright install chromium`.

## Scope and limits

No autonomous reasoning or Takeover authority is configured. No live Zoom/BlackHole delivery is claimed. The test does not connect a virtual microphone or send speech to another participant. Transcript offsets are decoded audio offsets, not aligned absence timestamps.

The Ambiguous REST adapter and reviewed outbox use the public schema. External create/readback is unverified, with no configured identity or approved live records. Local mode sends no captured content and does not silently enqueue earlier private history. Unknown write outcomes require reconciliation before another create.

Audio lifecycle recovery checks stored tab/document ownership at worker startup and before a new capture. A lost owner becomes an interrupted record; transcripts are retained. Pending verification covers reload, close, and browser restart recovery. Worker exceptions now update capture state as well as the audio UI.

Assets were reconstructed by the main agent and copied read-only from `/Users/mike/.cache/hackathon-audio-assets-20260912/source/extension`. Source URLs and SHA256 receipts are in `docs/evidence/audio-download-receipts.json`. Runtime/model license files and the NVIDIA notice remain with the imported assets and are checked by `npm run verify`.
