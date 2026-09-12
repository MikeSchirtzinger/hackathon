# Demo agent environment

`demo-agents.json` defines Context Scout and Meeting Steward. The first prepares captured notes without interrupting the user. The second prepares return briefs and action proposals from supplied evidence. Each has its own workspace identity and an operating brief. Automatic subscriptions are disabled. The roles propose document and task changes; their instructions do not grant permission for unrelated actions.

Run `node scripts/ambiguous-demo.mjs inspect` to verify the shared identity and list the demo identities. Run `node scripts/ambiguous-demo.mjs setup` to create the configured identities and operating briefs. The script reads the administrator key from `~/ADA/.agents/.env` and stores newly issued per-agent keys in `.agents/.env` with mode `600`. Neither file belongs in Git.

The setup command writes redacted API receipts under `.evidence/ambiguous/`. Managed coworker provisioning is unavailable for this account. An API identity is not proof of a completed reasoning request. Runtime checks must record an actual execution and its result. Hosted reasoning is separate from the extension's local speech models and must respect the local-only toggle.
