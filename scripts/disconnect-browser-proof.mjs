import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
const evidence=path.resolve('.evidence/disconnect');await mkdir(evidence,{recursive:true});
const secret=(await readFile(path.join(os.homedir(),'.local/share/spark/agent-bridge/pairing-secret'),'utf8')).trim();
const report={startedAt:new Date().toISOString(),checks:[],requests:[],sourceSha256:{}};
for(const file of ['src/jobs.ts','src/local-agent.ts','src/background.ts','src/hosted.ts','src/attention.ts','src/attention-policy.ts','foundation/background.js'])report.sourceSha256[`extension/${file}`]=createHash('sha256').update(await readFile(`extension/${file}`)).digest('hex');
async function eventually(fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for real disconnect state.');}
const pass=name=>{report.checks.push({name});console.log('PASS',name);};
const extension=path.resolve('extension');const browser=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-disconnect-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:false,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:900,height:950},args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--use-mock-keychain','--remote-debugging-port=19334']});
try{
const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const id=new URL(worker.url()).host;report.chrome=browser.browser().version();
browser.on('response',r=>{if(r.request().serviceWorker()&&r.url().startsWith('http://127.0.0.1:4318'))report.requests.push({url:r.url(),method:r.request().method(),status:r.status()});});
const panel=browser.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
const send=(type,values={})=>panel.evaluate(({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});const state=async()=>(await send('state')).value;
const source=await browser.newPage();await source.goto('https://example.com/');const cdp=await browser.newCDPSession(source);for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',windowsVirtualKeyCode:89,nativeVirtualKeyCode:16,isSystemKey:true});await cdp.detach();await eventually(async()=>(await state()).contexts.length===1);
const popup=await browser.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.getByText('Ready. Notes save before reasoning.',{exact:true}).waitFor();await popup.locator('summary').click();await popup.locator('#pairing-secret').fill(secret);await popup.bringToFront();await popup.locator('#connect-local').click();console.log('Connect clicked in foreground popup document.');await eventually(async()=>(await state()).localAgent.connected,120000);await popup.close();await panel.bringToFront();
await panel.locator('#sync-mode').selectOption('sync');await eventually(async()=>(await state()).settings.syncMode==='sync');await panel.locator('#auto-local').check();await eventually(async()=>(await state()).settings.autoLocalAgent);
await panel.getByRole('button',{name:'Notes',exact:true}).click();await panel.locator('#note').fill('A real in-flight disconnect check. Compare onboarding patterns and accessibility, but do not execute any proposals.');await panel.getByRole('button',{name:'Save note locally',exact:true}).click();
await eventually(()=>report.requests.some(r=>r.method==='POST'&&r.url.endsWith('/v1/jobs')&&r.status===202||r.method==='POST'&&r.url.endsWith('/v1/jobs')&&r.status===200));
const job=(await state()).jobs[0];assert.equal(job.state,'running');
await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#disconnect-local').click();
await eventually(async()=>!(await state()).localAgent.connected);await eventually(async()=>(await state()).jobs.find(j=>j.id===job.id).cancelDelivery==='confirmed');
const cancelled=(await state()).jobs.find(j=>j.id===job.id);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.result,undefined);
const readback=await fetch(`http://127.0.0.1:4318/v1/jobs/${job.id}`,{headers:{Authorization:`Bearer ${secret}`}});assert.equal(readback.status,200);const remote=await readback.json();assert.equal(remote.state,'cancelled');report.receipt={id:job.id,clientState:cancelled.state,cancelDelivery:cancelled.cancelDelivery,remoteState:remote.state,readbackStatus:readback.status};
const authCleared=await worker.evaluate(async()=>!((await chrome.storage.local.get('localAgentPairing')).localAgentPairing?.secret));assert(authCleared);
pass('In-flight Disconnect clears saved pairing and reaches real bridge cancellation using the previous secret, with actual GET readback');
assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})), '');
await panel.getByRole('button',{name:'Attention',exact:true}).click();await panel.screenshot({path:path.join(evidence,'cancelled.png'),fullPage:true});
report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack).replaceAll(secret,'[REDACTED]');console.error(report.failure);process.exitCode=1;}
finally{await browser.close();report.finishedAt=new Date().toISOString();const output=JSON.stringify(report,null,2);assert(!output.includes(secret));await writeFile(path.join(evidence,'report.json'),output);console.log('RESULT:',report.result);}
