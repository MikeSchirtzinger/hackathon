# Extension integration handoff

Branch: `feat/proactive-attention`. Starting base: `daf8c93e01170f85c0e4622201c107556490865f`. Merged bridge base: `46190eecbd955c4dffe8200864062a3569ad654e`. This change preserves the inherited audio pipeline, calendar import, reviewed writes, branding and local records.

## Current behavior

Spark runs closed in the background. The manifest has no sidebar permission or side-panel configuration. The toolbar and Command+Shift+U open a compact popup on request. Deeper setup and saved history use Chrome's options page. Voice Lab remains a persistent, explicitly opened audio tab.

Command+Shift+Y saves current-page context quietly. Notes, captured context and meeting evidence at Return or End queue reasoning only after separate provider auto-reasoning opt-in. Ambiguous additionally requires its existing hosted consent and configured key. Connected Codex requires the fixed localhost bridge and explicit pairing. Both providers use hosted processing and are denied in Local only. Connecting sends a capability request without captured evidence; pending cancellation may send a control message after opt-out.

Jobs persist evidence, stable IDs, dispatch intent, consent and connection epochs, polling limits, actual results and explicit failures. Model calls run outside the global mutation queue. Codex resumes polling an existing job after browser restart. Unknown Assistant outcomes are retained as errors without automatic replay. Disconnect snapshots the previous pairing for cancellation before clearing it. Late results cannot restore acceptance after revocation.

The attention controller owns notifications. Routine on-request notes stay status-only. Useful findings wait in a digest. Actionable proposals appear as a quiet pending count. Only a still-scheduled saved meeting with an imminent trusted start time can earn an interrupt. The budget allows at most one per ten minutes, coalesces simultaneous reminders, clears standing notifications and retains every shelved reason and resurface trigger. Agent urgency cannot bypass the budget. Completion never opens UI.

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

The focused browser proofs use the canonical built manifest and real Chrome. Reports separate real provider results from explicitly labeled lifecycle fixtures. No fixture is counted as inference.

- `npm run verify`: TypeScript, 33 tests including the bridge HTTP/subprocess regressions, build and 362 installed assets passed.
- `npm run test:foundation`: 13 browser checks for capture, local records, real alarms/notifications, zero local-mode worker HTTP, rollback and restart.
- `npm run test:proactive`: no-sidebar capture and native popup, local negative gates, notification coalescing/budget, interrupted Assistant recovery. With `SPARK_TEST_BRIDGE=1 SPARK_VISIBLE_PROOF=1`, it also performs actual Connect, Codex inference, same-ID restart polling and real opt-out cancellation/readback.
- `npm run test:auto-hosted`: separate automatic consent, a real Assistant note response with no tool activity, responsive local saves during inference, persistence and opt-out.
- `node scripts/disconnect-browser-proof.mjs`: an actual in-flight Codex disconnect, previous-pairing cancellation and authenticated daemon readback.
- `npm run test:integration`: real Nemotron sample persistence, Kokoro output, Stop/Return stale-result cancellation and audio-owner recovery.

Latest redacted reports and source receipts are linked from [the proactive evidence guide](../tests/evidence/PROACTIVE.md). Historical calendar/write/manual-analysis reports remain in [the earlier evidence guide](../tests/evidence/README.md); they are not new proactive claims.

## Preserved audio and remaining gaps

Voice Lab retains owner tab/document validation, the versioned transcript bridge, audio queue and speech request epochs. Closing or reloading its owner preserves transcripts and permits a new session. Return stops output without stopping transcription.

Assets were reconstructed from pinned official releases. [Download receipts](evidence/audio-download-receipts.json), imported licenses and the NVIDIA notice remain intact. The replacement real LibriSpeech clip retains its [CC BY 4.0 provenance](TEST-CLIP.txt). Model/runtime binaries remain ignored; public asset distribution is unfinished.

There is no autonomous Takeover, continuous browser-context capture, on-device reasoning model, managed coworker execution or autonomous task execution. Live participant delivery, BlackHole routing and sustained meeting throughput remain unverified. Transcript offsets measure decoded audio and have no verified wall-clock alignment to absences; missed-item attribution is unavailable. A preparation brief cannot establish what happened without captured evidence.
