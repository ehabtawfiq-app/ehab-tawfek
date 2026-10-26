const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

const ADMIN = { username: 'boss', password: 'Admin@Strong-2026' };
async function boot() {
  const { app } = createApp({ dbPath: ':memory:', jwtSecret: 'x'.repeat(40), adminUsername: ADMIN.username, adminPassword: ADMIN.password, quiet: true, authLimit: 100000 });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => { let cookie = ''; return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() || []; if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let data = null; try { data = await res.json(); } catch { /* empty */ } return { status: res.status, data };
  }; };
  return { client, close: () => new Promise((r) => server.close(r)) };
}

test('cancellation policy has a default, is public, and the admin can change it', async () => {
  const env = await boot();
  try {
    const pub = await env.client()('GET', '/api/public/settings');
    assert.match(pub.data.cancellation_policy, /غير مسترد/);
    const admin = env.client(); await admin('POST', '/api/auth/login', ADMIN);
    const put = await admin('PUT', '/api/admin/settings', { cancellation_policy: '  العربون لا يُسترد، ويمكن تأجيل الموعد قبل 24 ساعة.  ' });
    assert.equal(put.status, 200);
    assert.equal((await env.client()('GET', '/api/public/settings')).data.cancellation_policy, 'العربون لا يُسترد، ويمكن تأجيل الموعد قبل 24 ساعة.');
    await admin('PUT', '/api/admin/settings', { cancellation_policy: '' });
    assert.equal((await env.client()('GET', '/api/public/settings')).data.cancellation_policy, '');
  } finally { await env.close(); }
});

test('only the admin can change the cancellation policy', async () => {
  const env = await boot();
  try {
    const c = env.client();
    await c('POST', '/api/auth/register', { name: 'عميل', username: 'cust9', phone: '01012345678', password: 'password123' });
    assert.equal((await c('PUT', '/api/admin/settings', { cancellation_policy: 'x' })).status, 403);
  } finally { await env.close(); }
});
