# Spark agent connections

Spark saves captured context and notes in IndexedDB before asking an agent to classify them. A connected agent returns a summary and proposed next steps. Spark decides whether to keep the result quiet, collect it for later, queue a decision, or interrupt for a verified time-sensitive action.

## Connect Codex

Requirements: Node.js 22 or later and an installed, signed-in Codex CLI. The verified CLI version is recorded in the test receipt. Run from the Spark checkout:

```sh
node scripts/spark-agent-bridge.mjs serve
```

The bridge listens only at `http://127.0.0.1:4318`. It prints the path to its private pairing secret, never the secret itself. The default path is `~/.local/share/spark/agent-bridge/pairing-secret`. Copy its contents into Spark's connection field locally. Keep the secret out of screenshots, recordings, prompts and source control.

In Spark, explicitly connect the bridge, enable automatic Codex reasoning for that connection. Chrome requests the optional localhost permission when you connect. Connection and automatic reasoning are separate choices. Saving a note or capturing a page can then queue a job without opening a sidebar.

**Codex uses hosted inference.** Running its CLI on your computer does not make the model local. Spark's Local only setting blocks this provider. Ambiguous reasoning has its own opt-in. Disconnecting or revoking consent invalidates result acceptance; pending work is cancelled rather than silently accepted later.

The built-in worker uses the existing Codex login, ignores user configuration, disables the shell, browser, apps, plugin and other tool features, and runs from a temporary directory with a read-only sandbox. It accepts only a constrained result tied to the saved evidence IDs. It discards reasoning events and rejects observed tool activity. These controls are not a universal guarantee that every Codex version exposes zero tools. The live receipt establishes only what happened in that run.

## Connect another coding agent

The extension currently selects Codex. For other coding agents, the bridge offers a worker protocol for custom adapters; an extension provider picker is not implemented. A trusted local process can register, claim work and submit a result using the pairing secret in an Authorization header. All browser access is restricted to extension origins. There is no unauthenticated queue or arbitrary shell-command endpoint.

| Request | Purpose |
| --- | --- |
| `GET /v1/capabilities` | List providers and their availability. |
| `POST /v1/workers/register` | Register `{id, label, processing}`. Processing is `on-device`, `hosted` or `unknown`. |
| `GET /v1/queue?provider=ID` | List that worker's queued job IDs and refresh its availability. Poll at a bounded interval. |
| `POST /v1/jobs/ID/claim` | Send `{workerId}` to acquire a five-minute lease and the evidence. |
| `POST /v1/jobs/ID/result` | Send `{workerId, lease, result}`. Expired, cancelled and duplicate completions are rejected. |

Registration and queue polling refresh availability for 90 seconds. A claimed job has a fixed five-minute lease. The bridge marks an expired lease as an error and does not run it again. An external worker's processing location is its declaration, not a measured privacy guarantee. A person should connect only an agent whose configuration they trust.

Client routes and the result shape are in [.agents/contracts/local-agent-v1.json](../.agents/contracts/local-agent-v1.json). Worker results must cite supplied evidence IDs. They cannot set owners, deadlines or a notification delivery instruction. A model suggesting urgency does not grant permission to send a notification, execute a task, contact someone or write to a workspace.

## Job lifecycle and recovery

The client supplies a durable UUID. Repeating the same ID and payload returns the existing job; changing the payload returns HTTP 409. The bridge serializes state mutations and writes through a private temporary file before acknowledging a change. Model inference runs outside that mutation queue, so saving or cancelling another job does not wait for a model response.

Jobs persist in `~/.local/share/spark/agent-bridge/jobs.json`, with file permissions 600 inside a directory with permissions 700. This file contains captured evidence and results. It is local storage, not encryption. The bridge allows up to 1,000 retained jobs and 20 external providers. It returns an explicit capacity error rather than deleting history.

Stop the bridge with Ctrl-C. Pending jobs become errors and active Codex work receives cancellation. A cancelled or stopped job is never automatically rerun. On restart, unfinished saved jobs become errors and require an explicit new request.

An exclusive `bridge.lock` protects the state directory. A second daemon cannot open the same state. After an abrupt crash, inspect the PID in that lock and verify the process has stopped before removing the lock. Retain `jobs.json`; startup will mark interrupted jobs as errors. Do not remove a live process's lock or start multiple daemons against the same state directory.

## Validation

```sh
node --test tests/local-agent-bridge.test.mjs tests/codex-worker.test.mjs
```

These tests exercise real loopback HTTP and filesystem behavior. Their injected worker results are **protocol fixtures, not proof of model reasoning**. Actual Codex and browser receipts are recorded separately. The worker has no autonomous task execution or meeting takeover authority.
