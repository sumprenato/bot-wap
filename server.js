const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const session = require('express-session');
const { isAuthenticated, startSession, enforceSessionExpiry } = require('./auth-session');
const { Server } = require('socket.io');

const db = require('./db');
const store = require('./store');
const { parseContactCsv, decodeContactCsv } = require('./contact-import');
const BotManager = require('./bot-manager');
const rbac = require('./rbac');
const authorization = require('./authorization');
const { dashboardActivity, dashboardPeriod } = require('./dashboard-data');
const { contactsWorkbook, dashboardWorkbook, sendWorkbook } = require('./excel-export');

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
    maxAge: null,
    path: '/',
    sameSite: allowedOrigins.length ? 'none' : 'lax',
    secure: 'auto',
  },
});
const io = new Server(server, {
  cors: allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined,
});
const { resolveStorageDir, reportStorage } = require('./storage-path');
const STORAGE_DIR = resolveStorageDir();
const bot = new BotManager({ storageDir: STORAGE_DIR });
const flowService = new (require('./flows/service').FlowService)({ requestChip: (...args) => requestChip(...args), broadcast: (...args) => broadcastAccount(...args) });
bot.verifyIdentity = (chipId, number) => require('./chip-identity').bindIdentity(db, chipId, number);
bot.authorizeFlow = (...args) => flowService.authorizeSend(...args);
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
  if (req.access) return req.access.user;
  const user = await db.get('SELECT id, username, display_name, whatsapp_number FROM users WHERE id = ?', [req.session.userId]);
  if (!user) throw new Error('Usuário da sessão não encontrado.');
  return user;
}

async function getUserChips(userId) {
  const access = await rbac.accessFor(userId);
  if (!access) return [];
  const chips = await db.all('SELECT * FROM chips WHERE user_id = ? ORDER BY created_at ASC', [access.accountId]);
  const visible = [];
  for (const chip of chips) {
    if (rbac.departmentAllowed(access, chip.department_id)) { visible.push(chip); continue; }
    if (!rbac.can(access, 'atendimento.visualizar') && !rbac.can(access, 'contatos.visualizar')) continue;
    const state = await requestChip(chip, 'state', { metadataOnly: true });
    const scoped = rbac.can(access, 'contatos.visualizar') ? { ...access, permissions: [...access.permissions, 'atendimento.visualizar_todos'] } : access;
    if (Object.values(state.conversations || {}).some((conversation) => rbac.conversationAllowed(scoped, conversation, chip))) visible.push(chip);
  }
  return visible;
}

// Retorna o primeiro chip online do usuário; se nenhum online, retorna o primeiro.
async function getPrimaryChip(userId) {
  const chips = await getUserChips(userId);
  if (!chips.length) return null;
  return chips.find((c) => c.is_primary) || chips[0];
}

async function getActiveChips(userId) {
  const chips = await getUserChips(userId);
  return chips;
}

function stampConversation(chip, conversation) {
  return conversation ? { ...conversation, chipId: chip.id, chipName: chip.name } : conversation;
}
async function requestChip(chip, action, payload = {}, timeout) {
  const result = await bot.request(chip, action, payload, timeout);
  return result?.conversation ? { ...result, conversation: stampConversation(chip, result.conversation) } : result;
}
async function broadcastAccount(accountId, event, payload) {
  try {
    const chip = payload?.chipId ? await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [payload.chipId, accountId]) : null;
    for (const socket of io.sockets.sockets.values()) {
      if (!isAuthenticated(socket.request.session)) continue;
      const access = await rbac.accessFor(socket.request.session.userId);
      if (!access || access.accountId !== Number(accountId) || (socket.request.session.authVersion != null && socket.request.session.authVersion !== access.user.auth_version)) continue;
      if (chip && event !== 'message' && event !== 'conversation:deleted' && !rbac.departmentAllowed(access, chip.department_id)) continue;
      if (event === 'message' && (!rbac.can(access, 'atendimento.visualizar') || !rbac.conversationAllowed(access, payload, chip))) continue;
      if (event === 'conversation:deleted' && !rbac.conversationAllowed(access, payload.conversation || {}, chip)) continue;
      if (event === 'active-target' && !access.owner) continue;
      if (event === 'log' && !access.owner) continue;
      if (event === 'contact') { if (rbac.can(access, 'contatos.visualizar')) socket.emit('contacts:updated', { chipId: payload?.chipId, contactChanged: true }); continue; }
      if (event === 'contacts:updated' && !rbac.can(access, 'contatos.visualizar')) continue;
      if (event === 'profile:updated' && !access.owner) continue;
      if (['status', 'chip:status'].includes(event) && !rbac.can(access, 'atendimento.visualizar') && !rbac.can(access, 'chips.visualizar') && !rbac.can(access, 'contatos.visualizar')) continue;
      const value = ['status', 'chip:status'].includes(event) && !rbac.can(access, 'chips.gerenciar') ? { ...payload, qr: null } : payload;
      socket.emit(event, value);
    }
  } catch (error) { console.warn('[ACCESS] Falha ao distribuir atualização:', error.message); }
}
async function authorizationChanged(accountId) {
  for (const socket of io.sockets.sockets.values()) {
    const row = await db.get('SELECT account_id FROM users WHERE id = ?', [socket.request.session.userId]);
    if (row?.account_id !== accountId) continue;
    const access = await rbac.accessFor(socket.request.session.userId);
    if (!access || (socket.request.session.authVersion != null && socket.request.session.authVersion !== access.user.auth_version)) { socket.emit('unauthorized'); socket.disconnect(true); }
    else socket.emit('authorization:changed', { authorization: rbac.publicAccess(access) });
  }
}
async function getConversationChip(req, userId, { fallback = false } = {}) {
  const chips = await getUserChips(userId);
  const id = req.body?.chipId || req.query?.chipId;
  if (id) {
    const chip = chips.find((item) => String(item.id) === String(id));
    if (chip) { req.selectedChip = chip; return chip; }
    if (!fallback) throw Object.assign(new Error('Chip não encontrado nesta conta.'), { statusCode: 404 });
  }
  if (!id && !fallback && chips.length > 1) throw Object.assign(new Error('Selecione o chip para esta operação.'), { statusCode: 409 });
  req.selectedChip = chips.find((item) => item.is_primary) || chips[0] || null;
  return req.selectedChip;
}

app.use('/api/flows', express.json({ limit: '3mb' }));
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
app.use(enforceSessionExpiry);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// ---------- Middleware de Proteção ----------
const DASHBOARD_HTML = path.join(__dirname, 'public', 'dashboard.html');
const APP_PAGE_TITLES = {
  inbox: 'Atendimento — Convelya',
  overview: 'Dashboard — Convelya',
  kanban: 'Funis — Convelya',
  campaigns: 'Campanhas — Convelya',
  flows: 'Fluxos — Convelya',
  contacts: 'Contatos — Convelya',
  webhooks: 'Webhooks — Convelya',
  departments: 'Departamentos — Convelya',
  tags: 'Tags e rótulos — Convelya',
  chips: 'Meus chips — Convelya',
  settings: 'Configurações — Convelya',
  team: 'Equipe — Convelya',
};

function extractPageSection(html, page) {
  const marker = html.indexOf(`data-page-view="${page}"`);
  if (marker < 0) return null;
  const start = html.lastIndexOf('<section', marker);
  if (start < 0) return null;

  const tags = /<\/?section\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (match[0].startsWith('</')) depth--;
    else depth++;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return null;
}

