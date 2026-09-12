import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['provider-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g],
  ['literal-bearer', /\bBearer [A-Za-z0-9_.~+/-]{24,}={0,2}/g],
  ['zoom-passcode', /https:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/[^\s"'`<>]*[?&](?:pwd|passcode)=(?!(?:REDACTED|redacted|example|fixture-only)(?=[&#\s"'`<>]|$))[A-Za-z0-9%._+-]{4,}/gi],
];

export function scanText(text, knownSecrets = []) {
  const findings = [];
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) findings.push({ rule, line: text.slice(0, match.index).split('\n').length });
  }
  for (const secret of knownSecrets) {
    const variants = new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]);
    for (const value of variants) {
      const offset = text.indexOf(value);
      if (offset >= 0) findings.push({ rule: 'known-local-secret', line: text.slice(0, offset).split('\n').length });
    }
  }
  return [...new Map(findings.map(f => [`${f.rule}:${f.line}`, f])).values()];
}

export function privateArtifact(filename) {
  if (/(?:^|\/)(?:\.claude|\.codex|\.local|node_modules|\.evidence|\.secrets|browser-profiles|chrome-profile)(?:\/|$)/.test(filename)) return true;
  if (/^(?:video\/(?:src|out|audio[^/]*|frames[^/]*)\/|extension\/(?:models|vendor|foundation)\/)/.test(filename)) return true;
  if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.env|pairing-secret|bridge\.lock|auth\.json|credentials(?:\.[^/]+)?\.json|storageState[^/]*\.json|cookies[^/]*\.json|\.netrc|\.npmrc|\.pypirc|\.git-credentials)$/.test(filename)) return true;
  return /\.(?:onnx|bin|wav|mp4|mov|webm|mp3|m4a|flac|ogg|pem|key|p12|pfx|pyc)$/i.test(filename);
}

const git = (cwd, args, options = {}) => execFileSync('git', args, { cwd, maxBuffer: 128 * 1024 * 1024, ...options });
export async function audit({ cwd = process.cwd(), history = false, secretFiles = [] } = {}) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const explicitStores = new Set(secretFiles.map(filename => path.resolve(cwd, filename)));
  const stores = [...new Set([path.join(root, '.env'), path.join(root, '.agents/.env'), path.join(homedir(), 'ADA/.agents/.env'), ...explicitStores])];
  const secrets = new Set(); const permissions = [];
  for (const filename of stores) {
    try {
      const contents = parseEnv(await readFile(filename, 'utf8'));
      for (const [name, value] of Object.entries(contents)) if (/(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(name) && value.length) secrets.add(value);
      const mode = (await stat(filename)).mode & 0o777;
      if (mode & 0o077) permissions.push({ path: filename, rule: 'private-store-permissions', mode: mode.toString(8) });
    } catch (error) { if (error.code !== 'ENOENT' || explicitStores.has(filename)) throw new Error('Unable to read a configured local secret store.'); }
  }
  const pairingFile = path.join(homedir(), '.local/share/spark/agent-bridge/pairing-secret');
  try {
    secrets.add((await readFile(pairingFile, 'utf8')).trim());
    const mode = (await stat(pairingFile)).mode & 0o777;
    if (mode & 0o077) permissions.push({ path: pairingFile, rule: 'private-store-permissions', mode: mode.toString(8) });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  secrets.delete('');
  const files = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
  const findings = [...permissions];
  for (const filename of files) {
    if (privateArtifact(filename)) findings.push({ path: filename, rule: 'private-or-generated-artifact' });
    let content; try { content = await readFile(path.join(root, filename)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const finding of scanText(content.toString('utf8'), [...secrets])) findings.push({ path: filename, ...finding });
  }
  const index = git(root, ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const indexedBlobs = new Set();
  for (const entry of index) {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' '); const filename = entry.slice(tab + 1);
    if (mode === '160000') continue;
    indexedBlobs.add(oid);
    const content = git(root, ['cat-file', 'blob', oid]);
    for (const finding of scanText(content.toString('utf8'), [...secrets])) findings.push({ path: filename, source: 'index', stage: Number(stage), ...finding });
  }
  let blobs = 0;
  if (history) {
    const objects = git(root, ['rev-list', '--objects', '--all'], { encoding: 'utf8' }).trim().split('\n');
    const names = new Map(objects.map(line => { const space = line.indexOf(' '); return space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)]; }));
    const types = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { encoding: 'utf8', input: [...names.keys()].join('\n') + '\n' }).trim().split('\n');
    for (const entry of types) {
      const [oid, type] = entry.split(' '); if (type !== 'blob') continue;
      blobs++;
      const content = git(root, ['cat-file', 'blob', oid]);
      for (const finding of scanText(content.toString('utf8'), [...secrets])) findings.push({ path: names.get(oid), blob: oid, ...finding });
    }
  }
  return { result: findings.length ? 'FAIL' : 'PASS', files: files.length, indexBlobs: indexedBlobs.size, historyBlobs: blobs, localSecretValuesChecked: secrets.size, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const secretFiles = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--history') continue;
    if (args[index] === '--secret-file' && args[index + 1]) secretFiles.push(path.resolve(args[++index]));
    else throw new Error('Usage: node scripts/check-publication.mjs [--history] [--secret-file PATH]');
  }
  try { const result = await audit({ history: args.includes('--history'), secretFiles }); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.result === 'PASS' ? 0 : 1; }
  catch { console.error('Publication audit could not finish. No secret values were printed.'); process.exitCode = 2; }
}
