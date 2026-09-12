import { base, type Meeting } from './types';
import { safeWebUrl } from './policy';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ambiguous returned an invalid calendar record.');
  return value as Record<string, unknown>;
}
export function calendarId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new Error('Enter a valid Ambiguous event ID.');
  return value;
}
export function importCalendarEvent(value: unknown, triggerAt: number | undefined, existing?: Meeting): Meeting {
  const event = object(value);
  const eventId = calendarId(event.id), workspaceId = calendarId(event.workspace_id);
  const startsAt = typeof event.start_at === 'string' ? Date.parse(event.start_at) : NaN;
  if (!Number.isFinite(startsAt) || typeof event.title !== 'string' || !event.title.trim()) throw new Error('Event is missing its title or start time.');
  if (event.status === 'cancelled') throw new Error('This calendar event is cancelled.');
  if (typeof event.conference_url !== 'string' || !event.conference_url) throw new Error('Event has no conference join URL.');
  const reminderEnabled = triggerAt !== undefined && Number.isFinite(triggerAt) && triggerAt >= Date.now();
  const remindAt = reminderEnabled ? triggerAt : startsAt;
  const resetReminder = existing?.remindAt !== remindAt || existing?.reminderEnabled === false;
  return {
    ...(existing ?? { ...base(), status: 'scheduled', captureStatus: 'unavailable', speechStatus: 'unavailable' }),
    title: event.title.trim(), joinUrl: safeWebUrl(event.conference_url), startsAt, remindAt, reminderEnabled,
    revision: existing ? existing.revision + 1 : 1,
    reminderFiredAt: resetReminder ? undefined : existing?.reminderFiredAt,
    notificationError: resetReminder ? undefined : existing?.notificationError,
    remote: { provider: 'ambiguous', workspaceId, eventId, notesDocId: typeof event.meeting_notes_doc_id === 'string' ? event.meeting_notes_doc_id : undefined, importedAt: Date.now() },
  };
}
