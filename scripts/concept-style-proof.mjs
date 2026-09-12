import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const evidence = path.resolve('.evidence/concept-style'); await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], sourceSha256: {} };
for (const f of ['extension/public/panel.css','extension/panel.css','extension/concept.css']) report.sourceSha256[f] = createHash('sha256').update(await readFile(f)).digest('hex');
const extension = path.resolve('extension');
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-style-')), { executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, viewport: { width: 1280, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--use-mock-keychain','--remote-debugging-port=19335'] });
try {
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const page = context.pages()[0]; await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`); await page.getByText('Local workspace ready.', { exact: true }).waitFor();
 const nav = page.getByRole('button',{name:'Notes',exact:true}); await nav.hover();
 const colors = await nav.evaluate(n=>({color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor}));
 const luminance = color => { const channels = color.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4); return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722; };
 const light = luminance(colors.color), dark = luminance(colors.background), ratio = (Math.max(light,dark)+0.05)/(Math.min(light,dark)+0.05);
 report.checks.push({name:'Inactive review navigation hover meets body-text contrast',pass:ratio>=4.5,ratio,...colors}); await page.screenshot({path:path.join(evidence,'review-hover.png')});
 await page.setViewportSize({width:390,height:844}); const size=await page.locator('#mode').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)); report.checks.push({name:'Narrow review mode label remains readable',pass:size>=11,fontSize:size}); await page.screenshot({path:path.join(evidence,'review-narrow.png')});
 report.result=report.checks.every(c=>c.pass)?'PASS':'FAIL';if(report.result==='FAIL')process.exitCode=1;
} catch(error) {report.result='FAIL';report.error=String(error.stack);process.exitCode=1;}
finally {await context.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
