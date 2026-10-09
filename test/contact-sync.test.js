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
  const directory = new WhatsAppDirectory({
    socket: { ev: new EventEmitter(), resyncAppState: async () => {} }, store: {}, emit: () => {},
    authKeys: { set: async () => {}, get: async () => ({ critical_unblock_low: null }) },
  });
  await assert.rejects(directory.sync(), /não confirmou/);
  assert.equal(directory.syncState.verified, false);
});
