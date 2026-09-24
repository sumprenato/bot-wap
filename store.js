const db = require('./db');

const MAX_MESSAGES_PER_CONVERSATION = 200;
const MEDIA_LABELS = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' };

function cleanNumber(number) {
  return (number || '').toString().replace(/\D/g, '');
}

function parseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function formatConversation(convo, rows, aliases = []) {
  return {
    number: convo.number,
    aliases: aliases.filter((alias) => alias && alias !== convo.number),
    name: convo.name || '',
    blocked: !!convo.blocked,
    lastMessage: convo.last_message || '',
    lastMessageAt: convo.last_message_at || '',
    lastFrom: convo.last_from || '',
    departmentId: convo.department_id || null,
    chip: convo.chip || null,
    tags: parseJson(convo.tags, []),
    finalizedAt: convo.finalized_at || null,
    isFinalized: !!convo.is_finalized,
    messages: rows.map((r) => {
      const entry = { from: r.from_role, text: r.text || '', at: r.at };
      if (r.type) {
        entry.type = r.type;
        entry.mediaUrl = r.media_url || '';
        entry.mimeType = r.mime_type || '';
        entry.fileName = r.file_name || '';
        entry.caption = r.caption || '';
      }
      return entry;
    }),
  };
}

async function getConversation(number) {
  number = await resolveConversationNumber(number);
  let convo = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  if (!convo) {
    await db.run('INSERT INTO conversations (number, name, blocked, tags) VALUES (?, ?, ?, ?)', [number, '', 0, '[]']);
    convo = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  }
  const blockedContact = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [number]);
  convo.blocked = !!blockedContact;
  const rows = await db.all('SELECT * FROM messages WHERE number = ? ORDER BY at ASC, id ASC', [number]);
  return formatConversation(convo, rows, await getAliases(number));
}

async function getAliases(number) {
  const rows = await db.all('SELECT alias FROM conversation_aliases WHERE number = ?', [number]);
  return rows.map((row) => row.alias);
}

async function getKnownJid(number) {
  const clean = cleanNumber(number);
  if (!clean) return '';
  const canonical = await resolveConversationNumber(clean);
  const candidates = new Set([clean, canonical, ...(await getAliases(canonical))]);
  for (const candidate of candidates) {
    const row = await db.get('SELECT jid FROM contacts WHERE number = ?', [candidate]);
    if (row?.jid && row.jid.includes('@')) return row.jid;
  }
  return '';
}

async function ensureConversation(number, name = '') {
  number = await resolveConversationNumber(number);
  const existing = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  if (!existing) {
    await db.run('INSERT INTO conversations (number, name, blocked, tags) VALUES (?, ?, ?, ?)', [number, name || '', 0, '[]']);
  } else if (name && !existing.name) {
    await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name, number]);
  }
}

async function saveContact(contact = {}) {
  const number = cleanNumber(contact.number || contact.phoneNumber || contact.jid);
  if (!number) return null;
  const name = String(contact.name || contact.notify || contact.verifiedName || '').trim();
  const pushName = String(contact.pushName || contact.notify || '').trim();
  const jid = String(contact.jid || '').trim();
  const seenAt = new Date().toISOString();
  await db.run(
    `INSERT INTO contacts (number, name, push_name, jid, last_seen_at, tags, variables)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(number) DO UPDATE SET
       name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE contacts.name END,
       push_name = CASE WHEN excluded.push_name <> '' THEN excluded.push_name ELSE contacts.push_name END,
       jid = CASE WHEN excluded.jid <> '' THEN excluded.jid ELSE contacts.jid END,
       last_seen_at = excluded.last_seen_at`,
    [number, name, pushName, jid, seenAt, '[]', '{}']
  );
  if (name) await setName(number, name);
  return getContact(number);
}

