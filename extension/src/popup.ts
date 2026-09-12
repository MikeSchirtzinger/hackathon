import { BRIDGE_PERMISSION } from './local-agent';
import type { AttentionSignal, Meeting, ReasoningJob, Settings } from './types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
async function send(type: string, values: Record<string, unknown> = {}) { const response = await chrome.runtime.sendMessage({ type, ...values }); if (!response?.ok) throw new Error(response?.error ?? 'Spark did not respond.'); return response.value; }
function status(text: string, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function run(fn: () => Promise<void>) { try { await fn(); await refresh(); } catch (error) { status(error instanceof Error ? error.message : 'Operation failed.', true); } }
async function refresh() {
  const state: { jobs: ReasoningJob[]; attention: AttentionSignal[]; settings: Settings; localAgent: { connected: boolean }; meetings: Meeting[] } = await send('state');
  $('mode').textContent = state.settings.syncMode === 'local' ? 'Local only' : 'Hosted processing allowed';
  const running = state.jobs.filter(j => j.state === 'queued' || j.state === 'running');
  $('background-status').textContent = `${running.length} jobs pending. Automatic reasoning: ${[state.settings.autoAmbiguous && 'Ambiguous', state.settings.autoLocalAgent && 'Codex'].filter(Boolean).join(', ') || 'off'}.`;
  const pending = state.attention.filter(a => !a.surfacedAt && a.mode === 'negotiate').length;
  const digest = state.attention.filter(a => !a.surfacedAt && a.mode === 'digest').length;
  $('pending').textContent = `${pending} decisions and ${digest} summaries saved for when you are ready.`;
  $('connection-status').textContent = state.localAgent.connected ? 'Codex paired. Processing is hosted.' : 'Local bridge not paired.';
  $('meetings').replaceChildren();
  for (const meeting of state.meetings.filter(m => m.status === 'away')) {
    const button = document.createElement('button'); button.textContent = `Return to ${meeting.title}`;
    button.onclick = () => void run(async () => { await send('meeting-action', { id: meeting.id, action: 'return' }); status('Return saved. Speech stopped. Digest is ready on request.'); }); $('meetings').append(button);
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
