# Spark

Spark brings saved browser context into meeting preparation and follow-through. One Chrome extension combines local notes, reminders and transcript storage with Voice Lab's Nemotron transcription and Kokoro speech. Spark stays closed in the background. With separate provider consent, newly saved context and notes automatically queue analysis through Ambiguous or a connected Codex CLI. A brief page card acknowledges an explicit capture without moving focus. Due reminders use a compact page card where authorized, with native system delivery when the page surface is unavailable. The toolbar popup opens only on request.

## Run locally

Use Node.js 22+ and Chrome 127 or later on macOS.

```sh
npm ci
npm run setup
npm run verify
```

Load this repository's `extension/` folder unpacked at `chrome://extensions`. Setup downloads pinned model and runtime files, checks their hashes and preserves the required licenses. Model files stay outside Git. Later starts load the installed models automatically. See [speech setup](docs/speech-setup.md) for offline checks and repairs. The existing asset importer remains available.

Browser voice responses need no audio driver. For optional virtual microphone setup, run `sh install.sh` in an interactive Terminal. It installs BlackHole when needed and may restart CoreAudio. Driver installation requires administrator credentials. The installer opens the same `extension/` folder.

## Capture, import and follow through

1. On a page, press Command+Shift+Y on macOS or Ctrl+Shift+Y elsewhere. The extension quietly saves the URL, title, selection, available visible text and capture time. Restricted content is marked unavailable. On an authorized web page, a small upper-right card confirms the save and disappears. A live meeting reminder keeps its place if you capture again.
2. Open the compact toolbar popup from the extension icon or Command+Shift+U. Save a note there, check actual job and review counts, or use the meeting controls. Matching slate cards distinguish quiet status, saved digests, review items and reminders. Connections and settings opens the optional full settings/history page. There is no sidebar. Voice Lab remains available for speech transcription. Records are committed to IndexedDB before analysis or synchronization.
3. Save a local meeting reminder, or configure Ambiguous in Settings and import an event or upcoming reminders. Imports preserve the remote event ID, join URL and notes-document association. Refresh explicitly to receive schedule changes. Chrome alarms run from saved reminder times even after sync is turned off, subject to the attention policy below.
4. Mark away and return to preserve absence intervals. Return stops output and invalidates pending synthesis while keeping Voice Lab transcription running.
5. Create task drafts and review selected records before approving and sending a sync batch. Remote tasks and restricted note documents are confirmed by HTTP readback. Optional due dates are checked against the stored date; an omitted date may receive the workspace SLA default.

Enabling reviewed sync does not upload earlier records. Local mode blocks imports, outbound content synchronization and hosted analysis. A request already sent may have reached the provider. An unknown write outcome requires reconciliation before another creation.

## Background reasoning and attention

Automatic reasoning is off initially. In Settings, enable reviewed sync to allow hosted processing, then opt in separately for each provider. Ambiguous also requires its existing hosted-analysis checkbox. Enabling a provider does not enqueue old notes. Newly saved hotkey context and notes are committed locally before jobs are queued. Return or End can queue a brief from saved meeting evidence.

For Codex, start the local bridge described in [local agent setup](docs/LOCAL-AGENTS.md). Click **Connect** in the popup or Settings, enter its private pairing secret, and grant optional access to `http://127.0.0.1:4318`. The capability handshake sends no captured evidence. Then choose the separate Codex automatic-reasoning option. This client supports Codex; other workers are bridge protocol integrations, not selectable extension providers. A CLI running locally still uses hosted inference. Local only denies it.

Jobs retain evidence IDs, consent and connection epochs, dispatch intent, results, and failures in IndexedDB. Codex polling recovers the same job ID after a browser restart. Unknown Assistant outcomes become explicit errors, never automatic replays. Opt-out and cancellation reject late results immediately. Disconnect uses the previous pairing to cancel work already sent. Cancellation control messages may still reach the bridge after switching to Local only; they contain no captured evidence. An unavailable bridge produces a visible cancellation error. Data already sent may have reached the provider.

- Routine status stays in storage, with no badge or notification.
- Useful findings wait in a digest until return or an explicit review.
- Actionable proposals appear as a quiet pending count. Nothing executes automatically.
- A saved meeting that still needs joining can interrupt only within ten minutes of its trusted start time. At most one interruption is delivered per ten minutes; simultaneous reminders coalesce. Shelved items retain their reason and return/request trigger. Provider urgency cannot override this policy.

Completion never opens the popup, Settings, Voice Lab, a page card, or a browser tab. In-page reminders contain generic wording, never private meeting titles or join URLs. Join is resolved inside the extension from the saved meeting record. Pages receive no workspace state or credentials. Navigation revokes the page authorization; an unavailable page surface uses native system delivery without a duplicate card.

## Optional manual hosted analysis

Enter the Ambiguous API key and receiving identity through Settings. The key is stored in trusted Chrome storage, never in the bundle or a page URL. See [workspace setup](docs/AMBIGUOUS.md) for the demo environment and separate workspace identities.

Hosted analysis requires both reviewed sync and **Allow hosted analysis of selected saved evidence**. Manual **Analyze saved note** and **Generate meeting brief** actions require a click. Automatic reasoning requires the additional provider-specific opt-in described above. Note analysis sends the selected note and captured context. Meeting briefs also send associated notes, saved transcripts and absence intervals. Actual responses and evidence IDs persist locally.

The Assistant returns proposals for review. The extension does not execute them or automatically convert them into tasks. The provider API exposes no hard tool restriction for this request; asking for analysis only does not enforce provider permissions. Any returned tool activity is displayed as an error and its proposals are rejected. Provider internal reasoning is not persisted.

