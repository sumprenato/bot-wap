const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const session = require('express-session');
const { Server } = require('socket.io');
const EventEmitter = require('events');

const bot = require('./bot');
const store = require('./store');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(server, {
  cors: allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined,
});
const emitter = new EventEmitter();
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const mediaDir = path.join(STORAGE_DIR, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword?.startsWith('scrypt:')) return storedPassword === password;
  const [, salt, storedHash] = storedPassword.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

app.use(express.json());
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Configuração de Sessão ----------
app.use(session({
  secret: process.env.SESSION_SECRET || 'bot-wap-secret-key-super-safe',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 dia
    sameSite: allowedOrigins.length ? 'none' : 'lax',
    secure: 'auto', // usa HTTPS automaticamente atrás do proxy do Railway (trust proxy já habilitado)
  },
}));

// ---------- Middleware de Proteção ----------
// Protege a rota da dashboard
app.use('/dashboard.html', (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  next();
});

// Protege as rotas da API (exceto o login)
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }
  next();
});

// Serve os arquivos estáticos (agora seguros pelo middleware acima)
app.use('/media', (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).end();
  }
  next();
}, express.static(mediaDir));
app.use('/app.js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use('/dashboard.html', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rotas de Autenticação ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  try {
    const row = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!row || !verifyPassword(password, row.password)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    req.session.userId = row.id;
    if (!row.password.startsWith('scrypt:')) {
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(password), row.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/profile', async (req, res) => {
  try {
    const user = await db.get('SELECT id, username FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
    res.json({ username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar o perfil.' });
  }
});

app.put('/api/profile', async (req, res) => {
  const { username, currentPassword, newPassword, confirmPassword } = req.body || {};
  const cleanUsername = String(username || '').trim();

  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 40) {
    return res.status(400).json({ error: 'O usuário deve ter entre 3 e 40 caracteres.' });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'O usuário só pode conter letras, números, ponto, hífen e sublinhado.' });
  }
  if (newPassword && newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }
  if (newPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'A confirmação da senha não confere.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user || !verifyPassword(currentPassword || '', user.password)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    const password = newPassword ? hashPassword(newPassword) : user.password;
    await db.run('UPDATE users SET username = ?, password = ? WHERE id = ?', [cleanUsername, password, user.id]);
    res.json({ ok: true, username: cleanUsername });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') {
      return res.status(409).json({ error: 'Esse usuário já está em uso.' });
    }
    console.error('[PROFILE]', err);
    res.status(500).json({ error: 'Erro ao atualizar o perfil.' });
  }
});

app.post('/api/disconnect', async (req, res) => {
  try {
    const ok = await bot.disconnectBot();
    io.emit('status', bot.getStatus());
    res.json({ ok, status: bot.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao desconectar o WhatsApp.' });
  }
});

// ---------- REST API ----------
app.get('/api/state', async (req, res) => {
  try {
    const user = await db.get('SELECT username FROM users WHERE id = ?', [req.session.userId]);
    res.json({
      conversations: await store.getAll(),
      activeTarget: bot.getActiveTarget(),
      status: bot.getStatus(),
      admin: bot.ADMIN_NUMBER,
      user: user ? { username: user.username } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar o estado do bot.' });
  }
});

app.post('/api/reply', async (req, res) => {
  const { number, text } = req.body || {};
  if (!number || !text) {
    return res.status(400).json({ error: 'Informe "number" e "text".' });
  }

  try {
    const conversation = await bot.sendToClient(number, text);
    bot.setActiveTarget(number);
    io.emit('message', conversation);
    io.emit('active-target', bot.getActiveTarget());
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reply-media', upload.single('file'), async (req, res) => {
  const { number, caption = '' } = req.body || {};
  if (!number || !req.file) {
    return res.status(400).json({ error: 'Informe o número e um arquivo.' });
  }

  const mimeType = req.file.mimetype || 'application/octet-stream';
  const type = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : 'document';
  const safeName = req.file.originalname.replace(/[^a-z0-9._-]/gi, '_');
  const storedName = `${crypto.randomUUID()}-${safeName}`;
  const filePath = path.join(mediaDir, storedName);

  try {
    fs.writeFileSync(filePath, req.file.buffer);
    const conversation = await bot.sendMediaToClient(number, {
      type,
      buffer: req.file.buffer,
      mimeType,
      fileName: req.file.originalname,
      caption: caption.trim(),
      mediaUrl: `/media/${storedName}`,
    });
    bot.setActiveTarget(number);
    io.emit('message', conversation);
    io.emit('active-target', bot.getActiveTarget());
    res.json({ ok: true, conversation });
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assumir', (req, res) => {
  const { number } = req.body || {};
  const activeTarget = bot.setActiveTarget(number || null);
  io.emit('active-target', activeTarget);
  res.json({ ok: true, activeTarget });
});

app.post('/api/conversation/block', async (req, res) => {
  const { number, blocked } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const canonicalNumber = await store.resolveConversationNumber(number);
    const conversation = await store.setBlocked(canonicalNumber, blocked);
    io.emit('message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversation/clear', async (req, res) => {
  const { number } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const conversation = await store.clearConversation(number);
    io.emit('message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversation/delete', async (req, res) => {
  const { number } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    await store.deleteConversation(number);
    io.emit('conversation:deleted', number);
    res.json({ ok: true, number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- WebSocket ----------
// A API de interação (assumir/reply) já está protegida pela sessão; aqui
// entregamos o estado inicial assim que o painel conecta.
io.on('connection', async (socket) => {
  try {
    const user = await db.get('SELECT username FROM users WHERE id = ?', [socket.request.session?.userId]);
    socket.emit('init', {
      conversations: await store.getAll(),
      activeTarget: bot.getActiveTarget(),
      status: bot.getStatus(),
      admin: bot.ADMIN_NUMBER,
      user: user ? { username: user.username } : null,
    });
  } catch (err) {
    console.error('[SOCKET] Falha ao enviar estado inicial:', err);
  }
});

emitter.on('status', (status) => io.emit('status', status));
emitter.on('message', (conversation) => io.emit('message', conversation));
emitter.on('active-target', (target) => io.emit('active-target', target));
emitter.on('log', (line) => io.emit('log', line));

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
db.ready.then(() => {
  server.listen(PORT, () => {
    console.log(`🖥️  Servidor rodando na porta ${PORT}`);
  });

  bot.startBot(emitter).catch((err) => {
    console.error('❌ Erro ao iniciar o bot:', err);
    emitter.emit('log', `Erro ao iniciar o bot: ${err.message}`);
  });
}).catch((err) => {
  console.error('❌ Não foi possível inicializar o banco de dados:', err);
  process.exitCode = 1;
});
