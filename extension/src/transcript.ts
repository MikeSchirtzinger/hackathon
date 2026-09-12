import type { TranscriptSegment } from './types';
export interface TranscriptAdapter {
  start(sessionId: string, onSegment: (segment: TranscriptSegment) => Promise<void>, onStatus: (status: 'listening' | 'stopped' | 'error', detail?: string) => void): Promise<void>;
  stop(): Promise<void>;
}
export interface SpeechTransport {
  available(): Promise<boolean>;
  speak(text: string, sessionId: string, authorityId: string): Promise<{ utteranceId: string; delivered: boolean }>;
  stop(sessionId: string): Promise<void>;
}
export interface NemotronEngineLike {
  load(): Promise<unknown>;
  feed(samples: Float32Array): unknown;
  finalize(): Promise<unknown>;
  onText: ((text: string) => void) | null;
  onEvent: ((event: unknown) => void) | null;
}
export function validateSegment(input: unknown): TranscriptSegment {
  if (!input || typeof input !== 'object') throw new Error('Invalid transcript event.');
  const s = input as TranscriptSegment;
  if (s.protocol !== 1 || !s.sessionId || !s.segmentId || !Number.isInteger(s.sequence) || s.sequence < 0 || !Number.isInteger(s.revision) || s.revision < 1 || !Number.isFinite(s.startMs) || !Number.isFinite(s.endMs) || s.startMs < 0 || s.endMs < s.startMs || typeof s.text !== 'string' || s.text.length > 50000 || typeof s.final !== 'boolean' || !['human', 'agent'].includes(s.source)) throw new Error('Invalid transcript event.');
  return { ...s, id: `${s.sessionId}:${s.segmentId}` };
}
