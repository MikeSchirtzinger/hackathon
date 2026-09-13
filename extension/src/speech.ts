import { all, get, put } from './db';

export interface SpeechPreferences {
  transcriptionMode: 'hotkey' | 'continuous';
  paused: boolean;
  voiceResponses: boolean;
  speaker: number;
}
export const speechDefaults: SpeechPreferences = { transcriptionMode: 'hotkey', paused: true, voiceResponses: false, speaker: 0 };
export async function speechPreferences(): Promise<SpeechPreferences> {
  return { ...speechDefaults, ...((await get('settings', 'speechPreferences'))?.value as Partial<SpeechPreferences> | undefined) };
}
export async function saveSpeechPreferences(input: Record<string, unknown>) {
  const next = await speechPreferences();
  if (input.transcriptionMode !== undefined) {
    if (input.transcriptionMode !== 'hotkey' && input.transcriptionMode !== 'continuous') throw Error('Choose hotkey or continuous transcription.');
    next.transcriptionMode = input.transcriptionMode;
  }
  for (const key of ['paused', 'voiceResponses'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw Error('Invalid speech preference.');
      next[key] = input[key];
    }
  }
  if (input.speaker !== undefined) {
    if (!Number.isInteger(input.speaker) || Number(input.speaker) < 0 || Number(input.speaker) > 100) throw Error('Invalid local voice.');
    next.speaker = Number(input.speaker);
  }
  await put('settings', { id: 'speechPreferences', value: next });
  return next;
}
let operations: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> { const next = operations.then(operation, operation); operations = next.catch(() => undefined); return next; }
export type SpeechCommand = { id: string; action: 'start' | 'stop' | 'speak' | 'stop-output'; text?: string };
export function enqueueSpeech(action: SpeechCommand['action'], text?: string) { return serial(async () => {
  const stored = await chrome.storage.session.get('speechCommands');
  let commands = (stored.speechCommands || []) as SpeechCommand[];
  // Latest capture/output intent supersedes pending intent before an owner loads.
  commands = commands.filter(command => ['start','stop'].includes(action) ? !['start','stop'].includes(command.action) : !['speak','stop-output'].includes(command.action));
  const command: SpeechCommand = { id: crypto.randomUUID(), action, ...(text ? { text } : {}) };
  await chrome.storage.session.set({ speechCommands: [...commands, command], ...(['speak','stop-output'].includes(action) ? { speechOutputRequestId: action === 'speak' ? command.id : null } : { speechCaptureRequestId: action === 'start' ? command.id : null }) });
  void chrome.runtime.sendMessage({ type: 'voice-control', action: 'poll' }).catch(() => undefined);
  return { queued: true, id: command.id };
}); }
export function takeSpeechCommands() { return serial(async () => {
  const stored = await chrome.storage.session.get('speechCommands');
  await chrome.storage.session.remove('speechCommands');
  return { preferences: await speechPreferences(), commands: (stored.speechCommands || []) as SpeechCommand[] };
}); }
export async function savedSpeech(kind: unknown, id: unknown) {
  if (!(await speechPreferences()).voiceResponses) throw Error('Enable browser voice responses in speech settings first.');
  if (typeof id !== 'string') throw Error('Choose a saved Spark response.');
  let summary: string | undefined;
  if (kind === 'analysis') { const item = await get('analyses', id); if (item?.state === 'complete') summary = item.summary; }
  if (kind === 'job') { const item = await get('jobs', id); if (item?.state === 'complete') summary = item.result?.summary; }
  if (kind === 'attention') { const item = (await all('attention')).find(a => a.id === id && a.source === 'reasoning' && a.mode !== 'status'); summary = item?.summary; }
  if (!summary?.trim()) throw Error('This record has no completed response to read.');
  return summary.trim();
}

export function speechCommandAllowed(id: unknown, kind: unknown) { return serial(async () => {
  if (typeof id !== 'string' || !['speak','start'].includes(String(kind))) return false;
  const key = kind === 'speak' ? 'speechOutputRequestId' : 'speechCaptureRequestId';
  const stored = await chrome.storage.session.get(key);
  const prefs = await speechPreferences();
  return stored[key] === id && (kind === 'speak' ? prefs.voiceResponses : !prefs.paused);
}); }
