import { validateSegment } from './transcript';
import { all, get, put, settings, writeBatch } from './db';
import { base, type Meeting, type Note, type Settings, type TaskProposal, type AudioSession } from './types';
import { captureContext } from './capture';
import { safeWebUrl } from './policy';
import { approveBatch, credentials, haltSync, pumpOutbox, reconcile, recoverOutbox, setSyncEnabled, storeCredentials } from './ambiguous';

let mutationQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}
async function changed() { await chrome.runtime.sendMessage({ type: 'changed' }).catch(() => undefined); }
async function status(message: string, error = false) {
  await put('settings', { id: 'lastStatus', value: { message, error, at: Date.now() } });
  await chrome.action.setBadgeText({ text: error ? '!' : 'OK' });
  await chrome.action.setBadgeBackgroundColor({ color: error ? '#9f3030' : '#26604d' });
  await changed();
}
async function capture(tab: chrome.tabs.Tab, source: 'hotkey' | 'button') {
  const context = await captureContext(tab, source);
  await status(context.availability === 'available' ? 'Context saved locally.' : 'Context saved. Page text unavailable.');
  return context;
}
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab?.windowId !== undefined) { void chrome.sidePanel.open({ windowId: tab.windowId }).catch(error => status(String(error), true)); return; }
  if (command === 'capture-context') {
    // Chrome supplies the original tab at the command boundary. Never re-query after capture starts.
    void serialize(async () => {
      if (!tab) throw new Error('The hotkey did not identify a tab.');
      await capture(tab, 'hotkey');
    }).catch(error => status(error instanceof Error ? error.message : 'Capture failed.', true));
  }
});
chrome.action.onClicked.addListener(tab => {
  if (tab.id && tab.url && /^https:\/\/([\w-]+\.)?zoom\.us\//.test(tab.url)) void chrome.storage.session.set({ zoomSourceTab: tab.id });
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
  void serialize(() => capture(tab, 'button')).catch(error => status(String(error), true));
});
async function scheduleReminder(meeting: Meeting) {
  await chrome.alarms.create(`meeting:${meeting.id}`, { when: Math.max(Date.now() + 100, meeting.remindAt) });
}
async function restoreAlarms() {
  for (const meeting of await all('meetings')) if (meeting.status !== 'ended' && !meeting.reminderFiredAt) await scheduleReminder(meeting);
}
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  setSyncEnabled((await settings()).syncMode === 'sync');
  await recoverOutbox();
  await recoverAudioSessions();
  await restoreAlarms();
}
const ready = initialize();
chrome.runtime.onInstalled.addListener(() => { void ready.catch(error => status(String(error), true)); });
chrome.runtime.onStartup.addListener(() => { void ready.catch(error => status(String(error), true)); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith('meeting:')) return;
  void serialize(async () => {
    await ready;
    const meeting = await get('meetings', alarm.name.slice(8));
    if (!meeting || meeting.status === 'ended' || meeting.reminderFiredAt) return;
    const next = { ...meeting, reminderFiredAt: Date.now(), revision: meeting.revision + 1 };
    await put('meetings', next);
    try { await chrome.notifications.create(`meeting:${meeting.id}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icon.png'), title: meeting.title, message: 'Your saved meeting reminder is due. Click to join.', priority: 2 }); }
    catch { await put('meetings', { ...next, notificationError: 'System notification unavailable. The reminder is visible here.' }); }
    await changed();
  }).catch(error => status(String(error), true));
});
chrome.notifications.onClicked.addListener(id => {
  if (!id.startsWith('meeting:')) return;
  void get('meetings', id.slice(8)).then(meeting => meeting && chrome.tabs.create({ url: safeWebUrl(meeting.joinUrl) }));
});
function text(value: unknown, max = 20000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Enter valid text within the allowed length.');
  return value.trim();
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string')) throw new Error('Invalid review selection.');
  return value;
}
async function interruptAudioSession(session: AudioSession, detail: string) {
  await put('audioSessions', { ...session, captureStatus: 'error', endedAt: Date.now(), detail, revision: session.revision + 1 });
  const meeting = session.meetingId ? await get('meetings', session.meetingId) : undefined;
  if (meeting) await put('meetings', { ...meeting, captureStatus: 'error', speechStatus: 'stopped', revision: meeting.revision + 1 });
}
async function recoverAudioSessions() {
  const owners = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  for (const session of await all('audioSessions')) {
    if (!['starting','listening'].includes(session.captureStatus)) continue;
    const ownerExists = owners.some(owner => owner.tabId === session.tabId && owner.documentId === session.ownerDocumentId && owner.documentUrl === chrome.runtime.getURL('index.html'));
    if (!ownerExists) await interruptAudioSession(session, 'Audio owner closed, reloaded, or restarted before capture finished. Transcript retained.');
  }
}
async function stopVoiceOutput() {
  const tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('index.html')] });
  if (!tabs.length) return;
  const response = await chrome.runtime.sendMessage({ type: 'voice-control', action: 'stop-output' });
  if (!response?.stopped) throw new Error('Speech stop was not acknowledged. Use Stop audio in Voice Lab.');
}
async function openVoice(meetingId?: string) {
  await chrome.storage.session.set({ voiceMeetingId: meetingId ?? null });
  const tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('index.html')] });
  if (tabs[0] && tabs[0].tabId >= 0) { await chrome.tabs.update(tabs[0].tabId, { active: true }); return; }
  await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
}
async function handle(message: Record<string, unknown>, sender?: chrome.runtime.MessageSender) {
  await ready;
  switch (message.type) {
    case 'open-voice': {
      const meetingId = typeof message.meetingId === 'string' ? message.meetingId : undefined;
      if (meetingId && !await get('meetings', meetingId)) throw new Error('Meeting not found.');
      await openVoice(meetingId); return true;
    }
    case 'capture-zoom': {
      const { zoomSourceTab } = await chrome.storage.session.get('zoomSourceTab');
      if (typeof zoomSourceTab !== 'number' || !Number.isInteger(zoomSourceTab)) throw new Error('Click the extension icon on your Zoom meeting tab first.');
      const consumer = sender?.tab?.id;
      if (!Number.isInteger(consumer)) throw new Error('Open Voice Lab as an extension tab.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: zoomSourceTab, consumerTabId: consumer });
      return { streamId };
    }
    case 'voice-begin': {
      await recoverAudioSessions();
      const tabId = sender?.tab?.id;
      const ownerDocumentId = sender?.documentId;
      if (typeof tabId !== 'number' || !ownerDocumentId || !['sample', 'microphone', 'zoom'].includes(String(message.source))) throw new Error('Invalid audio workspace session.');
      const active = (await all('audioSessions')).find(session => session.captureStatus === 'listening' || session.captureStatus === 'starting');
      if (active) throw new Error('Finish the active audio capture before starting another source.');
      const link = await chrome.storage.session.get('voiceMeetingId');
      const meeting = typeof link.voiceMeetingId === 'string' ? await get('meetings', link.voiceMeetingId) : undefined;
      const current = await get('settings', 'currentContext');
      const session: AudioSession = { ...base(), tabId, ownerDocumentId, source: message.source as AudioSession['source'], contextId: meeting?.contextId ?? (typeof current?.value === 'string' ? current.value : undefined), meetingId: meeting?.status !== 'ended' && message.source === 'zoom' ? meeting?.id : undefined, captureStatus: 'starting', startedAt: Date.now() };
      await put('audioSessions', session); await changed(); return session;
    }
    case 'voice-segment': {
      const segment = validateSegment(message.segment);
      const session = await get('audioSessions', segment.sessionId);
      if (!session || session.tabId !== sender?.tab?.id || session.ownerDocumentId !== sender?.documentId) throw new Error('Transcript producer does not own this audio session.');
      const existing = await get('transcripts', segment.id);
      if (existing && (existing.revision >= segment.revision || existing.final)) return existing;
      await put('transcripts', segment); await changed(); return segment;
    }
    case 'voice-status': {
      const session = await get('audioSessions', text(message.sessionId, 100));
      if (!session || session.tabId !== sender?.tab?.id || session.ownerDocumentId !== sender?.documentId) throw new Error('Audio status producer does not own this session.');
      if (!['listening','stopped','error'].includes(String(message.status))) throw new Error('Invalid capture status.');
      const captureStatus = message.status as 'listening' | 'stopped' | 'error';
      await put('audioSessions', { ...session, captureStatus, detail: typeof message.detail === 'string' ? message.detail.slice(0,1000) : undefined, endedAt: captureStatus === 'listening' ? undefined : Date.now(), revision: session.revision + 1 });
      const meeting = session.meetingId ? await get('meetings', session.meetingId) : undefined;
      if (meeting) await put('meetings', { ...meeting, captureStatus, revision: meeting.revision + 1 });
      await changed(); return true;
    }
    case 'voice-output-status': {
      await put('settings', { id: 'voiceOutput', value: { ready: message.ready === true, tabId: sender?.tab?.id, at: Date.now() } });
      await changed(); return true;
    }
    case 'state': {
      const [contexts, notes, tasks, meetings, absences, transcripts, outbox, prefs, current, last, auth, commands] = await Promise.all([all('contexts'), all('notes'), all('tasks'), all('meetings'), all('absences'), all('transcripts'), all('outbox'), settings(), get('settings', 'currentContext'), get('settings', 'lastStatus'), credentials(), chrome.commands.getAll()]);
      return { contexts, notes, tasks, meetings, absences, transcripts, outbox, audioSessions: await all('audioSessions'), settings: prefs, currentContextId: current?.value, lastStatus: last?.value, credentialsConfigured: !!auth.token, commands };
    }
    case 'capture': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active page is available.');
      return capture(tab, 'button');
    }
    case 'save-note': {
      const contextId = text(message.contextId, 100);
      if (!await get('contexts', contextId)) throw new Error('Capture context before saving a note.');
      const note: Note = { ...base(), contextId, text: text(message.text), source: 'manual', syncEligible: (await settings()).syncMode === 'sync', reasoning: 'unavailable' };
      if (typeof message.meetingId === 'string' && await get('meetings', message.meetingId)) note.meetingId = message.meetingId;
      await put('notes', note);
      await status('Note saved locally. Reasoning is not configured.');
      return note;
    }
    case 'save-transcript-note': {
      const segment = await get('transcripts', text(message.segmentId, 200));
      const session = segment ? await get('audioSessions', segment.sessionId) : undefined;
      if (!segment?.final || !session?.contextId || !await get('contexts', session.contextId)) throw new Error('A final transcript with saved context is required.');
      const note: Note = { ...base(), contextId: session.contextId, text: text(segment.text), source: 'transcript', transcriptId: segment.id, meetingId: session.meetingId, syncEligible: (await settings()).syncMode === 'sync', reasoning: 'unavailable' };
      await put('notes', note); await status('Transcript note saved locally.'); return note;
    }
    case 'save-task': {
      const contextId = text(message.contextId, 100);
      if (!await get('contexts', contextId)) throw new Error('Capture context before drafting a task.');
      const task: TaskProposal = { ...base(), title: text(message.title, 255), nextStep: text(message.nextStep), contextId, evidenceIds: [contextId], kind: 'follow-up', delivery: 'queued-decision', authority: 'proposal-only', resurface: 'return' };
      await put('tasks', task); await status('Task draft saved for review.'); return task;
    }
    case 'save-meeting': {
      const startsAt = Number(message.startsAt), remindAt = Number(message.remindAt);
      if (!Number.isFinite(startsAt) || !Number.isFinite(remindAt) || startsAt <= Date.now() || remindAt > startsAt || remindAt <= Date.now()) throw new Error('Choose a future start and reminder time.');
      const current = await get('settings', 'currentContext');
      const meeting: Meeting = { ...base(), title: text(message.title, 255), joinUrl: safeWebUrl(text(message.joinUrl, 3000)), startsAt, remindAt, status: 'scheduled', captureStatus: 'unavailable', speechStatus: 'unavailable', contextId: typeof current?.value === 'string' ? current.value : undefined };
      await put('meetings', meeting); await scheduleReminder(meeting); await changed(); return meeting;
    }
    case 'meeting-action': {
      const meeting = await get('meetings', text(message.id, 100));
      if (!meeting) throw new Error('Meeting not found.');
      const action = message.action;
      if (action === 'takeover') throw new Error('Takeover unavailable. No verified speech transport or speaking authority is configured.');
      if (action === 'listen') { await openVoice(meeting.id); return meeting; }
      if (meeting.status === 'ended') throw new Error('This meeting has ended.');
      const next = { ...meeting, revision: meeting.revision + 1 };
      if (action === 'join') { next.status = 'present'; await put('meetings', next); await chrome.tabs.create({ url: safeWebUrl(meeting.joinUrl) }); }
      else if (action === 'away') {
        if (meeting.status !== 'present') throw new Error('Join the meeting before marking an absence.');
        next.status = 'away';
        await writeBatch([{ store: 'meetings', value: next }, { store: 'absences', value: { ...base(), meetingId: meeting.id, startAt: Date.now() } }]);
      } else if (action === 'return' || action === 'end') {
        await stopVoiceOutput();
        next.speechStatus = 'stopped';
        next.status = action === 'end' ? 'ended' : 'present';
        if (action === 'end') { next.endedAt = Date.now(); await chrome.alarms.clear(`meeting:${meeting.id}`); }
        const open = (await all('absences')).filter(a => a.meetingId === meeting.id && !a.endAt);
        await writeBatch([{ store: 'meetings', value: next }, ...open.map(a => ({ store: 'absences' as const, value: { ...a, endAt: Date.now(), revision: a.revision + 1 } }))]);
      } else throw new Error('Unknown meeting action.');
      await changed(); return next;
    }
    case 'settings': {
      const old = await settings();
      const syncMode = message.syncMode;
      if (!['local', 'sync'].includes(String(syncMode))) throw new Error('Invalid sync mode.');
      if (syncMode === 'local') haltSync();
      const next: Settings = { ...old, syncMode: syncMode as Settings['syncMode'], workspaceLabel: typeof message.workspaceLabel === 'string' ? message.workspaceLabel.trim().slice(0, 200) : old.workspaceLabel };
      await put('settings', { id: 'preferences', value: next });
      setSyncEnabled(next.syncMode === 'sync');
      await changed(); return next;
    }
    case 'credentials': await storeCredentials(typeof message.token === 'string' ? message.token : ''); await changed(); return true;
    case 'approve-sync': { const result = await approveBatch(ids(message.noteIds), ids(message.taskIds)); await changed(); return result; }
    case 'send-approved': void pumpOutbox().then(changed).catch(() => status('Sync failed. Local records remain saved.', true)); return true;
    case 'reconcile': {
      const item = await get('outbox', text(message.id, 100));
      if (!item) throw new Error('Outbox record not found.');
      await reconcile(item); await changed(); return true;
    }
    default: throw new Error('Unknown extension operation.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || ['changed','voice-control'].includes(message.type)) return;
  const panelOrigin = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('panel.html');
  const voiceOrigin = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('index.html');
  const voiceOperations = ['capture-zoom','voice-begin','voice-segment','voice-status','voice-output-status'];
  if (sender.id !== chrome.runtime.id || (voiceOperations.includes(message.type) ? !voiceOrigin : !panelOrigin)) { reply({ ok: false, error: 'This operation requires its extension workspace.' }); return; }
  if (message.type === 'meeting-action' && ['return','end'].includes(message.action)) void stopVoiceOutput().catch(() => undefined);
  if (message.type === 'settings' && message.syncMode === 'local') haltSync();
  const run = message.type === 'state' ? handle(message, sender) : serialize(() => handle(message, sender));
  void run.then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error instanceof Error ? error.message : 'Operation failed.' }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void serialize(async () => {
    for (const session of await all('audioSessions')) {
      if (session.tabId !== tabId || ['stopped','error'].includes(session.captureStatus)) continue;
      await interruptAudioSession(session, 'Audio workspace closed before capture finished. Transcript retained.');
    }
    await changed();
  }).catch(() => undefined);
});
