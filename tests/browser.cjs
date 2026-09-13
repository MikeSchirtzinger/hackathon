const {chromium}=require('playwright');
const path=require('node:path');
(async()=>{
const extension=path.resolve(__dirname,'../extension');
const ctx=await chromium.launchPersistentContext(require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'brevity-test-')),{...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chromium'}),headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
const p=await ctx.newPage();await p.goto(`chrome-extension://${new URL(sw.url()).host}/index.html`);
console.log(await p.evaluate(async()=>{
 const {AudioQueue}=await import('./audio-queue.js');
 const late=new AudioQueue();const opening=late.open();late.close();
 let lateRejected=false;try{await opening;}catch{lateRejected=true;}
 if(!lateRejected)throw Error('closed queue reopened after its async open completed');
 const q=new AudioQueue();await q.open();
 // Exceeds the old 30-second limit. Concurrent writes must retain exact order.
 await Promise.all(Array.from({length:200},(_,i)=>q.push(new Float32Array(3200).fill(i))));
 if(q.samples!==640000)throw Error('wrong queue count');
 for(let i=0;i<200;i++){const chunk=await q.peek();if(chunk[0]!==i)throw Error('order mismatch');await q.ack(chunk.length);}
 if(q.samples!==0||await q.peek())throw Error('queue did not drain');q.close();
 const preserved=new AudioQueue();await preserved.open();await preserved.push(new Float32Array([0.25,-0.5]));
 const database=preserved.name;preserved.close({preserve:true});
 const retained=await new Promise((resolve,reject)=>{const request=indexedDB.open(database);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('pcm').objectStore('pcm').get(0);read.onerror=()=>reject(read.error);read.onsuccess=()=>{const value=read.result;db.close();indexedDB.deleteDatabase(database);resolve(value);};};});
 if(retained?.length!==2||retained[0]!==0.25||retained[1]!==-0.5)throw Error('failed audio backlog was not preserved');
 // Real model: the replacement LibriSpeech clip is documented in docs/TEST-CLIP.txt.
 // The original hackathon phrase was not available; no substitute transcript is injected.
 const {EngineClient}=await import('./engine-client.js');
 const engine=new EngineClient('nemotron');const c=new AudioContext({sampleRate:16000});
 try{
 await engine.load();const audio=await c.decodeAudioData(await(await fetch('demo.wav')).arrayBuffer());
 await engine.request('start');const samples=audio.getChannelData(0);
 for(let offset=0;offset<samples.length;offset+=3200)await engine.request('audio',{samples:samples.slice(offset,offset+3200),sampleRate:16000});
 const data=await engine.request('finish');
 if(!/after early nightfall/i.test(data.text)||!/yellow lamps/i.test(data.text)||!/squalid quarter/i.test(data.text))throw Error('unexpected transcript '+data.text);
 if(!data.diagnostics.memoryLimitEnforced)throw Error('WASM cap was not enforced');
 return {queue:'PASS 40 seconds FIFO + drain',transcript:data.text,diagnostics:data.diagnostics};
 }finally{engine.terminate();await c.close();}
}));
}finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
