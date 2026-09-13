import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/engine-memory.js';
// This tiny real WASM module exercises the browser/runtime memory rule. It is
// a memory-boundary test fixture, not evidence of model inference.
const moduleBytes = Uint8Array.from([0,97,115,109,1,0,0,0,5,4,1,1,1,4,7,10,1,6,109,101,109,111,114,121,2,0]);
const cap = globalThis.capSpeechWasmMemory;
test('declared maximum prevents actual WASM growth beyond the cap', async () => {
  const original = await WebAssembly.instantiate(moduleBytes);
  assert.equal(original.instance.exports.memory.grow(2), 1);
  const result = cap(moduleBytes, 2 * 65536);
  const { instance } = await WebAssembly.instantiate(result.bytes);
  assert.equal(instance.exports.memory.grow(1), 1);
  assert.throws(() => instance.exports.memory.grow(1), RangeError);
  assert.equal(instance.exports.memory.buffer.byteLength, result.maximumBytes);
  assert.deepEqual(moduleBytes.slice(8,14), Uint8Array.from([5,4,1,1,1,4]));
});
test('unknown, truncated, shared and incompatible WASM layouts fail closed', () => {
  assert.throws(() => cap(moduleBytes.slice(0,12), 131072), /Truncated/);
  assert.throws(() => cap(moduleBytes.slice(0,8), 131072), /no supported/);
  const shared = moduleBytes.slice(); shared[11] = 3;
  assert.throws(() => cap(shared, 131072), /unshared/);
  assert.throws(() => cap(moduleBytes, 5 * 65536), /incompatible/);
  assert.throws(() => cap(moduleBytes, 65535), /whole number/);
  const wrong = moduleBytes.slice(); wrong[0] = 42;
  assert.throws(() => cap(wrong, 131072), /header/);
});
