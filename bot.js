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
  try {
    const [result] = await sock.onWhatsApp(clean);
    if (result && result.exists) {
      console.log(`[JID] ${clean} → ${result.jid}`);
      return result.jid;
    }
    // Tenta com o 9 na frente (numeros BR sem o digito extra)
    if (clean.startsWith('55') && clean.length === 12) {
      const withNine = clean.slice(0, 4) + '9' + clean.slice(4);
      const [r2] = await sock.onWhatsApp(withNine);
      if (r2 && r2.exists) {
        console.log(`[JID] ${clean} → ${r2.jid} (com 9)`);
        return r2.jid;
      }
    }
  } catch (err) {
    console.warn(`[JID] onWhatsApp falhou para ${clean}:`, err.message);
  }
  // fallback: usa o formato padrao
  return toJid(clean);
}

function extractText(msg) {
  const message = msg.message?.ephemeralMessage?.message
    || msg.message?.viewOnceMessage?.message
    || msg.message?.viewOnceMessageV2?.message
    || msg.message;
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  );
}

function getMediaInfo(msg) {
  const message = msg.message?.ephemeralMessage?.message
    || msg.message?.viewOnceMessage?.message
    || msg.message?.viewOnceMessageV2?.message
    || msg.message
    || {};
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
    });

    if (generation !== socketGeneration || manualDisconnect) {
      if (sock.ws && typeof sock.ws.close === 'function') {
        sock.ws.close();
      }
      return sock;
    }

    sockRef = sock;

    sock.ev.on('creds.update', (creds) => {
      if (generation === socketGeneration && !manualDisconnect) {
        saveCreds(creds);
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
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !manualDisconnect;

        status.connected = false;
        emitter.emit('status', status);

        if (manualDisconnect) {
          emitter.emit('log', 'WhatsApp desconectado manualmente.');
          return;
        }

        emitter.emit(
          'log',
          shouldReconnect
            ? 'Conexão fechada. Reconectando...'
            : 'Sessão deslogada. Escaneie o QR para conectar novamente.'
        );

        if (shouldReconnect) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (generation === socketGeneration && !manualDisconnect) {
              await startBot(emitter);
            }
          } catch (err) {
            console.error('[BOT] Falha ao reconectar:', err.message);
          }
        }
      } else if (connection === 'open') {
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
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) continue;

        const remoteNumber = fromJid(remoteJid);
        if (msg.key.fromMe && remoteNumber !== ADMIN_NUMBER) continue;

        const senderJid = msg.key.senderPn || remoteJid;
        const senderNumber = fromJid(senderJid);
        const phoneNumber = senderJid.endsWith('@s.whatsapp.net') ? senderNumber : '';
        const conversationNumber = await store.registerConversationAliases(remoteNumber, phoneNumber);
        const contactName = msg.pushName || msg.notifyName || '';

        jidMap[conversationNumber] = remoteJid;
        jidMap[remoteNumber] = remoteJid;
        if (phoneNumber) jidMap[phoneNumber] = remoteJid;
        console.log(`[MSG] de=${conversationNumber} telefone=${phoneNumber || 'indisponivel'} jid=${remoteJid} nome=${contactName || 'sem-nome'}`);

        const text = extractText(msg).trim();
        const mediaInfo = getMediaInfo(msg);
        if (!text && !mediaInfo) continue;

        const isFromAdmin = phoneNumber === ADMIN_NUMBER || remoteNumber === ADMIN_NUMBER;
        console.log(`[MSG] isAdmin=${isFromAdmin} texto="${text.slice(0, 40)}"`);

        try {
          if (isFromAdmin) {
            await handleAdminMessage(sock, text, emitter);
          } else {
            const current = await store.getConversation(conversationNumber);
            if (current.blocked) {
              console.log(`[BLOCK] Ignorando mensagem de ${conversationNumber} porque a conversa está bloqueada.`);
              continue;
            }
            await forwardToAdmin(conversationNumber, text, emitter, contactName, msg, mediaInfo);
          }
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
    await sock.sendMessage(toJid(state.activeTarget), { text: outgoingText });
    const conversation = await store.addMessage(state.activeTarget, 'admin', outgoingText);
    emitter.emit('message', conversation);
    return;
  }

  // Nao ha conversa assumida e nao foi um comando reconhecido
}

async function getAdminUsername() {
  const user = await db.get('SELECT username FROM users ORDER BY id ASC LIMIT 1');
  return user?.username || 'admin';
}

async function formatOutgoingText(text) {
  return `*${await getAdminUsername()}*: ${text}`;
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

async function resolveClientJid(number) {
  if (!sockRef) throw new Error('O bot ainda não está conectado ao WhatsApp.');
  const clean = number.replace(/\D/g, '');
  const mappedJid = jidMap[clean] || jidMap[number];

  if (mappedJid) return mappedJid;
  return resolveJid(sockRef, clean);
}

async function sendToClient(number, text) {
  if (!sockRef) throw new Error('O bot ainda não está conectado ao WhatsApp.');
  const clean = number.replace(/\D/g, '');
  const jid = await resolveClientJid(clean);
  const outgoingText = await formatOutgoingText(text);
  await sockRef.sendMessage(jid, { text: outgoingText });
  return store.addMessage(clean, 'admin', outgoingText);
}

async function sendMediaToClient(number, media) {
  if (!sockRef) throw new Error('O bot ainda não está conectado ao WhatsApp.');
  const clean = number.replace(/\D/g, '');
  const jid = await resolveClientJid(clean);
  const content = {
    [media.type]: media.buffer,
    mimetype: media.mimeType,
    fileName: media.fileName,
  };

  if (media.caption) content.caption = await formatOutgoingText(media.caption);
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

module.exports = {
  startBot,
  getActiveTarget,
  setActiveTarget,
  getStatus,
  disconnectBot,
  sendToClient,
  sendMediaToClient,
  ADMIN_NUMBER,
};
