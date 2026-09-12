// Output authority belongs to the current explicit speech request.
export class SpeechRequestGate {
  #epoch = 0;
  #pending;
  begin() {
    this.#pending = { requestId: crypto.randomUUID(), speechEpoch: this.#epoch };
    return { ...this.#pending };
  }
  accepts(result) {
    return !!this.#pending && result.requestId === this.#pending.requestId && result.speechEpoch === this.#epoch;
  }
  finish(result) {
    if (!this.accepts(result)) return false;
    this.#pending = undefined;
    return true;
  }
  cancel() { this.#epoch += 1; this.#pending = undefined; }
  get pending() { return !!this.#pending; }
}
export const speechRequests = new SpeechRequestGate();
export function stopSpeechOutput(reason = 'Speech output stopped.') {
  speechRequests.cancel();
  const player = document.getElementById('playback');
  player?.pause();
  if (player) { player.removeAttribute('src'); player.load(); }
  window.dispatchEvent(new CustomEvent('speech-output-stopped', { detail: { reason } }));
  return { stopped: true };
}
