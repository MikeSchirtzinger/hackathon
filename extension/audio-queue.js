// PCM is committed to IndexedDB before decode. The caller acknowledges one
// decoded chunk at a time; pending writes and durable backlog have separate caps.
export class AudioQueue {
  constructor() {
    this.head = 0; this.tail = 0; this.samples = 0; this.writes = 0;
    this.pendingWriteBytes = 0; this.closed = false; this.failure = null;
  }
  async open() {
    if (this.db || this.closed) throw Error('Audio queue cannot be reopened.');
    this.name = `zoom-audio-${crypto.randomUUID()}`;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pcm');
      request.onsuccess = () => {
        if (this.closed) { request.result.close(); reject(Error('Audio queue was closed while opening.')); }
        else resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Audio storage is blocked by another document.'));
    });
  }
  transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      if (!this.db || this.closed) return reject(Error('Audio queue is closed.'));
      if (this.failure) return reject(this.failure);
      const tx = this.db.transaction('pcm', mode); let result;
      const request = operation(tx.objectStore('pcm'));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || Error('Audio storage failed.'));
      tx.onabort = () => reject(tx.error || Error('Audio storage was aborted.'));
    });
  }
  async push(samples) {
    if (this.closed) throw Error('Audio queue is closed.');
    if (this.failure) throw this.failure;
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > 16000) throw Error('Audio storage requires chunks of 1 to 16000 PCM samples.');
    if (this.samples + samples.length > 16000 * 1800) throw Error('Audio backlog exceeded 30 minutes. Capture stopped without silently dropping speech.');
    if (this.writes >= 300 || this.pendingWriteBytes + samples.byteLength > 4 * 1024 * 1024) throw Error('Audio storage cannot keep up within its 4 MiB pending write budget.');
    const id = this.tail++; this.samples += samples.length; this.writes++; this.pendingWriteBytes += samples.byteLength;
    try { await this.transaction('readwrite', store => store.put(samples, id)); }
    catch (error) { this.failure = error; throw error; }
    finally { this.writes--; this.pendingWriteBytes -= samples.byteLength; }
  }
  async peek() {
    if (this.failure) throw this.failure;
    if (this.head >= this.tail) return null;
    return await this.transaction('readonly', store => store.get(this.head)) || null;
  }
  async ack(length) {
    if (!Number.isInteger(length) || length <= 0 || length > this.samples || this.head >= this.tail) throw Error('Invalid audio acknowledgement.');
    await this.transaction('readwrite', store => store.delete(this.head)); this.head++; this.samples -= length;
  }
  close({ preserve = false } = {}) {
    this.closed = true; this.db?.close();
    if (this.name && !preserve) indexedDB.deleteDatabase(this.name);
  }
}
