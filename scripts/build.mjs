import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('extension/foundation', { recursive: true, force: true });
await mkdir('extension/foundation', { recursive: true });
await cp('extension/public', 'extension', { recursive: true });
await build({ entryPoints: ['extension/src/background.ts', 'extension/src/panel.ts', 'extension/src/popup.ts', 'extension/src/surface-frame.ts'], outdir: 'extension/foundation', bundle: true, format: 'esm', target: 'chrome127', sourcemap: true });
console.log('Load extension/ as the single unpacked Chrome extension.');
