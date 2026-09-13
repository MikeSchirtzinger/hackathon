import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks } from '../extension/speech-text.js';
test('long spoken responses retain every word across bounded synthesis requests', () => {
  const text = 'Keep the accessibility checklist available. No owner or deadline has been agreed. '.repeat(25);
  const chunks = speechChunks(text);
  assert(chunks.length > 1);
  assert(chunks.every(chunk => chunk.length > 0 && chunk.length <= 240));
  assert.equal(chunks.join(' '), text.replace(/\s+/g, ' ').trim());
});
test('empty speech stays empty and a long token cannot bypass the synthesis limit', () => {
  assert.deepEqual(speechChunks('  \n  '), []);
  const chunks = speechChunks('x'.repeat(1000));
  assert.equal(chunks.join(''), 'x'.repeat(1000));
  assert(chunks.every(chunk => chunk.length <= 240));
  for (const limit of [0,-1,NaN,31,501]) assert.throws(() => speechChunks('speech',limit));
});