function removeElementById(html, tagName, id) {
  const openingTag = new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
  if (!openingTag) return html;

  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tags.lastIndex = openingTag.index;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (match[0].startsWith('</')) depth--;
    else depth++;
    if (depth === 0) return html.slice(0, openingTag.index) + html.slice(tags.lastIndex);
  }
  return html;
}

function extractElementById(html, tagName, id) {
  const openingTag = new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
  if (!openingTag) return null;
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tags.lastIndex = openingTag.index;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (match[0].startsWith('</')) depth--;
    else depth++;
    if (depth === 0) return html.slice(openingTag.index, tags.lastIndex);
  }
  return null;
}

function renderAppPage(page, access) {
  const template = fs.readFileSync(DASHBOARD_HTML, 'utf8');
  const section = extractPageSection(template, page);
  const mainStart = template.indexOf('<main class="chat">');
  const contentStart = template.indexOf('>', mainStart) + 1;
  const mainEnd = template.indexOf('</main>', contentStart);
  if (!section || mainStart < 0 || contentStart <= 0 || mainEnd < 0) {
    throw new Error(`Não foi possível montar a página: ${page}`);
  }

  let activeSection = section.replace('class="page-view', 'class="page-view is-active');
  const pageGroups = {
    chips: ['chipsGroup'],
    tags: ['tagsGroup'],
    departments: ['departmentsGroup'],
  };
  for (const groupId of pageGroups[page] || []) {
    const group = extractElementById(template, 'div', groupId);
    if (group) activeSection = activeSection.replace('</section>', `${group}</section>`);
  }
  let documentHtml = `${template.slice(0, contentStart)}\n${activeSection}\n${template.slice(mainEnd)}`;
  if (page !== 'inbox') documentHtml = removeElementById(documentHtml, 'aside', 'listSidebar');

  const pageEditors = {
    inbox: ['tagsModal', 'bulkTransferModal'],
    campaigns: ['campaignModal'],
    webhooks: ['webhookModal'],
    kanban: ['opportunityModal', 'loseModal', 'lossReasonsModal'],
    flows: ['flowModal', 'globalVarsModal'],
    team: ['teamMemberModal'],
  };
  const sharedEditors = ['confirmModal', 'photoViewModal'];
  const allEditors = [
    'tagsModal', 'bulkTransferModal', 'campaignModal', 'webhookModal',
    'opportunityModal', 'loseModal', 'lossReasonsModal', 'flowModal', 'globalVarsModal', 'teamMemberModal', 'photoViewModal',
  ];
  const retainedEditors = new Set([...sharedEditors, ...(pageEditors[page] || [])]);
  for (const editor of allEditors) {
    if (!retainedEditors.has(editor)) documentHtml = removeElementById(documentHtml, 'div', editor);
  }

  documentHtml = documentHtml.replace(/<title>[^<]*<\/title>/, `<title>${APP_PAGE_TITLES[page] || 'Convelya'}</title>`);
  // Render the correct navigation before scripts load (including slow/F5 loads).
  documentHtml = documentHtml.replace('<body>', `<body data-page="${page}">`);
  if (page !== 'inbox') documentHtml = documentHtml.replace('<div class="app">', '<div class="app app--management">');
  // Real links work from the first painted frame, even before React loads.
  documentHtml = documentHtml.replace(/<button\b([^>]*\bclass="nav-item[^>]*\bdata-page="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g, (tag, attributes, target, content) => {
    const route = APP_PAGES.find(([, name]) => name === target)?.[0];
    if (!route) return tag;
    return `<a${attributes.replace(/\s+type="button"/, '')} href="${route}">${content}</a>`;
  });
  documentHtml = documentHtml.replace(/<a\b[^>]*\bdata-page="([^"]+)"[^>]*>/g, (tag, target) => {
    tag = tag.replace('nav-item is-active', 'nav-item');
    return target === page ? tag.replace('class="nav-item"', 'class="nav-item is-active" aria-current="page"') : tag;
  });
  const pageLabel = (APP_PAGE_TITLES[page] || 'Convelya').split(' — ')[0];
  documentHtml = documentHtml.replace(/(<strong id="currentPageLabel">)[^<]*(<\/strong>)/, (_, start, end) => `${start}${pageLabel}${end}`);
  const pageStyles = {
    campaigns: '/assets/css/pages/campaigns.css',
    webhooks: '/assets/css/pages/webhooks.css',
    kanban: '/assets/css/pages/kanban.css',
    flows: '/assets/css/pages/flows.css',
    chips: '/assets/css/pages/chips.css',
    team: '/assets/css/pages/team.css',
  };
  const pageStyle = pageStyles[page] ? `<link rel="stylesheet" href="${pageStyles[page]}">` : '';
  const sharedCardStyles = ['campaigns', 'webhooks', 'flows', 'chips', 'settings', 'team'].includes(page)
    ? '<link rel="stylesheet" href="/assets/css/components.css">'
    : '';
  documentHtml = documentHtml.replace('</head>', `${pageStyle}${sharedCardStyles}</head>`);
  if (access) documentHtml = documentHtml.replace(/<a\b[^>]*data-page="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (html, target) => !rbac.pagePermissions[target] || rbac.can(access, rbac.pagePermissions[target]) ? html : html.replace('<a ', '<a hidden '));
  return documentHtml;
}

function sendAppPage(res, page) {
  try {
    res.type('html').send(renderAppPage(page, res.locals.access));
  } catch (error) {
    console.error('[PAGES] Falha ao montar página:', error.message);
    res.status(500).send('Não foi possível carregar esta página.');
  }
}

// Páginas do app — cada rota com URL própria
const APP_PAGES = [
  ['/atendimento', 'inbox'],
  ['/dashboard', 'overview'],
  ['/funis', 'kanban'],
  ['/campanhas', 'campaigns'],
  ['/fluxos', 'flows'],
  ['/contatos', 'contacts'],
  ['/webhooks', 'webhooks'],
  ['/departamentos', 'departments'],
  ['/tags', 'tags'],
  ['/chips', 'chips'],
  ['/configuracoes', 'settings'],
  ['/equipe', 'team'],
];

