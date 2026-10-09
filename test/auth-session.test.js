const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { LOGIN_DURATION_MS } = require('../auth-session');

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-auth-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'auth-test';
process.env.ADMIN_PASSWORD = 'auth-test-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, db } = require('../server');

test('login persistence and the absolute two-hour deadline protect pages, APIs and sockets', async (t) => {
  t.after(async () => {
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    const resolved = path.resolve(storageDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('bot-wap-auth-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  await db.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realNow = Date.now.bind(Date);
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const login = async (rememberLogin, cookie) => {
    const response = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ username: 'auth-test', password: 'auth-test-password', rememberLogin }),
    });
    assert.equal(response.status, 200);
    await response.json();
    const header = response.headers.getSetCookie().at(-1);
    return { header, cookie: header.split(';')[0] };
  };
  const session = async (cookie) => {
    const response = await fetch(base + '/api/session', { headers: { cookie } });
    assert.match(response.headers.get('cache-control'), /no-store/);
    return response.json();
  };

  const temporary = await login(false);
  assert.doesNotMatch(temporary.header, /Expires=|Max-Age=/i);
  assert.match(temporary.header, /HttpOnly/i);
  const temporaryInfo = await session(temporary.cookie);
  assert.equal(temporaryInfo.authenticated, true);
  assert.equal(temporaryInfo.rememberLogin, false);
  assert.ok(temporaryInfo.remainingMs > LOGIN_DURATION_MS - 5000);

  const remembered = await login(true, temporary.cookie);
  assert.notEqual(remembered.cookie, temporary.cookie);
  assert.deepEqual(await session(temporary.cookie), { authenticated: false });
  assert.match(remembered.header, /Expires=/i);
  const initial = await session(remembered.cookie);
  assert.equal(initial.rememberLogin, true);
  const cookieExpiry = Date.parse(/Expires=([^;]+)/i.exec(remembered.header)[1]);
  assert.ok(Math.abs(cookieExpiry - initial.expiresAt) < 1000);
  offset = LOGIN_DURATION_MS - 10000;
  const nearExpiry = await session(remembered.cookie);
  assert.equal(nearExpiry.authenticated, true);
  assert.equal(nearExpiry.expiresAt, initial.expiresAt);
  assert.ok(nearExpiry.remainingMs > 0 && nearExpiry.remainingMs <= 10000);

  // Reject an expired cookie even if a client continues to send it.
  offset = LOGIN_DURATION_MS + 1000;
  const socket = connect(base, { transports: ['websocket'], extraHeaders: { Cookie: remembered.cookie }, reconnection: false });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expired socket was not rejected')), 5000);
      socket.once('unauthorized', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
  } finally {
    socket.disconnect();
  }
  const blockedApi = await fetch(base + '/api/profile', { headers: { cookie: remembered.cookie } });
  assert.equal(blockedApi.status, 401);
  assert.deepEqual(await session(remembered.cookie), { authenticated: false });
  const blockedPage = await fetch(base + '/atendimento', { headers: { cookie: remembered.cookie }, redirect: 'manual' });
  assert.equal(blockedPage.status, 302);
  assert.match(blockedPage.headers.get('location'), /^\/\?redirect=/);
  const blockedMedia = await fetch(base + '/media/chips/1/test.jpg', { headers: { cookie: remembered.cookie } });
  assert.equal(blockedMedia.status, 401);

  offset = 0;
  const temporaryAgain = await login(false);
  offset = LOGIN_DURATION_MS + 1000;
  const renewed = await login(false, temporaryAgain.cookie);
  assert.notEqual(renewed.cookie, temporaryAgain.cookie);
  assert.deepEqual(await session(temporaryAgain.cookie), { authenticated: false });
  assert.equal((await session(renewed.cookie)).authenticated, true);
  offset = 0;
  const fresh = await login(true);
  const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { cookie: fresh.cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
  assert.deepEqual(await session(fresh.cookie), { authenticated: false });
});
