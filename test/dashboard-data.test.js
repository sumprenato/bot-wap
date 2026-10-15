const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dashboardActivity } = require('../dashboard-data');

test('dashboard buckets messages in Brasília, includes empty days and excludes out-of-period or invalid timestamps', () => {
  const now = new Date('2026-10-14T15:00:00Z');
  const activity = dashboardActivity([{ messages: [
    { at: '2026-10-14T02:30:00Z', from: 'client' }, // October 13, 23h in Brasília
    { at: '2026-10-14T03:00:00Z', from: 'admin' },
    { at: '2026-10-08T03:00:00Z', from: 'client' },
    { at: '2026-10-08T02:59:00Z', from: 'client' },
    { at: '2026-10-14T16:00:00Z', from: 'client' },
    { at: 'invalid', from: 'client' },
    { from: 'client' },
  ] }], 7, now);
  assert.equal(activity.daily.length, 7);
  assert.equal(activity.daily[0].date, '2026-10-08');
  assert.deepEqual(activity.daily.at(-1), { date: '2026-10-14', received: 0, sent: 1 });
  assert.equal(activity.daily.at(-2).received, 1);
  assert.equal(activity.hourly[23].received, 1);
  assert.equal(activity.hourly[0].sent, 1);
  assert.equal(activity.received, 2);
  assert.equal(activity.sent, 1);
});

test('conversation status is mutually exclusive, and pending replies only count open chats', () => {
  const activity = dashboardActivity([
    { messages: [{ from: 'client' }] },
    { messages: [{ from: 'admin' }] },
    { isFinalized: true, messages: [{ from: 'client' }] },
    { blocked: true, isFinalized: true, messages: [{ from: 'client' }] },
    { messages: [] },
  ]);
  assert.equal(activity.open, 3);
  assert.equal(activity.finalized, 1);
  assert.equal(activity.blocked, 1);
  assert.equal(activity.awaitingReply, 1);
});
