# Post-hackathon speech verification

This branch is a separate cleanup candidate based on submission commit `21d160f`. It is intended to remain unmerged while grading is in progress. The historical submission and its receipts remain intact.

## What changed

A fresh clone can install verified local assets with `npm run setup`. Microphone, sample transcription and speech requests load their models automatically. Browser Kokoro playback needs no BlackHole driver or separate Play click. Spark can read a requested, completed Assistant response automatically after voice opt-in; saved responses can also be read in Local only.

Microphone preferences offer continuous capture or the voice hotkey. The default hotkey is Command+Shift+9 on macOS and Ctrl+Shift+9 elsewhere. Explicit Stop persists. Enabled continuous capture resumes after a browser restart. One persistent tab owns audio, and microphone and meeting-tab capture share one recognizer. Capture commits PCM to IndexedDB before decoding and saves final transcript segments while listening continues.

Stop audio, Return and voice opt-out revoke queued output and stop playback or active synthesis. Speech stops microphone input before playback and resumes an enabled continuous microphone afterward. Reset releases the model workers. Failed or interrupted queued input retains its local database and session reference.

Audio-processing contexts remain open through queued decoding or synthesis, then close when the work finishes, fails or is cancelled. Microphone tracks stop immediately when requested. No silent playback is used to keep a tab active.

## Measured runtime

Measurements below came from actual local models on an Apple M1 Pro, 10 logical CPUs, 16 GiB RAM, macOS arm64 and Chrome for Testing 151.0.7922.34 on 2026-09-13. Times exclude model initialization unless stated. Realtime factor is elapsed processing time divided by audio duration; below 1 means processing kept pace in that bounded run.

| Check | Measured result | Command |
| --- | --- | --- |
| Final 1120 ms INT8 Nemotron export, three 20.2 second streams including finalization | 16.937 to 17.256 seconds elapsed; realtime factor 0.838 to 0.854 | `SPEECH_SEGMENT_SECONDS=20.2 node scripts/speech-streaming-benchmark.mjs extension/models/nemotron` |
| Earlier 560 ms export, three 19.875 second streams | Realtime factor 1.245 to 1.264 | `node scripts/speech-streaming-benchmark.mjs .evidence/nemotron-560ms-baseline/models extension/models/nemotron` |
| Nemotron linear memory during final streams | 868,155,392 bytes; enforced maximum 1,610,612,736 bytes (1536 MiB) | `npm run test:speech-runtime` |
| Kokoro with Nemotron retained, 240 character unpunctuated input | 34.014 seconds generation for 14.422 seconds of non-silent audio; peak linear memory 644,284,416 bytes | `npm run test:speech-runtime` |
| Kokoro maximum | 805,306,368 bytes (768 MiB), enforced by WASM memory declaration | `npm run test:speech-runtime` and `npm test` |
| Continuous background microphone pipeline | Two persisted final segments spanning 40.4 seconds, then successful hotkey Stop and Start | `npm run test:speech` |
| Sample transcription after Kokoro cancellation in an inactive tab | 6.578 seconds for 6.625 seconds of input after the context-lifetime fix; 104.445 seconds before it | `npm run test:integration` |

The earlier and final stream durations differ, as shown. These are bounded comparisons on one host, not a long meeting benchmark or an accuracy score. The export uses a 1120 ms streaming advance, so recognition is chunked. Longer Kokoro replies are split into bounded chunks and played in order; CPU synthesis can be slower than playback duration.

The runtime ignored an externally supplied `Module.wasmMemory`. The worker now tightens the bundled WASM module's declared memory maximum before instantiation, leaving vendor files on disk unchanged. The browser enforces the limit on memory growth. Unsupported memory layouts fail explicitly. These are **WASM linear-memory limits**, not a total Chrome RAM cap. Chrome, JavaScript, downloaded asset buffers and audio storage use additional memory.

