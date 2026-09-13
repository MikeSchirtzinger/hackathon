import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('extension');
const evidence = path.resolve('.evidence/speech-runtime');
await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), command: 'node scripts/speech-runtime-proof.mjs', checks: [], events: [], errors: [] };
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); return response.end('<!doctype html><title>Local speech runtime proof</title><h1>Local speech runtime proof</h1><pre id="state">Starting real models...</pre>'); }
  try {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
    const file = await stat(filename);
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.wasm') ? 'application/wasm' : filename.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    response.setHeader('Content-Length', file.size); createReadStream(filename).pipe(response);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
function pass(name, detail) { report.checks.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail)); }
try {
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--use-mock-keychain'] });
  report.chrome = browser.version(); page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    window.proofEvents = []; window.workerCount = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.workerCount++; } };
    const { EngineClient } = await import('/engine-client.js');
    window.asr = new EngineClient('nemotron', { onStatus: message => { document.querySelector('#state').textContent = message; }, onLog: message => { window.proofEvents.push(message); if (window.proofEvents.length > 100) window.proofEvents.shift(); } });
    window.tts = new EngineClient('kokoro', { onStatus: message => { document.querySelector('#state').textContent = message; }, onLog: message => { window.proofEvents.push(message); if (window.proofEvents.length > 100) window.proofEvents.shift(); } });
  });
  const ready = await page.evaluate(async () => { const a = asr.load(), b = asr.load(); if (a !== b) throw Error('Duplicate init promise'); return { ...(await a), workerCount }; });
  assert.equal(ready.workerCount, 1); assert(ready.diagnostics.memoryLimitEnforced); assert.equal(ready.diagnostics.wasmLimitBytes, 1536 * 1024 * 1024);
  pass('One real Nemotron initialization has an enforced WASM maximum', ready);
  const sample = await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    try { const audio = await context.decodeAudioData(await (await fetch('/demo.wav')).arrayBuffer()); window.samplePcm = new Float32Array(audio.getChannelData(0)); return { seconds: audio.duration, rate: audio.sampleRate }; }
    finally { await context.close(); }
  });
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const result = await page.evaluate(async () => {
      const start = performance.now(); await asr.request('start'); let computeMs = 0;
      for (let offset = 0; offset < samplePcm.length; offset += 3200) {
        const result = await asr.request('audio', { sampleRate: 16000, samples: samplePcm.slice(offset, offset + 3200) }); computeMs += result.elapsed;
      }
      const final = await asr.request('finish'); return { ...final, computeMs, elapsedMs: performance.now() - start };
    });
    assert.match(result.text, /after early nightfall/i); assert.match(result.text, /yellow lamps/i); assert.match(result.text, /squalid quarter/i);
    assert(result.diagnostics.wasmBytes <= result.diagnostics.wasmLimitBytes); runs.push(result);
    pass(`Real Nemotron sample stream ${run + 1}`, result);
  }
  assert.equal(new Set(runs.map(run => run.text)).size, 1);
  const negative = await page.evaluate(async () => {
    await asr.request('start');
    let oversizedRejected = false;
    try { await asr.request('audio', { sampleRate: 16000, samples: new Float32Array(16001) }); } catch { oversizedRejected = true; }
    for (let index = 0; index < 5; index++) await asr.request('audio', { sampleRate: 16000, samples: new Float32Array(3200) });
    const silence = await asr.request('finish');
    return { oversizedRejected, silence, stream: await asr.request('diagnostics') };
  });
  assert(negative.oversizedRejected); assert.equal(negative.silence.text.trim(), ''); assert.equal(negative.stream.diagnostics.streamSeconds, 0);
  pass('Oversized PCM is rejected and real silence produces no transcript', negative);
  const ttsReady = await page.evaluate(() => tts.load());
  assert(ttsReady.diagnostics.memoryLimitEnforced); assert.equal(ttsReady.diagnostics.wasmLimitBytes, 768 * 1024 * 1024);
  pass('Real Kokoro loads while Nemotron remains available', ttsReady);
  const generations = [];
  for (const text of ['Welcome back.', 'Your saved context is ready for your return.', 'Welcome back.', 'Your saved browser context remains on this device while Spark prepares a helpful voice response '.repeat(3).slice(0, 240)]) {
    const result = await page.evaluate(async text => {
      const result = await tts.request('speak', { text, sid: 0 });
      const samples = result.samples; let sumSquares = 0, peak = 0;
      for (const value of samples) { if (!Number.isFinite(value)) throw Error('Nonfinite generated audio'); sumSquares += value * value; peak = Math.max(peak, Math.abs(value)); }
      return { ...result, samples: undefined, sampleCount: samples.length, seconds: samples.length / result.sampleRate, rms: Math.sqrt(sumSquares / samples.length), peak };
    }, text);
    assert(result.sampleCount > result.sampleRate * .1); assert(result.rms > .001); assert(result.peak <= 1.1);
    assert(result.diagnostics.wasmBytes <= result.diagnostics.wasmLimitBytes); generations.push(result); pass('Real Kokoro generates finite non-silent PCM', result);
  }
  const invalid = await page.evaluate(async () => {
    let invalidVoice = false, tooLong = false;
    try { await tts.request('speak', { text: 'Hello.', sid: 999999 }); } catch { invalidVoice = true; }
    try { await tts.request('speak', { text: 'x'.repeat(501) }); } catch { tooLong = true; }
    return { invalidVoice, tooLong };
  });
  assert(invalid.invalidVoice && invalid.tooLong); pass('Invalid voice and unbounded text are rejected before generation', invalid);
  const cancelled = await page.evaluate(async () => {
    const pending = tts.request('speak', { text: 'This pending speech request must be cancelled immediately.', sid: 0 });
    await new Promise(resolve => setTimeout(resolve, 100));
    tts.terminate(); let rejected = false; try { await pending; } catch { rejected = true; }
    return { rejected, ready: tts.ready };
  });
  assert(cancelled.rejected && !cancelled.ready); pass('Termination rejects pending synthesis and releases worker ownership', cancelled);
  const recovery = await page.evaluate(async () => { const ready = await tts.load(); const result = await tts.request('speak', { text: 'Ready again.', sid: 0 }); return { ready, samples: result.samples.length }; });
  assert(recovery.samples > 1000); pass('Real Kokoro reloads and synthesizes after termination', recovery);
  report.sample = sample; report.runs = runs; report.generations = generations;
  report.events = await page.evaluate(() => proofEvents); assert.deepEqual(report.errors, []);
  report.result = 'PASS';
  await page.evaluate(() => { asr.terminate(); tts.terminate(); document.querySelector('#state').textContent = 'PASS: real Nemotron and Kokoro inference, bounded WASM, negative controls, cancellation and recovery.'; });
  await page.screenshot({ path: path.join(evidence, 'runtime-proof.png') });
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack;
  report.events = page ? await page.evaluate(() => window.proofEvents || []).catch(() => []) : [];
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log('RESULT:', report.result);
}
