# hackathon

Entry for the AI Tinkerers "Agents, Everywhere" global hackathon, Columbus, September 12, 2026. Team: Brevity.

## What it is

A browser extension being built to carry context from browsing into meetings and follow-up work. A hotkey captures a note with the current page. Notes and transcripts land in IndexedDB first, with optional Ambiguous sync. Background notes stay quiet. Meeting reminders surface when needed. A Takeover control is planned to connect the teammate's transcription and speech components, followed by a summary of what the user missed and the actions that need attention.

Current status: the local extension foundation passes browser checks. Audio integration is in progress. See [the build brief](docs/BRIEF.md) for the proposed demo and acceptance checks.

## Layout

- Planned `extension/`: Manifest V3 hotkey, side panel, context capture, local storage, attention routing, Takeover controls, and Ambiguous sync.
- `docs/` build notes and the submission plan.
- `SUBMISSION.md` the event checklist. Fill in "what we inherited" and "what we built" before submitting.

## Inherited

The design intends to reuse the existing silent-notetaker/Nemotron transcription work and integrate a teammate's Kokoro speech work. Record the exact reused revisions and distinguish them from new extension work in [the submission checklist](SUBMISSION.md). Planned work is not yet a completed event contribution.

## Run

Run `npm install` and `npm run verify`. Load `dist/` unpacked in Chrome. Run `node scripts/browser-proof.mjs` for real extension checks. See `docs/EXTENSION-HANDOFF.md` for the measured scope and integration gaps.
