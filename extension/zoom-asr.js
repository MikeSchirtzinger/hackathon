import { captureSession } from './app.js';
import { stopSpeechOutput } from './speech-output.js';
document.getElementById('listen-zoom').onclick = () => {
  stopSpeechOutput('Meeting transcription started.');
  void captureSession.start('tab').catch(error => { document.getElementById('zoom-asr-status').textContent = error.message; });
};
document.getElementById('stop-zoom').onclick = () => void captureSession.stop().catch(error => { document.getElementById('zoom-asr-status').textContent = error.message; });
