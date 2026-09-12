# hackathon

Entry for the AI Tinkerers "Agents, Everywhere" global hackathon, Columbus, September 12, 2026. Team: Brevity.

## What it is

A local-first browser extension. A hotkey tags the current page or starts a voice note. The agent hears what you said, sees what you were looking at, and turns the two into a proposed action. Nothing is written until you approve it. Approved actions land in an Ambiguous AI workspace as real records, with links back to the page and a prefilled session so the next person can pick up where you left off.

## Layout

- `extension/` Manifest V3 extension: hotkey, side panel, page context capture, voice capture, approval gate, Ambiguous writes.
- `docs/` build notes and the submission plan.
- `SUBMISSION.md` the event checklist. Fill in "what we inherited" and "what we built" before submitting.

## Inherited

Libraries and starter code only. The extension, the capture pipeline, the approval gate, and the Ambiguous integration are built during the event. See `SUBMISSION.md`.

## Run

Instructions land here once the extension loads unpacked. Until then, treat this repo as a build in progress.
