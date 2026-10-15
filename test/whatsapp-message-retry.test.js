const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMessageRetryStore } = require('../whatsapp-message-retry');
const { serializeMessage } = require('../message-data');

test('recent sends are available before insertion, with device and alternate JIDs', async () => {
  const retry = createMessageRetryStore({ db: { get: async () => { throw new Error('not inserted yet'); } }, store: {} });
  const message = { imageMessage: { mediaKey: Buffer.from([1, 2, 3]), caption: 'Foto' }, messageContextInfo: { messageSecret: Buffer.from([4, 5]) } };
  retry.remember({ key: { id: 'image', remoteJid: '123:4@lid', remoteJidAlt: '5511999999999@s.whatsapp.net' }, message });
  assert.deepEqual(await retry.getMessage({ id: 'image', remoteJid: '123:8@lid' }), message);
  assert.deepEqual(await retry.getMessage({ id: 'image', remoteJid: '5511999999999@s.whatsapp.net' }), message);
});

test('persistent retrieval resolves LID aliases and preserves media and cryptographic bytes', async () => {
  const message = { audioMessage: { mediaKey: Buffer.from([1, 2]), directPath: '/original-media' } };
  const queries = [];
  const retry = createMessageRetryStore({
    store: { resolveConversationNumber: async number => number === '123' ? '5511999999999' : number },
    db: { get: async (sql, params) => {
      queries.push({ sql, params });
      return params[0] === '5511999999999' && params[1] === 'audio' ? { whatsapp_payload: serializeMessage({ message }) } : undefined;
    } },
  });
  assert.deepEqual(await retry.getMessage({ remoteJid: '123@lid', id: 'audio' }), message);
  assert.deepEqual(queries[0].params, ['5511999999999', 'audio']);
  assert.equal(await retry.getMessage({ remoteJid: '5511888888888@s.whatsapp.net', id: 'audio' }), undefined, 'same ID in another chat must not expose content');
  assert.equal(await retry.getMessage({ remoteJid: '123@lid', id: 'missing' }), undefined);
  assert.equal(await retry.getMessage({ remoteJid: 'status@broadcast', id: 'audio' }), undefined);
  assert.equal(await retry.getMessage({ id: 'audio' }), undefined);
  assert.equal(queries.length, 3);
});

test('cache is bounded, expires, clears and falls back to persisted messages', async () => {
  let clock = 0;
  const retry = createMessageRetryStore({ maxEntries: 1, ttlMs: 10, now: () => clock,
    store: { resolveConversationNumber: async number => number },
    db: { get: async () => ({ whatsapp_payload: serializeMessage({ message: { conversation: 'Persistida' } }) }) },
  });
  const key = id => ({ remoteJid: '123@lid', id });
  retry.remember({ key: key('first'), message: { conversation: 'Primeira' } });
  retry.remember({ key: key('second'), message: { conversation: 'Segunda' } });
  assert.equal((await retry.getMessage(key('first'))).conversation, 'Persistida');
  assert.equal((await retry.getMessage(key('second'))).conversation, 'Segunda');
  clock = 11;
  assert.equal((await retry.getMessage(key('second'))).conversation, 'Persistida');
  retry.remember({ key: key('third'), message: { conversation: 'Terceira' } });
  retry.clear();
  assert.equal((await retry.getMessage(key('third'))).conversation, 'Persistida');
});
