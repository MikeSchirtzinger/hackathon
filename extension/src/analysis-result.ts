import type { Analysis } from './types';
import { object } from './calendar';

export function parseAnalysisResponse(response: string, evidenceIds: string[]): Pick<Analysis, 'summary' | 'proposals'> {
  const value = object(JSON.parse(response.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 6000 || !Array.isArray(value.proposals) || value.proposals.length > 10) throw new Error('Assistant response did not match the requested proposal format.');
  const proposals = value.proposals.map(raw => {
    const p = object(raw);
    if (!['follow-up','decision','research','reminder'].includes(String(p.kind)) || typeof p.nextStep !== 'string' || !p.nextStep.trim() || p.nextStep.length > 2000 || !Array.isArray(p.evidenceIds) || !p.evidenceIds.length || p.evidenceIds.some(id => typeof id !== 'string' || !evidenceIds.includes(id)) || p.owner !== null || p.dueDate !== null || !['quiet-status','digest-on-return','queued-decision'].includes(String(p.delivery))) throw new Error('Assistant proposal contains unsupported evidence, authority, owner, date, or delivery.');
    return { kind: String(p.kind), nextStep: p.nextStep, evidenceIds: p.evidenceIds as string[], owner: null, dueDate: null, delivery: String(p.delivery) };
  });
  return { summary: value.summary, proposals };
}
