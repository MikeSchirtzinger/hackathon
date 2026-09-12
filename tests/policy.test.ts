import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSend, deliveryFor, safeWebUrl } from '../extension/src/policy';
import { validateSegment } from '../extension/src/transcript';
import type { OutboxItem } from '../extension/src/types';
const reviewed: OutboxItem = { id: 'outbox-fixture', createdAt: 1, revision: 1, recordId: 'record-fixture', batchId: 'batch-fixture', approvedAt: 1, credentialEpoch: 'identity-1', workspaceLabel: 'test fixture', kind: 'task', payload: { title: 'Test fixture' }, state: 'pending' };
test('local policy denies every outbox state, regardless of review or identity', () => {
  for (const state of ['pending','sending','unknown','failed','confirmed'] as const) assert.equal(canSend('local', { ...reviewed, state }, 'identity-1'), false);
  assert.equal(canSend('sync', reviewed, 'identity-1'), true);
  for (const state of ['sending','unknown','failed','confirmed'] as const) assert.equal(canSend('sync', { ...reviewed, state }, 'identity-1'), false);
  assert.equal(canSend('sync', { ...reviewed, approvedAt: 0 }, 'identity-1'), false);
  assert.equal(canSend('sync', reviewed, 'new-identity'), false);
});
test('routine completion cannot earn interruption or execution', () => {
  assert.equal(deliveryFor('save'), 'quiet-status'); assert.equal(deliveryFor('completed'), 'quiet-status');
  assert.equal(deliveryFor('approval'), 'queued-decision'); assert.equal(deliveryFor('information'), 'digest-on-return');
  assert.equal(deliveryFor('meeting-due'), 'timed-interruption');
});
test('resume and meeting links reject executable schemes and embedded credentials', () => {
  assert.equal(safeWebUrl('https://example.com/meeting'), 'https://example.com/meeting');
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'https://secret@example.com/']) assert.throws(() => safeWebUrl(url));
});
test('transcript boundary retains source/final identity and rejects broken intervals', () => {
  const segment = { protocol: 1, sessionId: 'session', segmentId: 'segment', sequence: 0, revision: 1, startMs: 0, endMs: 100, text: 'Fixture only', final: false, source: 'human', createdAt: 1 };
  assert.equal(validateSegment(segment).id, 'session:segment');
  for (const patch of [{protocol:2}, {endMs:-1}, {startMs:NaN}, {source:'system'}, {final:'yes'}, {sequence:0.5}, {revision:0}]) assert.throws(() => validateSegment({...segment, ...patch}));
});
