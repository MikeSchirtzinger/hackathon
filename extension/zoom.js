const el = id => document.getElementById(id);
const player = el('playback');
window.zoomOutputReady = false;
// Block default-speaker playback until the selected route is confirmed.
player.addEventListener('play', () => {if (!window.zoomOutputReady) player.pause();});
el('connect-output').onclick = async () => {
  try {
    const permission = await navigator.mediaDevices.getUserMedia({audio:true});
    permission.getTracks().forEach(t=>t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const output = devices.find(d=>d.kind==='audiooutput' && /BlackHole 2ch/i.test(d.label));
    if (!output) throw new Error('BlackHole 2ch not installed/visible. Install it, restart Chrome, then retry.');
    await player.setSinkId(output.deviceId);
    window.zoomOutputReady = true;
    chrome.power.requestKeepAwake('system');
    el('route-status').textContent = 'Connected → '+output.label+'. Now select BlackHole 2ch in Zoom microphone settings.';
  } catch(error) {window.zoomOutputReady=false;el('route-status').textContent=error.message;}
};
el('test-output').onclick = async () => {
  if (!window.zoomOutputReady) {el('route-status').textContent='Click Connect BlackHole first.';return;}
  player.src='demo.wav';
  try {await player.play();} catch(e) {el('route-status').textContent=e.message;}
};
el('stop-output').onclick = () => {player.pause();player.currentTime=0;};
el('copy-caption').onclick = () => {el('speech').value=el('zoom-transcript').textContent.slice(-500);};
window.addEventListener('pagehide',()=>chrome.power.releaseKeepAwake());
