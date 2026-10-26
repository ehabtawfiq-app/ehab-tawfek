const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

const ADMIN = { username: 'boss', password: 'Admin@Strong-2026' };

async function boot() {
  const { app, db } = createApp({ dbPath: ':memory:', jwtSecret: 'x'.repeat(40), adminUsername: ADMIN.username, adminPassword: ADMIN.password, quiet: true });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return async function call(method, url, body) {
      const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      let data = null; try { data = await res.json(); } catch { /* empty */ }
      return { status: res.status, data };
    };
  }
  return { db, client, close: () => new Promise((r) => server.close(r)) };
}
function futureDate(days = 3) {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
async function adminClient(env) {
  const c = env.client();
  const r = await c('POST', '/api/auth/login', ADMIN);
  assert.equal(r.status, 200);
  return c;
}
async function customer(env, username) {
  const c = env.client();
  const r = await c('POST', '/api/auth/register', { name: 'عميل تجريبي', username, phone: '01000000000', password: 'password123' });
  assert.equal(r.status, 201);
  return c;
}
// A tiny fixture: one clinic, two doctors, one 30-minute service.
async function fixture(env) {
  const admin = await adminClient(env);
  const clinic = (await admin('POST', '/api/admin/clinics', { name: 'عيادة الجلدية', specialty: 'جلدية', floor: 'الدور الثاني', room: '204' })).data;
  const docA = (await admin('POST', '/api/admin/doctors', { clinicId: clinic.id, name: 'د. سارة', title: 'استشاري جلدية' })).data;
  const docB = (await admin('POST', '/api/admin/doctors', { clinicId: clinic.id, name: 'د. كريم', title: 'أخصائي جلدية' })).data;
  const service = (await admin('POST', '/api/admin/services', { clinicId: clinic.id, name: 'كشف', price: 300, durationMinutes: 30 })).data;
  return { admin, clinic, docA, docB, service };
}

test('seeded building lists clinics with their doctors', async () => {
  const env = await boot();
  try {
    const { status, data } = await env.client()('GET', '/api/public/building');
    assert.equal(status, 200);
    assert.ok(data.building.name);
    assert.ok(data.clinics.length >= 4);
    assert.ok(data.clinics.every((c) => Array.isArray(c.doctors) && Array.isArray(c.services)));
    assert.ok(data.clinics.some((c) => c.doctors.length > 0));
  } finally { await env.close(); }
});

test('exactly one admin exists, and nobody can self-register as admin', async () => {
  const env = await boot();
  try {
    const c = env.client();
    const r = await c('POST', '/api/auth/register', { name: 'مخترق', username: 'hacker', phone: '01000000000', password: 'password123', role: 'admin' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'customer');
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 1);
    assert.equal((await c('POST', '/api/admin/clinics', { name: 'x' })).status, 403);
    assert.equal((await env.client()('GET', '/api/admin/clinics')).status, 401);
  } finally { await env.close(); }
});

test('admin manages clinics and doctors; inactive ones disappear from the public building', async () => {
  const env = await boot();
  try {
    const { admin, clinic, docA } = await fixture(env);
    const pub = env.client();
    let b = (await pub('GET', '/api/public/building')).data;
    const listed = b.clinics.find((c) => c.id === clinic.id);
    assert.ok(listed);
    assert.deepEqual(listed.doctors.map((d) => d.id).sort(), [docA.id, docA.id + 1].sort());
    assert.equal((await admin('DELETE', `/api/admin/doctors/${docA.id}`)).status, 200);
    b = (await pub('GET', '/api/public/building')).data;
    assert.equal(b.clinics.find((c) => c.id === clinic.id).doctors.length, 1);
    assert.equal((await admin('DELETE', `/api/admin/clinics/${clinic.id}`)).status, 200);
    b = (await pub('GET', '/api/public/building')).data;
    assert.equal(b.clinics.find((c) => c.id === clinic.id), undefined);
  } finally { await env.close(); }
});

test('slots and double-booking are tracked per doctor, not per building', async () => {
  const env = await boot();
  try {
    const { clinic, docA, docB, service } = await fixture(env);
    const cust = await customer(env, 'mona');
    const date = futureDate();
    const book = (doctorId, time) => cust('POST', '/api/bookings', { doctorId, serviceId: service.id, date, time });
    const first = await book(docA.id, '13:00');
    assert.equal(first.status, 201);
    assert.equal(first.data.booking.doctorId, docA.id);
    assert.equal(first.data.booking.clinicId, clinic.id);
    assert.equal((await book(docA.id, '13:00')).status, 409);          // same doctor, same time
    assert.equal((await book(docB.id, '13:00')).status, 201);          // other doctor is free
    const slotsA = (await cust('GET', `/api/public/slots?date=${date}&doctorId=${docA.id}&serviceId=${service.id}`)).data.slots;
    const slotsB = (await cust('GET', `/api/public/slots?date=${date}&doctorId=${docB.id}&serviceId=${service.id}`)).data.slots;
    assert.equal(slotsA.find((s) => s.time === '13:00').available, false);
    assert.equal(slotsB.find((s) => s.time === '13:00').available, false);  // B now booked too
    assert.equal(slotsA.find((s) => s.time === '14:00').available, true);
  } finally { await env.close(); }
});

test('a doctor cannot be booked for a service of another clinic', async () => {
  const env = await boot();
  try {
    const { admin, docA } = await fixture(env);
    const other = (await admin('POST', '/api/admin/clinics', { name: 'عيادة العيون', specialty: 'عيون' })).data;
    const eyeService = (await admin('POST', '/api/admin/services', { clinicId: other.id, name: 'فحص نظر', price: 200, durationMinutes: 30 })).data;
    const cust = await customer(env, 'ali');
    const r = await cust('POST', '/api/bookings', { doctorId: docA.id, serviceId: eyeService.id, date: futureDate(), time: '13:00' });
    assert.equal(r.status, 400);
  } finally { await env.close(); }
});

test('doctor day off blocks only that doctor; building closure blocks everyone', async () => {
  const env = await boot();
  try {
    const { admin, docA, docB, service } = await fixture(env);
    const cust = await customer(env, 'hana');
    const off = futureDate(4); const closed = futureDate(5);
    assert.equal((await admin('POST', `/api/admin/doctors/${docA.id}/days-off`, { date: off, reason: 'مؤتمر' })).status, 201);
    assert.equal((await cust('POST', '/api/bookings', { doctorId: docA.id, serviceId: service.id, date: off, time: '13:00' })).status, 409);
    assert.equal((await cust('POST', '/api/bookings', { doctorId: docB.id, serviceId: service.id, date: off, time: '13:00' })).status, 201);
    assert.equal((await admin('POST', '/api/admin/blocked-dates', { date: closed, reason: 'إجازة رسمية' })).status, 201);
    assert.equal((await cust('POST', '/api/bookings', { doctorId: docB.id, serviceId: service.id, date: closed, time: '14:00' })).status, 409);
    const slots = (await cust('GET', `/api/public/slots?date=${off}&doctorId=${docA.id}&serviceId=${service.id}`)).data;
    assert.ok(slots.slots.every((s) => !s.available));
    assert.ok(slots.reason);
  } finally { await env.close(); }
});

test('each doctor has their own working hours', async () => {
  const env = await boot();
  try {
    const { admin, clinic, service } = await fixture(env);
    const morning = (await admin('POST', '/api/admin/doctors', { clinicId: clinic.id, name: 'د. نادر', openingTime: '09:00', closingTime: '12:00', slotInterval: 30 })).data;
    const cust = env.client();
    const slots = (await cust('GET', `/api/public/slots?date=${futureDate()}&doctorId=${morning.id}&serviceId=${service.id}`)).data.slots;
    assert.equal(slots[0].time, '09:00');
    assert.equal(slots.at(-1).time, '11:30');
  } finally { await env.close(); }
});

test('admin can filter bookings by clinic and sees per-clinic counts in the summary', async () => {
  const env = await boot();
  try {
    const { admin, clinic, docA, service } = await fixture(env);
    const other = (await admin('POST', '/api/admin/clinics', { name: 'عيادة الأسنان', specialty: 'أسنان' })).data;
    const otherDoc = (await admin('POST', '/api/admin/doctors', { clinicId: other.id, name: 'د. هالة' })).data;
    const otherSvc = (await admin('POST', '/api/admin/services', { clinicId: other.id, name: 'كشف أسنان', price: 250, durationMinutes: 30 })).data;
    const cust = await customer(env, 'omar');
    await cust('POST', '/api/bookings', { doctorId: docA.id, serviceId: service.id, date: futureDate(), time: '13:00' });
    await cust('POST', '/api/bookings', { doctorId: otherDoc.id, serviceId: otherSvc.id, date: futureDate(), time: '13:00' });
    const filtered = (await admin('GET', `/api/admin/bookings?clinicId=${clinic.id}`)).data.bookings;
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].clinicName, 'عيادة الجلدية');
    assert.equal(filtered[0].doctorName, 'د. سارة');
    const summary = (await admin('GET', '/api/admin/summary')).data;
    assert.equal(summary.total, 2);
    assert.ok(Array.isArray(summary.byClinic));
    assert.equal(summary.byClinic.find((c) => c.clinicId === clinic.id).upcoming, 1);
  } finally { await env.close(); }
});
