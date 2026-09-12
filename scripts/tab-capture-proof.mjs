import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const evidence = path.resolve('.evidence/tab-capture'); await mkdir(evidence,{recursive:true});
const extension = path.resolve('extension');
const report={checks:[],startedAt:new Date().toISOString()};
function pass(name,detail){report.checks.push({name,detail});console.log('PASS',name);}
async function eventually(fn, timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
const context=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'carry-tab-')), {executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions','--mute-audio'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--remote-debugging-port=19332']});
let voice;
try{
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
const panel=context.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
const state=()=>panel.evaluate(async()=>(await chrome.runtime.sendMessage({type:'state'})).value);
const meetingPage=await context.newPage();await meetingPage.goto('https://meet.jit.si/ambi-d2b2d9d529564140ba37410f',{waitUntil:'domcontentloaded'});
const keyboard=await context.newCDPSession(meetingPage);for(const type of ['rawKeyDown','keyUp'])await keyboard.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',windowsVirtualKeyCode:89,nativeVirtualKeyCode:16,isSystemKey:true});await keyboard.detach();
await eventually(async()=>(await state()).contexts.length===1);
const created=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'save-meeting',title:'Tab capture verification',joinUrl:'https://meet.jit.si/ambi-d2b2d9d529564140ba37410f',startsAt:Date.now()+600000,remindAt:Date.now()+500000}));assert(created.ok);const first=created.value;
 // Audio is real playback of the provenance-documented WAV inside the Jitsi document.
 // This proves authorized tab capture, not a joined call or another participant's microphone.
 const opened = context.waitForEvent('page');
 await panel.getByRole('button', { name: 'Meeting', exact: true }).click();
 await panel.getByRole('button', { name: 'Open meeting audio', exact: true }).click();
 voice = await opened; await voice.waitForURL(`chrome-extension://${id}/index.html`);
 await voice.locator('#listen-zoom').click();
 await eventually(async () => (await state()).audioSessions.some(s => s.source === 'tab' && s.captureStatus === 'listening'), 180000);
 const audio = await state(); const session = audio.audioSessions.find(s => s.source === 'tab');
 assert.equal(session.meetingId, first.id); assert(session.ownerDocumentId);
 const sample = await readFile('extension/demo.wav');
 report.tabAudioSource = { kind: 'document playback of real LibriSpeech replacement clip', sha256: createHash('sha256').update(sample).digest('hex'), liveParticipantDelivery: 'unverified' };
 await meetingPage.evaluate(async data => { window.demoAudio = new Audio(data); await window.demoAudio.play(); }, `data:audio/wav;base64,${sample.toString('base64')}`);
 await eventually(() => meetingPage.evaluate(() => window.demoAudio.ended), 30000);
 report.captureBeforeStop=await voice.locator('#zoom-asr-status').textContent();
 report.player=await meetingPage.evaluate(()=>({muted:window.demoAudio.muted,volume:window.demoAudio.volume,duration:window.demoAudio.duration}));
 await voice.locator('#stop-zoom').click();
 await eventually(async () => (await state()).transcripts.some(t => t.sessionId === session.id && t.final), 180000);
 const captured = (await state()).transcripts.filter(t => t.sessionId === session.id && t.final).map(t => t.text).join(' ');
 assert.match(captured, /yellow lamps/i); assert.match(captured, /squalid quarter/i);
 await voice.screenshot({ path: path.join(evidence, 'jitsi-tab-transcription.png'), fullPage: true });
 pass('Authorized Jitsi tab playback passes through real tabCapture, Nemotron, and persistent transcript bridge', { text: captured, sessionId: session.id, meetingId: first.id, ...report.tabAudioSource });

 report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;console.error(error);if(voice)report.voice=await voice.locator('body').innerText();}
finally{await context.close();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('RESULT:',report.result);}
