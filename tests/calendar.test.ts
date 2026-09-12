import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarId, importCalendarEvent } from '../extension/src/calendar';

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
test('missing or past remote reminders never invent a notification time', () => {
  for (const trigger of [undefined, NaN, Date.now() - 1000]) assert.equal(importCalendarEvent(event, trigger).reminderEnabled, false);
});
test('calendar import rejects cancelled events, unsafe join URLs, malformed IDs and missing dates', () => {
  for (const patch of [{ status: 'cancelled' }, { conference_url: 'javascript:alert(1)' }, { conference_url: null }, { start_at: null }, { workspace_id: 'wrong' }]) assert.throws(() => importCalendarEvent({ ...event, ...patch }, undefined));
  assert.throws(() => calendarId('../users/me'));
});
