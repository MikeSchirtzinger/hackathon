import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// A recorded input fixture drives the browser's real getUserMedia pipeline.
// Observers delegate to native workers/media APIs. No model outputs are seeded.
const extension = path.resolve('extension');
const evidence = path.resolve(process.env.SPEECH_LIFECYCLE_OUTPUT || '.evidence/speech-lifecycle');
await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'spark-speech-lifecycle-'));
const microphone = path.join(temp, 'microphone.wav');
execFileSync('ffmpeg', ['-v', 'error', '-stream_loop', '-1', '-i', path.join(extension, 'demo.wav'), '-t', '300', '-ar', '16000', '-ac', '1', microphone]);
const report = {
  startedAt: new Date().toISOString(), command: 'node scripts/speech-lifecycle-proof.mjs',
  input: 'Recorded LibriSpeech WAV repeated through the Chrome file-backed microphone. Actual getUserMedia, AudioWorklet, IndexedDB, Nemotron, Kokoro and browser playback. This is not a physical microphone or participant delivery test.',
  fixtureSha256: createHash('sha256').update(await readFile(microphone)).digest('hex'),
  checks: [], screenshots: [], errors: [], consoleErrors: [], requests: [],
  scope: 'Capture cancellation, reset, output interruption, microphone resume, Return, opt-out, persisted Stop and denied permission. Saved hosted-response queue authority is covered separately by the hosted integration proof.',
};
let context, voice, panel, id;
function pass(name, detail) { report.checks.push({ name, detail }); console.log('PASS', name, detail || ''); }
async function eventually(name, fn, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error(`Timed out: ${name}`);
}
function observeNativeRuntime() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const proof = window.speechLifecycle = { events: [], tracks: [], audioContexts: [], nextWorker: 0 };
  const event = values => proof.events.push({ at: Date.now(), ...values });
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args); this.proofId = proof.audioContexts.length + 1; proof.audioContexts.push(this);
      event({ type: 'audio-context-created', context: this.proofId, sampleRate: this.sampleRate, state: this.state });
      this.addEventListener('statechange', () => event({ type: 'audio-context-state', context: this.proofId, sampleRate: this.sampleRate, state: this.state }));
    }
    resume() { event({ type: 'audio-context-resume', context: this.proofId, state: this.state }); return super.resume(); }
    close() { event({ type: 'audio-context-close', context: this.proofId, state: this.state }); return super.close(); }
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args); this.proofId = ++proof.nextWorker;
      event({ type: 'worker-created', worker: this.proofId });
      this.addEventListener('message', ({ data }) => {
        if (!['ready', 'audio-result', 'final', 'error'].includes(data.type)) return;
        const samples = data.samples;
        event({ type: data.type, worker: this.proofId, kind: this.proofKind,
          requestId: data.requestId, text: data.text, message: data.message, diagnostics: data.diagnostics,
          samples: samples?.length, energy: samples?.length ? samples.reduce((sum, value) => sum + value * value, 0) / samples.length : undefined });
      });
    }
    postMessage(data, ...rest) {
      if (data.type === 'init') this.proofKind = data.kind;
      if (['init', 'speak', 'start', 'finish'].includes(data.type)) event({ type: `request-${data.type}`, worker: this.proofId, kind: this.proofKind, requestId: data.requestId });
      return super.postMessage(data, ...rest);
    }
    terminate() { event({ type: 'worker-terminated', worker: this.proofId, kind: this.proofKind }); return super.terminate(); }
  };
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    event({ type: 'media-requested' });
    try {
      const stream = await nativeGetUserMedia(...args);
      for (const track of stream.getTracks()) { proof.tracks.push(track); track.addEventListener('ended', () => event({ type: 'track-ended', id: track.id })); }
      event({ type: 'media-granted', ids: stream.getTracks().map(track => track.id) });
      return stream;
    } catch (error) { event({ type: 'media-denied', name: error.name, message: error.message }); throw error; }
  };
  window.addEventListener('capture-state', ({ detail }) => event({ type: 'capture-state', phase: detail.phase, source: detail.source, message: detail.message }));
  window.addEventListener('speech-output-stopped', ({ detail }) => event({ type: 'output-stopped', reason: detail.reason }));
  document.addEventListener('DOMContentLoaded', () => {
    const player = document.getElementById('playback');
    if (player) for (const type of ['playing', 'ended', 'pause']) player.addEventListener(type, () => event({ type: `playback-${type}`, time: player.currentTime, liveTracks: proof.tracks.filter(track => track.readyState === 'live').length,
      audioContexts: proof.audioContexts.map(context => ({ id: context.proofId, sampleRate: context.sampleRate, state: context.state })) }));
  });
}
const read = () => panel.evaluate(async () => {
  const response = await chrome.runtime.sendMessage({ type: 'state' });
  if (!response.ok) throw Error(response.error); return response.value;
});
const observed = () => voice.evaluate(() => ({
  events: window.speechLifecycle.events,
  tracks: window.speechLifecycle.tracks.map(track => ({ id: track.id, state: track.readyState, enabled: track.enabled })),
  audioContexts: window.speechLifecycle.audioContexts.map(context => ({ id: context.proofId, sampleRate: context.sampleRate, state: context.state })),
}));
const capture = () => voice.evaluate(async () => {
  const { captureSession: session } = await import('./app.js');
  return { phase: session.phase, kind: session.kind, ready: session.engine.ready, captured: session.captured,
    sessionId: session.writer?.session?.id, queueSamples: session.queue?.samples || 0 };
});
async function screenshot(name) {
  const target = path.join(evidence, `${name}.png`);
  await voice.screenshot({ path: target, fullPage: true }); report.screenshots.push(target);
}
async function idle(name) {
  await eventually(name, async () => (await capture()).phase === 'idle' && !(await read()).audioListening);
  const state = await observed();
  assert(state.tracks.every(track => track.state === 'ended'), 'Every acquired track must be stopped.');
  assert(state.audioContexts.every(context => context.state === 'closed'), 'Explicit idle must release every native AudioContext after queued decoding finishes.');
}
async function freshTranscript(name, priorId) {
  await eventually(`${name}: listening`, async () => (await read()).audioListening && (await capture()).sessionId !== priorId);
  const session = await capture();
  await eventually(`${name}: actual decoded source words`, async () => (await read()).transcripts.some(segment => segment.sessionId === session.sessionId && segment.text.trim().length > 15 && /nightfall|yellow|lamps|street|city|quarter/i.test(segment.text)));
  const segments = (await read()).transcripts.filter(segment => segment.sessionId === session.sessionId);
  assert(segments.some(segment => /nightfall|yellow|lamps|street|city|quarter/i.test(segment.text)), 'The real transcript must contain words from the recorded input.');
  const { audioContexts } = await observed();
  const active = audioContexts.filter(context => context.state !== 'closed');
  assert.equal(active.length, 1, 'Capture must own exactly one active AudioContext; prior capture/output contexts must be closed.');
  assert.equal(active[0].sampleRate, 16000); assert.equal(active[0].state, 'running');
  return { session, segments, audioContexts };
}
async function speakUntilPlaying(text) {
  const before = (await observed()).events.length;
  await voice.locator('#speech').fill(text); await voice.locator('#speak').click();
  await eventually('actual Kokoro playback', async () => (await observed()).events.slice(before).some(event => event.type === 'playback-playing'));
  const events = (await observed()).events.slice(before);
  assert(events.some(event => event.type === 'audio-result' && event.samples > 1000 && event.energy > 0.00001), 'Kokoro must produce real non-silent PCM.');
  assert.equal(await voice.locator('#playback').evaluate(player => player.paused), false);
  const state = await observed();
  assert(state.tracks.every(track => track.state === 'ended'), 'Input tracks must stop before speech plays.');
  const active = state.audioContexts.filter(context => context.state !== 'closed');
  assert.equal(active.length, 1, 'Playback must own exactly one active AudioContext; prior capture/output contexts must be closed.');
  assert.equal(active[0].sampleRate, 24000); assert.equal(active[0].state, 'running');
  return { before, events, audioContexts: state.audioContexts };
}
try {
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1200, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--use-mock-keychain',
      '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`,
      ...(process.env.SPEECH_CDP_PORT ? [`--remote-debugging-port=${process.env.SPEECH_CDP_PORT}`] : [])],
  });
  await context.addInitScript(observeNativeRuntime);
  context.on('request', request => { if (/^https?:/.test(request.url())) report.requests.push({ method: request.method(), url: request.url() }); });
  context.on('page', page => {
    page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ url: page.url(), message: message.text() }); });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).host; report.extensionId = id; report.chrome = context.browser().version();
  panel = context.pages()[0]; await panel.goto(`chrome-extension://${id}/panel.html`);
  const permission = await context.newCDPSession(panel);
  await permission.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'granted' });
  await panel.getByText('Local workspace ready.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Open speech controls', exact: true }).click();
  await eventually('voice owner opens', async () => { voice = context.pages().find(page => page.url().endsWith('/index.html')); return !!voice; });
  await voice.locator('#sample').waitFor();
  assert.equal((await read()).speechPreferences.paused, true);

  await voice.locator('#record').click();
  await eventually('real Nemotron init begins', async () => (await observed()).events.some(event => event.type === 'request-init' && event.kind === 'nemotron'));
  const loading = await observed();
  assert(!loading.events.some(event => event.type === 'ready' && event.kind === 'nemotron'), 'Cancellation must occur during initialization, before ready.');
  const cancelledId = (await capture()).sessionId;
  await voice.locator('#record').click(); await idle('cancelled initialization stops capture');
  assert((await observed()).events.some(event => event.type === 'worker-terminated' && event.kind === 'nemotron'));
  assert(!(await observed()).events.some(event => event.type === 'ready' && event.kind === 'nemotron'), 'The cancelled worker must not reach ready before Stop.');
  assert.equal((await read()).audioSessions.find(session => session.id === cancelledId).captureStatus, 'stopped');
  await screenshot('01-cancel-during-initialization');
  await voice.locator('#record').click();
  const restarted = await freshTranscript('restart after cancelled init', cancelledId);
  pass('Cancel during real model initialization releases tracks and fresh Start transcribes', restarted);
  await screenshot('02-restart-after-cancel');

  await voice.locator('#reset').click(); await idle('Reset stops capture');
  await eventually('Reset releases model', async () => !(await capture()).ready && /Models released/.test(await voice.locator('#memory-status').textContent()));
  assert.equal((await read()).speechPreferences.paused, true);
  await voice.locator('#record').click();
  const resetRestart = await freshTranscript('restart after Reset', restarted.session.sessionId);
  pass('Reset releases the real model and fresh Start reloads and transcribes', resetRestart);
  await voice.locator('#record').click(); await idle('stop before continuous mode');
  await voice.locator('#transcription-mode').selectOption('continuous');
  const continuous = await freshTranscript('continuous capture', resetRestart.session.sessionId);

  const played = await speakUntilPlaying('Your saved context is ready. This response plays through the browser while microphone transcription waits until speech stops.');
  assert.equal((await read()).audioListening, false);
  await screenshot('03-continuous-paused-for-kokoro');
  pass('Continuous microphone input is released before actual Kokoro playback', played.events);
  await voice.locator('#stop-output').click();
  const resumed = await freshTranscript('continuous resume after Stop audio', continuous.session.sessionId);
  assert.equal(await voice.locator('#playback').getAttribute('src'), null);
  pass('Stop audio cancels playback and continuous microphone resumes', resumed);

  // Stop during synthesis, then immediately issue a replacement through the UI.
  await voice.locator('#speech').fill('This pending sentence will be stopped before its replacement is requested.');
  const beforePending = (await observed()).events.length;
  await voice.locator('#speak').click();
  await eventually('pending real synthesis', async () => (await observed()).events.slice(beforePending).some(event => event.type === 'request-speak'));
  await voice.locator('#stop-output').click();
  const replacement = await speakUntilPlaying('The replacement response is now playing locally. Your saved work remains available.');
  await voice.locator('#stop-output').click();
  await freshTranscript('continuous resume after replacement', resumed.session.sessionId);
  pass('A stopped synthesis request cannot steal the replacement or prevent microphone resume', replacement.events);
  await screenshot('04-resumed-after-replacement');

  // Only meeting lifecycle state is a direct fixture. Synthesis remains real.
  const meetingId = await panel.evaluate(async () => {
    const id = crypto.randomUUID(), now = Date.now();
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('context-carry', 4); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['meetings', 'absences'], 'readwrite');
      tx.objectStore('meetings').put({ id, createdAt: now, revision: 1, title: 'Speech lifecycle control fixture', status: 'away', startsAt: now + 600000, remindAt: now + 590000, joinUrl: 'https://example.com/', captureStatus: 'unavailable', speechStatus: 'unavailable' });
      tx.objectStore('absences').put({ id: crypto.randomUUID(), meetingId: id, startAt: now - 1000, createdAt: now, revision: 1 });
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    }); db.close(); return id;
  });
  await panel.reload(); await panel.getByText('Local workspace ready.', { exact: true }).waitFor();
  const beforeReturn = (await observed()).events.length;
  await voice.locator('#speech').fill('This response must stop when the person returns to the meeting.'); await voice.locator('#speak').click();
  await eventually('Return test actual synthesis starts', async () => (await observed()).events.slice(beforeReturn).some(event => event.type === 'request-speak'));
  await panel.getByRole('button', { name: 'Meeting', exact: true }).click();
  await panel.locator(`[data-meeting-id="${meetingId}"]`).getByRole('button', { name: 'Return', exact: true }).click();
  await eventually('Return stops output', async () => (await read()).meetings.find(meeting => meeting.id === meetingId)?.status === 'present' && !(await voice.locator('#speak').isDisabled()));
  assert.equal(await voice.locator('#playback').getAttribute('src'), null);
  assert((await observed()).events.slice(beforeReturn).some(event => event.type === 'worker-terminated' && event.kind === 'kokoro'));
  pass('Return cancels real pending Kokoro generation using a meeting control fixture', { meetingId, events: (await observed()).events.slice(beforeReturn) });

  // An actual browser speech request establishes the positive control before opt-out.
  await voice.locator('#voice-responses').check();
  const optedIn = await speakUntilPlaying('Voice response playback is enabled. The next action disables it and must silence this audio.');
  await voice.locator('#voice-responses').uncheck();
  await eventually('opt-out stops playback', async () => !(await read()).speechPreferences.voiceResponses && await voice.locator('#playback').getAttribute('src') === null);
  pass('Opt-out cancels already playing real Kokoro audio', optedIn.events);
  await eventually('microphone resumes after opt-out', async () => (await read()).audioListening);
  await voice.locator('#record').click(); await idle('explicit Stop before reload');
  assert.equal((await read()).speechPreferences.paused, true);
  report.beforeReload = await observed();
  const sessionsBeforeReload = (await read()).audioSessions.length;
  await voice.reload(); await voice.locator('#sample').waitFor();
  await eventually('preferences restored after reload', async () => /paused/.test(await voice.locator('#mode-detail').textContent()));
  assert.equal((await read()).audioListening, false);
  assert.equal((await read()).audioSessions.length, sessionsBeforeReload);
  assert(!(await observed()).events.some(event => event.type === 'media-requested'));
  pass('Explicit Stop remains paused after owner reload without a microphone request');
  await screenshot('05-explicit-stop-survives-reload');

  // Denial is the browser permission state, never a replacement getUserMedia function.
  await permission.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied' });
  const denialBefore = (await read()).audioSessions.length;
  await voice.locator('#record').click();
  await eventually('real browser permission denied', async () => (await observed()).events.some(event => event.type === 'media-denied'));
  await idle('denied permission returns idle');
  const denied = await read();
  assert.equal(denied.audioSessions.length, denialBefore + 1);
  assert(denied.audioSessions.some(session => session.captureStatus === 'error' && /denied|permission|allowed/i.test(session.detail || '')));
  assert.match(await voice.locator('#asr-status').textContent(), /microphone.*denied|microphone.*permission|microphone.*allowed/i);
  assert(!(await observed()).events.some(event => event.type === 'media-granted'));
  await screenshot('06-permission-denied');
  pass('Native microphone permission denial stops capture with a visible error and no live tracks', await observed());
  await permission.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'granted' });
  await voice.locator('#record').click();
  const recovered = await freshTranscript('restart after native permission grant');
  pass('Fresh Start recovers after a real permission denial', recovered);
  await voice.locator('#record').click(); await idle('final explicit Stop');
  await permission.detach();
  await screenshot('07-final-stopped');
  assert.deepEqual(report.requests, [], 'Local speech must make no HTTP requests.');
  assert.deepEqual(report.errors, [], 'Unhandled browser errors fail the lifecycle proof.');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
  if (voice && !voice.isClosed()) await screenshot('failure').catch(() => undefined);
} finally {
  if (voice && !voice.isClosed()) { report.finalObservation = await observed().catch(() => undefined); report.finalCapture = await capture().catch(() => undefined); }
  if (panel && !panel.isClosed()) report.finalState = await read().catch(() => undefined);
  await context?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await rm(temp, { recursive: true, force: true });
  console.log('RESULT:', report.result);
}
