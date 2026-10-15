require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('./store');
const db = require('./db');
const { WhatsAppDirectory } = require('./whatsapp-directory');
const { createContactSyncLog } = require('./whatsapp-sync-log');
const { accountNumber, savedIdentity, identityError } = require('./chip-identity');
const { disconnectInfo, createConnectionLog } = require('./whatsapp-connection');
const { createMessageRetryStore } = require('./whatsapp-message-retry');
const { HISTORY_DAYS, messageTime, recentMessages } = require('./whatsapp-history');
const messageRetryStore = createMessageRetryStore({ db, store });

const STORAGE_DIR = require('./storage-path').resolveStorageDir();
let ADMIN_NUMBER = (process.env.ADMIN_NUMBER || '').replace(/\D/g, '');
const CHIP_ID = process.env.CHIP_ID || '';
const DEPARTMENT_ID = process.env.DEPARTMENT_ID || '';
const AUTH_DIR = path.join(STORAGE_DIR, 'auth_info');
const STATE_FILE = path.join(STORAGE_DIR, 'session-state.json');
const MEDIA_DIR = path.join(STORAGE_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });
const connectionLog = createConnectionLog(STORAGE_DIR, CHIP_ID);

let expectedAccount = process.env.EXPECTED_ACCOUNT_NUMBER || savedIdentity(STORAGE_DIR);
let verifyIdentity = async (number) => number;
function setIdentityVerifier(verifier) { verifyIdentity = verifier; }

// ---------- Estado (qual numero esta "assumido" agora) ----------
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      return { activeTarget: null };
    }
  }
  return { activeTarget: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();
let sockRef = null;
let emitterRef = null;
let status = { connected: false, qr: null, admin: ADMIN_NUMBER };
let botStartPromise = null;
let manualDisconnect = false;
let socketGeneration = 0;
let disconnectPromise = null;
let directoryRef = null;
let cancelIdentity = () => {};
let socketClosed = true;
let connectedAt = null;
const authWrites = new Set();
let credentialSaveQueue = Promise.resolve();
let messageQueue = Promise.resolve();

function trackAuthWrite(promise) {
  const write = Promise.resolve(promise);
  authWrites.add(write);
  write.then(() => authWrites.delete(write), () => authWrites.delete(write));
  return write;
}

async function flushAuthWrites() {
  while (authWrites.size) await Promise.allSettled([...authWrites]);
}

function closeTransport(socket) {
  if (!socket) return;
  try {
    // end() clears Baileys' keepalive/QR timers without revoking the linked device.
    if (typeof socket.end === 'function') socket.end(new Error('Local transport closed.'));
    else socket.ws?.close();
  } catch { connectionLog('transport.close_failed'); }
}

// Mapa de numero (ou LID) -> remoteJid real (para responder corretamente)
const jidMap = {};

// ---------- Helpers ----------
function toJid(number) {
  const clean = number.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

function fromJid(jid) {
  return (jid || '').split('@')[0];
}

// Resolve o JID correto via WhatsApp antes de enviar
async function resolveJid(sock, number) {
  const clean = number.replace(/\D/g, '');
  const variants = [clean];
  if (clean.startsWith('55') && clean.length === 12) {
    // Numero BR sem o 9 extra -> tenta com o 9
    variants.push(clean.slice(0, 4) + '9' + clean.slice(4));
  } else if (clean.startsWith('55') && clean.length === 13 && clean[4] === '9') {
    // Conta antiga registrada sem o 9 -> tenta sem o 9
    variants.push(clean.slice(0, 4) + clean.slice(5));
  }

  let lookupWorked = false;
  for (const variant of variants) {
    try {
      const [result] = (await sock.onWhatsApp(variant)) || [];
      lookupWorked = true;
      if (result && result.exists) {
        console.log(`[JID] ${clean} → ${result.jid}${variant !== clean ? ` (via ${variant})` : ''}`);
        return result.jid;
      }
    } catch (err) {
      console.warn(`[JID] onWhatsApp falhou para ${variant}:`, err.message);
    }
  }

  // A consulta funcionou e o numero realmente nao esta no WhatsApp: avisa em vez de
  // "enviar" para um JID inexistente e deixar a mensagem sumir em silencio.
  if (lookupWorked) {
    throw new Error('Esse número não foi encontrado no WhatsApp. Confira o DDI/DDD.');
  }
  // Consulta indisponivel (ex.: instabilidade): usa o formato padrao
  return toJid(clean);
}

// Desembrulha as camadas (efemera, visualizacao unica, documento com legenda...)
function unwrapMessage(msg) {
  let message = msg.message;
  for (let i = 0; i < 6 && message; i += 1) {
    const inner = message.ephemeralMessage?.message
      || message.viewOnceMessage?.message
      || message.viewOnceMessageV2?.message
      || message.viewOnceMessageV2Extension?.message
      || message.documentWithCaptionMessage?.message
      || message.deviceSentMessage?.message;
    if (!inner) break;
    message = inner;
  }
  return message || {};
}

function extractText(msg) {
  const message = unwrapMessage(msg);
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    (message.locationMessage ? '📍 Localização compartilhada' : '') ||
    (message.contactMessage ? `👤 Contato: ${message.contactMessage.displayName || ''}`.trim() : '') ||
    ''
  );
}

function getMediaInfo(msg) {
  const message = unwrapMessage(msg);
  if (message.imageMessage) return { type: 'image', content: message.imageMessage };
  if (message.videoMessage) return { type: 'video', content: message.videoMessage };
  if (message.audioMessage) return { type: 'audio', content: message.audioMessage };
  if (message.documentMessage) return { type: 'document', content: message.documentMessage };
  if (message.stickerMessage) return {
    type: message.stickerMessage.isAnimated ? 'gif' : 'image',
    content: message.stickerMessage,
    sticker: true,
  };
  return null;
}

function extensionFor(type, mimeType = '') {
  const mimeExtension = mimeType.split('/')[1]?.split(';')[0];
  if (mimeExtension && /^[a-z0-9]+$/i.test(mimeExtension)) return mimeExtension;
  return { image: 'jpg', video: 'mp4', audio: 'ogg', document: 'bin' }[type] || 'bin';
}

async function saveIncomingMedia(msg, mediaInfo, downloadOptions = {}) {
  const buffer = await downloadMediaMessage(msg, 'buffer', downloadOptions, {
    logger: pino({ level: 'silent' }),
  });
  // WhatsApp stickers are WebP. Browsers display animated WebP directly,
  // preserving animation and transparency without a lossy GIF conversion.
  const mimeType = mediaInfo.sticker ? 'image/webp' : mediaInfo.content.mimetype || 'application/octet-stream';
  const fileName = `${crypto.randomUUID()}.${extensionFor(mediaInfo.type, mimeType)}`;
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), buffer);
  return {
    type: mediaInfo.type,
    mediaUrl: CHIP_ID ? `/media/chips/${encodeURIComponent(CHIP_ID)}/${encodeURIComponent(fileName)}` : `/media/${encodeURIComponent(fileName)}`,
    mimeType,
    fileName: mediaInfo.content.fileName || fileName,
  };
}

