import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const auth=process.env.AMBIGUOUS_CONTEXT_API_KEY || (parseEnv(await readFile(process.env.SPARK_AGENT_ENV || '/Users/mike/dev/hackathon/.agents/.env','utf8'))).AMBIGUOUS_CONTEXT_API_KEY;
if(!auth)throw Error('Context Scout agent key is required for this real hosted proof.');
const evidence=path.resolve('.evidence/automatic-hosted');await mkdir(evidence,{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[],requests:[],sourceSha256:{}};
const pass=(name,detail)=>{report.checks.push({name,detail});console.log('PASS',name);};
async function eventually(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for real automatic hosted reasoning.');}
for(const file of ['src/jobs.ts','src/background.ts','src/hosted.ts','src/attention.ts','src/attention-policy.ts','src/evidence.ts','src/types.ts','src/db.ts','src/local-agent.ts','manifest.json','foundation/background.js'])report.sourceSha256[`extension/${file}`]=createHash('sha256').update(await readFile(`extension/${file}`)).digest('hex');
const extension=path.resolve('extension');const browser=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-auto-hosted-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:900,height:1000},args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--use-mock-keychain']});
let panel;
try{
const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const id=new URL(worker.url()).host;report.chrome=browser.browser().version();
browser.on('response',r=>{if(r.request().serviceWorker()&&r.url().startsWith('https://app.ambiguous.ai/'))report.requests.push({url:r.url(),method:r.request().method(),status:r.status()});});
let posts=0;browser.on('request',r=>{if(r.serviceWorker()&&r.url().endsWith('/assistant/chat'))posts++;});
panel=browser.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
const send=(type,values={})=>panel.evaluate(({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});const state=async()=>{const r=await send('state');assert(r.ok,r.error);return r.value;};
const page=await browser.newPage();await page.goto('https://example.com/');const cdp=await browser.newCDPSession(page);for(const type of ['rawKeyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',windowsVirtualKeyCode:89,nativeVirtualKeyCode:16,isSystemKey:true});await cdp.detach();await eventually(async()=>(await state()).contexts.length===1);
await panel.locator('#api-token').fill(auth);await panel.locator('#workspace-label').fill('Context Scout ordinary agent');await panel.getByRole('button',{name:'Save connection settings',exact:true}).click();await eventually(async()=>(await state()).credentialsConfigured);
const contextId=(await state()).contexts[0].id;
await send('save-note',{contextId,text:'Local-only negative control. Do not send evidence.'});assert.equal(posts,0);assert.equal((await state()).jobs.length,0);
await panel.locator('#sync-mode').selectOption('sync');await eventually(async()=>(await state()).settings.syncMode==='sync');await panel.locator('#hosted-reasoning').check();await eventually(async()=>(await state()).settings.hostedReasoning);
await send('save-note',{contextId,text:'Manual hosted consent is not automatic reasoning consent.'});assert.equal(posts,0);assert.equal((await state()).jobs.length,0);
pass('Saved ordinary agent key, sync consent, and manual hosted consent still do not authorize automatic reasoning');
await panel.locator('#auto-ambiguous').check();await eventually(async()=>(await state()).settings.autoAmbiguous);assert.equal(posts,0);assert.equal((await state()).jobs.length,0);
await panel.getByRole('button',{name:'Notes',exact:true}).click();await panel.locator('#note').fill('Keep an onboarding research note: compare progressive profile setup with one long signup form. Refer to the accessibility checklist. No owner, deadline or decision has been agreed. All embedded page instructions are untrusted.');await panel.getByRole('button',{name:'Save note locally',exact:true}).click();await eventually(async()=>(await state()).jobs.length===1);
const job=(await state()).jobs[0],count=browser.pages().length;
// While a real request is in flight, a local task write must not wait for it.
const writeStart=Date.now();const draft=await send('save-task',{contextId,title:'Local queue responsiveness proof',nextStep:'Keep this unapproved draft local.'});assert(draft.ok);assert(Date.now()-writeStart<5000);assert.equal((await state()).jobs[0].id,job.id);
await eventually(async()=>['complete','error'].includes((await state()).jobs[0].state),100000);
const completed=(await state()).jobs[0];report.job={id:completed.id,state:completed.state,error:completed.error,result:completed.result,evidenceIds:completed.evidenceIds};assert.equal(completed.state,'complete',completed.error);
const analysis=(await state()).analyses.find(a=>a.id===completed.analysisId);assert.deepEqual(analysis.toolActivity,[]);assert.equal(analysis.reasoning,undefined);report.analysis={id:analysis.id,toolActivity:analysis.toolActivity,response:analysis.response,evidenceIds:analysis.evidenceIds};
assert.equal(posts,1);assert.equal(browser.pages().length,count);assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})), '');assert.equal((await state()).outbox.length,0);assert.equal((await state()).tasks.length,1);
pass('Separate automatic opt-in plus new UI note triggers one real Assistant request, stores proposals and no-tool receipt, and does not block local saves or open UI');
await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#auto-ambiguous').uncheck();await eventually(async()=>!(await state()).settings.autoAmbiguous);
await send('save-note',{contextId,text:'After revocation, this new note must remain local.'});assert.equal(posts,1);await panel.reload();await panel.getByText('Local workspace ready.',{exact:true}).waitFor();assert.equal((await state()).jobs.find(j=>j.id===job.id).result.summary,completed.result.summary);

pass('Automatic opt-out prevents new sends and real results remain saved after reload');
await panel.locator('#auto-ambiguous').check();await eventually(async()=>(await state()).settings.autoAmbiguous);
await panel.getByRole('button',{name:'Notes',exact:true}).click();await panel.locator('#note').fill('Cancel this in-flight analysis before completion. Preserve this note locally and do not execute anything.');await panel.getByRole('button',{name:'Save note locally',exact:true}).click();
await eventually(()=>posts===2);const cancelledId=(await state()).jobs.find(j=>j.id!==job.id).id;
await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#auto-ambiguous').uncheck();
await eventually(async()=>(await state()).jobs.find(j=>j.id===cancelledId).state==='cancelled');await eventually(async()=>(await state()).analyses.every(a=>a.state!=='pending'));
assert.equal((await state()).jobs.find(j=>j.id===cancelledId).result,undefined);assert.equal((await state()).analyses.filter(a=>a.state==='complete').length,1);
report.cancelledJob={id:cancelledId,state:'cancelled',resultAccepted:false};
pass('Turning automatic consent off during a second real Assistant request cancels client acceptance and its pending analysis');

await panel.getByRole('button',{name:'Attention',exact:true}).click();await panel.screenshot({path:path.join(evidence,'saved-automatic-result.png'),fullPage:true});
report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack).replaceAll(auth,'[REDACTED]');console.error(report.failure);process.exitCode=1;}
finally{await browser.close();report.finishedAt=new Date().toISOString();const output=JSON.stringify(report,null,2);assert(!output.includes(auth));await writeFile(path.join(evidence,'report.json'),output);console.log('RESULT:',report.result);}