## Local audio

Open Voice Lab from the popup or Settings and keep its persistent tab open during capture. Closing the popup or Settings does not stop it. Closing or reloading Voice Lab records an interrupted session, preserves transcripts and permits another capture. A small bottom-left pill appears on an authorized active page only while a live Voice Lab owner reports actual microphone or tab input. It disappears on Stop, even while queued transcription finishes. The validation sample alone does not produce a listening claim.

Choose **Only with the voice hotkey** or **Continuous while enabled** in speech settings. The voice hotkey is Command+Shift+9 on macOS or Ctrl+Shift+9 elsewhere. It starts and stops microphone transcription independently of the page-capture hotkey. Chrome asks for microphone permission on first use. Continuous mode resumes with Chrome while enabled; an explicit Stop stays paused across reloads and restarts. Capture ends on device loss or an explicit error. It does not silently retry a denied microphone.

Nemotron loads on the first capture. Audio enters IndexedDB before one acknowledged decode at a time, and final segments are saved as capture continues. The bundled sample is a separate validation input. Final transcripts can be saved as notes with their original captured context. If a capture faults or its owner closes with pending audio, committed queued PCM remains in local storage and the interrupted session retains its database reference. Recovery of that interrupted backlog is not yet exposed in the UI.

Enable **Read Spark responses with browser Kokoro** to hear requested analyses automatically. Saved responses also have a **Read aloud** button. Background jobs remain quiet until requested. Kokoro loads automatically and plays through browser speakers; turning this option on does not grant hosted reasoning permission. Saved responses can be spoken in Local only. Speech pauses active microphone capture to avoid recording Spark as human evidence, then resumes an enabled continuous microphone. **Stop audio**, opt-out and **Return** cancel pending speech and playback.

For Jitsi, Zoom or another web meeting, invoke the extension icon or page-capture hotkey on the meeting tab first. Choose **Transcribe meeting tab** under the optional meeting controls. Chrome's tab-capture permission remains required. Tab playback captures received audio; it does not include your own microphone. Microphone and tab transcription share one recognizer and cannot run simultaneously.

To route manually entered speech into a meeting, connect BlackHole, select BlackHole 2ch as the meeting microphone and keep meeting speakers on headphones. **Use browser speakers** restores ordinary playback. Reading a saved Spark response selects browser speakers automatically. Re-select the physical meeting microphone to speak yourself. Route selection does not prove another participant heard audio.

The recognizer and voice workers enforce separate WASM memory limits and release after inactivity. Audio-processing contexts remain active until queued decoding or synthesis finishes, then close. Stop releases microphone tracks immediately. These limits cover model linear memory, not the entire Chrome process. Local speech speed depends on the device. Kokoro synthesis can take longer than the audio it produces; its progress and cancellation remain available while it computes.

## Verification and limits

```sh
npx playwright install chromium
npm run verify
npm run test:foundation
npm run test:browser
npm run test:integration
npm run test:speech
npm run test:speech-lifecycle
npm run test:speech-restart
npm run test:proactive
npm run test:concept
npm run test:listening-surface
```

`SPARK_TEST_BRIDGE=1 SPARK_VISIBLE_PROOF=1 npm run test:proactive` additionally exercises real Connect, Codex inference, restart polling and cancellation against the running local bridge. `npm run test:auto-hosted` uses the ordinary Context Scout agent key from an ignored dotenv file to exercise separate automatic consent and the real Assistant route. These checks make real hosted requests. No token or pairing secret is bundled or printed.

The additional `test:demo`, `test:tab-capture` and `test:hosted` commands exercise the new integration. The demo and hosted commands require an authorized `AMBIGUOUS_API_KEY` in the test process and perform real workspace operations. Read [the evidence guide](tests/evidence/README.md) before running them.

The [concept UI receipts](tests/evidence/CONCEPT-UI.md) cover real capture acknowledgement, reminder delivery, page isolation controls, native popup geometry and active-input listening. `npm run verify` also runs the publication gate.

Current and historical checks prove real calendar import, task/note creation and readback, explicitly requested hosted proposals, local-mode network boundaries, and real Jitsi document audio through tabCapture and Nemotron. Earlier audio checks prove real Kokoro synthesis and stale-result cancellation. See [the handoff](docs/EXTENSION-HANDOFF.md) for exact tested scope and hashes.

Historical audio runs include a third-synthesis timeout after Return; see the [matched audio receipt](tests/evidence/concept-audio-baseline.json). The post-hackathon speech branch changes loading, cancellation and worker lifetime. Its current checks and measured operating limits are recorded in [speech verification](docs/speech-verification.md).

Hosted requests can fail independently of local storage; the UI retains an explicit error when that happens. Autonomous Takeover, continuous browser-context capture, physical-microphone mixing and an offscreen audio owner are not implemented. Live participant delivery, physical microphone quality and long meeting workloads remain unverified. The speech checks use recorded audio through real browser media APIs and actual local models; they do not establish accuracy for every microphone, accent or environment. Transcript offsets measure decoded audio and are not aligned to absence wall-clock intervals; the extension cannot attribute missed items to an absence. Local resume links restore only the originating browser's saved context and execute nothing.

Inherited audio work and dependencies remain documented in [migration notes](docs/MIGRATION.md). The [build brief](docs/BRIEF.md) separates the complete intended demo from current evidence, and [submission notes](SUBMISSION.md) track inherited and event-built work.
