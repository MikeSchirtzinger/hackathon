import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const evidence = path.resolve('.evidence/concept-listening'); await mkdir(evidence, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], sourceSha256: {}, requests: [] };
for (const file of ['src/background.ts','src/surfaces.ts','src/surface-frame.ts','src/types.ts','src/popup.ts','app.js','zoom-asr.js','voice-bridge.js','concept.css','popup.css','surface.css','foundation/background.js','foundation/surface-frame.js']) report.sourceSha256[`extension/${file}`] = createHash('sha256').update(await readFile(`extension/${file}`)).digest('hex');
const pass = (name, detail) => { report.checks.push({ name, detail }); console.log('PASS', name); };
async function eventually(fn, timeout = 15000) { const end = Date.now()+timeout; while (Date.now()<end) { if (await fn()) return; await new Promise(r=>setTimeout(r,100)); } throw Error('Listening surface state timed out.'); }
const wav = await readFile('extension/demo.wav'); report.audio = { kind: 'Real provenance-documented LibriSpeech playback in an authorized local test page', sha256: createHash('sha256').update(wav).digest('hex'), participantDelivery: 'unverified' };
const server = createServer((req,res)=> { if(req.url==='/audio.wav') { res.setHeader('Content-Type','audio/wav'); return res.end(wav); } res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>Real tab audio source</title><style>body{font:20px system-ui;background:#f6f2e8;padding:60px;color:#30322a}h1{font:44px Georgia}</style><h1>Audio capture verification</h1><p>The real sample below plays into authorized tab capture.</p><audio id="audio" controls loop src="/audio.wav"></audio>'); });
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const extension=path.resolve('extension');
const browser=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-listening-')), { executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,viewport:{width:1280,height:800},ignoreDefaultArgs:['--disable-extensions','--mute-audio'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'--use-mock-keychain','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=19335'] });
let voice;
try {
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'); const id=new URL(worker.url()).host;report.chrome=browser.browser().version();
 browser.on('request',r=>{if(r.serviceWorker()&&/^https?:/.test(r.url()))report.requests.push(r.url());});
 const panel=browser.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
 const send=(type,values={})=>panel.evaluate(({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});const state=async()=>(await send('state')).value;
 const page=await browser.newPage();await page.goto(origin);await page.locator('#audio').evaluate(n=>n.play());
 const key=async(k='Y',native=16,code=89)=>{const c=await browser.newCDPSession(page);for(const type of ['rawKeyDown','keyUp'])await c.send('Input.dispatchKeyEvent',{type,modifiers:12,key:k,code:`Key${k}`,nativeVirtualKeyCode:native,windowsVirtualKeyCode:code,isSystemKey:true});await c.detach();};
 await key();await eventually(async()=>(await state()).contexts.length===1);assert.equal((await state()).audioListening,false);assert.equal(await page.locator('[data-spark-surface="listening"]').count(),0);
 const opened=browser.waitForEvent('page');assert((await send('open-voice')).ok);voice=await opened;await voice.waitForURL(`chrome-extension://${id}/index.html`);await voice.locator('#listen-zoom').click();
 await eventually(async()=>(await state()).audioListening,180000);await page.bringToFront();await eventually(async()=>await page.locator('[data-spark-surface="listening"]').count()===1);await page.waitForTimeout(450);
 const session=(await state()).audioSessions.find(s=>s.source==='tab');assert(session.inputActive);assert(session.ownerDocumentId);
 const pill=page.frames().find(f=>f.url().includes('/surface.html#'));await pill.getByText('Spark · listening on device',{exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'01-real-listening.png')});
 await eventually(async()=>/\d+s captured/.test(await voice.locator('#zoom-asr-status').innerText()),30000);
 report.captureStatus=await voice.locator('#zoom-asr-status').innerText();pass('Real tabCapture input and live Voice Lab owner produce the bottom-left listening pill', { inputActive:session.inputActive, captureStatus:report.captureStatus });
 await voice.locator('#stop-zoom').click();await page.bringToFront();await eventually(async()=>!(await state()).audioListening,4000);await eventually(async()=>await page.locator('[data-spark-surface="listening"]').count()===0,4000);
 const after=(await state()).audioSessions.find(s=>s.id===session.id);assert.equal(after.inputActive,false);report.afterStop={inputActive:after.inputActive,captureStatus:after.captureStatus};
 await page.screenshot({path:path.join(evidence,'02-stopped.png')});pass('Stopping input removes the indicator while queued recognition may finish',report.afterStop);
 // Actual action POPUP, inspected through its own CDP target rather than a tab approximation.
 await key('U',32,85);await eventually(async()=>(await worker.evaluate(()=>chrome.runtime.getContexts({}))).some(c=>c.contextType==='POPUP'));
 let target;await eventually(async()=>{target=(await (await fetch('http://127.0.0.1:19335/json/list')).json()).find(t=>t.url===`chrome-extension://${id}/popup.html`);return !!target;});
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let seq=0;const pending=new Map();socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const read=async expression=>(await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 await eventually(async()=>await read('document.body.innerText.includes("Ready. Notes save before reasoning.")'));
 report.popup=await read('({width:innerWidth,height:innerHeight,listeningHidden:document.getElementById("listening").hidden,text:document.body.innerText})');assert.equal(report.popup.width,380);assert(report.popup.height<=600);assert.equal(report.popup.listeningHidden,true);
 const screenshot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(path.join(evidence,'03-native-popup.png'),Buffer.from(screenshot.data,'base64'));socket.close();
 pass('Actual native popup has compact 380px geometry and reflects stopped input', {width:report.popup.width,height:report.popup.height});
 await voice.close();await eventually(async()=>!(await state()).audioListening);assert.equal(report.requests.length,0);assert.deepEqual(await worker.evaluate(()=>chrome.notifications.getAll()),{});pass('Owner closure cannot leave a listening claim; no provider HTTP or system alert');
 report.result='PASS';
} catch(error) { report.result='FAIL';report.failure=String(error.stack);if(voice&&!voice.isClosed())report.voice=await voice.locator('body').innerText();console.error(report.failure);process.exitCode=1; }
finally {await browser.close();server.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('RESULT:',report.result);}
