import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBridge } from '../scripts/spark-agent-bridge.mjs';
import { validateResult } from '../scripts/spark-agent-schema.mjs';

// Protocol fixtures test transport and acceptance only. They are not model evidence.
const evidenceId = 'saved-note-one';
const result = () => ({ summary: 'Saved for later.', classification: 'note', actionRequired: false, urgency: 'none', reason: 'No action is needed now.', resurface: 'on-request', evidenceIds: [evidenceId], proposals: [] });
const job = (provider = 'external') => ({ id: randomUUID(), provider, kind: 'note', createdAt: Date.now(), evidenceIds: [evidenceId], evidence: { note: 'Remember to look at this later.' } });
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-bridge-test-'));
  let bridge = await createBridge({ stateDirectory: directory, port: 0, codexAvailable: false, ...options });
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  const secret = (await readFile(bridge.secretPath, 'utf8')).trim();
  const api = async (route, body, headers = {}) => {
    const response = await fetch(bridge.origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${secret}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  };
  const register = async () => assert.equal((await api('/v1/workers/register', { id: 'external', label: 'Protocol fixture', processing: 'unknown' })).status, 200);
  return { api, register, directory, get bridge() { return bridge; }, async restart() { await bridge.close(); bridge = await createBridge({ stateDirectory: directory, port: 0, codexAvailable: false }); } };
}

