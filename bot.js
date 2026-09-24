require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const store = require('./store');
const db = require('./db');

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const ADMIN_NUMBER = (process.env.ADMIN_NUMBER || '').replace(/\D/g, '');
const AUTH_DIR = path.join(STORAGE_DIR, 'auth_info');
const STATE_FILE = path.join(STORAGE_DIR, 'session-state.json');
const MEDIA_DIR = path.join(STORAGE_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

if (!ADMIN_NUMBER) {
  console.error('❌ Defina ADMIN_NUMBER (variável de ambiente) antes de iniciar.');
  process.exit(1);
}

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
    (message.stickerMessage ? '[Figurinha]' : '') ||
    ''
  );
}

function getMediaInfo(msg) {
  const message = unwrapMessage(msg);
  if (message.imageMessage) return { type: 'image', content: message.imageMessage };
  if (message.videoMessage) return { type: 'video', content: message.videoMessage };
  if (message.audioMessage) return { type: 'audio', content: message.audioMessage };
  if (message.documentMessage) return { type: 'document', content: message.documentMessage };
  return null;
}

function extensionFor(type, mimeType = '') {
  const mimeExtension = mimeType.split('/')[1]?.split(';')[0];
  if (mimeExtension && /^[a-z0-9]+$/i.test(mimeExtension)) return mimeExtension;
  return { image: 'jpg', video: 'mp4', audio: 'ogg', document: 'bin' }[type] || 'bin';
}

async function saveIncomingMedia(msg, mediaInfo) {
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
    logger: pino({ level: 'silent' }),
  });
  const mimeType = mediaInfo.content.mimetype || 'application/octet-stream';
  const fileName = `${crypto.randomUUID()}.${extensionFor(mediaInfo.type, mimeType)}`;
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), buffer);
  return {
    type: mediaInfo.type,
    mediaUrl: `/media/${fileName}`,
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
  if (manualDisconnect) return;
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
  reconnectAttempts += 1;
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
  socketGeneration += 1;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
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
  const altJid = msg.key.senderPn || msg.key.remoteJidAlt || msg.key.participantPn || '';
  const senderJid = altJid.endsWith('@s.whatsapp.net') ? altJid : remoteJid;
  const senderNumber = fromJid(senderJid);
  const phoneNumber = senderJid.endsWith('@s.whatsapp.net') ? senderNumber : '';
  const isFromAdmin = phoneNumber === ADMIN_NUMBER || remoteNumber === ADMIN_NUMBER;
  if (!isFromAdmin && (await store.isBlocked(remoteNumber) || (phoneNumber && await store.isBlocked(phoneNumber)))) {
    console.log(`[BLOCK] Ignorando mensagem de contato bloqueado: ${phoneNumber || remoteNumber}.`);
    return;
  }
  const conversationNumber = await store.registerConversationAliases(remoteNumber, phoneNumber);
  const contactName = msg.pushName || msg.notifyName || '';

  const savedContact = await store.saveContact({ number: phoneNumber || remoteNumber, name: contactName, pushName: contactName, jid: remoteJid });
  if (savedContact) emitter.emit('contact', savedContact);

  jidMap[conversationNumber] = remoteJid;
  jidMap[remoteNumber] = remoteJid;
  if (phoneNumber) jidMap[phoneNumber] = remoteJid;
  console.log(`[MSG] de=${conversationNumber} telefone=${phoneNumber || 'indisponivel'} jid=${remoteJid} nome=${contactName || 'sem-nome'}`);

  const text = extractText(msg).trim();
  const mediaInfo = getMediaInfo(msg);
  if (!text && !mediaInfo) {
    // Reacoes, protocolo, recibos etc. Loga o tipo para facilitar diagnostico.
    console.log(`[MSG] ignorada (sem texto/mídia). tipos=${Object.keys(unwrapMessage(msg)).join(',') || 'vazio'}`);
    return;
  }

  console.log(`[MSG] isAdmin=${isFromAdmin} texto="${text.slice(0, 40)}"`);

  if (isFromAdmin) {
    await handleAdminMessage(sock, text, emitter);
    return;
  }
  const current = await store.getConversation(conversationNumber);
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
      if (existing) return; // já foi salva pelo painel
    }
    const conversation = await store.addMessage(conversationNumber, 'admin', text, '', media, msgId);
    emitter.emit('message', conversation);
    return;
  }

  await forwardToAdmin(conversationNumber, text, emitter, contactName, msg, mediaInfo);
}

