import { beginLocalTranscript, persistTranscript, captureStatus, captureInputActive } from './voice-bridge.js';
import {AudioQueue} from './audio-queue.js';
const $ = id=>document.getElementById(id);
let queue, inflight=0, pumping=false, segmentSeconds=0, silentSeconds=0, skippedSeconds=0, computeMs=0, decodedSeconds=0;
async function pump(){
  if(pumping||inflight||!queue||!ready)return;
  pumping=true;
  try{
    const samples=await queue.peek();
    if(samples){
      inflight=samples.length;
      worker.postMessage({type:'audio',samples,sampleRate:16000},[samples.buffer]);
    }else if(finishing&&!queue.writes){worker.postMessage({type:'finish'});queue.close();queue=null;}
  }catch(e){fail(e.message);}finally{pumping=false;}
}
let worker, ready=false, media, ctx, source, capture, pending=0, active=false, seconds=0, history='', finishing=false;
function status(text){$('zoom-asr-status').textContent=text;}
function cleanup(){
  if (media) void captureInputActive(false).catch(()=>{});
  active=false; source?.disconnect(); capture?.disconnect();
  media?.getTracks().forEach(t=>t.stop()); ctx?.close().catch(()=>{});
  media=ctx=source=capture=null;
  $('stop-zoom').disabled=true;
}
function fail(message){void captureStatus('error',message).catch(()=>{});cleanup();worker?.terminate();worker=null;queue?.close();queue=null;inflight=0;ready=false;finishing=false;pending=0;$('listen-zoom').disabled=false;status(message);}
function load(){
  return new Promise((resolve,reject)=>{
    worker=new Worker('engine-worker.js');
    worker.onerror=e=>{reject(Error(e.message));fail(e.message);};
    worker.onmessage=async({data})=>{
      if(data.type==='status')status(data.message);
      if(data.type==='ready'){ready=true;resolve();}
      if(data.type==='error'){reject(Error(data.message));fail(data.message);}
      if(data.type==='transcript'){
        const length=inflight;
        computeMs+=data.elapsed;decodedSeconds+=length/16000;
        try{if(queue&&length)await queue.ack(length);}catch(e){fail(e.message);return;}
        inflight=0;segmentSeconds+=length/16000;
        $('zoom-transcript').textContent=(history+'\n'+data.text).trim();
        await persistTranscript(data.text,false,decodedSeconds*1000).catch(e=>fail(e.message));
        if(active)status(`Listening · ${seconds.toFixed(0)}s captured · ${((queue?.samples||0)/16000).toFixed(1)}s queued · ${skippedSeconds.toFixed(0)}s digital silence skipped · ${(computeMs/1000/Math.max(decodedSeconds,.001)).toFixed(2)}× RTF`);
        if(segmentSeconds>=20){worker.postMessage({type:'finish'});worker.postMessage({type:'start'});segmentSeconds=0;}
        pump();
      }
      if(data.type==='final'){
        await persistTranscript(data.text,true,decodedSeconds*1000).catch(e=>fail(e.message));
        history=(history+'\n'+data.text).trim().slice(-30000);
        $('zoom-transcript').textContent=history;
        if(finishing&&!queue){finishing=false;$('listen-zoom').disabled=false;status('Stopped · transcript retained.');void captureStatus('stopped').catch(()=>{});}
      }
    };
    worker.postMessage({type:'init',kind:'nemotron'});
  });
}
$('listen-zoom').onclick=async()=>{
  $('listen-zoom').disabled=true;
  try{
    if(!ready)await load();
    await beginLocalTranscript('tab');
    queue=new AudioQueue();await queue.open();
    const response=await chrome.runtime.sendMessage({type:'capture-tab'});
    if(!response.ok)throw Error(response.error);
    const result=response.value;
    media=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:result.streamId}},video:false});
    ctx=new AudioContext({sampleRate:16000}); await ctx.resume();
    await ctx.audioWorklet.addModule('capture-worklet.js');
    source=ctx.createMediaStreamSource(media);
    capture=new AudioWorkletNode(ctx,'capture');
    pending=0;seconds=0;history='';finishing=false;active=true;
    inflight=0;segmentSeconds=0;silentSeconds=0;skippedSeconds=0;computeMs=0;decodedSeconds=0;
    worker.postMessage({type:'start'});
    capture.port.onmessage=({data})=>{
      if(!active||!data.samples)return;
      const duration=data.samples.length/16000;seconds+=duration;
      // Only skip near-digital-zero after a full second of trailing silence.
      // This is not a speech VAD and does not discard ordinary quiet speech.
      const silent=data.samples.every(v=>Math.abs(v)<1e-7);
      silentSeconds=silent?silentSeconds+duration:0;
      if(silentSeconds>1){skippedSeconds+=duration;status(`Listening · ${seconds.toFixed(0)}s captured · ${((queue?.samples||0)/16000).toFixed(1)}s queued · ${skippedSeconds.toFixed(0)}s digital silence skipped`);return;}
      queue.push(data.samples).then(pump).catch(e=>fail(e.message));
    };
    source.connect(capture);capture.connect(ctx.destination);
    // tabCapture suppresses original playback. Restore it to headphones/default output.
    source.connect(ctx.destination);
    media.getAudioTracks()[0].onended=()=>stop();
    await captureStatus('listening'); await captureInputActive(true);
    $('stop-zoom').disabled=false;status(`Listening to ${result.title || 'authorized meeting tab'}. Another participant must speak; your own mic is not in tab playback.`);
  }catch(e){fail(e.message);}
};
function stop(){if(!active)return;cleanup();finishing=true;pump();status('Finishing queued recognition…');}
$('stop-zoom').onclick=stop;
window.addEventListener('pagehide',()=>{cleanup();worker?.terminate();queue?.close();});