async function requireAuth(req, res, next) {
  if (!isAuthenticated(req.session)) {
    return res.redirect('/?redirect=' + encodeURIComponent(req.originalUrl));
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const access = await rbac.accessFor(req.session.userId);
  if (!access || (req.session.authVersion != null && req.session.authVersion !== access.user.auth_version)) return res.redirect('/');
  const page = APP_PAGES.find(([url]) => url === req.path.replace(/\/$/, ''))?.[1] || (req.path === '/kanban' ? 'kanban' : 'inbox');
  const permission = rbac.pagePermissions[page];
  if (permission && !rbac.can(access, permission)) return res.status(403).send('Acesso não autorizado. Entre em Minha conta para consultar seu perfil.');
  res.locals.access = access;
  next();
}

// Rota legada /dashboard.html
app.get('/dashboard.html', requireAuth, (req, res) => {
  sendAppPage(res, 'inbox');
});

app.get('/kanban', requireAuth, (req, res) => {
  res.redirect(302, '/funis' + req.originalUrl.slice(req.path.length));
});

// Rotas de página com URL semântica
APP_PAGES.forEach(([pagePath, page]) => {
  app.get(pagePath, requireAuth, (req, res) => {
    sendAppPage(res, page);
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/register' || req.path === '/session') return next();
  if (!isAuthenticated(req.session)) {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (['/login', '/register', '/session'].includes(req.path)) return next();
  return authorization.middleware({ botRequest: (chip, action, payload) => requestChip(chip, action, payload) })(req, res, next);
});
app.get('/api/authorization', (req, res) => res.json({ authorization: rbac.publicAccess(req.access), catalog: rbac.groups }));

app.get('/api/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const access = isAuthenticated(req.session) ? await rbac.accessFor(req.session.userId) : null;
  const authenticated = !!access && (req.session.authVersion == null || req.session.authVersion === access.user.auth_version);
  res.json({ authenticated, ...(authenticated ? {
    rememberLogin: req.session.rememberLogin === true,
    expiresAt: req.session.authExpiresAt,
    remainingMs: req.session.authExpiresAt - Date.now(),
    authorization: rbac.publicAccess(access),
    destination: APP_PAGES.find(([, page]) => !rbac.pagePermissions[page] || rbac.can(access, rbac.pagePermissions[page]))?.[0] || '/configuracoes',
  } : {}) });
});

app.use('/media', async (req, res, next) => {
  if (!isAuthenticated(req.session)) return res.status(401).end();
  const access = await rbac.accessFor(req.session.userId);
  if (!access || (req.session.authVersion != null && req.session.authVersion !== access.user.auth_version)) return res.status(401).end();
  req.access = access;
  if (!rbac.can(access, 'atendimento.visualizar')) return res.status(403).end();
  if (!access.owner) {
    const chips = await getUserChips(access.user.id);
    let permitted = false;
    for (const chip of chips) {
      const state = await requestChip(chip, 'state');
      if (Object.values(state.conversations || {}).some((conversation) => rbac.conversationAllowed(access, conversation, chip) && conversation.messages.some((message) => message.mediaUrl === '/media' + req.path))) { permitted = true; break; }
    }
    if (!permitted) return res.status(404).end();
  }
  next();
});
app.get('/media/chips/:chipId/:fileName', async (req, res) => {
  if (!isAuthenticated(req.session)) return res.status(401).end();
  try {
    const chip = await db.get(
      'SELECT id FROM chips WHERE id = ? AND user_id = ?',
      [req.params.chipId, req.access.accountId]
    );
    if (!chip) return res.status(404).end();
    return res.sendFile(req.params.fileName, {
      root: path.join(STORAGE_DIR, 'chips', String(chip.id), 'media'),
    }, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end();
    });
  } catch (err) {
    console.error('[MEDIA] Falha ao servir anexo:', err.message);
    res.status(500).end();
  }
});
app.use('/media', (req, res, next) => {
  if (!isAuthenticated(req.session)) {
    return res.status(401).end();
  }
  next();
}, (req, res, next) => {
  const userId = req.access.accountId;
  if (!userId) return res.status(401).end();
  express.static(path.join(STORAGE_DIR, 'users', String(userId), 'media'))(req, res, next);
});
app.use(['/assets/js/app.js', '/assets/js/site.js'], (req, res, next) => {
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
    if (!row || row.status !== 'active' || row.deleted_at || !verifyPassword(password, row.password)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    if (!row.password.startsWith('scrypt:')) {
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(password), row.id]);
    }
    await startSession(req, row.id, req.body?.rememberLogin);
    req.session.authVersion = row.auth_version || 0;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    const access = await rbac.accessFor(row.id);
    const destination = APP_PAGES.find(([, page]) => !rbac.pagePermissions[page] || rbac.can(access, rbac.pagePermissions[page]))?.[0] || '/configuracoes';
    res.json({ ok: true, destination, authorization: rbac.publicAccess(access) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/register', async (req, res) => {
  const { displayName, password, confirmPassword } = req.body || {};
  const cleanUsername = normalizeUsername(req.body?.username);
  const cleanDisplayName = String(displayName || cleanUsername).trim();

  const usernameError = validateUsername(cleanUsername);
  if (usernameError) return res.status(400).json({ error: usernameError });
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
    await db.run('INSERT INTO users (username, display_name, whatsapp_number, password) VALUES (?, ?, ?, ?)', [cleanUsername, cleanDisplayName, '', hashPassword(password)]);
    const user = await db.get('SELECT id, username, display_name FROM users WHERE username = ?', [cleanUsername]);
    await db.transaction(async () => {
      await db.run('INSERT INTO accounts(id, owner_id) VALUES (?,?)', [user.id, user.id]);
      await db.run("UPDATE users SET account_id = ?, role = ?, scope = 'account' WHERE id = ?", [user.id, rbac.roles.owner, user.id]);
    });
    await startSession(req, user.id);
    res.status(201).json({ ok: true, username: user.username, displayName: user.display_name });
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
    res.clearCookie('connect.sid', { path: '/' });
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
  const { displayName, currentPassword, newPassword, confirmPassword } = req.body || {};
  const cleanUsername = normalizeUsername(req.body?.username);
  const cleanDisplayName = String(displayName || cleanUsername).trim();

  const usernameError = validateUsername(cleanUsername);
  if (usernameError) return res.status(400).json({ error: usernameError });
  if (!cleanDisplayName || cleanDisplayName.length > 60) {
    return res.status(400).json({ error: 'O nome exibido deve ter entre 1 e 60 caracteres.' });
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

    const duplicate = await db.get('SELECT id FROM users WHERE username = ? AND id <> ?', [cleanUsername, user.id]);
    if (duplicate) return res.status(409).json({ error: 'Esse ID já está em uso.' });

    const password = newPassword ? hashPassword(newPassword) : user.password;
    await db.run('UPDATE users SET username = ?, display_name = ?, password = ? WHERE id = ?', [cleanUsername, cleanDisplayName, password, user.id]);
    res.json({ ok: true, username: cleanUsername, displayName: cleanDisplayName });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') {
      return res.status(409).json({ error: 'Esse usuário já está em uso.' });
    }
    console.error('[PROFILE]', err);
    res.status(500).json({ error: 'Erro ao atualizar o perfil.' });
  }
});

// Team uses the existing users/session tables with account authorization.
require('./team-access').install(app, { hashPassword, changed: authorizationChanged });
app.get('/api/team/options', async (req, res) => {
  const [departments, columns, tags, members] = await Promise.all([store.getDepartments(), store.getKanbanColumns(), store.getTags(), db.all("SELECT * FROM users WHERE account_id = ? AND deleted_at IS NULL AND status = 'active'", [req.access.accountId])]);
  res.json({ departments, columns, tags, members: members.filter((member) => req.access.owner || rbac.withinMember(req.access, member)).map((member) => ({ id: member.id, name: member.display_name || member.username, role: member.role })) });
});

app.post('/api/disconnect', async (req, res) => {
  const chipId = req.body?.chipId || req.query?.chipId;
  try {
    const user = await getSessionUser(req);
    if (chipId) {
      const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [chipId, user.account_id]);
      if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
      const result = await bot.disconnect(chip);
      res.json({ ok: result.ok, status: result.status });
    } else {
      // Desconecta o chip primário (compatibilidade)
      const primaryChip = await getPrimaryChip(user.id);
      if (!primaryChip) return res.json({ ok: true });
      const result = await bot.disconnect(primaryChip);
      res.json({ ok: result.ok, status: result.status });
    }
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Erro ao desconectar o WhatsApp.' });
  }
});

// ---------- REST API — Estado e Mensagens ----------
app.get('/api/state', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chips = await getActiveChips(user.id);
    const selectedChip = await getConversationChip(req, user.id, { fallback: true });
    const state = await bot.state(user, chips, selectedChip?.id);
    res.json(authorization.safeState(req.access, state, selectedChip));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar o estado do bot.' });
  }
});

