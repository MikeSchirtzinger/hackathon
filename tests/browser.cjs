const {chromium}=require('playwright');
const path=require('node:path');
(async()=>{
const extension=path.resolve(__dirname,'../extension');
const ctx=await chromium.launchPersistentContext(require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'brevity-test-')),{...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chromium'}),headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
const p=await ctx.newPage();await p.goto(`chrome-extension://${new URL(sw.url()).host}/index.html`);
console.log(await p.evaluate(async()=>{
 const {AudioQueue}=await import('./audio-queue.js');const q=new AudioQueue();await q.open();
 // Exceeds the old 30-second limit. Concurrent writes must retain exact order.
 await Promise.all(Array.from({length:200},(_,i)=>q.push(new Float32Array(3200).fill(i))));
 if(q.samples!==640000)throw Error('wrong queue count');
 for(let i=0;i<200;i++){const chunk=await q.peek();if(chunk[0]!==i)throw Error('order mismatch');await q.ack(chunk.length);}
 if(q.samples!==0||await q.peek())throw Error('queue did not drain');q.close();
 // Real model: the replacement LibriSpeech clip is documented in docs/TEST-CLIP.txt.
 // The original hackathon phrase was not available; no substitute transcript is injected.
 return await new Promise((resolve,reject)=>{
 const w=new Worker('engine-worker.js');const timer=setTimeout(()=>{w.terminate();reject(Error('model timeout'));},180000);
 w.onmessage=async({data})=>{
 if(data.type==='error'){clearTimeout(timer);w.terminate();reject(Error(data.message));}
 if(data.type==='ready'){
 const c=new AudioContext({sampleRate:16000});const audio=await c.decodeAudioData(await(await fetch('demo.wav')).arrayBuffer());
 w.postMessage({type:'start'});w.postMessage({type:'audio',samples:audio.getChannelData(0),sampleRate:16000});w.postMessage({type:'finish'});await c.close();
 }
 if(data.type==='final'){clearTimeout(timer);w.terminate();if(!/after early nightfall/i.test(data.text)||!/yellow lamps/i.test(data.text)||!/squalid quarter/i.test(data.text))reject(Error('unexpected transcript '+data.text));else resolve({queue:'PASS 40 seconds FIFO + drain',transcript:data.text});}
 };w.postMessage({type:'init',kind:'nemotron'});
 });
}));
}finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
