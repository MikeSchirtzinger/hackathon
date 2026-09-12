import { all, get } from './db';
import type { EvidenceKind } from './types';
export async function savedEvidence(kind: EvidenceKind, targetId: string) {
  const target = kind === 'context' ? await get('contexts', targetId) : kind === 'note' ? await get('notes', targetId) : await get('meetings', targetId);
  if (!target) throw new Error('Saved evidence was not found.');
  const context = kind === 'context' ? await get('contexts', targetId) : 'contextId' in target && target.contextId ? await get('contexts', target.contextId) : undefined;
  const notes = kind === 'note' ? [target] : kind === 'meeting' ? (await all('notes')).filter(n => n.meetingId === targetId || (context && n.contextId === context.id)) : [];
  const sessions = kind === 'meeting' ? (await all('audioSessions')).filter(s => s.meetingId === targetId) : [];
  const transcripts = kind === 'meeting' ? (await all('transcripts')).filter(t => t.final && sessions.some(s => s.id === t.sessionId)) : [];
  const absences = kind === 'meeting' ? (await all('absences')).filter(a => a.meetingId === targetId) : [];
  const evidenceIds = [...new Set([targetId, ...notes.map(n => n.id), ...transcripts.map(t => t.id), ...absences.map(a => a.id), ...(context ? [context.id] : [])])];
  const evidence = { target: kind === 'context' ? { ...target, visibleText: context?.visibleText.slice(0, 6000) } : target, notes, transcripts, absences,
    timingLimitation: 'Absence intervals use wall-clock time. Transcript offsets measure decoded audio only and have no verified wall-clock alignment. Attribution of a transcript segment or missed item to an absence is unavailable.',
    context: context ? { id: context.id, title: context.title, url: context.url, selection: context.selection, visibleText: context.visibleText.slice(0, 6000), trust: 'untrusted-page' } : null };
  if (JSON.stringify(evidence).length > 50000) throw new Error('Saved evidence exceeds the analysis size limit. Use a single note.');
  return { target, evidence, evidenceIds };
}
