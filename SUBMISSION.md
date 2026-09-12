# Submission checklist

Choose your city on the [global event page](https://aitinkerers.org/hackathons/global/agents-everywhere). Use that city's participant portal for the submission deadline and published judging criteria, and its handbook for eligibility and required deliverables. See [hackathon-rules.md](hackathon-rules.md) for the agent-readable summary.

## Build eligibility

- [ ] Our submitted project is a net-new build created during the official hackathon period
- [ ] Its core functionality was built during the event; we are not resubmitting or extending a pre-existing project and entering it as new
- [ ] We identify inherited templates, libraries, prompts, components, and starter code separately from our event work

**What we inherited**
Imported the local Voice Lab / Zoom Voice speech prototype and its Nemotron/Kokoro sherpa-onnx integration. Uses sherpa-onnx, the bundled speech models, and BlackHole. The bounded audio queue was inspired by silent-notetaker. See docs/MIGRATION.md. Confirm creation timing and complete asset attribution before submission.

**What we built during the hackathon**
The extension foundation adds hotkey page-context capture, IndexedDB notes and task drafts, meeting reminders, absence intervals, and reviewed synchronization. The integration adds Ambiguous calendar import, real note/task creation with readback, and explicitly requested hosted analysis of saved evidence. Local Nemotron transcription and manual Kokoro synthesis are integrated with persistent meeting records and cancellation controls. Confirm creation timing against the inherited audio work before completing the eligibility checklist.

## Title and description

**What you built**
Spark is a Chrome extension that saves the page behind a note and brings that evidence into meeting preparation and follow-through. Notes and transcripts stay in IndexedDB first. Optional Ambiguous integration turns selected records into shared work after review and returns requested analysis as proposals.

**Who it is for**
A person researching a project while preparing for a browser-based Zoom meeting. They need to capture an idea without interrupting their work and recover the relevant context when they return.

**Why the context matters**
The hotkey saves the current URL, title, selection and available page text. A later note or proposed task retains that source, so the person does not need to reconstruct which page prompted the work.

**Sponsor technologies used**
NVIDIA Nemotron performs local speech transcription. Ambiguous provides calendar records, shared tasks and documents, separate API agent identities, and optional hosted analysis. Kokoro provides local speech synthesis. Describe each contribution as implemented; separate API identities do not establish managed background execution.

## Zoom demo rehearsal

Use the actual Zoom browser meeting for the demo. Prior Jitsi document playback is evidence for the shared tab-capture path only.

1. Show a project page, select relevant text and use the capture hotkey. Save a note and reload the panel to show the local record and its source.
2. Show the saved meeting reminder. Open the Zoom meeting in Chrome, invoke the extension on that tab, then open Voice Lab and start meeting transcription. Keep Voice Lab open.
3. Have another participant speak. Check that their actual words appear and persist in the meeting transcript. Bundled sample recognition does not satisfy this step.
4. For manual speech, select BlackHole as Zoom's microphone, generate a short Kokoro phrase and have the other participant confirm hearing it. Use Stop or Return to check cancellation. Autonomous Takeover is unavailable.
5. Request a meeting brief from the saved evidence with hosted analysis enabled. Show the actual response and its source evidence, then review and sync a selected task. Open the resulting Ambiguous record to confirm creation.
6. Switch to local mode and show that hosted actions are unavailable while saved records remain accessible. If the provider fails, show the stored error without substituting a response.

Live Zoom participant capture and outgoing virtual-microphone delivery still require this rehearsal. Transcript offsets are not aligned to absence wall-clock time, so a brief cannot identify exactly what the person missed while away. The video must describe the controls actually demonstrated.

## Evidence for the judging criteria

Judges score each of the four official criteria from 1 to 5. This checklist helps you gather evidence; it does not guarantee a score. A working starter is a foundation for your own project.

| Official criterion | Show in your project and demo |
|---|---|
| Core Requirements & Functionality | Run one complete workflow in the intended environment, from user request through tools to a verified result. Repeat it with live integrations; offline tests alone do not prove the deployed flow. |
| Innovation & Theme Alignment | Show the surrounding context before the prompt and explain the original interaction it enables. Compare with the context removed: what value would a standalone chatbox lose? |
| Technical Execution & Integration | Show how tools, data, and the environment connect. Demonstrate a relevant failure or cancellation path and explain recovery, state persistence, and integration limits. |
| Usefulness & Agentic Experience | Identify the user and problem, show a meaningful action in the surface, and demonstrate clear feedback and appropriate user control. Explain what work the agent saves. |

- [ ] We can point to visible evidence for every criterion
- [ ] We distinguish live services, sample data, session-only state, and standalone recipes
- [ ] Sponsor technologies contribute to the workflow; their count is not a judging criterion

## Public repository

- [ ] A new participant can run the quickstart from a clean clone
- [ ] The README lists the credentials and separate processes required
- [ ] `npm run verify` passes; optional recipe checks pass if used
- [ ] `.env`, tokens, generated traces with sensitive data, and account secrets are excluded
- [ ] Sample data, session-only state, and unimplemented integrations are clearly labeled

## Two-minute demo video

- [ ] Show the surface and existing context before the prompt
- [ ] Demonstrate one complete interaction
- [ ] Show a visible result: an actual record, local state change, or research source links
- [ ] If showing an approval, distinguish the decision from execution and demonstrate the resulting behavior
- [ ] State which sponsor technologies made the interaction possible
- [ ] Keep the video within the event's limit and check audio

See [demo prompts](dev-docs/demo-prompts.md) for a reproducible incident workflow.

## Social post and final submission

- [ ] Follow the organizer's posting and sponsor-tagging instructions
- [ ] Link the public repository and video
- [ ] Credit the sponsors you used and applicable local partners
- [ ] Check the live integration once more before recording or submitting
- [ ] Inspect the repository, video and screenshots for secrets

Prepare the post and submission for a human to publish; running the starter kit
does not publish either automatically.
