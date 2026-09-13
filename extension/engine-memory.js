// The runtime owns its WASM memory and ignores Module.wasmMemory. Tighten its
// declared maximum before instantiation. The browser then bounds memory.grow,
// including growth requested inside WASM. Vendor bytes on disk stay unchanged.
(() => {
  const PAGE_BYTES = 65536;
  function capSpeechWasmMemory(input, limitBytes) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!Number.isSafeInteger(limitBytes) || limitBytes < PAGE_BYTES || limitBytes % PAGE_BYTES) throw new Error('Speech memory limit must be a positive whole number of WASM pages.');
    if ([0, 97, 115, 109, 1, 0, 0, 0].some((value, index) => bytes[index] !== value)) throw new Error('Unsupported speech WASM header.');
    let offset = 8;
    function readUnsigned(end = bytes.length) {
      let value = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        if (offset >= end) throw new Error('Truncated speech WASM metadata.');
        const byte = bytes[offset++];
        value += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) {
          if (value > 0xffffffff) throw new Error('Invalid speech WASM integer.');
          return value;
        }
      }
      throw new Error('Invalid speech WASM integer.');
    }
    function encodeUnsigned(value) {
      const output = [];
      do { const byte = value % 128; value = Math.floor(value / 128); output.push(byte | (value ? 128 : 0)); } while (value);
      return output;
    }
    let replacement;
    while (offset < bytes.length) {
      const start = offset;
      const id = bytes[offset++];
      const length = readUnsigned();
      const end = offset + length;
      if (end > bytes.length) throw new Error('Truncated speech WASM section.');
      if (id === 5) {
        if (replacement || readUnsigned(end) !== 1 || readUnsigned(end) !== 1) throw new Error('Speech runtime requires one unshared WASM32 memory with a maximum.');
        const initialPages = readUnsigned(end), originalMaximumPages = readUnsigned(end), maximumPages = limitBytes / PAGE_BYTES;
        if (offset !== end || maximumPages < initialPages || maximumPages > originalMaximumPages) throw new Error('Speech memory limit is incompatible with the bundled runtime.');
        const payload = [1, 1, ...encodeUnsigned(initialPages), ...encodeUnsigned(maximumPages)];
        replacement = { start, end, section: [5, ...encodeUnsigned(payload.length), ...payload], initialPages, maximumPages };
      }
      offset = end;
    }
    if (!replacement) throw new Error('Speech runtime has no supported internal WASM memory.');
    const { start, end, section, initialPages, maximumPages } = replacement;
    const result = new Uint8Array(bytes.length - (end - start) + section.length);
    result.set(bytes.subarray(0, start)); result.set(section, start); result.set(bytes.subarray(end), start + section.length);
    return { bytes: result, initialBytes: initialPages * PAGE_BYTES, maximumBytes: maximumPages * PAGE_BYTES };
  }
  globalThis.capSpeechWasmMemory = capSpeechWasmMemory;
})();
