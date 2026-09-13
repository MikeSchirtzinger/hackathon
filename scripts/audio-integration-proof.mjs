import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const evidence = path.resolve('.evidence/audio-integration');
await mkdir(evidence,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'carry-audio-'));
const extension=path.resolve('extension');
const report={startedAt:new Date().toISOString(),checks:[],errors:[],sampleSha256:createHash('sha256').update(await readFile('extension/demo.wav')).digest('hex')};
function pass(name,detail){report.checks.push({name,detail,at:new Date().toISOString()});console.log('PASS',name,detail??'');}
async function eventually(fn,timeout=20000){const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for real audio integration state.');}
const launch=()=>chromium.launchPersistentContext(profile,{...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chromium'}),headless:true,viewport:{width:1100,height:1000},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--use-mock-keychain']});
let context;
try{
 context=await launch();report.chrome=context.browser().version();
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;report.extensionId=id;
 let panel=context.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);
 await panel.getByText('Local workspace ready.',{exact:true}).waitFor();await panel.getByRole('button',{name:'Notes',exact:true}).click();
 const readState=()=>panel.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'state'});if(!r.ok)throw Error(r.error);return r.value;});
 const control=(type,values={})=>panel.evaluate(async({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});
 const sourcePage=await context.newPage();await sourcePage.goto('https://example.com/');
 const keyboard=await context.newCDPSession(sourcePage);
 for(const type of ['rawKeyDown','keyUp'])await keyboard.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',windowsVirtualKeyCode:89,nativeVirtualKeyCode:16,isSystemKey:true});
 await keyboard.detach();await eventually(async()=>(await readState()).contexts.length===1);
 const capturedContext=(await readState()).contexts[0];
 const opened=context.waitForEvent('page');await panel.getByRole('button',{name:'Open Voice Lab',exact:true}).click();
 let voice=await opened;await voice.waitForURL(`chrome-extension://${id}/index.html`);
 await voice.locator('#sample').waitFor();
 await voice.evaluate(() => {
   window.audioProofEvents = [];
   const record = value => window.audioProofEvents.push({ at: Date.now(), visibility: document.visibilityState, ...value });
   const NativeWorker = window.Worker;
   window.Worker = class extends NativeWorker {
     constructor(...args) { super(...args); this.addEventListener('message', ({data}) => { if (['ready','started','transcript','final','audio-result','error'].includes(data.type)) record({ type:data.type, kind:this.proofKind, elapsed:data.elapsed, requestId:data.requestId, speechEpoch:data.speechEpoch, diagnostics:data.diagnostics, text:data.text, phase:window.audioProofPhase }); }); }
     terminate() { record({type:'worker-terminated',kind:this.proofKind}); super.terminate(); }
     postMessage(data,...rest) { if(data.type==='init')this.proofKind=data.kind; if(['init','start','audio','finish','speak'].includes(data.type)) record({type:data.type+'-request',kind:this.proofKind,requestId:data.requestId,speechEpoch:data.speechEpoch,phase:window.audioProofPhase,samples:data.samples?.length}); return super.postMessage(data,...rest); }
   };
   new MutationObserver(() => record({ type:'status', text:document.getElementById('tts-status').textContent })).observe(document.getElementById('tts-status'), { childList:true, subtree:true, characterData:true });
   new MutationObserver(() => record({ type:'asr-status', text:document.getElementById('asr-status').textContent })).observe(document.getElementById('asr-status'), { childList:true, subtree:true, characterData:true });
   window.addEventListener('capture-state',({detail})=>record({type:'capture-state',phase:detail.phase,capturedSeconds:detail.capturedSeconds,decodedSeconds:detail.decodedSeconds,queuedSeconds:detail.queuedSeconds,message:detail.message}));
   document.addEventListener('visibilitychange', () => record({ type:'visibility' }));
 });
 await voice.evaluate(()=>{location.hash='audio-controls';});
 const pageCount=context.pages().length;
 await panel.getByRole('button',{name:'Open Voice Lab',exact:true}).click();
 assert.equal(context.pages().length,pageCount);
 voice.on('pageerror',error=>report.errors.push(error.message));
 pass('Panel opens the inherited Voice Lab under the same extension ID');
 const loadStart=Date.now();
 await eventually(()=>voice.locator('#sample').isEnabled(),180000);
 await voice.locator('#sample').click();
 await eventually(async()=>{const state=await readState();return state.transcripts.some(t=>t.final)&&state.audioSessions.some(s=>s.captureStatus==='stopped');},180000);
 const asrState=await readState();const transcript=asrState.transcripts.find(t=>t.final);
 assert.match(transcript.text,/after early nightfall/i);assert.match(transcript.text,/yellow lamps/i);assert.match(transcript.text,/squalid quarter/i);
 const audioSession=asrState.audioSessions.find(s=>s.id===transcript.sessionId);
 assert.equal(audioSession.source,'sample');assert.equal(audioSession.meetingId,undefined);
 assert(audioSession.ownerDocumentId);assert(transcript.endMs>transcript.startMs);
 await panel.reload();await panel.getByText('Local workspace ready.',{exact:true}).waitFor();await panel.getByRole('button',{name:'Notes',exact:true}).click();
 assert.equal((await readState()).transcripts.find(t=>t.id===transcript.id).text,transcript.text);
 await panel.getByText(transcript.text,{exact:true}).waitFor();
 await panel.screenshot({path:path.join(evidence,'transcript-persisted.png'),fullPage:true});
 assert.equal(audioSession.contextId,capturedContext.id);
 await panel.getByRole('button',{name:'Save transcript as note',exact:true}).click();
 await eventually(async()=>(await readState()).notes.length===1);
 const spokenNote=(await readState()).notes[0];assert.equal(spokenNote.source,'transcript');assert.equal(spokenNote.transcriptId,transcript.id);assert.equal(spokenNote.contextId,capturedContext.id);
 pass('Real Nemotron sample is saved through the UI bridge and retained after reload',{text:transcript.text,elapsedMs:Date.now()-loadStart});

 await eventually(()=>voice.locator('#speak').isEnabled(),180000);
 await voice.locator('#speech').fill('The saved context is ready for your return.');
 const generationStart=Date.now();await voice.locator('#speak').click();
 await eventually(async()=>(await voice.locator('#tts-status').textContent()).startsWith('Generating speech locally.'),180000);
 await voice.locator('#stop-output').click();
 await eventually(async()=>!(await voice.locator('#speak').isDisabled())&&!(await voice.locator('#playback').getAttribute('src')),180000);
 assert.equal(await voice.locator('#playback').getAttribute('src'),null);
 assert.equal(await voice.locator('#playback').evaluate(p=>p.paused),true);
 pass('Stop audio terminates real pending Kokoro synthesis',{elapsedMs:Date.now()-generationStart});
 // Positive control: a new explicit request still produces real audio after cancellation.
 await voice.locator('#speech').fill('Welcome back.');await voice.locator('#speak').click();
 await eventually(async()=>!!(await voice.locator('#playback').getAttribute('src'))?.startsWith('blob:'),180000);
 const positive=await voice.locator('#playback').evaluate(p=>({src:p.src,paused:p.paused,duration:p.duration}));
 await eventually(()=>voice.locator('#playback').evaluate(p=>p.currentTime>0)); // Browser playback needs no BlackHole route.
 await voice.screenshot({path:path.join(evidence,'kokoro-real-output.png'),fullPage:true});
 pass('A fresh explicit Kokoro request generates audio after cancellation',{metric:await voice.locator('#tts-metric').textContent(),route:'browser speakers; no meeting delivery claim'});
 // Exercise Return with the same real model output path. The meeting itself is a local control fixture.
 const now=Date.now();const created=await control('save-meeting',{title:'Audio cancellation check',joinUrl:'https://example.com/',startsAt:now+600000,remindAt:now+590000});assert(created.ok);
 const meetingId=created.value.id;
 await control('meeting-action',{id:meetingId,action:'join'});await control('meeting-action',{id:meetingId,action:'away'});
 report.returnRequestStarted=Date.now(); await voice.evaluate(()=>{window.audioProofPhase='return';});
 await voice.locator('#speech').fill('This pending response must be cancelled when the person returns.');await voice.locator('#speak').click();
 await eventually(async()=>(await voice.locator('#tts-status').textContent()).startsWith('Generating speech locally.'),180000);
 await voice.evaluate(() => { window.stopReceipts=0; window.addEventListener('speech-output-stopped',()=>{window.stopReceipts++;}); });
 report.returnRequest=await voice.evaluate(()=>window.audioProofEvents.findLast(e=>e.type==='speak-request'&&e.phase==='return'));
 assert(report.returnRequest?.requestId);
 const returned=await control('meeting-action',{id:meetingId,action:'return'});assert(returned.ok,returned.error);
 const stopReceipt=await voice.evaluate(async()=>({stops:window.stopReceipts,pending:(await import('./speech-output.js')).speechRequests.pending}));
 assert(stopReceipt.stops>=1);assert.equal(stopReceipt.pending,false);
 report.returnStopReceipt=stopReceipt; report.returnWaitStarted=Date.now();
 await eventually(async()=>!(await voice.locator('#speak').isDisabled())&&!(await voice.locator('#playback').getAttribute('src')));
 report.audioEvents=await voice.evaluate(()=>window.audioProofEvents);
 report.secondSample={beforeStateChecks:Date.now()};
 assert.equal(await voice.locator('#playback').getAttribute('src'),null);
 assert.equal((await readState()).meetings.find(m=>m.id===meetingId).status,'present');
 assert.equal(await voice.locator('#sample').isEnabled(),true);
 report.secondSample.beforeClick=Date.now();await voice.evaluate(()=>{window.audioProofPhase='second-sample';});
 await voice.locator('#sample').click();report.secondSample.afterClick=Date.now();
 await eventually(() => voice.evaluate(async () => {
   const { captureSession } = await import('./app.js');
   if (captureSession.phase !== 'finishing') return false;
   window.proofProcessingContext = captureSession.context;
   return true;
 }), 30000);
 report.secondSample.processingContext = await voice.evaluate(() => window.proofProcessingContext?.state);
 assert.equal(report.secondSample.processingContext, 'running');
 await eventually(async()=>(await readState()).transcripts.filter(t=>t.final).length===2,30000);
 report.secondSample.completed=Date.now();report.audioEvents=await voice.evaluate(()=>window.audioProofEvents);
 assert(report.secondSample.completed - report.secondSample.beforeClick < 30000, 'Second sample must not regress to a background processing stall.');
 await eventually(() => voice.evaluate(async () => (await import('./app.js')).captureSession.phase === 'idle'));
 report.secondSample.contextAfterIdle = await voice.evaluate(async () => ({ state: window.proofProcessingContext?.state, released: (await import('./app.js')).captureSession.context === null }));
 assert.deepEqual(report.secondSample.contextAfterIdle, { state: 'closed', released: true });
 pass('Return terminates real pending synthesis; ASR decodes another clip within 30 seconds and releases its processing context', { elapsedMs: report.secondSample.completed - report.secondSample.beforeClick });
 await eventually(async()=>(await readState()).audioSessions.every(s=>!['starting','listening'].includes(s.captureStatus)));
 // Lifecycle fixtures use production begin messaging without registering pagehide cleanup.
 // They represent ownership state only, never successful audio or a transcript.
 const begin=()=>voice.evaluate(()=>chrome.runtime.sendMessage({type:'voice-begin',source:'microphone'}));
 const orphan1=await begin();assert(orphan1.ok,orphan1.error);
 await voice.reload();await voice.locator('#sample').waitFor();
 const replacement=await begin();assert(replacement.ok,replacement.error);
 let state=await readState();assert.equal(state.audioSessions.find(s=>s.id===orphan1.value.id).captureStatus,'error');
 assert.equal(state.transcripts.find(t=>t.id===transcript.id).text,transcript.text);
 pass('Reloaded audio document cannot leave a durable starting session blocking capture');
 await voice.close();
 await eventually(async()=>(await readState()).audioSessions.find(s=>s.id===replacement.value.id).captureStatus==='error');
 voice=await context.newPage();await voice.goto(`chrome-extension://${id}/index.html`);
 const orphan2=await begin();assert(orphan2.ok,orphan2.error);
 pass('Closed audio owner is marked interrupted and permits a new session');
 // Owner session was begun outside pagehide adapter state. Close/reopen entire browser to test durable recovery.
 report.browserCloseStarted=new Date().toISOString();await context.close();report.browserClosed=new Date().toISOString();context=await launch();
 const worker2=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 panel=context.pages()[0];await panel.goto(`chrome-extension://${new URL(worker2.url()).host}/panel.html`);
 await panel.getByText('Local workspace ready.',{exact:true}).waitFor();await panel.getByRole('button',{name:'Notes',exact:true}).click();
 state=await readState();assert.equal(state.audioSessions.find(s=>s.id===orphan2.value.id).captureStatus,'error');
 assert.equal(state.transcripts.find(t=>t.id===transcript.id).text,transcript.text);
 voice=await context.newPage();await voice.goto(`chrome-extension://${id}/index.html`);
 const newSession=await begin();assert(newSession.ok,newSession.error);
 pass('Browser restart recovers stale owner records and retains real transcript before allowing capture');
 await voice.close();
 assert.deepEqual(report.errors,[]);
 report.result='PASS';
}catch(error){report.result='FAIL';report.failure=error.stack;report.pages=await Promise.all((context?.pages()??[]).map(async p=>({url:p.url(),text:await p.locator('body').innerText().catch(()=>'' ),audioEvents:await p.evaluate(()=>window.audioProofEvents).catch(()=>undefined)})));console.error(error);process.exitCode=1;}
finally{if(context)await context.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('RESULT:',report.result);}
