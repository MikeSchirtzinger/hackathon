# Brevity — hackathon

Local-first browser extension for the AI Tinkerers “Agents, Everywhere” hackathon. Team: Brevity.

The current implementation is the Zoom Voice prototype: Zoom tab audio → local Nemotron transcription, and typed text → local Kokoro speech → BlackHole virtual microphone → Zoom. No API key or inference server is required. It does not generate autonomous replies.

## Run locally

Use Node.js 22+ and Chrome on macOS. From the repository root:

```sh
npm ci
node scripts/import-assets.mjs /path/to/existing/zoom-voice/extension
npm run verify
```

The models, sherpa-onnx runtime, bundled test audio, and their upstream license files are imported together. They are ignored by Git. The migration checkout already contains them. A fresh clone currently requires an existing asset bundle; public asset distribution remains unfinished.

For virtual microphone output, run `sh install.sh` in an interactive Terminal. This installs BlackHole if needed and may restart CoreAudio, briefly interrupting audio. Admin credentials are required for driver installation. It opens the extension folder for the next step.

1. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repo’s `extension/` folder.
2. Click the extension icon on your Zoom meeting tab.
3. Click **Load Nemotron & listen to Zoom**. Verify with another participant speaking. Your own microphone is not included in Zoom’s tab playback. Captions are unnecessary.
4. For speech output, click **Connect BlackHole**, choose **BlackHole 2ch** as Zoom’s microphone, then click **Play bundled test phrase**. Keep Zoom speakers and system output on headphones, not BlackHole.
5. Load Kokoro, type a short phrase, and generate speech. Re-select your physical microphone in Zoom to speak yourself.

Keep the extension panel open. This implementation captures one Zoom tab. It does not capture every browser tab or the entire device.

## Verify

```sh
npx playwright install chromium
npm run test:browser
```

The browser test checks 40 seconds of ordered IndexedDB audio buffering and actual Nemotron recognition of the bundled phrase. It does not join Zoom or transmit audio. A second participant is still needed to verify the meeting audio path.

## Status and limits

- Recognition segments reset every 20 decoded seconds. One audio chunk is sent to the worker at a time; queued PCM uses IndexedDB, capped at 30 minutes, with at most 60 seconds of pending writes. Digital silence can be skipped after one second.
- Queue bounds prevent unbounded backlog; they do not make inference real-time. The original live test exceeded the former 30-second cutoff. Sustained speech performance needs validation.
- Kokoro synthesis worked in the original session, taking 14.6 seconds for 3.9 seconds of audio.
- No automatic agent replies, physical-mic mixing, or native system-audio helper exists.
- The broader page hotkey → voice note → proposed action → approval → Ambiguous record flow in [the brief](docs/BRIEF.md) is planned, not implemented.

See [migration notes](docs/MIGRATION.md) and [submission checklist](SUBMISSION.md).
