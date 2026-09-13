import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { modelFiles, modelNames, prepareModel, walkFiles } from '../prepare-assets.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(new URL('./speech-assets.json', import.meta.url), 'utf8'));
const { values } = parseArgs({ options: {
  check: { type: 'boolean', default: false },
  offline: { type: 'boolean', default: false },
  target: { type: 'string', default: path.join(root, 'extension') },
  'cache-dir': { type: 'string', default: path.join(root, '.cache/speech-assets') },
  help: { type: 'boolean', short: 'h' },
} });
if (values.help) {
  console.log('Usage: node scripts/setup-speech-assets.mjs [--check] [--offline] [--target directory] [--cache-dir directory]\n\nDownloads and verifies pinned local speech assets. --check performs no writes or network requests.\n--offline permits installation from a previously verified download cache only.');
  process.exit(0);
}
const target = path.resolve(values.target);
const cache = path.resolve(values['cache-dir']);
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancellation.abort(new Error('Setup cancelled.')));

async function digest(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

async function verifyGroup(group, base) {
  const info = await lstat(base);
  if (info.isSymbolicLink() || (group.id === 'sample' ? !info.isFile() : !info.isDirectory())) throw new Error('Expected regular local asset files.');
  const files = group.id === 'sample' ? [''] : (await walkFiles(base)).filter(file => file !== 'files.json' && !file.startsWith('test_wavs/'));
  if (files.length !== group.fileCount) throw new Error(`Expected ${group.fileCount} files, found ${files.length}.`);
  const records = [];
  let bytes = 0;
  for (const file of files) {
    const result = await digest(file ? path.join(base, file) : base);
    bytes += result.bytes;
    records.push([file, result.bytes, result.sha256]);
  }
  if (bytes !== group.installedBytes || createHash('sha256').update(JSON.stringify(records)).digest('hex') !== group.treeSha256) {
    throw new Error('Installed asset checksum mismatch.');
  }
}

async function verifiedDownload(file, expected) {
  try {
    if (!(await lstat(file)).isFile()) return false;
    const result = await digest(file);
    return result.bytes === expected.bytes && result.sha256 === expected.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function httpsResponse(source, signal) {
  let url = new URL(source);
  for (let redirects = 0; redirects <= 10; redirects++) {
    if (url.protocol !== 'https:') throw new Error('Asset downloads require HTTPS.');
    const response = await fetch(url, { signal, redirect: 'manual', credentials: 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Download redirect has no location.');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Download returned HTTP ${response.status}.`); }
    if (!response.body) throw new Error('Download returned an empty response.');
    return response;
  }
  throw new Error('Too many download redirects.');
}

async function download(group) {
  const destination = path.join(cache, group.archive);
  if (await verifiedDownload(destination, group.download)) {
    console.log(`${group.id}: verified cached download`);
    return destination;
  }
  if (values.offline) throw new Error(`${group.id}: verified download is unavailable in the cache. Run again without --offline.`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    cancellation.signal.throwIfAborted();
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      console.log(`${group.id}: downloading ${group.download.bytes} bytes (attempt ${attempt}/3)`);
      const response = await httpsResponse(group.download.source, AbortSignal.any([cancellation.signal, AbortSignal.timeout(15 * 60 * 1000)]));
      const hash = createHash('sha256');
      let bytes = 0;
      let nextProgress = 64 * 1024 * 1024;
      const verifier = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > group.download.bytes) { callback(new Error('Download exceeds the pinned size.')); return; }
        hash.update(chunk);
        if (bytes >= nextProgress) { console.log(`${group.id}: received ${bytes} / ${group.download.bytes} bytes`); nextProgress += 64 * 1024 * 1024; }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      if (bytes !== group.download.bytes || hash.digest('hex') !== group.download.sha256) throw new Error('Download checksum mismatch. Nothing from this download was installed.');
      await rename(temporary, destination);
      return destination;
    } catch (error) {
      if (cancellation.signal.aborted || attempt === 3) throw new Error(`${group.id}: ${error.message}`, { cause: error });
      console.error(`${group.id}: ${error.message} Retrying download.`);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

async function tar(args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'], signal: cancellation.signal });
    let output = '';
    let error = '';
    child.stdout?.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Archive extraction failed: ${error.trim() || `tar exited ${code}`}`)));
  });
}

async function stageGroup(group, archive, staging) {
  const destination = path.join(staging, group.destination);
  await mkdir(path.dirname(destination), { recursive: true });
  if (group.id === 'sample') {
    await cp(archive, destination);
  } else {
    console.log(`${group.id}: extracting verified archive`);
    const extracted = path.join(staging, `extract-${group.id}`);
    await mkdir(extracted);
    const members = (await tar(['-tf', archive], true)).split('\n').filter(Boolean);
    for (const member of members) {
      if (member.startsWith('/') || member.includes('\\') || member.split('/').includes('..')) throw new Error('Archive contains an unsafe path.');
    }
    await tar(['-xf', archive, '-C', extracted]);
    await rename(path.join(extracted, group.archiveRoot), destination);
    if (group.id === 'runtime') await cp(path.join(extracted, 'LICENSE'), path.join(destination, 'LICENSE'));
  }
  for (const supplement of group.supplements || []) {
    const file = await download({ id: `${group.id}/${supplement.destination}`, ...supplement });
    await cp(file, path.join(destination, supplement.destination));
  }
  if (group.notice) await writeFile(path.join(destination, group.notice.file), group.notice.text);
  await verifyGroup(group, destination);
  if (modelNames.includes(group.id)) await prepareModel(destination, group.id);
  return destination;
}

async function acquireLock(lock) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(lock, `${process.pid}\n`, { flag: 'wx' }); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number((await readFile(lock, 'utf8')).trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Unrecognized setup lock at ${lock}.`);
      try { process.kill(pid, 0); }
      catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
        await rm(lock);
        continue;
      }
      throw new Error(`Speech asset setup is already running (process ${pid}).`);
    }
  }
  throw new Error('Could not acquire speech setup lock.');
}

async function install(replacements) {
  const moves = [];
  try {
    for (const replacement of replacements) {
      const destination = path.join(target, replacement.relative);
      await mkdir(path.dirname(destination), { recursive: true });
      const backup = `${destination}.${randomUUID()}.previous`;
      let hadPrevious = false;
      try { await rename(destination, backup); hadPrevious = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const move = { destination, backup, hadPrevious, installed: false };
      moves.push(move);
      await rename(replacement.staged, destination);
      move.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const move of moves.reverse()) {
      try {
        if (move.installed) await rm(move.destination, { recursive: true, force: true });
        if (move.hadPrevious) await rename(move.backup, move.destination);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Asset installation and rollback failed. Previous files remain in .previous paths.');
    throw error;
  }
  for (const move of moves) if (move.hadPrevious) await rm(move.backup, { recursive: true, force: true });
}

async function main() {
  if (manifest.schema !== 1) throw new Error('Unsupported asset manifest version.');
  const missing = [];
  const missingLists = [];
  for (const group of manifest.groups) {
    try {
      await verifyGroup(group, path.join(target, group.destination));
      console.log(`${group.id}: installed checksums verified`);
    } catch (error) {
      console.log(`${group.id}: ${error.code === 'ENOENT' ? 'assets missing' : error.message}`);
      missing.push(group);
      continue;
    }
    if (modelNames.includes(group.id)) {
      try { await prepareModel(path.join(target, group.destination), group.id, { check: true }); }
      catch (error) { console.log(`${group.id}: runtime file list needs preparation`); missingLists.push(group); }
    }
  }
  if (values.check) {
    if (missing.length || missingLists.length) throw new Error('Local speech assets are not ready. Run npm run setup:assets.');
  } else if (missing.length || missingLists.length) {
    await mkdir(target, { recursive: true });
    await mkdir(cache, { recursive: true });
    const lock = path.join(target, '.speech-assets-setup.lock');
    await acquireLock(lock);
    let staging;
    try {
      staging = await mkdtemp(path.join(target, '.speech-assets-stage-'));
      const replacements = [];
      for (const group of missing) {
        const archive = await download(group);
        replacements.push({ relative: group.destination, staged: await stageGroup(group, archive, staging) });
      }
      for (const group of missingLists) {
        // Only the generated list needs repair. Existing verified assets stay in place.
        const files = await modelFiles(path.join(target, group.destination), group.id);
        const staged = path.join(staging, `${group.id}-files.json`);
        await writeFile(staged, JSON.stringify(files, null, 2) + '\n');
        replacements.push({ relative: `${group.destination}/files.json`, staged });
      }
      cancellation.signal.throwIfAborted();
      await install(replacements);
    } finally {
      try { if (staging) await rm(staging, { recursive: true, force: true }); }
      finally { await rm(lock, { force: true }); }
    }
  }
  console.log(`Local speech assets verified at ${target}. Model inference still requires a successful browser run.`);
}

try { await main(); }
catch (error) { console.error(`Speech asset setup failed: ${error.message}`); process.exitCode = 1; }
