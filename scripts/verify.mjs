import {readFile, readdir, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const file of await readdir(path.join(root,'extension'))) {
 if(file.endsWith('.js')) execFileSync(process.execPath,['--check',path.join(root,'extension',file)]);
}
execFileSync('sh',['-n',path.join(root,'install.sh')]);
const manifest=JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));
if(manifest.manifest_version!==3) throw Error('Expected Manifest V3');
for(const file of ['background.js','index.html','demo.wav','vendor/sherpa-onnx-wasm-web.wasm','vendor/sherpa-onnx-wasm-web.js','vendor/sherpa-onnx-asr.js','vendor/sherpa-onnx-tts.js']) await access(path.join(root,'extension',file));
let count=0;
for(const model of ['nemotron','kokoro']) {
 const base=path.join(root,'extension/models',model);
 for(const file of JSON.parse(await readFile(path.join(base,'files.json'),'utf8'))) { await access(path.join(base,file)); count++; }
}
console.log(`PASS: extension JavaScript, installer syntax, manifest and ${count} model assets`);
