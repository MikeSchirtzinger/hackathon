# Entry text drafted for the Columbus portal

## Brief description

Spark is a Chrome extension that keeps your place as work moves from browsing to a meeting to follow-through, without a sidebar. One hotkey captures the current page, with its title, URL, selection and capture time, alongside a note, saved locally in IndexedDB first. An on-demand popup provides settings and review. An attention budget decides what earns a notification and what is tracked quietly: quiet status, return digest, review queue, or interrupt. It imports a meeting from the Ambiguous calendar with its reminder and join link, drafts a task from the captured context, and syncs only the records you select after review. With your explicit opt-in, a locally connected Codex CLI and the hosted Ambiguous assistant do the reasoning automatically, with cancellation and restart verified against real jobs. Codex CLI runs locally and uses hosted inference. Local mode is the default. Sync and automatic reasoning are separate switches, and the API key stays in the browser profile. Transcription runs on device with the inherited Nemotron browser engine. Takeover, where the agent answers for you while you step away, is the design goal and is not in this build. The concept video says so; the receipts are in tests/evidence/PROACTIVE.md.

## Prior work

Reuses the existing silent-notetaker Nemotron browser transcription engine and a teammate's Kokoro speech work. The extension itself, page-context capture, the local store, calendar import from Ambiguous, the review gate, and reviewed sync were built during the event.

## Social post draft

Built Spark today at the AI Tinkerers Agents, Everywhere hackathon in Columbus. A Chrome extension that captures page context with one hotkey, starts with local capture, imports your meeting from Ambiguous, and syncs only what you review. Concept video: https://youtu.be/V9wPNDHxz_U  Code and real recording: https://github.com/MikeSchirtzinger/spark/releases/tag/demo-2026-09-12

## Links for the entry form

- Video URL field: https://youtu.be/V9wPNDHxz_U
- Other link 1: https://github.com/MikeSchirtzinger/spark (public repo)
- Other link 2: https://github.com/MikeSchirtzinger/spark/releases/tag/demo-2026-09-12 (real 55 second recording, earlier sidebar checkpoint, and the narrated cut)
- Other link 3: https://github.com/MikeSchirtzinger/spark/blob/main/tests/evidence/PROACTIVE.md (what was verified and what was not)
