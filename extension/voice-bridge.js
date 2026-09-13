import { stopSpeechOutput } from './speech-output.js';
const feedback = message => { const element = document.getElementById('local-save-status'); if (element) element.textContent = message; };
export async function voiceMessage(type, values = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...values });
  if (!response?.ok) throw new Error(response?.error ?? 'Local workspace did not respond.');
  return response.value;
}
// Each capture owns its writer. A late permission/load result cannot write into a newer session.
export class TranscriptWriter {
  constructor() { this.segment = 0; this.revision = 0; this.segmentStartMs = 0; this.writeChain = Promise.resolve(); }
  begin(source) {
    this.beginning = voiceMessage('voice-begin', { source }).then(session => { this.session = session; feedback('Transcript session saved locally.'); return session; });
    return this.beginning;
  }
  persist(text, final, endMs) {
    if (!this.session) return Promise.reject(Error('No local transcript session is active.'));
    const data = { protocol: 1, sessionId: this.session.id, segmentId: String(this.segment), sequence: this.segment, revision: ++this.revision, createdAt: Date.now(), startMs: this.segmentStartMs, endMs: Math.max(this.segmentStartMs, endMs), text, final, source: 'human', timing: 'decoded-audio' };
    if (final) { this.segment++; this.revision = 0; this.segmentStartMs = data.endMs; }
    this.writeChain = this.writeChain.then(async () => { await voiceMessage('voice-segment', { segment: data }); feedback(final ? 'Transcript saved locally.' : 'Live transcript saved locally.'); });
    return this.writeChain;
  }
  async buffer(database) { if (this.session) await voiceMessage('voice-buffer', { sessionId: this.session.id, database }); }
  async inputActive(active) { if (this.session) await voiceMessage('voice-input-status', { sessionId: this.session.id, active }); }
  async status(status, detail, pendingAudio) {
    await this.beginning;
    if (this.session) await voiceMessage('voice-status', { sessionId: this.session.id, status, detail, ...(pendingAudio ? { pendingAudio } : {}) });
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'voice-control') return;
  if (message.action === 'stop-output') respond(stopSpeechOutput('Output stopped by the meeting controls.'));
});
window.addEventListener('pagehide', () => { stopSpeechOutput('Audio workspace closed.'); });