// ---------- Bot ----------
let reconnectAttempts = 0;
let reconnectTimer = null;

// Reconecta com espera crescente (1s, 2s, 4s... ate 30s) e continua tentando
// mesmo que uma tentativa falhe — antes uma unica falha deixava o bot parado
// ate alguem dar F5/disconnect.
function scheduleReconnect(emitter) {
  if (manualDisconnect || reconnectTimer !== null) return;
  const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts, 5), 30000);
  reconnectAttempts += 1;
  status.reconnecting = true;
  status.retryInMs = delay;
  connectionLog('reconnect.scheduled', { attempt: reconnectAttempts, retryInMs: delay });
  emitter.emit('status', { ...status });
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (manualDisconnect) return;
    try {
      await startBot(emitter);
    } catch (err) {
      console.error('[BOT] Falha ao reconectar:', err.message);
      scheduleReconnect(emitter);
    }
  }, delay);
}

// Sessao invalidada (deslogou pelo celular, credenciais corrompidas...): apaga as
// credenciais e ja sobe um socket novo para gerar o QR sozinho, sem precisar de
// "disconnect" manual.
async function resetSessionAndRestart(emitter) {
  cancelIdentity(false);
  messageRetryStore.clear();
  socketGeneration += 1;
  socketClosed = true;
  const socket = sockRef;
  sockRef = null;
  closeTransport(socket);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  await flushAuthWrites();
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  Object.keys(jidMap).forEach((key) => delete jidMap[key]);
  status = { connected: false, qr: null, admin: ADMIN_NUMBER };
  emitter.emit('status', status);
  try {
    await startBot(emitter);
  } catch (err) {
    console.error('[BOT] Falha ao gerar novo QR:', err.message);
    scheduleReconnect(emitter);
  }
}

