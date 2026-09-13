import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const evidence = path.resolve('.evidence/speech-controls'); await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'spark-speech-'));
const microphone = path.join(temp, 'microphone.wav');
execFileSync('ffmpeg', ['-v','error','-stream_loop','10','-i',path.resolve('extension/demo.wav'),'-t','75','-ar','16000','-ac','1',microphone]);
const report = { startedAt: new Date().toISOString(), checks: [], errors: [], input: 'Recorded LibriSpeech clip repeated through Chrome file-backed microphone. Real getUserMedia, worklet, IndexedDB, Nemotron and Kokoro. No transcript or synthesis doubles.' };
function pass(name, detail) { report.checks.push({ name, detail }); console.log('PASS', name, detail || ''); }
async function eventually(fn, timeout = 180000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Speech condition timed out.'); }
let context, voice;
try {
 const extension = path.resolve('extension');
 context = await chromium.launchPersistentContext(path.join(temp, 'profile'), { ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel:'chromium' }), headless:true, viewport:{width:1200,height:1000}, ignoreDefaultArgs:['--disable-extensions'], args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--use-mock-keychain','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${microphone}`, ...(process.env.SPEECH_CDP_PORT ? [`--remote-debugging-port=${process.env.SPEECH_CDP_PORT}`] : [])] });
 const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id = new URL(sw.url()).host; report.extensionId = id; report.chrome = context.browser().version();
 const panel = context.pages()[0]; await panel.goto(`chrome-extension://${id}/panel.html`);
 await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
 const read = () => panel.evaluate(async () => { const r = await chrome.runtime.sendMessage({type:'state'}); if (!r.ok) throw Error(r.error); return r.value; });
 await panel.getByRole('button',{name:'Open speech controls',exact:true}).click();
 await eventually(async () => { voice = context.pages().find(p => p.url().endsWith('/index.html')); return !!voice; });
 await voice.locator('#sample').waitFor(); voice.on('pageerror', error => report.errors.push(error.message));
 await voice.evaluate(() => {
   window.speechProof = { events: [], workers: 0, terminated: 0, remote: [], contexts: [] };
   const NativeAudioContext = window.AudioContext;
   window.AudioContext = class extends NativeAudioContext { constructor(...args) { super(...args); window.speechProof.contexts.push(this); } };
   const Base = window.Worker;
   window.Worker = class extends Base {
     constructor(...args) { super(...args); window.speechProof.workers++; this.addEventListener('message', ({data}) => { if (['ready','audio-result','final','error'].includes(data.type)) { const samples = data.samples; window.speechProof.events.push({ type:data.type, at:Date.now(), text:data.text, diagnostics:data.diagnostics, requestId:data.requestId, sampleCount:samples?.length, energy:samples ? samples.reduce((sum,s) => sum + s*s,0)/samples.length : undefined, message:data.message }); } }); }
     postMessage(data,...args) { if (data.type==='speak') window.speechProof.events.push({type:'speak',requestId:data.requestId,at:Date.now()}); super.postMessage(data,...args); }
     terminate() { window.speechProof.terminated++; super.terminate(); }
   };
   for (const type of ['playing','ended','pause']) document.getElementById('playback').addEventListener(type, () => window.speechProof.events.push({type,at:Date.now(),time:document.getElementById('playback').currentTime}));
 });
 const requests = []; context.on('request', request => { if (/^https?:/.test(request.url())) requests.push({url:request.url(),method:request.method()}); });
 assert.equal((await read()).speechPreferences.transcriptionMode,'hotkey'); assert.equal((await read()).audioListening,false);
 await voice.locator('#sample').click();
 await eventually(async () => (await read()).transcripts.some(t => t.final && /yellow lamps/i.test(t.text)) && (await read()).audioSessions.some(s => s.source==='sample' && s.captureStatus==='stopped'));
 const sample = (await read()).transcripts.find(t => t.final); assert.match(sample.text,/after early nightfall/i); assert.match(sample.text,/squalid quarter/i);
 pass('Nemotron loads from one sample click and saves a real transcript', sample.text);
 await panel.reload(); await panel.getByText('Local workspace ready.',{exact:true}).waitFor(); assert.equal((await read()).transcripts.find(t => t.id===sample.id).text,sample.text);
 pass('Transcript survives a settings reload');
 const speechStarted = Date.now();
 await voice.locator('#speech').fill('The saved notes describe the meeting goals and the next step. '.repeat(6)); await voice.locator('#speak').click();
 await panel.bringToFront();
 await eventually(() => voice.evaluate(() => window.speechProof.events.filter(e => e.type==='ended').length >= 2 && document.getElementById('tts-status').textContent === 'Finished speaking locally.'));
 await eventually(() => voice.evaluate(() => window.speechProof.contexts.every(context => context.state === 'closed')));
 let proof = await voice.evaluate(() => window.speechProof); assert(proof.events.some(e=>e.type==='audio-result'&&e.sampleCount>1000&&e.energy>0.00001)); assert(proof.events.some(e=>e.type==='playing'));
 const speechElapsed = Date.now() - speechStarted;
 assert(speechElapsed < 120000, 'A bounded background response must finish within two minutes on this verification host.');
 pass('Kokoro loads and plays a chunked response in an inactive tab without Load or Play clicks, then closes its processing context', { elapsedMs: speechElapsed, events: proof.events.filter(e=>['playing','ended','audio-result'].includes(e.type)) });
 const stopBefore = proof.terminated;
 const requestsBeforeCancel = proof.events.filter(e => e.type === 'speak').length;
 await voice.locator('#speech').fill('This longer sentence is cancelled while local synthesis is still computing the browser response.'); await voice.locator('#speak').click();
 await eventually(() => voice.evaluate(before => window.speechProof.events.filter(e=>e.type==='speak').length>before, requestsBeforeCancel));
 await voice.locator('#stop-output').click();
 await eventually(() => voice.evaluate(before => window.speechProof.terminated>before, stopBefore));
 assert.equal(await voice.locator('#playback').getAttribute('src'),null);
 await eventually(() => voice.evaluate(() => window.speechProof.contexts.every(context => context.state === 'closed')));
 pass('Stop terminates pending synthesis and removes playback');
 await voice.locator('#transcription-mode').selectOption('continuous');
 await eventually(async () => (await read()).audioListening);
 const liveSession = (await read()).audioSessions.find(s=>s.source==='microphone'&&s.captureStatus==='listening');
 await panel.bringToFront();
 await eventually(async () => (await read()).transcripts.filter(t=>t.sessionId===liveSession.id&&t.final).length>=2, 180000);
 assert((await read()).audioListening); const live = (await read()).transcripts.filter(t=>t.sessionId===liveSession.id&&t.final);
 assert(live.every(t=>t.text.length>10)); assert(live.at(-1).endMs>=40000);
 pass('Continuous microphone capture stays active beyond 30 seconds with persisted rolling transcripts in a background tab', {segments:live.length,endMs:live.at(-1).endMs});
 await voice.locator('#record').click(); await eventually(async () => !(await read()).audioListening && (await read()).audioSessions.find(s=>s.id===liveSession.id).captureStatus==='stopped');
 assert.equal((await read()).speechPreferences.paused,true);
 await voice.reload(); await voice.locator('#sample').waitFor(); await new Promise(resolve=>setTimeout(resolve,1000)); assert.equal((await read()).audioListening,false);
 pass('Explicit Stop persists through owner reload');
 await voice.locator('#transcription-mode').selectOption('hotkey');
 const cdp=await context.newCDPSession(panel);
 for(const type of ['rawKeyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'9',code:'Digit9',windowsVirtualKeyCode:57,nativeVirtualKeyCode:25,isSystemKey:true});
 await eventually(async () => (await read()).audioListening);
 const hotkeySession=(await read()).audioSessions.find(s=>s.source==='microphone'&&s.captureStatus==='listening');
 await eventually(async () => (await read()).transcripts.some(t=>t.sessionId===hotkeySession.id&&t.text.length>10));
 for(const type of ['rawKeyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'9',code:'Digit9',windowsVirtualKeyCode:57,nativeVirtualKeyCode:25,isSystemKey:true});
 await cdp.detach(); await eventually(async () => (await read()).audioSessions.find(s=>s.id===hotkeySession.id).captureStatus==='stopped');
 pass('The real Chrome voice command starts and stops microphone transcription');
 assert.deepEqual(requests,[]); pass('Local speech made no HTTP requests or captured-content uploads');
 await voice.screenshot({path:path.join(evidence,'speech-controls.png'),fullPage:true}); await panel.screenshot({path:path.join(evidence,'speech-settings.png'),fullPage:true});
 assert.deepEqual(report.errors,[]); report.result='PASS';
} catch(error) { report.result='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1; }
finally {
 if(context) { report.pages=await Promise.all(context.pages().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>''),proof:await p.evaluate(()=>window.speechProof).catch(()=>undefined)}))); await context.close(); }
 report.finishedAt=new Date().toISOString(); await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)); console.log('RESULT:',report.result);
}
