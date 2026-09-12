import type { Absence, ContextSnapshot, Meeting, Note, OutboxItem, Settings, TaskProposal, TranscriptSegment } from './types';
interface State { contexts: ContextSnapshot[]; notes: Note[]; tasks: TaskProposal[]; meetings: Meeting[]; absences: Absence[]; transcripts: TranscriptSegment[]; outbox: OutboxItem[]; settings: Settings; currentContextId?: string; credentialsConfigured: boolean; commands: chrome.commands.Command[]; lastStatus?: { message: string; error: boolean } }
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing panel control: ${selector}`);
  return element;
};
let state: State;
let selectedContextId: string | undefined;
let view = 'notes';
let refreshSequence = 0;
function showStatus(message: string, error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
async function send<T = unknown>(type: string, values: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...values });
  if (!result?.ok) throw new Error(result?.error ?? 'The extension worker did not respond.');
  return result.value as T;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label: string, action: () => Promise<unknown> | void, disabled = false) {
  const node = el('button', label); node.type = 'button'; node.disabled = disabled;
  node.onclick = () => { void run(action); }; return node;
}
async function run(action: () => Promise<unknown> | void) {
  try { await action(); await refresh(); } catch (error) { showStatus(error instanceof Error ? error.message : 'Operation failed.', true); }
}
function when(time: number) { return new Date(time).toLocaleString(); }
function switchView(next: string) {
  view = next;
  for (const section of document.querySelectorAll<HTMLElement>('main > section')) section.hidden = section.id !== `view-${next}`;
  for (const tab of document.querySelectorAll<HTMLElement>('[data-view]')) tab.classList.toggle('active', tab.dataset.view === next);
}
function currentContext() { return state.contexts.find(c => c.id === (selectedContextId ?? state.currentContextId)); }
function contextCard(context: ContextSnapshot) {
  const box = el('div'); box.append(el('h3', context.title));
  if (/^https?:/.test(context.url)) {
    const link = el('a', context.url); link.href = context.url; link.target = '_blank'; link.rel = 'noreferrer'; box.append(link);
  } else box.append(el('p', context.url || 'URL unavailable'));
  box.append(el('p', `${when(context.capturedAt)} · ${context.availability}`, 'meta'));
  if (context.reason) box.append(el('p', context.reason, 'warning'));
  if (context.selection) box.append(el('p', context.selection));
  if (context.visibleText) { const details = el('details'); details.append(el('summary', 'Captured page text'), el('p', context.visibleText)); box.append(details); }
  return box;
}
function renderNotes() {
  const context = currentContext();
  const box = $('#context'); box.replaceChildren(context ? contextCard(context) : el('p', 'No context captured yet. Use the hotkey on a page or click the extension toolbar icon.'));
  $('#note-form button').toggleAttribute('disabled', !context);
  $('#task-form button').toggleAttribute('disabled', !context);
  const notes = $('#notes'); notes.replaceChildren();
  for (const note of [...state.notes].sort((a,b) => b.createdAt - a.createdAt)) {
    const card = el('article'); card.dataset.noteId = note.id;
    card.append(el('p', note.text), el('p', `${when(note.createdAt)} · Saved locally · Text entry`, 'meta'));
    const source = state.contexts.find(c => c.id === note.contextId);
    if (source) card.append(el('p', source.title, 'hint'));
    card.append(button('Restore context', () => { selectedContextId = note.contextId; renderNotes(); })); notes.append(card);
  }
  if (!state.notes.length) notes.append(el('p', 'Your saved thoughts will appear here.', 'empty'));
  const resume = $('#resume');
  const hashId = new URLSearchParams(location.hash.slice(1)).get('context');
  resume.hidden = !hashId;
  if (hashId) {
    resume.replaceChildren(el('h2', 'Resume this context'));
    if (!context) resume.append(el('p', 'This context is not stored in this browser. Local links do not transfer records between devices.', 'warning'));
    else for (const task of state.tasks.filter(t => t.contextId === hashId)) resume.append(el('p', task.title), el('p', task.nextStep), el('p', 'Draft only. Opening this link runs no task.', 'hint'));
  }
}
function renderMeetings() {
  const box = $('#meetings'); box.replaceChildren();
  for (const meeting of [...state.meetings].sort((a,b) => b.createdAt - a.createdAt)) {
    const card = el('article'); card.dataset.meetingId = meeting.id;
    card.append(el('h3', meeting.title), el('p', `Starts ${when(meeting.startsAt)}`, 'hint'), el('p', `Meeting: ${meeting.status} · Transcription: ${meeting.captureStatus} · Speech: ${meeting.speechStatus}`, 'meta'));
    if (meeting.reminderFiredAt) card.append(el('p', `Reminder due ${when(meeting.reminderFiredAt)}`, 'warning'));
    if (meeting.notificationError) card.append(el('p', meeting.notificationError, 'warning'));
    const actions = el('div', undefined, 'row');
    const act = (action: string) => send('meeting-action', { id: meeting.id, action });
    actions.append(button('Join', () => act('join'), meeting.status === 'ended'), button('Start listening', () => act('listen'), true), button('Takeover unavailable', () => act('takeover'), true));
    actions.append(button('Mark away', () => act('away'), meeting.status !== 'present'), button('Return', () => act('return'), meeting.status !== 'away'), button('End meeting', () => act('end'), meeting.status === 'ended'));
    card.append(actions);
    const absences = state.absences.filter(a => a.meetingId === meeting.id);
    for (const absence of absences) card.append(el('p', `Away ${when(absence.startAt)}${absence.endAt ? ` to ${when(absence.endAt)}` : ' (ongoing)'}`, 'meta'));
    if (absences.length || meeting.status === 'ended') {
      const segments = state.transcripts.filter(t => t.sessionId === meeting.id && t.final);
      card.append(el('h3', meeting.status === 'ended' ? 'Meeting record' : 'Catch up'));
      if (!segments.length) card.append(el('p', 'No transcript captured. What you missed and action-item summaries are unavailable.', 'warning'));
      for (const segment of segments) card.append(el('p', `${segment.source === 'agent' ? 'Agent' : segment.speaker ?? 'Speaker unknown'}: ${segment.text}`));
      const related = state.notes.filter(n => n.meetingId === meeting.id || n.contextId === meeting.contextId);
      for (const note of related) card.append(el('p', `Saved note: ${note.text}`));
    }
    box.append(card);
  }
  if (!state.meetings.length) box.append(el('p', 'No meetings saved.', 'empty'));
}
function renderReview() {
  const box = $('#review-items');
  const selected = new Set([...box.querySelectorAll<HTMLInputElement>('input:checked')].map(n => n.value));
  box.replaceChildren();
  for (const record of [...state.notes, ...state.tasks]) {
    if (state.outbox.some(o => o.recordId === record.id)) continue;
    const card = el('article'), label = el('label', undefined, 'check'), input = el('input');
    input.type = 'checkbox'; input.value = record.id; input.dataset.kind = 'text' in record ? 'note' : 'task'; input.checked = selected.has(record.id);
    const content = el('div'); content.append(el('p', 'text' in record ? record.text : record.title));
    if ('nextStep' in record) content.append(el('p', record.nextStep, 'hint'));
    const context = state.contexts.find(c => c.id === record.contextId);
    if (context) content.append(el('p', `${context.title}\n${context.url}\n${context.selection}`, 'hint'));
    content.append(el('p', 'text' in record ? 'Note to private document' : 'Task proposal. Owner and date unspecified.', 'meta'));
    label.append(input, content); card.append(label); box.append(card);
  }
  if (!box.children.length) box.append(el('p', 'No unsent records to review.', 'empty'));
  const enabled = state.settings.syncMode === 'sync' && state.credentialsConfigured && !!state.settings.workspaceLabel;
  $('#approve-sync').toggleAttribute('disabled', !enabled);
  $('#send-approved').toggleAttribute('disabled', !enabled || !state.outbox.some(o => o.state === 'pending'));
  const outbox = $('#outbox'); outbox.replaceChildren();
  for (const item of state.outbox) {
    const card = el('article'); card.append(el('h3', item.payload.title), el('p', `${item.state} · ${item.workspaceLabel}`, 'meta'));
    if (item.lastError) card.append(el('p', item.lastError, 'warning'));
    if (item.remoteId) { card.append(el('p', `Remote ID: ${item.remoteId}`, 'meta')); card.append(button('Read back remote record', () => send('reconcile', { id: item.id }), !enabled)); }
    if (item.state === 'unknown' && !item.remoteId) card.append(el('p', 'No remote ID received. Check the workspace before any new creation. Automatic retry is stopped.', 'hint'));
    outbox.append(card);
  }
}
async function refresh() {
  const sequence = ++refreshSequence;
  const next = await send<State>('state');
  if (sequence !== refreshSequence) return;
  if (state && next.currentContextId !== state.currentContextId && !location.hash) selectedContextId = undefined;
  state = next;
  $('#mode').textContent = state.settings.syncMode === 'local' ? 'Local only' : 'Reviewed sync';
  $<HTMLSelectElement>('#sync-mode').value = state.settings.syncMode;
  if (document.activeElement !== $('#workspace-label')) $<HTMLInputElement>('#workspace-label').value = state.settings.workspaceLabel;
  $('#credential-status').textContent = state.credentialsConfigured ? 'An API key is stored in this browser. Leave blank to keep it.' : 'No API key stored. Nothing can be synced.';
  const shortcut = state.commands.find(c => c.name === 'capture-context')?.shortcut;
  $('#shortcut').textContent = shortcut ? `Capture quietly with ${shortcut}.` : 'Capture shortcut is unassigned. Set it at chrome://extensions/shortcuts.';
  renderNotes(); renderMeetings(); renderReview(); switchView(view);
}
for (const tab of document.querySelectorAll<HTMLElement>('[data-view]')) tab.onclick = () => switchView(tab.dataset.view!);
$('#capture').onclick = () => void run(async () => { selectedContextId = undefined; await send('capture'); showStatus('Context saved locally.'); });
$('#note-form').onsubmit = event => { event.preventDefault(); void run(async () => { const context = currentContext(); if (!context) throw new Error('Capture a page first.'); await send('save-note', { contextId: context.id, text: $<HTMLTextAreaElement>('#note').value }); $<HTMLTextAreaElement>('#note').value = ''; showStatus('Note saved locally.'); }); };
$('#task-form').onsubmit = event => { event.preventDefault(); void run(async () => { await send('save-task', { contextId: currentContext()?.id, title: $<HTMLInputElement>('#task-title').value, nextStep: $<HTMLTextAreaElement>('#next-step').value }); $<HTMLFormElement>('#task-form').reset(); showStatus('Task draft saved for review.'); }); };
$('#meeting-form').onsubmit = event => { event.preventDefault(); void run(async () => { await send('save-meeting', { title: $<HTMLInputElement>('#meeting-title').value, joinUrl: $<HTMLInputElement>('#join-url').value, startsAt: new Date($<HTMLInputElement>('#starts-at').value).getTime(), remindAt: new Date($<HTMLInputElement>('#remind-at').value).getTime() }); showStatus('Meeting reminder saved.'); }); };
$('#sync-mode').onchange = () => void run(async () => { await send('settings', { syncMode: $<HTMLSelectElement>('#sync-mode').value }); showStatus('Sync preference saved.'); });
$('#identity-form').onsubmit = event => { event.preventDefault(); void run(async () => { const token = $<HTMLInputElement>('#api-token').value; if (token) await send('credentials', { token }); $<HTMLInputElement>('#api-token').value = ''; await send('settings', { syncMode: state.settings.syncMode, workspaceLabel: $<HTMLInputElement>('#workspace-label').value }); showStatus('Connection settings saved.'); }); };
$('#clear-token').onclick = () => void run(async () => { await send('credentials', { token: '' }); showStatus('API key removed.'); });
$('#approve-sync').onclick = () => void run(async () => {
  const checked = [...document.querySelectorAll<HTMLInputElement>('#review-items input:checked')];
  await send('approve-sync', { noteIds: checked.filter(c => c.dataset.kind === 'note').map(c => c.value), taskIds: checked.filter(c => c.dataset.kind === 'task').map(c => c.value) }); showStatus('Selected batch approved locally. Press Send approved batch to send.');
});
$('#send-approved').onclick = () => void run(async () => { await send('send-approved'); showStatus('Sending approved records. Local copies remain saved.'); });
chrome.runtime.onMessage.addListener(message => { if (message.type === 'changed') void refresh().catch(error => showStatus(String(error), true)); });
function readHash() { selectedContextId = new URLSearchParams(location.hash.slice(1)).get('context') ?? undefined; }
window.onhashchange = () => { readHash(); switchView('notes'); void refresh(); };
readHash();
void refresh().then(() => showStatus('Local workspace ready.')).catch(error => showStatus(String(error), true));
