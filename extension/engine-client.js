// Serialize model initialization across engines to bound loading peaks.
let initialization = Promise.resolve();
const replies = { init: 'ready', start: 'started', audio: 'transcript', finish: 'final', speak: 'audio-result', stop: 'stopped', diagnostics: 'diagnostics' };
export class EngineClient {
  constructor(kind, { onStatus, onLog, onDiagnostics } = {}) {
    if (!['nemotron', 'kokoro'].includes(kind)) throw new Error('Unknown local speech engine.');
    this.kind = kind; this.callbacks = { onStatus, onLog, onDiagnostics };
    this.pending = new Map(); this.generation = 0; this.loaded = false;
  }
  get ready() { return this.loaded; }
  load() {
    if (this.loading) return this.loading;
    const generation = this.generation;
    const operation = initialization.catch(() => {}).then(async () => {
      if (generation !== this.generation) throw new Error('Speech loading was cancelled.');
      const worker = new Worker(new URL('./engine-worker.js', import.meta.url)); this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'status') this.callbacks.onStatus?.(data.message, data);
        if (data.type === 'log') this.callbacks.onLog?.(data.message, data);
        if (data.diagnostics) this.callbacks.onDiagnostics?.(data.diagnostics);
        const pending = this.pending.get(data.requestId);
        if (data.type === 'error') {
          const error = new Error(data.message || 'Local speech failed.'); error.code = data.code;
          if (pending) { this.pending.delete(data.requestId); clearTimeout(pending.timer); pending.reject(error); }
          if (data.fatal) this.terminate(error);
        } else if (pending && data.type === pending.reply) {
          this.pending.delete(data.requestId); clearTimeout(pending.timer); pending.resolve(data);
        }
      };
      worker.onerror = event => this.terminate(new Error(`Local speech worker failed: ${event.message || 'unknown error'}`));
      worker.onmessageerror = () => this.terminate(new Error('Local speech worker returned an unreadable response.'));
      const ready = await this.send('init', { kind: this.kind });
      if (generation !== this.generation) throw new Error('Speech loading was cancelled.');
      this.loaded = true; return ready;
    });
    initialization = operation.then(() => undefined, () => undefined);
    this.loading = operation.catch(error => { if (generation === this.generation) this.terminate(error); throw error; });
    return this.loading;
  }
  async request(type, payload = {}) {
    if (!replies[type] || type === 'init') throw new Error('Unsupported speech request.');
    const generation = this.generation;
    await this.load();
    if (generation !== this.generation) throw new Error('Speech request was cancelled.');
    if ([...this.pending.values()].some(pending => pending.type !== 'diagnostics')) throw new Error('Wait for the previous speech request before sending more audio or text.');
    return this.send(type, payload);
  }
  send(type, payload) {
    const requestId = payload.requestId || crypto.randomUUID();
    if (!this.worker) return Promise.reject(new Error('Local speech worker is unavailable.'));
    if (this.pending.has(requestId)) return Promise.reject(new Error('Duplicate speech request.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.terminate(new Error(`Local speech ${type} timed out. Retry to reload the model.`)), type === 'init' ? 180000 : 120000);
      this.pending.set(requestId, { resolve, reject, timer, type, reply: replies[type] });
      // Keep the caller's durable queue item intact until its acknowledgement.
      try { this.worker.postMessage({ ...payload, type, requestId }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  terminate(reason = new Error('Local speech was stopped.')) {
    this.generation++; this.worker?.terminate(); this.worker = null; this.loaded = false; this.loading = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(reason); }
    this.pending.clear();
  }
}
