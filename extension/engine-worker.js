/* Each engine has a separate worker: upstream wrappers share global names. */
importScripts('vendor/sherpa-onnx-wasm-web.js', 'engine-memory.js');
const MIB = 1024 * 1024;
const budgets = { nemotron: { wasm: 1536 * MIB, files: 700 * MIB }, kokoro: { wasm: 768 * MIB, files: 200 * MIB } };
let runtime, engine, stream, kind, initialization, wasmMemory, memoryLimitEnforced = false;
let peakWasmBytes = 0, modelFileBytes = 0, streamSeconds = 0, commandActive = false, fatal = false;
const send = (type, data = {}) => postMessage({ type, ...data });
function diagnostics() {
  const wasmBytes = wasmMemory?.buffer.byteLength || 0;
  peakWasmBytes = Math.max(peakWasmBytes, wasmBytes);
  return { kind, wasmBytes, peakWasmBytes, wasmLimitBytes: budgets[kind]?.wasm || 0, modelFileBytes,
    streamSeconds, maxStreamSeconds: 30, maxAudioChunkSamples: 16000, threads: 1,
    memoryLimitEnforced, scope: 'WASM linear memory; browser process and asset buffers are additional' };
}
function reply(type, request, values = {}, transfer) {
  const message = { type, requestId: request.requestId, asrEpoch: request.asrEpoch, speechEpoch: request.speechEpoch, ...values, diagnostics: diagnostics() };
  if (transfer) postMessage(message, transfer); else postMessage(message);
}
function releaseStream() { stream?.free(); stream = null; streamSeconds = 0; }
async function loadFiles(name) {
  const response = await fetch(`models/${name}/files.json`);
  if (!response.ok) throw new Error('Local model assets are missing. Open speech setup to download them.');
  const files = await response.json();
  if (!Array.isArray(files) || !files.length || files.length > 1000 || new Set(files).size !== files.length ||
      files.some(file => typeof file !== 'string' || !file.length || /[\\\0?#]/.test(file) || file.startsWith('/') || file.split('/').includes('..'))) {
    throw new Error('Local model file list is invalid. Run speech setup again.');
  }
  for (const [index, file] of files.entries()) {
    send('status', { message: `Loading ${name}: ${file} (${index + 1}/${files.length})`, completed: index, total: files.length });
    const response = await fetch(`models/${name}/${file.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) throw new Error(`Missing local model asset: ${file}`);
    const length = Number(response.headers.get('content-length'));
    if (length > budgets[name].files - modelFileBytes) throw new Error('Local model assets exceed their memory budget.');
    const bytes = new Uint8Array(await response.arrayBuffer()); modelFileBytes += bytes.byteLength;
    if (modelFileBytes > budgets[name].files) throw new Error('Local model assets exceed their memory budget.');
    const path = `/${name}/${file}`;
    runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf('/'))); runtime.FS.writeFile(path, bytes, { canOwn: true });
  }
  return files;
}
async function init(name) {
  if (!budgets[name]) throw new Error('Unknown local speech engine.');
  if (kind && kind !== name) throw new Error('A speech worker cannot change model kind.');
  if (initialization) return initialization;
  kind = name;
  initialization = (async () => {
    importScripts(name === 'nemotron' ? 'vendor/sherpa-onnx-asr.js' : 'vendor/sherpa-onnx-tts.js');
    send('status', { message: 'Starting bounded WebAssembly runtime...' });
    const response = await fetch('vendor/sherpa-onnx-wasm-web.wasm');
    if (!response.ok) throw new Error('Local speech runtime is missing. Open speech setup to download it.');
    const capped = capSpeechWasmMemory(await response.arrayBuffer(), budgets[name].wasm);
    const module = await WebAssembly.compile(capped.bytes);
    if (WebAssembly.Module.imports(module).some(item => item.kind === 'memory')) throw new Error('Imported speech WASM memory is unsupported.');
    runtime = await SherpaOnnx({
      locateFile: path => new URL(`vendor/${path}`, self.location.href).href,
      instantiateWasm: (imports, receiveInstance) => {
        const instance = new WebAssembly.Instance(module, imports);
        const memories = Object.values(instance.exports).filter(value => value instanceof WebAssembly.Memory);
        if (memories.length !== 1) throw new Error('Speech runtime must export one bounded WASM memory.');
        wasmMemory = memories[0];
        const previousBytes = wasmMemory.buffer.byteLength;
        try { wasmMemory.grow((budgets[name].wasm - previousBytes) / 65536 + 1); }
        catch (error) { if (!(error instanceof RangeError)) throw error; memoryLimitEnforced = true; }
        if (!memoryLimitEnforced || wasmMemory.buffer.byteLength !== previousBytes) throw new Error('Speech WASM memory maximum was not enforced.');
        receiveInstance(instance, module); return instance.exports;
      },
      print: message => send('log', { message }), printErr: message => send('log', { message })
    });
    const files = await loadFiles(name);
    send('status', { message: `Initializing ${name} model...` });
    if (name === 'nemotron') {
      engine = new OnlineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: '/nemotron/encoder.int8.onnx', decoder: '/nemotron/decoder.int8.onnx', joiner: '/nemotron/joiner.int8.onnx' },
          tokens: '/nemotron/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0
        }, decodingMethod: 'greedy_search', enableEndpoint: 0
      }, runtime);
    } else {
      engine = new OfflineTts({ model: {
        kokoro: { model: '/kokoro/model.int8.onnx', voices: '/kokoro/voices.bin', tokens: '/kokoro/tokens.txt', dataDir: '/kokoro/espeak-ng-data', lengthScale: 1 },
        numThreads: 1, provider: 'cpu', debug: 0
      }, maxNumSentences: 1 }, runtime);
    }
    if (!engine.handle) throw new Error(`Unable to initialize ${name} within its WASM memory budget. See the diagnostic log.`);
    for (const file of files.filter(file => file.endsWith('.onnx'))) {
      const path = `/${name}/${file}`; modelFileBytes -= runtime.FS.stat(path).size; runtime.FS.unlink(path);
    }
  })();
  return initialization;
}
function decode() { while (engine.isReady(stream)) engine.decode(stream); return engine.getResult(stream).text || ''; }
async function handle(data) {
  if (data.type === 'init') { await init(data.kind); return reply('ready', data, { speakers: engine.numSpeakers }); }
  if (!engine?.handle) throw new Error('Local speech model is not ready.');
  if (data.type === 'diagnostics') return reply('diagnostics', data);
  if (data.type === 'stop') { releaseStream(); return reply('stopped', data); }
  if (data.type === 'start') {
    if (kind !== 'nemotron') throw new Error('Transcription requires Nemotron.');
    releaseStream(); stream = engine.createStream();
    if (!stream.handle) throw new Error('Could not create a local audio stream.');
    return reply('started', data);
  }
  if (data.type === 'audio') {
    if (!stream) throw new Error('Audio stream has not started.');
    if (!(data.samples instanceof Float32Array) || !data.samples.length || data.samples.length > 16000 || data.sampleRate !== 16000) throw new Error('Send 1 to 16000 PCM samples at 16000 Hz and await each transcript acknowledgement.');
    if (streamSeconds + data.samples.length / data.sampleRate > 30.001) throw new Error('Finish this transcription segment before sending more than 30 seconds of audio.');
    const start = performance.now(); stream.acceptWaveform(data.sampleRate, data.samples); streamSeconds += data.samples.length / data.sampleRate;
    const text = decode(); return reply('transcript', data, { text, elapsed: performance.now() - start });
  }
  if (data.type === 'finish') {
    if (!stream) throw new Error('Audio stream has not started.');
    try {
      // The 1120 ms encoder needs a 121-frame window. InputFinished alone
      // does not pad a partial chunk. This covers its window plus frame rounding.
      stream.acceptWaveform(16000, new Float32Array(22400)); stream.inputFinished();
      const text = decode(); return reply('final', data, { text });
    } finally { releaseStream(); }
  }
  if (data.type === 'speak') {
    if (kind !== 'kokoro') throw new Error('Speech generation requires Kokoro.');
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 500) throw new Error('Speech requests must contain 1 to 500 characters.');
    const sid = data.sid ?? 0;
    if (!Number.isInteger(sid) || sid < 0 || sid >= engine.numSpeakers) throw new Error('Choose an available Kokoro voice.');
    const start = performance.now(); const audio = engine.generate({ text: data.text, sid, speed: 1 });
    if (!audio.samples?.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) throw new Error('Kokoro returned no audio.');
    return reply('audio-result', data, { samples: audio.samples, sampleRate: audio.sampleRate, elapsed: performance.now() - start }, [audio.samples.buffer]);
  }
  throw new Error('Unsupported local speech command.');
}
// Clients await acknowledgements. Never accumulate a Promise queue during init.
onmessage = async ({ data }) => {
  if (commandActive) return reply('error', data, { message: 'Local speech is busy. Await its acknowledgement before sending another command.', code: 'busy' });
  if (fatal) return reply('error', data, { message: 'Local speech failed. Reload the worker before retrying.', fatal: true });
  commandActive = true;
  try { await handle(data); }
  catch (error) {
    fatal = data.type === 'init' || error instanceof WebAssembly.RuntimeError || typeof error === 'number';
    const message = error.message || (typeof error === 'number' ? 'Local speech allocation or inference failed within its WASM memory budget.' : String(error));
    reply('error', data, { message, fatal });
  } finally { commandActive = false; }
};
