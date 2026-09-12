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
export function conferenceUrl(event: Record<string, unknown>): string {
  // A supplied canonical field remains authoritative, including validation failures.
  if (event.conference_url !== null && event.conference_url !== undefined && event.conference_url !== '') {
    if (typeof event.conference_url !== 'string') throw new Error('Event has an invalid conference join URL.');
    return safeWebUrl(event.conference_url);
  }
  const links = new Set<string>();
  const description = typeof event.description === 'string' ? event.description : '';
  for (const match of description.matchAll(/(?:^|[\s(<\[])([a-z][a-z\d+.-]*:\/\/[^\s<>"')\]]+)/gi)) {
    let url: URL;
    try { url = new URL(match[1]!); } catch { continue; }
    if (url.hostname !== 'zoom.us' && !url.hostname.endsWith('.zoom.us')) continue;
    if (!/^\/j\/\d+\/?$/.test(url.pathname)) continue;
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw new Error('Description Zoom join links must use HTTPS on the standard port.');
    links.add(safeWebUrl(url.href));
  }
  if (links.size !== 1) throw new Error('Event needs a canonical conference URL or exactly one distinct HTTPS Zoom join link in its description.');
  return [...links][0]!;
}
export function importCalendarEvent(value: unknown, triggerAt: number | undefined, existing?: Meeting): Meeting {
  const event = object(value);
  const eventId = calendarId(event.id), workspaceId = calendarId(event.workspace_id);
  const startsAt = typeof event.start_at === 'string' ? Date.parse(event.start_at) : NaN;
  if (!Number.isFinite(startsAt) || typeof event.title !== 'string' || !event.title.trim()) throw new Error('Event is missing its title or start time.');
  if (event.status === 'cancelled') throw new Error('This calendar event is cancelled.');
  const joinUrl = conferenceUrl(event);
  const reminderEnabled = triggerAt !== undefined && Number.isFinite(triggerAt) && triggerAt >= Date.now();
  const remindAt = reminderEnabled ? triggerAt : startsAt;
  const resetReminder = existing?.remindAt !== remindAt || existing?.reminderEnabled === false;
  return {
    ...(existing ?? { ...base(), status: 'scheduled', captureStatus: 'unavailable', speechStatus: 'unavailable' }),
    title: event.title.trim(), joinUrl, startsAt, remindAt, reminderEnabled,
    revision: existing ? existing.revision + 1 : 1,
    reminderFiredAt: resetReminder ? undefined : existing?.reminderFiredAt,
    notificationError: resetReminder ? undefined : existing?.notificationError,
    remote: { provider: 'ambiguous', workspaceId, eventId, notesDocId: typeof event.meeting_notes_doc_id === 'string' ? event.meeting_notes_doc_id : undefined, importedAt: Date.now() },
  };
}
