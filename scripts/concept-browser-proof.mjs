import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import path from 'node:path';import os from 'node:os';
const evidence=path.resolve('.evidence/concept-ui');await mkdir(evidence,{recursive:true});
const report={startedAt:new Date().toISOString(),referenceSha256:'4d1883af54245ecaa55f72fc505515d352f48c73b7ed89eb7cad5a9f610325fd',checks:[],requests:[],sourceSha256:{}};
for(const f of ['manifest.json','app.js','zoom-asr.js','voice-bridge.js','src/types.ts','concept.css','popup.css','popup.html','surface.html','surface.css','src/surfaces.ts','src/surface-frame.ts','src/surface-types.ts','src/cards.ts','src/background.ts','src/attention.ts','src/popup.ts','src/panel.ts','public/panel.css','foundation/background.js','foundation/surface-frame.js'])report.sourceSha256[`extension/${f}`]=createHash('sha256').update(await readFile(`extension/${f}`)).digest('hex');
const pass=(name,detail)=>{report.checks.push({name,detail});console.log('PASS',name);};
async function eventually(fn,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,75));}throw Error('Timed out waiting for concept UI state.');}
const wav=await readFile('extension/demo.wav');
const server=createServer((req,res)=>{if(req.url==='/audio.wav'){res.setHeader('Content-Type','audio/wav');return res.end(wav);}const removeSurface=req.url==='/blocked'?`<script>new MutationObserver(()=>{for(const n of document.querySelectorAll('[data-spark-surface]'))n.remove();}).observe(document.documentElement,{childList:true,subtree:true});</script>`:'';res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Concept UI source page</title>${removeSurface}<style>body{font:18px system-ui;background:#f6f2e8;color:#30322a;padding:56px;max-width:750px}h1{font:44px Georgia}textarea{display:block;width:400px;height:80px}</style><h1>Project preparation</h1><p id="selected">Keep the accessibility comparison with the onboarding plan.</p><textarea id="focus" placeholder="Continue your own work here"></textarea><audio id="source-audio" src="/audio.wav" loop controls></audio>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const extension=path.resolve('extension');
const launch=async()=>chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-concept-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions','--mute-audio'],viewport:{width:1280,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--use-mock-keychain','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=19334']});
let browser,panel,worker,page;
const send=(type,values={})=>panel.evaluate(({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});
const state=async()=>{const r=await send('state');assert(r.ok,r.error);return r.value;};
const key=async(k='Y',native=16,code=89)=>{const c=await browser.newCDPSession(page);for(const type of ['rawKeyDown','keyUp'])await c.send('Input.dispatchKeyEvent',{type,modifiers:12,key:k,code:`Key${k}`,windowsVirtualKeyCode:code,nativeVirtualKeyCode:native,isSystemKey:true});await c.detach();};
const surface=()=>page.frames().find(f=>f.url().includes('/surface.html#'));
async function setup(){browser=await launch();worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const id=new URL(worker.url()).host;report.chrome=browser.browser().version();browser.on('request',r=>{if(r.serviceWorker()&&/^https?:/.test(r.url()))report.requests.push({url:r.url(),method:r.method()});});panel=browser.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();page=await browser.newPage();await page.goto(origin);return id;}
try{
let id=await setup();await page.bringToFront();await page.locator('#focus').focus();const count=browser.pages().length;
assert.equal(await page.locator('[data-spark-surface]').count(),0);await key();await eventually(async()=>!!surface()&&await surface().getByText('Context saved',{exact:true}).count()>0);
assert.equal(browser.pages().length,count);assert.equal(await page.evaluate(()=>document.activeElement.id),'focus');assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});assert.equal(await worker.evaluate(()=>chrome.action.getBadgeText({})), '');
const geometry=await page.locator('[data-spark-surface="card"]').boundingBox();assert.equal(geometry.width,380);assert.equal(geometry.x,1280-380-28);assert.equal(geometry.y,28);
const privacy=await page.evaluate(()=>({openShadow:!!document.querySelector('[data-spark-surface]').shadowRoot,visibleIframe:!!document.querySelector('[data-spark-surface] iframe'),isolatedGlobal:typeof globalThis.sparkMounts,attributes:[...document.querySelector('[data-spark-surface]').attributes].map(a=>a.name)}));assert.equal(privacy.openShadow,false);assert.equal(privacy.visibleIframe,false);assert.equal(privacy.isolatedGlobal,'undefined');assert(!privacy.attributes.some(a=>/nonce|token|secret/.test(a)));
await eventually(async()=>await surface().locator('#surface').evaluate(n=>getComputedStyle(n).visibility==='visible'));
await page.waitForTimeout(350);
assert.equal((await surface().evaluate(()=>chrome.runtime.sendMessage({type:'surface-ready',nonce:'00000000-0000-0000-0000-000000000000'}))).ok,false);
await page.emulateMedia({reducedMotion:'reduce'});
assert.equal(await surface().locator('#surface').evaluate(n=>getComputedStyle(n).animationName),'none');
report.captureProjection=await surface().locator('body').innerText();await page.screenshot({path:path.join(evidence,'01-context-card.png')});
assert.equal((await surface().evaluate(()=>chrome.runtime.sendMessage({type:'state'}))).ok,false);
assert.equal((await surface().evaluate(()=>chrome.runtime.sendMessage({type:'credentials',token:'not-a-key'}))).ok,false);
assert.equal((await surface().evaluate(()=>chrome.runtime.sendMessage({type:'save-note',text:'page must not write'}))).ok,false);
assert.equal(await page.evaluate(()=>typeof chrome.runtime?.sendMessage),'undefined');
pass('Real hotkey saves first and shows a 380px isolated upper-right acknowledgement without focus, badge, native alert, or workspace access',geometry);
await eventually(async()=>await page.locator('[data-spark-surface]').count()===0,6000);assert.equal(report.requests.length,0);pass('Capture card disappears automatically; Local only remains zero worker HTTP');
// Public web-accessible frame alone conveys no capability.
await page.evaluate(url=>{const frame=document.createElement('iframe');frame.id='forged-frame';frame.src=url;document.body.append(frame);},`chrome-extension://${id}/surface.html#00000000-0000-0000-0000-000000000000`);
await eventually(()=>page.frames().some(f=>f.url().endsWith('#00000000-0000-0000-0000-000000000000')));const forged=page.frames().find(f=>f.url().endsWith('#00000000-0000-0000-0000-000000000000'));await new Promise(r=>setTimeout(r,150));assert.equal(await forged.locator('body').innerText(),'');await page.locator('#forged-frame').evaluate(n=>n.remove());pass('A page-created surface frame with a forged capability receives no content or privileged operation');
await page.bringToFront();const startsAt=Date.now()+180000;const reminder=await send('save-meeting',{title:'PRIVATE CROSS-SITE MEETING TITLE',joinUrl:`${origin}/joined`,startsAt,remindAt:Date.now()+2500});assert(reminder.ok);
await eventually(async()=>!!surface()&&await surface().getByRole('button',{name:'Join meeting',exact:true}).count()>0);
const actual=surface();
const reminderUrl = actual.url(); const contextsBefore = (await state()).contexts.length;
await page.locator('#focus').focus(); await key();
await eventually(async()=>(await state()).contexts.length===contextsBefore+1);
await page.waitForTimeout(350); assert.equal(surface().url(),reminderUrl);
assert.equal(await page.evaluate(()=>document.activeElement.id),'focus');
assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});
pass('Capture during a live interrupt saves without replacing the actionable reminder or sending a second native alert');
const text=await actual.locator('body').innerText();assert(!text.includes('PRIVATE CROSS-SITE'));assert(!text.includes(reminder.value.id));assert(!text.includes('/joined'));
await eventually(async()=>(await state()).attention.some(a=>a.sourceId===reminder.value.id&&a.deliverySurface==='page'));
assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});await page.screenshot({path:path.join(evidence,'02-meeting-card.png')});
await actual.getByRole('button',{name:'Dismiss Spark card',exact:true}).evaluate(button=>button.click());
assert.equal(surface().url(),reminderUrl);
await actual.getByRole('button',{name:'Join meeting',exact:true}).evaluate(button=>button.click());await new Promise(r=>setTimeout(r,150));assert.equal((await state()).meetings.find(m=>m.id===reminder.value.id).status,'scheduled');
const opened=browser.waitForEvent('page');await actual.getByRole('button',{name:'Join meeting',exact:true}).click();const joined=await opened;await joined.waitForURL(`${origin}/joined`);await eventually(async()=>(await state()).meetings.find(m=>m.id===reminder.value.id).status==='present');
pass('Due reminder uses a generic scoped page card without duplicate system notification; synthetic click is denied and real Join updates lifecycle');
await page.bringToFront();const second=await send('save-meeting',{title:'Budget remains shared',joinUrl:origin,startsAt:Date.now()+180000,remindAt:Date.now()+2000});assert(second.ok);await eventually(async()=>(await state()).attention.length===2);await new Promise(r=>setTimeout(r,2400));assert.equal((await state()).attention.filter(a=>a.mode==='interrupt').length,1);assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});pass('In-page delivery consumes the same ten-minute budget and shelves the next reminder');
// Real popup content and direct lifecycle controls, no fabricated notes or job counts.
const popup=await browser.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.getByText('Ready. Notes save before reasoning.',{exact:true}).waitFor();await popup.getByRole('button',{name:'Mark away',exact:true}).click();await eventually(async()=>(await state()).meetings.find(m=>m.id===reminder.value.id).status==='away');await popup.getByText('You stepped away',{exact:true}).waitFor();await popup.screenshot({path:path.join(evidence,'03-popup-away.png')});await popup.getByRole('button',{name:'Return',exact:true}).click();await eventually(async()=>!!(await state()).absences[0].endAt);assert.match(await popup.locator('#status').innerText(),/Speech stopped/);await popup.close();
await panel.goto(`chrome-extension://${id}/panel.html#attention`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();await panel.screenshot({path:path.join(evidence,'04-review.png')});pass('Matching popup and review cards show real counts and real away/return state without Takeover or missed-item claims');
// Authorize a new document explicitly, then deny an old capability after navigation.
await page.bringToFront();await key();await eventually(async()=>!!surface()&&await surface().getByText('Context saved',{exact:true}).count()>0);const oldUrl=surface().url();await page.goto(`${origin}/new-document`);await page.evaluate(url=>{const f=document.createElement('iframe');f.src=url;document.body.append(f);},oldUrl);await eventually(()=>page.frames().some(f=>f.url()===oldUrl));await new Promise(r=>setTimeout(r,200));assert.equal(await page.frames().find(f=>f.url()===oldUrl).locator('body').innerText(),'');pass('Reload/navigation revokes surface capability even at the same site');
await browser.close();id=await setup();await page.goto(`${origin}/blocked`);await page.bringToFront();await key();await eventually(async()=>(await state()).contexts.length===1);await new Promise(r=>setTimeout(r,2100));assert.equal(await page.locator('[data-spark-surface]').count(),0);
const blocked=await send('save-meeting',{title:'Native delivery when frame unavailable',joinUrl:origin,startsAt:Date.now()+180000,remindAt:Date.now()+2000});assert(blocked.ok);await eventually(async()=>!!(await worker.evaluate(()=>chrome.notifications.getAll()))[`meeting:${blocked.value.id}`]);assert.equal((await state()).attention[0].deliverySurface,'system');assert.equal(await page.locator('[data-spark-surface]').count(),0);pass('Page removal prevents the frame from rendering; real native system notification remains available without a duplicate card');
report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack);report.pageFrames=page?.frames().map(f=>f.url());report.surfaceLeases=await worker?.evaluate(async()=>Object.entries(await chrome.storage.session.get(null)).filter(([k])=>k.startsWith('surface-'))).catch(()=>[]);console.error(report.failure);process.exitCode=1;}
finally{await browser?.close();server.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('RESULT:',report.result);}
