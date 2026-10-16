const bot = require('./bot');
const store = require('./store');
const EventEmitter = require('events');

const db = require('./db');
const { installWorkerLifecycle } = require('./worker-lifecycle');

// Erros soltos do Baileys/rede não podem matar o worker em silêncio.
// Rejeições são só registradas; exceções reais encerram o processo para o
// servidor subir um worker novo automaticamente (ver bot-manager.js).
process.on('unhandledRejection', (reason) => {
  console.error('[WORKER] unhandledRejection:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (error) => {
  console.error('[WORKER] uncaughtException:', error.stack || error);
  lifecycle.shutdown(1);
});

const emitter = new EventEmitter();
const pending = new Map();
const lifecycle = installWorkerLifecycle({ stop: async () => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('O serviço do WhatsApp está encerrando.')); }
  pending.clear();
  await bot.stopBot();
}, close: () => db.close() });

function send(message) {
  if (process.connected) process.send(message, () => {});
}

bot.setIdentityVerifier((number) => new Promise((resolve, reject) => {
  const id = `identity-${Date.now()}-${number}`;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error('Não foi possível confirmar a conta. Tente conectar novamente.'));
  }, 15000);
  pending.set(id, { resolve, reject, timer });
  send({ type: 'identity', id, number });
}));

function reply(id, result, error = null) {
  send({ type: 'response', id, result, error: error?.message || error, errorCode: error?.code, deliveryAttempted: error?.deliveryAttempted });
}

async function assertFlowSend(number, runId) {
  const {conversationStopReason, stopped} = require('./flows/control');
  const conversation = await store.getConversation(number,false,{metadataOnly:true});
  const reason = conversationStopReason({conversation});
  if (reason) throw stopped(reason);
  if (!runId) throw stopped('Envio automático sem execução autorizada.');
  await new Promise((resolve,reject) => {
    const id = `flow-${require('node:crypto').randomUUID()}`;
    const timer = setTimeout(() => {pending.delete(id);reject(stopped('Não foi possível confirmar se o fluxo continua ativo.'));},10000);
    pending.set(id,{resolve,reject,timer});
    send({type:'flow-authorize',id,runId,number:conversation?.number || number});
  });
  const current = await store.getConversation(number,false,{metadataOnly:true});
  const changed = conversationStopReason({conversation:current});
  if (changed) throw stopped(changed);
}

async function updateFlowTags(number,tags,write) {
  const {result,event}=await db.transaction(async()=>{
    const contact=await db.get('SELECT tags FROM contacts WHERE number = ?',[number]);
    let contactTags=[];try{contactTags=JSON.parse(contact?.tags||'[]');}catch{}
    const previous=[...contactTags,...await store.getConversationTags(number)];
    const result=await write();
    const added=tags.filter(tag=>!previous.includes(tag));
    let event;
    if(added.length){event={id:`tag:${require('node:crypto').randomUUID()}`,type:'tagAdded',number,tags:added};await db.run('INSERT INTO flow_outbox(id,payload,created_at) VALUES (?,?,?)',[event.id,JSON.stringify(event),new Date().toISOString()]);}
    return {result,event};
  });
  if(event)emitter.emit('flow:incoming',event);
  return result;
}

