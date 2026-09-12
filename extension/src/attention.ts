import { all, get, put, writeBatch } from './db';
import { base, type AttentionSignal, type Meeting, type ReasoningJob } from './types';
import { INTERRUPT_INTERVAL, meetingCanInterrupt, reasoningMode } from './attention-policy';
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn, fn); queue = next.catch(() => undefined); return next; }
export function recordJobAttention(job: ReasoningJob) {
  return serial(async () => {
    if ((await all('attention')).some(a => a.source === 'reasoning' && a.sourceId === job.id)) return;
    const result = job.result;
    const mode = result ? reasoningMode(result) : 'status';
    await put('attention', { ...base(), source: 'reasoning', sourceId: job.id, mode, summary: result?.summary ?? job.error ?? job.state,
      reason: mode === 'negotiate' ? 'A proposal needs review, but no trusted saved deadline establishes a cost of waiting.' : mode === 'digest' ? 'Useful saved analysis needs no immediate action.' : 'Routine job status is available on request.',
      resurface: mode === 'status' ? 'on-request' : 'on-return', evidenceIds: job.evidenceIds, actionRequired: mode === 'negotiate' });
  });
}
export function meetingAttention(meeting: Meeting) {
  return serial(async () => {
    if ((await all('attention')).some(a => a.source === 'meeting' && a.sourceId === meeting.id)) return;
    await put('attention', { ...base(), source: 'meeting', sourceId: meeting.id, mode: 'negotiate', summary: `Join ${meeting.title}`,
      reason: 'Saved meeting reminder is due. Waiting for deadline and interruption-budget checks.', resurface: 'on-return', evidenceIds: [meeting.id], actionRequired: true, trustedDeadline: meeting.startsAt });
    // One short batching window. All pending reminders are reevaluated from saved records.
    if (!await chrome.alarms.get('attention-flush')) await chrome.alarms.create('attention-flush', { when: Date.now() + 2000 });
  });
}
export function flushAttention() {
  return serial(async () => {
    const now = Date.now();
    const signals = (await all('attention')).filter(a => a.source === 'meeting' && !a.deliveredAt && !a.surfacedAt);
    const candidates: { signal: AttentionSignal; meeting: Meeting }[] = [];
    for (const signal of signals) {
      const meeting = await get('meetings', signal.sourceId);
      if (!meeting || meeting.status !== 'scheduled' || meeting.reminderEnabled === false || !meeting.reminderFiredAt || meeting.remindAt > now) {
        await put('attention', { ...signal, mode: 'status', reason: 'Meeting is no longer waiting for a join action.', surfacedAt: now, revision: signal.revision + 1 }); continue;
      }
      candidates.push({ signal, meeting });
    }
    candidates.sort((a, b) => a.meeting.startsAt - b.meeting.startsAt);
    const last = Number((await get('settings', 'lastInterruptAt'))?.value ?? 0);
    const chosen = candidates.find(c => meetingCanInterrupt(c.meeting.startsAt, now, last));
    for (const { signal, meeting } of candidates) {
      if (signal.id === chosen?.signal.id) continue;
      await put('attention', { ...signal, mode: 'negotiate', reason: now - last < INTERRUPT_INTERVAL ? 'Ten-minute interruption budget spent. Available at the next return or request.' : 'No immediate future deadline within ten minutes. Saved for return or request.', resurface: 'on-return', revision: signal.revision + 1 });
      if (meeting.startsAt - now > INTERRUPT_INTERVAL) await chrome.alarms.create(`attention-deadline:${signal.id}`, { when: meeting.startsAt - INTERRUPT_INTERVAL + 100 });
    }
    if (!chosen) return;
    const signal: AttentionSignal = { ...chosen.signal, mode: 'interrupt', reason: 'Join action is needed before a trusted saved meeting start within ten minutes. Waiting risks missing the start.', trustedDeadline: chosen.meeting.startsAt, deliveredAt: now, shelvedCount: candidates.length - 1, revision: chosen.signal.revision + 1 };
    // Reserve the budget durably before notification, including when Chrome rejects delivery.
    await writeBatch([{ store: 'settings', value: { id: 'lastInterruptAt', value: now } }, { store: 'attention', value: signal }]);
    try {
      await chrome.notifications.create(`meeting:${chosen.meeting.id}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icon.png'), title: `Join ${chosen.meeting.title}`,
        message: `Starts ${new Date(chosen.meeting.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Waiting risks missing the start. Click to join.${candidates.length > 1 ? ` ${candidates.length - 1} other reminders saved for review.` : ''}`, priority: 2, requireInteraction: false });
      await chrome.alarms.create(`attention-clear:meeting:${chosen.meeting.id}`, { when: now + 60000 });
    } catch {
      await put('attention', { ...signal, notificationError: 'System notification unavailable. Saved reminder remains available on request.', revision: signal.revision + 1 });
    }
  });
}
export function surfaceAttention(boundary: 'on-request' | 'on-return') {
  return serial(async () => {
    const pending = (await all('attention')).filter(a => !a.surfacedAt && (boundary === 'on-request' || a.resurface === 'on-return'));
    await writeBatch(pending.map(a => ({ store: 'attention', value: { ...a, surfacedAt: Date.now(), revision: a.revision + 1 } })));
    for (const signal of pending) if (signal.source === 'meeting') await chrome.notifications.clear(`meeting:${signal.sourceId}`);
    return pending;
  });
}
export async function recoverAttention() {
  for (const signal of await all('attention')) {
    if (signal.deliveredAt && signal.source === 'meeting') await chrome.notifications.clear(`meeting:${signal.sourceId}`);
  }
  await flushAttention();
}
