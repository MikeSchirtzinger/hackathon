import {cp, mkdir} from 'node:fs/promises';
import path from 'node:path';
const source = process.argv[2];
if (!source) throw Error('Usage: node scripts/import-assets.mjs /path/to/existing/extension');
const target = path.resolve(import.meta.dirname, '../extension');
await mkdir(target, {recursive:true});
for (const item of ['models', 'vendor', 'demo.wav']) {
  await cp(path.join(path.resolve(source),item), path.join(target,item), {recursive:true});
}
console.log('Imported local inference assets. Run npm run verify.');
