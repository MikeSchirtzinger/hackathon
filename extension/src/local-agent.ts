import { object } from './calendar';
import type { ReasoningJob, ReasoningResult } from './types';
import { parseAnalysisResponse } from './analysis-result';
export const BRIDGE_ORIGIN = 'http://127.0.0.1:4318';
export const BRIDGE_PERMISSION = `${BRIDGE_ORIGIN}/*`;
let connectionGeneration = 0;
let storageQueue: Promise<unknown> = Promise.resolve();
function store<T>(fn: () => Promise<T>) { const next = storageQueue.then(fn, fn); storageQueue = next.catch(() => undefined); return next; }
export function invalidateConnectionAttempt() { connectionGeneration += 1; }
export interface Pairing { secret: string; epoch: string; connected: boolean }
export async function pairing(): Promise<Pairing> {
  const stored = await chrome.storage.local.get('localAgentPairing');
  return stored.localAgentPairing as Pairing ?? { secret: '', epoch: '', connected: false };
}
export async function localRequest(path: string, auth: Pairing, method = 'GET', body?: unknown, signal?: AbortSignal) {
  if (!await chrome.permissions.contains({ origins: [BRIDGE_PERMISSION] })) throw new Error('Connect the local agent to grant its optional host permission.');
  if (!auth.secret) throw new Error('Local agent pairing is not configured.');
  const response = await fetch(`${BRIDGE_ORIGIN}/v1/${path}`, { method, credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${auth.secret}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Local agent returned HTTP ${response.status}.`);
  return object(await response.json());
}
export async function connectLocalAgent(secret: unknown) {
  const generation = connectionGeneration;
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 512 || /\s/.test(secret)) throw new Error('Enter the private pairing secret from your local bridge.');
  const auth = { secret, epoch: crypto.randomUUID(), connected: true };
  const capabilities = await localRequest('capabilities', auth);
  if (capabilities.protocol !== 1 || !Array.isArray(capabilities.providers)) throw new Error('Local agent protocol is unsupported.');
  const provider = capabilities.providers.map(object).find(p => p.id === 'codex');
  if (!provider || provider.processing !== 'hosted' || provider.available !== true) throw new Error('Codex is unavailable or did not declare hosted processing.');
  await store(async () => {
    if (generation !== connectionGeneration) throw new Error('Connection attempt was superseded or disconnected.');
    await chrome.storage.local.set({ localAgentPairing: auth });
  });
  return { connected: true, provider: 'codex', processing: 'hosted' };
}
export async function disconnectLocalAgent() {
  await store(() => chrome.storage.local.set({ localAgentPairing: { secret: '', epoch: crypto.randomUUID(), connected: false } }));
}
export function parseAgentResult(raw: unknown, evidenceIds: string[]): ReasoningResult {
  const value = object(raw);
  const parsed = parseAnalysisResponse(JSON.stringify(value), evidenceIds);
  if (!['note','research','follow-up','reminder','decision'].includes(String(value.classification)) || typeof value.actionRequired !== 'boolean' || !['none','when-available','time-sensitive'].includes(String(value.urgency)) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 6000 || !['on-request','on-return'].includes(String(value.resurface)) || !Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.some(id => typeof id !== 'string' || !evidenceIds.includes(id))) throw new Error('Local agent result contains invalid attention or evidence fields.');
  return { ...parsed, summary: parsed.summary!, proposals: parsed.proposals!, classification: value.classification as ReasoningResult['classification'], actionRequired: value.actionRequired, urgency: value.urgency as ReasoningResult['urgency'], reason: value.reason, resurface: value.resurface as ReasoningResult['resurface'], evidenceIds: value.evidenceIds as string[] };
}
export function validateJobReceipt(raw: Record<string, unknown>, job: ReasoningJob) {
  if (raw.id !== job.id || !['queued','running','complete','error','cancelled'].includes(String(raw.state))) throw new Error('Local agent returned an invalid job receipt.');
  return raw;
}
