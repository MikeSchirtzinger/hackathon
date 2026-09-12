import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The browser-native JavaScript module is intentionally tested directly.
import { SpeechRequestGate } from '../extension/speech-output.js';
test('a cancelled synthesis result cannot regain output authority', () => {
  const gate = new SpeechRequestGate();
  const first = gate.begin();
  assert.equal(gate.accepts(first), true);
  gate.cancel();
  assert.equal(gate.accepts(first), false);
  assert.equal(gate.finish(first), false);
  const second = gate.begin();
  assert.equal(gate.finish(first), false);
  assert.equal(gate.pending, true);
  assert.equal(gate.finish(second), true);
  assert.equal(gate.pending, false);
  assert.equal(gate.finish(second), false);
});
test('missing and mismatched request tickets never authorize playback', () => {
  const gate = new SpeechRequestGate();
  const request = gate.begin();
  for (const invalid of [{}, {requestId: request.requestId}, {speechEpoch: request.speechEpoch}, {...request, requestId:'other'}, {...request, speechEpoch:request.speechEpoch+1}]) assert.equal(gate.accepts(invalid), false);
  assert.equal(gate.accepts(request), true);
});
