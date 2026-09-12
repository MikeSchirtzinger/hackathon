# Proactive background evidence

These reports test the single `extension/` manifest in Chrome for Testing 151.0.7922.34. Provider checks use real services. Lifecycle fixtures are labeled and are not inference evidence.

| Command | Report |
| --- | --- |
| `npm run test:foundation` | [13 browser checks](proactive-foundation.json) |
| `SPARK_TEST_BRIDGE=1 SPARK_VISIBLE_PROOF=1 npm run test:proactive` | [Native popup, no-sidebar capture, attention budget, real Codex, restart polling and opt-out](proactive-browser.json) |
| `npm run test:auto-hosted` | [Separate automatic consent and real ordinary-agent Assistant response](automatic-hosted.json) |
| `node scripts/disconnect-browser-proof.mjs` | [Actual in-flight disconnect and daemon cancellation readback](disconnect-browser.json) |
| `npm run test:integration` | [Eight real audio and owner-recovery checks](proactive-audio.json) |

The Codex report includes one successful automatic job and a second real dispatched job deliberately cancelled by opt-out. The disconnect report separately verifies the corrected previous-pairing guard against an in-flight job. Cancellation is not counted as completed inference. Source SHA256 maps identify the exact files exercised; later focused receipts cover the corresponding guard correction.

The native shortcut establishes an actual Chrome POPUP context. Connect and its capability readback are exercised through the same popup document rendered in a dedicated test tab. The test profile receives optional host access through the real Connect handler. No host permission is preseeded, injected through a private API, or bundled as a required permission. This receipt does not claim a separately observed native permission-dialog acceptance.

Local-mode checks observe worker HTTP with a positive instrumentation control in the foundation report. No captured content leaves in Local only. Explicit Connect may check capabilities, and cancellation may send a control message for an already-dispatched job. These contain no captured evidence.

Private API keys and pairing secrets are read by the test process and entered through UI. Reports retain HTTP status, evidence IDs and actual result text without credentials or provider internal reasoning. The Assistant endpoint exposes no hard tool restriction; the real response contains an empty tool-activity receipt. Returned tool activity would reject the proposals.

No report proves live Zoom participant delivery, BlackHole routing, autonomous Takeover, or transcript-to-absence alignment. Historical audio asset and test-clip provenance remains unchanged.