async function handleIncomingMessage(sock, msg, emitter) {
  if (!msg.message) return;

  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) return;

  const remoteNumber = fromJid(remoteJid);
  // Ignora mensagens enviadas pelo bot para o próprio admin (eco da web/painel)
  if (msg.key.fromMe && remoteNumber === ADMIN_NUMBER) return;

  // Quando o contato chega como @lid, o telefone real pode vir em senderPn/remoteJidAlt
  // For outgoing messages senderPn describes our own phone, not the recipient.
  const altJid = msg.key.fromMe ? msg.key.remoteJidAlt || '' : msg.key.remoteJidAlt || msg.key.senderPn || msg.key.participantPn || '';
  const senderJid = altJid.endsWith('@s.whatsapp.net') ? altJid : remoteJid;
  const senderNumber = fromJid(senderJid);
  const phoneNumber = senderJid.endsWith('@s.whatsapp.net') ? senderNumber : '';
  const isFromAdmin = phoneNumber === ADMIN_NUMBER || remoteNumber === ADMIN_NUMBER;
  const text = extractText(msg).trim();
  const mediaInfo = getMediaInfo(msg);
  // Receipts, reactions and protocol updates must not start an empty conversation.
  if (!text && !mediaInfo) return;
  if (!isFromAdmin && (await store.isBlocked(remoteNumber) || (phoneNumber && await store.isBlocked(phoneNumber)))) {
    console.log(`[BLOCK] Ignorando mensagem de contato bloqueado: ${phoneNumber || remoteNumber}.`);
    return;
  }
  const conversationNumber = await store.registerConversationAliases(remoteNumber, phoneNumber);
  const savedContact = await store.saveContact({ number: phoneNumber || remoteNumber, jid: remoteJid });
  const contactName = savedContact?.name || '';
  if (savedContact) emitter.emit('contact', savedContact);

  if (DEPARTMENT_ID) await store.setDefaultConversationDepartment(conversationNumber, DEPARTMENT_ID);

  jidMap[conversationNumber] = remoteJid;
  jidMap[remoteNumber] = remoteJid;
  if (phoneNumber) jidMap[phoneNumber] = remoteJid;
  console.log(`[MSG] de=${conversationNumber} telefone=${phoneNumber || 'indisponivel'} jid=${remoteJid} nome=${contactName || 'sem-nome'}`);

  console.log(`[MSG] isAdmin=${isFromAdmin} texto="${text.slice(0, 40)}"`);

  if (isFromAdmin) {
    await handleAdminMessage(sock, text, emitter);
    return;
  }
  const current = await store.getConversation(conversationNumber, true, { metadataOnly: true });
  if (current.blocked) {
    console.log(`[BLOCK] Ignorando mensagem de ${conversationNumber} porque a conversa está bloqueada.`);
    return;
  }

  // Mensagem enviada PELO bot para um cliente (do celular do admin, não do painel)
  if (msg.key.fromMe) {
    const text = extractText(msg).trim();
    const mediaInfo = getMediaInfo(msg);
    if (!text && !mediaInfo) return;

    let media = {};
    if (mediaInfo) {
      try {
        media = await saveIncomingMedia(msg, mediaInfo);
      } catch (err) {
        console.error(`[MEDIA] Falha ao baixar mídia enviada:`, err.message);
      }
    }
    // Deduplica: verifica se já existe mensagem com esse ID no banco
    const msgId = msg.key.id || '';
    if (msgId) {
      const existing = await db.get('SELECT id FROM messages WHERE whatsapp_msg_id = ?', [msgId]).catch(() => null);
      if (existing) {
        if (Number.isInteger(msg.status)) {
          const updated = await store.updateMessageStatus(msgId, msg.status);
          if (updated) emitter.emit('message', updated);
        }
        return;
      }
    }
    const conversation = await store.addMessage(conversationNumber, 'admin', text || (mediaInfo?.sticker && !media.type ? '[Figurinha indisponível]' : ''), '', media, msgId, msg.status ?? 2, { ...await incomingDetails(msg, conversationNumber), delta: true });
    emitter.emit('message', conversation);
    return;
  }

  await forwardToAdmin(conversationNumber, text, emitter, contactName, msg, mediaInfo);
}

// Archive imports never execute admin commands, change the active conversation,
// mark messages read or send anything to the phone/customer.
async function saveHistoricalMessage(msg, canSave) {
  const remoteJid = msg.key.remoteJid;
  const remoteNumber = fromJid(remoteJid);
  const altJid = msg.key.fromMe ? msg.key.remoteJidAlt || '' : msg.key.remoteJidAlt || msg.key.senderPn || '';
  const phoneNumber = altJid.endsWith('@s.whatsapp.net') ? fromJid(altJid) : remoteJid.endsWith('@s.whatsapp.net') ? remoteNumber : '';
  if (phoneNumber === ADMIN_NUMBER || remoteNumber === ADMIN_NUMBER) return null;
  const text = extractText(msg).trim(), info = getMediaInfo(msg);
  if ((!text && !info) || !canSave()) return null;
  const number = await store.registerConversationAliases(remoteNumber, phoneNumber);
  if (await db.get('SELECT id FROM messages WHERE number = ? AND whatsapp_msg_id = ?', [number, msg.key.id])) return null;
  const contact = await store.saveContact({ number: phoneNumber || remoteNumber, jid: remoteJid, preserveActivity: true });
  let media = {};
  if (info) {
    // Keep the record even when WhatsApp no longer offers the historical media.
    media = { type: info.type, mimeType: info.content.mimetype || '', fileName: info.content.fileName || '', mediaUrl: '' };
    try {
      media = await saveIncomingMedia(msg, info, { options: { timeout: 10000, signal: AbortSignal.timeout(10000) } });
    } catch { /* The raw WhatsApp payload and attachment metadata remain stored. */ }
  }
  if (!canSave()) return null;
  if (DEPARTMENT_ID) await store.setDefaultConversationDepartment(number, DEPARTMENT_ID);
  jidMap[number] = remoteJid;
  jidMap[remoteNumber] = remoteJid;
  if (phoneNumber) jidMap[phoneNumber] = remoteJid;
  const details = { ...await incomingDetails(msg, number), at: new Date(messageTime(msg)).toISOString(), deferConversation: true };
  await store.addMessage(number, msg.key.fromMe ? 'admin' : 'client', text || (info && !media.mediaUrl ? '[Anexo indisponível no histórico]' : ''), contact?.name || '', media, msg.key.id, undefined, details);
  return number;
}

