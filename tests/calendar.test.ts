import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarId, conferenceUrl, importCalendarEvent } from '../extension/src/calendar';

const event = { id: 'd2b2d9d5-2956-4140-ba37-410fe4c68065', workspace_id: '7eb66e1c-4b86-4309-bf72-fd81dcc5b203', title: 'Calendar mapping fixture', start_at: new Date(Date.now() + 600000).toISOString(), conference_url: 'https://meet.jit.si/test-fixture', status: 'confirmed' };
test('calendar refresh retains local meeting lifecycle, ID, context, and absence relationship', () => {
  const reminder = Date.now() + 300000;
  const first = importCalendarEvent(event, reminder);
  const updated = importCalendarEvent({ ...event, title: 'Updated fixture title' }, reminder, { ...first, contextId: 'local-context', status: 'away', captureStatus: 'listening' });
  assert.equal(updated.id, first.id);
  assert.equal(updated.status, 'away'); assert.equal(updated.captureStatus, 'listening');
  assert.equal(updated.contextId, 'local-context'); assert.equal(updated.revision, 2);
  assert.equal(updated.remote?.eventId, event.id); assert.equal(updated.reminderEnabled, true);
});
test('missing canonical URL accepts one distinct HTTPS Zoom join URL duplicated by Markdown', () => {
  const url = 'https://us05web.zoom.us/j/123456789?pwd=fixture-only';
  assert.equal(conferenceUrl({ conference_url: null, description: `[${url}](${url})` }), url);
  const meeting = importCalendarEvent({ ...event, conference_url: null, description: `[Join](${url})` }, undefined);
  assert.equal(meeting.joinUrl, url);
});
test('canonical conference URL overrides description and never falls through on invalid canonical data', () => {
  assert.equal(conferenceUrl({ conference_url: event.conference_url, description: 'https://zoom.us/j/123' }), event.conference_url);
  assert.throws(() => conferenceUrl({ conference_url: 'javascript:alert(1)', description: 'https://zoom.us/j/123' }));
});
test('description extraction rejects missing, ambiguous, unsafe and non-Zoom join targets', () => {
  for (const description of ['', 'https://example.com/j/123', 'https://zoom.us.evil.example/j/123', 'http://zoom.us/j/123', 'ftp://zoom.us/j/123', 'javascript:https://zoom.us/j/123', 'https://secret@zoom.us/j/123', 'https://zoom.us:8443/j/123', 'https://zoom.us/profile', 'https://zoom.us/j/123 https://zoom.us/j/456', 'https://zoom.us/j/123?pwd=one https://zoom.us/j/123?pwd=two']) assert.throws(() => conferenceUrl({ conference_url: null, description }));
});
test('missing or past remote reminders never invent a notification time', () => {
  for (const trigger of [undefined, NaN, Date.now() - 1000]) assert.equal(importCalendarEvent(event, trigger).reminderEnabled, false);
});
test('calendar import rejects cancelled events, unsafe join URLs, malformed IDs and missing dates', () => {
  for (const patch of [{ status: 'cancelled' }, { conference_url: 'javascript:alert(1)' }, { conference_url: null }, { start_at: null }, { workspace_id: 'wrong' }]) assert.throws(() => importCalendarEvent({ ...event, ...patch }, undefined));
  assert.throws(() => calendarId('../users/me'));
});
