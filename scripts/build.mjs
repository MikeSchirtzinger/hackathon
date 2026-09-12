import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('extension/public', 'dist', { recursive: true });
await build({ entryPoints: ['extension/src/background.ts', 'extension/src/panel.ts'], outdir: 'dist', bundle: true, format: 'esm', target: 'chrome120', sourcemap: true });
console.log('Load dist/ as an unpacked Chrome extension.');
