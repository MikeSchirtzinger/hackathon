import { EngineClient } from './engine-client.js';
import { AudioQueue } from './audio-queue.js';
import { TranscriptWriter, voiceMessage } from './voice-bridge.js';

// One owner, one recognizer, one acknowledged decode. Persist PCM before decoding.
export class CaptureSession {
  constructor(update) {
    this.update = update;
    this.phase = 'idle';
    this.epoch = 0; this.waiters = new Set();
    this.engine = new EngineClient('nemotron', {
      onStatus: data => this.emit(typeof data === 'string' ? data : data.message),
      onDiagnostics: data => { this.diagnostics = data; this.emit(); }
    });
  }
  emit(message) {
    if (message) this.message = message;
    if (this.phase === 'idle') { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
    this.update({ phase: this.phase, source: this.kind, message: this.message, text: this.history || '',
      capturedSeconds: this.captured || 0, decodedSeconds: this.decoded || 0, queuedSeconds: (this.queue?.samples || 0) / 16000,
      computeMs: this.compute || 0, diagnostics: this.diagnostics });
  }
  async load() { return this.engine.load(); }
  async start(kind = 'microphone') {
    if (this.phase !== 'idle') throw Error('Stop the active capture before starting another source.');
    const epoch = ++this.epoch;
    const writer = this.writer = new TranscriptWriter();
    this.kind = kind; this.phase = 'starting'; this.history = ''; this.captured = this.decoded = this.segmentSeconds = this.compute = 0;
    this.emit('Preparing local transcription.');
    const current = () => { if (epoch !== this.epoch) throw Error('Capture cancelled.'); };
    try {
      await writer.begin(kind); current();
      if (kind !== 'sample') {
        const options = kind === 'tab' ? await voiceMessage('capture-tab') : undefined;
        const media = await navigator.mediaDevices.getUserMedia({ audio: options ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: options.streamId } } : { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (epoch !== this.epoch) { media.getTracks().forEach(track => track.stop()); current(); }
        this.media = media;
        // Permission is requested once. Decode only begins when the model is ready.
        this.media.getAudioTracks().forEach(track => { track.enabled = false; });
      }
      this.context = new AudioContext({ sampleRate: 16000 });
      await this.context.resume(); current();
      if (this.context.sampleRate !== 16000) throw Error('This device did not provide the required 16 kHz audio context.');
      await this.load(); current();
      this.queue = new AudioQueue(); await this.queue.open(); current();
      await writer.buffer(this.queue.name); current();
      await this.engine.request('start'); current();
      if (kind === 'sample') {
        this.phase = 'listening'; this.emit('Transcribing the bundled sample locally.');
        const response = await fetch('demo.wav');
        if (!response.ok) throw Error('Bundled sample is missing. Run npm run setup.');
        const audio = await this.context.decodeAudioData(await response.arrayBuffer()); current();
        const samples = audio.getChannelData(0);
        for (let offset = 0; offset < samples.length; offset += 3200) {
          current(); await this.enqueue(samples.slice(offset, offset + 3200));
        }
        await this.releaseInput({ keepContext: true }); current(); this.phase = 'finishing'; this.emit('Finishing sample transcription.'); void this.pump();
        return;
      }
      await this.context.audioWorklet.addModule('capture-worklet.js'); current();
      this.capture = new AudioWorkletNode(this.context, 'capture');
      this.source = this.context.createMediaStreamSource(this.media);
      this.capture.port.onmessage = ({ data }) => {
        if (data.samples && ['listening', 'stopping'].includes(this.phase)) void this.enqueue(data.samples).catch(error => { if (epoch === this.epoch) void this.fail(error); });
        if (data.stopped) this.flushed?.();
      };
      this.phase = 'listening'; await writer.status('listening'); current();
      this.media.getAudioTracks().forEach(track => { track.enabled = true; track.onended = () => { if (epoch === this.epoch) void this.stop().catch(error => this.emit(error.message)); }; });
      this.source.connect(this.capture); this.capture.connect(this.context.destination);
      if (kind === 'tab') this.source.connect(this.context.destination);
      await writer.inputActive(true); current();
      this.emit(kind === 'tab' ? 'Listening to the authorized tab on device.' : 'Listening on device. Use Stop or the voice hotkey to finish.');
    } catch (error) { if (epoch === this.epoch) await this.fail(error); throw error; }
  }
  async enqueue(samples) {
    const queue = this.queue;
    if (!queue) return;
    this.captured += samples.length / 16000;
    await queue.push(samples);
    void this.pump();
  }
  async pump() {
    if (this.pumping === this.epoch || !this.queue) return;
    this.pumping = this.epoch;
    const epoch = this.epoch;
    const current = () => epoch === this.epoch;
    try {
      while (this.queue && current()) {
        const samples = await this.queue.peek();
        if (!current()) return;
        if (!samples) {
          if (this.phase === 'finishing' && !this.queue.writes) {
            await this.finalize(); if (!current()) return;
            this.queue.close(); this.queue = null;
            await this.writer.status('stopped');
            if (!current()) return;
            await this.releaseInput();
            if (!current()) return;
            this.phase = 'idle'; this.emit('Stopped. Transcript saved locally.');
          }
          return;
        }
        const length = samples.length;
        const result = await this.engine.request('audio', { samples, sampleRate: 16000 });
        if (!current()) return;
        this.decoded += length / 16000; this.segmentSeconds += length / 16000; this.compute += result.elapsed || 0;
        await this.writer.persist(result.text, false, this.decoded * 1000);
        if (!current()) return;
        await this.queue.ack(length);
        this.emit(); this.update({ liveText: [this.history, result.text].filter(Boolean).join('\n'), phase: this.phase, source: this.kind });
        if (this.segmentSeconds >= 20) {
          await this.finalize(); if (!current()) return;
          await this.engine.request('start');
        }
      }
    } catch (error) { if (current()) await this.fail(error); }
    finally { if (this.pumping === epoch) this.pumping = undefined; }
  }
  async finalize() {
    const epoch = this.epoch, writer = this.writer;
    const result = await this.engine.request('finish');
    if (epoch !== this.epoch) return;
    await writer.persist(result.text, true, this.decoded * 1000);
    if (epoch !== this.epoch) return;
    this.history = [this.history, result.text].filter(Boolean).join('\n').slice(-30000);
    this.segmentSeconds = 0; this.emit();
  }
  async releaseInput({ keepContext = false } = {}) {
    const { media, context, source, capture, writer } = this;
    this.source = this.capture = this.media = null;
    if (!keepContext) this.context = null;
    // Stop hardware first, before awaiting storage or any other context.
    source?.disconnect(); capture?.disconnect();
    media?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    // Pending decoding owns the resumed context until the final transcript is saved.
    // Closing it earlier can severely slow processing in an inactive audio tab.
    if (!keepContext) await context?.close().catch(() => undefined);
    if (media) await writer?.inputActive(false).catch(() => undefined);
  }
  waitIdle() { return this.phase === 'idle' ? Promise.resolve() : new Promise(resolve => this.waiters.add(resolve)); }
  async stop() {
    if (this.phase === 'idle') return;
    if (this.phase === 'finishing' || this.phase === 'stopping') return this.waitIdle();
    if (this.phase === 'starting') {
      ++this.epoch; this.phase = 'stopping'; this.engine.terminate(); await this.releaseInput();
      this.queue?.close(); this.queue = null;
      await this.writer.status('stopped').catch(() => undefined);
      this.phase = 'idle'; this.emit('Capture cancelled.'); return;
    }
    const epoch = this.epoch;
    this.phase = 'stopping'; this.emit('Saving the last audio and finishing transcription.');
    try {
      if (this.capture) {
        this.source?.disconnect();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { this.flushed = null; reject(Error('Audio input did not acknowledge Stop.')); }, 5000);
          this.flushed = () => { clearTimeout(timer); this.flushed = null; resolve(); };
          this.capture.port.postMessage('flush');
        });
      }
    } catch (error) { if (epoch === this.epoch) await this.fail(error); throw error; }
    finally { if (epoch === this.epoch) await this.releaseInput({ keepContext: true }); }
    if (epoch !== this.epoch) return this.waitIdle();
    this.phase = 'finishing'; void this.pump(); return this.waitIdle();
  }
  async fail(error) {
    ++this.epoch; this.phase = 'stopping';
    await this.releaseInput(); this.engine.terminate();
    const pendingAudio = this.queue?.samples ? { database: this.queue.name, samples: this.queue.samples } : undefined;
    this.queue?.close({ preserve: !!pendingAudio }); this.queue = null;
    const message = error?.message || String(error);
    await this.writer?.status('error', message + (pendingAudio ? ` ${(pendingAudio.samples / 16000).toFixed(1)}s of queued audio remains in local storage.` : ''), pendingAudio).catch(() => undefined);
    this.phase = 'idle'; this.emit(message + (pendingAudio ? ` Queued audio remains in local storage (${pendingAudio.database}).` : ''));
  }
  dispose() {
    const active = this.phase !== 'idle';
    const pendingAudio = this.queue?.samples ? { database: this.queue.name, samples: this.queue.samples } : undefined;
    ++this.epoch; void this.releaseInput(); this.engine.terminate(); this.queue?.close({ preserve: !!pendingAudio }); this.queue = null;
    if (active) void this.writer?.status('error', pendingAudio ? 'Audio owner closed. Transcript and queued audio retained locally.' : 'Audio owner closed before capture finished. Transcript retained.', pendingAudio).catch(() => undefined);
    this.phase = 'idle'; this.emit('Models released.');
  }
}
