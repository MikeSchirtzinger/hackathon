# Build brief

The extension carries context from browsing into a meeting and brings the user back to the decisions and work they missed. The intended flow analyzes a hotkey note without requiring a manual context prompt. The current implementation saves context first and queues background reasoning only after explicit per-provider automatic opt-in. It has no sidebar; a compact toolbar popup opens on request, with deeper settings in an options page. Captured records go to IndexedDB first. Ambiguous sync is optional.

Deadline: September 12, 2026, 4:30 PM EDT. Target submission: 4:00 PM.

Submission needs: title, written description, public repo, two-minute video, and a public social post with the required event tags. Judging covers functionality, innovation and theme, technical execution, and usefulness. Sponsor count is not a criterion. The submission checklist still needs inherited-work and event-work details.

## Confirmed direction

- Automatic current-page context when the hotkey note starts.
- Push-to-capture by default, with optional continuous capture.
- Hotkey notes save context quietly. Automatic analysis requires separate consent for Ambiguous or connected Codex; manual analysis remains available in Settings.
- IndexedDB first for context, notes, transcripts, proposed actions, and sync state.
- A toggle keeps records local or enables Ambiguous sync.
- Teammate owns silent-notetaker/Nemotron transcription and Kokoro speech work, including the proposed virtual microphone route.
- Intended demo includes a meeting reminder, Takeover button, return catch-up, and final action-item summary.

## Proposed demo

1. Open a project page. Use the hotkey and say, "Keep this option for our project meeting." Save the note with its URL, title, selection, available visible text, and capture time. Show a quiet saved state.
2. Capture an unrelated thought for later. File it without taking focus or speaking over the user.
3. Show the upcoming meeting reminder with its join link and relevant saved context. Use an actual saved event time, not a scripted delay presented as calendar intelligence.
4. Join the meeting. Consume the teammate's real transcript stream and preserve the meeting timeline locally.
5. Press Takeover before stepping away. Mark the absence interval and activate the user's speaking instructions. Kokoro delivers a context-grounded answer that another meeting participant can hear.
6. Return and stop delegated speech immediately while transcription continues. Show what changed during the absence, what the agent said, and which decisions need the user.
7. End the meeting. Produce the overall summary and proposed action items with evidence references. Review the proposed tasks together, sync selected records to Ambiguous, and read them back after refresh.
8. Open a task's resume link. Restore its saved context and a draft next step. Opening the link does not execute the task.
9. Demonstrate a real failure: failed sync preserves the local record and an explicit retry state. A disconnected audio route must show an error rather than claim the meeting heard the response.

## Attention and authority

Classify work independently from its delivery and execution permissions. A task can run in the background without earning an interruption. Each item carries a kind, focus or meeting association, evidence references, delivery mode, resurface trigger, and allowed effect. The model proposes these fields; extension policy enforces the effects.

| Situation | Delivery | Behavior |
|---|---|---|
| Save a note for later | Quiet status | Save locally immediately; follow the chosen sync policy |
| Routine classification, summary, or sync finishes | Quiet status | Update the record without taking focus or speaking |
| Useful information that needs no decision | Digest | Surface when the user returns or ends the meeting |
| An action needs approval but can wait | Queued decision | Include it in the next review, with a resurface trigger |
| Meeting is about to start | Interrupt | Show the join action from a trusted saved deadline, within the shared ten-minute interruption budget |
| User is away and the meeting asks a question | Meeting speech | Answer within the active Takeover instructions |

Proposed Takeover default: answer from captured context and the user's instructions; queue new commitments for the user's return. This authority choice is pending Mike's answer. Page content and meeting transcripts are evidence, not permission to speak, sync, or execute an action.

Keep listening separate from speech output. Returning cancels queued speech and stops current playback without stopping transcription. Retain the agent's actual utterances separately from human speech. Do not mistake synthesized output for a new user instruction.

## Local storage and sync

Local mode keeps captured content on-device and blocks hosted reasoning. No local reasoning model is implemented. Turning off Ambiguous sync alone cannot justify a local-only claim if a reasoning provider receives the transcript. Describe setup downloads separately from content uploads.

Commit each record locally before classification or outbound sync. Use stable local IDs, source timestamps, revisions, and durable sync states. A failed local write must not show a saved confirmation or proceed to sync.

Proposed toggle semantics: sync governs future eligible records. Previously local-only records stay local until selected. Switching sync off stops new sends and queued retries; records already sent remain in Ambiguous. Show any request already in flight accurately.

Keep raw audio out of Ambiguous. Sync selected notes, summaries, context excerpts, and approved tasks. Make task creation reviewable as one batch. Saving a private note should not require an approval card.

