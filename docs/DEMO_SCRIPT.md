# Historical concept script

This is the original storyboard, retained for design context. It includes unimplemented Takeover and meeting speech delivery, plus obsolete sidebar and Jitsi steps. It is not a runnable demo script. For the current build and verified flow, use [the README](../README.md), [the extension handoff](EXTENSION-HANDOFF.md), and [runtime evidence](../tests/evidence/PROACTIVE.md).

Two minutes. One continuous take if possible. Every line below is either an on-screen action or a spoken line. Times are targets.

The thread: an agent that keeps your place as work moves from browsing to a meeting to follow-through. The peak moment is the agent answering a meeting question from the page you tagged earlier, while you are away.

## Before recording

- Ambiguous workspace Spark is signed in. Event "Project meeting: onboarding redesign (Brevity Meet alpha)" is on the calendar with a Jitsi join link, a popup reminder 10 minutes before, and the linked notes doc. Move the event so the reminder fires inside the take: `PATCH /api/calendars/events/{id}` with `start_at` and `end_at`. IDs and the curl are in `docs/AMBIGUOUS.md`.
- CRM has four demo customers and one demo investor, each with a note. Names carry "(demo)".
- Extension loaded unpacked. Local mode on, Ambiguous sync off.
- Second participant (teammate) joined on the meeting link with audio on, so the Takeover answer is heard by someone other than you.
- Nemotron transcription and Kokoro speech confirmed working in the last five minutes, not last night.
- Browser tabs open in this order: meet.brevity.ventures, a second unrelated page, Ambiguous calendar.

## Take

### 0:00 Capture

Screen: meet.brevity.ventures, scrolled to the seat-key section.

Say: "I'm reading our own alpha page for Brevity Meet. This seat-key flow is the option I want to bring to the project meeting."

Do: press the hotkey. Speak: "Keep this option for our project meeting."

Screen: side panel shows the note with page title, URL, selected text, and capture time. Status line reads Saved, local. Nothing pops, nothing speaks.

Say: "One hotkey. It captured the page itself. I never explained what I was looking at."

### 0:20 Unrelated note, no interruption

Screen: switch to the second tab.

Do: hotkey. Speak: "Remind me to look into this later."

Screen: quiet Saved state only.

Say: "That one is filed for later. Same hotkey, different intent. No card, no voice, nothing asking me to decide anything."

### 0:30 Prepare

Screen: the meeting reminder appears with the join link and the Brevity Meet note attached.

Say: "The reminder comes from the real calendar event in Ambiguous, and the note I tagged is already on it."

Do: click Join. Meeting opens. Teammate is already in the call.

### 0:45 Delegate

Screen: transcription running in the side panel. Teammate is talking.

Say: "Transcription is on-device. I'm stepping away."

Do: press Takeover. Screen shows the absence marker and the active instructions: answer from known context, queue any new commitment for review.

Teammate asks, on mic: "What was Mike's pick for the onboarding flow, and can we commit to shipping it before the SSO change?"

Agent, through Kokoro, heard in the call: "Mike tagged the Brevity Meet seat-key flow as his option for this meeting: one email, key shown once, agents propose and only the person's seat approves. Ordering against the SSO change is a new commitment, so I'm queueing that for Mike to decide."

Say nothing here. Let the room hear it.

### 1:15 Return

Do: press Back. Speech stops at once. Transcript keeps scrolling.

Screen: catch-up card with three sections.

- What changed while you were away: the transcript interval, with a gap marker if capture missed anything.
- What the agent said: the exact utterance, labeled as agent speech, separate from human speech.
- Needs your decision: "Ship seat-key flow before SSO change?" with the transcript line it came from.

Say: "I'm back. Speech stopped the moment I returned. Listening never stopped. Here is what I missed, what the agent actually said, and the one thing it refused to decide for me."

### 1:35 Follow through

Do: end the meeting.

Screen: summary and proposed tasks, each with an evidence reference to a transcript line or the tagged page. Owners and dates left blank where nobody said them.

Do: select the summary and two tasks. Turn Ambiguous sync on. Click Sync.

Screen: sync state changes to Sent. Switch to the Ambiguous tab, refresh. The tasks and the summary doc are there.

Say: "Local first. Nothing left the machine until I chose these records. Now they're in Ambiguous, and each task links back to the context that produced it."

Do: open one task's resume link. The extension restores the tagged page, the note, and a draft next step. Nothing executes.

### 1:55 Close

Say: "Capture, prepare, delegate, return, follow through. The agent kept my place the whole way, and it only spoke with what I had already given it."

## If something breaks on camera

Show it. The brief requires a real failure path, so a failure is usable footage.

- Sync fails: the record stays local with a visible Retry state. Say: "It kept the record and told me. Retry does not duplicate the task."
- Audio route to the meeting fails: the panel must show an error, not a Sent state. Say: "It knows the room did not hear that." Do not claim the teammate heard it.
- Reminder does not fire: do not fake it with a timer. Open the Ambiguous calendar and join from the event. Say the reminder path is not proven.

## Do not say

- That anything is private if a hosted reasoning model received the transcript. Say which model ran where.
- That the agent "decided" anything. It answered from context and queued the commitment.
- An owner or a date the meeting did not state.

## Status

This script records the intended take before the extension was built. It is not evidence that any depicted capability works. Record only the capabilities verified in the current build.