async function handle(message) {
  const { id, action, payload = {} } = message;
  try {
    if (action === 'flow-event-ack') { await db.run('DELETE FROM flow_outbox WHERE id = ?', [payload.eventId]); reply(id, { ok: true }); return; }
    if (action === 'flow-context') {
      const conversation = await store.getConversation(payload.number, false, { metadataOnly: true });
      const row = await db.get('SELECT * FROM contacts WHERE number = ?', [conversation?.number || payload.number]);
      const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
      const readiness = bot.sendReadiness();
      reply(id, { number: conversation?.number || payload.number, name: row?.name || conversation?.name || '', tags: [...new Set([...parse(row?.tags, []), ...(conversation?.tags || [])])], variables: parse(row?.variables, {}), blocked: conversation?.blocked || false, connected: !!bot.getStatus().connected, readyToSend: readiness.ready, readinessReason: readiness.reason, conversation }); return;
    }
    if (action === 'flow-stop-conversation') { reply(id, {conversation: await store.stopConversationFlow(payload.number)}); return; }
    if (action === 'flow-send') { reply(id, { conversation: await bot.sendToClient(payload.number, payload.text, null, undefined, () => assertFlowSend(payload.number,payload.runId)) }); return; }
    if (action === 'flow-send-media') { reply(id, { conversation: await bot.sendMediaToClient(payload.number, { ...payload.media, buffer: Buffer.from(payload.media.buffer, 'base64') }, null, undefined, () => assertFlowSend(payload.number,payload.runId)) }); return; }
    if (action === 'status') {
      reply(id, {
        status: bot.getStatus(),
        admin: bot.ADMIN_NUMBER,
      });
      return;
    }
    if (action === 'state') {
      reply(id, {
        conversations: await store.getAll({ metadataOnly: payload.metadataOnly === true }),
        activeTarget: bot.getActiveTarget(),
        status: bot.getStatus(),
        admin: bot.ADMIN_NUMBER,
      });
      return;
    }
    if (action === 'get-conversation') { reply(id, await store.getConversation(payload.number, false, { metadataOnly: payload.metadataOnly === true })); return; }
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
      const tags = payload.tags || [];
      const conversation = await updateFlowTags(payload.number,tags,()=>store.setConversationTags(payload.number,tags));
      reply(id, { conversation });
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
      reply(id, { contact: await updateFlowTags(payload.number,payload.tags||[],()=>store.updateContactTags(payload.number,payload.tags||[])) });
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

emitter.on('status', (status) => send({ type: 'event', event: 'status', payload: status }));
emitter.on('message', (conversation) => send({ type: 'event', event: 'message', payload: conversation }));
emitter.on('flow:incoming', (payload) => send({ type: 'event', event: 'flow:incoming', payload }));
const flowReplay = setInterval(() => db.ready.then(async () => {
  if (lifecycle.stopping) { clearInterval(flowReplay); return; }
  const rows = await db.all('SELECT payload FROM flow_outbox ORDER BY created_at LIMIT 100');
  for (const row of rows) emitter.emit('flow:incoming', JSON.parse(row.payload));
}).catch(error => console.warn('[FLOW OUTBOX]', error.message)), 5000);
flowReplay.unref();
emitter.on('contact', (contact) => send({ type: 'event', event: 'contact', payload: contact }));
emitter.on('contacts:updated', (payload) => send({ type: 'event', event: 'contacts:updated', payload }));
emitter.on('profile:updated', (payload) => send({ type: 'event', event: 'profile:updated', payload }));
emitter.on('active-target', (target) => send({ type: 'event', event: 'active-target', payload: target }));
emitter.on('log', (line) => send({ type: 'event', event: 'log', payload: line }));

// Só atende pedidos depois que o banco estiver pronto. Antes, um F5 logo após subir
// o worker podia chegar antes das tabelas existirem e a tela ficava vazia.
process.on('message', (message) => {
  if (message.type === 'shutdown') { lifecycle.shutdown(); return; }
  if (lifecycle.stopping) return;
  if (message.type === 'identity-result' || message.type === 'flow-authorize-result') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error), { code: message.code, deliveryAttempted: message.type === 'flow-authorize-result' ? false : undefined }));
    else request.resolve(message.number);
    return;
  }
  db.ready.then(
    () => { if (!lifecycle.stopping) return handle(message); },
    (error) => reply(message.id, null, error)
  );
});

db.ready.then(() => { if (!lifecycle.stopping) return bot.startBotWithRetry(emitter); }).catch((error) => {
  send({ type: 'event', event: 'error', payload: error.message });
  lifecycle.shutdown(1);
});
