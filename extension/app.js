import { speechRequests, stopSpeechOutput } from './speech-output.js';
import { voiceMessage } from './voice-bridge.js';
import { CaptureSession } from './capture-session.js';
import { EngineClient } from './engine-client.js';
import { speechChunks } from './speech-text.js';

const $ = id => document.getElementById(id);
let preferences, speaking = false, speechEpoch = 0, audioUrl, idleTimer, polling = false, pollAgain = false, resumeAfterSpeech = false, outputContext;
function status(kind, message, error = false) { $(`${kind}-status`).textContent = message; $(`${kind}-status`).classList.toggle('error', error); }
const log = message => { $('log').textContent = `${message}\n${$('log').textContent}`.slice(0, 12000); };
const outputStatus = (state, detail) => voiceMessage('voice-playback-status', { status: state, detail }).catch(log);
async function beginOutputProcessing() {
  const context = new AudioContext({ sampleRate: 24000 });
  outputContext = context;
  await context.resume();
  return context;
}
function endOutputProcessing() {
  const context = outputContext; outputContext = undefined;
  void context?.close().catch(log);
}
export const captureSession = new CaptureSession(state => {
  const tab = state.source === 'tab';
  if (state.message) {
    if (tab) $('zoom-asr-status').textContent = state.message;
    else status('asr', state.message);
  }
  const target = tab ? $('zoom-transcript') : $('transcript');
  if (state.liveText !== undefined || state.text !== undefined) {
    const value = state.liveText ?? state.text;
    if (tab) target.textContent = value; else target.value = value;
  }
  if (state.capturedSeconds !== undefined) $('asr-metric').textContent = `${state.capturedSeconds.toFixed(1)}s captured · ${state.queuedSeconds.toFixed(1)}s queued · ${state.decodedSeconds.toFixed(1)}s decoded`;
  if (state.diagnostics) $('memory-status').textContent = `Nemotron WASM: ${Math.round(state.diagnostics.wasmBytes / 1048576)} MiB. Limit: ${Math.round(state.diagnostics.wasmLimitBytes / 1048576)} MiB.`;
  const busy = state.phase !== 'idle';
  $('sample').disabled = busy;
  $('record').disabled = busy && tab;
  $('record').textContent = busy && !tab ? 'Stop transcription' : 'Start microphone';
  $('listen-zoom').disabled = busy; $('stop-zoom').disabled = !busy || !tab;
  $('capture-indicator').hidden = !busy;
  $('capture-indicator').textContent = state.phase === 'listening' ? 'Listening on device' : state.phase === 'idle' ? '' : state.phase === 'starting' ? 'Preparing microphone' : 'Finishing saved audio';
  window.dispatchEvent(new CustomEvent('capture-state', { detail: state }));
  if (!busy) { scheduleRelease(); queueMicrotask(reconcileCapture); }
});
const tts = new EngineClient('kokoro', {
  onStatus: data => status('tts', typeof data === 'string' ? data : data.message),
  onLog: data => log(typeof data === 'string' ? data : data.message),
  onDiagnostics: data => { $('tts-memory').textContent = `Kokoro WASM: ${Math.round(data.wasmBytes / 1048576)} MiB. Limit: ${Math.round(data.wasmLimitBytes / 1048576)} MiB.`; }
});
function scheduleRelease() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!speaking && captureSession.phase === 'idle') { captureSession.engine.terminate(); tts.terminate(); $('memory-status').textContent = 'Idle models released. They load automatically when needed.'; }
  }, 120000);
}
function wav(samples, rate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const label = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}
async function playAudio(samples, sampleRate) {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(wav(samples, sampleRate));
  const player = $('playback'); player.src = audioUrl;
  await new Promise((resolve, reject) => {
    const cleanup = () => { player.removeEventListener('ended', ended); player.removeEventListener('error', failed); window.removeEventListener('speech-output-stopped', stopped); };
    const ended = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(Error('Browser audio playback failed.')); };
    const stopped = () => { cleanup(); reject(Error('Speech cancelled.')); };
    player.addEventListener('ended', ended); player.addEventListener('error', failed); window.addEventListener('speech-output-stopped', stopped);
    player.play().catch(error => { cleanup(); reject(Error(`Browser playback: ${error.message}`)); });
  });
}
export async function playTestOutput() {
  stopSpeechOutput('Playing the bundled test clip.');
  const epoch = ++speechEpoch; speaking = true;
  resumeAfterSpeech ||= captureSession.kind === 'microphone' && captureSession.phase !== 'idle' && preferences?.transcriptionMode === 'continuous' && !preferences.paused;
  try {
    await captureSession.stop();
    if (epoch !== speechEpoch) return;
    const context = await beginOutputProcessing();
    if (epoch !== speechEpoch) return;
    const response = await fetch('demo.wav'); if (!response.ok) throw Error('Bundled sample is missing.');
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    if (epoch !== speechEpoch) return;
    await playAudio(audio.getChannelData(0), audio.sampleRate);
  } finally { if (epoch === speechEpoch) { endOutputProcessing(); speaking = false; reconcileCapture(); } }
}
async function speakText(text, browserResponse = false) {
  const chunks = speechChunks(text);
  if (!chunks.length) return;
  stopSpeechOutput('Starting a new response.');
  const epoch = ++speechEpoch;
  speaking = true; clearTimeout(idleTimer); $('speak').disabled = true;
  try {
    preferences ??= await voiceMessage('voice-preferences');
    if (epoch !== speechEpoch) return;
    if (browserResponse) {
      await $('playback').setSinkId('');
      if (epoch !== speechEpoch) return;
      window.zoomOutputReady = false;
      $('route-status').textContent = 'Browser speakers selected. Spark responses play here.';
    }
    // Never transcribe Spark's own speaker output as human evidence.
    if (captureSession.phase !== 'idle') {
      resumeAfterSpeech ||= captureSession.kind === 'microphone' && preferences?.transcriptionMode === 'continuous' && !preferences.paused;
      await captureSession.stop();
      if (captureSession.phase !== 'idle') await new Promise(resolve => {
        const done = ({ detail }) => { if (detail.phase === 'idle') { window.removeEventListener('capture-state', done); resolve(); } };
        window.addEventListener('capture-state', done);
      });
    }
    if (epoch !== speechEpoch) return;
    // Keep the audio-processing lifetime active while browser-local synthesis
    // runs in an inactive tab. Close it when the response ends or is cancelled.
    await beginOutputProcessing();
    if (epoch !== speechEpoch) return;
    status('tts', 'Loading browser voice.'); await outputStatus('loading', 'Loading browser voice.');
    const ready = await tts.load();
    if (epoch !== speechEpoch) return;
    const speakers = ready.speakers;
    if (!Number.isInteger(speakers) || speakers < 1) throw Error('Kokoro returned no available voices.');
    $('voice').replaceChildren(...Array.from({ length: speakers }, (_, id) => new Option(`Voice ${id + 1}`, String(id))));
    if (!Number.isInteger(preferences?.speaker) || preferences.speaker < 0 || preferences.speaker >= speakers) throw Error('The saved voice is unavailable. Select an available voice and try again.');
    $('voice').value = String(preferences.speaker);
    for (let index = 0; index < chunks.length; index++) {
      if (epoch !== speechEpoch) return;
      status('tts', `Generating speech locally. Part ${index + 1} of ${chunks.length}.`);
      const ticket = speechRequests.begin();
      const audio = await tts.request('speak', { text: chunks[index], sid: Number($('voice').value), ...ticket });
      if (epoch !== speechEpoch || !speechRequests.finish(audio)) return;
      if (!audio.samples?.length || !audio.sampleRate) throw Error('Kokoro returned no playable audio.');
      $('tts-metric').textContent = `${(audio.samples.length / audio.sampleRate).toFixed(1)}s audio · ${(audio.elapsed / 1000).toFixed(1)}s generation`;
      status('tts', `Speaking locally. Part ${index + 1} of ${chunks.length}.`); void outputStatus('speaking', 'Playing through the selected browser output.');
      await playAudio(audio.samples, audio.sampleRate);
    }
    if (epoch === speechEpoch) { status('tts', 'Finished speaking locally.'); void outputStatus('stopped', 'Finished speaking locally.'); }
  } catch (error) { if (epoch === speechEpoch) { status('tts', error.message, true); void outputStatus('error', error.message); } }
  finally {
    if (epoch === speechEpoch) {
      endOutputProcessing();
      speaking = false; $('speak').disabled = false; scheduleRelease();
      reconcileCapture();
    }
  }
}
function reconcileCapture() {
  if (!resumeAfterSpeech || speaking || captureSession.phase !== 'idle') return;
  resumeAfterSpeech = false;
  if (preferences?.transcriptionMode === 'continuous' && !preferences.paused) void startMicrophone().catch(log);
}
async function startMicrophone() {
  if (captureSession.phase !== 'idle') return;
  stopSpeechOutput('Microphone capture started.'); clearTimeout(idleTimer);
  try { await captureSession.start('microphone'); }
  catch (error) { if (captureSession.phase === 'idle') status('asr', `Microphone: ${error.message}`, true); }
}
async function pauseMicrophone() {
  resumeAfterSpeech = false;
  preferences = await voiceMessage('voice-save-preferences', { paused: true });
  await captureSession.stop();
}
function renderPreferences() {
  $('transcription-mode').value = preferences.transcriptionMode;
  $('voice-responses').checked = preferences.voiceResponses;
  $('mode-detail').textContent = preferences.transcriptionMode === 'continuous' ? (preferences.paused ? 'Continuous transcription paused. Start microphone to resume.' : 'Continuous microphone transcription enabled. It resumes when Chrome starts.') : 'Microphone stays off until you press the voice hotkey or Start microphone.';
}
async function pollCommands() {
  if (polling) { pollAgain = true; return; }
  polling = true;
  try {
    do {
      pollAgain = false;
      const result = await voiceMessage('voice-poll'); preferences = result.preferences; renderPreferences();
      for (const command of result.commands) {
        if (command.action === 'stop-output') stopSpeechOutput('Browser voice responses stopped.');
        if (command.action === 'stop') await captureSession.stop();
        if (command.action === 'start' && !preferences.paused && await voiceMessage('voice-command-allowed', { id: command.id, action: 'start' })) void startMicrophone();
        if (command.action === 'speak' && preferences.voiceResponses) { const epoch = speechEpoch; if (await voiceMessage('voice-command-allowed', { id: command.id, action: 'speak' }) && epoch === speechEpoch) { $('speech').value = command.text; void speakText(command.text, true); } }
      }
    } while (pollAgain);
  } catch (error) { status('asr', error.message, true); }
  finally { polling = false; }
}
$('record').onclick = () => void (captureSession.phase === 'idle' ? voiceMessage('voice-save-preferences', { paused: false }).then(p => { preferences = p; renderPreferences(); return startMicrophone(); }) : pauseMicrophone()).catch(log);
$('sample').onclick = () => { stopSpeechOutput('Sample transcription started.'); void captureSession.start('sample').catch(log); };
$('load-asr').onclick = () => void captureSession.load().catch(error => status('asr', error.message, true));
$('load-tts').onclick = () => void tts.load().then(() => status('tts', 'Browser voice ready.')).catch(error => status('tts', error.message, true));
$('use-text').onclick = () => { $('speech').value = $('transcript').value; };
$('speak').onclick = () => void speakText($('speech').value);
$('voice').onchange = () => void voiceMessage('voice-save-preferences', { speaker: Number($('voice').value) }).then(p => { preferences = p; });
$('transcription-mode').onchange = () => void (async () => {
  const continuous = $('transcription-mode').value === 'continuous';
  preferences = await voiceMessage('voice-save-preferences', { transcriptionMode: continuous ? 'continuous' : 'hotkey', paused: !continuous }); renderPreferences();
  if (continuous) await startMicrophone(); else await captureSession.stop();
})().catch(error => status('asr', error.message, true));
$('voice-responses').onchange = () => void voiceMessage('voice-save-preferences', { voiceResponses: $('voice-responses').checked }).then(p => { preferences = p; renderPreferences(); if (!p.voiceResponses) stopSpeechOutput('Voice responses disabled.'); }).catch(log);
$('reset').onclick = () => { resumeAfterSpeech = false; stopSpeechOutput('Models released.'); void pauseMicrophone().then(() => { captureSession.dispose(); tts.terminate(); $('memory-status').textContent = 'Models released. Start capture or speech to reload automatically.'; }); };
window.addEventListener('speech-output-stopped', ({ detail }) => {
  endOutputProcessing();
  ++speechEpoch; if (speaking) tts.terminate(); speaking = false; $('speak').disabled = false;
  if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = undefined;
  status('tts', detail?.reason || 'Speech cancelled.'); void outputStatus('stopped', detail?.reason || 'Speech cancelled.'); scheduleRelease(); queueMicrotask(reconcileCapture);
});
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'voice-control' && message.action === 'poll') void pollCommands();
  if (message.type === 'changed') void voiceMessage('voice-preferences').then(p => { if (preferences?.voiceResponses && !p.voiceResponses) stopSpeechOutput('Voice responses disabled.'); preferences = p; renderPreferences(); }).catch(log);
});
window.addEventListener('pagehide', () => { clearTimeout(idleTimer); endOutputProcessing(); captureSession.dispose(); tts.terminate(); });
void (async () => {
  await pollCommands();
  if (preferences?.transcriptionMode === 'continuous' && !preferences.paused && captureSession.phase === 'idle') await startMicrophone();
  scheduleRelease();
})();
