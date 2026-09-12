import { stopSpeechOutput } from './speech-output.js';
let session;
let segment = 0;
let revision = 0;
let segmentStartMs = 0;
let writeChain = Promise.resolve();
const feedback = message => { const element = document.getElementById('local-save-status'); if (element) element.textContent = message; };
export async function voiceMessage(type, values = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...values });
  if (!response?.ok) throw new Error(response?.error ?? 'Local workspace did not respond.');
  return response.value;
}
export async function beginLocalTranscript(source) {
  await writeChain.catch(() => undefined);
  session = await voiceMessage('voice-begin', { source });
  writeChain = Promise.resolve();
  segment = 0; revision = 0; segmentStartMs = 0;
  feedback('Transcript session saved locally.');
  return session;
}
export function persistTranscript(text, final, endMs) {
  if (!session) return Promise.reject(new Error('No local transcript session is active.'));
  const data = { protocol: 1, sessionId: session.id, segmentId: String(segment), sequence: segment, revision: ++revision, createdAt: Date.now(), startMs: segmentStartMs, endMs: Math.max(segmentStartMs, endMs), text, final, source: 'human', timing: 'decoded-audio' };
  if (final) { segment += 1; revision = 0; segmentStartMs = data.endMs; }
  writeChain = writeChain.then(async () => {
    await voiceMessage('voice-segment', { segment: data });
    feedback(final ? 'Transcript saved locally.' : 'Live transcript saved locally.');
  }).catch(error => { feedback(`Local transcript save failed: ${error.message}`); throw error; });
  return writeChain;
}
export async function captureStatus(status, detail) {
  if (!session) return;
  await voiceMessage('voice-status', { sessionId: session.id, status, detail });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'voice-control') return;
  if (message.action === 'stop-output') {
    const result = stopSpeechOutput('Output stopped by the meeting controls.');
    respond(result);
  }
});
window.addEventListener('pagehide', () => {
  stopSpeechOutput('Audio workspace closed.');
  void captureStatus('stopped', 'Audio workspace closed.').catch(() => undefined);
});
