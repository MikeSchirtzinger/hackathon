import { all, get, put, settings } from './db';
import { base, type EvidenceKind, type Provider, type ReasoningJob, type Settings } from './types';
import { savedEvidence } from './evidence';
import { credentials } from './ambiguous';
import { analyze, stopHostedAnalysis } from './hosted';
import { pairing, localRequest, parseAgentResult, validateJobReceipt, type Pairing } from './local-agent';
import { recordJobAttention } from './attention';
const active = new Map<string, AbortController>();
const activeProviders = new Map<string, Provider>();
const revoked = new Set<string>();
let admission: Promise<unknown> = Promise.resolve();
let storage: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
function serial<T>(fn: () => Promise<T>) { const next = storage.then(fn, fn); storage = next.catch(() => undefined); return next; }
function enabled(prefs: Settings, provider: Provider) { return prefs.syncMode === 'sync' && (provider === 'ambiguous' ? prefs.autoAmbiguous && prefs.hostedReasoning : prefs.autoLocalAgent); }
function epoch(prefs: Settings, provider: Provider) { return provider === 'ambiguous' ? prefs.ambiguousReasoningEpoch : prefs.localReasoningEpoch; }
async function connection(provider: Provider) {
  if (provider === 'ambiguous') { const auth = await credentials(); return { epoch: auth.epoch, available: !!auth.token }; }
  const auth = await pairing(); return { epoch: auth.epoch, available: auth.connected && !!auth.secret };
}
async function allowed(job: ReasoningJob, controller?: AbortController) {
  const prefs = await settings();
  const auth = await connection(job.provider);
  if (revoked.has(job.id) || controller?.signal.aborted || !enabled(prefs, job.provider) || epoch(prefs, job.provider) !== job.consentEpoch || auth.epoch !== job.connectionEpoch || !auth.available) throw new Error('Reasoning consent or connection changed. Result rejected.');
}
export function queueReasoning(kind: EvidenceKind, targetId: string): Promise<void> {
  const atAdmission = generation;
  const run = async () => {
    const prefs = await settings();
    const providers = (['ambiguous','codex'] as const).filter(p => enabled(prefs, p));
    if (!providers.length) return;
    const saved = await savedEvidence(kind, targetId);
    for (const provider of providers) {
      const auth = await connection(provider);
      if (atAdmission !== generation) return;
      if (!auth.available) continue;
      const dedupeKey = `${provider}:${kind}:${targetId}:${saved.target.revision}:${epoch(prefs, provider)}:${auth.epoch}`;
      if ((await all('jobs')).some(j => j.dedupeKey === dedupeKey)) continue;
      const job: ReasoningJob = { ...base(), provider, kind, targetId, targetRevision: saved.target.revision, dedupeKey, consentEpoch: epoch(prefs, provider), connectionEpoch: auth.epoch,
        evidence: saved.evidence, evidenceIds: saved.evidenceIds, state: 'queued', polls: 0, deadline: Date.now() + 8 * 60000 };
      if (atAdmission !== generation) return;
      await put('jobs', job);
    }
    await wakeJobs();
  };
  const next = admission.then(run, run); admission = next.catch(() => undefined); return next;
}
function scheduleSoon() {
  if (!timer) timer = setTimeout(() => { timer = undefined; void wakeJobs(); }, 5000);
}
async function notify() { await chrome.runtime.sendMessage({ type: 'changed' }).catch(() => undefined); }
async function saveFinal(job: ReasoningJob, controller: AbortController) {
  await serial(async () => {
    const current = await get('jobs', job.id);
    if (!current || current.state === 'cancelled' || revoked.has(job.id)) return;
    if (job.state === 'complete') await allowed(job, controller);
    await put('jobs', { ...job, revision: current.revision + 1 });
    if (['complete','error','cancelled'].includes(job.state)) await recordJobAttention(job);
  });
  await notify();
}
async function processJob(original: ReasoningJob) {
  if (active.has(original.id)) return;
  const controller = new AbortController(); active.set(original.id, controller); activeProviders.set(original.id, original.provider);
  let job = original;
  try {
    await allowed(job, controller);
    if (Date.now() > job.deadline || job.polls >= 96) throw new Error('Background reasoning timed out. No automatic replay was sent.');
    const firstSend = !job.dispatchedAt;
    job = { ...job, state: 'running', dispatchedAt: job.dispatchedAt ?? Date.now(), polls: job.polls + 1, revision: job.revision + 1 };
    await serial(async () => { await allowed(job, controller); await put('jobs', job); });
    if (job.provider === 'ambiguous') {
      if (!firstSend) throw new Error('Assistant outcome is unknown after restart. Automatic replay is stopped.');
      await allowed(job, controller);
      const result = await analyze(job.kind, job.targetId, { evidence: job.evidence, evidenceIds: job.evidenceIds }, controller.signal);
      job.analysisId = result.id;
      if (result.state !== 'complete' || !result.summary) throw new Error(result.error ?? 'Hosted analysis failed.');
      const proposals = result.proposals ?? [];
      job = { ...job, state: 'complete', result: { summary: result.summary, proposals, evidenceIds: result.evidenceIds,
        classification: proposals.some(p => p.kind === 'decision') ? 'decision' : 'note', actionRequired: proposals.some(p => p.delivery === 'queued-decision'), urgency: 'when-available', reason: 'Saved analysis is a proposal for review, not execution authority.', resurface: 'on-return' }, finishedAt: Date.now() };
    } else {
      const auth = await pairing();
      await allowed(job, controller);
      const receipt = validateJobReceipt(await localRequest(firstSend ? 'jobs' : `jobs/${job.id}`, auth, firstSend ? 'POST' : 'GET', firstSend ? { id: job.id, provider: 'codex', kind: job.kind, createdAt: job.createdAt, evidenceIds: job.evidenceIds, evidence: job.evidence } : undefined, controller.signal), job);
      await allowed(job, controller);
      if (receipt.state === 'complete') job = { ...job, state: 'complete', result: parseAgentResult(receipt.result, job.evidenceIds), finishedAt: Date.now() };
      else if (receipt.state === 'error' || receipt.state === 'cancelled') throw new Error(typeof receipt.error === 'string' ? receipt.error.slice(0, 2000) : `Local agent job ${receipt.state}.`);
    }
    await saveFinal(job, controller);
  } catch (error) {
    job = { ...job, state: revoked.has(job.id) || controller.signal.aborted ? 'cancelled' : 'error', error: error instanceof Error ? error.message : 'Background reasoning failed.', finishedAt: Date.now() };
    await saveFinal(job, controller).catch(() => undefined);
  } finally { active.delete(job.id); activeProviders.delete(job.id); scheduleSoon(); }
}
export async function wakeJobs() {
  const jobs = (await all('jobs')).filter(j => ['queued','running'].includes(j.state));
  if (!jobs.length) { await chrome.alarms.clear('reasoning-jobs'); return; }
  await chrome.alarms.create('reasoning-jobs', { periodInMinutes: 0.5 });
  for (const provider of ['ambiguous','codex'] as const) {
    const candidates = jobs.filter(j => j.provider === provider).sort((a,b) => a.createdAt - b.createdAt);
    if (candidates.some(j => active.has(j.id))) continue;
    if (candidates[0]) void processJob(candidates[0]);
  }
}
// Called synchronously at the message boundary, before preference writes can wait on any queue.
export function revokeJobs(provider?: Provider) {
  generation += 1;
  // Snapshot the old pairing before a disconnect or replacement can clear trusted storage.
  const previousPairing = pairing();
  if (!provider || provider === 'ambiguous') stopHostedAnalysis();
  const ids = [...active.keys()].filter(id => !provider || activeProviders.get(id) === provider);
  for (const id of ids) { revoked.add(id); active.get(id)?.abort(); }
  return serial(async () => {
    const cancellationAuth = await previousPairing;
    for (const job of await all('jobs')) {
      if ((!provider || job.provider === provider || ids.includes(job.id)) && (['queued','running'].includes(job.state) || ids.includes(job.id))) {
        revoked.add(job.id);
        const next: ReasoningJob = { ...job, state: 'cancelled', result: undefined, error: 'Consent or connection revoked. Late results are not accepted.', finishedAt: Date.now(), cancelDelivery: job.provider === 'codex' && job.dispatchedAt ? 'pending' : undefined, revision: job.revision + 1 };
        await put('jobs', next); await recordJobAttention(next);
        if (next.cancelDelivery === 'pending') void deliverCancellation(next, cancellationAuth);
      }
    }
    await notify();
  });
}
export async function cancelJob(id: string) {
  revoked.add(id); active.get(id)?.abort();
  const job = await get('jobs', id);
  if (!job || !['queued','running'].includes(job.state)) return;
  if (job.provider === 'ambiguous') stopHostedAnalysis();
  await serial(async () => {
    const latest = await get('jobs', id);
    if (!latest) return;
    const next: ReasoningJob = { ...latest, state: 'cancelled', result: undefined, error: 'Cancelled on request. Late results are not accepted.', finishedAt: Date.now(), cancelDelivery: job.provider === 'codex' && job.dispatchedAt ? 'pending' : undefined, revision: latest.revision + 1 };
    await put('jobs', next); await recordJobAttention(next);
  });
  if (job.provider === 'codex' && job.dispatchedAt) void deliverCancellation(job);
  await notify();
}
async function deliverCancellation(job: ReasoningJob, previousPairing?: Pairing) {
  let error: string | undefined;
  try {
    const auth = previousPairing ?? await pairing();
    if (auth.epoch !== job.connectionEpoch) throw new Error('Pairing changed before cancellation was confirmed. Check the local bridge.');
    const receipt = await localRequest(`jobs/${job.id}/cancel`, auth, 'POST');
    if (receipt.id !== job.id || receipt.state !== 'cancelled') throw new Error('Bridge did not confirm cancellation.');
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Bridge cancellation failed.'; }
  await serial(async () => {
    const current = await get('jobs', job.id);
    if (current) await put('jobs', { ...current, cancelDelivery: error ? 'error' : 'confirmed', cancelError: error, revision: current.revision + 1 });
  });
  await notify();
}
export async function recoverJobs() {
  for (const job of await all('jobs')) if (job.cancelDelivery === 'pending') void deliverCancellation(job);
  for (const job of await all('jobs')) if (job.provider === 'ambiguous' && job.state === 'running') {
    const next: ReasoningJob = { ...job, state: 'error', error: 'Assistant outcome is unknown after worker restart. No automatic replay was sent.', finishedAt: Date.now(), revision: job.revision + 1 };
    await put('jobs', next); await recordJobAttention(next);
  }
  await wakeJobs();
}
