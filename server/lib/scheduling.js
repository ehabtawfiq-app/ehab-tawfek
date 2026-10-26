// Pure scheduling helpers. No database, no clock: everything is passed in so it can be tested.

function toMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

function formatTime(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * @param {object} p
 * @param {string} p.opening   "HH:MM"
 * @param {string} p.closing   "HH:MM" (a closing time <= opening means it runs past midnight)
 * @param {number} p.interval  minutes between slot starts
 * @param {number} p.duration  minutes the service takes
 * @param {{start_time:string,duration_minutes:number}[]} p.booked  existing bookings of the same doctor
 * @param {boolean} p.blocked  whole day unavailable
 * @param {number|null} p.pastCutoff  minutes-from-midnight; slots starting at or before it are in the past (Infinity = whole day)
 */
function buildSlots({ opening, closing, interval = 30, duration = 30, booked = [], blocked = false, pastCutoff = null }) {
  const open = toMinutes(opening);
  let close = toMinutes(closing);
  if (!Number.isFinite(open) || !Number.isFinite(close)) throw new Error('ساعات العمل غير صحيحة.');
  if (close <= open) close += 1440;
  const step = Math.max(10, Number(interval) || 30);
  const bookedRanges = booked.map((b) => ({ start: toMinutes(b.start_time), end: toMinutes(b.start_time) + Number(b.duration_minutes) }));
  const slots = [];
  for (let start = open; start + duration <= close; start += step) {
    const end = start + duration;
    const conflict = bookedRanges.some((b) => start < b.end && end > b.start);
    const inPast = pastCutoff !== null && start <= pastCutoff;
    slots.push({ time: formatTime(start), available: !blocked && !conflict && !inPast });
  }
  return slots;
}

module.exports = { toMinutes, formatTime, buildSlots };
