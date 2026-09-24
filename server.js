const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const session = require('express-session');
const { Server } = require('socket.io');

const db = require('./db');
const store = require('./store');
const BotManager = require('./bot-manager');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'bot-wap-secret-key-super-safe',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: allowedOrigins.length ? 'none' : 'lax',
    secure: 'auto',
  },
});
const io = new Server(server, {
  cors: allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined,
});
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const bot = new BotManager({ storageDir: STORAGE_DIR });
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

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  if (!value || value.length < 3 || value.length > 40) {
    return 'O ID deve ter entre 3 e 40 caracteres.';
  }
  if (!/^[a-z0-9_.-]+$/.test(value)) {
    return 'O ID só pode conter letras, números, ponto, hífen e sublinhado.';
  }
  return null;
}

function normalizeWhatsappNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateWhatsappNumber(value) {
  if (!/^55\d{2}9\d{8}$/.test(value)) return 'Informe o número no formato +55 (DDD) 9XXXX-XXXX.';
  return null;
}

async function getSessionUser(req) {
  const user = await db.get('SELECT id, username, display_name, whatsapp_number FROM users WHERE id = ?', [req.session.userId]);
  if (!user) throw new Error('Usuário da sessão não encontrado.');
  return user;
}

app.use(express.json());
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Configuração de Sessão ----------
app.use(sessionMiddleware);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// ---------- Middleware de Proteção ----------
const DASHBOARD_HTML = path.join(__dirname, 'public', 'dashboard.html');

// Páginas do app — cada rota com URL própria
const APP_PAGES = [
  '/atendimento',
  '/dashboard',
  '/kanban',
  '/campanhas',
  '/fluxos',
  '/contatos',
  '/webhooks',
  '/configuracoes',
];

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/?redirect=' + encodeURIComponent(req.originalUrl));
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
}

// Rota legada /dashboard.html
app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(DASHBOARD_HTML);
});

// Rotas de página com URL semântica
APP_PAGES.forEach((pagePath) => {
  app.get(pagePath, requireAuth, (req, res) => {
    res.sendFile(DASHBOARD_HTML);
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/register') return next();
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }
  next();
});

app.use('/media', (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).end();
  }
  next();
}, (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).end();
  express.static(path.join(STORAGE_DIR, 'users', String(userId), 'media'))(req, res, next);
});
app.use('/app.js', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rotas de Autenticação ----------
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  const username = normalizeUsername(req.body?.username);
  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });

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

