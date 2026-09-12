# Extension checkpoint

Branch: `feat/extension-foundation`. Owner: extension worker in `w29:p1`.

RESULT: PASS for the local extension foundation. Overall demo: PARTIAL.

## Reproduce

```sh
npm install
npm run verify
node scripts/browser-proof.mjs
```

Load `dist/` unpacked. Capture with Command+Shift+Y on macOS, Ctrl+Shift+Y elsewhere. Open the side panel with the toolbar or Command+Shift+U. Capture does not open a panel or notify.

The browser proof ran in Chrome for Testing 151.0.7922.34. Its command produced 13 passing checks in `docs/evidence/foundation-browser.json`: native command routing and original context, manual note/reload, resume and missing-context handling, real alarm notification, meeting absence state, local egress observation with an instrumentation control, no private-history enqueue, actual IndexedDB rollback, restricted-page handling, and full browser restart persistence. Four focused policy/validation tests passed with `npm test`.

Browser screenshots inspected locally: `.evidence/checkpoint/notes-persisted.png`, `meeting-ended.png`, and `settings-local.png`. The test uses an explicitly authored fixture page and manual note. It does not simulate a transcript or claim audio success.

## Integration underway

Fetched audio base: `bf79f61`, Add virtual mic setup, tts, and transcription. It contains real sherpa-onnx Nemotron/Kokoro workers, a bounded PCM queue, Zoom tab capture, and BlackHole output. Reconcile into one canonical `extension/` load path, retaining its installer, asset import/preparation, and inherited browser check. First checkpoint predates this integration.

Bridge transcript events into local records and route Return/Stop to output cancellation. Fix stale Kokoro results restarting playback after Stop. Pending synthesis needs an invalidation epoch. Preserve the persistent Voice Lab tab until an offscreen owner has runtime proof.

## Current gaps

Manual notes are text entry. Foundation alone has no transcription transport. Inherited audio source is present upstream but has not yet been run on the combined extension. Live Zoom delivery needs another participant. Autonomous reasoning and Takeover speaking authority are unconfigured.

Ambiguous adapter uses the live schema in `docs/ambiguous-contract.json`. A durable reviewed outbox exists, with no automatic resend after an uncertain outcome. Actual remote write/readback remains unverified: no identity or approved live records provided. No captured content was sent.
