const bot = require('./bot');
const store = require('./store');
const EventEmitter = require('events');

const db = require('./db');

// Erros soltos do Baileys/rede não podem matar o worker em silêncio.
// Rejeições são só registradas; exceções reais encerram o processo para o
// servidor subir um worker novo automaticamente (ver bot-manager.js).
process.on('unhandledRejection', (reason) => {
  console.error('[WORKER] unhandledRejection:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (error) => {
  console.error('[WORKER] uncaughtException:', error.stack || error);
  process.exit(1);
});

const emitter = new EventEmitter();
const pending = new Map();

function reply(id, result, error = null) {
  if (process.send) process.send({ type: 'response', id, result, error: error?.message || error });
}

async function handle(message) {
  const { id, action, payload = {} } = message;
  try {
    if (action === 'state') {
      reply(id, {
        conversations: await store.getAll(),
        activeTarget: bot.getActiveTarget(),
        status: bot.getStatus(),
        admin: bot.ADMIN_NUMBER,
      });
      return;
    }
    if (action === 'contacts') {
      reply(id, await store.getContacts());
      return;
    }
    if (action === 'reply') {
      const conversation = await bot.sendToClient(payload.number, payload.text, payload.displayName);
      bot.setActiveTarget(conversation.number);
      reply(id, { conversation, activeTarget: bot.getActiveTarget() });
      return;
    }
    if (action === 'reply-media') {
      const media = { ...payload.media, buffer: Buffer.from(payload.media.buffer, 'base64') };
      const conversation = await bot.sendMediaToClient(payload.number, media, payload.displayName);
      bot.setActiveTarget(conversation.number);
      reply(id, { conversation, activeTarget: bot.getActiveTarget() });
      return;
    }
    if (action === 'assume') {
      reply(id, { activeTarget: bot.setActiveTarget(payload.number || null) });
      return;
    }
    if (action === 'block') {
      const conversation = await store.setBlocked(payload.number, payload.blocked);
      reply(id, { conversation });
      return;
    }
    if (action === 'clear') {
      reply(id, { conversation: await store.clearConversation(payload.number) });
      return;
    }
    if (action === 'delete') {
      const blocked = await store.isBlocked(payload.number);
      await store.deleteConversation(payload.number);
      reply(id, { conversation: blocked ? await store.getConversation(payload.number) : null });
      return;
    }
    if (action === 'disconnect') {
      const ok = await bot.disconnectBot();
      reply(id, { ok, status: bot.getStatus() });
      return;
    }
    throw new Error(`Ação desconhecida: ${action}`);
  } catch (error) {
    reply(id, null, error);
  }
}

emitter.on('status', (status) => process.send?.({ type: 'event', event: 'status', payload: status }));
emitter.on('message', (conversation) => process.send?.({ type: 'event', event: 'message', payload: conversation }));
emitter.on('contact', (contact) => process.send?.({ type: 'event', event: 'contact', payload: contact }));
emitter.on('active-target', (target) => process.send?.({ type: 'event', event: 'active-target', payload: target }));
emitter.on('log', (line) => process.send?.({ type: 'event', event: 'log', payload: line }));

// Só atende pedidos depois que o banco estiver pronto. Antes, um F5 logo após subir
// o worker podia chegar antes das tabelas existirem e a tela ficava vazia.
process.on('message', (message) => {
  db.ready.then(
    () => handle(message),
    (error) => reply(message.id, null, error)
  );
});

db.ready.then(() => bot.startBotWithRetry(emitter)).catch((error) => {
  process.send?.({ type: 'event', event: 'error', payload: error.message });
  process.exitCode = 1;
});
