import { playTestOutput } from './app.js';
import { stopSpeechOutput } from './speech-output.js';
import { voiceMessage } from './voice-bridge.js';
const el = id => document.getElementById(id);
const player = el('playback');
window.zoomOutputReady = false;
// Browser output is the default. Meeting routing requires its own explicit action.
el('browser-output').onclick = async () => {
  stopSpeechOutput('Output changed to browser speakers.');
  try { await player.setSinkId(''); window.zoomOutputReady = false; await voiceMessage('voice-output-status', { ready: false }); el('route-status').textContent = 'Browser speakers selected.'; }
  catch (error) { el('route-status').textContent = error.message; }
};
el('connect-output').onclick = async () => {
  stopSpeechOutput('Connecting meeting output.');
  try {
    const permission = await navigator.mediaDevices.getUserMedia({audio:true});
    permission.getTracks().forEach(t=>t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const output = devices.find(d=>d.kind==='audiooutput' && /BlackHole 2ch/i.test(d.label));
    if (!output) throw new Error('BlackHole 2ch not installed/visible. Install it, restart Chrome, then retry.');
    await player.setSinkId(output.deviceId);
    window.zoomOutputReady = true;
    await voiceMessage('voice-output-status', { ready: true });
    chrome.power.requestKeepAwake('system');
    el('route-status').textContent = 'Connected → '+output.label+'. Now select BlackHole 2ch in Zoom microphone settings.';
  } catch(error) {window.zoomOutputReady=false;stopSpeechOutput('Output route unavailable.');void voiceMessage('voice-output-status', { ready: false }).catch(() => undefined);el('route-status').textContent=error.message;}
};
el('test-output').onclick = async () => {
  if (!window.zoomOutputReady) {el('route-status').textContent='Click Connect BlackHole first.';return;}
  try {await playTestOutput();} catch(e) {el('route-status').textContent=e.message;}
};
el('stop-output').onclick = () => stopSpeechOutput();
el('copy-caption').onclick = () => {el('speech').value=el('zoom-transcript').textContent.slice(-500);};
window.addEventListener('pagehide',()=>chrome.power.releaseKeepAwake());
