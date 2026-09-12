import { card } from './cards';
import { BRIDGE_PERMISSION } from './local-agent';
import type { AttentionSignal, Meeting, ReasoningJob, Settings, AudioSession } from './types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
async function send(type: string, values: Record<string, unknown> = {}) { const response = await chrome.runtime.sendMessage({ type, ...values }); if (!response?.ok) throw new Error(response?.error ?? 'Spark did not respond.'); return response.value; }
function status(text: string, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function run(fn: () => Promise<void>) { try { await fn(); await refresh(); } catch (error) { status(error instanceof Error ? error.message : 'Operation failed.', true); } }
async function refresh() {
  const state: { jobs: ReasoningJob[]; attention: AttentionSignal[]; settings: Settings; audioListening: boolean; audioSessions: AudioSession[]; localAgent: { connected: boolean }; meetings: Meeting[] } = await send('state');
  $('mode').textContent = state.settings.syncMode === 'local' ? 'Local only' : 'Hosted processing allowed';
  const running = state.jobs.filter(j => j.state === 'queued' || j.state === 'running');
  $('background-status').textContent = `${running.length} jobs pending. Automatic reasoning: ${[state.settings.autoAmbiguous && 'Ambiguous', state.settings.autoLocalAgent && 'Codex'].filter(Boolean).join(', ') || 'off'}.`;
  const pending = state.attention.filter(a => !a.surfacedAt && a.mode === 'negotiate').length;
  const digest = state.attention.filter(a => !a.surfacedAt && a.mode === 'digest').length;
  $('pending').textContent = `${pending} decisions and ${digest} summaries saved for when you are ready.`;
  $('connection-status').textContent = state.localAgent.connected ? 'Codex paired. Processing is hosted.' : 'Local bridge not paired.';
  $('listening').hidden = !state.audioListening;
  $('latest').replaceChildren();
  const latest = [...state.attention].filter(a => a.mode !== 'status').sort((a,b)=>b.createdAt-a.createdAt)[0];
  if (latest) $('latest').append(card(latest.mode === 'negotiate' ? 'queue' : latest.mode === 'interrupt' ? 'interrupt' : 'digest', latest.mode === 'negotiate' ? 'Ready for your review' : latest.mode === 'interrupt' ? 'Saved meeting reminder' : 'Summary ready', latest.summary.slice(0,220), latest.resurface === 'on-return' ? 'Saved for your return' : 'Available on request'));
  $('meetings').replaceChildren();
  for (const meeting of state.meetings.filter(m => m.status !== 'ended').slice(-2)) {
    const box = card(meeting.status === 'away' ? 'queue' : 'tracked', meeting.status === 'away' ? 'You stepped away' : meeting.title, meeting.status === 'away' ? 'Absence recorded. Speaking on your behalf is unavailable.' : `Starts ${new Date(meeting.startsAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`, meeting.captureStatus === 'listening' ? 'Transcription listening' : `Capture ${meeting.captureStatus}`);
    const actions = document.createElement('div'); actions.className = 'spark-actions';
    const available = meeting.status === 'away' ? [['return','Return'],['end','End meeting']] : meeting.status === 'present' ? [['away','Mark away'],['end','End meeting']] : [['join','Join'],['listen','Open audio']];
    for (const [action,label] of available) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = () => void run(async () => { await send('meeting-action', { id:meeting.id, action }); status(action === 'return' ? 'Return saved. Speech stopped. Review saved evidence when ready.' : 'Meeting state saved.'); }); actions.append(button);
    }
    box.append(actions); $('meetings').append(box);
  }
}
$('note-form').onsubmit = event => { event.preventDefault(); void run(async () => { await send('popup-note', { text: $<HTMLTextAreaElement>('note').value }); $<HTMLTextAreaElement>('note').value = ''; status('Note saved locally. Enabled providers will analyze it quietly.'); }); };
$('settings').onclick = () => void chrome.runtime.openOptionsPage();
$('review').onclick = () => void chrome.tabs.create({ url: chrome.runtime.getURL('panel.html#attention') });
$('voice').onclick = () => void run(async () => { await send('open-voice'); });
$('connect-local').onclick = () => {
  // Permission request must be the direct result of this explicit user gesture.
  const permission = chrome.permissions.request({ origins: [BRIDGE_PERMISSION] });
  void run(async () => { if (!await permission) throw new Error('Local bridge permission was not granted.'); await send('connect-local', { secret: $<HTMLInputElement>('pairing-secret').value }); $<HTMLInputElement>('pairing-secret').value = ''; status('Codex connected. Automatic reasoning remains separately controlled in Settings.'); });
};
chrome.runtime.onMessage.addListener(message => { if (message.type === 'changed') void refresh().catch(error => status(String(error), true)); });
void run(async () => { await send('popup-open'); status('Ready. Notes save before reasoning.'); });
