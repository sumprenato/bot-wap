const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const EventEmitter = require('node:events');
const { accountNumber, savedIdentity, bindIdentity } = require('../chip-identity');

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-identity-'));
process.env.STORAGE_DIR = storageDir;
process.env.CHIP_ID = '1';
process.env.ADMIN_NUMBER = '5511999991111'; // Legacy manual number intentionally differs.
delete process.env.EXPECTED_ACCOUNT_NUMBER;
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;

test('QR identity gates contacts/messages, persists the actual phone and refuses another account', async (t) => {
  const db = require('../db');
  const store = require('../store');
  await db.ready;
  const { lastID: chipId } = await db.run('INSERT INTO chips(name,number,user_id,is_primary,created_at) VALUES (?,NULL,?,1,?)', ['Canal', 1, new Date().toISOString()]);
  const sockets = [];
  const sent = [];
  const load = Module._load;
  Module._load = function (name, ...args) {
    if (name === '@whiskeysockets/baileys') return {
      default: (config) => {
        const handlers = {};
        const socket = { user: null, ev: { on: (event, callback) => { handlers[event] = callback; } }, handlers,
          ws: { close() {} }, logout: async () => { socket.loggedOut = true; }, resyncAppState: async () => {}, sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `sent-${sent.length}`, remoteJid: jid, fromMe: true }, message: content.text ? { conversation: content.text } : {}, status: 1 }; } };
        socket.config = config;
        sockets.push(socket); return socket;
      },
      useMultiFileAuthState: async () => ({ state: { creds: { myAppStateKeyId: 'test-key' }, keys: { set: async () => {}, get: async (type) => type === 'app-state-sync-key' ? { 'test-key': {} } : { critical_unblock_low: { version: 1 } } } }, saveCreds: async () => {} }),
      downloadMediaMessage: async () => Buffer.from('test phone media'),
      DisconnectReason: { loggedOut: 401, badSession: 500 },
    };
    return load.call(this, name, ...args);
  };
  let bot;
  try { bot = require('../bot'); } finally { Module._load = load; }
  t.after(async () => { await db.close(); fs.rmSync(storageDir, { recursive: true, force: true }); });
  let release;
  const confirmation = new Promise((resolve) => { release = resolve; });
  bot.setIdentityVerifier(async (number) => { await confirmation; return bindIdentity(db, chipId, number); });
  const emitter = new EventEmitter();
  await bot.startBot(emitter);
  const first = sockets[0];
  let finishContacts;
  first.resyncAppState = () => new Promise(resolve => { finishContacts = resolve; });
  first.user = { id: '5511999992222:17@s.whatsapp.net' };
  const opening = first.handlers['connection.update']({ connection: 'open' });
  const message = { key: { remoteJid: '5511988880000@s.whatsapp.net', fromMe: false }, message: { conversation: 'Olá' }, pushName: 'Contato' };
  const incoming = first.handlers['messages.upsert']({ messages: [message], type: 'notify' });
  first.handlers['contacts.upsert']([{ id: '5511988880001@s.whatsapp.net', name: 'Agenda' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bot.getStatus().connected, false);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM contacts')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n, 0);
  release();
  await opening; await incoming;
  const sentBeforeSync = sent.length;
  await assert.rejects(bot.sendToClient('5511988880001', 'Durante a carga'), /sincronização/);
  await assert.rejects(bot.sendMediaToClient('5511988880001', { type: 'document', buffer: Buffer.from('teste') }), /sincronização/);
  assert.equal(sent.length, sentBeforeSync);
  finishContacts();
  await bot.syncContacts();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bot.ADMIN_NUMBER, '5511999992222');
  assert.equal(bot.getStatus().number, '5511999992222');
  assert.equal(bot.getStatus().connected, true);
  assert.equal((await db.get('SELECT number FROM chips WHERE id = ?', [chipId])).number, '5511999992222');
  assert.equal(savedIdentity(storageDir), '5511999992222');
  assert.equal((await store.getConversation('5511988880000')).messages.length, 1);
  assert.ok((await store.getContacts()).some((contact) => contact.number === '5511988880001'));

  await db.run('INSERT INTO chips(name,number,user_id,is_primary,created_at) VALUES (?,NULL,?,1,?)', ['Outro usuário', 2, new Date().toISOString()]);
  await assert.rejects(() => bindIdentity(db, chipId + 1, '5511999992222'), /já está vinculado/);
  await assert.rejects(() => bindIdentity(db, chipId, '999@lid'), /telefone válido/);

  await bot.disconnectBot();
  const wrong = sockets.at(-1);
  wrong.user = { id: '5511999993333@s.whatsapp.net' };
  const deniedMessage = wrong.handlers['messages.upsert']({ messages: [{ ...message, message: { conversation: 'Conta errada' } }], type: 'notify' });
  wrong.handlers['contacts.upsert']([{ id: '5511988880002@s.whatsapp.net', name: 'Não importar' }]);
  await wrong.handlers['connection.update']({ connection: 'open' });
  await deniedMessage;
  assert.equal(wrong.loggedOut, true);
  assert.equal(bot.getStatus().connected, false);
  assert.match(bot.getStatus().error, /outro número/);
  assert.equal((await store.getConversation('5511988880000')).messages.length, 1);
  assert.equal((await store.getContacts()).some((contact) => contact.number === '5511988880002'), false);
  assert.equal(savedIdentity(storageDir), '5511999992222');

  const correct = sockets.at(-1);
  correct.user = { id: '5511999992222@s.whatsapp.net' };
  await correct.handlers['connection.update']({ connection: 'open' });
  assert.equal(bot.getStatus().connected, true);
  assert.equal(bot.getStatus().error, undefined);
  await first.handlers['messages.upsert']({ messages: [message], type: 'notify' });
  assert.equal((await store.getConversation('5511988880000')).messages.length, 1, 'stale sockets cannot import messages');
  assert.equal((await store.getConversation('5511988880000')).name, '', 'a profile name must not become a saved contact');
  assert.equal(await store.getContact('5511988880000'), null);
  const savedNumber = '5511988880001';
  await correct.handlers['messages.upsert']({ messages: [{
    key: { remoteJid: `${savedNumber}@s.whatsapp.net`, fromMe: true, id: 'outgoing-phone' },
    message: { conversation: 'Resposta pelo celular' }, pushName: 'Meu perfil',
  }], type: 'notify' });
  assert.equal((await store.getContact(savedNumber)).name, 'Agenda');
  assert.equal((await store.getConversation(savedNumber)).name, 'Agenda');
  await correct.handlers['messages.upsert']({ messages: [{
    key: { remoteJid: `${savedNumber}@s.whatsapp.net`, fromMe: false, id: 'incoming-phone' },
    message: { conversation: 'Resposta do contato' }, pushName: 'Perfil diferente da agenda',
  }], type: 'notify' });
  assert.equal((await store.getConversation(savedNumber)).name, 'Agenda');
  assert.equal((await store.getConversation(savedNumber)).messages.length, 2);
  const newPhone = '5511988880003', newLid = '123456789012349';
  const outgoingAppend = {
    key: { remoteJid: `${newLid}@lid`, remoteJidAlt: `${newPhone}@s.whatsapp.net`, senderPn: `${bot.ADMIN_NUMBER}@s.whatsapp.net`, fromMe: true, id: 'mobile-new-chat' },
    message: { conversation: 'Primeira mensagem enviada pelo celular' }, pushName: 'Meu perfil', status: 2,
  };
  await Promise.all([
    correct.handlers['messages.upsert']({ type: 'append', messages: [outgoingAppend] }),
    correct.handlers['messages.upsert']({ type: 'notify', messages: [outgoingAppend] }),
  ]);
  const mobileConversation = await store.getConversation(newPhone, false);
  assert.equal(mobileConversation.messages.length, 1, 'append/notify copies must not duplicate a phone send');
  assert.equal(mobileConversation.messages[0].from, 'admin');
  assert.equal(mobileConversation.phoneNumber, newPhone);
  assert.equal(mobileConversation.name, '', 'our own profile is not the recipient name');
  assert.ok((await store.getAll())[mobileConversation.number], 'a first mobile send starts a visible conversation');
  await correct.handlers['messages.upsert']({ type: 'append', messages: [{
    key: { remoteJid: `${newLid}@lid`, remoteJidAlt: `${newPhone}@s.whatsapp.net`, fromMe: true, id: 'mobile-image' },
    message: { imageMessage: { mimetype: 'image/png' } }, status: 3,
  }] });
  const phoneImage = (await store.getConversation(newPhone, false)).messages.at(-1);
  assert.equal(phoneImage.type, 'image');
  assert.match(phoneImage.mediaUrl, /^\/media\/chips\/1\//);
  assert.equal(phoneImage.deliveryStatus, 3);
  for (const [fromMe, isAnimated] of [[false, false], [false, true], [true, false], [true, true]]) {
    await correct.handlers['messages.upsert']({ type: fromMe ? 'append' : 'notify', messages: [{
      key: { remoteJid: `${newLid}@lid`, remoteJidAlt: `${newPhone}@s.whatsapp.net`, fromMe, id: `sticker-${fromMe}-${isAnimated}` },
      message: { stickerMessage: { isAnimated } }, status: 2,
    }] });
    const sticker = (await store.getConversation(newPhone, false)).messages.at(-1);
    assert.equal(sticker.from, fromMe ? 'admin' : 'client');
    assert.equal(sticker.type, isAnimated ? 'gif' : 'image');
    assert.equal(sticker.mimeType, 'image/webp', 'missing sticker MIME defaults to WebP');
    assert.match(sticker.mediaUrl, /\.webp$/);
    assert.equal(sticker.text, '', 'the sticker renders as media without a duplicate text label');
  }
  await correct.handlers['messages.upsert']({ type: 'append', messages: [{ key: { remoteJid: '5511988880004@s.whatsapp.net', fromMe: false }, message: { conversation: 'Histórico recebido' } }] });
  assert.equal(await store.getConversation('5511988880004', false), null, 'incoming historical append does not fill the active inbox');
  await correct.handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: '5511988880005@s.whatsapp.net', fromMe: true }, message: { protocolMessage: {} } }] });
  assert.equal(await store.getConversation('5511988880005', false), null, 'protocol updates must not create empty chats');
  await correct.handlers['chats.phoneNumberShare']({ lid: '123456789012350@lid', jid: '5511988880006@s.whatsapp.net' });
  assert.equal(await store.getConversation('5511988880006', false), null, 'sharing a contact phone must not start a chat');
  await bot.sendToClient(savedNumber, 'Sem assinatura', null);
  assert.equal(sent.at(-1).content.text, 'Sem assinatura');
  const lastSentId = `sent-${sent.length}`;
  assert.deepEqual(await correct.config.getMessage({ remoteJid: `${savedNumber}@s.whatsapp.net`, id: lastSentId }), { conversation: 'Sem assinatura' }, 'retry callback returns the actual sent payload');
  assert.equal(await first.config.getMessage({ remoteJid: `${savedNumber}@s.whatsapp.net`, id: lastSentId }), undefined, 'stale sockets cannot retrieve payloads');
  assert.equal((await store.getConversation(savedNumber)).messages.at(-1).deliveryStatus, 1);
  for (const [status, expected] of [[2, 2], [3, 3], [4, 4], [2, 4]]) {
    await correct.handlers['messages.update']([{ key: { id: lastSentId, fromMe: true, remoteJid: `${savedNumber}@s.whatsapp.net` }, update: { status } }]);
    assert.equal((await store.getConversation(savedNumber)).messages.at(-1).deliveryStatus, expected);
  }
  await correct.handlers['messages.update']([{ key: { id: lastSentId, fromMe: false }, update: { status: 5 } }]);
  assert.equal((await store.getAll())[savedNumber].messages.at(-1).deliveryStatus, 4);
  const beforeEcho = (await store.getConversation(savedNumber)).messages.length;
  await correct.handlers['messages.upsert']({ type: 'notify', messages: [{ key: { id: lastSentId, remoteJid: `${savedNumber}@s.whatsapp.net`, fromMe: true }, message: { conversation: 'Sem assinatura' }, status: 4 }] });
  assert.equal((await store.getConversation(savedNumber)).messages.length, beforeEcho);
  await bot.sendToClient(savedNumber, 'Com assinatura', 'Atendente');
  assert.equal(sent.at(-1).content.text, '*Atendente*: Com assinatura');
  const media = { type: 'image', buffer: Buffer.from('test'), mimeType: 'image/png', caption: 'Legenda', mediaUrl: '/test.png' };
  const nextId = `sent-${sent.length + 1}`;
  await correct.handlers['messages.update']([{ key: { id: nextId, fromMe: true }, update: { status: 4 } }]);
  await bot.sendMediaToClient(savedNumber, media, null);
  assert.equal(sent.at(-1).content.caption, 'Legenda');
  assert.equal((await store.getConversation(savedNumber)).messages.at(-1).deliveryStatus, 4, 'receipts arriving before the local insert survive');
  await bot.sendMediaToClient(savedNumber, media, 'Atendente');
  assert.equal(sent.at(-1).content.caption, '*Atendente*: Legenda');
  const source = (await store.getConversation(savedNumber)).messages.find(message => message.whatsappId === 'incoming-phone');
  assert.ok(source, 'incoming WhatsApp identifiers are persisted for real quoted replies');
  await bot.sendToClient(savedNumber, 'Resposta citada', null, source.id);
  assert.equal(sent.at(-1).options.quoted.key.id, 'incoming-phone');
  assert.equal((await store.getConversation(savedNumber)).messages.at(-1).replyTo.id, source.id);
  await bot.sendMediaToClient(savedNumber, media, null, source.id);
  assert.equal(sent.at(-1).options.quoted.key.id, 'incoming-phone');
  const beforeForeignQuote = sent.length;
  await assert.rejects(bot.sendToClient(newPhone, 'Referência de outra conversa', null, source.id), /não encontrada/);
  assert.equal(sent.length, beforeForeignQuote);
  await correct.handlers['messages.upsert']({ type: 'notify', messages: [{
    key: { remoteJid: `${savedNumber}@s.whatsapp.net`, fromMe: false, id: 'incoming-quoted' },
    message: { extendedTextMessage: { text: 'Cliente respondeu citando', contextInfo: { stanzaId: 'incoming-phone', participant: `${savedNumber}@s.whatsapp.net`, quotedMessage: { conversation: 'Resposta do contato' } } } },
  }] });
  assert.equal((await store.getConversation(savedNumber)).messages.at(-1).replyTo.id, source.id);
  const originals = (await store.getConversation(newPhone)).messages;
  const sticker = originals.find(message => message.type === 'gif' && message.from === 'admin');
  await bot.forwardMessages(newPhone, savedNumber, [originals[0].id, sticker.id]);
  assert.equal(sent.at(-2).content.text, originals[0].text);
  assert.equal(sent.at(-2).content.contextInfo.isForwarded, true);
  assert.ok(Buffer.isBuffer(sent.at(-1).content.sticker), 'animated stickers are forwarded as actual media bytes');
  assert.equal((await store.getConversation(savedNumber)).messages.at(-1).forwarded, true);
  const beforeInvalidForward = sent.length;
  await assert.rejects(bot.forwardMessages(newPhone, savedNumber, [originals[0].id, 999999]), /não encontrada/);
  assert.equal(sent.length, beforeInvalidForward, 'batch validation happens before any forwarding');
  await assert.rejects(bot.deleteMessages(newPhone, [originals[0].id + 1, 999999]), /não encontrada/);
  const receivedSticker = originals.find(message => message.from === 'client');
  await assert.rejects(bot.deleteMessages(newPhone, [receivedSticker.id], true), /Só é possível/);
  await bot.deleteMessages(newPhone, [sticker.id], true);
  assert.equal(sent.at(-1).content.delete.id, sticker.whatsappId);
  await assert.rejects(store.getStoredMessages(newPhone, [sticker.id]), /não encontrada/);
  const beforeLocalDelete = sent.length;
  await bot.deleteMessages(newPhone, [originals[0].id]);
  assert.equal(sent.length, beforeLocalDelete, 'local deletion does not send a WhatsApp revoke');
  const exposed = await store.getConversation(savedNumber);
  assert.equal(JSON.stringify(exposed).includes('whatsapp_payload'), false, 'raw WhatsApp contents stay inside the worker');
});

test('identity normalization uses a phone JID without the device suffix', () => {
  assert.equal(accountNumber('5511999992222:17@s.whatsapp.net'), '5511999992222');
  assert.equal(accountNumber('123456789999999@lid'), '');
  assert.equal(accountNumber('invalid@s.whatsapp.net'), '');
});