async function startBot(emitter) {
  if (botStartPromise) {
    return botStartPromise;
  }
  if (sockRef && !socketClosed) return sockRef;
  manualDisconnect = false;

  emitterRef = emitter;
  cancelIdentity(false);
  const generation = ++socketGeneration;
  const starting = (async () => {
    await flushAuthWrites();
    if (generation !== socketGeneration || manualDisconnect) return null;
    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    if (generation !== socketGeneration || manualDisconnect) return null;
    const saveKeys = authState.keys.set.bind(authState.keys);
    authState.keys.set = data => generation !== socketGeneration || manualDisconnect
      ? Promise.resolve()
      : trackAuthWrite(Promise.resolve().then(() => saveKeys(data)));
    status.connected = false;
    let acceptIdentity;
    const identityReady = new Promise((resolve) => { acceptIdentity = resolve; });
    let historyAnchor;
    const canSaveHistory = () => generation === socketGeneration && !manualDisconnect && status.connected;
    const enqueueHistory = (messages, progress) => {
      messageQueue = messageQueue.then(async () => {
        if (!(await identityReady) || !canSaveHistory()) return;
        const selected = recentMessages(messages, historyAnchor, Date.now());
        if (!selected.length) return;
        const previous = status.historySync || {};
        status.historySync = { days: HISTORY_DAYS, importing: true, imported: previous.imported || 0, failed: previous.failed || 0, progress: Number.isFinite(progress) ? progress : null };
        emitter.emit('status', { ...status });
        const changed = new Set();
        for (const msg of selected) {
          if (!canSaveHistory()) break;
          try {
            const number = await saveHistoricalMessage(msg, canSaveHistory);
            if (number) { changed.add(number); status.historySync.imported++; }
          } catch {
            status.historySync.failed++;
          }
          // Yield during large imports so IPC, requests and connection timers keep running.
          await new Promise(resolve => setImmediate(resolve));
        }
        if (!canSaveHistory()) return;
        for (const number of changed) {
          const conversation = await store.getConversation(number, false);
          if (!canSaveHistory()) return;
          if (conversation) emitter.emit('message', conversation);
        }
        status.historySync = { ...status.historySync, importing: false };
        emitter.emit('status', { ...status });
        emitter.emit('log', `Histórico dos últimos ${HISTORY_DAYS} dias: ${status.historySync.imported} mensagem(ns) importada(s)${status.historySync.failed ? `; ${status.historySync.failed} falha(s)` : ''}.`);
      }).catch(() => {
        if (canSaveHistory()) {
          status.historySync = { ...status.historySync, importing: false, error: 'Não foi possível concluir este lote do histórico.' };
          emitter.emit('status', { ...status });
        }
      });
      return messageQueue;
    };
    cancelIdentity = acceptIdentity;

    const syncLog = createContactSyncLog(CHIP_ID);
    const sock = makeWASocket({
      auth: authState,
      logger: syncLog.logger,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      getMessage: async (key) => {
        if (!(await identityReady) || generation !== socketGeneration || manualDisconnect) return undefined;
        try {
          const message = await messageRetryStore.getMessage(key);
          if (generation !== socketGeneration || manualDisconnect) return undefined;
          if (!message) emitter.emit('log', 'O WhatsApp solicitou um reenvio, mas a mensagem original não está mais disponível.');
          return message;
        } catch (error) {
          console.warn('[RETRY] Falha ao recuperar mensagem:', error.message);
          return undefined;
        }
      },
    });

    const sendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const sent = await sendMessage(...args);
      if (generation === socketGeneration && !manualDisconnect) messageRetryStore.remember(sent);
      return sent;
    };

    if (generation !== socketGeneration || manualDisconnect) {
      acceptIdentity(false);
      closeTransport(sock);
      return sock;
    }

    sockRef = sock;
    socketClosed = false;
    sock.ev.on('messaging-history.set', ({ messages = [], progress }) => enqueueHistory(messages, progress));
    sock.ev.on('messages.update', async (updates) => {
      if (!(await identityReady) || generation !== socketGeneration || manualDisconnect) return;
      for (const { key, update } of updates) {
        if (!key?.fromMe || !Number.isInteger(update?.status)) continue;
        try {
          const conversation = await store.updateMessageStatus(key.id, update.status);
          if (conversation && generation === socketGeneration && !manualDisconnect) emitter.emit('message', conversation);
        } catch (error) { console.warn('[RECEIPTS] Falha ao atualizar confirmação:', error.message); }
      }
    });
    directoryRef = new WhatsAppDirectory({ socket: sock, store, authKeys: authState.keys, syncLog,
      readyForSync: async () => {
        const keyId = authState.creds.myAppStateKeyId;
        if (!keyId) return false;
        const keys = await authState.keys.get('app-state-sync-key', [keyId]);
        return !!keys[keyId];
      },
      canSave: async () => (await identityReady) && generation === socketGeneration && !manualDisconnect, emit: (event, payload) => {
      if (generation === socketGeneration && !manualDisconnect) {
        if (event === 'contacts:sync') {
          status.contactsSync = payload;
          emitter.emit('status', { ...status });
        } else emitter.emit(event, payload);
      }
    }, connected: () => generation === socketGeneration && status.connected && !manualDisconnect });

    sock.ev.on('creds.update', async () => {
      if (generation === socketGeneration && !manualDisconnect) {
        try {
          const saving = trackAuthWrite(credentialSaveQueue.then(() => saveCreds()));
          credentialSaveQueue = saving.catch(() => {});
          await saving;
        } catch (err) {
          console.warn('[AUTH] Falha ao salvar credenciais:', err.message);
        }
      }
    });


    sock.ev.on('chats.phoneNumberShare', async ({ lid, jid }) => {
      if (!(await identityReady) || generation !== socketGeneration || manualDisconnect) return;
      const lidNumber = fromJid(lid);
      const phoneNumber = fromJid(jid);
      if (!lidNumber || !phoneNumber) return;
      try {
        const conversationNumber = await store.registerConversationAliases(lidNumber, phoneNumber, { create: false });
        jidMap[lidNumber] = lid;
        jidMap[phoneNumber] = lid;
        jidMap[conversationNumber] = lid;
        // Guarda o LID no contato para sobreviver a restarts
        await store.saveContact({ number: phoneNumber, jid: lid });
        // Avisa o painel: a conversa pode ter sido mesclada com outra
        const conversation = await store.getConversation(conversationNumber, false);
        if (conversation?.messages.length) emitter.emit('message', conversation);
        console.log(`[JID] alias atualizado: ${lidNumber} <-> ${phoneNumber}`);
      } catch (err) {
        console.warn('[JID] Falha ao salvar alias de telefone:', err.message);
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (generation !== socketGeneration) return;

      if (qr) {
        try {
          const image = await QRCode.toDataURL(qr);
          if (generation !== socketGeneration || manualDisconnect) return;
          status.qr = image;
          console.info(`[WHATSAPP] QR Code disponível para o chip ${CHIP_ID || 'local'}.`);
        } catch {
          if (generation !== socketGeneration || manualDisconnect) return;
          status.qr = null;
        }
        status.connected = false;
        emitter.emit('status', status);
      }

      if (connection === 'close') {
        if (socketClosed) return;
        socketClosed = true;
        socketGeneration += 1;
        acceptIdentity(false);
        const info = disconnectInfo(lastDisconnect?.error);
        const uptimeMs = connectedAt === null ? 0 : Date.now() - connectedAt;
        if (uptimeMs >= 60000) reconnectAttempts = 0;
        connectedAt = null;
        if (sockRef === sock) sockRef = null;
        status.lastDisconnect = { code: info.code, reason: info.reason, at: new Date().toISOString(), action: info.action };
        status.connected = false;
        status.qr = null;
        status.reconnecting = false;
        delete status.retryInMs;
        connectionLog('connection.close', { ...info, uptimeMs });
        emitter.emit('status', { ...status });

        if (manualDisconnect) {
          emitter.emit('log', 'WhatsApp desconectado manualmente.');
          return;
        }

        if (info.action === 'new_qr') {
          emitter.emit('log', 'Sessão encerrada no WhatsApp. Gerando novo QR Code...');
          await resetSessionAndRestart(emitter);
          return;
        }
        if (info.action === 'paused') {
          status.error = info.error;
          emitter.emit('status', { ...status });
          emitter.emit('log', info.error);
          return;
        }

        emitter.emit('log', 'Conexão fechada. Reconectando...');
        scheduleReconnect(emitter);
      } else if (connection === 'open') {
        try {
          const number = accountNumber(sock.user?.id || authState.creds.me?.id);
          if (!number) throw identityError('Não foi possível identificar o telefone conectado pelo QR Code.');
          if (expectedAccount && number !== expectedAccount) throw identityError('Este chip pertence a outro número. Use a mesma conta ou crie um novo chip para conectar outro WhatsApp.');
          await verifyIdentity(number);
          if (generation !== socketGeneration || manualDisconnect) { acceptIdentity(false); return; }
          fs.writeFileSync(path.join(STORAGE_DIR, 'account-identity.json'), JSON.stringify({ number }));
          expectedAccount = number;
          ADMIN_NUMBER = number;
          status.admin = number;
          status.number = number;
          // Keep the original import boundary across restarts. Messages arriving
          // later remain eligible even after they become older than seven days.
          const savedHistoryStart = Date.parse(state.historyStartedAt || '');
          historyAnchor = Number.isFinite(savedHistoryStart) && savedHistoryStart <= Date.now() ? savedHistoryStart : Date.now();
          if (!Number.isFinite(savedHistoryStart) || savedHistoryStart > Date.now()) {
            state.historyStartedAt = new Date(historyAnchor).toISOString();
            saveState(state);
          }
          delete status.error;
          acceptIdentity(true);
        } catch (error) {
          acceptIdentity(false);
          if (generation !== socketGeneration || manualDisconnect) return;
          if (error.code === 'WHATSAPP_IDENTITY_REJECTED') {
            connectionLog('identity.rejected', { action: 'new_qr' });
            await disconnectBot();
            status.error = error.message;
            emitter.emit('status', { ...status });
          } else {
            connectionLog('identity.unavailable', { action: 'reconnect' });
            socketGeneration += 1;
            socketClosed = true;
            sockRef = null;
            status.connected = false;
            status.qr = null;
            status.error = 'Não foi possível confirmar a conta agora. A sessão foi preservada; reconectando automaticamente.';
            closeTransport(sock);
            scheduleReconnect(emitter);
          }
          return;
        }
        connectedAt = Date.now();
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        status.reconnecting = false;
        delete status.retryInMs;
        status.connected = true;
        status.contactsSync = { syncing: true, verified: false, stage: 'loading', error: '' };
        status.qr = null;
        emitter.emit('status', status);
        emitter.emit('log', `Bot conectado com sucesso! Admin: ${ADMIN_NUMBER}`);
        connectionLog('connection.open', { attempt: reconnectAttempts });
        directoryRef.sync().catch(error => console.warn('[CONTACTS] A agenda será sincronizada novamente:', error.message));
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type === 'append') {
        const historical = messages.filter(msg => messageTime(msg) !== null);
        if (historical.length) enqueueHistory(historical);
        // Preserve legacy companion-device events without timestamps.
        messages = messages.filter(msg => messageTime(msg) === null && msg.key?.fromMe);
        if (!messages.length) return messageQueue;
      }
      messageQueue = messageQueue.then(async () => {
        if (!(await identityReady) || generation !== socketGeneration || manualDisconnect || !status.connected) return;
        if (type !== 'notify' && type !== 'append') return;

        for (const msg of messages) {
          // Append includes companion-device sends and historical incoming messages.
          if (type === 'append' && !msg.key?.fromMe) continue;
          messageRetryStore.remember(msg);
          // Um erro em uma mensagem nunca pode derrubar o processo nem as demais
          try {
            await handleIncomingMessage(sock, msg, emitter);
          } catch (err) {
            console.error('[MSG] Erro ao processar mensagem:', err);
            emitter.emit('log', `Erro ao processar mensagem: ${err.message}`);
          }
        }
      }).catch(error => console.error('[MSG] Falha na fila de mensagens:', error.message));
      return messageQueue;
    });

    return sock;
  })();
  botStartPromise = starting;

  try {
    return await starting;
  } finally {
    if (botStartPromise === starting) botStartPromise = null;
  }
}

