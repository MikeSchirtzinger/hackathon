import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runCodex } from './spark-codex-worker.mjs';
import { validateResult } from './spark-agent-schema.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER = /^[a-z][a-z0-9-]{0,47}$/;
const ACTIVE = new Set(['queued', 'running']);
const terminal = job => !ACTIVE.has(job.state);
const publicJob = job => ({ id: job.id, state: job.state, result: job.result ?? null, error: job.error ?? null, receipt: job.receipt ?? null });
const fail = (code, message) => Object.assign(new Error(message), { code });
const hash = value => createHash('sha256').update(value).digest();
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(hash(a), hash(b));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function validateJob(value) {
  const keys = ['id', 'provider', 'kind', 'createdAt', 'evidenceIds', 'evidence'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) throw fail(400, 'Invalid job fields.');
  if (typeof value.id !== 'string' || typeof value.provider !== 'string' || !UUID.test(value.id) || !WORKER.test(value.provider) || !['context', 'note', 'meeting'].includes(value.kind) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw fail(400, 'Invalid job identity or kind.');
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.length > 100 || value.evidenceIds.some(id => typeof id !== 'string' || !id.length || id.length > 128)) throw fail(400, 'Saved evidence IDs are required.');
  if (!value.evidence || typeof value.evidence !== 'object' || Array.isArray(value.evidence)) throw fail(400, 'Evidence must be an object.');
  return value;
}

async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Use application/json.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw fail(413, 'The request exceeds 64 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Invalid JSON.'); }
}

