import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('.evidence', { recursive: true });
const extensionPath = path.resolve('dist');
const context = await chromium.launchPersistentContext(path.resolve('.evidence/chrome-profile'), {
  executablePath: process.env.CHROME_PATH || '/Users/mike/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true, viewport: { width: 430, height: 1000 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--remote-debugging-port=9347']
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
await writeFile('.evidence/extension-id', extensionId);
console.log(JSON.stringify({ extensionId, worker: worker.url(), chrome: context.browser()?.version() }));
await context.pages()[0].goto(`chrome-extension://${extensionId}/panel.html`);
process.on('SIGTERM', async () => { await context.close(); process.exit(0); });
process.on('SIGINT', async () => { await context.close(); process.exit(0); });
await new Promise(resolve => context.on('close', resolve));
