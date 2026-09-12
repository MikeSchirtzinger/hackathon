# Brevity hackathon

Context Carry combines local browser notes and meeting follow-through with the existing Voice Lab audio workspace in one Chrome extension. A hotkey saves the current page context. Notes, transcript segments, task drafts, and meeting state persist in IndexedDB. Nemotron transcribes local audio; Kokoro generates speech from text. Autonomous reasoning and Takeover are not configured.

## Run locally

Use Node.js 22+ and Chrome on macOS.

```sh
npm ci
node scripts/import-assets.mjs /path/to/existing/extension
npm run verify
```

Load this repository's `extension/` folder unpacked at `chrome://extensions`. It is the only manifest and load path. `npm run build` writes the foundation scripts into `extension/foundation/`; it preserves imported models, runtime files, and their license notices. `npm run prepare:assets` rebuilds model file lists when needed.

The runtime and models are ignored by Git. A fresh clone requires an asset bundle. Asset distribution remains unfinished.

For virtual microphone setup, run `sh install.sh` in an interactive Terminal. It installs BlackHole when needed and may restart CoreAudio, briefly interrupting audio. Admin credentials are required for driver installation. The installer opens the same `extension/` folder.

## Capture and meeting controls

1. On a page, press Command+Shift+Y on macOS or Ctrl+Shift+Y elsewhere. This quietly saves its URL, title, selection, available visible text, and time. Restricted content is marked unavailable.
2. Open the side panel from the toolbar or Command+Shift+U. Enter a note and save it locally. Manual text entry is labeled separately from speech transcription.
3. Save a meeting start, reminder time, and join URL. Chrome schedules the notification from that saved time. Calendar import is not connected.
4. Mark away and return to preserve absence boundaries. Return stops current output and invalidates pending synthesis results. It leaves the Voice Lab transcription owner running.
5. Review local task drafts and selected records before creating a sync batch. Enabling sync does not upload private history. Local mode stops pending sends. A write with an unknown outcome cannot create again automatically.

## Use Voice Lab

Open Voice Lab from the side panel. Keep that persistent tab open during audio capture. Closing the side panel does not stop it. Closing Voice Lab stops its workers and capture, and the local workspace records the interrupted session.

For microphone transcription, load Nemotron and use Record. The bundled sample is a separate validation input and is labeled as such in saved transcripts. Real final transcripts can be saved as notes with their original captured context.

For Zoom, click the extension toolbar on the Zoom meeting tab, then open meeting audio from the side panel. In Voice Lab, choose **Load Nemotron & listen to Zoom**. The captured tab playback contains other participants, not your own microphone. Captions are unnecessary.

For speech output, choose **Connect BlackHole**, select BlackHole 2ch as Zoom's microphone, and keep speakers on headphones. Load Kokoro, enter text, and generate speech. **Stop audio** and the meeting's **Return** control invalidate queued speech results as well as stopping playback. Generating a new phrase is an explicit action. Re-select your physical microphone in Zoom to speak yourself.

BlackHole route selection does not prove another participant heard audio. Verify that separately.

## Verify the combined extension

```sh
npx playwright install chromium
npm run verify
npm run test:foundation
npm run test:browser
npm run test:integration
```

The foundation test loads the actual manifest, exercises Chrome's native keyboard command routing, saves and reloads notes, checks a real alarm, and observes local-mode network behavior. The inherited browser check exercises real IndexedDB audio buffering and Nemotron recognition. The integration check uses the actual audio UI and worker outputs to verify transcript persistence and stale-synthesis cancellation.

See [the handoff](docs/EXTENSION-HANDOFF.md) for current command results, evidence, and exact gaps. [The brief](docs/BRIEF.md) contains the full intended demo, which remains broader than the verified implementation.

## Limits

- No autonomous replies, reasoning model, physical-mic mixing, or offscreen audio owner is implemented. The Takeover control remains unavailable.
- Audio queues bound memory and disk backlog; sustained live speech throughput still needs validation.
- Transcript offsets are measured in decoded audio, not aligned to absence wall-clock boundaries. The timeline displays saved text and does not invent a catch-up summary.
- The Ambiguous adapter and reviewed outbox exist, but live remote writes and readback require configured credentials and approved records. No external write is claimed verified here.
- Local resume links work only in the browser that has the saved context. Opening one restores a draft and executes nothing.
- The full Zoom/BlackHole path requires another participant. Bundled audio recognition and local synthesis do not establish meeting delivery.

Inherited audio work and dependencies are recorded in [migration notes](docs/MIGRATION.md). Record inherited and event-built work separately in [the submission checklist](SUBMISSION.md).
