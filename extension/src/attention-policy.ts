import type { AttentionSignal, ReasoningResult } from './types';
export const INTERRUPT_INTERVAL = 10 * 60 * 1000;
// Provider text is evidence for review, never authority for a system notification.
export function reasoningMode(result: ReasoningResult): AttentionSignal['mode'] {
  if (result.actionRequired || result.proposals.some(p => p.delivery === 'queued-decision')) return 'negotiate';
  if (result.classification === 'note' && !result.actionRequired && result.urgency === 'none' && result.resurface === 'on-request' && !result.proposals.length) return 'status';
  return result.summary.trim() ? 'digest' : 'status';
}
export function meetingCanInterrupt(deadline: number, now: number, lastInterrupt: number): boolean {
  return Number.isFinite(deadline) && deadline > now && deadline - now <= INTERRUPT_INTERVAL && now - lastInterrupt >= INTERRUPT_INTERVAL;
}