export async function createBridge({ stateDirectory = path.join(homedir(), '.local/share/spark/agent-bridge'), port = 4318, codexAvailable, runner = runCodex } = {}) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await chmod(stateDirectory, 0o700);
  const lockPath = path.join(stateDirectory, 'bridge.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('This state directory is locked. Stop its bridge first. After a crash, verify the PID in bridge.lock is stopped before removing that lock.'); throw error; }
  await lock.writeFile(String(process.pid) + '\n');
  let released = false;
  const releaseLock = async () => { if (!released) { released = true; await lock.close(); await unlink(lockPath); } };
  try {
  const secretPath = path.join(stateDirectory, 'pairing-secret');
  try { await writeFile(secretPath, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await chmod(secretPath, 0o600);
  const secret = (await readFile(secretPath, 'utf8')).trim();
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('The private pairing secret is invalid.');
  const statePath = path.join(stateDirectory, 'jobs.json');
  let state = { version: 1, jobs: {}, workers: {} };
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.version !== 1 || !state.jobs || !state.workers) throw new Error('Invalid state.');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('The bridge state is unreadable. Keep it for recovery; no jobs were started.'); }
  let gate = Promise.resolve(), closing = false, running;
  const cancelledIds = new Set();
  const project = job => cancelledIds.has(job.id) ? { ...publicJob(job), state: 'cancelled', result: null } : publicJob(job);
  const mutate = operation => {
    const pending = gate.then(async () => {
      const before = structuredClone(state);
      try { return await operation(); } catch (error) { state = before; throw error; }
    });
    gate = pending.catch(() => {});
    return pending;
  };
  const save = async () => {
    const temporary = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, statePath);
  };
  for (const job of Object.values(state.jobs)) {
    if (ACTIVE.has(job.state)) Object.assign(job, { state: 'error', error: 'The bridge restarted with pending reasoning. Retry explicitly with a new job.', lease: null });
  }
  await save();
  const hasCodex = codexAvailable ?? spawnSync('codex', ['--version'], { timeout: 5000, stdio: 'ignore' }).status === 0;
  const providers = () => [{ id: 'codex', label: 'Codex CLI', processing: 'hosted', available: hasCodex }, ...Object.values(state.workers).map(worker => ({ id: worker.id, label: worker.label, processing: worker.processing, declaredByWorker: true, available: Date.now() - worker.seenAt < 90000 }))];

  async function finish(id, patch) {
    await mutate(async () => {
      const job = state.jobs[id];
      if (job?.state !== 'running' || cancelledIds.has(id)) return;
      Object.assign(job, patch, { finishedAt: Date.now(), lease: null });
      await save();
    });
  }

  function schedule() {
    if (closing || running || !hasCodex) return;
    // Reserve before any asynchronous work. Each accepted job runs at most once.
    const controller = new AbortController();
    const current = { controller, id: null, promise: null };
    running = current;
    current.promise = (async () => {
      const job = await mutate(async () => {
        if (closing) return null;
        const found = Object.values(state.jobs).find(item => item.provider === 'codex' && item.state === 'queued' && !cancelledIds.has(item.id));
        if (!found) return null;
        Object.assign(found, { state: 'running', startedAt: Date.now() });
        current.id = found.id;
        await save();
        return structuredClone(found.request);
      });
      if (!job) return;
      try {
        const { result, receipt } = await runner(job, { signal: controller.signal });
        if (controller.signal.aborted) return;
        validateResult(result, job.evidenceIds);
        await finish(job.id, { state: 'complete', result, receipt, error: null });
      } catch (error) {
        // Only built-in worker errors are trusted diagnostics. Never store model stdout.
        await finish(job.id, { state: 'error', error: String(error.message ?? 'Reasoning failed.').slice(0, 500), result: null });
      }
    })().catch(() => { console.error('Spark could not persist a job update. Inspect private bridge state before retrying.'); }).finally(() => { running = null; if (!closing && Object.values(state.jobs).some(j => j.provider === 'codex' && j.state === 'queued' && !cancelledIds.has(j.id))) setImmediate(schedule); });
  }

  const server = http.createServer(async (request, response) => {
    const send = (code, value) => {
      response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const actualPort = server.address()?.port;
      if (request.headers.host !== `127.0.0.1:${actualPort}`) throw fail(403, 'Only the loopback host is allowed.');
      const origin = request.headers.origin;
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw fail(403, 'Only a paired extension may use browser access.');
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        if (!origin || !['GET', 'POST'].includes(request.headers['access-control-request-method']) || (request.headers['access-control-request-headers'] ?? '').split(',').some(h => h.trim() && !['authorization', 'content-type'].includes(h.trim().toLowerCase()))) throw fail(403, 'Invalid extension preflight.');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.writeHead(204); response.end(); return;
      }
      if (!equal(request.headers.authorization, `Bearer ${secret}`)) throw fail(401, 'A valid pairing secret is required.');
      if (closing) throw fail(503, 'The bridge is stopping.');
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') { send(200, { protocol: 1, name: 'Spark local agents', providers: providers() }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/jobs') {
        const input = validateJob(await jsonBody(request));
        const fingerprint = hash(JSON.stringify(canonical(input))).toString('hex');
        const job = await mutate(async () => {
          if (closing) throw fail(503, 'The bridge is stopping.');
          const existing = state.jobs[input.id];
          if (existing) { if (existing.fingerprint !== fingerprint) throw fail(409, 'This job ID already has different evidence.'); return project(existing); }
          if (!providers().some(p => p.id === input.provider && p.available)) throw fail(503, 'The selected agent is unavailable.');
          if (Object.keys(state.jobs).length >= 1000) throw fail(507, 'The bridge job limit is reached. Archive private state before creating more jobs.');
          state.jobs[input.id] = { id: input.id, provider: input.provider, request: input, fingerprint, state: 'queued', acceptedAt: Date.now() };
          await save(); return project(state.jobs[input.id]);
        });
        send(202, job); setImmediate(schedule); return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)(?:\/(cancel|claim|result))?$/i);
      if (jobMatch && UUID.test(jobMatch[1])) {
        const [, id, action] = jobMatch;
        if (request.method === 'GET' && !action) {
          await gate;
          if (!state.jobs[id]) throw fail(404, 'Job not found.');
          send(200, project(state.jobs[id])); return;
        }
        if (request.method === 'POST' && action === 'cancel') {
          if (state.jobs[id] && ACTIVE.has(state.jobs[id].state)) cancelledIds.add(id);
          if (running?.id === id) running.controller.abort();
          const job = await mutate(async () => {
            const found = state.jobs[id]; if (!found) throw fail(404, 'Job not found.');
            if (ACTIVE.has(found.state)) { Object.assign(found, { state: 'cancelled', result: null, lease: null, finishedAt: Date.now() }); await save(); }
            return project(found);
          });
          send(200, job); return;
        }
        if (request.method === 'POST' && ['claim', 'result'].includes(action)) {
          const input = await jsonBody(request);
          const value = await mutate(async () => {
            if (closing) throw fail(503, 'The bridge is stopping.');
            const job = state.jobs[id]; if (!job) throw fail(404, 'Job not found.');
            if (!input || typeof input.workerId !== 'string' || !WORKER.test(input.workerId) || input.workerId === 'codex' || job.provider !== input.workerId || !state.workers[input.workerId]) throw fail(403, 'The job belongs to a different agent.');
            state.workers[input.workerId].seenAt = Date.now();
            if (action === 'claim') {
              if (cancelledIds.has(id) || job.state !== 'queued') throw fail(409, 'The job is no longer queued.');
              Object.assign(job, { state: 'running', startedAt: Date.now(), lease: randomBytes(32).toString('hex'), leaseUntil: Date.now() + 300000 });
              await save(); return { ...job.request, lease: job.lease, leaseUntil: job.leaseUntil };
            }
            if (cancelledIds.has(id) || job.state !== 'running' || job.leaseUntil <= Date.now() || !equal(input.lease, job.lease)) throw fail(409, 'The job lease is no longer valid.');
            let result; try { result = validateResult(input.result, job.request.evidenceIds); } catch { throw fail(400, 'The result violates the reasoning contract.'); }
            Object.assign(job, { state: 'complete', result, lease: null, finishedAt: Date.now(), receipt: { provider: input.workerId, processing: state.workers[input.workerId].processing, declaredByWorker: true } });
            await save(); return project(job);
          });
          send(200, value); return;
        }
      }
      if (request.method === 'POST' && url.pathname === '/v1/workers/register') {
        const input = await jsonBody(request);
        if (!input || typeof input.id !== 'string' || !WORKER.test(input.id) || input.id === 'codex' || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 || !['on-device', 'hosted', 'unknown'].includes(input.processing)) throw fail(400, 'Invalid worker identity.');
        await mutate(async () => {
          if (closing) throw fail(503, 'The bridge is stopping.');
          const existing = state.workers[input.id];
          if (existing && existing.processing !== input.processing && Object.values(state.jobs).some(j => j.provider === input.id && ACTIVE.has(j.state))) throw fail(409, 'Cancel active jobs before changing processing location.');
          if (!existing && Object.keys(state.workers).length >= 20) throw fail(507, 'The worker limit is reached.');
          state.workers[input.id] = { id: input.id, label: input.label, processing: input.processing, seenAt: Date.now() }; await save();
        });
        send(200, { id: input.id, registered: true }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/queue') {
        const workerId = url.searchParams.get('provider');
        const jobs = await mutate(async () => {
          if (!WORKER.test(workerId) || workerId === 'codex' || !Object.hasOwn(state.workers, workerId)) throw fail(404, 'Register this agent first.');
          state.workers[workerId].seenAt = Date.now(); await save();
          return Object.values(state.jobs).filter(j => j.provider === workerId && j.state === 'queued' && !cancelledIds.has(j.id)).map(j => ({ id: j.id, kind: j.request.kind, acceptedAt: j.acceptedAt }));
        });
        send(200, { jobs }); return;
      }
      throw fail(404, 'Route not found.');
    } catch (error) {
      if (!response.headersSent) send(Number.isInteger(error.code) ? error.code : 500, { error: Number.isInteger(error.code) ? error.message : 'The bridge could not complete the request.' });
      else response.end();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const expiry = setInterval(() => mutate(async () => {
    let changed = false;
    for (const job of Object.values(state.jobs)) if (job.state === 'running' && job.provider !== 'codex' && job.leaseUntil <= Date.now()) { Object.assign(job, { state: 'error', error: 'The agent lease expired. Retry explicitly with a new job.', lease: null }); changed = true; }
    if (changed) await save();
  }).catch(() => console.error('Spark could not persist a lease update.')), 10000);
  expiry.unref(); schedule();
  return {
    origin: `http://127.0.0.1:${server.address().port}`, secretPath,
    async close() {
      if (closing) return;
      closing = true; clearInterval(expiry);
      const stopped = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      running?.controller.abort();
      try { await mutate(async () => {
        for (const job of Object.values(state.jobs)) if (!terminal(job)) Object.assign(job, { state: 'error', error: 'The bridge stopped. Retry explicitly with a new job.', lease: null });
        await save();
      }); } finally { await running?.promise; await stopped; await releaseLock(); }
    },
  };
  } catch (error) { await releaseLock(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2 && process.argv[2] !== 'serve') { console.error('Usage: node scripts/spark-agent-bridge.mjs serve'); process.exitCode = 2; }
  else {
    const bridge = await createBridge();
    console.log(`Spark agent bridge: ${bridge.origin}\nPrivate pairing secret: ${bridge.secretPath}\nCodex uses hosted inference. Connect and consent in Spark before sending evidence.`);
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { bridge.close().then(() => process.exit(0), () => process.exit(1)); });
  }
}
