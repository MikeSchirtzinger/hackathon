import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCodex } from '../scripts/spark-codex-worker.mjs';

// Executable fixtures exercise subprocess failures only, never model functionality.
async function executable(t, code) {
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-worker-control-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'fixture.mjs');
  await writeFile(filename, `#!/usr/bin/env node\n${code}`, { mode: 0o700 });
  return { filename, directory };
}
const job = { evidenceIds: ['saved-one'], evidence: { note: 'A test note' } };

test('malformed JSON event and null event reject without crashing parent', async t => {
  for (const line of ['not json', 'null']) {
    const control = await executable(t, `console.log(${JSON.stringify(line)}); setTimeout(()=>{},10000);`);
    await assert.rejects(runCodex(job, { executable: control.filename }), /malformed|invalid event/);
  }
});

test('invalid final output does not escape into the stored diagnostic', async t => {
  const control = await executable(t, `import {writeFileSync} from 'node:fs'; const args=process.argv; writeFileSync(args[args.indexOf('--output-last-message')+1], 'PRIVATE_MODEL_TEXT'); console.log(JSON.stringify({type:'turn.completed'}));`);
  await assert.rejects(runCodex(job, { executable: control.filename }), error => /violated the reasoning contract/.test(error.message) && !error.message.includes('PRIVATE_MODEL_TEXT'));
});

test('tool rejection terminates descendants that inherited output pipes', { skip: process.platform === 'win32' }, async t => {
  const control = await executable(t, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const child=spawn('/bin/sleep',['60'],{stdio:'inherit'});writeFileSync(new URL('./descendant.pid',import.meta.url), String(child.pid)); console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}})); setTimeout(()=>{},10000);`);
  await assert.rejects(runCodex(job, { executable: control.filename, timeoutMs: 5000 }), /Unexpected agent event/);
  const pid = Number(await readFile(path.join(control.directory, 'descendant.pid'), 'utf8'));
  let alive = true;
  for (let i = 0; i < 30; i++) { try { process.kill(pid, 0); } catch { alive = false; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
  if (alive) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  assert.equal(alive, false);
});
