import { speechRequests, stopSpeechOutput } from './speech-output.js';
import { beginLocalTranscript, persistTranscript, captureStatus, captureInputActive } from './voice-bridge.js';
const $ = id => document.getElementById(id);
const workers = {}, loaded = { asr: false, tts: false };
let recording = false, asrBusy = false, ttsBusy = false, context, mic, source, capture;
let started = 0, duration = 0, pending = 0, compute = 0, audioUrl, timer;
function status(kind, message, error = false) { $(`${kind}-status`).textContent = message; $(`${kind}-status`).classList.toggle('error', error); }
function buttons() {
  $('sample').disabled = !loaded.asr || asrBusy;
  $('record').disabled = !loaded.asr || (asrBusy && !recording);
  $('speak').disabled = !loaded.tts || ttsBusy || recording;
}
function log(message) { $('log').textContent = `${message}\n${$('log').textContent}`.slice(0, 12000); }
function load(kind) {
  $(`load-${kind}`).disabled = true;
  const worker = new Worker('engine-worker.js'); workers[kind] = worker;
  worker.onmessage = ({ data }) => {
    if (data.type === 'status') status(kind, data.message);
    if (data.type === 'log') log(`${kind}: ${data.message}`);
    if (data.type === 'ready') {
      loaded[kind] = true; status(kind, 'Ready · running locally in WebAssembly');
      $(`load-${kind}`).textContent = `${kind === 'asr' ? 'Nemotron' : 'Kokoro'} loaded ✓`;
      if (data.speakers) $('voice').replaceChildren(...Array.from({ length: data.speakers }, (_, id) => new Option(`Voice ${id + 1}`, id)));
      buttons();
    }
    if (data.type === 'error') {
      status(kind, data.message, true); log(`${kind}: ${data.message}`);
      if (kind === 'asr') { void captureStatus('error', data.message).catch(() => undefined); cleanupMic(); recording = false; asrBusy = false; $('record').textContent = '● Record'; $('record').classList.remove('recording'); }
      else ttsBusy = false;
      worker.terminate(); loaded[kind] = false;
      $(`load-${kind}`).disabled = false; $(`load-${kind}`).textContent = `Retry ${kind === 'asr' ? 'Nemotron' : 'Kokoro'}`; buttons();
    }
    if (data.type === 'transcript') {
      pending = Math.max(0, pending - 1); compute += data.elapsed;
      $('transcript').value = data.text;
      void persistTranscript(data.text, false, duration * 1000).catch(error => status('asr', error.message, true));
      status('asr', recording ? `Listening… ${Math.round(duration)}s recorded · ${pending} chunks queued` : 'Finishing transcription…');
    }
    if (data.type === 'final') {
      $('transcript').value = data.text; asrBusy = false;
      void persistTranscript(data.text, true, duration * 1000).then(() => captureStatus('stopped')).catch(error => status('asr', error.message, true));
      status('asr', data.text ? 'Transcription complete · ready for another clip' : 'No speech detected. Try a clearer or longer phrase.');
      $('asr-metric').textContent = `${duration.toFixed(1)}s audio · ${((performance.now() - started) / 1000).toFixed(1)}s elapsed`;
      buttons();
    }
    if (data.type === 'audio-result') {
      if (!speechRequests.finish(data)) {
        if (!speechRequests.pending) { ttsBusy = false; status('tts', 'Speech cancelled. Late result discarded.'); buttons(); }
        return;
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(wav(data.samples, data.sampleRate));
      $('playback').src = audioUrl;
      const seconds = data.samples.length / data.sampleRate;
      $('tts-metric').textContent = `${seconds.toFixed(1)}s audio · ${(data.elapsed / 1000).toFixed(1)}s generation · ${(data.elapsed / 1000 / seconds).toFixed(2)}× RTF`;
      ttsBusy = false; status('tts', 'Speech generated locally · press play to listen'); buttons();
      if (window.zoomOutputReady) $('playback').play().catch(error => status('tts', error.message, true));
    }
  };
  worker.onerror = event => {
    status(kind, `Worker failed: ${event.message}. Reset and retry.`, true);
    worker.terminate(); loaded[kind] = false;
    if (kind === 'asr') { void captureStatus('error', `Worker failed: ${event.message}`).catch(() => undefined); cleanupMic(); asrBusy = false; recording = false; } else ttsBusy = false;
    $(`load-${kind}`).disabled = false; buttons();
  };
  worker.postMessage({ type: 'init', kind: kind === 'asr' ? 'nemotron' : 'kokoro' });
}
function startStream() {
  started = performance.now(); duration = 0; pending = 0; compute = 0; asrBusy = true;
  $('transcript').value = ''; workers.asr.postMessage({ type: 'start' }); buttons();
}
function sendAudio(samples, sampleRate) {
  duration += samples.length / sampleRate; pending++;
  workers.asr.postMessage({ type: 'audio', samples, sampleRate }, [samples.buffer]);
}
async function sample() {
  try { await beginLocalTranscript('sample'); } catch (error) { status('asr', error.message, true); return; }
  startStream(); status('asr', 'Reading bundled test clip…');
  const decoder = new AudioContext({ sampleRate: 16000 });
  try {
    const response = await fetch('demo.wav');
    if (!response.ok) throw new Error('Bundled sample audio is missing.');
    const audio = await decoder.decodeAudioData(await response.arrayBuffer());
    const samples = audio.getChannelData(0);
    for (let offset = 0; offset < samples.length; offset += 3200) sendAudio(samples.slice(offset, offset + 3200), audio.sampleRate);
    workers.asr.postMessage({ type: 'finish' });
  } catch (error) { void captureStatus('error', error.message).catch(() => undefined); asrBusy = false; status('asr', error.message, true); buttons(); }
  finally { await decoder.close(); }
}
function cleanupMic() {
  if (mic) void captureInputActive(false).catch(() => undefined);
  clearTimeout(timer); source?.disconnect(); capture?.disconnect();
  mic?.getTracks().forEach(track => track.stop());
  context?.close().catch(() => {}); source = capture = mic = context = null;
}
async function record() {
  if (recording) return stop();
  asrBusy = true; buttons(); stopSpeechOutput('Recording started.');
  try {
    await beginLocalTranscript('microphone');
    mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    context = new AudioContext({ sampleRate: 16000 }); await context.resume();
    await context.audioWorklet.addModule('capture-worklet.js');
    capture = new AudioWorkletNode(context, 'capture');
    source = context.createMediaStreamSource(mic);
    const rate = context.sampleRate;
    capture.port.onmessage = ({ data }) => {
      if (data.samples) sendAudio(data.samples, rate);
      if (data.stopped) { cleanupMic(); workers.asr.postMessage({ type: 'finish' }); }
    };
    recording = true; await captureStatus('listening'); startStream(); source.connect(capture); capture.connect(context.destination); await captureInputActive(true);
    $('record').textContent = '■ Stop'; $('record').classList.add('recording');
    status('asr', 'Listening… click Stop when finished (30 second limit).'); buttons();
    timer = setTimeout(stop, 30000);
  } catch (error) { void captureStatus('error', error.message).catch(() => undefined); cleanupMic(); asrBusy = false; recording = false; status('asr', `Microphone: ${error.message}`, true); buttons(); }
}
function stop() {
  if (!recording) return;
  void captureInputActive(false).catch(() => undefined);
  recording = false; clearTimeout(timer); source?.disconnect();
  capture.port.postMessage('flush');
  $('record').textContent = '● Record'; $('record').classList.remove('recording');
  status('asr', 'Finishing transcription…'); buttons();
}
function wav(samples, rate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}
$('load-asr').onclick = () => load('asr'); $('load-tts').onclick = () => load('tts');
$('sample').onclick = sample; $('record').onclick = record;
$('use-text').onclick = () => { if ($('transcript').value.trim()) $('speech').value = $('transcript').value.slice(0, 500); };
$('speak').onclick = () => {
  const text = $('speech').value.trim(); if (!text) return status('tts', 'Enter some text first.', true);
  ttsBusy = true; buttons(); status('tts', 'Generating speech in WASM…');
  workers.tts.postMessage({ type: 'speak', text: text.slice(0, 500), sid: Number($('voice').value), ...speechRequests.begin() });
};
$('reset').onclick = () => { stopSpeechOutput('Audio workspace reset.'); cleanupMic(); Object.values(workers).forEach(worker => worker.terminate()); location.reload(); };
window.addEventListener('pagehide', () => { cleanupMic(); Object.values(workers).forEach(worker => worker.terminate()); });

window.addEventListener('speech-output-stopped', () => { status('tts', 'Speech output stopped. Pending results will be discarded.'); });
