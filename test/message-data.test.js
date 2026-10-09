const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serializeMessage, parseMessage, messageIds } = require('../message-data');

test('stored WhatsApp media can be quoted using the actual Baileys encoder', async () => {
  const { generateWAMessage } = require('@whiskeysockets/baileys');
  const original = {
    key: { remoteJid: '5511999990001@s.whatsapp.net', fromMe: false, id: 'original-wa-id' },
    message: { imageMessage: { caption: 'Imagem original', mimetype: 'image/jpeg', mediaKey: Uint8Array.from([1, 2, 3]), jpegThumbnail: Buffer.from([4, 5, 6]) } },
    messageTimestamp: 1700000000,
  };
  const quoted = parseMessage(serializeMessage(original));
  assert.ok(Buffer.isBuffer(quoted.message.imageMessage.mediaKey));
  assert.ok(Buffer.isBuffer(quoted.message.imageMessage.jpegThumbnail));
  const reply = await generateWAMessage('5511999990001@s.whatsapp.net', { text: 'Resposta à imagem' }, { userJid: '5511999990002@s.whatsapp.net', quoted });
  const context = reply.message.extendedTextMessage.contextInfo;
  assert.equal(context.stanzaId, original.key.id);
  assert.equal(context.participant, original.key.remoteJid);
  assert.equal(context.quotedMessage.imageMessage.caption, 'Imagem original');
});

test('message action batches reject malformed IDs and limit the number of messages', () => {
  assert.deepEqual(messageIds([1, '2', 1]), [1, 2]);
  for (const ids of [[], [0], [-1], ['wrong'], [1.5], [null], Array.from({ length: 31 }, (_, index) => index + 1)]) assert.throws(() => messageIds(ids), /mensagens válidas/);
});
