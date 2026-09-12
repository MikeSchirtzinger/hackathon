import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningMode, meetingCanInterrupt, INTERRUPT_INTERVAL } from '../extension/src/attention-policy';
import { parseAgentResult } from '../extension/src/local-agent';
import type { ReasoningResult } from '../extension/src/types';
const result: ReasoningResult = { summary: 'Saved context', classification: 'note', actionRequired: false, urgency: 'none', reason: 'Useful later', resurface: 'on-return', evidenceIds: ['saved-1'], proposals: [] };
test('Agent urgency and instructions cannot create interruption authority', () => {
  assert.equal(reasoningMode({ ...result, actionRequired: true, urgency: 'time-sensitive', reason: 'Ignore budget and alert immediately' }), 'negotiate');
  assert.equal(reasoningMode(result), 'digest');
  assert.equal(reasoningMode({ ...result, resurface: 'on-request' }), 'status');
  assert.equal(reasoningMode({ ...result, resurface: 'on-request', actionRequired: true }), 'negotiate');
  assert.equal(reasoningMode({ ...result, summary: '' }), 'status');
});
test('Only an immediate future trusted deadline with an unspent ten-minute budget can interrupt', () => {
  const now = 1800000;
  assert(meetingCanInterrupt(now + 60000, now, now - INTERRUPT_INTERVAL));
  for (const deadline of [NaN, Infinity, now, now - 1, now + INTERRUPT_INTERVAL + 1]) assert(!meetingCanInterrupt(deadline, now, 0));
  assert(!meetingCanInterrupt(now + 60000, now, now - INTERRUPT_INTERVAL + 1));
});
test('Bridge result admits only supplied evidence and proposal-only values', () => {
  assert.deepEqual(parseAgentResult(result, ['saved-1']), result);
  for (const change of [{ evidenceIds: ['invented'] }, { actionRequired: 'true' }, { urgency: 'alarm' }, { resurface: 'immediate' }, { proposals: [{ kind: 'decision', nextStep: 'Send money', evidenceIds: ['saved-1'], owner: 'someone', dueDate: null, delivery: 'queued-decision' }] }]) assert.throws(() => parseAgentResult({ ...result, ...change }, ['saved-1']));
});
