const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { disconnectInfo, createConnectionLog } = require('../whatsapp-connection');

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reasons = { loggedOut: 401, badSession: 500, restartRequired: 515, connectionClosed: 428, connectionLost: 408, connectionReplaced: 440, forbidden: 403, multideviceMismatch: 411 };

async function harness(t, options = {}) {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-connection-'));
  const env = Object.fromEntries(['STORAGE_DIR', 'CHIP_ID', 'ADMIN_NUMBER', 'EXPECTED_ACCOUNT_NUMBER'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { STORAGE_DIR: storageDir, CHIP_ID: '17', ADMIN_NUMBER: '', EXPECTED_ACCOUNT_NUMBER: '' });
  const authDir = path.join(storageDir, 'auth_info'); fs.mkdirSync(authDir);
  const credentials = path.join(authDir, 'creds.json');
  fs.writeFileSync(credentials, JSON.stringify({ registered: true, me: { id: '5511999991111@s.whatsapp.net' } }));
  const sockets = [], saves = [], events = [];
  const emitter = new EventEmitter(); emitter.on('status', status => events.push({ ...status }));
  const load = Module._load;
  delete require.cache[require.resolve('../bot')];
  Module._load = function (name, ...args) {
    if (name === '@whiskeysockets/baileys') return {
      generateMessageIDV2: () => require('node:crypto').randomUUID(),
      DisconnectReason: reasons,
      useMultiFileAuthState: async () => ({ state: { creds: { registered: fs.existsSync(credentials) }, keys: { get: async () => ({}), set: options.saveKeys || (async () => {}) } },
        saveCreds: async () => { saves.push('start'); await options.saveCreds?.(); saves.push('done'); } }),
      default: config => {
        const handlers = {}, socket = { config, handlers, user: { id: '5511999991111:4@s.whatsapp.net' }, loggedOut: 0, ended: 0,
          ev: { on: (name, handler) => { handlers[name] = handler; } },
          ws: { closed: false, close() { this.closed = true; } },
          end() { this.ended++; this.ws.close(); },
          logout: async () => { socket.loggedOut++; }, sendMessage: async () => ({}) };
        sockets.push(socket); return socket;
      },
    };
    if (name === './db') return { ready: Promise.resolve() };
    if (name === './store') return {};
    if (name === './whatsapp-directory') return { WhatsAppDirectory: class { constructor() { this.syncState = { verified: true }; } async sync() {} } };
    if (name === './whatsapp-message-retry') return { createMessageRetryStore: () => ({ clear() {}, remember() {} }) };
    if (name === './whatsapp-connection') return { disconnectInfo, createConnectionLog: (folder, chipId) => createConnectionLog(folder, chipId, () => {}) };
    return load.call(this, name, ...args);
  };
  let bot;
  try { bot = require('../bot'); } finally { Module._load = load; }
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(async () => {
    await bot.stopBot?.(); t.mock.timers.reset();
    delete require.cache[require.resolve('../bot')];
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(storageDir), os.tmpdir());
    assert.ok(path.basename(storageDir).startsWith('bot-wap-connection-'));
    fs.rmSync(storageDir, { recursive: true, force: true });
  });
  await bot.startBot(emitter);
  return { bot, emitter, sockets, credentials, events, saves, storageDir,
    close: (socket, code) => socket.handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } }),
    open: socket => socket.handlers['connection.update']({ connection: 'open' }),
    advance: async ms => { t.mock.timers.tick(ms); await tick(); },
  };
}

test('generic WhatsApp 500 preserves credentials and reconnects without requesting a new QR', async t => {
  const h = await harness(t);
  await h.close(h.sockets[0], 500);
  assert.equal(fs.existsSync(h.credentials), true, 'a generic stream error must not erase authentication');
  await h.advance(1000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].config.auth.creds.registered, true);
});

test('temporary identity verification failure must never log out a valid WhatsApp session', async t => {
  const h = await harness(t);
  h.bot.setIdentityVerifier(async () => { throw Object.assign(new Error('Temporary database timeout'), { code: 'ETIMEDOUT' }); });
  await h.open(h.sockets[0]);
  assert.equal(h.sockets[0].loggedOut, 0, 'internal infrastructure errors must not revoke the linked device');
  assert.equal(fs.existsSync(h.credentials), true);
  assert.equal(h.bot.getStatus().connected, false);
  h.bot.setIdentityVerifier(async () => {});
  await h.advance(1000);
  await h.open(h.sockets.at(-1));
  assert.equal(h.bot.getStatus().connected, true);
});

test('a closed socket cannot become connected after delayed identity verification finishes', async t => {
  const h = await harness(t), verification = deferred();
  h.bot.setIdentityVerifier(() => verification.promise);
  const opening = h.open(h.sockets[0]);
  await h.close(h.sockets[0], 408);
  verification.resolve(); await opening;
  assert.equal(h.bot.getStatus().connected, false, 'late verification belongs to the closed connection');
});

test('starting an already active chip is idempotent and cannot create competing sockets', async t => {
  const h = await harness(t);
  await h.bot.startBot(h.emitter);
  await h.open(h.sockets[0]);
  await h.bot.startBot(h.emitter);
  assert.equal(h.sockets.length, 1);
});

