import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import os from 'node:os';
const env = process.env.AMBIGUOUS_CONTEXT_API_KEY ? process.env : parseEnv(await readFile(process.env.SPARK_AGENT_ENV || path.resolve('.agents/.env'),'utf8'));
const token=env.AMBIGUOUS_CONTEXT_API_KEY;if(!token)throw Error('A real Context Scout credential is required.');
const evidence=path.resolve('.evidence/speech-response');await mkdir(evidence,{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[],requests:[]};
function pass(name,detail){report.checks.push({name,detail});console.log('PASS',name);}
async function eventually(fn,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Real response speech check timed out.');}
let context,panel,voice;
try{
const ext=path.resolve('extension');context=await chromium.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'spark-response-')),{executablePath:process.env.CHROME_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1100,height:1000},args:[`--load-extension=${ext}`,`--disable-extensions-except=${ext}`,'--use-mock-keychain']});
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
context.on('response',r=>{if(r.url().startsWith('https://app.ambiguous.ai/'))report.requests.push({url:r.url(),method:r.request().method(),status:r.status()});});
panel=context.pages()[0];await panel.goto(`chrome-extension://${id}/panel.html`);await panel.getByText('Local workspace ready.',{exact:true}).waitFor();
const send=(type,values={})=>panel.evaluate(({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});
const state=async()=>{const r=await send('state');assert(r.ok,r.error);return r.value;};
const source=await context.newPage();await source.goto('https://example.com/');const keyboard=await context.newCDPSession(source);for(const type of ['rawKeyDown','keyUp'])await keyboard.send('Input.dispatchKeyEvent',{type,modifiers:12,key:'Y',code:'KeyY',windowsVirtualKeyCode:89,nativeVirtualKeyCode:16,isSystemKey:true});await keyboard.detach();await eventually(async()=>(await state()).contexts.length===1);
await panel.locator('#api-token').fill(token);await panel.locator('#workspace-label').fill('Speech response verification');await panel.getByRole('button',{name:'Save connection settings',exact:true}).click();await eventually(async()=>(await state()).credentialsConfigured);
await panel.locator('#sync-mode').selectOption('sync');await panel.locator('#hosted-reasoning').check();await panel.locator('#speech-responses').check();await eventually(async()=>(await state()).speechPreferences.voiceResponses&&(await state()).settings.hostedReasoning);
await panel.getByRole('button',{name:'Open speech controls',exact:true}).click();await eventually(async()=>{voice=context.pages().find(p=>p.url().endsWith('/index.html'));return !!voice;});await voice.locator('#speak').waitFor();
await voice.evaluate(()=>{window.outputProof=[];const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='audio-result')window.outputProof.push({type:'pcm',requestId:data.requestId,samples:data.samples.length,energy:data.samples.reduce((sum,v)=>sum+v*v,0)/data.samples.length});});}postMessage(data,...args){if(data.type==='speak')window.outputProof.push({type:'text',text:data.text});super.postMessage(data,...args);}};const p=document.getElementById('playback');for(const type of ['playing','ended'])p.addEventListener(type,()=>window.outputProof.push({type,time:p.currentTime}));});
await panel.getByRole('button',{name:'Notes',exact:true}).click();await panel.locator('#note').fill('Keep the accessibility checklist available for the next onboarding review. No owner or deadline has been agreed.');await panel.getByRole('button',{name:'Save note locally',exact:true}).click();await eventually(async()=>(await state()).notes.length===1);
await panel.getByRole('button',{name:'Analyze saved note',exact:true}).click();await eventually(async()=>(await state()).analyses.some(a=>a.state!=='pending'));
const analysis=(await state()).analyses[0];assert.equal(analysis.state,'complete',analysis.error);assert.deepEqual(analysis.toolActivity,[]);assert(analysis.summary);report.analysis={id:analysis.id,summary:analysis.summary,evidenceIds:analysis.evidenceIds};
await eventually(()=>voice.evaluate(()=>window.outputProof.some(e=>e.type==='playing')));await eventually(()=>voice.evaluate(()=>document.getElementById('tts-status').textContent==='Finished speaking locally.'));
const output=await voice.evaluate(()=>window.outputProof);report.output=output;const spoken=output.filter(e=>e.type==='text').map(e=>e.text).join(' ');assert.equal(spoken,analysis.summary.replace(/\s+/g,' ').trim());assert(output.some(e=>e.type==='pcm'&&e.samples>1000&&e.energy>0.00001));assert(output.some(e=>e.type==='ended'&&e.time>0));
pass('A real requested Assistant response is saved, synthesized with Kokoro and automatically played through browser speakers',{analysisId:analysis.id,chunks:output.filter(e=>e.type==='pcm').length});
await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#sync-mode').selectOption('local');await eventually(async()=>(await state()).settings.syncMode==='local');const before=report.requests.length;
await panel.getByRole('button',{name:'Notes',exact:true}).click();await panel.getByRole('button',{name:'Read aloud',exact:true}).click();await eventually(()=>voice.evaluate(n=>window.outputProof.filter(e=>e.type==='playing').length>n,output.filter(e=>e.type==='playing').length));
await panel.getByRole('button',{name:'Settings',exact:true}).click();await panel.locator('#speech-responses').uncheck();await eventually(()=>voice.locator('#playback').evaluate(p=>p.paused&&!p.getAttribute('src')));assert.equal(report.requests.length,before);
const denied=await send('speak-result',{kind:'analysis',id:analysis.id});assert.equal(denied.ok,false);
pass('Saved response playback works in Local only; disabling voice stops output and refuses new requests without HTTP');
// A suspended real owner creates an actual queued-command window; no speech or response data is mocked.
await panel.locator('#speech-responses').check();const owner=await context.newCDPSession(voice);await owner.send('Emulation.setScriptExecutionDisabled',{value:true});
const queued=await send('speak-result',{kind:'analysis',id:analysis.id});assert(queued.ok);
const meeting=await send('save-meeting',{title:'Queued output control fixture',joinUrl:'https://example.com/',startsAt:Date.now()+600000,remindAt:Date.now()+590000});assert(meeting.ok);await send('meeting-action',{id:meeting.value.id,action:'join'});await send('meeting-action',{id:meeting.value.id,action:'away'});
// The fast Return stop is invoked while the owner is paused. Resume it immediately to acknowledge Stop.
const returned=send('meeting-action',{id:meeting.value.id,action:'return'});await new Promise(r=>setTimeout(r,100));await owner.send('Emulation.setScriptExecutionDisabled',{value:false});await owner.detach();assert((await returned).ok);
await eventually(()=>voice.locator('#playback').evaluate(p=>p.paused&&!p.getAttribute('src')));await new Promise(r=>setTimeout(r,1000));assert.equal(await voice.locator('#playback').getAttribute('src'),null);
const pending=await worker.evaluate(()=>chrome.storage.session.get(['speechCommands','speechOutputRequestId']));assert.equal(pending.speechOutputRequestId,null);assert(!(pending.speechCommands||[]).some(c=>c.action==='speak'));
pass('Return revokes queued speech from a real saved response before a suspended owner can play it');
assert.equal((await state()).tasks.length,0);assert.equal((await state()).outbox.length,0);await panel.screenshot({path:path.join(evidence,'response-settings.png'),fullPage:true});await voice.screenshot({path:path.join(evidence,'response-voice.png'),fullPage:true});report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack).replaceAll(token,'[REDACTED]');console.error(report.failure);process.exitCode=1;}
finally{if(context){report.status=await voice?.locator('#tts-status').textContent().catch(()=>undefined);await context.close();}report.finishedAt=new Date().toISOString();const output=JSON.stringify(report,null,2);assert(!output.includes(token));await writeFile(path.join(evidence,'report.json'),output);console.log('RESULT:',report.result);}
