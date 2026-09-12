import type { Delivery, OutboxItem } from './types';
export function deliveryFor(event: 'save' | 'completed' | 'information' | 'approval' | 'meeting-due'): Delivery {
  if (event === 'meeting-due') return 'timed-interruption';
  if (event === 'approval') return 'queued-decision';
  if (event === 'information') return 'digest-on-return';
  return 'quiet-status';
}
export function canSend(syncMode: string, item: OutboxItem, epoch: string): boolean {
  return syncMode === 'sync' && item.state === 'pending' && item.approvedAt > 0 && item.credentialEpoch === epoch;
}
export function safeWebUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}