// Mensagem vinda do SEU numero (comandos ou repasse pro cliente assumido)
async function handleAdminMessage(sock, text, emitter) {
  const lower = text.toLowerCase();

  if (lower.startsWith('!enviar') || lower.startsWith('!mandar')) {
    const parts = text.split(' ').filter(Boolean);
    const numberRaw = parts[1];
    const messageText = parts.slice(2).join(' ');

    if (!numberRaw || !messageText) {
      return;
    }

    const number = numberRaw.replace(/\D/g, '');
    try {
      const conversation = await sendToClient(number, messageText);
      state.activeTarget = number;
      saveState(state);
      emitter.emit('active-target', number);
      emitter.emit('message', conversation);
    } catch (err) {
      emitter.emit('log', `Não foi possível enviar para ${number}: ${err.message}`);
    }
    return;
  }

  if (lower.startsWith('!assumir')) {
    const parts = text.split(' ').filter(Boolean);
    const numberRaw = parts[1];

    if (!numberRaw) {
      return;
    }

    const number = numberRaw.replace(/\D/g, '');
    state.activeTarget = number;
    saveState(state);
    emitter.emit('active-target', number);
    return;
  }

  if (lower === '!sair' || lower === '!encerrar') {
    state.activeTarget = null;
    saveState(state);
    emitter.emit('active-target', null);
    return;
  }

  if (lower === '!status') {
    return;
  }

  // Se ha uma conversa assumida, qualquer texto normal vira mensagem pro cliente
  if (state.activeTarget) {
    const outgoingText = await formatOutgoingText(text);
    const sent = await sock.sendMessage(await resolveClientJid(state.activeTarget), { text: outgoingText });
    const conversation = await store.addMessage(state.activeTarget, 'admin', outgoingText, '', {}, sent?.key?.id || '', sent?.status ?? 1, { raw: sent, delta: true });
    emitter.emit('message', conversation);
    return;
  }

  // Nao ha conversa assumida e nao foi um comando reconhecido
}

