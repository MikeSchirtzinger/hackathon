# Migration notes

Imported on September 12, 2026 from the local Zoom Voice prototype developed in the Codex task “Zoom” (`01a09677-f85e-70e1-96db-8323b0160d10`). The full available session history was reviewed. Its latest work replaces the old 30-second worker backlog cutoff with bounded IndexedDB buffering, inspired by silent-notetaker’s spill/ack policy. This is not a port of that project's Rust inference engine.

The prototype reuses Voice Lab’s Nemotron/Kokoro workers and local assets. Dependencies include sherpa-onnx 1.13.8, Nemotron Speech Streaming English 0.6B (560ms INT8), Kokoro English v0.19 INT8, and BlackHole 2ch 0.7.1. Imported vendor/model folders retain their supplied licenses. A complete redistribution bundle and licensing inventory remain required before publishing assets.

No backend credentials or Ambiguous integration were present in the imported work. The repository originally contained only the product brief and submission checklist. The broader product scope is preserved in BRIEF.md; the README describes only implemented behavior.

The source task finished during migration. A recursive comparison confirmed the imported extension matches its completed state. Source files remain untouched. Later changes there must be reconciled deliberately. Nothing has been committed or pushed by this migration.

Validation in this checkout: `npm run verify` passed (JavaScript and shell syntax, Manifest V3, 362 model assets); `npm run test:browser` passed with 40 seconds of FIFO audio and the real transcript “Hello from the hackathon everything runs in your browser”. Playwright is pinned to 1.63.0; npm reported zero known vulnerabilities. Live Zoom audio transmission and sustained speech throughput were not retested in this migration.

Follow-up sync check: the Zoom task completed a live short-speech test (reported transcript “S test one two three”, zero backlog after 114 seconds). Its extension and installer matched this checkout before the intentional removal of the Voice Lab favicon and header symbol. No newer Zoom code required import. The icon originated in the assistant-built Voice Lab demo.

Popup feasibility: a standard action popup can provide compact controls, but its document closes on loss of focus. Current page-owned workers and capture cleanup would then stop inference. A functional conversion requires moving model workers, audio capture/output, and transcript state into an offscreen document, with runtime messages connecting the popup and service worker. Chrome supports service-worker tab capture consumed by an offscreen document from version 116. Device permission and BlackHole routing must be verified in that architecture. Popup conversion has not been implemented. Reference: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
