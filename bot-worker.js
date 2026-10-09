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

bot.setIdentityVerifier((number) => new Promise((resolve, reject) => {
  const id = `identity-${Date.now()}-${number}`;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error('Não foi possível confirmar a conta. Tente conectar novamente.'));
  }, 15000);
  pending.set(id, { resolve, reject, timer });
  process.send?.({ type: 'identity', id, number });
}));

function reply(id, result, error = null) {
  if (process.send) process.send({ type: 'response', id, result, error: error?.message || error });
}

async function handle(message) {
  const { id, action, payload = {} } = message;
  try {
    if (action === 'status') {
      reply(id, {
        status: bot.getStatus(),
        admin: bot.ADMIN_NUMBER,
      });
      return;
    }
    if (action === 'state') {
      reply(id, {
        conversations: await store.getAll(),
        activeTarget: bot.getActiveTarget(),
        status: bot.getStatus(),
        admin: bot.ADMIN_NUMBER,
      });
      return;
    }
    if (action === 'get-conversation') { reply(id, await store.getConversation(payload.number, false)); return; }
    if (action === 'forward-messages') { reply(id, { conversation: await bot.forwardMessages(payload.number, payload.targetNumber, payload.messageIds) }); return; }
    if (action === 'delete-messages') { reply(id, { conversation: { ...await bot.deleteMessages(payload.number, payload.messageIds, payload.forEveryone), mutation: 'delete' } }); return; }
    if (action === 'delete-contact') { reply(id, await store.removeSavedContact(payload.number)); return; }
    if (action === 'assign-conversation') { reply(id, { conversation: await store.assignConversation(payload.number, payload.userId) }); return; }
    if (action === 'contacts') {
      reply(id, await store.getContacts());
      return;
    }
    if (action === 'sync-contacts') {
      reply(id, await bot.syncContacts());
      return;
    }
    if (action === 'profile-picture') {
      reply(id, await bot.getProfilePicture(payload.number));
      return;
    }
    if (action === 'import-contacts') {
      reply(id, await store.importContacts(payload.contacts));
      return;
    }
    if (action === 'set-department') {
      reply(id, await store.setAllConversationsDepartment(payload.departmentId || null));
      return;
    }
    if (action === 'clear-department') {
      reply(id, await store.clearConversationsDepartment(payload.departmentId));
      return;
    }
    if (action === 'set-conversation-department') {
      reply(id, { conversation: await store.setConversationDepartment(payload.number, payload.departmentId || null) });
      return;
    }
    if (action === 'get-conversation-tags') {
      reply(id, { tags: await store.getConversationTags(payload.number) });
      return;
    }
    if (action === 'set-conversation-tags') {
      reply(id, { conversation: await store.setConversationTags(payload.number, payload.tags || []) });
      return;
    }
    if (action === 'finalize-conversation') {
      reply(id, { conversation: await store.finalizeConversation(payload.number) });
      return;
    }
    if (action === 'reopen-conversation') {
      reply(id, { conversation: await store.reopenConversation(payload.number) });
      return;
    }
    if (action === 'set-contact-tags') {
      reply(id, { contact: await store.updateContactTags(payload.number, payload.tags || []) });
      return;
    }
    if (action === 'set-contact-variables') {
      reply(id, { contact: await store.updateContactVariables(payload.number, payload.variables || {}) });
      return;
    }
    if (action === 'reply') {
      const conversation = await bot.sendToClient(payload.number, payload.text, payload.displayName, payload.replyTo);
      bot.setActiveTarget(conversation.number);
      reply(id, { conversation, activeTarget: bot.getActiveTarget() });
      return;
    }
    if (action === 'reply-media') {
      const media = { ...payload.media, buffer: Buffer.from(payload.media.buffer, 'base64') };
      const conversation = await bot.sendMediaToClient(payload.number, media, payload.displayName, payload.replyTo);
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
emitter.on('contacts:updated', (payload) => process.send?.({ type: 'event', event: 'contacts:updated', payload }));
emitter.on('profile:updated', (payload) => process.send?.({ type: 'event', event: 'profile:updated', payload }));
emitter.on('active-target', (target) => process.send?.({ type: 'event', event: 'active-target', payload: target }));
emitter.on('log', (line) => process.send?.({ type: 'event', event: 'log', payload: line }));

// Só atende pedidos depois que o banco estiver pronto. Antes, um F5 logo após subir
// o worker podia chegar antes das tabelas existirem e a tela ficava vazia.
process.on('message', (message) => {
  if (message.type === 'identity-result') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.number);
    return;
  }
  db.ready.then(
    () => handle(message),
    (error) => reply(message.id, null, error)
  );
});

db.ready.then(() => bot.startBotWithRetry(emitter)).catch((error) => {
  process.send?.({ type: 'event', event: 'error', payload: error.message });
  process.exitCode = 1;
});