async function startBot(emitter) {
  if (manualDisconnect) {
    manualDisconnect = false;
  }
  if (botStartPromise) {
    return botStartPromise;
  }

  emitterRef = emitter;
  const generation = ++socketGeneration;
  botStartPromise = (async () => {
    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
      auth: authState,
      logger: pino({ level: 'silent' }),
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
    });

    if (generation !== socketGeneration || manualDisconnect) {
      if (sock.ws && typeof sock.ws.close === 'function') {
        sock.ws.close();
      }
      return sock;
    }

    sockRef = sock;

    sock.ev.on('creds.update', async (creds) => {
      if (generation === socketGeneration && !manualDisconnect) {
        try {
          await saveCreds(creds);
        } catch (err) {
          console.warn('[AUTH] Falha ao salvar credenciais:', err.message);
        }
      }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts || []) {
        try {
          const saved = await store.saveContact({
            number: contact.phoneNumber || contact.id,
            name: contact.name || contact.verifiedName || '',
            pushName: contact.notify || '',
            jid: contact.id || '',
          });
          if (saved) emitter.emit('contact', saved);
        } catch (err) {
          console.warn('[CONTACTS] Falha ao salvar contato:', err.message);
        }
      }
    });

    sock.ev.on('chats.phoneNumberShare', async ({ lid, jid }) => {
      const lidNumber = fromJid(lid);
      const phoneNumber = fromJid(jid);
      if (!lidNumber || !phoneNumber) return;
      try {
        const conversationNumber = await store.registerConversationAliases(lidNumber, phoneNumber);
        jidMap[lidNumber] = lid;
        jidMap[phoneNumber] = lid;
        jidMap[conversationNumber] = lid;
        // Guarda o LID no contato para sobreviver a restarts
        await store.saveContact({ number: phoneNumber, jid: lid });
        // Avisa o painel: a conversa pode ter sido mesclada com outra
        emitter.emit('message', await store.getConversation(conversationNumber));
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
          status.qr = await QRCode.toDataURL(qr);
        } catch {
          status.qr = null;
        }
        status.connected = false;
        emitter.emit('status', status);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        status.connected = false;
        status.qr = null;
        emitter.emit('status', status);

        if (manualDisconnect) {
          emitter.emit('log', 'WhatsApp desconectado manualmente.');
          return;
        }

        const sessionInvalid = statusCode === DisconnectReason.loggedOut
          || statusCode === DisconnectReason.badSession;

        if (sessionInvalid) {
          emitter.emit('log', 'Sessão encerrada no WhatsApp. Gerando novo QR Code...');
          await resetSessionAndRestart(emitter);
          return;
        }

        emitter.emit('log', 'Conexão fechada. Reconectando...');
        scheduleReconnect(emitter);
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        status.connected = true;
        status.qr = null;
        emitter.emit('status', status);
        emitter.emit('log', `Bot conectado com sucesso! Admin: ${ADMIN_NUMBER}`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (generation !== socketGeneration || manualDisconnect) return;
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Um erro em uma mensagem nunca pode derrubar o processo nem as demais
        try {
          await handleIncomingMessage(sock, msg, emitter);
        } catch (err) {
          console.error('[MSG] Erro ao processar mensagem:', err);
          emitter.emit('log', `Erro ao processar mensagem: ${err.message}`);
        }
      }
    });

    return sock;
  })();

  try {
    return await botStartPromise;
  } finally {
    botStartPromise = null;
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
    await sock.sendMessage(await resolveClientJid(state.activeTarget), { text: outgoingText });
    const conversation = await store.addMessage(state.activeTarget, 'admin', outgoingText);
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
  return `*${displayName || await getAdminUsername()}*: ${text}`;
}

// Mensagem vinda de um CLIENTE (qualquer numero que nao seja o admin)
async function forwardToAdmin(senderNumber, text, emitter, contactName = '', msg = null, mediaInfo = null) {
  const current = await store.getConversation(senderNumber);
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

  const conversation = await store.addMessage(senderNumber, 'client', text, contactName || current.name || '', media);
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

async function disconnectBot() {
  if (disconnectPromise) return disconnectPromise;

  disconnectPromise = (async () => {
    manualDisconnect = true;
    socketGeneration += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    const socket = sockRef;
    sockRef = null;
    botStartPromise = null;
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
        try {
          if (socket.ws && typeof socket.ws.close === 'function') {
            socket.ws.close();
          }
        } catch (err) {
          console.warn('[DISCONNECT] Falha ao fechar o transporte:', err.message);
        }
      }
    }

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

async function sendToClient(number, text, displayName = '') {
  assertConnected();
  const clean = number.replace(/\D/g, '');
  const jid = await resolveClientJid(clean);
  const outgoingText = await formatOutgoingText(text, displayName);
  await sockRef.sendMessage(jid, { text: outgoingText });
  return store.addMessage(clean, 'admin', outgoingText);
}

async function sendMediaToClient(number, media, displayName = '') {
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
  await sockRef.sendMessage(jid, content);

  const storedCaption = media.caption ? content.caption : '';
  return store.addMessage(clean, 'admin', storedCaption, '', {
    type: media.type,
    mediaUrl: media.mediaUrl,
    mimeType: media.mimeType,
    fileName: media.fileName,
    caption: storedCaption,
  });
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
  startBot,
  startBotWithRetry,
  getActiveTarget,
  setActiveTarget,
  getStatus,
  disconnectBot,
  sendToClient,
  sendMediaToClient,
  ADMIN_NUMBER,
};
