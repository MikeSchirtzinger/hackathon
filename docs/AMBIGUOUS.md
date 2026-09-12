# Ambiguous workspace setup

Workspace "Spark" on app.ambiguous.ai, owner mike@brevity.ventures. Seeded 2026-09-12 for the demo.

The shared administrator key lives in `~/ADA/.agents/.env`, with `~/.agents/.env` symlinked to it. Per-demo agent keys live in this repository's ignored `.agents/.env`. Both files use mode `600`. The legacy repository `.env` remains ignored and now also uses mode `600`; its contents were preserved. The key is named `hackathon-demo-extension` under Settings > Security & sign-in > API keys. Scope is wildcard. Rotate or revoke it after the recording.

## Auth

All routes take `Authorization: Bearer <api key>`. Verified read and write with the key:

```bash
node scripts/ambiguous-demo.mjs inspect
```

## Seeded records

| Record | ID | Notes |
|---|---|---|
| Calendar | `e99a0d0a-9b09-413f-8e40-beb9f567da10` | "My Calendar", default, America/Los_Angeles |
| Event | `d2b2d9d5-2956-4140-ba37-410fe4c68065` | "Project meeting: onboarding redesign", 2026-09-12 20:05Z to 20:20Z (4:05 PM EDT) |
| Join link | https://meet.jit.si/ambi-d2b2d9d529564140ba37410f | Ambiguous created it from `auto_conference: true` (Jitsi) |
| Reminder | `8935b4cf-8b24-4d74-a26b-c5e75a6ceb65` | popup, 10 minutes before, triggers 19:55Z (3:55 PM EDT) |
| Replay reminder | `34f9ed13-9d27-420b-ad82-be4e09ca0baf` | popup, 1 minute before, triggers 20:04Z (4:04 PM EDT) |
| Meeting notes doc | `1aeaef67-6ded-48a3-84fd-89b2e25f33ce` | "Recall demo: Q4 onboarding redesign", linked via `meeting_notes_doc_id` |
| Tasks | TASK-001, TASK-002, TASK-003 | todo; TASK-001 high, due 2026-09-18 |

## Routes the extension needs

```bash
A="Authorization: Bearer $AMBIGUOUS_API_KEY"; B=$AMBIGUOUS_BASE_URL
# upcoming reminders (event title, start, trigger_at, join link via event)
curl -s -H "$A" $B/api/calendars/upcoming-reminders
# event with join link and notes doc id
curl -s -H "$A" $B/api/calendars/events/$AMBIGUOUS_EVENT_ID
# document read; content is TipTap/ProseMirror JSON as a string. POST accepts markdown in `content`.
curl -s -H "$A" $B/api/documents/$AMBIGUOUS_DOC_ID
# create a task (title required; status todo|in_progress|done|cancelled|blocked; priority urgent|high|medium|low; due_date YYYY-MM-DD)
curl -s -H "$A" -H 'Content-Type: application/json' -X POST $B/api/tasks -d '{"title":"...","priority":"medium"}'
# list tasks
curl -s -H "$A" "$B/api/tasks?limit=50"
# create a document from markdown
curl -s -H "$A" -H 'Content-Type: application/json' -X POST $B/api/documents -d '{"type":"doc","title":"...","content":"# markdown"}'
# attach notes doc to an event
curl -s -H "$A" -H 'Content-Type: application/json' -X POST $B/api/calendars/events/$AMBIGUOUS_EVENT_ID/meeting-notes -d '{"document_id":"..."}'
```

Observed behaviors:

- Task create returns `{"task": {...}}` with a `task_key` like TASK-004. Delete returns 204.
- Tasks without a due date get one from an SLA default (`due_date_source: "sla"`). An unstated date must remain unstated locally; distinguish a workspace SLA date from a user-provided deadline.
- The event response does not embed reminders; use `/api/calendars/upcoming-reminders`.
- Ambiguous can host the meeting itself (Jitsi). No Google Meet needed for the demo.
- To move the meeting: `PATCH /api/calendars/events/{id}` with `start_at` and `end_at` in ISO 8601.

## Demo agent identities

`node scripts/ambiguous-demo.mjs setup` created Context Scout and Meeting Steward as member API identities. Each key was verified against `/api/users/me` with `type=agent`, and each operating brief was read back with its source marker. Both can read the existing meeting document. Configuration and record IDs are in `.agents/demo-agents.json` and `.agents/demo-state.json`. Keys remain in `.agents/.env`.

Managed coworker provisioning returned HTTP 403 because `can_provision_coworkers` is false. These are ordinary API identities with local role instructions, not managed background workers. The hosted Assistant endpoint separately returned a real structured classification under Context Scout's identity, with no tool calls. No local reasoning model or autonomous Takeover is configured.

The demo event was rescheduled and its reminder replaced on September 12. `GET /api/calendars/upcoming-reminders` returned its 19:55Z trigger. API receipts remain under ignored `.evidence/ambiguous/`.
