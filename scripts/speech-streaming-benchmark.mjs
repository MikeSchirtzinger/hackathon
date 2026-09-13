import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
const extension = path.resolve('extension');
const output = path.resolve(process.env.SPEECH_BENCHMARK_OUTPUT || '.evidence/speech-streaming-benchmark');
await mkdir(output, { recursive: true });
const tailProof = process.argv.includes('--tails');
const segmentSeconds = Number(process.env.SPEECH_SEGMENT_SECONDS || 0);
if (!Number.isFinite(segmentSeconds) || segmentSeconds < 0 || segmentSeconds > 30) throw Error('Invalid speech benchmark segment duration.');
const candidates = process.argv.slice(2).filter(value => value !== '--tails').map(directory => path.resolve(directory));
if (!candidates.length) candidates.push(path.join(extension, 'models/nemotron'));
const report = { startedAt: new Date().toISOString(), command: 'node scripts/speech-streaming-benchmark.mjs ' + process.argv.slice(2).join(' '), candidates: [], segmentSeconds, environment: { CHROME_PATH: process.env.CHROME_PATH, SPEECH_SEGMENT_SECONDS: process.env.SPEECH_SEGMENT_SECONDS }, host: { platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() } };
let activeModel = candidates[0];
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); return response.end('<!doctype html><title>Streaming benchmark</title><pre id="status">Loading local model...</pre>'); }
  if (pathname === '/models/nemotron/files.json') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify(['encoder.int8.onnx','decoder.int8.onnx','joiner.int8.onnx','tokens.txt'])); }
  const base = pathname.startsWith('/models/nemotron/') ? activeModel : extension;
  const filename = path.resolve(base, '.' + (base === activeModel ? pathname.slice('/models/nemotron'.length) : pathname));
  try {
    if (!filename.startsWith(base + path.sep)) throw Error('Invalid path');
    const file = await stat(filename);
    response.setHeader('Content-Length', file.size);
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    createReadStream(filename).pipe(response);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  for (const directory of candidates) {
    activeModel = directory;
    const hash = createHash('sha256'); for await (const chunk of createReadStream(path.join(directory, 'encoder.int8.onnx'))) hash.update(chunk);
    const candidate = { directory, encoderSha256: hash.digest('hex'), runs: [] }; report.candidates.push(candidate);
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--use-mock-keychain'] });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
    candidate.ready = await page.evaluate(async segmentSeconds => {
      const { EngineClient } = await import('/engine-client.js');
      window.engine = new EngineClient('nemotron', { onStatus: message => { document.querySelector('#status').textContent = message; } });
      const ready = await engine.load();
      const context = new AudioContext({ sampleRate: 16000 });
      try {
        const clip = await context.decodeAudioData(await (await fetch('/demo.wav')).arrayBuffer());
        window.pcmBase = new Float32Array(clip.getChannelData(0));
        if (segmentSeconds && segmentSeconds * 16000 < clip.length * 3) throw Error('Segment cannot truncate the benchmark speech.');
        window.pcm = new Float32Array(segmentSeconds ? Math.round(segmentSeconds * 16000) : clip.length * 3);
        for (let repeat = 0; repeat < 3; repeat++) pcm.set(clip.getChannelData(0), repeat * clip.length);
      } finally { await context.close(); }
      return ready;
    }, segmentSeconds);
    for (let run = 0; run < (tailProof ? 6 : 3); run++) {
      const result = await page.evaluate(async ({ tailProof, run }) => {
        if (tailProof) { pcm = new Float32Array(pcmBase.length + run * 3200); pcm.set(pcmBase, run * 3200); }
        const started = performance.now(); await engine.request('start');
        let computeMs = 0, firstTextMs = null, acknowledgements = 0;
        for (let offset = 0; offset < pcm.length; offset += 3200) {
          const result = await engine.request('audio', { samples: pcm.slice(offset, offset + 3200), sampleRate: 16000 });
          computeMs += result.elapsed; acknowledgements++;
          if (firstTextMs === null && result.text) firstTextMs = performance.now() - started;
        }
        const final = await engine.request('finish'); const elapsedMs = performance.now() - started, audioSeconds = pcm.length / 16000;
        return { text: final.text, diagnostics: final.diagnostics, computeMs, elapsedMs, audioSeconds, realtimeFactor: elapsedMs / 1000 / audioSeconds, firstTextMs, acknowledgements };
      }, { tailProof, run });
      assert.equal((result.text.match(/yellow lamps/gi) || []).length, tailProof ? 1 : 3);
      assert.equal((result.text.match(/squalid quarter/gi) || []).length, tailProof ? 1 : 3);
      assert.match(result.text, /brothels$/i);
      assert(result.diagnostics.memoryLimitEnforced);
      candidate.runs.push(result);
      console.log(JSON.stringify({ candidate: path.basename(directory), run: run + 1, ...result }));
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
    await page.evaluate(() => engine.terminate()); await browser.close(); browser = null;
  }
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); report.finishedAt = new Date().toISOString(); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('RESULT:', report.result); }