test('brief opens do not reset retry backoff and duplicate close events schedule only one retry', async t => {
  const h = await harness(t);
  await h.open(h.sockets[0]);
  await h.close(h.sockets[0], 408);
  await h.close(h.sockets[0], 408);
  await h.advance(1000);
  assert.equal(h.sockets.length, 2);
  await h.open(h.sockets[1]);
  await h.close(h.sockets[1], 408);
  await h.advance(1000);
  assert.equal(h.sockets.length, 2, 'flapping connections must wait 2 seconds before the second retry');
  await h.advance(1000);
  assert.equal(h.sockets.length, 3);
});

test('connection replacement preserves credentials and stops the reconnect tug of war', async t => {
  const h = await harness(t);
  await h.close(h.sockets[0], 440);
  await h.advance(120000);
  assert.equal(h.sockets.length, 1, 'a replaced connection must not repeatedly kick the other process');
  assert.equal(fs.existsSync(h.credentials), true);
  assert.match(h.bot.getStatus().error, /outra|instância|sessão/i);
});

test('reconnect waits for credential persistence before loading another socket', async t => {
  const writing = deferred(), h = await harness(t, { saveCreds: () => writing.promise });
  const save = h.sockets[0].handlers['creds.update']({});
  await h.close(h.sockets[0], 515);
  await h.advance(1000);
  assert.equal(h.sockets.length, 1, 'new connection must not read partially saved credentials');
  writing.resolve(); await save; await tick();
  assert.equal(h.sockets.length, 2);
});

test('only an actual revoked session generates a fresh QR automatically', async t => {
  const h = await harness(t);
  await h.close(h.sockets[0], 401);
  assert.equal(fs.existsSync(h.credentials), false);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].config.auth.creds.registered, false);
});

test('forbidden or incompatible connections retain credentials and do not loop', async t => {
  const h = await harness(t);
  for (const code of [403, 411]) {
    await h.close(h.sockets.at(-1), code);
    const sockets = h.sockets.length;
    await h.advance(300000);
    assert.equal(h.sockets.length, sockets);
    assert.equal(fs.existsSync(h.credentials), true);
    await h.bot.startBot(h.emitter);
  }
});

test('backoff resets only after the socket has actually remained stable', async t => {
  const h = await harness(t);
  await h.close(h.sockets[0], 408); await h.advance(1000);
  await h.open(h.sockets[1]); await h.advance(60000);
  await h.close(h.sockets[1], 428);
  assert.equal(h.bot.getStatus().retryInMs, 1000);
});

test('thirty consecutive network drops preserve the pairing with one socket per retry', async t => {
  const h = await harness(t);
  for (let attempt = 0; attempt < 30; attempt++) {
    const socket = h.sockets.at(-1);
    await h.open(socket);
    await h.close(socket, attempt % 2 ? 500 : 408);
    const delay = h.bot.getStatus().retryInMs;
    assert.ok(delay >= 1000 && delay <= 30000);
    await h.advance(delay);
    assert.equal(h.sockets.length, attempt + 2);
    assert.equal(socket.loggedOut, 0);
    assert.equal(fs.existsSync(h.credentials), true);
    assert.equal(h.sockets.at(-1).config.auth.creds.registered, true);
  }
});

test('shutdown drains pending encryption key writes without logging out', async t => {
  const writing = deferred(), h = await harness(t, { saveKeys: () => writing.promise });
  const write = h.sockets[0].config.auth.keys.set({ session: { test: {} } });
  let stopped = false;
  const stopping = h.bot.stopBot().then(() => { stopped = true; });
  await tick();
  try {
    assert.equal(stopped, false);
    assert.equal(h.sockets[0].loggedOut, 0);
    assert.equal(h.sockets[0].ended, 1);
  } finally { writing.resolve(); }
  await write; await stopping;
  assert.equal(fs.existsSync(h.credentials), true);
  await h.advance(120000);
  assert.equal(h.sockets.length, 1, 'stopped workers must not start new sockets');
});

test('connection diagnostics contain the disconnect code without credentials or payloads', async t => {
  const h = await harness(t);
  await h.sockets[0].handlers['connection.update']({ connection: 'close', lastDisconnect: { error: {
    output: { statusCode: 500 }, message: 'SECRET_MESSAGE', data: { noiseKey: 'SECRET_KEY', qr: 'SECRET_QR' },
  } } });
  const log = fs.readFileSync(path.join(h.storageDir, 'connection-events.log'), 'utf8');
  assert.match(log, /"code":500/);
  assert.doesNotMatch(log, /SECRET_|5511999991111/);
});

test('late encryption updates from a closed socket cannot overwrite the replacement session', async t => {
  let writes = 0;
  const h = await harness(t, { saveKeys: async () => { writes++; } });
  const old = h.sockets[0];
  await h.close(old, 408); await h.advance(1000);
  await old.config.auth.keys.set({ session: { stale: {} } });
  assert.equal(writes, 0);
  await h.sockets[1].config.auth.keys.set({ session: { current: {} } });
  assert.equal(writes, 1);
});