async function getContact(number) {
  const clean = cleanNumber(number);
  const row = await db.get(
    'SELECT number, name, push_name AS pushName, jid, last_seen_at AS lastSeenAt, tags, variables FROM contacts WHERE number = ?',
    [clean]
  );
  if (!row) return null;
  return { ...row, tags: parseJson(row.tags, []), variables: parseJson(row.variables, {}) };
}

async function getContacts() {
  const rows = await db.all(
    'SELECT number, name, push_name AS pushName, jid, last_seen_at AS lastSeenAt, tags, variables FROM contacts ORDER BY name COLLATE NOCASE ASC, number ASC',
    []
  );
  return rows.map((r) => ({ ...r, tags: parseJson(r.tags, []), variables: parseJson(r.variables, {}) }));
}

async function updateContactTags(number, tags) {
  const clean = cleanNumber(number);
  await db.run('UPDATE contacts SET tags = ? WHERE number = ?', [JSON.stringify(tags), clean]);
  return getContact(clean);
}

async function updateContactVariables(number, variables) {
  const clean = cleanNumber(number);
  await db.run('UPDATE contacts SET variables = ? WHERE number = ?', [JSON.stringify(variables), clean]);
  return getContact(clean);
}

async function addMessage(number, from, text = '', name = '', media = {}, waMsgId = '') {
  number = await resolveConversationNumber(number);
  await ensureConversation(number, name);

  const at = new Date().toISOString();
  const hasMedia = !!(media && media.type && media.type !== 'text');

  await db.run(
    `INSERT INTO messages (number, from_role, text, at, type, media_url, mime_type, file_name, caption, whatsapp_msg_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      number,
      from,
      text,
      at,
      hasMedia ? media.type : null,
      hasMedia ? (media.mediaUrl || '') : null,
      hasMedia ? (media.mimeType || '') : null,
      hasMedia ? (media.fileName || '') : null,
      hasMedia ? (media.caption || text || '') : null,
      waMsgId || '',
    ]
  );

  // Mantém só as últimas MAX_MESSAGES_PER_CONVERSATION mensagens por conversa
  const countRow = await db.get('SELECT COUNT(*) as c FROM messages WHERE number = ?', [number]);
  const count = Number(countRow?.c || 0);
  if (count > MAX_MESSAGES_PER_CONVERSATION) {
    const excess = count - MAX_MESSAGES_PER_CONVERSATION;
    const oldRows = await db.all(
      'SELECT id FROM messages WHERE number = ? ORDER BY id ASC LIMIT ?',
      [number, excess]
    );
    for (const row of oldRows) {
      await db.run('DELETE FROM messages WHERE id = ?', [row.id]);
    }
  }

  const lastMessage = hasMedia ? (media.caption || `[${MEDIA_LABELS[media.type] || 'Anexo'}]`) : text;
  await db.run(
    'UPDATE conversations SET last_message = ?, last_message_at = ?, last_from = ? WHERE number = ?',
    [lastMessage, at, from, number]
  );
  if (name) {
    const existing = await db.get('SELECT name FROM conversations WHERE number = ?', [number]);
    if (!existing?.name) {
      await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name, number]);
    }
  }

  return getConversation(number);
}

async function setName(number, name) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number, name);
  if (name && name.trim()) {
    await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name.trim(), number]);
  }
  return getConversation(number);
}

async function setBlocked(number, blocked) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  if (blocked) {
    const existing = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [number]);
    if (!existing) await db.run('INSERT INTO blocked_contacts (number) VALUES (?)', [number]);
  } else {
    await db.run('DELETE FROM blocked_contacts WHERE number = ?', [number]);
  }
  await db.run('UPDATE conversations SET blocked = ? WHERE number = ?', [blocked ? 1 : 0, number]);
  return getConversation(number);
}

async function isBlocked(number) {
  const canonicalNumber = await resolveConversationNumber(number);
  if (!canonicalNumber) return false;
  const blockedContact = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [canonicalNumber]);
  return !!blockedContact;
}

async function clearConversation(number) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  await db.run('DELETE FROM messages WHERE number = ?', [number]);
  await db.run(
    'UPDATE conversations SET last_message = ?, last_message_at = ?, last_from = ? WHERE number = ?',
    ['', '', '', number]
  );
  return getConversation(number);
}

async function deleteConversation(number) {
  number = await resolveConversationNumber(number);
  await db.run('DELETE FROM messages WHERE number = ?', [number]);
  await db.run('DELETE FROM conversations WHERE number = ?', [number]);
  return true;
}

// Tags de conversas
async function setConversationTags(number, tags) {
  number = await resolveConversationNumber(number);
  await db.run('UPDATE conversations SET tags = ? WHERE number = ?', [JSON.stringify(tags), number]);
  return getConversation(number);
}

async function getConversationTags(number) {
  number = await resolveConversationNumber(number);
  const row = await db.get('SELECT tags FROM conversations WHERE number = ?', [number]);
  return parseJson(row?.tags, []);
}

// Finalizar conversa
async function finalizeConversation(number) {
  number = await resolveConversationNumber(number);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE conversations SET is_finalized = 1, finalized_at = ? WHERE number = ?',
    [now, number]
  );
  return getConversation(number);
}

async function reopenConversation(number) {
  number = await resolveConversationNumber(number);
  await db.run(
    'UPDATE conversations SET is_finalized = 0, finalized_at = NULL WHERE number = ?',
    [number]
  );
  return getConversation(number);
}

async function resolveConversationNumber(number) {
  const clean = cleanNumber(number);
  if (!clean) return clean;
  const alias = await db.get('SELECT number FROM conversation_aliases WHERE alias = ?', [clean]);
  return alias?.number || clean;
}

async function registerConversationAliases(primary, phone = '') {
  const primaryNumber = cleanNumber(primary);
  const phoneNumber = cleanNumber(phone);
  if (!primaryNumber) return phoneNumber;

  const existing = await db.get(
    'SELECT number FROM conversation_aliases WHERE alias IN (?, ?) ORDER BY CASE WHEN alias = ? THEN 0 ELSE 1 END LIMIT 1',
    [primaryNumber, phoneNumber || primaryNumber, primaryNumber]
  );
  const existingConversation = existing || await db.get(
    'SELECT number FROM conversations WHERE number IN (?, ?) ORDER BY CASE WHEN number = ? THEN 0 ELSE 1 END LIMIT 1',
    [phoneNumber || primaryNumber, primaryNumber, phoneNumber || primaryNumber]
  );
  const canonical = existingConversation?.number || primaryNumber;

  await ensureConversation(canonical);
  for (const other of new Set([primaryNumber, phoneNumber])) {
    if (!other || other === canonical) continue;
    const duplicate = await db.get('SELECT * FROM conversations WHERE number = ?', [other]);
    if (!duplicate) continue;
    await mergeConversation(duplicate, canonical);
  }
  for (const alias of new Set([primaryNumber, phoneNumber])) {
    if (!alias) continue;
    await db.run(
      `INSERT INTO conversation_aliases (alias, number) VALUES (?, ?)
       ON CONFLICT(alias) DO UPDATE SET number = excluded.number`,
      [alias, canonical]
    );
  }
  return canonical;
}

async function mergeConversation(duplicate, canonical) {
  await db.run('UPDATE messages SET number = ? WHERE number = ?', [canonical, duplicate.number]);
  await db.run('UPDATE conversation_aliases SET number = ? WHERE number = ?', [canonical, duplicate.number]);
  const wasBlocked = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [duplicate.number]);
  if (wasBlocked) {
    const already = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [canonical]);
    if (!already) await db.run('INSERT INTO blocked_contacts (number) VALUES (?)', [canonical]);
    await db.run('DELETE FROM blocked_contacts WHERE number = ?', [duplicate.number]);
  }
  const current = await db.get('SELECT * FROM conversations WHERE number = ?', [canonical]);
  if (duplicate.name && !current?.name) {
    await db.run('UPDATE conversations SET name = ? WHERE number = ?', [duplicate.name, canonical]);
  }
  const last = await db.get('SELECT from_role, text, at, type, caption FROM messages WHERE number = ? ORDER BY at DESC, id DESC LIMIT 1', [canonical]);
  if (last) {
    const preview = last.type ? (last.caption || `[${MEDIA_LABELS[last.type] || 'Anexo'}]`) : (last.text || '');
    await db.run(
      'UPDATE conversations SET last_message = ?, last_message_at = ?, last_from = ? WHERE number = ?',
      [preview, last.at, last.from_role, canonical]
    );
  }
  await db.run('DELETE FROM conversations WHERE number = ?', [duplicate.number]);
}

async function getAll() {
  const convos = await db.all('SELECT * FROM conversations', []);
  const aliasRows = await db.all('SELECT alias, number FROM conversation_aliases', []);
  const aliasesByNumber = {};
  for (const row of aliasRows) (aliasesByNumber[row.number] ||= []).push(row.alias);
  const result = {};
  for (const convo of convos) {
    convo.blocked = await isBlocked(convo.number);
    const rows = await db.all('SELECT * FROM messages WHERE number = ? ORDER BY at ASC, id ASC', [convo.number]);
    result[convo.number] = formatConversation(convo, rows, aliasesByNumber[convo.number] || []);
  }

  const blockedContacts = await db.all('SELECT number FROM blocked_contacts', []);
  for (const contact of blockedContacts) {
    if (result[contact.number]) continue;
    result[contact.number] = formatConversation({
      number: contact.number,
      name: '',
      blocked: 1,
      last_message: '',
      last_message_at: '',
      last_from: '',
      tags: '[]',
    }, []);
  }
  return result;
}

// ==================== TAGS CRUD ====================
async function getTags() {
  return db.all('SELECT * FROM tags ORDER BY name ASC', []);
}

async function createTag(name, color = '#5c8df6') {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)', [name.trim(), color, now]);
  return db.get('SELECT * FROM tags WHERE id = ?', [result.lastID]);
}

async function updateTag(id, name, color) {
  await db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name.trim(), color, id]);
  return db.get('SELECT * FROM tags WHERE id = ?', [id]);
}

async function deleteTag(id) {
  await db.run('DELETE FROM tags WHERE id = ?', [id]);
  return true;
}

// ==================== DEPARTMENTS CRUD ====================
async function getDepartments() {
  return db.all('SELECT * FROM departments ORDER BY name ASC', []);
}

async function createDepartment(name, description = '') {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO departments (name, description, created_at) VALUES (?, ?, ?)', [name.trim(), description, now]);
  return db.get('SELECT * FROM departments WHERE id = ?', [result.lastID]);
}

async function updateDepartment(id, name, description) {
  await db.run('UPDATE departments SET name = ?, description = ? WHERE id = ?', [name.trim(), description, id]);
  return db.get('SELECT * FROM departments WHERE id = ?', [id]);
}

async function deleteDepartment(id) {
  await db.run('DELETE FROM departments WHERE id = ?', [id]);
  return true;
}

// ==================== CAMPAIGNS CRUD ====================
async function getCampaigns() {
  const rows = await db.all('SELECT * FROM campaigns ORDER BY created_at DESC', []);
  return rows.map((r) => ({
    ...r,
    target_tags: parseJson(r.target_tags, []),
    blocked_tags: parseJson(r.blocked_tags, []),
  }));
}

async function createCampaign(data) {
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO campaigns (name, message, target_tags, blocked_tags, scheduled_at, chip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.message, JSON.stringify(data.target_tags || []), JSON.stringify(data.blocked_tags || []), data.scheduled_at || null, data.chip || null, 'draft', now]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ?', [result.lastID]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

async function updateCampaign(id, data) {
  await db.run(
    'UPDATE campaigns SET name = ?, message = ?, target_tags = ?, blocked_tags = ?, scheduled_at = ?, chip = ? WHERE id = ?',
    [data.name, data.message, JSON.stringify(data.target_tags || []), JSON.stringify(data.blocked_tags || []), data.scheduled_at || null, data.chip || null, id]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ?', [id]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

async function deleteCampaign(id) {
  await db.run('DELETE FROM campaigns WHERE id = ?', [id]);
  return true;
}

async function duplicateCampaign(id) {
  const original = await db.get('SELECT * FROM campaigns WHERE id = ?', [id]);
  if (!original) throw new Error('Campanha não encontrada.');
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO campaigns (name, message, target_tags, blocked_tags, scheduled_at, chip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [`${original.name} (cópia)`, original.message, original.target_tags, original.blocked_tags, null, original.chip, 'draft', now]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ?', [result.lastID]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

// ==================== WEBHOOKS CRUD ====================
async function getWebhooks() {
  const rows = await db.all('SELECT * FROM webhooks ORDER BY created_at DESC', []);
  return rows.map((r) => ({ ...r, events: parseJson(r.events, []) }));
}

async function createWebhook(data) {
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO webhooks (name, url, events, secret, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [data.name, data.url, JSON.stringify(data.events || []), data.secret || '', data.active !== false ? 1 : 0, now]
  );
  const row = await db.get('SELECT * FROM webhooks WHERE id = ?', [result.lastID]);
  return { ...row, events: parseJson(row.events, []) };
}

async function updateWebhook(id, data) {
  await db.run(
    'UPDATE webhooks SET name = ?, url = ?, events = ?, secret = ?, active = ? WHERE id = ?',
    [data.name, data.url, JSON.stringify(data.events || []), data.secret || '', data.active !== false ? 1 : 0, id]
  );
  const row = await db.get('SELECT * FROM webhooks WHERE id = ?', [id]);
  return { ...row, events: parseJson(row.events, []) };
}

async function deleteWebhook(id) {
  await db.run('DELETE FROM webhooks WHERE id = ?', [id]);
  return true;
}

// ==================== KANBAN CRUD ====================
async function getKanbanColumns() {
  return db.all('SELECT * FROM kanban_columns ORDER BY position ASC', []);
}

async function createKanbanColumn(name) {
  const now = new Date().toISOString();
  const countRow = await db.get('SELECT COUNT(*) as c FROM kanban_columns', []);
  const position = Number(countRow?.c || 0);
  const result = await db.run('INSERT INTO kanban_columns (name, position, created_at) VALUES (?, ?, ?)', [name, position, now]);
  return db.get('SELECT * FROM kanban_columns WHERE id = ?', [result.lastID]);
}

async function updateKanbanColumn(id, name) {
  await db.run('UPDATE kanban_columns SET name = ? WHERE id = ?', [name, id]);
  return db.get('SELECT * FROM kanban_columns WHERE id = ?', [id]);
}

async function deleteKanbanColumn(id) {
  await db.run('DELETE FROM kanban_columns WHERE id = ?', [id]);
  return true;
}

async function getOpportunities() {
  const opps = await db.all('SELECT * FROM opportunities ORDER BY column_id ASC, position ASC', []);
  return opps;
}

async function createOpportunity(data) {
  const now = new Date().toISOString();
  const countRow = await db.get('SELECT COUNT(*) as c FROM opportunities WHERE column_id = ?', [data.column_id]);
  const position = Number(countRow?.c || 0);
  const result = await db.run(
    'INSERT INTO opportunities (title, contact_number, contact_name, value, column_id, position, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [data.title, data.contact_number || '', data.contact_name || '', data.value || 0, data.column_id, position, 'open', now, now]
  );
  return db.get('SELECT * FROM opportunities WHERE id = ?', [result.lastID]);
}

async function updateOpportunity(id, data) {
  const now = new Date().toISOString();
  await db.run(
    'UPDATE opportunities SET title = ?, contact_number = ?, contact_name = ?, value = ?, column_id = ?, position = ?, updated_at = ? WHERE id = ?',
    [data.title, data.contact_number || '', data.contact_name || '', data.value || 0, data.column_id, data.position || 0, now, id]
  );
  return db.get('SELECT * FROM opportunities WHERE id = ?', [id]);
}

async function winOpportunity(id) {
  const now = new Date().toISOString();
  await db.run('UPDATE opportunities SET status = ?, won_at = ?, updated_at = ? WHERE id = ?', ['won', now, now, id]);
  return db.get('SELECT * FROM opportunities WHERE id = ?', [id]);
}

async function loseOpportunity(id, lossReasonId) {
  const now = new Date().toISOString();
  await db.run(
    'UPDATE opportunities SET status = ?, lost_at = ?, loss_reason_id = ?, updated_at = ? WHERE id = ?',
    ['lost', now, lossReasonId || null, now, id]
  );
  return db.get('SELECT * FROM opportunities WHERE id = ?', [id]);
}

async function deleteOpportunity(id) {
  await db.run('DELETE FROM opportunities WHERE id = ?', [id]);
  return true;
}

// ==================== LOSS REASONS CRUD ====================
async function getLossReasons() {
  return db.all('SELECT * FROM loss_reasons ORDER BY name ASC', []);
}

async function createLossReason(name) {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO loss_reasons (name, created_at) VALUES (?, ?)', [name.trim(), now]);
  return db.get('SELECT * FROM loss_reasons WHERE id = ?', [result.lastID]);
}

async function deleteLossReason(id) {
  await db.run('DELETE FROM loss_reasons WHERE id = ?', [id]);
  return true;
}

// ==================== FLOWS CRUD ====================
async function getFlows() {
  const rows = await db.all('SELECT * FROM flows ORDER BY created_at DESC', []);
  return rows.map((r) => ({
    ...r,
    nodes: parseJson(r.nodes, []),
    edges: parseJson(r.edges, []),
    trigger_keywords: parseJson(r.trigger_keywords, []),
    trigger_chips: parseJson(r.trigger_chips, []),
  }));
}

async function createFlow(data) {
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO flows (name, description, nodes, edges, active, trigger_keywords, trigger_chips, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.description || '', JSON.stringify(data.nodes || []), JSON.stringify(data.edges || []), 0, JSON.stringify(data.trigger_keywords || []), JSON.stringify(data.trigger_chips || []), now, now]
  );
  const row = await db.get('SELECT * FROM flows WHERE id = ?', [result.lastID]);
  return { ...row, nodes: parseJson(row.nodes, []), edges: parseJson(row.edges, []), trigger_keywords: parseJson(row.trigger_keywords, []), trigger_chips: parseJson(row.trigger_chips, []) };
}

async function updateFlow(id, data) {
  const now = new Date().toISOString();
  await db.run(
    'UPDATE flows SET name = ?, description = ?, nodes = ?, edges = ?, active = ?, trigger_keywords = ?, trigger_chips = ?, updated_at = ? WHERE id = ?',
    [data.name, data.description || '', JSON.stringify(data.nodes || []), JSON.stringify(data.edges || []), data.active ? 1 : 0, JSON.stringify(data.trigger_keywords || []), JSON.stringify(data.trigger_chips || []), now, id]
  );
  const row = await db.get('SELECT * FROM flows WHERE id = ?', [id]);
  return { ...row, nodes: parseJson(row.nodes, []), edges: parseJson(row.edges, []), trigger_keywords: parseJson(row.trigger_keywords, []), trigger_chips: parseJson(row.trigger_chips, []) };
}

async function duplicateFlow(id) {
  const original = await db.get('SELECT * FROM flows WHERE id = ?', [id]);
  if (!original) throw new Error('Fluxo não encontrado.');
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO flows (name, description, nodes, edges, active, trigger_keywords, trigger_chips, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [`${original.name} (cópia)`, original.description, original.nodes, original.edges, 0, original.trigger_keywords, original.trigger_chips, now, now]
  );
  const row = await db.get('SELECT * FROM flows WHERE id = ?', [result.lastID]);
  return { ...row, nodes: parseJson(row.nodes, []), edges: parseJson(row.edges, []), trigger_keywords: parseJson(row.trigger_keywords, []), trigger_chips: parseJson(row.trigger_chips, []) };
}

async function deleteFlow(id) {
  await db.run('DELETE FROM flows WHERE id = ?', [id]);
  return true;
}

// ==================== GLOBAL VARIABLES ====================
async function getGlobalVariables() {
  return db.all('SELECT * FROM global_variables ORDER BY key ASC', []);
}

async function setGlobalVariable(key, value) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO global_variables (key, value, created_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key.trim(), value, now]
  );
  return db.get('SELECT * FROM global_variables WHERE key = ?', [key.trim()]);
}

async function deleteGlobalVariable(key) {
  await db.run('DELETE FROM global_variables WHERE key = ?', [key]);
  return true;
}

// ==================== FOLLOW-UPS ====================
async function getFollowups() {
  const rows = await db.all('SELECT * FROM followups ORDER BY created_at DESC', []);
  return rows.map((r) => ({
    ...r,
    active_days: parseJson(r.active_days, [0, 1, 2, 3, 4, 5, 6]),
    tags: parseJson(r.tags, []),
  }));
}

async function createFollowup(data) {
  const now = new Date().toISOString();
  const result = await db.run(
    'INSERT INTO followups (name, message, delay_hours, active_days, chip, tags, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.message, data.delay_hours || 24, JSON.stringify(data.active_days || [0,1,2,3,4,5,6]), data.chip || null, JSON.stringify(data.tags || []), 1, now]
  );
  const row = await db.get('SELECT * FROM followups WHERE id = ?', [result.lastID]);
  return { ...row, active_days: parseJson(row.active_days, [0,1,2,3,4,5,6]), tags: parseJson(row.tags, []) };
}

async function updateFollowup(id, data) {
  await db.run(
    'UPDATE followups SET name = ?, message = ?, delay_hours = ?, active_days = ?, chip = ?, tags = ?, active = ? WHERE id = ?',
    [data.name, data.message, data.delay_hours || 24, JSON.stringify(data.active_days || [0,1,2,3,4,5,6]), data.chip || null, JSON.stringify(data.tags || []), data.active ? 1 : 0, id]
  );
  const row = await db.get('SELECT * FROM followups WHERE id = ?', [id]);
  return { ...row, active_days: parseJson(row.active_days, [0,1,2,3,4,5,6]), tags: parseJson(row.tags, []) };
}

async function deleteFollowup(id) {
  await db.run('DELETE FROM followups WHERE id = ?', [id]);
  return true;
}

module.exports = {
  addMessage,
  saveContact,
  getContact,
  getContacts,
  getAll,
  getConversation,
  getKnownJid,
  resolveConversationNumber,
  registerConversationAliases,
  isBlocked,
  setName,
  setBlocked,
  clearConversation,
  deleteConversation,
  setConversationTags,
  getConversationTags,
  finalizeConversation,
  reopenConversation,
  updateContactTags,
  updateContactVariables,
  // Tags
  getTags,
  createTag,
  updateTag,
  deleteTag,
  // Departments
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // Campaigns
  getCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  duplicateCampaign,
  // Webhooks
  getWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  // Kanban
  getKanbanColumns,
  createKanbanColumn,
  updateKanbanColumn,
  deleteKanbanColumn,
  getOpportunities,
  createOpportunity,
  updateOpportunity,
  winOpportunity,
  loseOpportunity,
  deleteOpportunity,
  // Loss reasons
  getLossReasons,
  createLossReason,
  deleteLossReason,
  // Flows
  getFlows,
  createFlow,
  updateFlow,
  duplicateFlow,
  deleteFlow,
  // Global variables
  getGlobalVariables,
  setGlobalVariable,
  deleteGlobalVariable,
  // Follow-ups
  getFollowups,
  createFollowup,
  updateFollowup,
  deleteFollowup,
};
