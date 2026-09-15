require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const ADMIN_NUMBER = (process.env.ADMIN_NUMBER || '').replace(/\D/g, '');
const STATE_FILE = path.join(STORAGE_DIR, 'session-state.json');
const AUTH_DIR = path.join(STORAGE_DIR, 'auth_info');

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

// ---------- Helpers ----------
function toJid(number) {
  const clean = number.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

function fromJid(jid) {
  return (jid || '').split('@')[0];
}

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  );
}

// ---------- Bot ----------
async function startBot() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneie o QR Code abaixo com o WhatsApp do BOT (Aparelhos conectados):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Conexao fechada.', shouldReconnect ? 'Reconectando...' : 'Sessao deslogada, apague a pasta auth_info e escaneie de novo.');
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot conectado com sucesso!');
      console.log(`Admin configurado: ${ADMIN_NUMBER}`);
      if (state.activeTarget) {
        console.log(`Conversa atualmente assumida: ${state.activeTarget}`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue; // ignora grupos e status

      const remoteNumber = fromJid(remoteJid);
      if (msg.key.fromMe && remoteNumber !== ADMIN_NUMBER) continue;

      const senderNumber = fromJid(remoteJid);
      const text = extractText(msg).trim();
      if (!text) continue; // ignora midia sem legenda, figurinhas, etc.

      const isFromAdmin = senderNumber === ADMIN_NUMBER;

      try {
        if (isFromAdmin) {
          await handleAdminMessage(sock, text);
        } else {
          await forwardToAdmin(sock, senderNumber, text);
        }
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
      }
    }
  });
}

// Mensagem vinda do SEU numero (comandos ou repasse pro cliente assumido)
async function handleAdminMessage(sock, text) {
  const lower = text.toLowerCase();

  if (lower.startsWith('!assumir')) {
    const parts = text.split(' ').filter(Boolean);
    const numberRaw = parts[1];

    if (!numberRaw) {
      return;
    }

    const number = numberRaw.replace(/\D/g, '');
    state.activeTarget = number;
    saveState(state);
    return;
  }

  if (lower === '!sair' || lower === '!encerrar') {
    state.activeTarget = null;
    saveState(state);
    return;
  }

  if (lower === '!status') {
    return;
  }

  // Se ha uma conversa assumida, qualquer texto normal vira mensagem pro cliente
  if (state.activeTarget) {
    await sock.sendMessage(toJid(state.activeTarget), { text });
    return;
  }

  // Nao ha conversa assumida e nao foi um comando reconhecido
}

// Mensagem vinda de um CLIENTE (qualquer numero que nao seja o admin)
async function forwardToAdmin(sock, senderNumber, text) {
}

startBot();
