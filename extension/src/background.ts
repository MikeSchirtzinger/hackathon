import { authorizeSurface, acknowledgeCapture, refreshListeningSurface, revokeTabSurfaces, surfaceMessage, listeningNow } from './surfaces';
import { validateSegment } from './transcript';
import { all, get, put, settings, writeBatch } from './db';
import { base, type Meeting, type Note, type Settings, type TaskProposal, type AudioSession } from './types';
import { captureContext } from './capture';
import { safeWebUrl } from './policy';
import { approveBatch, calendarRead, readCalendarEvent, credentials, haltSync, pumpOutbox, reconcile, recoverOutbox, setSyncEnabled, storeCredentials } from './ambiguous';
import { calendarId, importCalendarEvent, object } from './calendar';
import { analyze, recoverAnalyses, stopHostedAnalysis } from './hosted';
import { queueReasoning, recoverJobs, wakeJobs, revokeJobs, cancelJob } from './jobs';
import { pairing, connectLocalAgent, disconnectLocalAgent, invalidateConnectionAttempt } from './local-agent';
import { meetingAttention, flushAttention, recoverAttention, surfaceAttention } from './attention';

let mutationQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}
async function changed() { await chrome.runtime.sendMessage({ type: 'changed' }).catch(() => undefined); }
async function status(message: string, error = false) {
  await put('settings', { id: 'lastStatus', value: { message, error, at: Date.now() } });

  await changed();
}
async function capture(tab: chrome.tabs.Tab, source: 'hotkey' | 'button') {
  const context = await captureContext(tab, source);
  void acknowledgeCapture(context).catch(() => undefined);
  await status(context.availability === 'available' ? 'Context saved locally.' : 'Context saved. Page text unavailable.');
  void queueReasoning('context', context.id).catch(error => status(String(error), true));
  return context;
}
async function authorizeAudioTab(tab: chrome.tabs.Tab) {
  await authorizeSurface(tab);
  if (typeof tab.id === 'number' && tab.url && /^https?:/.test(tab.url)) {
    await chrome.storage.session.set({ audioSourceTab: { id: tab.id, url: safeWebUrl(tab.url), title: tab.title ?? '' } });
  }
}
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel') { void chrome.action.openPopup().catch(error => status(String(error), true)); return; }
  if (command === 'capture-context') {
    // Chrome supplies the original tab at the command boundary. Never re-query after capture starts.
    void serialize(async () => {
      if (!tab) throw new Error('The hotkey did not identify a tab.');
      await authorizeAudioTab(tab);
      await capture(tab, 'hotkey');
    }).catch(error => status(error instanceof Error ? error.message : 'Capture failed.', true));
  }
});
async function scheduleReminder(meeting: Meeting) {
  if (meeting.reminderEnabled === false || meeting.status === 'ended' || meeting.reminderFiredAt) { await chrome.alarms.clear(`meeting:${meeting.id}`); return; }
  await chrome.alarms.create(`meeting:${meeting.id}`, { when: Math.max(Date.now() + 100, meeting.remindAt) });
}
async function restoreAlarms() {
  for (const meeting of await all('meetings')) if (meeting.status !== 'ended' && !meeting.reminderFiredAt) await scheduleReminder(meeting);
}
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  setSyncEnabled((await settings()).syncMode === 'sync');
  await recoverOutbox();
  await recoverAnalyses();
  await recoverAudioSessions();
  await restoreAlarms();
  await chrome.action.setBadgeText({ text: '' });
  await recoverAttention();
  await recoverJobs();
  void refreshListeningSurface().catch(() => undefined);
}
const ready = initialize();
chrome.runtime.onInstalled.addListener(() => { void ready.catch(error => status(String(error), true)); });
chrome.runtime.onStartup.addListener(() => { void ready.catch(error => status(String(error), true)); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'reasoning-jobs') { void ready.then(wakeJobs); return; }
  if (alarm.name === 'attention-flush' || alarm.name.startsWith('attention-deadline:')) { void ready.then(flushAttention).then(changed); return; }
  if (alarm.name.startsWith('attention-clear:')) { void chrome.notifications.clear(alarm.name.slice(16)); return; }
  if (!alarm.name.startsWith('meeting:')) return;
  void serialize(async () => {
    await ready;
    const meeting = await get('meetings', alarm.name.slice(8));
    if (!meeting || meeting.reminderEnabled === false || meeting.status === 'ended' || meeting.reminderFiredAt) return;
    const next = { ...meeting, reminderFiredAt: Date.now(), revision: meeting.revision + 1 };
    await put('meetings', next);
    await meetingAttention(next);
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
function isVoiceDocument(url?: string) { return url?.split(/[?#]/)[0] === chrome.runtime.getURL('index.html'); }
async function voiceContexts() { return (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter(owner => isVoiceDocument(owner.documentUrl)); }
async function recoverAudioSessions() {
  const owners = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  for (const session of await all('audioSessions')) {
    if (!['starting','listening'].includes(session.captureStatus)) continue;
    const ownerExists = owners.some(owner => owner.tabId === session.tabId && owner.documentId === session.ownerDocumentId && isVoiceDocument(owner.documentUrl));
    if (!ownerExists) await interruptAudioSession(session, 'Audio owner closed, reloaded, or restarted before capture finished. Transcript retained.');
  }
}
async function stopVoiceOutput() {
  const tabs = await voiceContexts();
  if (!tabs.length) return;
  const response = await chrome.runtime.sendMessage({ type: 'voice-control', action: 'stop-output' });
  if (!response?.stopped) throw new Error('Speech stop was not acknowledged. Use Stop audio in Voice Lab.');
}
async function openVoice(meetingId?: string) {
  await chrome.storage.session.set({ voiceMeetingId: meetingId ?? null });
  const tabs = await voiceContexts();
  if (tabs[0] && tabs[0].tabId >= 0) { await chrome.tabs.update(tabs[0].tabId, { active: true }); return; }
  await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
}
async function importEvent(id: string, triggerAt?: number) {
  const event = await readCalendarEvent(id);
  if (triggerAt === undefined) {
    const response = await calendarRead(`events/${calendarId(id)}/reminders`);
    if (!Array.isArray(response.reminders)) throw new Error('Ambiguous returned an invalid reminder list.');
    const startsAt = Date.parse(String(event.start_at));
    const times = response.reminders.map(object).filter(r => r.event_id === id && !r.fired_at && typeof r.minutes_before === 'number' && r.minutes_before >= 0).map(r => startsAt - Number(r.minutes_before) * 60000).filter(t => t >= Date.now());
    triggerAt = times.length ? Math.min(...times) : undefined;
  }
  const existing = (await all('meetings')).find(m => m.remote?.eventId === event.id && m.remote?.workspaceId === event.workspace_id);
  const meeting = importCalendarEvent(event, triggerAt, existing);
  if (!existing) { const current = await get('settings', 'currentContext'); meeting.contextId = typeof current?.value === 'string' ? current.value : undefined; }
  await put('meetings', meeting); await scheduleReminder(meeting); await changed();
  return meeting;
}
async function handle(message: Record<string, unknown>, sender?: chrome.runtime.MessageSender) {
  await ready;
  switch (message.type) {
    case 'open-voice': {
      const meetingId = typeof message.meetingId === 'string' ? message.meetingId : undefined;
      if (meetingId && !await get('meetings', meetingId)) throw new Error('Meeting not found.');
      await openVoice(meetingId); return true;
    }
    case 'capture-zoom':
    case 'capture-tab': {
      const result = await chrome.storage.session.get('audioSourceTab');
      if (!result.audioSourceTab) throw new Error('Click the extension icon or use the capture hotkey on your meeting tab first.');
      const audioSourceTab = object(result.audioSourceTab);
      if (typeof audioSourceTab.id !== 'number' || !Number.isInteger(audioSourceTab.id) || typeof audioSourceTab.url !== 'string') throw new Error('Authorize a meeting tab before listening.');
      const tab = await chrome.tabs.get(audioSourceTab.id);
      if (!tab.url || tab.url.split('#')[0] !== audioSourceTab.url.split('#')[0]) throw new Error('The authorized tab changed. Invoke the extension on the meeting tab again.');
      const consumer = sender?.tab?.id;
      if (!Number.isInteger(consumer)) throw new Error('Open Voice Lab as an extension tab.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: audioSourceTab.id, consumerTabId: consumer });
      return { streamId, title: audioSourceTab.title, url: audioSourceTab.url };
    }
    case 'voice-begin': {
      await recoverAudioSessions();
      const tabId = sender?.tab?.id;
      const ownerDocumentId = sender?.documentId;
      if (typeof tabId !== 'number' || !ownerDocumentId || !['sample', 'microphone', 'zoom', 'tab'].includes(String(message.source))) throw new Error('Invalid audio workspace session.');
      const active = (await all('audioSessions')).find(session => session.captureStatus === 'listening' || session.captureStatus === 'starting');
      if (active) throw new Error('Finish the active audio capture before starting another source.');
      const link = await chrome.storage.session.get('voiceMeetingId');
      const meeting = typeof link.voiceMeetingId === 'string' ? await get('meetings', link.voiceMeetingId) : undefined;
      const current = await get('settings', 'currentContext');
      const session: AudioSession = { ...base(), tabId, ownerDocumentId, source: message.source as AudioSession['source'], contextId: meeting?.contextId ?? (typeof current?.value === 'string' ? current.value : undefined), meetingId: meeting?.status !== 'ended' && ['zoom','tab'].includes(String(message.source)) ? meeting?.id : undefined, captureStatus: 'starting', startedAt: Date.now() };
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
    case 'voice-input-status': {
      const session = await get('audioSessions', text(message.sessionId, 100));
      if (!session || session.tabId !== sender?.tab?.id || session.ownerDocumentId !== sender?.documentId || typeof message.active !== 'boolean') throw new Error('Audio input producer does not own this session.');
      if (message.active && (session.source === 'sample' || session.captureStatus !== 'listening')) throw new Error('Audio input is not listening.');
      await put('audioSessions', { ...session, inputActive: message.active, revision: session.revision + 1 });
      void refreshListeningSurface().catch(() => undefined);
      await changed(); return true;
    }
    case 'voice-status': {
      const session = await get('audioSessions', text(message.sessionId, 100));
      if (!session || session.tabId !== sender?.tab?.id || session.ownerDocumentId !== sender?.documentId) throw new Error('Audio status producer does not own this session.');
      if (!['listening','stopped','error'].includes(String(message.status))) throw new Error('Invalid capture status.');
      const captureStatus = message.status as 'listening' | 'stopped' | 'error';
      await put('audioSessions', { ...session, captureStatus, inputActive: captureStatus === 'listening' && session.inputActive === true, detail: typeof message.detail === 'string' ? message.detail.slice(0,1000) : undefined, endedAt: captureStatus === 'listening' ? undefined : Date.now(), revision: session.revision + 1 });
      const meeting = session.meetingId ? await get('meetings', session.meetingId) : undefined;
      if (meeting) await put('meetings', { ...meeting, captureStatus, revision: meeting.revision + 1 });
      void refreshListeningSurface().catch(() => undefined);
      await changed(); return true;
    }
    case 'voice-output-status': {
      await put('settings', { id: 'voiceOutput', value: { ready: message.ready === true, tabId: sender?.tab?.id, at: Date.now() } });
      await changed(); return true;
    }
    case 'state': {
      const [contexts, notes, tasks, meetings, absences, transcripts, outbox, prefs, current, last, auth, commands] = await Promise.all([all('contexts'), all('notes'), all('tasks'), all('meetings'), all('absences'), all('transcripts'), all('outbox'), settings(), get('settings', 'currentContext'), get('settings', 'lastStatus'), credentials(), chrome.commands.getAll()]);
      return { contexts, notes, tasks, meetings, absences, transcripts, outbox, audioListening: await listeningNow(), analyses: await all('analyses'), jobs: await all('jobs'), attention: await all('attention'), localAgent: { connected: (await pairing()).connected, processing: 'hosted', provider: 'codex' }, audioSessions: await all('audioSessions'), settings: prefs, currentContextId: current?.value, lastStatus: last?.value, credentialsConfigured: !!auth.token, commands };
    }
    case 'popup-open': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await authorizeAudioTab(tab);
      void refreshListeningSurface().catch(() => undefined);
      return true;
    }
    case 'attention-request': return surfaceAttention('on-request');
    case 'cancel-job': return cancelJob(text(message.id, 100));
    case 'connect-local': return connectLocalAgent(message.secret);
    case 'disconnect-local': await revokeJobs('codex'); await disconnectLocalAgent(); await changed(); return true;
    case 'popup-note': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active page is available.');
      const context = await captureContext(tab, 'button');
      const note: Note = { ...base(), contextId: context.id, text: text(message.text), source: 'manual', syncEligible: (await settings()).syncMode === 'sync', reasoning: 'unavailable' };
      await put('notes', note);
      const noteContext = await get('contexts', note.contextId);
      if (noteContext) void acknowledgeCapture(noteContext, true).catch(() => undefined);
      void queueReasoning('note', note.id).catch(error => status(String(error), true));
      await status('Note saved locally.'); return note;
    }
    case 'capture': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active page is available.');
      await authorizeSurface(tab);
      return capture(tab, 'button');
    }
    case 'save-note': {
      const contextId = text(message.contextId, 100);
      if (!await get('contexts', contextId)) throw new Error('Capture context before saving a note.');
      const note: Note = { ...base(), contextId, text: text(message.text), source: 'manual', syncEligible: (await settings()).syncMode === 'sync', reasoning: 'unavailable' };
      if (typeof message.meetingId === 'string' && await get('meetings', message.meetingId)) note.meetingId = message.meetingId;
      await put('notes', note);
      const noteContext = await get('contexts', note.contextId);
      if (noteContext) void acknowledgeCapture(noteContext, true).catch(() => undefined);
      void queueReasoning('note', note.id).catch(error => status(String(error), true));
      await status('Note saved locally.');
      return note;
    }
    case 'save-transcript-note': {
      const segment = await get('transcripts', text(message.segmentId, 200));
      const session = segment ? await get('audioSessions', segment.sessionId) : undefined;
      if (!segment?.final || !session?.contextId || !await get('contexts', session.contextId)) throw new Error('A final transcript with saved context is required.');
      const note: Note = { ...base(), contextId: session.contextId, text: text(segment.text), source: 'transcript', transcriptId: segment.id, meetingId: session.meetingId, syncEligible: (await settings()).syncMode === 'sync', reasoning: 'unavailable' };
      await put('notes', note); void queueReasoning('note', note.id).catch(error => status(String(error), true)); await status('Transcript note saved locally.'); return note;
    }
    case 'save-task': {
      const contextId = text(message.contextId, 100);
      if (!await get('contexts', contextId)) throw new Error('Capture context before drafting a task.');
      const task: TaskProposal = { ...base(), title: text(message.title, 255), nextStep: text(message.nextStep), contextId, evidenceIds: [contextId], kind: 'follow-up', delivery: 'queued-decision', authority: 'proposal-only', resurface: 'return' };
      if (message.dueDate) { if (typeof message.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(message.dueDate) || !Number.isFinite(Date.parse(message.dueDate))) throw new Error('Choose a valid due date.'); task.dueDate = message.dueDate; }
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
      if (action === 'return' || action === 'end') { await surfaceAttention('on-return'); void queueReasoning('meeting', next.id).catch(error => status(String(error), true)); }
      await changed(); return next;
    }
    case 'settings': {
      const old = await settings();
      const syncMode = message.syncMode;
      if (!['local', 'sync'].includes(String(syncMode))) throw new Error('Invalid sync mode.');
      if (syncMode === 'local') haltSync();
      const next: Settings = { ...old, syncMode: syncMode as Settings['syncMode'], hostedReasoning: typeof message.hostedReasoning === 'boolean' ? message.hostedReasoning : old.hostedReasoning, workspaceLabel: typeof message.workspaceLabel === 'string' ? message.workspaceLabel.trim().slice(0, 200) : old.workspaceLabel };
      if (typeof message.autoAmbiguous === 'boolean') next.autoAmbiguous = message.autoAmbiguous;
      if (typeof message.autoLocalAgent === 'boolean') next.autoLocalAgent = message.autoLocalAgent;
      if (message.autoAmbiguous === false || syncMode === 'local' || message.hostedReasoning === false) next.ambiguousReasoningEpoch = crypto.randomUUID();
      if (message.autoLocalAgent === false || syncMode === 'local') next.localReasoningEpoch = crypto.randomUUID();
      if (syncMode === 'local') { next.autoAmbiguous = false; next.autoLocalAgent = false; }
      if (!next.hostedReasoning) next.autoAmbiguous = false;
      if (next.autoAmbiguous && !((await credentials()).token && next.hostedReasoning && syncMode === 'sync')) throw new Error('Connect Ambiguous and allow hosted analysis before automatic reasoning.');
      if (next.autoLocalAgent && !((await pairing()).connected && syncMode === 'sync')) throw new Error('Connect Codex and allow hosted processing before automatic reasoning.');
      await put('settings', { id: 'preferences', value: next });
      setSyncEnabled(next.syncMode === 'sync');
      await changed(); return next;
    }
    case 'analyze-note':
    case 'meeting-brief': {
      const result = await analyze(message.type === 'analyze-note' ? 'note' : 'meeting', text(message.id, 100));
      await changed(); return result;
    }
    case 'import-event': return importEvent(calendarId(message.eventId));
    case 'import-upcoming': {
      const response = await calendarRead('upcoming-reminders?window_hours=168&limit=50');
      if (!Array.isArray(response.reminders)) throw new Error('Ambiguous returned an invalid upcoming reminder list.');
      const upcoming = new Map<string, number>();
      for (const value of response.reminders) {
        const reminder = object(value), id = calendarId(reminder.event_id);
        const triggerAt = typeof reminder.trigger_at === 'string' ? Date.parse(reminder.trigger_at) : NaN;
        if (reminder.fired_at || reminder.event_status === 'cancelled' || !Number.isFinite(triggerAt) || triggerAt < Date.now()) continue;
        upcoming.set(id, Math.min(upcoming.get(id) ?? Infinity, triggerAt));
      }
      const imported: string[] = [], errors: string[] = [];
      for (const [id, triggerAt] of upcoming) {
        try { imported.push((await importEvent(id, triggerAt)).id); }
        catch (error) { errors.push(`${id}: ${error instanceof Error ? error.message : 'Import failed.'}`); }
      }
      return { count: imported.length, errors };
    }
    case 'credentials': stopHostedAnalysis(); await storeCredentials(typeof message.token === 'string' ? message.token : ''); await changed(); return true;
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
  if (typeof message.type === 'string' && message.type.startsWith('surface-')) {
    void surfaceMessage(message, sender, async (id, action) => {
      await ready;
      if (action === 'join') await serialize(() => handle({ type: 'meeting-action', id, action: 'join' }));
      else await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html#meeting') });
    }).then(value => reply({ok:true,value}), () => reply({ok:false,error:'Page surface unavailable.'}));
    return true;
  }
  const panelOrigin = ['panel.html', 'popup.html'].some(page => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(page));
  const voiceOrigin = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('index.html');
  const voiceOperations = ['capture-zoom','capture-tab','voice-begin','voice-segment','voice-status','voice-input-status','voice-output-status'];
  if (sender.id !== chrome.runtime.id || (voiceOperations.includes(message.type) ? !voiceOrigin : !panelOrigin)) { reply({ ok: false, error: 'This operation requires its extension workspace.' }); return; }
  if (message.type === 'meeting-action' && ['return','end'].includes(message.action)) void stopVoiceOutput().catch(() => undefined);
  if (message.type === 'settings' && message.syncMode === 'local') haltSync();
  if ((message.type === 'settings' && (message.syncMode === 'local' || message.hostedReasoning === false)) || message.type === 'credentials') stopHostedAnalysis();
  if (message.type === 'settings' && message.syncMode === 'local') void revokeJobs().catch(error => status(String(error), true));
  else {
    if (message.type === 'credentials' || message.type === 'settings' && (message.autoAmbiguous === false || message.hostedReasoning === false)) void revokeJobs('ambiguous').catch(error => status(String(error), true));
    if (['connect-local','disconnect-local'].includes(message.type) || message.type === 'settings' && message.autoLocalAgent === false) void revokeJobs('codex').catch(error => status(String(error), true));
  }
  if (['connect-local','disconnect-local'].includes(message.type)) invalidateConnectionAttempt();
  if (message.type === 'cancel-job' && typeof message.id === 'string') void cancelJob(message.id).catch(() => undefined);
  const run = ['state','analyze-note','meeting-brief','connect-local','cancel-job'].includes(message.type) ? handle(message, sender) : serialize(() => handle(message, sender));
  void run.then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error instanceof Error ? error.message : 'Operation failed.' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading' || change.url) void revokeTabSurfaces(tabId).catch(() => undefined); });
chrome.tabs.onActivated.addListener(() => { void ready.then(refreshListeningSurface).catch(() => undefined); });
chrome.tabs.onRemoved.addListener(tabId => {
  void revokeTabSurfaces(tabId).catch(() => undefined);
  void serialize(async () => {
    for (const session of await all('audioSessions')) {
      if (session.tabId !== tabId || ['stopped','error'].includes(session.captureStatus)) continue;
      await interruptAudioSession(session, 'Audio workspace closed before capture finished. Transcript retained.');
    }
    await refreshListeningSurface();
    await changed();
  }).catch(() => undefined);
});