async function scopedContacts(req) {
    const user = await getSessionUser(req);
    const selectedChip = await getConversationChip(req, user.id, { fallback: true });
    const chips = selectedChip ? [selectedChip] : [];
    const contactsByNumber = new Map();
    for (const chip of chips) {
      // Return the cached book immediately and reconcile it in the background.
      // The worker emits contacts:updated when WhatsApp finishes the snapshot.
      // Reading contacts must not start another full WhatsApp synchronization.
      const chipContacts = await requestChip(chip, 'contacts');
      let visibleNumbers = null;
      if (!req.access.owner && !(['department', 'account'].includes(req.access.scope) && rbac.departmentAllowed(req.access, chip.department_id))) {
        const state = await requestChip(chip, 'state');
        const contactAccess = { ...req.access, permissions: [...req.access.permissions, 'atendimento.visualizar_todos'] };
        visibleNumbers = new Set(Object.values(state.conversations || {}).filter((conversation) => rbac.conversationAllowed(contactAccess, conversation, chip)).flatMap((conversation) => [conversation.number, ...(conversation.aliases || [])]));
      }
      for (const contact of chipContacts || []) {
        if (visibleNumbers && !visibleNumbers.has(contact.number)) continue;
        const existing = contactsByNumber.get(contact.number);
        contactsByNumber.set(contact.number, existing
          ? { ...contact, ...existing, name: existing.name || contact.name, pushName: existing.pushName || contact.pushName }
          : contact);
      }
    }
    const contacts = [...contactsByNumber.values()].sort((a, b) =>
      String(a.name || a.number).localeCompare(String(b.name || b.number), 'pt-BR')
    );
    return contacts;
}
app.get('/api/contacts', async (req, res) => {
  try { res.json({ contacts: await scopedContacts(req) }); } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});
