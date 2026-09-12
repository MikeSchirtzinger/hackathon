import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.join(import.meta.dirname, 'extension/models');
async function walk(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), name + '/'));
    else files.push(name);
  }
  return files.sort();
}
for (const name of ['nemotron', 'kokoro']) {
  const all = await walk(path.join(root, name));
  const files = all.filter(file => name === 'nemotron'
    ? ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'].includes(file)
    : ['model.int8.onnx', 'voices.bin', 'tokens.txt'].includes(file) || file.startsWith('espeak-ng-data/'));
  if (files.length < 4) throw new Error(`${name}: model assets not yet extracted`);
  await writeFile(path.join(root, name, 'files.json'), JSON.stringify(files, null, 2) + '\n');
  console.log(`${name}: ${files.length} runtime assets`);
}
