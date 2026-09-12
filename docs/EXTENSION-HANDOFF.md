# Extension integration handoff

Branch: `feat/concept-ui`. Starting base: `28bb62f69d70a01d6d30d66797650719ab988f51`. Integrated publication base: `f96328cc9710f85e212f5bf1e13fefd3b3894ae2`. This change adds compact concept-matched cards while preserving the background providers, inherited audio pipeline, calendar import, reviewed writes and local records.

## Current behavior

Spark runs closed in the background. The manifest has no sidebar permission or side-panel configuration. The toolbar and Command+Shift+U open a compact popup on request. Deeper setup and saved history use Chrome's options page. Voice Lab remains a persistent, explicitly opened audio tab.

Command+Shift+Y commits current-page context before showing a brief upper-right acknowledgement without focus movement. Acknowledgements disappear and cannot replace a live interrupt. The popup and optional review page use the same slate cards, muted text, colored status chips and reduced-motion support. Counts and meeting actions come from saved records. Notes, captured context and meeting evidence at Return or End queue reasoning only after separate provider auto-reasoning opt-in. Ambiguous additionally requires its existing hosted consent and configured key. Connected Codex requires the fixed localhost bridge and explicit pairing. Both providers use hosted processing and are denied in Local only. Connecting sends a capability request without captured evidence; pending cancellation may send a control message after opt-out.

Jobs persist evidence, stable IDs, dispatch intent, consent and connection epochs, polling limits, actual results and explicit failures. Model calls run outside the global mutation queue. Codex resumes polling an existing job after browser restart. Unknown Assistant outcomes are retained as errors without automatic replay. Disconnect snapshots the previous pairing for cancellation before clearing it. Late results cannot restore acceptance after revocation.

The attention controller owns notifications. Routine on-request notes stay status-only. Useful findings wait in a digest. Actionable proposals appear as a quiet pending count. Only a still-scheduled saved meeting with an imminent trusted start time can earn an interrupt. The budget allows at most one per ten minutes, coalesces simultaneous reminders, clears standing notifications and retains every shelved reason and resurface trigger. Agent urgency cannot bypass the budget. Completion never opens UI. Due reminders use a generic card on the authorized active document, or native system delivery when no page surface can render. The budget is shared across both delivery paths; they do not send duplicate alerts.

The page card is an extension-origin frame in an isolated closed shadow root. A private nonce binds it to its parent tab and document, then to its own frame document. It has no page-message bridge and cannot read state, credentials or invoke general writes. Only trusted clicks on its offered actions reach the scoped handler. The worker resolves Join from the saved meeting, without exposing private meeting titles, record IDs or URLs in the page payload. Navigation revokes authorization.

The listening pill requires active microphone or tab input plus the current Voice Lab owner document. Input activity is separate from queued recognition: Stop hides the pill while recognition finishes. A bundled sample does not count as live input.

## Setup and provider limits

```sh
npm ci
node scripts/import-assets.mjs /path/to/source/extension
npm run prepare:assets
npm run verify
```

Load `extension/` unpacked in Chrome 127 or later. No alternate build/install path is introduced. Enter the Ambiguous key through Settings, or use the private pairing secret with Connect for `http://127.0.0.1:4318`. Secrets remain in trusted Chrome storage; environment files are never bundled. [Local agent setup](LOCAL-AGENTS.md) documents the daemon. The extension selects Codex only; other worker integrations belong to the bridge protocol.

Provider results are proposals, not execution authority. Ambiguous's API exposes no hard tool restriction for the request. Unexpected returned tool activity is recorded as an error and its proposals are rejected. Internal provider reasoning is not stored. The ordinary Context Scout key is used by the automatic hosted proof.

## Validation

The canonical `extension/` manifest was tested in real Chrome for Testing 151.0.7922.34. [Concept UI evidence](../tests/evidence/CONCEPT-UI.md) includes source SHA256 receipts and the exact commands.

- `npm run verify`: TypeScript, 39 tests including bridge and publication controls, build, 362 installed assets and the publication gate passed.
- `npm run test:concept`: nine real browser checks cover capture, no focus movement, automatic dismissal, page state/read/write denial, invalid and stale nonce controls, navigation revocation, synthetic click rejection, preservation of live reminders, real Join, shared interruption budget, and page versus native delivery.
- `npm run test:listening-surface`: four checks use actual tab capture of the provenance-documented real WAV, active input telemetry, Stop during queued recognition, and an actual native popup measuring 380 by 429 pixels. This is input and UI proof, not live participant delivery.
- `npm run test:foundation`: all 13 existing browser checks passed, including real alarms/notifications, IndexedDB rollback, persistence and restart.
- Independent browser QA: eight functional checks passed with 25 implementation and bundle hashes stable. The approved review-only CSS followup changes hover contrast and the narrow mode label; [focused style measurements](../tests/evidence/concept-style.json) cover that delta.
- Impeccable detector: zero quality findings after the two CSS corrections. Four reference-specific aesthetic findings remain, with exit 2 recorded in the evidence guide.
- `npm run test:browser`: audio queue FIFO/drain and the real Nemotron sample passed.
- Fresh `npm run test:integration` is non-green: three attempts timed out at the Return synthesis-result wait after ASR persistence, Stop cancellation and fresh Kokoro output passed. Return revoked pending output. Later ASR/recovery assertions were not reached. [Failure receipts](../tests/evidence/concept-audio-attempts.json) are retained. The [matched baseline comparison](../tests/evidence/concept-audio-baseline.json) reproduces the same third-request timeout at `f96328c` using the exact correlated proof and identical assets. This establishes an inherited liveness limitation, without identifying its model/runtime cause.
- `npm run test:proactive`: seven local regression checks passed. The interrupted Assistant record is an explicitly labeled lifecycle fixture, not inference evidence. No provider calls were requested in this UI change.

Earlier real provider and audio results remain in [the proactive evidence guide](../tests/evidence/PROACTIVE.md). Calendar/write/manual-analysis reports remain in [the earlier evidence guide](../tests/evidence/README.md). They establish earlier capability checks and are not fresh model runs for this UI change.

## Preserved audio and remaining gaps

Voice Lab retains owner tab/document validation, the versioned transcript bridge, audio queue and speech request epochs. Closing or reloading its owner preserves transcripts and permits a new session. Return stops output without stopping transcription.

Assets were reconstructed from pinned official releases. [Download receipts](evidence/audio-download-receipts.json), imported licenses and the NVIDIA notice remain intact. The replacement real LibriSpeech clip retains its [CC BY 4.0 provenance](TEST-CLIP.txt). Model/runtime binaries remain ignored; public asset distribution is unfinished.

There is no autonomous Takeover, continuous browser-context capture, on-device reasoning model, managed coworker execution or autonomous task execution. Live participant delivery, BlackHole routing and sustained meeting throughput remain unverified. Transcript offsets measure decoded audio and have no verified wall-clock alignment to absences; missed-item attribution is unavailable. A preparation brief cannot establish what happened without captured evidence.
