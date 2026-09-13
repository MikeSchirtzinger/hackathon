import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const modelNames = ['nemotron', 'kokoro'];
const required = {
  nemotron: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  kokoro: ['model.int8.onnx', 'voices.bin', 'tokens.txt'],
};

export async function walkFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(dir, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported asset entry: ${name}`);
  }
  return files.sort();
}

export async function modelFiles(base, name) {
  const all = await walkFiles(base);
  for (const file of required[name]) {
    if (!all.includes(file) || (await lstat(path.join(base, file))).size === 0) {
      throw new Error(`${name}: missing or empty ${file}. Run npm run setup:assets.`);
    }
  }
  if (name === 'kokoro') {
    for (const file of ['espeak-ng-data/phondata', 'espeak-ng-data/phonindex', 'espeak-ng-data/phontab', 'espeak-ng-data/en_dict']) {
      if (!all.includes(file) || (await lstat(path.join(base, file))).size === 0) {
        throw new Error(`kokoro: missing or empty ${file}. Run npm run setup:assets.`);
      }
    }
  }
  return all.filter(file => required[name].includes(file) || name === 'kokoro' && file.startsWith('espeak-ng-data/'));
}

export async function prepareModel(base, name, { check = false } = {}) {
  const files = await modelFiles(base, name);
  const destination = path.join(base, 'files.json');
  if (check) {
    const actual = JSON.parse(await readFile(destination, 'utf8'));
    if (JSON.stringify(actual) !== JSON.stringify(files)) throw new Error(`${name}: files.json does not match installed runtime assets. Run npm run prepare:assets.`);
  } else {
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(files, null, 2) + '\n');
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return files.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.join(import.meta.dirname, 'extension/models');
  try {
    for (const name of modelNames) {
      console.log(`${name}: ${await prepareModel(path.join(root, name), name)} runtime assets`);
    }
  } catch (error) {
    console.error(`Asset preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
