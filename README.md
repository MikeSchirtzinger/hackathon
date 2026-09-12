# Brevity hackathon

Context Carry brings saved browser context into meeting preparation and follow-through. One Chrome extension combines local notes, reminders and transcript storage with Voice Lab's Nemotron transcription and Kokoro speech. Optional Ambiguous integration imports calendar events, syncs selected notes and tasks, and analyzes saved evidence when requested.

## Run locally

Use Node.js 22+ and Chrome on macOS.

```sh
npm ci
node scripts/import-assets.mjs /path/to/existing/extension
npm run prepare:assets
npm run verify
```

Load this repository's `extension/` folder unpacked at `chrome://extensions`. This is the only install and load path. The build preserves imported models, runtime files, licenses and notices. Those assets are ignored by Git; a fresh clone requires an asset bundle. Public asset distribution remains unfinished.

For virtual microphone setup, run `sh install.sh` in an interactive Terminal. It installs BlackHole when needed and may restart CoreAudio. Driver installation requires administrator credentials. The installer opens the same `extension/` folder.

## Capture, import and follow through

1. On a page, press Command+Shift+Y on macOS or Ctrl+Shift+Y elsewhere. The extension quietly saves the URL, title, selection, available visible text and capture time. Restricted content is marked unavailable.
2. Open the side panel from the toolbar or Command+Shift+U. Save a note locally or use Voice Lab for speech transcription. Records are committed to IndexedDB before analysis or synchronization.
3. Save a local meeting reminder, or configure Ambiguous in Settings and import an event or upcoming reminders. Imports preserve the remote event ID, join URL and notes-document association. Refresh explicitly to receive schedule changes. Chrome alarms run from saved reminder times even after sync is turned off.
4. Mark away and return to preserve absence intervals. Return stops output and invalidates pending synthesis while keeping Voice Lab transcription running.
5. Create task drafts and review selected records before approving and sending a sync batch. Remote tasks and restricted note documents are confirmed by HTTP readback. Optional due dates are checked against the stored date; an omitted date may receive the workspace SLA default.

Enabling reviewed sync does not upload earlier records. Local mode blocks imports, outbound content synchronization and hosted analysis. A request already sent may have reached the provider. An unknown write outcome requires reconciliation before another creation.

## Optional hosted analysis

Enter the Ambiguous API key and receiving identity through Settings. The key is stored in trusted Chrome storage, never in the bundle or a page URL. See [workspace setup](docs/AMBIGUOUS.md) for the demo environment and separate workspace identities.

Hosted analysis requires both reviewed sync and **Allow hosted analysis of selected saved evidence**. Each **Analyze saved note** or **Generate meeting brief** action then requires a click. Note analysis sends the selected note and captured context. Meeting briefs also send associated notes, saved transcripts and absence intervals. Actual responses and evidence IDs persist locally.

The Assistant returns proposals for review. The extension does not execute them or automatically convert them into tasks. The provider API exposes no hard tool restriction for this request; asking for analysis only does not enforce provider permissions. Any returned tool activity is displayed as an error and its proposals are rejected. Provider internal reasoning is not persisted.

## Local audio

Open Voice Lab from the side panel and keep its persistent tab open during capture. Closing the side panel does not stop it. Closing or reloading Voice Lab records an interrupted session, preserves transcripts and permits another capture.

For microphone transcription, load Nemotron and use Record. The bundled sample is a separate, labeled validation input. Final transcripts can be saved as notes with their original captured context.

For Jitsi, Zoom or another web meeting, invoke the extension icon or capture hotkey on the meeting tab first. Open meeting audio from the side panel, then choose **Load Nemotron & listen to meeting** in Voice Lab. Chrome's real tab-capture permission remains required. Tab playback captures received audio; it does not include your own microphone.

For manual speech output, connect BlackHole, select BlackHole 2ch as the meeting microphone and keep speakers on headphones. Load Kokoro and generate speech from entered text. **Stop audio** and **Return** invalidate pending speech as well as stopping playback. Re-select the physical microphone to speak yourself. Route selection does not prove another participant heard audio.

## Verification and limits

```sh
npx playwright install chromium
npm run verify
npm run test:foundation
npm run test:browser
npm run test:integration
```

The additional `test:demo`, `test:tab-capture` and `test:hosted` commands exercise the new integration. The demo and hosted commands require an authorized `AMBIGUOUS_API_KEY` in the test process and perform real workspace operations. Read [the evidence guide](tests/evidence/README.md) before running them.

Current checks prove real calendar import, task/note creation and readback, explicitly requested hosted proposals, local-mode network boundaries, and real Jitsi document audio through tabCapture and Nemotron. Earlier audio checks prove real Kokoro synthesis and stale-result cancellation. See [the handoff](docs/EXTENSION-HANDOFF.md) for exact tested scope and hashes.

Hosted requests can fail independently of local storage; the UI retains an explicit error when that happens. Autonomous Takeover, continuous browser-context capture, physical-microphone mixing and an offscreen audio owner are not implemented. Live participant delivery and sustained meeting throughput remain unverified. Transcript offsets measure decoded audio and are not aligned to absence wall-clock intervals; the extension cannot attribute missed items to an absence. Local resume links restore only the originating browser's saved context and execute nothing.

Inherited audio work and dependencies remain documented in [migration notes](docs/MIGRATION.md). The [build brief](docs/BRIEF.md) separates the complete intended demo from current evidence, and [submission notes](SUBMISSION.md) track inherited and event-built work.