The post-speech slowdown reproduced with other model tests stopped. Reloading the recognizer and an optimizer-only browser diagnostic did not resolve it. Retaining the actual audio-processing context through completion restored throughput. The production check now asserts that the context stays running during final decoding, closes at saved idle, and finishes the sample within a regression limit. This isolates a useful lifecycle policy; it does not establish a specific browser scheduler defect.

The selected encoder SHA-256 is `7d2246da3c077e8b57698d398e09d8ca67f50de73b3468af397b22213ce72117`. The previous encoder was `7d932213491ad355c6e5576705dc3494731a52af87d7a1b954559340147909d8`. Archive and installed-tree hashes, licenses and legal source provenance are pinned in [the asset manifest](../scripts/speech-assets.json).

## Browser evidence

The committed [receipt](../tests/evidence/post-hackathon-speech.json) contains the measured results and check names. Full local reports and inspected screenshots are written under `.evidence/` by the scripts. Input is a provenance-documented recorded WAV, either decoded directly or fed through Chrome's file-backed microphone or real tab audio. Recognition and synthesis use actual model workers, native media APIs, IndexedDB and browser playback. **Mocks or fallback responses do not count as successful functionality.**

The controls proof exercises automatic model loading, automatic playback, continuous capture beyond the old cutoff, native Chrome hotkey routing, persisted Stop and zero local-speech HTTP requests. The restart proof closes Chrome completely and relaunches the same profile through three lifetimes. It checks automatic continuous resume, a single owner, durable Pause, and byte-for-byte retention of every queued PCM chunk. Command-line unpacked Chrome emits installation events on reload, so startup restoration is checked by its actual effect rather than an assumed event name.

The lifecycle proof covers cancellation during real model initialization, restart after cancellation, Reset, microphone pause before generated audio, continuous resume after Stop audio, response replacement, Return and voice opt-out, and native permission denial followed by recovery. Browser permission is controlled in an isolated test profile. The recorded input fixture does not override the permission decision.

The response proof made one real hosted Assistant request, saved the completed response, synthesized exactly its displayed text with local Kokoro, and observed actual browser playback. It then switched to Local only, replayed the saved response with no further HTTP, checked opt-out, and verified that Return revoked queued speech while the real owner was suspended. It establishes this route, not provider availability or participant delivery.

## Reproduce

```sh
npm ci
npm run setup
npx playwright install chromium
npm run verify
npm run test:foundation
npm run test:browser
npm run test:integration
npm run test:speech
npm run test:speech-runtime
npm run test:speech-lifecycle
npm run test:speech-restart
npm run test:tab-capture
```

Set `CHROME_PATH` to a compatible Chrome for Testing executable when using an already installed browser. The captured run used Chrome 151. The speech microphone scripts also require `ffmpeg`. Asset installation was separately exercised from an empty target using real downloads, then with corrupted bytes, a corrupt offline cache, a missing license, missing Kokoro voices and a missing generated file list. Failed repair preserved existing destination bytes; verified cached repair succeeded.

`npm run test:speech-response` additionally requires the authorized ordinary agent credentials described in workspace setup and makes a real hosted request. It reads the ignored dotenv file through a parser and never prints or bundles credentials. Ordinary local speech checks need no credentials or network inference.

## Remaining limits

Chrome still requires installation and first-use microphone permission. The audio owner is a persistent tab, not an offscreen document. Close that tab to stop its current input; enabled continuous mode restores at the next browser start. Permission denial and device failure remain explicit errors.

Physical microphone quality, all accents and environments, long meetings, tab-plus-microphone mixing and delivery heard by another meeting participant remain unverified. Interrupted queued PCM is retained, but replay of that backlog is not exposed in the UI. Saved transcripts remain usable. Live transcription offsets describe decoded audio and do not establish wall-clock absence attribution.

The historical third-synthesis failure remains in the [submission receipt](../tests/evidence/concept-audio-baseline.json). Current cancellation and replay checks use real synthesis and retain explicit failures. Hosted reasoning remains separate from local speech and still requires its own consent.
