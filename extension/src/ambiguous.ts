import { all, get, put, settings, writeBatch } from './db';
import { canSend } from './policy';
import { base, type OutboxItem } from './types';
const API = 'https://app.ambiguous.ai/api';
let inFlight: AbortController | undefined;
let pumping: Promise<void> | undefined;
let outboundAllowed = false;
export function haltSync() { outboundAllowed = false; inFlight?.abort(); }
export function setSyncEnabled(enabled: boolean) { outboundAllowed = enabled; if (!enabled) inFlight?.abort(); }
export async function credentials(): Promise<{ token: string; epoch: string }> {
  const result = await chrome.storage.local.get(['apiToken', 'credentialEpoch']);
  return { token: typeof result.apiToken === 'string' ? result.apiToken : '', epoch: typeof result.credentialEpoch === 'string' ? result.credentialEpoch : '' };
}
export async function storeCredentials(token: string) {
  inFlight?.abort();
  await chrome.storage.local.set({ apiToken: token.trim(), credentialEpoch: crypto.randomUUID() });
}
export async function approveBatch(noteIds: string[], taskIds: string[]) {
  const prefs = await settings();
  const auth = await credentials();
  if (prefs.syncMode !== 'sync' || !auth.token || !prefs.workspaceLabel.trim()) throw new Error('Enable sync and configure the receiving identity before reviewing a batch.');
  const batchId = crypto.randomUUID();
  const existing = await all('outbox');
  const items: OutboxItem[] = [];
  for (const [kind, ids] of [['document', noteIds], ['task', taskIds]] as const) {
    for (const id of new Set(ids)) {
      if (existing.some(item => item.recordId === id) || items.some(item => item.recordId === id)) continue;
      const record = kind === 'document' ? await get('notes', id) : await get('tasks', id);
      if (!record) throw new Error('A reviewed record no longer exists.');
      const context = await get('contexts', record.contextId);
      if (!context) throw new Error('The saved context is missing.');
      const resume = chrome.runtime.getURL(`panel.html#context=${encodeURIComponent(context.id)}`);
      const text = 'text' in record ? record.text : record.nextStep;
      const title = 'title' in record ? record.title : record.text.slice(0, 100);
      const body = `${text}\n\nSource: ${context.title}\n${context.url}\nCaptured: ${new Date(context.capturedAt).toISOString()}\nSelection: ${context.selection}\n\nResume on the originating browser: ${resume}\nLocal record: ${record.id}`;
      items.push({ ...base(), recordId: id, kind, batchId, approvedAt: Date.now(), credentialEpoch: auth.epoch, workspaceLabel: prefs.workspaceLabel, payload: kind === 'document' ? { type: 'doc', title, content: body, visibility: 'private' } : { title, description: body }, state: 'pending' });
    }
  }
  if (!items.length) throw new Error('Select records that have not already entered the outbox.');
  await writeBatch(items.map(value => ({ store: 'outbox', value })));
  return { batchId, count: items.length };
}
async function request(item: OutboxItem, method: 'POST' | 'GET', token: string): Promise<Record<string, unknown>> {
  if (!outboundAllowed) throw new Error('Local mode stopped this request.');
  const path = item.kind === 'task' ? 'tasks' : 'documents';
  const url = `${API}/${path}${method === 'GET' ? `/${encodeURIComponent(item.remoteId!)}` : ''}`;
  const controller = new AbortController();
  inFlight = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { method, credentials: 'omit', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'API-Version': '1' }, ...(method === 'POST' ? { body: JSON.stringify(item.payload) } : {}) });
    if (!response.ok) {
      // A server rejection may still be uncertain. Never resend automatically.
      throw new Error(`Ambiguous returned HTTP ${response.status}. Reconcile before creating again.`);
    }
    const body: unknown = await response.json();
    const record = item.kind === 'task' ? (body as { task?: unknown })?.task : body;
    if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') throw new Error('Ambiguous response did not contain a record ID.');
    return record as Record<string, unknown>;
  } finally { clearTimeout(timeout); if (inFlight === controller) inFlight = undefined; }
}
export async function reconcile(item: OutboxItem) {
  const prefs = await settings();
  const auth = await credentials();
  if (prefs.syncMode !== 'sync' || item.credentialEpoch !== auth.epoch || !auth.token) throw new Error('Sync is paused or the receiving identity has changed.');
  if (!item.remoteId) throw new Error('No remote ID was received. Inspect the receiving workspace before any new creation.');
  const remote = await request(item, 'GET', auth.token);
  if (remote.id !== item.remoteId || remote.title !== item.payload.title) throw new Error('Remote readback does not match the reviewed record.');
  const body = item.kind === 'task' ? remote.description : remote.content;
  if (typeof body !== 'string' || !body.includes(item.recordId)) throw new Error('Remote readback is missing the source record marker.');
  await put('outbox', { ...item, state: 'confirmed', lastError: undefined, confirmedAt: Date.now(), revision: item.revision + 1 });
}
export function pumpOutbox(): Promise<void> {
  pumping ??= runPump().finally(() => { pumping = undefined; });
  return pumping;
}
async function runPump() {
  for (const item of await all('outbox')) {
    const prefs = await settings();
    const auth = await credentials();
    if (!canSend(prefs.syncMode, item, auth.epoch) || !auth.token) continue;
    let current = { ...item, state: 'sending' as OutboxItem['state'], revision: item.revision + 1 };
    await put('outbox', current);
    try {
      // Recheck after committing the send intent. Local mode may have changed meanwhile.
      if ((await settings()).syncMode !== 'sync' || (await credentials()).epoch !== auth.epoch) {
        await put('outbox', { ...current, state: 'pending' }); continue;
      }
      const remote = await request(current, 'POST', auth.token);
      current = { ...current, remoteId: remote.id as string, state: 'unknown' };
      await put('outbox', current);
      await reconcile(current);
    } catch (error) {
      await put('outbox', { ...current, state: 'unknown', lastError: error instanceof Error ? error.message : 'Sync outcome unknown. Reconcile before creating again.' });
    }
  }
}
export async function recoverOutbox() {
  for (const item of await all('outbox')) if (item.state === 'sending') await put('outbox', { ...item, state: 'unknown', lastError: 'The worker stopped during a send. Reconcile before creating again.' });
}
