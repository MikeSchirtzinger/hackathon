export interface BaseRecord { id: string; createdAt: number; revision: number }
export interface ContextSnapshot extends BaseRecord {
  tabId?: number; url: string; title: string; selection: string; visibleText: string;
  capturedAt: number; availability: 'available' | 'restricted' | 'unavailable'; reason?: string;
  source: 'hotkey' | 'button'; trust: 'untrusted-page';
}
export interface Note extends BaseRecord {
  contextId: string; text: string; source: 'manual' | 'transcript'; transcriptId?: string; meetingId?: string;
  syncEligible: boolean; reasoning: 'unavailable' | 'pending' | 'complete';
}
export type Delivery = 'quiet-status' | 'digest-on-return' | 'queued-decision' | 'timed-interruption';
export interface TaskProposal extends BaseRecord {
  title: string; nextStep: string; contextId: string; meetingId?: string;
  evidenceIds: string[]; kind: 'follow-up' | 'decision' | 'research';
  delivery: Delivery; authority: 'proposal-only'; resurface: 'return' | 'meeting-end' | 'manual';
  owner?: string; dueDate?: string; approvedAt?: number;
}
export interface TranscriptSegment extends BaseRecord {
  protocol: 1; sessionId: string; segmentId: string; sequence: number; startMs: number;
  endMs: number; text: string; final: boolean; speaker?: string; source: 'human' | 'agent';
}
export interface Absence extends BaseRecord { meetingId: string; startAt: number; endAt?: number }
export interface Meeting extends BaseRecord {
  title: string; joinUrl: string; startsAt: number; remindAt: number;
  status: 'scheduled' | 'present' | 'away' | 'ended';
  captureStatus: 'unavailable' | 'starting' | 'listening' | 'stopped' | 'error';
  speechStatus: 'unavailable' | 'stopped' | 'speaking' | 'error';
  contextId?: string; reminderFiredAt?: number; notificationError?: string; endedAt?: number;
  reminderEnabled?: boolean;
  remote?: { provider: 'ambiguous'; workspaceId: string; eventId: string; notesDocId?: string; importedAt: number };
}
export interface AudioSession extends BaseRecord {
  tabId: number; ownerDocumentId: string; source: 'sample' | 'microphone' | 'zoom' | 'tab'; contextId?: string; meetingId?: string;
  captureStatus: Meeting['captureStatus']; startedAt: number; endedAt?: number; detail?: string;
}
export interface Setting { id: string; value: unknown }
export interface Settings {
  syncMode: 'local' | 'sync'; captureMode: 'push'; workspaceLabel: string;
  hostedReasoning: boolean;
}
export interface Analysis extends BaseRecord {
  kind: 'note' | 'meeting'; targetId: string; evidenceIds: string[];
  state: 'pending' | 'complete' | 'error'; response?: string; error?: string;
  summary?: string; proposals?: { kind: string; nextStep: string; evidenceIds: string[]; owner: null; dueDate: null; delivery: string }[];
  toolActivity: string[]; finishedAt?: number;
}
export interface OutboxItem extends BaseRecord {
  recordId: string; kind: 'document' | 'task'; batchId: string; approvedAt: number;
  credentialEpoch: string; workspaceLabel: string;
  payload: { title: string; content?: string; description?: string; type?: 'doc'; visibility?: 'restricted' | 'private'; due_date?: string };
  state: 'pending' | 'sending' | 'unknown' | 'failed' | 'confirmed';
  remoteId?: string; lastError?: string; confirmedAt?: number;
  remoteDueDate?: string; remoteDueDateSource?: string;
}
export interface Stores {
  contexts: ContextSnapshot; notes: Note; tasks: TaskProposal; transcripts: TranscriptSegment;
  meetings: Meeting; absences: Absence; settings: Setting; outbox: OutboxItem; audioSessions: AudioSession; analyses: Analysis;
}
export const defaults: Settings = { syncMode: 'local', captureMode: 'push', workspaceLabel: '', hostedReasoning: false };
export function base(): BaseRecord { return { id: crypto.randomUUID(), createdAt: Date.now(), revision: 1 }; }