async function getAdminUsername() {
  const user = await db.get('SELECT display_name, username FROM users ORDER BY id ASC LIMIT 1');
  return user?.display_name || user?.username || 'admin';
}

async function formatOutgoingText(text, displayName = '') {
  if (displayName === null) return text;
  return `*${displayName || await getAdminUsername()}*: ${text}`;
}

// Mensagem vinda de um CLIENTE (qualquer numero que nao seja o admin)
async function forwardToAdmin(senderNumber, text, emitter, contactName = '', msg = null, mediaInfo = null) {
  const current = await store.getConversation(senderNumber, true, { metadataOnly: true });
  if (current.blocked) {
    console.log(`[BLOCK] Mensagem ignorada para ${senderNumber} porque a conversa está bloqueada.`);
    return;
  }

  let media = {};
  if (mediaInfo) {
    try {
      media = await saveIncomingMedia(msg, mediaInfo);
    } catch (err) {
      console.error(`[MEDIA] Falha ao baixar mídia de ${senderNumber}:`, err.message);
      emitter.emit('log', `Falha ao baixar mídia de ${senderNumber}: ${err.message}`);
    }
  }

  const existing = msg?.key?.id && await db.get('SELECT id FROM messages WHERE whatsapp_msg_id = ? AND number = ?', [msg.key.id, current.number]);
  if (existing) return;
  const conversation = await store.addMessage(senderNumber, 'client', text || (mediaInfo?.sticker && !media.type ? '[Figurinha indisponível]' : ''), contactName || current.name || '', media, msg?.key?.id || '', undefined, { ...await incomingDetails(msg, senderNumber), delta: true });
  emitter.emit('message', conversation);
}

// ---------- API usada pela dashboard ----------
function getActiveTarget() {
  return state.activeTarget;
}

function setActiveTarget(number) {
  state.activeTarget = number ? number.replace(/\D/g, '') : null;
  saveState(state);
  return state.activeTarget;
}

function getStatus() {
  return status;
}

// A process restart closes only the transport; it must never unlink the phone.
async function stopBot() {
  manualDisconnect = true;
  cancelIdentity(false);
  socketGeneration += 1;
  socketClosed = true;
  connectedAt = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const socket = sockRef;
  sockRef = null;
  closeTransport(socket);
  await botStartPromise?.catch(() => {});
  await flushAuthWrites();
  await messageQueue;
  status.connected = false;
  status.qr = null;
  status.reconnecting = false;
  connectionLog('connection.stopped', { action: 'preserve_session' });
}

