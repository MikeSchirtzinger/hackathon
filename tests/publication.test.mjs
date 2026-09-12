import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audit, scanText, privateArtifact } from '../scripts/check-publication.mjs';

test('the secret detector fires on real-shaped and supplied values without returning their contents', () => {
  const secret = randomBytes(32).toString('hex');
  for (const text of [secret, Buffer.from(secret).toString('base64'), ['sk', 'proj', randomBytes(32).toString('hex')].join('-')]) {
    const found = scanText(text, [secret]); assert.ok(found.length); assert.ok(!JSON.stringify(found).includes(secret));
  }
});
test('private keys and meeting passcodes cannot pass the publication gate', () => {
  const key = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  assert.ok(scanText(key).some(f => f.rule === 'private-key'));
  assert.ok(scanText('https://team.zoom.us/j/123?pwd=' + randomBytes(12).toString('hex')).some(f => f.rule === 'zoom-passcode'));
  assert.equal(scanText('https://team.zoom.us/j/123?pwd=REDACTED').length, 0);
  const prefix = 'https://team.zoom.us/j/123?pwd=';
  assert.equal(scanText(prefix + 'fixture-only').length, 0);
  assert.ok(scanText(prefix + 'fixture-only' + randomBytes(12).toString('hex')).some(f => f.rule === 'zoom-passcode'));
  assert.ok(scanText(prefix + randomBytes(3).toString('hex')).some(f => f.rule === 'zoom-passcode'));
  assert.ok(scanText(prefix.replace('team.zoom.us', 'TEAM.ZOOM.US') + randomBytes(3).toString('hex')).some(f => f.rule === 'zoom-passcode'));
  assert.ok(scanText(prefix + 'fixture-only', ['fixture-only']).some(f => f.rule === 'known-local-secret'));
});
test('raw captures, secrets, browser state and generated assets are rejected as publication artifacts', () => {
  for (const file of ['.agents/.env', 'private.env', 'video/src/screenshot.png', 'video/frames2/01.mp4', 'video/out/check.png', 'pairing-secret', 'auth.json', '.claude/state.json', 'extension/models/asr.onnx']) assert.equal(privateArtifact(file), true, file);
  for (const file of ['video/concept.py', 'video/build.py', 'docs/AMBIGUOUS.md', '.agents/contracts/local-agent-v1.json', 'extension/public/icon.png', 'tests/evidence/local-agent-live.json']) assert.equal(privateArtifact(file), false, file);
});
test('public placeholders and source references do not become credential findings', () => {
  assert.deepEqual(scanText('Authorization: Bearer ${secret}\nAMBIGUOUS_API_KEY=\nRead credentials from the private environment.'), []);
});
test('the publication gate checks staged bytes even when the working file has been cleaned', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'spark-publication-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    await writeFile(path.join(cwd, 'candidate.txt'), ['sk', 'proj', randomBytes(32).toString('hex')].join('-'));
    execFileSync('git', ['add', 'candidate.txt'], { cwd });
    await writeFile(path.join(cwd, 'candidate.txt'), 'Public source.');
    const result = await audit({ cwd });
    assert.equal(result.result, 'FAIL');
    assert.ok(result.findings.some(f => f.source === 'index' && f.rule === 'provider-token'));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
test('explicit stores must exist and short configured credentials are checked', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'spark-publication-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    await assert.rejects(audit({ cwd, secretFiles: [path.join(cwd, 'missing.env')] }), /Unable to read/);
    const secret = randomBytes(3).toString('hex');
    await writeFile(path.join(cwd, '.gitignore'), '*.env\n');
    const store = path.join(cwd, 'private.env');
    await writeFile(store, 'TEST_PASSWORD=' + secret, { mode: 0o600 });
    await writeFile(path.join(cwd, 'candidate.txt'), secret);
    const result = await audit({ cwd, secretFiles: [store] });
    assert.equal(result.result, 'FAIL');
    assert.ok(result.findings.some(f => f.path === 'candidate.txt' && f.rule === 'known-local-secret'));
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
