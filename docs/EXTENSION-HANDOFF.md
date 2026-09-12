# Extension integration handoff

Current PR: https://github.com/MikeSchirtzinger/hackathon/pull/3

Branch: `feat/demo-integration`. Merged base: `dbb47bae4d128edf211cde974bf2d51050de452d`. The earlier foundation was merged through PR #1. The current branch preserves the teammate logo and workspace setup from main.

RESULT: PASS for the bounded local, calendar, reviewed-write and explicitly requested hosted-analysis integration. The full autonomous meeting demo remains PARTIAL.

## Install and configure

```sh
npm ci
node scripts/import-assets.mjs /path/to/source/extension
npm run prepare:assets
npm run verify
```

Load `extension/` unpacked. The installer and browser checks use that same manifest. Voice Lab owns audio in a persistent tab; the side panel owns notes, calendar controls, review and settings. Transcript producers must match their saved owner tab and document. PCM stays on the inherited worker/audio-queue path.

Enter the receiving workspace and API key in Settings. Credentials stay in trusted Chrome storage. No environment file enters the bundle. Calendar import and reviewed writes require sync mode. Hosted analysis additionally requires its own visible opt-in and an explicit note-analysis or meeting-brief click. Workspace identity setup and runtime-only credential locations are described in [AMBIGUOUS.md](AMBIGUOUS.md).

## Verified behavior

- Native hotkey context capture, local notes, task drafts, alarms, absence intervals, transaction rollback, and browser-restart persistence.
- Real event-ID and upcoming-reminder import, stable local meeting identity on refresh, preserved join/notes-document associations, and Chrome alarms from returned reminder times.
- Real UI task and restricted note-document creation, followed by remote ID, source-marker, visibility and selected due-date readback.
- Real Assistant note analysis and meeting preparation briefs. Actual response text and evidence IDs persist; neither action executes proposals or creates tasks. Two simultaneous requests for one target admit exactly one HTTP request.
- Separate local-mode and hosted-opt-in gates. Disabling consent or changing credentials invalidates pending hosted responses. The final consent check runs synchronously after all credential reads.
- Real Jitsi document playback through authorized tabCapture, Nemotron and IndexedDB transcript persistence. The input is the provenance-documented real LibriSpeech clip, not a live participant microphone.

Meeting analysis includes saved absence intervals and explicitly states the missing alignment between wall-clock absences and decoded-audio transcript offsets. The provider returned no tool activity in the actual hosted checks. Its API does not expose a hard tool restriction; unexpected returned activity is displayed as an error and the proposal is rejected. Provider internal reasoning is not stored.

## Command results and receipts

Set `CHROME_PATH` to a Chrome for Testing executable when the installed Playwright browser is unavailable. The measured browser was Chrome for Testing 151.0.7922.34.

| Command | Measured result | Evidence |
| --- | --- | --- |
| `npm run verify` | TypeScript, 11 focused tests, build, inherited syntax and 362 installed assets passed | [Build/source receipt](../tests/evidence/final-build.json) |
| `npm run test:foundation` | 13 real browser checks passed with the merged manifest and logo | [Final foundation report](../tests/evidence/foundation-final.json) |
| `npm run test:demo` | Eight real UI integration checks passed | [Calendar, writes and Jitsi ASR](../tests/evidence/demo-browser.json) |
| `npm run test:hosted` | Five real hosted checks passed, including duplicate admission and saved absence evidence | [Hosted report](../tests/evidence/hosted-browser.json) |
| Earlier `npm run test:browser` | Real 40-second FIFO queue and Nemotron recognition passed | [Inherited audio report](evidence/inherited-audio-browser.json) |
| Earlier `npm run test:integration` | Eight checks passed for real ASR persistence, Kokoro output, Stop/Return cancellation and owner recovery | [Earlier audio integration](evidence/merged-audio-integration.json) |

The [evidence guide](../tests/evidence/README.md) records exact tested heads, source hashes, upstream packaging changes and test side effects. The final hosted and foundation reports were refreshed after the consent-guard correction. Audio checks were not repeated solely for the upstream logo change.

A final hosted rerun received HTTP 504. The failure was displayed and persisted without accepting a proposal; its [receipt](../tests/evidence/hosted-http504.json) remains available. Hosted availability is an external dependency.

Failed probes remain explicit in [probe history](../tests/evidence/probe-history.json). Upcoming-reminder requests must use a limit no greater than 50. A headless run with Playwright's audio-muting flag produced no speech transcript; removing that flag with unchanged extension code produced the expected real transcript. This is a measured launch-setting difference for the tested pipeline, not a bypass of capture permission.

Browser screenshots were visually inspected under `.evidence/demo-integration/`, `.evidence/hosted-analysis/` and `.evidence/checkpoint/`.

## Assets and remaining gaps

Assets were reconstructed from pinned official releases and imported as read-only copies. Exact URLs and hashes remain in [download receipts](evidence/audio-download-receipts.json). Runtime/model licenses and the NVIDIA notice remain with the imported assets and are checked by `npm run verify`.

The original hackathon clip was unavailable. The real replacement LibriSpeech clip and its CC BY 4.0 credit remain in [TEST-CLIP.txt](TEST-CLIP.txt). Model/runtime binaries stay ignored by Git; public asset distribution is unfinished.

No autonomous Takeover, provider tool-permission enforcement, managed coworker execution or absence-aligned missed-item summary is claimed. Live Jitsi/Zoom participant delivery, BlackHole routing and sustained meeting throughput require separate verification. A generated preparation brief does not establish what happened in a meeting without captured evidence.