Confirm remote state by reading it back. Do not assume task creation supports idempotency keys. An unknown write outcome requires reconciliation before resending.

Keep capture mode and sync mode independent. Continuous capture has a visible recording state and Stop control. Meeting transcription is explicitly started and continues when the user steps away. Snapshot the page at hotkey activation so changing tabs during dictation cannot attach a note to the wrong page. Mark inaccessible content unavailable.

## Ambiguous's role

Use the workspace to preserve meeting preparation and follow-through. A calendar event supplies meeting time, join link, and meeting-note association where available. A document holds the summary and relevant context. Tasks carry stated owners and deadlines, evidence, and links to the summary and source pages. Unknown owners and dates remain unknown.

Use the extension's resume view for prefilled context. A remote task URL alone does not restore a session. A local context ID only works where that context exists; cross-device access needs a synced, authorized record. Do not put transcripts or credentials in query strings.

## Integration evidence and boundaries

The confirmed demo meeting runs in Zoom in Chrome. The Jitsi document replay below is shared tab-capture proof, not evidence of live Zoom participant delivery.

The current extension passes the local, calendar, reviewed-write, tab-capture, manual hosted-analysis and opted-in automatic-reasoning checks recorded in [EXTENSION-HANDOFF.md](EXTENSION-HANDOFF.md). The complete autonomous meeting demo remains unverified. Automatic work stays in background jobs; only the central attention controller may send native notifications. Routine on-request notes are status, useful findings become digests, and actionable proposals become quiet pending decisions. Provider text cannot create interruption or execution authority.

The inherited audio base is `bf79f61`. Its Voice Lab uses sherpa-onnx WebAssembly workers for Nemotron and Kokoro, an IndexedDB audio queue and BlackHole output selection. Tab capture now accepts an explicitly authorized Jitsi, Zoom or other web tab. A real clip played in the seeded Jitsi document was captured, recognized and persisted. This does not prove live participant delivery.

The versioned Chrome runtime bridge carries session and segment IDs, sequence/revision, decoded-audio offsets, text, source and partial/final state. The worker validates the owning tab and document before committing to IndexedDB. The persistent Voice Lab tab remains the audio owner; closing the popup or Settings does not stop it. Closing or reloading that owner preserves captured transcripts and permits a new session. Offscreen ownership remains a later option.

Earlier real Kokoro checks prove synthesis and late-result cancellation. Return stops output while the existing ASR worker remains usable. Virtual microphone delivery still needs participant verification. Autonomous Takeover is unavailable.

Ambiguous supplies the seeded Jitsi event, reminder and notes-document association. Real event/upcoming import and task/note creation with HTTP readback passed through the extension UI. The key is entered through Settings and stored in trusted browser storage. Local mode blocks captured-content egress and hosted inference, and enabling sync does not enqueue earlier private history.

The hosted Assistant endpoint supplies actual note analysis and meeting preparation proposals after visible hosted consent and either a per-request click or separate automatic-provider opt-in. Actual responses and evidence IDs persist locally. Meeting requests include saved absence intervals and state that decoded-audio offsets cannot identify what was missed during those intervals. Owners and dates remain null in generated proposals. The extension executes none of them.

The provider API offers no hard tool restriction for this request. Prompts request analysis only; returned tool activity is displayed as an error and proposals are rejected. Actual hosted checks returned no tool activity. Workspace agent identities and their independent execution receipts are documented in [AMBIGUOUS.md](AMBIGUOUS.md); the automatic hosted check uses the separately configured ordinary Context Scout agent key. Managed coworker runtime remains unavailable.

## Inputs and evidence still needed

- A live meeting and another participant to verify speech delivery and sustained capture.
- Explicit Takeover speaking authority and an implemented execution path before enabling that control.
- Verified wall-clock alignment before attributing transcript content to an absence.
- Full voice-note and meeting acceptance across the complete proposed demo.

## Acceptance evidence

- A real hotkey voice note pairs with the correct page without a manual context prompt.
- Refresh retains the note, meeting timeline, and pending actions.
- An unrelated background note saves without interrupting the active meeting.
- A reminder fires from the saved event time and opens the correct join link.
- Another participant hears a real Takeover response; return stops speech while transcription continues.
- Catch-up covers the absence interval, distinguishes agent statements, and flags capture gaps.
- Summary actions point to evidence and do not invent owners or dates.
- Local mode sends no captured content to Ambiguous or hosted inference.
- Enabling sync does not silently upload previously local-only history.
- A synced task and summary can be read back from Ambiguous after refresh.
- Failed sync retains recoverable local state without duplicate tasks on retry.
- A resume link restores saved context and the proposed next step.

These are required checks, not claims that they have passed.