async function disconnectBot() {
  if (disconnectPromise) return disconnectPromise;

  disconnectPromise = (async () => {
    cancelIdentity(false);
    messageRetryStore.clear();
    manualDisconnect = true;
    socketGeneration += 1;
    socketClosed = true;
    connectedAt = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    const socket = sockRef;
    sockRef = null;
    status = { connected: false, qr: null, admin: ADMIN_NUMBER };

    if (socket) {
      try {
        if (typeof socket.logout === 'function') {
          await Promise.race([
            socket.logout(),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        }
      } catch (err) {
        console.warn('[DISCONNECT] Logout remoto falhou; fechando o transporte:', err.message);
      } finally {
        closeTransport(socket);
      }
    }

    await botStartPromise?.catch(() => {});
    await flushAuthWrites();
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    Object.keys(jidMap).forEach((key) => delete jidMap[key]);

    if (emitterRef) {
      emitterRef.emit('status', status);
      emitterRef.emit('log', 'WhatsApp desconectado. Gere um novo QR para conectar novamente.');
    }

    // Cria um socket sem credenciais: o número fica desconectado e o painel recebe um novo QR.
    manualDisconnect = false;
    await startBot(emitterRef);
    return true;
  })();

  try {
    return await disconnectPromise;
  } finally {
    disconnectPromise = null;
  }
}

function assertConnected() {
  if (!sockRef || !status.connected) {
    throw new Error('O WhatsApp está desconectado no momento. Aguarde a reconexão ou escaneie o QR Code.');
  }
  if (directoryRef && !directoryRef.syncState.verified) {
    throw new Error('Aguarde a sincronização e verificação dos contatos antes de enviar mensagens.');
  }
}

// Descobre para qual JID enviar. Ordem: mapa em memória -> JID salvo no banco
// (é isso que faz funcionar quando o contato chamou primeiro e o bot reiniciou)
// -> consulta ao WhatsApp.
async function resolveClientJid(number) {
  if (!sockRef) throw new Error('O bot ainda não está conectado ao WhatsApp.');
  const clean = number.replace(/\D/g, '');
  const mappedJid = jidMap[clean] || jidMap[number];
  if (mappedJid) return mappedJid;

  const knownJid = await store.getKnownJid(clean);
  if (knownJid) {
    jidMap[clean] = knownJid;
    return knownJid;
  }

  // IDs internos (LID) tem 14+ digitos; telefones tem no maximo 13 no Brasil.
  // Sem JID conhecido, um LID nunca pode ser resolvido por telefone.
  if (clean.length >= 14) return `${clean}@lid`;

  return resolveJid(sockRef, clean);
}

function quoteSummary(row) {
  return { id: row.id, whatsappId: row.whatsapp_msg_id, from: row.from_role, text: row.caption || row.text || `[${row.type || 'Mensagem'}]`, type: row.type || 'text' };
}
async function incomingDetails(msg, number) {
  const message = unwrapMessage(msg || {});
  const context = Object.values(message).find(value => value && typeof value === 'object' && value.contextInfo)?.contextInfo;
  let replyTo = null;
  if (context?.stanzaId) {
    const canonical = await store.resolveConversationNumber(number);
    const row = await db.get('SELECT * FROM messages WHERE number = ? AND whatsapp_msg_id = ?', [canonical, context.stanzaId]);
    replyTo = row ? quoteSummary(row) : { whatsappId: context.stanzaId, from: fromJid(context.participant) === ADMIN_NUMBER ? 'admin' : 'client', text: extractText({ message: context.quotedMessage || {} }) || '[Mídia]', type: getMediaInfo({ message: context.quotedMessage || {} })?.type || 'text' };
  }
  return { raw: msg, replyTo, forwarded: !!context?.isForwarded };
}
async function quotedMessage(number, replyTo) {
  if (!replyTo) return { options: {}, summary: null };
  const [row] = await store.getStoredMessages(number, [replyTo]);
  if (!row.whatsapp_msg_id) throw new Error('Esta mensagem antiga não tem o identificador do WhatsApp. Escolha uma mensagem mais recente para responder.');
  const jid = await resolveClientJid(number);
  const raw = row.raw || { key: { id: row.whatsapp_msg_id, remoteJid: jid, fromMe: row.from_role === 'admin' }, message: { conversation: row.caption || row.text || '[Mídia]' } };
  return { options: { quoted: raw }, summary: quoteSummary(row) };
}

async function sendToClient(number, text, displayName = '', replyTo) {
  assertConnected();
  const clean = number.replace(/\D/g, '');
  const jid = await resolveClientJid(clean);
  const outgoingText = await formatOutgoingText(text, displayName);
  const quote = await quotedMessage(clean, replyTo);
  assertConnected();
  const sent = await sockRef.sendMessage(jid, { text: outgoingText }, quote.options);
  if (DEPARTMENT_ID) await store.setDefaultConversationDepartment(clean, DEPARTMENT_ID);
  return store.addMessage(clean, 'admin', outgoingText, '', {}, sent?.key?.id || '', sent?.status ?? 1, { raw: sent, replyTo: quote.summary, delta: true });
}

async function sendMediaToClient(number, media, displayName = '', replyTo) {
  assertConnected();
  const clean = number.replace(/\D/g, '');
  const jid = await resolveClientJid(clean);
  const content = {
    [media.type]: media.buffer,
    mimetype: media.mimeType,
    fileName: media.fileName,
  };

  if (media.caption) content.caption = await formatOutgoingText(media.caption, displayName);
  if (media.type === 'audio') content.ptt = true;
  const quote = await quotedMessage(clean, replyTo);
  assertConnected();
  const sent = await sockRef.sendMessage(jid, content, quote.options);

  const storedCaption = media.caption ? content.caption : '';
  if (DEPARTMENT_ID) await store.setDefaultConversationDepartment(clean, DEPARTMENT_ID);
  return store.addMessage(clean, 'admin', storedCaption, '', {
    type: media.type,
    mediaUrl: media.mediaUrl,
    mimeType: media.mimeType,
    fileName: media.fileName,
    caption: storedCaption,
  }, sent?.key?.id || '', sent?.status ?? 1, { raw: sent, replyTo: quote.summary, delta: true });
}

async function forwardMessages(number, targetNumber, ids) {
  assertConnected();
  const rows = await store.getStoredMessages(number, ids);
  const target = targetNumber.replace(/\D/g, '');
  if (!target) throw new Error('Informe o destinatário.');
  if (await store.isBlocked(target)) throw new Error('O destinatário está bloqueado.');
  const jid = await resolveClientJid(target);
  // Validate every attachment before sending anything.
  const prepared = rows.map(row => {
    const media = row.type ? { type: row.type, mediaUrl: row.media_url, mimeType: row.mime_type, fileName: row.file_name, caption: row.caption } : {};
    let content;
    if (row.type && row.media_url) {
      const match = /^\/media\/(?:chips\/(\d+)\/)?([^/?]+)$/.exec(row.media_url);
      if (!match || match[1] && match[1] !== CHIP_ID) throw new Error('O anexo não está disponível neste canal.');
      const fileName = decodeURIComponent(match[2]);
      if (path.basename(fileName) !== fileName || /[\\/:]/.test(fileName) || ['.', '..'].includes(fileName)) throw new Error('Anexo inválido.');
      const directory = match[1] ? MEDIA_DIR : process.env.ACCOUNT_MEDIA_DIR || MEDIA_DIR;
      const filePath = path.join(directory, fileName);
      if (!fs.statSync(filePath).isFile()) throw new Error('O anexo não está disponível.');
      fs.accessSync(filePath, fs.constants.R_OK);
      const original = row.raw ? unwrapMessage(row.raw) : {};
      const type = original.stickerMessage ? 'sticker' : row.type === 'gif' ? 'image' : row.type;
      content = { filePath, mediaType: type, mimetype: row.mime_type, fileName: row.file_name, caption: row.caption || undefined, ptt: type === 'audio' ? true : undefined, contextInfo: { isForwarded: true, forwardingScore: 1 } };
    } else content = { text: row.text || row.caption || '', contextInfo: { isForwarded: true, forwardingScore: 1 } };
    return { row, media, content };
  });
  let conversation;
  for (const { row, media, content } of prepared) {
    assertConnected();
    const { filePath, mediaType, ...outgoing } = content;
    if (filePath) outgoing[mediaType] = fs.readFileSync(filePath);
    const sent = await sockRef.sendMessage(jid, outgoing);
    if (DEPARTMENT_ID) await store.setDefaultConversationDepartment(target, DEPARTMENT_ID);
    conversation = await store.addMessage(target, 'admin', row.text || '', '', media, sent?.key?.id || '', sent?.status ?? 1, { raw: sent, forwarded: true, delta: true });
    emitterRef?.emit('message', conversation);
  }
  return conversation;
}

async function deleteMessages(number, ids, forEveryone = false) {
  const rows = await store.getStoredMessages(number, ids);
  if (forEveryone) {
    assertConnected();
    if (rows.some(row => row.from_role !== 'admin' || !row.whatsapp_msg_id)) throw new Error('Só é possível apagar para todos mensagens enviadas por esta conta.');
    const jid = await resolveClientJid(number);
    for (const row of rows) {
      assertConnected();
      await sockRef.sendMessage(jid, { delete: row.raw?.key || { id: row.whatsapp_msg_id, remoteJid: jid, fromMe: true } });
      // Keep already completed deletions consistent if a later request fails.
      emitterRef?.emit('message', { ...await store.deleteMessages(number, [row.id]), mutation: 'delete' });
    }
    return store.getConversation(number, false);
  }
  return store.deleteMessages(number, ids);
}

// Inicia o bot e, se a primeira tentativa falhar, continua tentando sozinho.
async function startBotWithRetry(emitter) {
  try {
    await startBot(emitter);
  } catch (err) {
    console.error('[BOT] Falha ao iniciar:', err.message);
    emitter.emit('log', `Falha ao iniciar o WhatsApp: ${err.message}. Tentando de novo...`);
    scheduleReconnect(emitter);
  }
}

module.exports = {
  forwardMessages,
  deleteMessages,
  syncContacts: () => directoryRef?.sync() || Promise.resolve({ connected: false, synced: false }),
  getProfilePicture: number => directoryRef?.profile(number) || Promise.resolve({ number, profilePic: '', connected: false }),
  startBot,
  startBotWithRetry,
  getActiveTarget,
  setActiveTarget,
  getStatus,
  disconnectBot,
  stopBot,
  sendToClient,
  sendMediaToClient,
  get ADMIN_NUMBER() { return ADMIN_NUMBER; },
  setIdentityVerifier,
};
