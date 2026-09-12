class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(3200); this.used = 0;
    this.port.onmessage = event => { if (event.data === 'flush') { this.flush(); this.port.postMessage({ stopped: true }); } };
  }
  flush() {
    if (this.used) { const samples = this.buffer.slice(0, this.used); this.port.postMessage({ samples }, [samples.buffer]); this.used = 0; }
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const value of channel) { this.buffer[this.used++] = value; if (this.used === this.buffer.length) this.flush(); }
    return true;
  }
}
registerProcessor('capture', Capture);