test('private state, authentication, origin and host boundaries', async t => {
  const s = await setup(t);
  assert.equal((await stat(s.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(s.bridge.secretPath)).mode & 0o777, 0o600);
  assert.equal((await s.api('/v1/capabilities', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await s.api('/v1/capabilities', undefined, { Origin: 'https://example.com' })).status, 403);
  const badHost = await new Promise((resolve, reject) => { const request = http.get(s.bridge.origin + '/v1/capabilities', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(badHost, 403);
  const allowed = await s.api('/v1/capabilities', undefined, { Origin: `chrome-extension://${'a'.repeat(32)}` });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.value.providers[0].processing, 'hosted');
  const preflight = await fetch(s.bridge.origin + '/v1/jobs', { method: 'OPTIONS', headers: { Origin: `chrome-extension://${'a'.repeat(32)}`, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
});

test('idempotence survives restart and changed evidence is rejected', async t => {
  const s = await setup(t); await s.register();
  const input = job();
  assert.equal((await s.api('/v1/jobs', input)).status, 202);
  assert.equal((await s.api('/v1/jobs', { ...input, evidence: { note: 'Changed' } })).status, 409);
  assert.equal((await s.api('/v1/jobs', input)).value.state, 'queued');
  await s.restart();
  assert.equal((await s.api('/v1/jobs', input)).value.state, 'error');
  assert.equal(Object.keys(JSON.parse(await readFile(path.join(s.directory, 'jobs.json'), 'utf8')).jobs).length, 1);
});

test('external worker claim, evidence validation and private lease projection', async t => {
  const s = await setup(t); await s.register();
  const input = job(); await s.api('/v1/jobs', input);
  assert.equal((await s.api('/v1/queue?provider=external')).value.jobs[0].id, input.id);
  const claim = await s.api(`/v1/jobs/${input.id}/claim`, { workerId: 'external' });
  assert.equal(claim.status, 200);
  assert.ok(claim.value.lease);
  assert.equal((await s.api(`/v1/jobs/${input.id}/claim`, { workerId: 'external' })).status, 409);
  const bad = { ...result(), evidenceIds: ['invented'] };
  assert.equal((await s.api(`/v1/jobs/${input.id}/result`, { workerId: 'external', lease: claim.value.lease, result: bad })).status, 400);
  const done = await s.api(`/v1/jobs/${input.id}/result`, { workerId: 'external', lease: claim.value.lease, result: result() });
  assert.equal(done.value.state, 'complete');
  assert.equal(done.value.receipt.declaredByWorker, true);
  assert.equal(JSON.stringify((await s.api(`/v1/jobs/${input.id}`)).value).includes(claim.value.lease), false);
  assert.equal((await s.api(`/v1/jobs/${input.id}/result`, { workerId: 'external', lease: claim.value.lease, result: result() })).status, 409);
});

test('cancel invalidates external lease and rejects late results', async t => {
  const s = await setup(t); await s.register();
  const input = job(); await s.api('/v1/jobs', input);
  const claim = await s.api(`/v1/jobs/${input.id}/claim`, { workerId: 'external' });
  assert.equal((await s.api(`/v1/jobs/${input.id}/cancel`, {})).value.state, 'cancelled');
  assert.equal((await s.api(`/v1/jobs/${input.id}/result`, { workerId: 'external', lease: claim.value.lease, result: result() })).status, 409);
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.result, null);
});

test('simultaneous duplicate admission executes the selected runner once', async t => {
  let runs = 0, release;
  const deferred = new Promise(resolve => { release = resolve; });
  const s = await setup(t, { codexAvailable: true, runner: async () => { runs++; await deferred; return { result: result(), receipt: { fixture: true } }; } });
  const input = job('codex');
  const admitted = await Promise.all(Array.from({ length: 5 }, () => s.api('/v1/jobs', input)));
  assert.ok(admitted.every(r => r.status === 202));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runs, 1); release();
  for (let i = 0; i < 20; i++) { if ((await s.api(`/v1/jobs/${input.id}`)).value.state === 'complete') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.state, 'complete');
});

test('cancellation aborts runner and prevents its late result from committing', async t => {
  let release, observedSignal;
  const deferred = new Promise(resolve => { release = resolve; });
  const s = await setup(t, { codexAvailable: true, runner: async (_job, { signal }) => { observedSignal = signal; await deferred; return { result: result(), receipt: { fixture: true } }; } });
  const input = job('codex'); await s.api('/v1/jobs', input);
  for (let i = 0; i < 20 && !observedSignal; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(observedSignal);
  await s.api(`/v1/jobs/${input.id}/cancel`, {}); assert.equal(observedSignal.aborted, true);
  release(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.state, 'cancelled');
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.result, null);
});

test('bad jobs, oversized evidence and unavailable providers are denied', async t => {
  const s = await setup(t); await s.register();
  assert.equal((await s.api('/v1/jobs', { ...job(), id: '../../file' })).status, 400);
  assert.equal((await s.api('/v1/jobs', { ...job(), id: [randomUUID()] })).status, 400);
  assert.equal((await s.api('/v1/jobs', { ...job(), provider: null })).status, 400);
  assert.equal((await s.api('/v1/jobs', { ...job(), evidenceIds: [] })).status, 400);
  assert.equal((await s.api('/v1/jobs', job('codex'))).status, 503);
  const large = job(); large.evidence.note = 'x'.repeat(70000);
  assert.equal((await s.api('/v1/jobs', large)).status, 413);
  assert.equal((await s.api('/v1/queue?provider=constructor')).status, 404);
});

test('a second daemon cannot alter or execute the first daemon state', async t => {
  const s = await setup(t); await s.register();
  const input = job(); await s.api('/v1/jobs', input);
  const before = await readFile(path.join(s.directory, 'jobs.json'), 'utf8');
  await assert.rejects(createBridge({ stateDirectory: s.directory, port: 0, codexAvailable: false }), /locked/);
  assert.equal(await readFile(path.join(s.directory, 'jobs.json'), 'utf8'), before);
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.state, 'queued');
});

test('a request body arriving during shutdown cannot admit new work', async t => {
  const s = await setup(t); await s.register();
  const input = job(); const body = JSON.stringify(input);
  const secret = (await readFile(s.bridge.secretPath, 'utf8')).trim();
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(s.bridge.origin + '/v1/jobs', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, incoming => { incoming.resume(); resolve(incoming.statusCode); });
    request.on('error', reject); request.flushHeaders();
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  const stopping = s.bridge.close();
  request.end(body);
  assert.equal(await response, 503); await stopping;
  const state = JSON.parse(await readFile(path.join(s.directory, 'jobs.json'), 'utf8'));
  assert.equal(Object.hasOwn(state.jobs, input.id), false);
});

test('failed cancellation persistence still stops admission and late external results', async t => {
  const s = await setup(t); await s.register();
  const input = job(); await s.api('/v1/jobs', input);
  const obstruction = path.join(s.directory, `jobs.json.${process.pid}.tmp`);
  await mkdir(obstruction);
  assert.equal((await s.api(`/v1/jobs/${input.id}/cancel`, {})).status, 500);
  await rm(obstruction, { recursive: true });
  assert.equal((await s.api(`/v1/jobs/${input.id}`)).value.state, 'cancelled');
  assert.deepEqual((await s.api('/v1/queue?provider=external')).value.jobs, []);
  assert.equal((await s.api(`/v1/jobs/${input.id}/claim`, { workerId: 'external' })).status, 409);
});

test('failed cancellation persistence cannot start a queued Codex job', async t => {
  let release, runs = 0;
  const deferred = new Promise(resolve => { release = resolve; });
  const s = await setup(t, { codexAvailable: true, runner: async () => { runs++; await deferred; return { result: result(), receipt: { fixture: true } }; } });
  const first = job('codex'), second = job('codex');
  await s.api('/v1/jobs', first); await s.api('/v1/jobs', second);
  for (let i = 0; i < 20 && !runs; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const obstruction = path.join(s.directory, `jobs.json.${process.pid}.tmp`);
  await mkdir(obstruction);
  assert.equal((await s.api(`/v1/jobs/${second.id}/cancel`, {})).status, 500);
  await rm(obstruction, { recursive: true }); release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(runs, 1);
  assert.equal((await s.api(`/v1/jobs/${second.id}`)).value.state, 'cancelled');
});

test('schema rejects tools, invented IDs, commitments and prototype keys', () => {
  assert.throws(() => validateResult({ ...result(), toolCalls: [{ tool: 'send' }] }, [evidenceId]));
  assert.throws(() => validateResult({ ...result(), evidenceIds: ['invented'] }, [evidenceId]));
  assert.throws(() => validateResult(JSON.parse(JSON.stringify(result()).slice(0, -1) + ',"__proto__":{}}'), [evidenceId]));
  assert.throws(() => validateResult({ ...result(), proposals: [{ kind: 'follow-up', nextStep: 'Send email', evidenceIds: [evidenceId], owner: 'Mike', dueDate: null, delivery: 'quiet-status' }] }, [evidenceId]));
});

test('crash recovery marks queued and running records as errors without dispatch', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-restart-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = job('codex'), second = job('codex');
  await writeFile(path.join(directory, 'jobs.json'), JSON.stringify({ version: 1, workers: {}, jobs: { [first.id]: { id: first.id, provider: 'codex', request: first, state: 'queued' }, [second.id]: { id: second.id, provider: 'codex', request: second, state: 'running' } } }));
  let runs = 0;
  const bridge = await createBridge({ stateDirectory: directory, port: 0, codexAvailable: true, runner: async () => { runs++; throw new Error('Must not run'); } });
  await bridge.close();
  const state = JSON.parse(await readFile(path.join(directory, 'jobs.json'), 'utf8'));
  assert.equal(runs, 0); assert.ok(Object.values(state.jobs).every(j => j.state === 'error'));
});
