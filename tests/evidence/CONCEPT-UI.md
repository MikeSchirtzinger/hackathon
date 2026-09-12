# Compact card UI evidence

These checks use the canonical built `extension/` manifest in Chrome for Testing 151.0.7922.34. The concept video was inspected directly; its SHA256 is recorded in the UI receipt. Screenshots were captured from the real browser and visually inspected. Fonts are installed system fonts.

| Command | Result and receipt |
| --- | --- |
| `npm run verify` | [TypeScript, 39 tests, build, 362 installed assets and publication gate](concept-build.json) |
| Independent browser QA | [Eight functional checks with 25 source and bundle hashes stable during the run](concept-independent.json) |
| `node scripts/concept-style-proof.mjs` | [Hover contrast and narrow-width font measurements](concept-style.json) |
| Impeccable detector | [Zero quality findings; four reference-specific aesthetic findings, exit 2](concept-detector.json) |
| `npm run test:concept` | [Nine page, popup, review, reminder and isolation checks](concept-ui.json) |
| `npm run test:listening-surface` | [Four real tab-input and native popup checks](concept-listening.json) |
| `npm run test:foundation` | [13 foundation regression checks](concept-foundation.json) |
| `npm run test:proactive` | [Seven local-mode background regressions](concept-proactive.json) |

The UI test saves real local meeting records and waits for real Chrome alarms. Its unavailable-page control removes injected surfaces from the test page, then verifies an actual native Chrome notification. No notification is mocked. Invalid nonce, stale document, privileged read/write attempts and synthetic clicks are denied. A real capture hotkey during the reminder leaves that same reminder actionable. The page payload never includes its private title, ID or join URL. Reduced-motion rendering is checked in the browser.

The listening test plays the real licensed LibriSpeech clip in a local test page and uses Chrome tab capture plus the existing audio pipeline. It observes active input and a live owner, then verifies input is false while capture status still reflects draining recognition. The native popup is inspected and captured through its actual Chrome POPUP target, measuring 380 by 429 pixels. This check does not assert a new transcription-quality result, remote participant delivery or BlackHole routing.

The proactive restart test uses an explicitly labeled interrupted-job fixture. It is lifecycle proof, not provider inference. No hosted Ambiguous or Codex request was needed for this UI change. Local audio regressions use real Nemotron and Kokoro. Existing provider receipts retain their earlier scope.

Local screenshots remain in `.evidence/concept-ui/` and `.evidence/concept-listening/`. Source SHA256 maps in the linked receipts identify the implementation exercised. Keys, browser profiles and model assets are excluded from publication.

After independent functional QA, only two review CSS properties changed: inactive navigation hover uses headline text color, and the narrow mode label uses 12px. The focused browser check measured hover contrast changing from 4.07:1 to 9.95:1 and the label from 10px to 12px. Runtime scripts and their bundles retain the independent receipt hashes. The detector retains four aesthetic findings for explicit reference choices; its exit 2 is not represented as a clean pass. No detector rules were suppressed.

The fresh full audio integration run is currently non-green. Three candidate attempts passed ASR persistence, local Stop cancellation and a fresh Kokoro result, then timed out waiting for the Return synthesis result. [Retained attempts](concept-audio-attempts.json) include the actual stop receipt and timing trace. Return revoked pending output; the subsequent ASR/recovery assertions were not reached in those attempts. A hidden-tab cause is not established. The [correlated candidate receipt](concept-audio-correlated.json) records the actual Return request ID and epoch. One [matched baseline comparison](concept-audio-baseline.json) repeats the same third-request timeout at `f96328c` with the exact proof and identical assets. Both runs observe two stop receipts and pending=false, with no matching result or error before the unchanged deadline; the harness closes each isolated browser after the failed assertion. The synthesis-liveness failure predates the UI change. No same-build retry or runtime workaround followed this comparison.
