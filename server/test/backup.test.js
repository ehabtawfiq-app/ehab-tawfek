const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const { createApp } = require('../app');

const ADMIN = { username: 'boss', password: 'Admin@Strong-2026' };

async function boot() {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dorak-up-'));
  const { app, db } = createApp({ dbPath: ':memory:', uploadDir, jwtSecret: 'x'.repeat(40), adminUsername: ADMIN.username, adminPassword: ADMIN.password, quiet: true, authLimit: 100000 });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async function call(method, url, body, raw = false) {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      if (raw) return { status: res.status, headers: res.headers, buffer: new Uint8Array(await res.arrayBuffer()) };
      let data = null; try { data = await res.json(); } catch { /* empty */ }
      return { status: res.status, data };
    };
  }
  return { db, uploadDir, client, close: () => new Promise((r) => server.close(r)) };
}
const futureDate = (days = 3) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + days * 86400000));

async function seedBooking(env, { note = '' } = {}) {
  const admin = env.client(); await admin('POST', '/api/auth/login', ADMIN);
  const clinic = (await admin('POST', '/api/admin/clinics', { name: 'عيادة', specialty: 'x', floor: '2', room: '204' })).data;
  const doctor = (await admin('POST', '/api/admin/doctors', { clinicId: clinic.id, name: 'د. سارة', title: 'x' })).data;
  const service = (await admin('POST', '/api/admin/services', { clinicId: clinic.id, name: 'كشف', price: 300, durationMinutes: 30 })).data;
  const cust = env.client();
  assert.equal((await cust('POST', '/api/auth/register', { name: 'عميل تجريبي', username: 'cust1', phone: '01012345678', password: 'password123' })).status, 201);
  const made = await cust('POST', '/api/bookings', { doctorId: doctor.id, serviceId: service.id, date: futureDate(), time: '15:00', note });
  assert.equal(made.status, 201);
  return { admin, cust, booking: made.data.booking };
}

test('backup is admin-only', async () => {
  const env = await boot();
  try {
    assert.equal((await env.client()('GET', '/api/admin/backup', undefined, true)).status, 401);
    const cust = env.client();
    await cust('POST', '/api/auth/register', { name: 'عميل', username: 'cust2', phone: '01012345678', password: 'password123' });
    assert.equal((await cust('GET', '/api/admin/backup', undefined, true)).status, 403);
  } finally { await env.close(); }
});

test('backup zip has data, csv and receipts but never password hashes', async () => {
  const env = await boot();
  try {
    const { admin, booking } = await seedBooking(env, { note: '=HYPERLINK("http://evil")' });
    const file = 'receipt-test.png';
    fs.writeFileSync(path.join(env.uploadDir, file), Buffer.from('fake-png-bytes'));
    env.db.prepare('UPDATE bookings SET receipt_filename = ? WHERE id = ?').run(file, booking.id);

    const res = await admin('GET', '/api/admin/backup', undefined, true);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/zip/);
    assert.match(res.headers.get('content-disposition'), /dorak-backup-\d{4}-\d{2}-\d{2}\.zip/);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const files = unzipSync(res.buffer);
    assert.ok(files['data.json'] && files['bookings.csv'] && files['README.txt']);
    const dataText = strFromU8(files['data.json']);
    assert.ok(!dataText.includes('password_hash'), 'hash column must not be exported');
    assert.ok(!dataText.includes('$2'), 'no bcrypt hash anywhere');
    const data = JSON.parse(dataText);
    assert.equal(data.bookings.length, 1);
    assert.equal(data.counts.receipts, 1);
    assert.ok(data.users.some((u) => u.username === 'cust1') && data.users.every((u) => !('password_hash' in u)));
    assert.ok(data.clinics.length >= 1 && data.doctors.length >= 1 && data.services.length >= 1 && data.bookingEvents.length >= 1);

    const receiptPath = data.bookings[0].receipt_zip_path;
    assert.equal(receiptPath, `receipts/${booking.code}.png`);
    assert.equal(strFromU8(files[receiptPath]), 'fake-png-bytes');

    const csv = strFromU8(files['bookings.csv']);
    assert.deepEqual([...files['bookings.csv'].slice(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM so Excel reads Arabic');
    assert.ok(csv.includes(booking.code) && csv.includes('عميل تجريبي'));
    assert.ok(csv.includes(`"'=HYPERLINK`), 'formula injection neutralised');
  } finally { await env.close(); }
});

test('a missing receipt file is counted, not fatal', async () => {
  const env = await boot();
  try {
    const { admin, booking } = await seedBooking(env);
    env.db.prepare('UPDATE bookings SET receipt_filename = ? WHERE id = ?').run('gone.png', booking.id);
    const res = await admin('GET', '/api/admin/backup', undefined, true);
    assert.equal(res.status, 200);
    const data = JSON.parse(strFromU8(unzipSync(res.buffer)['data.json']));
    assert.equal(data.counts.missingReceipts, 1);
  } finally { await env.close(); }
});
