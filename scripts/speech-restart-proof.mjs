import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Recorded input enters Chrome's native getUserMedia pipeline. No model output is seeded.
const extension = path.resolve('extension');
const evidence = path.resolve(process.env.SPEECH_RESTART_OUTPUT || '.evidence/speech-restart');
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'spark-speech-restart-'));
const profile = path.join(temporary, 'profile');
const microphone = path.join(temporary, 'microphone.wav');
execFileSync('ffmpeg', ['-v', 'error', '-stream_loop', '-1', '-i', path.join(extension, 'demo.wav'), '-t', '300', '-ar', '16000', '-ac', '1', microphone]);
const sourceFiles = ['scripts/speech-restart-proof.mjs', 'extension/capture-session.js', 'extension/app.js', 'extension/audio-queue.js', 'extension/voice-bridge.js', 'extension/engine-client.js', 'extension/engine-worker.js', 'extension/engine-memory.js', 'extension/src/background.ts', 'extension/src/speech.ts', 'extension/foundation/background.js', 'extension/manifest.json', 'scripts/speech-assets.json'];
const fingerprint = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const report = {
  startedAt: new Date().toISOString(), command: 'node scripts/speech-restart-proof.mjs',
  input: 'Recorded LibriSpeech WAV repeated through Chrome file-backed microphone. Real getUserMedia, AudioWorklet, IndexedDB and Nemotron. Physical microphone and meeting participant delivery are not tested.',
  fixtureSha256: createHash('sha256').update(await readFile(microphone)).digest('hex'),
  sourceSha256: await fingerprint(), checks: [], screenshots: [], launches: [], errors: [], consoleErrors: [], requests: [],
  scope: 'Same-profile full Chrome restart, continuous capture startup, durable explicit Pause, one persistent owner, and retained real PCM backlog after owner closure. Retention does not establish backlog replay.',
};
let context, panel, voice, id, launchNumber = 0;
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
function pass(name, detail) { report.checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail || {})); }
async function eventually(name, predicate, timeout = 180000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await predicate(); if (result) return result; await pause(50); }
  throw Error(`Timed out: ${name}`);
}
function observeMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  window.restartProof = { requests: [], tracks: [] };
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const request = { at: Date.now(), state: 'requested' }; window.restartProof.requests.push(request);
    try {
      const stream = await nativeGetUserMedia(...args);
      request.state = 'granted'; window.restartProof.tracks.push(...stream.getTracks()); return stream;
    } catch (error) { request.state = 'denied'; request.error = error.message; throw error; }
  };
}
async function launch() {
  launchNumber++;
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1200, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--use-mock-keychain',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`],
  });
  await context.addInitScript(observeMicrophone);
  context.on('request', request => { if (/^https?:/.test(request.url())) report.requests.push({ launch: launchNumber, method: request.method(), url: request.url() }); });
  const observePage = page => {
    page.on('pageerror', error => report.errors.push({ launch: launchNumber, url: page.url(), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ launch: launchNumber, url: page.url(), message: message.text() }); });
  };
  context.on('page', observePage); context.pages().forEach(observePage);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  if (id) assert.equal(extensionId, id, 'The same profile must preserve the extension identity.');
  id = extensionId;
  report.launches.push({ launch: launchNumber, at: Date.now(), chrome: context.browser().version(), extensionId: id });
  panel = context.pages().find(page => !page.url().startsWith(`chrome-extension://${id}/index.html`)) || await context.newPage();
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.getByText('Local workspace ready.', { exact: true }).waitFor();
  console.log('Chrome lifetime', launchNumber, 'ready');
}
const read = () => panel.evaluate(async () => {
  const response = await chrome.runtime.sendMessage({ type: 'state' });
  if (!response.ok) throw Error(response.error); return response.value;
});
const owners = () => context.pages().filter(page => page.url().split(/[?#]/)[0] === `chrome-extension://${id}/index.html`);
const liveOwnerContexts = () => panel.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter(owner => owner.documentUrl?.split(/[?#]/)[0] === chrome.runtime.getURL('index.html')));
const capture = () => voice.evaluate(async () => {
  const { captureSession: session } = await import('./app.js');
  return { phase: session.phase, kind: session.kind, sessionId: session.writer?.session?.id, captured: session.captured || 0,
    queueSamples: session.queue?.samples || 0, queueWrites: session.queue?.writes || 0, database: session.queue?.name,
    tracks: session.media?.getTracks().map(track => ({ state: track.readyState, enabled: track.enabled })) || [] };
});
const observed = () => voice.evaluate(() => ({ requests: window.restartProof?.requests || [], tracks: window.restartProof?.tracks.map(track => ({ state: track.readyState, enabled: track.enabled })) || [] }));
async function screenshot(name, page = voice) {
  const filename = path.join(evidence, `${name}.png`); await page.screenshot({ path: filename, fullPage: true }); report.screenshots.push(filename);
}
async function actualTranscript(name, previousSession) {
  await eventually(`${name}: microphone listening`, async () => {
    const current = await capture();
    return (await read()).audioListening && current.kind === 'microphone' && current.sessionId !== previousSession && current.tracks.some(track => track.state === 'live' && track.enabled);
  });
  const session = await capture();
  await eventually(`${name}: real matching transcript`, async () => (await read()).transcripts.some(segment => segment.sessionId === session.sessionId && /yellow lamps|squalid quarter/i.test(segment.text)));
  return { capture: await capture(), segments: (await read()).transcripts.filter(segment => segment.sessionId === session.sessionId) };
}
async function retainedPcm(database) {
  return panel.evaluate(async name => {
    const databases = await indexedDB.databases();
    if (!databases.some(database => database.name === name)) return { exists: false };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Expected retained PCM database, not a new database.')); };
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction('pcm', 'readonly'), request = tx.objectStore('pcm').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      let samples = 0, energy = 0;
      for (const row of rows) { if (!(row instanceof Float32Array)) throw Error('Retained PCM must contain real Float32Array chunks.'); samples += row.length; for (const value of row) { if (!Number.isFinite(value)) throw Error('Retained PCM contains a nonfinite sample.'); energy += value * value; } }
      const chunkSha256 = await Promise.all(rows.map(async row => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(row.buffer, row.byteOffset, row.byteLength))), byte => byte.toString(16).padStart(2, '0')).join('')));
      return { exists: true, rows: rows.length, samples, energy: samples ? energy / samples : 0, chunkSha256 };
    } finally { db.close(); }
  }, database);
}
async function closeBrowser() {
  const oldContext = context;
  await oldContext.close(); assert(oldContext.pages().every(page => page.isClosed()), 'Full context close must close its pages.');
  context = panel = voice = undefined;
  await pause(500);
}
try {
  await launch();
  assert.equal((await read()).speechPreferences.transcriptionMode, 'hotkey');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.locator('#speech-mode').selectOption('continuous');
  voice = await eventually('continuous preference opens an owner', () => owners()[0]);
  await voice.locator('#sample').waitFor();
  const initial = await actualTranscript('first continuous start');
  assert.equal((await read()).speechPreferences.paused, false);
  pass('Continuous preference starts the real microphone pipeline and saves matching Nemotron text', initial);
  await screenshot('01-continuous-before-browser-close');

  const initialOwners = await liveOwnerContexts();
  assert.equal(initialOwners.length, 1);
  for (let attempt = 0; attempt < 3; attempt++) await panel.getByRole('button', { name: 'Open speech controls', exact: true }).click();
  const reusedOwners = await liveOwnerContexts();
  assert.equal(owners().length, 1); assert.equal(reusedOwners.length, 1);
  assert.equal(reusedOwners[0].documentId, initialOwners[0].documentId);
  assert.equal((await capture()).sessionId, initial.capture.sessionId);
  pass('Repeated Open Voice Lab reuses the same document and active capture session', { owner: reusedOwners[0], sessionId: initial.capture.sessionId });

  const queued = await eventually('real microphone PCM backlog before owner close', async () => {
    const current = await capture(); return current.phase === 'listening' && current.queueSamples >= 6400 && current.queueWrites === 0 ? current : undefined;
  }, 60000);
  assert(queued.database?.startsWith('zoom-audio-'));
  await voice.close(); voice = undefined;
  await eventually('closed owner is recorded as interrupted', async () => (await read()).audioSessions.find(session => session.id === queued.sessionId)?.captureStatus === 'error');
  const closedSession = (await read()).audioSessions.find(session => session.id === queued.sessionId);
  assert.equal(closedSession.pendingAudio?.database, queued.database);
  const savedPcm = await retainedPcm(queued.database);
  report.retentionAttempt = { beforeClose: queued, session: closedSession, retained: savedPcm };
  // A real microphone can be silent at closure. Storage must retain those samples too.
  assert(savedPcm.exists && savedPcm.rows > 0 && savedPcm.samples > 0, 'Owner closure must retain nonempty real recorded PCM.');
  assert.equal(owners().length, 0);
  assert.equal((await read()).speechPreferences.paused, false);
  pass('Closing the owner retains real queued PCM and its saved session database pointer', { beforeClose: queued, session: closedSession, retained: savedPcm });
  await screenshot('02-owner-closed-backlog-saved', panel);
  const beforeRestartSessionIds = (await read()).audioSessions.map(session => session.id);
  await closeBrowser();

  // No owner tab exists to restore, and this test never sends Start or opens Voice Lab here.
  // Autonomous owner creation therefore exercises actual browser-start initialization.
  // Command-line unpacked loads can emit onInstalled rather than onStartup.
  await launch();
  assert.equal((await read()).speechPreferences.transcriptionMode, 'continuous');
  assert.equal((await read()).speechPreferences.paused, false);
  voice = await eventually('browser-start initialization opens continuous audio owner without a UI request', () => owners()[0], 30000);
  await voice.locator('#sample').waitFor();
  const restarted = await actualTranscript('full browser continuous restart', initial.capture.sessionId);
  assert(!beforeRestartSessionIds.includes(restarted.capture.sessionId));
  assert.equal(owners().length, 1); assert.equal((await liveOwnerContexts()).length, 1);
  const retainedAfterRestart = await retainedPcm(queued.database);
  assert.deepEqual(retainedAfterRestart, savedPcm, 'A full browser restart must retain the same pending PCM bytes.');
  assert.equal((await read()).audioSessions.find(session => session.id === queued.sessionId)?.pendingAudio?.database, queued.database);
  pass('Full Chrome close and same-profile relaunch autonomously resume continuous transcription with one new owner', restarted);
  pass('Queued PCM and its session pointer survive the full Chrome restart byte-for-byte', retainedAfterRestart);
  await screenshot('03-continuous-after-full-restart');

  await voice.locator('#record').click();
  await eventually('explicit Pause stops hardware and drains transcription', async () => (await capture()).phase === 'idle' && !(await read()).audioListening);
  assert.equal((await read()).speechPreferences.paused, true);
  assert.equal((await read()).speechPreferences.transcriptionMode, 'continuous');
  const pausedSessionIds = (await read()).audioSessions.map(session => session.id);
  await screenshot('04-explicit-pause-before-restart');
  await closeBrowser();

  await launch();
  assert.equal((await read()).speechPreferences.paused, true);
  assert.equal((await read()).speechPreferences.transcriptionMode, 'continuous');
  await pause(5000);
  assert.equal(owners().length, 0, 'Paused startup must not create an audio owner.');
  assert.equal((await read()).audioListening, false);
  assert.deepEqual((await read()).audioSessions.map(session => session.id), pausedSessionIds);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Open speech controls', exact: true }).click();
  voice = await eventually('manually opened paused owner', () => owners()[0]);
  await voice.locator('#sample').waitFor();
  await eventually('saved explicit Pause rendered', async () => /paused/i.test(await voice.locator('#mode-detail').textContent()));
  await pause(5000);
  const pausedObservation = await observed();
  assert.equal((await capture()).phase, 'idle'); assert.equal(pausedObservation.requests.length, 0);
  assert.equal((await read()).audioListening, false);
  assert.deepEqual((await read()).audioSessions.map(session => session.id), pausedSessionIds);
  pass('Explicit Pause survives full browser restart and manually reopening Voice Lab without requesting the microphone', { preference: (await read()).speechPreferences, observation: pausedObservation, owner: await liveOwnerContexts() });
  await screenshot('05-pause-survives-full-restart');
  assert.deepEqual(report.requests, [], 'Local restart proof must send no HTTP requests.');
  assert.deepEqual(report.errors, [], 'Unhandled browser errors fail restart proof.');
  report.finalSourceSha256 = await fingerprint();
  assert.deepEqual(report.finalSourceSha256, report.sourceSha256, 'Sources must remain unchanged during the measured browser proof.');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
  if (voice && !voice.isClosed()) await screenshot('failure').catch(() => undefined);
  else if (panel && !panel.isClosed()) await screenshot('failure-panel', panel).catch(() => undefined);
} finally {
  if (panel && !panel.isClosed()) report.finalState = await read().catch(() => undefined);
  if (voice && !voice.isClosed()) { report.finalCapture = await capture().catch(() => undefined); report.finalObservation = await observed().catch(() => undefined); }
  await context?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
  console.log('RESULT:', report.result);
}
