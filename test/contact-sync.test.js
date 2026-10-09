const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WhatsAppDirectory } = require('../whatsapp-directory');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('manual sync flushes the installed Baileys buffer before verifying contacts and subsequent live messages', async () => {
  const { makeEventBuffer } = await import('@whiskeysockets/baileys');
  const ev = makeEventBuffer({ debug() {}, trace() {} });
  const saved = [], messages = [], verification = deferred();
  ev.on('messages.upsert', event => messages.push(...event.messages));
  const resyncAppState = ev.createBufferedFunction(async () => {
    ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Agenda' }]);
    ev.emit('messages.upsert', { messages: [{ key: { id: 'buffered', remoteJid: '551199990001@s.whatsapp.net' }, message: { conversation: 'Celular' } }], type: 'notify' });
  });
  const directory = new WhatsAppDirectory({ socket: { ev, resyncAppState },
    store: { saveContact: async contact => saved.push(contact), getContacts: () => verification.promise }, emit() {} });
  const sync = directory.sync();
  await tick();
  assert.equal(ev.isBuffering(), false, 'manual sync must release the real event buffer');
  assert.equal(saved.length, 1);
  assert.equal(directory.syncState.verified, false, 'persisted contacts must still be verified');
  assert.equal(messages.length, 1);
  verification.resolve(saved); await sync;
  ev.emit('messages.upsert', { messages: [{ key: { id: 'live', remoteJid: '551199990001@s.whatsapp.net' }, message: { conversation: 'Depois' } }], type: 'notify' });
  assert.equal(messages.length, 2, 'live messages cannot remain stuck after manual sync');
});

test('fresh pairing waits for keys and the automatic initial buffer before resetting the contact cursor', async () => {
  const ev = new EventEmitter();
  let ready = false, buffering = true, resets = 0, pulls = 0;
  ev.isBuffering = () => buffering;
  const directory = new WhatsAppDirectory({ socket: { ev, resyncAppState: async () => { pulls++; } },
    readyForSync: async () => ready, authKeys: { set: async () => { resets++; } }, store: {}, emit() {} });
  const sync = directory.sync(); await tick();
  assert.equal(resets, 0); assert.equal(pulls, 0);
  ready = true;
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(resets, 0, 'do not interfere with the automatic history sync');
  buffering = false;
  await sync;
  assert.equal(resets, 1); assert.equal(pulls, 1);
  assert.equal(directory.syncState.verified, true);
});

test('manual sync releases the real event buffer on failure and remains blocked until retry succeeds', async () => {
  const { makeEventBuffer } = await import('@whiskeysockets/baileys');
  const ev = makeEventBuffer({ debug() {}, trace() {} }); let fail = true;
  const directory = new WhatsAppDirectory({ socket: { ev,
    resyncAppState: ev.createBufferedFunction(async () => { if (fail) throw new Error('Network unavailable'); }) }, store: {}, emit() {} });
  await assert.rejects(directory.sync(), /Network unavailable/);
  assert.equal(ev.isBuffering(), false);
  assert.equal(directory.syncState.verified, false);
  fail = false; await directory.sync();
  assert.equal(directory.syncState.verified, true);
});

test('timed out key preparation cannot start a late snapshot or unlock the panel', async () => {
  let ready = false, pulls = 0, resets = 0;
  const directory = new WhatsAppDirectory({ socket: { ev: new EventEmitter(), resyncAppState: async () => { pulls++; } },
    readyForSync: async () => ready, authKeys: { set: async () => { resets++; } }, store: {}, emit() {}, syncTimeoutMs: 20 });
  await assert.rejects(directory.sync(), /demorou demais/);
  ready = true;
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(resets, 0); assert.equal(pulls, 0);
  assert.equal(directory.syncState.verified, false);
  assert.equal(directory.syncState.stage, 'error');
});

test('sync blocks until all streaming batches and database verification finish, then emits one refresh', async () => {
  const ev = new EventEmitter(), first = deferred(), second = deferred(), verify = deferred(), events = [], saved = [];
  let pulls = 0;
  const directory = new WhatsAppDirectory({
    socket: { ev, resyncAppState: async () => {
      pulls++;
      ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Primeiro' }]);
    } },
    store: { saveContact: async contact => {
      await (saved.length ? second.promise : first.promise);
      saved.push(contact);
    }, getContacts: async () => { await verify.promise; return saved; } },
    emit: (name, payload) => events.push([name, payload]),
  });
  const sync = directory.sync(), duplicate = directory.sync();
  await tick();
  assert.equal(directory.syncState.verified, false);
  assert.equal(directory.syncState.syncing, true);
  ev.emit('contacts.upsert', [{ id: '551199990002@s.whatsapp.net', name: 'Segundo' }]);
  first.resolve(); await tick();
  assert.equal(saved.length, 1);
  assert.equal(directory.syncState.verified, false);
  second.resolve(); await tick();
  assert.equal(saved.length, 2);
  assert.equal(directory.syncState.verified, false, 'database verification must finish too');
  verify.resolve();
  await Promise.all([sync, duplicate]);
  assert.equal(pulls, 1);
  assert.equal(directory.syncState.verified, true);
  assert.equal(events.filter(([name]) => name === 'contact').length, 0);
  assert.equal(events.filter(([name]) => name === 'contacts:updated').length, 1);
  await directory.sync();
  assert.equal(pulls, 1, 'reading within the cooldown does not resync');
});

