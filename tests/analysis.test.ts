import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysisResponse } from '../extension/src/analysis-result';
const proposal = { kind: 'reminder', nextStep: 'Review the saved context.', evidenceIds: ['note-fixture'], owner: null, dueDate: null, delivery: 'quiet-status' };
test('hosted proposal parser retains supplied evidence and proposal-only values', () => {
  const result = parseAnalysisResponse(JSON.stringify({ summary: 'Saved note fixture', proposals: [proposal] }), ['note-fixture']);
  assert.deepEqual(result.proposals?.[0], proposal);
});
test('hosted proposal parser rejects fabricated evidence, owners, dates and interruption authority', () => {
  for (const patch of [{ evidenceIds: ['not-supplied'] }, { evidenceIds: [] }, { owner: 'Invented' }, { dueDate: '2026-09-18' }, { delivery: 'timed-interruption' }]) assert.throws(() => parseAnalysisResponse(JSON.stringify({ summary: 'Fixture', proposals: [{ ...proposal, ...patch }] }), ['note-fixture']));
  assert.throws(() => parseAnalysisResponse('not JSON', ['note-fixture']));
});