app.delete('/api/contacts/:number', async (req, res) => {
  try {
    const contact = (await scopedContacts(req)).find((item) => item.number === req.params.number);
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado no seu escopo.' });
    const chip = await getConversationChip(req, req.access.user.id, { fallback: true });
    await requestChip(chip, 'delete-contact', { number: contact.number });
    await rbac.audit(req.access, 'contacts.remove', null, contact, {});
    res.json({ ok: true });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

app.get('/api/account-settings', async (req, res) => {
  try { const row = await db.get('SELECT display_name FROM accounts WHERE id = ?', [req.access.accountId]); res.json({ name: row.display_name || '' }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/account-settings', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) return res.status(400).json({ error: 'Informe um nome de até 60 caracteres.' });
    await db.transaction(async () => {
      const access = await rbac.accessFor(req.session.userId);
      if (!rbac.can(access, 'configuracoes.editar')) rbac.fail();
      const before = await db.get('SELECT display_name FROM accounts WHERE id = ?', [access.accountId]);
      await db.run('UPDATE accounts SET display_name = ? WHERE id = ?', [name, access.accountId]);
      await rbac.audit(access, 'account.settings', null, before, { display_name: name });
    });
    res.json({ ok: true, name });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});
app.get('/api/contacts/export', async (req, res) => {
  try {
    let contacts = await scopedContacts(req);
    const search = String(req.query.search || '').toLocaleLowerCase('pt-BR');
    if (search) contacts = contacts.filter((contact) => `${contact.name} ${contact.number}`.toLocaleLowerCase('pt-BR').includes(search));
    if (req.query.tag) contacts = contacts.filter((contact) => contact.tags?.includes(req.query.tag));
    await rbac.audit(req.access, 'contacts.export', null, {}, { count: contacts.length });
    await sendWorkbook(res, contactsWorkbook(contacts), 'contatos-convelya.xlsx');
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

app.get('/api/whatsapp/profile/:number', async (req, res) => {
  const number = req.params.number;
  if (number !== 'me' && !/^\d{8,20}$/.test(number)) return res.status(400).json({ error: 'Número inválido.' });
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id, { fallback: true });
    const chips = chip ? [chip] : [];
    res.setHeader('Cache-Control', 'no-store');
    if (!chips.length) return res.json({ number, profilePic: '', connected: false });
    let fallback = { number, profilePic: '', connected: false };
    for (const chip of chips) {
      try {
        const result = await requestChip(chip, 'profile-picture', { number });
        fallback = result;
        if (result.profilePic) return res.json(result);
      } catch { /* Another connected chip may know this contact. */ }
    }
    res.json(fallback);
  } catch (error) {
    res.status(503).json({ error: 'Não foi possível carregar a foto agora. Tente novamente.' });
  }
});

const contactUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
}).single('file');

app.post('/api/contacts/import', (req, res) => {
  contactUpload(req, res, async (uploadError) => {
    if (uploadError) return res.status(400).json({ error: 'Envie um único arquivo CSV de até 2 MB.' });
    if (!req.file || !/\.csv$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Selecione um arquivo .csv.' });
    let parsed;
    try { parsed = parseContactCsv(decodeContactCsv(req.file.buffer)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (!parsed.contacts.length) return res.status(422).json({
      error: 'Nenhum contato válido encontrado. Corrija as linhas indicadas e tente novamente.',
      errors: parsed.errors.slice(0, 100), rejected: parsed.errors.length,
    });
    try {
      const user = await getSessionUser(req);
      const chip = await getConversationChip(req, user.id);
      if (!chip) return res.status(409).json({ error: 'Cadastre um chip em Meus chips antes de importar contatos.' });
      if (!rbac.departmentAllowed(req.access, chip.department_id)) rbac.fail('Departamento não autorizado para importar contatos.');
      if (!req.access.owner) {
        const existing = new Set((await requestChip(chip, 'contacts')).map((contact) => contact.number));
        const visible = new Set((await scopedContacts(req)).map((contact) => contact.number));
        if (parsed.contacts.some((contact) => existing.has(contact.number) && (!rbac.can(req.access, 'contatos.editar') || !visible.has(contact.number)))) rbac.fail('A importação não pode alterar contatos fora das suas permissões.');
      }
      const result = await requestChip(chip, 'import-contacts', { contacts: parsed.contacts }, 120000);
      await rbac.audit(req.access, 'contacts.import', null, {}, { chipId: chip.id, imported: result.imported, updated: result.updated });
      const errors = [...parsed.errors, ...result.errors];
      broadcastAccount(user.account_id, 'contacts:updated');
      res.json({
        imported: result.imported, updated: result.updated,
        duplicates: parsed.duplicates, rejected: errors.length, total: parsed.total,
        errors: errors.slice(0, 100), chip: { id: chip.id, name: chip.name, number: chip.number },
      });
    } catch (error) {
      console.error('[CONTACTS] Falha ao importar:', error.message);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível concluir a importação. Confira os contatos antes de tentar novamente.' });
    }
  });
});

app.post('/api/whatsapp/sync-contacts', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    const result = await requestChip(chip, 'sync-contacts', {}, 190000);
    res.json(result);
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

async function assertContactsReady(chip) {
  const { status } = await bot.chipState(chip);
  if (status?.connected && status.contactsSync && !status.contactsSync.verified) {
    const error = new Error('Aguarde a sincronização e verificação dos contatos antes de enviar mensagens.');
    error.statusCode = 423;
    throw error;
  }
}

app.post('/api/conversation/:number/messages/forward', async (req, res) => {
  try {
    const ids = require('./message-data').messageIds(req.body.messageIds);
    const targetNumber = String(req.body.targetNumber || '').replace(/\D/g, '');
    if (!/^[1-9]\d{6,19}$/.test(targetNumber)) return res.status(400).json({ error: 'Informe um destinatário válido.' });
    const chip = await getConversationChip(req, req.access.user.id);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    await assertContactsReady(chip);
    const result = await requestChip(chip, 'forward-messages', { number: req.params.number, targetNumber, messageIds: ids }, 120000);
    broadcastAccount(req.access.accountId, 'message', stampConversation(chip, result.conversation));
    res.json({ ok: true, ...result });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

app.post('/api/conversation/:number/messages/delete', async (req, res) => {
  try {
    const ids = require('./message-data').messageIds(req.body.messageIds);
    const chip = await getConversationChip(req, req.access.user.id);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    if (req.body.forEveryone) await assertContactsReady(chip);
    const result = await requestChip(chip, 'delete-messages', { number: req.params.number, messageIds: ids, forEveryone: req.body.forEveryone === true }, 120000);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(req.access.accountId, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

app.post('/api/reply', async (req, res) => {
  const { number, text, chipId } = req.body || {};
  if (!number || !text) {
    return res.status(400).json({ error: 'Informe "number" e "text".' });
  }

  try {
    const user = await getSessionUser(req);
    const displayName = req.body.signature === false ? null : user?.display_name || user?.username || '';
    let chip;
    if (chipId) {
      chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [chipId, user.account_id]);
      if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    } else {
      chip = await getConversationChip(req, user.id);
      if (!chip) return res.status(400).json({ error: 'Nenhum número WhatsApp configurado.' });
    }
    await assertContactsReady(chip);
    const result = await bot.reply(chip, number, text, displayName, req.body.replyTo);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(user.account_id, 'message', conversation);
    broadcastAccount(user.account_id, 'active-target', { chipId: chip.id, number: result.activeTarget });
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/reply-media', upload.single('file'), async (req, res) => {
  const { number, caption = '', chipId } = req.body || {};
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
  const userMediaDir = path.join(STORAGE_DIR, 'users', String(req.access.accountId), 'media');
  fs.mkdirSync(userMediaDir, { recursive: true });
  const filePath = path.join(userMediaDir, storedName);

  try {
    const user = await getSessionUser(req);
    const displayName = req.body.signature === 'false' || req.body.signature === false ? null : user?.display_name || user?.username || '';
    await authorization.validateResources(req, '/reply-media');
    let chip;
    if (chipId) {
      chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [chipId, user.account_id]);
      if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    } else {
      chip = await getConversationChip(req, user.id);
      if (!chip) return res.status(400).json({ error: 'Nenhum número WhatsApp configurado.' });
    }
    await assertContactsReady(chip);
    fs.writeFileSync(filePath, req.file.buffer);
    const result = await bot.replyMedia(chip, number, {
      type,
      buffer: req.file.buffer,
      mimeType,
      fileName: req.file.originalname,
      caption: caption.trim(),
      mediaUrl: `/media/${storedName}`,
    }, displayName, req.body.replyTo);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(user.account_id, 'message', conversation);
    broadcastAccount(user.account_id, 'active-target', { chipId: chip.id, number: result.activeTarget });
    res.json({ ok: true, conversation });
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/assumir', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const { number, chipId } = req.body || {};
    let chip;
    if (chipId) {
      chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [chipId, user.account_id]);
      if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    } else {
      chip = await getConversationChip(req, user.id);
    }
    if (!chip) return res.json({ ok: true, activeTarget: null });
    const result = await bot.assume(chip, number || null);
    if (number) {
      const assigned = await requestChip(chip, 'assign-conversation', { number, userId: user.id });
      await flowService.stopConversationRuns(user.account_id, chip.id, assigned.conversation?.number || number);
    }
    broadcastAccount(user.account_id, 'active-target', { chipId: chip.id, number: result.activeTarget });
    res.json({ ok: true, activeTarget: result.activeTarget });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Chips CRUD ----------
app.get('/api/assignees', async (req, res) => {
  const rows = await db.all("SELECT id, display_name, username, departments FROM users WHERE account_id = ? AND status = 'active' AND deleted_at IS NULL", [req.access.accountId]);
  res.json({ members: rows.filter((row) => req.access.owner || rbac.parse(row.departments).some((id) => req.access.departments.includes(String(id)))).map((row) => ({ id: row.id, name: row.display_name || row.username, departments: rbac.parse(row.departments) })) });
});
app.post('/api/conversation/:number/assign', async (req, res) => {
  try {
    const chip = await getConversationChip(req, req.access.user.id);
    if (!chip) return res.status(404).json({ error: 'Canal não encontrado.' });
    const target = req.body.userId == null ? null : await rbac.accessFor(req.body.userId);
    const current = await requestChip(chip, 'get-conversation', { number: req.params.number });
    if (req.body.userId != null && (!target || target.accountId !== req.access.accountId || !rbac.departmentAllowed(target, current.departmentId || chip.department_id))) return res.status(403).json({ error: 'Responsável fora deste departamento ou conta.' });
    const result = await requestChip(chip, 'assign-conversation', { number: req.params.number, userId: target?.user.id || null });
    if (target) await flowService.stopConversationRuns(req.access.accountId, chip.id, result.conversation?.number || req.params.number);
    await rbac.audit(req.access, 'conversation.assign', target?.user.id, { chipId: chip.id, number: req.params.number, assignedUserId: current.assignedUserId }, { assignedUserId: target?.user.id || null });
    await broadcastAccount(req.access.accountId, 'message', result.conversation);
    await authorizationChanged(req.access.accountId);
    res.json({ ok: true, conversation: result.conversation });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});
app.get('/api/chips', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chips = await getUserChips(user.id);
    // Enriquece com status em tempo real
    const chipsWithStatus = chips.map((chip) => {
      const entry = bot.workers.get(chip.id);
      const alive = bot.isAlive(entry);
      return { ...chip, number: chip.identity_verified ? chip.number : null, workerRunning: alive,
        _connected: alive && !!entry.status?.connected, _qr: alive ? entry.status?.qr : null, _error: alive ? entry.status?.error : null,
        _historySync: alive ? entry.status?.historySync : null };
    });
    res.json({ chips: chipsWithStatus });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/chips', async (req, res) => {
  const { name, departmentId } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) return res.status(400).json({ error: 'Informe um nome de canal com até 40 caracteres.' });
  try {
    const user = await getSessionUser(req);
    const departments = await store.getDepartments();
    if (!departmentId) return res.status(400).json({ error: 'Crie e selecione um departamento para este número.' });
    if (departmentId && !departments.some((department) => String(department.id) === String(departmentId))) {
      return res.status(400).json({ error: 'Departamento invalido.' });
    }
    const currentPrimary = await getPrimaryChip(user.id);
    const now = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO chips (name, number, user_id, department_id, is_primary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), null, user.account_id, departmentId || null, currentPrimary ? 0 : 1, 'offline', now]
    );
    const chip = await db.get('SELECT * FROM chips WHERE id = ?', [result.lastID]);
    {
      try { bot.ensureWorker(chip); } catch (e) { console.warn('[CHIPS] Worker start falhou:', e.message); }
    }
    res.status(201).json({ ok: true, chip });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') {
      return res.status(409).json({ error: 'Esse número já está cadastrado.' });
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/chips/:id/status', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [req.params.id, user.account_id]);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    try {
      const result = await bot.chipState(chip);
      const current = await db.get('SELECT number, identity_verified FROM chips WHERE id = ?', [chip.id]);
      res.json({ chipId: chip.id, name: chip.name, ...result.status, number: current?.identity_verified ? current.number : null, qr: result.status?.qr || null, isPrimary: !!chip.is_primary });
    } catch (err) {
      res.json({ chipId: chip.id, number: chip.identity_verified ? chip.number : null, name: chip.name, connected: false, qr: null, error: 'Não foi possível consultar a conexão. Aguarde a reconexão.' });
    }
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/chips/:id/disconnect', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [req.params.id, user.account_id]);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    const result = await bot.disconnect(chip);
    res.json({ ok: result.ok, status: result.status });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Erro ao desconectar.' });
  }
});

app.post('/api/chips/:id/primary', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [req.params.id, user.account_id]);
    if (!chip) return res.status(404).json({ error: 'Chip nao encontrado.' });
    await db.run('UPDATE chips SET is_primary = 0 WHERE user_id = ?', [user.account_id]);
    await db.run('UPDATE chips SET is_primary = 1 WHERE id = ? AND user_id = ?', [chip.id, user.account_id]);
    chip.is_primary = 1;
    try { bot.ensureWorker(chip); } catch (error) { console.warn('[CHIPS] Worker start falhou:', error.message); }
    res.json({ ok: true, chip });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/chips/:id/department', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [req.params.id, user.account_id]);
    if (!chip) return res.status(404).json({ error: 'Chip nao encontrado.' });
    const { departmentId, name } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 40)) return res.status(400).json({ error: 'Informe um nome de canal com até 40 caracteres.' });
    if (!departmentId) return res.status(400).json({ error: 'Todo chip precisa estar associado a um departamento.' });
    const department = await db.get('SELECT id FROM departments WHERE id = ? AND account_id = ?', [departmentId, req.access.accountId]);
    if (!department) return res.status(400).json({ error: 'Departamento invalido.' });
    const departmentChanged = String(chip.department_id) !== String(departmentId);
    await db.run('UPDATE chips SET department_id = ? WHERE id = ?', [departmentId || null, chip.id]);
    if (name !== undefined) {
      await db.run('UPDATE chips SET name = ? WHERE id = ?', [name.trim(), chip.id]);
      chip.name = name.trim();
    }
    chip.department_id = departmentId || null;
    const entry = bot.workers.get(chip.id);
    if (entry?.chip) entry.chip.name = chip.name;
    if (departmentChanged) {
      await bot.stopChip(chip.id);
      try { bot.ensureWorker(chip); } catch (error) {
        console.warn('[CHIPS] Nao foi possivel atualizar o departamento do worker:', error.message);
      }
    }
    res.json({ ok: true, chip });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/chips/:id', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [req.params.id, user.account_id]);
    if (!chip) return res.status(404).json({ error: 'Chip não encontrado.' });
    await bot.stopChip(chip.id);
    await db.run('DELETE FROM chips WHERE id = ?', [chip.id]);
    if (chip.is_primary) {
      const next = await db.get('SELECT * FROM chips WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', [user.account_id]);
      if (next) {
        await db.run('UPDATE chips SET is_primary = 1 WHERE id = ?', [next.id]);
        next.is_primary = 1;
        try { bot.ensureWorker(next); } catch (error) { console.warn('[CHIPS] Worker start falhou:', error.message); }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversation/block', async (req, res) => {
  const { number, blocked } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip configurado.' });
    const result = await bot.block(chip, number, blocked);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(user.account_id, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversation/clear', async (req, res) => {
  const { number } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip configurado.' });
    const result = await bot.clear(chip, number);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(user.account_id, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversation/delete', async (req, res) => {
  const { number } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: 'Informe "number".' });
  }

  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip configurado.' });
    const result = await bot.delete(chip, number);
    const conversation = stampConversation(chip, result.conversation);
    broadcastAccount(user.account_id, 'conversation:deleted', { number, chipId: chip.id, conversation });
    res.json({ ok: true, number, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversations/bulk-department', async (req, res) => {
  try {
    const { numbers, departmentId } = req.body || {};
    if (!Array.isArray(numbers) || !numbers.length) return res.status(400).json({ error: 'Selecione ao menos uma conversa.' });
    const department = await db.get('SELECT id FROM departments WHERE id = ? AND account_id = ?', [departmentId, req.access.accountId]);
    if (!department) return res.status(400).json({ error: 'Departamento invalido.' });
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const updated = [];
    for (const number of numbers) {
      const { conversation } = await requestChip(chip, 'set-conversation-department', { number, departmentId: department.id });
      updated.push(conversation);
      broadcastAccount(user.account_id, 'message', conversation);
    }
    res.json({ ok: true, updated: updated.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Tags de conversa
app.get('/api/conversation/:number/tags', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.json({ tags: [] });
    res.json(await requestChip(chip, 'get-conversation-tags', { number: req.params.number }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversation/:number/tags', async (req, res) => {
  try {
    const { tags } = req.body || {};
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const { conversation } = await requestChip(chip, 'set-conversation-tags', { number: req.params.number, tags: tags || [] });
    broadcastAccount(user.account_id, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const updated = [];
    for (const number of numbers) {
      const { tags: currentTags = [] } = await requestChip(chip, 'get-conversation-tags', { number });
      if (action === 'add') {
        const newTags = [...new Set([...currentTags, ...(tags || [])])];
        const { conversation } = await requestChip(chip, 'set-conversation-tags', { number, tags: newTags });
        updated.push(conversation);
        broadcastAccount(user.account_id, 'message', conversation);
      } else if (action === 'remove') {
        const newTags = currentTags.filter((t) => !(tags || []).includes(t));
        const { conversation } = await requestChip(chip, 'set-conversation-tags', { number, tags: newTags });
        updated.push(conversation);
        broadcastAccount(user.account_id, 'message', conversation);
      } else {
        const { conversation } = await requestChip(chip, 'set-conversation-tags', { number, tags: tags || [] });
        updated.push(conversation);
        broadcastAccount(user.account_id, 'message', conversation);
      }
    }
    res.json({ ok: true, updated: updated.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Finalizar/Reabrir conversa
app.post('/api/conversation/:number/finalize', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const { conversation } = await requestChip(chip, 'finalize-conversation', { number: req.params.number });
    broadcastAccount(user.account_id, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/conversation/:number/reopen', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const { conversation } = await requestChip(chip, 'reopen-conversation', { number: req.params.number });
    broadcastAccount(user.account_id, 'message', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Conversas finalizadas
app.get('/api/conversations/finalized', async (req, res) => {
  try {
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.json({ conversations: [] });
    const state = await requestChip(chip, 'state');
    const { from, to, search = '' } = req.query;
    const rows = Object.values(state.conversations || {}).filter((item) => item.isFinalized &&
      (!from || item.finalizedAt >= from) && (!to || item.finalizedAt <= to) &&
      `${item.name || ''} ${item.number}`.toLocaleLowerCase('pt-BR').includes(String(search).toLocaleLowerCase('pt-BR')));
    res.json({ conversations: rows.map((item) => stampConversation(chip, item)).slice(0, 100) });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// ---------- Tags CRUD ----------
app.get('/api/tags', async (req, res) => {
  try {
    res.json({ tags: await store.getTags() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/tags', async (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da tag.' });
    const tag = await store.createTag(name, color);
    res.status(201).json({ ok: true, tag });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/tags/:id', async (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da tag.' });
    const tag = await store.updateTag(req.params.id, name, color);
    res.json({ ok: true, tag });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', async (req, res) => {
  try {
    await store.deleteTag(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Departments CRUD ----------
app.get('/api/departments', async (req, res) => {
  try {
    res.json({ departments: await store.getDepartments() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 60) return res.status(400).json({ error: 'Informe um nome de até 60 caracteres.' });
    const department = await store.createDepartment(cleanName, String(description || '').trim());
    res.status(201).json({ ok: true, department });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') return res.status(409).json({ error: 'Já existe um departamento com esse nome.' });
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/departments/:id', async (req, res) => {
  try {
    const { name, description } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 60) return res.status(400).json({ error: 'Informe um nome de até 60 caracteres.' });
    const department = await store.updateDepartment(req.params.id, cleanName, String(description || '').trim());
    if (!department) return res.status(404).json({ error: 'Departamento não encontrado.' });
    res.json({ ok: true, department });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') return res.status(409).json({ error: 'Já existe um departamento com esse nome.' });
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  try {
    const assignedChip = await db.get('SELECT id FROM chips WHERE department_id = ? AND user_id = ? LIMIT 1', [req.params.id, req.access.accountId]);
    if (assignedChip) return res.status(409).json({ error: 'Transfira os chips deste departamento antes de excluí-lo.' });
    const chips = await getUserChips(req.session.userId);
    for (const chip of chips) {
      await requestChip(chip, 'clear-department', { departmentId: req.params.id }).catch(() => {});
    }
    await store.deleteDepartment(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Campaigns CRUD ----------
app.get('/api/campaigns', async (req, res) => {
  try {
    res.json({ campaigns: await store.getCampaigns() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { name, message, target_tags, blocked_tags, scheduled_at, chip } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem da campanha.' });
    const campaign = await store.createCampaign({ name, message, target_tags, blocked_tags, scheduled_at, chip });
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/campaigns/:id', async (req, res) => {
  try {
    const { name, message, target_tags, blocked_tags, scheduled_at, chip } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem da campanha.' });
    const campaign = await store.updateCampaign(req.params.id, { name, message, target_tags, blocked_tags, scheduled_at, chip });
    res.json({ ok: true, campaign });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    await store.deleteCampaign(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/campaigns/:id/duplicate', async (req, res) => {
  try {
    const campaign = await store.duplicateCampaign(req.params.id);
    res.status(201).json({ ok: true, campaign });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/webhooks', async (req, res) => {
  try {
    const { name, url, events, secret, active } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Informe nome e URL do webhook.' });
    const webhook = await store.createWebhook({ name, url, events, secret, active });
    res.status(201).json({ ok: true, webhook });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/webhooks/:id', async (req, res) => {
  try {
    const { name, url, events, secret, active } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Informe nome e URL do webhook.' });
    const webhook = await store.updateWebhook(req.params.id, { name, url, events, secret, active });
    res.json({ ok: true, webhook });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/webhooks/:id', async (req, res) => {
  try {
    await store.deleteWebhook(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Kanban CRUD ----------
require('./funnel-routes').register(app);
app.get('/api/kanban', async (req, res) => {
  try {
    const [columns, opportunities] = await Promise.all([store.getKanbanColumns(), store.getOpportunities()]);
    const visibleColumns = columns.filter(column => rbac.recordAllowed(req.access, column, 'kanban_columns'));
    const allFunnels = await require('./funnel-store').list();
    const funnels = allFunnels.filter(funnel => req.access.owner || visibleColumns.some(column => column.funnel_id === funnel.id) || (!columns.some(column => column.funnel_id === funnel.id) && Number(funnel.created_by) === req.access.user.id && rbac.recordAllowed(req.access, funnel, 'funnels')));
    const visibleOpportunities = opportunities.filter(item => rbac.recordAllowed(req.access, item, 'opportunities'));
    const responsibleIds = [...new Set(visibleOpportunities.map(item => item.assigned_user_id || item.created_by).filter(Boolean))];
    const responsibles = responsibleIds.length ? await db.all(`SELECT id, display_name, username FROM users WHERE account_id = ? AND id IN (${responsibleIds.map(() => '?').join(',')})`, [req.access.accountId, ...responsibleIds]) : [];
    res.json({ funnels: funnels.map(funnel => ({ ...funnel, canManage: req.access.owner || columns.filter(column => column.funnel_id === funnel.id).every(column => rbac.recordAllowed(req.access, column, 'kanban_columns')) })), columns, opportunities, responsibles });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/kanban/columns', async (req, res) => {
  try {
    const name = require('./funnel-routes').validName(req.body?.name);
    const funnel = req.body?.funnel_id ? (await require('./funnel-routes').allowed(req.access, req.body.funnel_id, true)).funnel : await require('./funnel-store').defaultFunnel();
    if (!req.body?.funnel_id) await require('./funnel-routes').allowed(req.access, funnel.id, true);
    const column = await store.createKanbanColumn(name, funnel.id);
    res.status(201).json({ ok: true, column });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/kanban/columns/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da coluna.' });
    const column = await store.updateKanbanColumn(req.params.id, name);
    res.json({ ok: true, column });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/kanban/columns/:id', async (req, res) => {
  try {
    await store.deleteKanbanColumn(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities', async (req, res) => {
  try {
    const { title, contact_number, contact_name, value, column_id } = req.body || {};
    if (!title || !column_id) return res.status(400).json({ error: 'Informe título e coluna.' });
    const opportunity = await store.createOpportunity({ title, contact_number, contact_name, value, column_id });
    res.status(201).json({ ok: true, opportunity });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/kanban/opportunities/:id', async (req, res) => {
  try {
    const opportunity = await store.updateOpportunity(req.params.id, req.body || {});
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities/:id/win', async (req, res) => {
  try {
    const opportunity = await store.winOpportunity(req.params.id);
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/kanban/opportunities/:id/lose', async (req, res) => {
  try {
    const { loss_reason_id } = req.body || {};
    const opportunity = await store.loseOpportunity(req.params.id, loss_reason_id);
    res.json({ ok: true, opportunity });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/kanban/opportunities/:id', async (req, res) => {
  try {
    await store.deleteOpportunity(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Loss Reasons CRUD ----------
app.get('/api/loss-reasons', async (req, res) => {
  try {
    res.json({ reasons: await store.getLossReasons() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/loss-reasons', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome do motivo.' });
    const reason = await store.createLossReason(name);
    res.status(201).json({ ok: true, reason });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/loss-reasons/:id', async (req, res) => {
  try {
    await store.deleteLossReason(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Visual flow builder and execution ----------
require('./flows/routes').register(app, flowService);

// ---------- Global Variables ----------
app.get('/api/global-variables', async (req, res) => {
  try {
    res.json({ variables: await store.getGlobalVariables() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/global-variables', async (req, res) => {
  try {
    const { key, value, valueType = 'text' } = req.body || {};
    if (!require('./flows/schema').safeKey(key) || key.includes('.')) return res.status(400).json({ error: 'Informe uma chave válida sem pontos.' });
    if (!['text','number','boolean','date','json'].includes(valueType) || typeof value !== 'string' || value.length > 64000) return res.status(400).json({ error: 'Tipo ou valor de variável inválido.' });
    if (valueType === 'json') {
      try { JSON.parse(value); } catch { return res.status(400).json({error:'JSON inválido para a variável.'}); }
    }
    if (!require('./flows/schema').validVariableValue(valueType,require('./flows/schema').decodeVariable(value,valueType))) return res.status(400).json({error:'O valor não corresponde ao tipo da variável.'});
    const variable = await store.setGlobalVariable(key, value, valueType);
    res.json({ ok: true, variable });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/global-variables/:key', async (req, res) => {
  try {
    await store.deleteGlobalVariable(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Follow-ups ----------
app.get('/api/followups', async (req, res) => {
  try {
    res.json({ followups: await store.getFollowups() });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/followups', async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!name || !message) return res.status(400).json({ error: 'Informe nome e mensagem.' });
    const followup = await store.createFollowup(req.body);
    res.status(201).json({ ok: true, followup });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/followups/:id', async (req, res) => {
  try {
    const followup = await store.updateFollowup(req.params.id, req.body || {});
    res.json({ ok: true, followup });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/followups/:id', async (req, res) => {
  try {
    await store.deleteFollowup(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Contact tags & variables ----------
app.put('/api/contacts/:number/tags', async (req, res) => {
  try {
    const { tags } = req.body || {};
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const { contact } = await requestChip(chip, 'set-contact-tags', { number: req.params.number, tags: tags || [] });
    res.json({ ok: true, contact });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put('/api/contacts/:number/variables', async (req, res) => {
  try {
    const { variables } = req.body || {};
    const user = await getSessionUser(req);
    const chip = await getConversationChip(req, user.id);
    if (!chip) return res.status(400).json({ error: 'Nenhum chip principal configurado.' });
    const { contact } = await requestChip(chip, 'set-contact-variables', { number: req.params.number, variables: variables || {} });
    res.json({ ok: true, contact });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ---------- Dashboard Stats ----------
async function dashboardStats(req) {
    const now = new Date();
    const period = dashboardPeriod(req.query, now);
    const access = { ...req.access, permissions: [...req.access.permissions, 'atendimento.visualizar_todos'] };
    const chips = (await db.all('SELECT * FROM chips WHERE user_id = ?', [access.accountId]));
    const chipId = String(req.query.chipId || '');
    if (chipId && !chips.some(chip => String(chip.id) === chipId)) throw Object.assign(new Error('Chip não encontrado.'), { statusCode: 404 });
    const conversations = [], contacts = new Set();
    const channels = [];
    for (const chip of chips) {
      const state = await requestChip(chip, 'state');
      const visible = Object.values(state.conversations || {}).filter((conversation) => rbac.conversationAllowed(access, conversation, chip));
      const activity = dashboardActivity(visible, period, now);
      channels.push({ id: chip.id, name: chip.name || `Chip ${chip.id}`, connected: !!state.status?.connected,
        messages: activity.received + activity.sent });
      if (chipId && String(chip.id) !== chipId) continue;
      conversations.push(...visible);
      visible.forEach((conversation) => contacts.add(`${chip.id}:${conversation.number}`));
    }
    const opportunities = (await store.getOpportunities()).filter((row) => rbac.recordAllowed(req.access, row, 'opportunities'));
    const won = opportunities.filter((row) => row.status === 'won');
    return { ...dashboardActivity(conversations, period, now), channels, updatedAt: new Date().toISOString(),
      contacts: contacts.size, messages: conversations.reduce((sum, row) => sum + row.messages.length, 0), opportunities: opportunities.length,
      wonOpportunities: won.length, revenue: won.reduce((sum, row) => sum + Number(row.value || 0), 0), conversionRate: opportunities.length ? Number((won.length / opportunities.length * 100).toFixed(1)) : 0 };
}
app.get('/api/dashboard/stats', async (req, res) => {
  try { res.json(await dashboardStats(req));
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});
app.get('/api/dashboard/export', async (req, res) => {
  try {
    const stats = await dashboardStats(req);
    await rbac.audit(req.access, 'reports.export', null, {}, stats);
    await sendWorkbook(res, dashboardWorkbook(stats), 'relatorio-convelya.xlsx');
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

// ---------- WebSocket ----------
io.on('connection', async (socket) => {
  const expire = () => {
    socket.emit('unauthorized');
    socket.disconnect(true);
  };
  if (!isAuthenticated(socket.request.session)) return expire();
  const expiryTimer = setTimeout(expire, socket.request.session.authExpiresAt - Date.now());
  expiryTimer.unref?.();
  socket.on('disconnect', () => clearTimeout(expiryTimer));
  try {
    let access = await rbac.accessFor(socket.request.session?.userId);
    const user = access?.user;
    if (!user || !socket.connected || !isAuthenticated(socket.request.session) || (socket.request.session.authVersion != null && socket.request.session.authVersion !== user.auth_version)) {
      socket.emit('unauthorized');
      return socket.disconnect(true);
    }
    socket.join(`user:${user.id}`);
    const chips = await getActiveChips(user.id);
    const selectedChip = chips.find((chip) => String(chip.id) === String(socket.handshake.auth?.chipId)) || chips.find((chip) => chip.is_primary) || chips[0];
    const state = await bot.state(user, chips, selectedChip?.id);
    access = await rbac.accessFor(socket.request.session?.userId);
    if (!access || (socket.request.session.authVersion != null && socket.request.session.authVersion !== access.user.auth_version)) return expire();
    if (!socket.connected || !isAuthenticated(socket.request.session)) return expire();
    socket.emit('init', authorization.safeState(access, state, selectedChip));
  } catch (err) {
    console.error('[SOCKET] Falha ao enviar estado inicial:', err);
    socket.emit('init-error', { error: err.message });
  }
});

bot.on('event', ({ userId, chipId, chipNumber, event, payload }) => {
  if (event === 'flow:incoming') {
    db.ready.then(() => flowService.enqueue(userId, chipId, payload)).then(async () => {
      const source = bot.workers.get(chipId)?.chip;
      if (source) await requestChip(source, 'flow-event-ack', { eventId: payload.id });
      flowService.start();
    }).catch(error => console.error('[FLOW INBOX]', error.message));
    return;
  }
  // Reemite para a sala do usuário dono do chip
  const chip = bot.workers.get(chipId)?.chip || { id: chipId };
  const scoped = event === 'message' ? stampConversation(chip, payload) : event === 'active-target' ? { chipId, number: payload } : payload && typeof payload === 'object' ? { ...payload, chipId } : payload;
  broadcastAccount(userId, event, scoped);
  // Também emite chip:status com metadados do chip para o painel multi-chip
  if (event === 'status') {
    broadcastAccount(userId, 'chip:status', {
      chipId,
      number: payload.number || (bot.workers.get(chipId)?.chip?.identity_verified ? chipNumber : null),
      ...payload,
    });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
if (require.main === module) db.ready.then(async () => {
  flowService.start();
  reportStorage();
  server.listen(PORT, () => {
    console.log(`🖥️  Servidor rodando na porta ${PORT}`);
  });

  // Inicia um worker por chip cadastrado
  try {
    const chips = await db.all('SELECT * FROM chips');
    chips.forEach((chip) => {
      try { bot.ensureWorker(chip); } catch (e) { console.warn(`[START] Worker do chip ${chip.id} falhou:`, e.message); }
    });
    console.log(`✅ ${chips.length} chip(s) carregado(s).`);
  } catch (err) {
    console.error('❌ Erro ao iniciar workers dos chips:', err);
  }
}).catch((err) => {
  console.error('❌ Não foi possível inicializar o banco de dados:', err);
  process.exitCode = 1;
});

module.exports = { app, server, io, bot, db, flowService };
