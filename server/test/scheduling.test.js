const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSlots, toMinutes, formatTime } = require('../lib/scheduling');

const base = { opening: '12:00', closing: '00:00', interval: 30, duration: 30, booked: [], blocked: false, pastCutoff: null };

test('toMinutes / formatTime round trip and reject bad input', () => {
  assert.equal(toMinutes('09:30'), 570);
  assert.ok(Number.isNaN(toMinutes('25:00')));
  assert.ok(Number.isNaN(toMinutes('abc')));
  assert.equal(formatTime(24 * 60 + 90), '01:30');
});

test('window that closes at midnight yields slots up to 23:30', () => {
  const slots = buildSlots(base);
  assert.equal(slots.length, 24);
  assert.equal(slots[0].time, '12:00');
  assert.equal(slots.at(-1).time, '23:30');
  assert.ok(slots.every((s) => s.available));
});

test('a longer service stops fitting before closing time', () => {
  const slots = buildSlots({ ...base, duration: 60 });
  assert.equal(slots.at(-1).time, '23:00');
});

test('overlapping bookings are unavailable but touching ones are fine', () => {
  const slots = buildSlots({ ...base, duration: 60, booked: [{ start_time: '13:00', duration_minutes: 60 }] });
  const by = Object.fromEntries(slots.map((s) => [s.time, s.available]));
  assert.equal(by['12:00'], true);   // ends exactly when 13:00 starts
  assert.equal(by['12:30'], false);  // overlaps
  assert.equal(by['13:00'], false);
  assert.equal(by['13:30'], false);
  assert.equal(by['14:00'], true);
});

test('blocked day makes every slot unavailable', () => {
  assert.ok(buildSlots({ ...base, blocked: true }).every((s) => !s.available));
});

test('slots at or before the cutoff are in the past', () => {
  const by = Object.fromEntries(buildSlots({ ...base, pastCutoff: toMinutes('13:00') }).map((s) => [s.time, s.available]));
  assert.equal(by['12:30'], false);
  assert.equal(by['13:00'], false);
  assert.equal(by['13:30'], true);
});

test('invalid hours throw', () => {
  assert.throws(() => buildSlots({ ...base, opening: 'x' }));
});