app.post('/api/register', async (req, res) => {
  const { displayName, password, confirmPassword } = req.body || {};
  const cleanUsername = normalizeUsername(req.body?.username);
  const whatsappNumber = normalizeWhatsappNumber(req.body?.whatsappNumber);
  const cleanDisplayName = String(displayName || cleanUsername).trim();

  const usernameError = validateUsername(cleanUsername);
  if (usernameError) return res.status(400).json({ error: usernameError });
  const whatsappError = validateWhatsappNumber(whatsappNumber);
  if (whatsappError) return res.status(400).json({ error: whatsappError });
  if (!cleanDisplayName || cleanDisplayName.length > 60) {
    return res.status(400).json({ error: 'O nome exibido deve ter entre 1 e 60 caracteres.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'A confirmação da senha não confere.' });
  }

  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [cleanUsername]);
    if (existing) return res.status(409).json({ error: 'Esse ID já está em uso.' });
    const existingPhone = await db.get('SELECT id FROM users WHERE whatsapp_number = ?', [whatsappNumber]);
    if (existingPhone) return res.status(409).json({ error: 'Esse número WhatsApp já está vinculado a outro cadastro.' });
    await db.run('INSERT INTO users (username, display_name, whatsapp_number, password) VALUES (?, ?, ?, ?)', [cleanUsername, cleanDisplayName, whatsappNumber, hashPassword(password)]);
    const user = await db.get('SELECT id, username, display_name, whatsapp_number FROM users WHERE username = ?', [cleanUsername]);
    req.session.userId = user.id;
    bot.ensureWorker(user);
    res.status(201).json({ ok: true, username: user.username, displayName: user.display_name, whatsappNumber: user.whatsapp_number });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') {
      return res.status(409).json({ error: 'Esse usuário já está em uso.' });
    }
    console.error('[REGISTER]', err);
    res.status(500).json({ error: 'Erro ao criar a conta.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/profile', async (req, res) => {
  try {
    const user = await db.get('SELECT id, username, display_name, whatsapp_number FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
    res.json({ username: user.username, displayName: user.display_name || user.username, whatsappNumber: user.whatsapp_number });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar o perfil.' });
  }
});

app.put('/api/profile', async (req, res) => {
  const { displayName, whatsappNumber, currentPassword, newPassword, confirmPassword } = req.body || {};
  const cleanUsername = normalizeUsername(req.body?.username);
  const cleanDisplayName = String(displayName || cleanUsername).trim();
  const cleanWhatsappNumber = normalizeWhatsappNumber(whatsappNumber);

  const usernameError = validateUsername(cleanUsername);
  if (usernameError) return res.status(400).json({ error: usernameError });
  if (!cleanDisplayName || cleanDisplayName.length > 60) {
    return res.status(400).json({ error: 'O nome exibido deve ter entre 1 e 60 caracteres.' });
  }
  const whatsappError = validateWhatsappNumber(cleanWhatsappNumber);
  if (whatsappError) return res.status(400).json({ error: whatsappError });
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

    const duplicate = await db.get('SELECT id FROM users WHERE username = ? AND id <> ?', [cleanUsername, user.id]);
    if (duplicate) return res.status(409).json({ error: 'Esse ID já está em uso.' });
    const duplicatePhone = await db.get('SELECT id FROM users WHERE whatsapp_number = ? AND id <> ?', [cleanWhatsappNumber, user.id]);
    if (duplicatePhone) return res.status(409).json({ error: 'Esse número WhatsApp já está vinculado a outro cadastro.' });

    const password = newPassword ? hashPassword(newPassword) : user.password;
    await db.run('UPDATE users SET username = ?, display_name = ?, whatsapp_number = ?, password = ? WHERE id = ?', [cleanUsername, cleanDisplayName, cleanWhatsappNumber, password, user.id]);
    const updatedUser = { id: user.id, username: cleanUsername, display_name: cleanDisplayName, whatsapp_number: cleanWhatsappNumber };
    bot.restart(updatedUser);
    res.json({ ok: true, username: cleanUsername, displayName: cleanDisplayName, whatsappNumber: cleanWhatsappNumber });
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
    const user = await getSessionUser(req);
    const result = await bot.disconnect(user);
    res.json({ ok: result.ok, status: result.status });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao desconectar o WhatsApp.' });
  }
});

// ---------- REST API — Estado e Mensagens ----------
app.get('/api/state', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const state = await bot.state(user);
    res.json({
      ...state,
      user: { username: user.username, displayName: user.display_name || user.username, whatsappNumber: user.whatsapp_number },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar o estado do bot.' });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    res.json({ contacts: await bot.request(user, 'contacts') });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar os contatos.' });
  }
});

app.post('/api/reply', async (req, res) => {
  const { number, text } = req.body || {};
  if (!number || !text) {
    return res.status(400).json({ error: 'Informe "number" e "text".' });
  }

  try {
    const user = await getSessionUser(req);
    const displayName = user?.display_name || user?.username || '';
    const result = await bot.reply(user, number, text, displayName);
    const conversation = result.conversation;
    io.to(`user:${user.id}`).emit('message', conversation);
    io.to(`user:${user.id}`).emit('active-target', result.activeTarget);
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
  const userMediaDir = path.join(STORAGE_DIR, 'users', String(req.session.userId), 'media');
  fs.mkdirSync(userMediaDir, { recursive: true });
  const filePath = path.join(userMediaDir, storedName);

  try {
    const user = await getSessionUser(req);
    const displayName = user?.display_name || user?.username || '';
    fs.writeFileSync(filePath, req.file.buffer);
    const result = await bot.replyMedia(user, number, {
      type,
      buffer: req.file.buffer,
      mimeType,
      fileName: req.file.originalname,
      caption: caption.trim(),
      mediaUrl: `/media/${storedName}`,
    }, displayName);
    const conversation = result.conversation;
    io.to(`user:${user.id}`).emit('message', conversation);
    io.to(`user:${user.id}`).emit('active-target', result.activeTarget);
    res.json({ ok: true, conversation });
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assumir', (req, res) => {
  getSessionUser(req).then((user) => bot.assume(user, req.body?.number || null).then((result) => {
    io.to(`user:${user.id}`).emit('active-target', result.activeTarget);
    res.json({ ok: true, activeTarget: result.activeTarget });
  })).catch((err) => res.status(500).json({ error: err.message }));
});

app.post('/api/conversation/block', async (req, res) => {
  const { number, blocked } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const user = await getSessionUser(req);
    const result = await bot.block(user, number, blocked);
    const conversation = result.conversation;
    io.to(`user:${user.id}`).emit('message', conversation);
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
    const user = await getSessionUser(req);
    const result = await bot.clear(user, number);
    const conversation = result.conversation;
    io.to(`user:${user.id}`).emit('message', conversation);
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
    const user = await getSessionUser(req);
    const result = await bot.delete(user, number);
    const conversation = result.conversation;
    io.to(`user:${user.id}`).emit('conversation:deleted', { number, conversation });
    res.json({ ok: true, number, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tags de conversa
app.get('/api/conversation/:number/tags', async (req, res) => {
  try {
    const tags = await store.getConversationTags(req.params.number);
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversation/:number/tags', async (req, res) => {
  try {
    const { tags } = req.body || {};
    const conversation = await store.setConversationTags(req.params.number, tags || []);
    const user = await getSessionUser(req);
    io.to(`user:${user.id}`).emit('message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tags em massa nas conversas
app.post('/api/conversations/bulk-tags', async (req, res) => {
  try {
    const { numbers, tags, action } = req.body || {};
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: 'Informe uma lista de números.' });
    }
    const user = await getSessionUser(req);
    const updated = [];
    for (const number of numbers) {
      let currentTags = await store.getConversationTags(number);
      if (action === 'add') {
        const newTags = [...new Set([...currentTags, ...(tags || [])])];
        const conversation = await store.setConversationTags(number, newTags);
        updated.push(conversation);
        io.to(`user:${user.id}`).emit('message', conversation);
      } else if (action === 'remove') {
        const newTags = currentTags.filter((t) => !(tags || []).includes(t));
        const conversation = await store.setConversationTags(number, newTags);
        updated.push(conversation);
        io.to(`user:${user.id}`).emit('message', conversation);
      } else {
        const conversation = await store.setConversationTags(number, tags || []);
        updated.push(conversation);
        io.to(`user:${user.id}`).emit('message', conversation);
      }
    }
    res.json({ ok: true, updated: updated.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Finalizar/Reabrir conversa
app.post('/api/conversation/:number/finalize', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const conversation = await store.finalizeConversation(req.params.number);
    io.to(`user:${user.id}`).emit('message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversation/:number/reopen', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const conversation = await store.reopenConversation(req.params.number);
    io.to(`user:${user.id}`).emit('message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Conversas finalizadas
app.get('/api/conversations/finalized', async (req, res) => {
  try {
    const { chip, from, to, search } = req.query;
    let sql = 'SELECT * FROM conversations WHERE is_finalized = 1';
    const params = [];
    if (chip) { sql += ' AND chip = ?'; params.push(chip); }
    if (from) { sql += ' AND finalized_at >= ?'; params.push(from); }
    if (to) { sql += ' AND finalized_at <= ?'; params.push(to); }
    if (search) { sql += ' AND (name LIKE ? OR number LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY finalized_at DESC LIMIT 100';
    const rows = await db.all(sql, params);
    res.json({ conversations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Tags CRUD ----------
app.get('/api/tags', async (req, res) => {
  try {
    res.json({ tags: await store.getTags() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags', async (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da tag.' });
    const tag = await store.createTag(name, color);
    res.status(201).json({ ok: true, tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tags/:id', async (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da tag.' });
    const tag = await store.updateTag(req.params.id, name, color);
    res.json({ ok: true, tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    await store.deleteTag(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Departments CRUD ----------
app.get('/api/departments', async (req, res) => {
  try {
    res.json({ departments: await store.getDepartments() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do departamento.' });
    const department = await store.createDepartment(name, description);
    res.status(201).json({ ok: true, department });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/departments/:id', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do departamento.' });
    const department = await store.updateDepartment(req.params.id, name, description);
    res.json({ ok: true, department });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  try {
    await store.deleteDepartment(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Campaigns CRUD ----------
app.get('/api/campaigns', async (req, res) => {
  try {
    res.json({ campaigns: await store.getCampaigns() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { name, message, target_tags, blocked_tags, scheduled_at, chip } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem da campanha.' });
    const campaign = await store.createCampaign({ name, message, target_tags, blocked_tags, scheduled_at, chip });
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/campaigns/:id', async (req, res) => {
  try {
    const { name, message, target_tags, blocked_tags, scheduled_at, chip } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem da campanha.' });
    const campaign = await store.updateCampaign(req.params.id, { name, message, target_tags, blocked_tags, scheduled_at, chip });
    res.json({ ok: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    await store.deleteCampaign(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/duplicate', async (req, res) => {
  try {
    const campaign = await store.duplicateCampaign(req.params.id);
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Webhooks CRUD ----------
app.get('/api/webhooks', async (req, res) => {
  try {
    const { search } = req.query;
    let webhooks = await store.getWebhooks();
    if (search) {
      const term = search.toLowerCase();
      webhooks = webhooks.filter((w) => w.name.toLowerCase().includes(term) || w.url.toLowerCase().includes(term));
    }
    res.json({ webhooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/webhooks', async (req, res) => {
  try {
    const { name, url, events, secret, active } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Informe nome e URL do webhook.' });
    const webhook = await store.createWebhook({ name, url, events, secret, active });
    res.status(201).json({ ok: true, webhook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/webhooks/:id', async (req, res) => {
  try {
    const { name, url, events, secret, active } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Informe nome e URL do webhook.' });
    const webhook = await store.updateWebhook(req.params.id, { name, url, events, secret, active });
    res.json({ ok: true, webhook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/webhooks/:id', async (req, res) => {
  try {
    await store.deleteWebhook(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Kanban CRUD ----------
app.get('/api/kanban', async (req, res) => {
  try {
    const [columns, opportunities] = await Promise.all([store.getKanbanColumns(), store.getOpportunities()]);
    res.json({ columns, opportunities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban/columns', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da coluna.' });
    const column = await store.createKanbanColumn(name);
    res.status(201).json({ ok: true, column });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/kanban/columns/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da coluna.' });
    const column = await store.updateKanbanColumn(req.params.id, name);
    res.json({ ok: true, column });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/kanban/columns/:id', async (req, res) => {
  try {
    await store.deleteKanbanColumn(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities', async (req, res) => {
  try {
    const { title, contact_number, contact_name, value, column_id } = req.body || {};
    if (!title || !column_id) return res.status(400).json({ error: 'Informe título e coluna.' });
    const opportunity = await store.createOpportunity({ title, contact_number, contact_name, value, column_id });
    res.status(201).json({ ok: true, opportunity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/kanban/opportunities/:id', async (req, res) => {
  try {
    const opportunity = await store.updateOpportunity(req.params.id, req.body || {});
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities/:id/win', async (req, res) => {
  try {
    const opportunity = await store.winOpportunity(req.params.id);
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities/:id/lose', async (req, res) => {
  try {
    const { loss_reason_id } = req.body || {};
    const opportunity = await store.loseOpportunity(req.params.id, loss_reason_id);
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/kanban/opportunities/:id', async (req, res) => {
  try {
    await store.deleteOpportunity(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Loss Reasons CRUD ----------
app.get('/api/loss-reasons', async (req, res) => {
  try {
    res.json({ reasons: await store.getLossReasons() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loss-reasons', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do motivo.' });
    const reason = await store.createLossReason(name);
    res.status(201).json({ ok: true, reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/loss-reasons/:id', async (req, res) => {
  try {
    await store.deleteLossReason(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Flows CRUD ----------
app.get('/api/flows', async (req, res) => {
  try {
    res.json({ flows: await store.getFlows() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/flows', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do fluxo.' });
    const flow = await store.createFlow({ name, description });
    res.status(201).json({ ok: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/flows/:id', async (req, res) => {
  try {
    const flow = await store.updateFlow(req.params.id, req.body || {});
    res.json({ ok: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/flows/:id/duplicate', async (req, res) => {
  try {
    const flow = await store.duplicateFlow(req.params.id);
    res.status(201).json({ ok: true, flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/flows/:id', async (req, res) => {
  try {
    await store.deleteFlow(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Global Variables ----------
app.get('/api/global-variables', async (req, res) => {
  try {
    res.json({ variables: await store.getGlobalVariables() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/global-variables', async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Informe a chave.' });
    const variable = await store.setGlobalVariable(key, value || '');
    res.json({ ok: true, variable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/global-variables/:key', async (req, res) => {
  try {
    await store.deleteGlobalVariable(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Follow-ups ----------
app.get('/api/followups', async (req, res) => {
  try {
    res.json({ followups: await store.getFollowups() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/followups', async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem.' });
    const followup = await store.createFollowup(req.body);
    res.status(201).json({ ok: true, followup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/followups/:id', async (req, res) => {
  try {
    const followup = await store.updateFollowup(req.params.id, req.body || {});
    res.json({ ok: true, followup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/followups/:id', async (req, res) => {
  try {
    await store.deleteFollowup(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Contact tags & variables ----------
app.put('/api/contacts/:number/tags', async (req, res) => {
  try {
    const { tags } = req.body || {};
    const contact = await store.updateContactTags(req.params.number, tags || []);
    res.json({ ok: true, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/contacts/:number/variables', async (req, res) => {
  try {
    const { variables } = req.body || {};
    const contact = await store.updateContactVariables(req.params.number, variables || {});
    res.json({ ok: true, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Dashboard Stats ----------
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const conversations = await db.all('SELECT number, is_finalized, chip FROM conversations', []);
    const open = conversations.filter((c) => !c.is_finalized).length;
    const finalized = conversations.filter((c) => c.is_finalized).length;
    const contacts = await db.get('SELECT COUNT(*) as c FROM contacts', []);
    const messages = await db.get('SELECT COUNT(*) as c FROM messages', []);
    const opportunities = await db.all('SELECT status, value FROM opportunities', []);
    const wonOpps = opportunities.filter((o) => o.status === 'won');
    const revenue = wonOpps.reduce((sum, o) => sum + (o.value || 0), 0);
    const conversionRate = opportunities.length > 0 ? (wonOpps.length / opportunities.length * 100).toFixed(1) : 0;
    res.json({
      open,
      finalized,
      contacts: Number(contacts?.c || 0),
      messages: Number(messages?.c || 0),
      opportunities: opportunities.length,
      wonOpportunities: wonOpps.length,
      revenue,
      conversionRate: Number(conversionRate),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- WebSocket ----------
io.on('connection', async (socket) => {
  try {
    const user = await db.get('SELECT id, username, display_name, whatsapp_number FROM users WHERE id = ?', [socket.request.session?.userId]);
    if (!user) {
      socket.emit('unauthorized');
      return socket.disconnect(true);
    }
    socket.join(`user:${user.id}`);
    const state = await bot.state(user);
    socket.emit('init', {
      ...state,
      user: user ? { username: user.username, displayName: user.display_name || user.username, whatsappNumber: user.whatsapp_number } : null,
    });
  } catch (err) {
    console.error('[SOCKET] Falha ao enviar estado inicial:', err);
    socket.emit('init-error', { error: err.message });
  }
});

bot.on('event', ({ userId, event, payload }) => {
  io.to(`user:${userId}`).emit(event, payload);
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
db.ready.then(() => {
  server.listen(PORT, () => {
    console.log(`🖥️  Servidor rodando na porta ${PORT}`);
  });

  db.all('SELECT id, username, display_name, whatsapp_number FROM users WHERE whatsapp_number <> \'\'')
    .then((users) => users.forEach((user) => bot.ensureWorker(user)))
    .catch((err) => console.error('❌ Erro ao iniciar sessões WhatsApp:', err));
}).catch((err) => {
  console.error('❌ Não foi possível inicializar o banco de dados:', err);
  process.exitCode = 1;
});