test('failed imports stay blocked and a retry verifies a fresh snapshot', async () => {
  let fail = true;
  const ev = new EventEmitter();
  const directory = new WhatsAppDirectory({
    socket: { ev, resyncAppState: async () => ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Agenda' }]) },
    store: { saveContact: async () => { if (fail) throw new Error('Database unavailable'); } },
    emit: () => {},
  });
  await assert.rejects(directory.sync(), /Database unavailable/);
  assert.equal(directory.syncState.verified, false);
  assert.equal(directory.syncState.stage, 'error');
  fail = false;
  await directory.sync();
  assert.equal(directory.syncState.verified, true);
});

test('timeout covers saving and late completion cannot unlock the panel', async () => {
  const ev = new EventEmitter(), save = deferred();
  const directory = new WhatsAppDirectory({
    socket: { ev, resyncAppState: async () => ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Agenda' }]) },
    store: { saveContact: () => save.promise }, emit: () => {}, syncTimeoutMs: 20,
  });
  await assert.rejects(directory.sync(), /demorou demais/);
  save.resolve(); await tick();
  assert.equal(directory.syncState.verified, false);
  assert.equal(directory.syncState.stage, 'error');
});

test('disconnect during import never marks contacts ready', async () => {
  const ev = new EventEmitter(), save = deferred(); let connected = true;
  const directory = new WhatsAppDirectory({
    socket: { ev, resyncAppState: async () => ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Agenda' }]) },
    store: { saveContact: () => save.promise }, emit: () => {}, connected: () => connected,
  });
  const sync = directory.sync(); await tick(); connected = false; save.resolve();
  await assert.rejects(sync, /desconectado/);
  assert.equal(directory.syncState.verified, false);
});

test('ordinary incoming profile notifications do not start a blocking import', async () => {
  const ev = new EventEmitter(), events = [];
  const directory = new WhatsAppDirectory({ socket: { ev, resyncAppState: async () => {} }, store: {}, emit: (...event) => events.push(event) });
  await directory.sync(); events.length = 0;
  ev.emit('contacts.update', [{ id: '551199990001@s.whatsapp.net', notify: 'Perfil', verifiedName: 'Empresa' }]);
  await directory.queue;
  assert.equal(directory.syncState.verified, true);
  assert.deepEqual(events, []);
});

test('Baileys silently failing to confirm its snapshot cannot unlock the panel', async () => {
  let pulls = 0;
  const directory = new WhatsAppDirectory({
    socket: { ev: new EventEmitter(), resyncAppState: async () => { pulls++; } }, store: {}, emit: () => {}, retryDelayMs: 1,
    authKeys: { set: async () => {}, get: async () => ({ critical_unblock_low: null }) },
  });
  await assert.rejects(directory.sync(), /não confirmou/);
  assert.equal(pulls, 3, 'unconfirmed responses get bounded retries');
  assert.equal(directory.syncState.verified, false);
});

test('late agenda keys can confirm a second pull without unlocking before database verification', async () => {
  const ev = new EventEmitter(), saved = [], verify = deferred(); let pulls = 0;
  const directory = new WhatsAppDirectory({ socket: { ev, resyncAppState: async () => {
    if (++pulls === 2) ev.emit('contacts.upsert', [{ id: '551199990001@s.whatsapp.net', name: 'Agenda' }]);
  } }, store: { saveContact: async contact => saved.push(contact), getContacts: () => verify.promise }, emit() {}, retryDelayMs: 1,
    authKeys: { set: async () => {}, get: async () => ({ critical_unblock_low: pulls === 2 ? { version: 1 } : null }) } });
  const sync = directory.sync();
  while (pulls < 2) await new Promise(resolve => setTimeout(resolve, 1));
  await tick();
  assert.equal(saved.length, 1);
  assert.equal(directory.syncState.verified, false);
  verify.resolve(saved); await sync;
  assert.equal(directory.syncState.verified, true); assert.equal(pulls, 2);
});

test('hidden decoding failures keep the panel blocked even with a previously confirmed cursor', async () => {
  const { createContactSyncLog } = require('../whatsapp-sync-log');
  const lines = [], syncLog = createContactSyncLog('6', line => lines.push(line)); let pulls = 0;
  const directory = new WhatsAppDirectory({ socket: { ev: new EventEmitter(), resyncAppState: async () => {
    pulls++;
    syncLog.logger.info({ name: 'critical_unblock_low', error: 'Error: failed to find key "secret-key" to decode mutation\nprivate stack' }, 'failed to sync state from version');
  } }, store: {}, emit() {}, syncLog, retryDelayMs: 1,
    authKeys: { set: async () => {}, get: async () => ({ critical_unblock_low: { version: 1 } }) } });
  await assert.rejects(directory.sync(), /chaves da agenda/);
  assert.equal(pulls, 3); assert.equal(directory.syncState.verified, false);
  assert.match(directory.syncState.error, /chaves da agenda/);
  assert.equal(lines.some(line => /secret-key|private stack/.test(line)), false);
});

test('sync diagnostics omit message bodies, device keys and unrelated library logs', () => {
  const { createContactSyncLog } = require('../whatsapp-sync-log');
  const lines = [], log = createContactSyncLog('3', line => lines.push(line));
  log.logger.info({ name: 'critical_unblock_low', error: 'failed to verify LTHash', message: 'private body', keys: ['private-key'] }, 'failed to sync state from version');
  log.logger.warn({ error: 'unrelated', message: 'private body' }, 'unrelated socket log');
  assert.equal(lines.length, 1); assert.match(log.getFailure(), /integridade/);
  assert.equal(lines.some(line => /private|LTHash/.test(line)), false);
  log.reset(); assert.equal(log.getFailure(), '');
});
