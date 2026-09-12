/* Each engine has a separate worker: upstream wrappers share global names. */
importScripts('vendor/sherpa-onnx-wasm-web.js');
let runtime, engine, stream, kind;
const send = (type, data = {}) => postMessage({ type, ...data });
async function loadFiles(name) {
  const response = await fetch(`models/${name}/files.json`);
  if (!response.ok) throw new Error('Model file list missing. Run the asset preparation script.');
  const files = await response.json();
  let completed = 0;
  // Bound concurrent fetches: the encoder is hundreds of MB.
  for (const file of files) {
    send('status', { message: `Loading ${name}: ${file} (${++completed}/${files.length})` });
    const response = await fetch(`models/${name}/${file}`);
    if (!response.ok) throw new Error(`Missing model asset: ${file}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const path = `/${name}/${file}`;
    runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    runtime.FS.writeFile(path, bytes, { canOwn: true });
  }
  return files;
}
async function init(name) {
  kind = name;
  importScripts(name === 'nemotron' ? 'vendor/sherpa-onnx-asr.js' : 'vendor/sherpa-onnx-tts.js');
  send('status', { message: 'Starting WebAssembly runtime…' });
  runtime = await SherpaOnnx({
    locateFile: path => new URL(`vendor/${path}`, self.location.href).href,
    print: message => send('log', { message }),
    printErr: message => send('log', { message })
  });
  const files = await loadFiles(name);
  send('status', { message: `Initializing ${name} model…` });
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
  if (!engine.handle) throw new Error(`Unable to initialize ${name}. See diagnostic log.`);
  // ONNX sessions own their loaded model data; release the filesystem copies.
  for (const file of files.filter(file => file.endsWith('.onnx'))) runtime.FS.unlink(`/${name}/${file}`);
  send('ready', { speakers: engine.numSpeakers });
}
function decode() {
  while (engine.isReady(stream)) engine.decode(stream);
  return engine.getResult(stream).text || '';
}
// Serialize commands, including async initialization, to preserve stream order.
let chain = Promise.resolve();
onmessage = event => {
  const data = event.data;
  chain = chain.then(async () => {
    if (data.type === 'init') return init(data.kind);
    if (!engine?.handle) throw new Error('Load the model first.');
    if (data.type === 'start') {
      stream?.free(); stream = engine.createStream();
      if (!stream.handle) throw new Error('Could not create audio stream.');
    } else if (data.type === 'audio') {
      if (!stream) throw new Error('Audio stream has not started.');
      const start = performance.now();
      stream.acceptWaveform(data.sampleRate, data.samples);
      const text = decode();
      send('transcript', { text, elapsed: performance.now() - start });
    } else if (data.type === 'finish') {
      stream.acceptWaveform(16000, new Float32Array(16000));
      stream.inputFinished();
      const text = decode();
      stream.free(); stream = null;
      send('final', { text });
    } else if (data.type === 'speak') {
      const start = performance.now();
      const audio = engine.generate({ text: data.text, sid: data.sid, speed: 1 });
      postMessage({ type: 'audio-result', samples: audio.samples, sampleRate: audio.sampleRate, elapsed: performance.now() - start }, [audio.samples.buffer]);
    }
  }).catch(error => send('error', { message: error.message || String(error) }));
};
