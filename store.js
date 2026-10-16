const db = require('./db');
const { serializeMessage, parseMessage, messageIds } = require('./message-data');
const { accountId, actorId, departmentId } = require('./account-context');

const MEDIA_LABELS = { image: 'Imagem', gif: 'GIF', video: 'Vídeo', audio: 'Áudio', document: 'Documento' };
// UI reads must not load the encrypted payload used only for replies/retries.
const MESSAGE_VIEW_COLUMNS = 'messages.id, messages.number, messages.from_role, messages.text, messages.at, messages.type, messages.media_url, messages.mime_type, messages.file_name, messages.caption, messages.whatsapp_msg_id, messages.message_context, message_receipts.status AS delivery_status';

function cleanNumber(number) {
  return (number || '').toString().replace(/\D/g, '');
}

function parseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function formatConversation(convo, rows, aliases = []) {
  return {
    number: convo.number,
    phoneNumber: [convo.number, ...aliases].find((number) => /^[1-9]\d{6,12}$/.test(number || '')) || '',
    aliases: [...new Set(aliases.filter((alias) => alias && alias !== convo.number))],
    name: convo.name || '',
    blocked: !!convo.blocked,
    lastMessage: convo.last_message || '',
    lastMessageAt: convo.last_message_at || '',
    lastFrom: convo.last_from || '',
    departmentId: convo.department_id || null,
    assignedUserId: convo.assigned_user_id || null,
    flowStopped: !!convo.flow_stopped,
    chip: convo.chip || null,
    tags: parseJson(convo.tags, []),
    finalizedAt: convo.finalized_at || null,
    isFinalized: !!convo.is_finalized,
    messages: rows.map((r) => {
      const context = parseJson(r.message_context, {});
      const entry = { id: r.id, whatsappId: r.whatsapp_msg_id || '', from: r.from_role, text: r.text || '', at: r.at, replyTo: context.replyTo || null, forwarded: !!context.forwarded };
      if (r.from_role === 'admin' && r.delivery_status != null) entry.deliveryStatus = Number(r.delivery_status);
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

async function getConversation(number, create = true, { messageId, metadataOnly = false } = {}) {
  number = await resolveConversationNumber(number);
  let convo = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  if (!convo) {
    if (!create) return null;
    await db.run('INSERT INTO conversations (number, name, blocked, tags) VALUES (?, ?, ?, ?)', [number, '', 0, '[]']);
    convo = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  }
  const blockedContact = await db.get('SELECT number FROM blocked_contacts WHERE number = ?', [number]);
  convo.blocked = !!blockedContact;
  const rows = metadataOnly ? [] : await db.all(`SELECT ${MESSAGE_VIEW_COLUMNS} FROM messages LEFT JOIN message_receipts ON messages.whatsapp_msg_id = message_receipts.whatsapp_msg_id WHERE number = ?${messageId ? ' AND messages.whatsapp_msg_id = ?' : ''} ORDER BY at ASC, id ASC`, messageId ? [number, messageId] : [number]);
  const aliases = await getAliases(number);
  convo.name = '';
  for (const candidate of [number, ...aliases]) {
    const contact = await getContact(candidate);
    if (contact?.name) { convo.name = contact.name; break; }
  }
  const result = formatConversation(convo, rows, aliases);
  if (messageId) result.partialMessages = true;
  return result;
}

async function getAliases(number) {
  const rows = await db.all('SELECT alias FROM conversation_aliases WHERE number = ?', [number]);
  // Earlier versions kept the phone-to-LID relationship only in routing metadata.
  const phones = await db.all('SELECT number FROM contacts WHERE jid = ?', [`${number}@lid`]);
  return [...new Set([...rows.map((row) => row.alias), ...phones.map((row) => row.number).filter((value) => /^[1-9]\d{6,12}$/.test(value))])];
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
  const source = ['whatsapp', 'manual'].includes(contact.nameSource) ? contact.nameSource : '';
  const name = source ? String(contact.name || '') : '';
  const pushName = '';
  const jid = String(contact.jid || '').trim();
  const seenAt = new Date().toISOString();
  const preserveActivity = !!contact.preserveActivity;
  await db.run(
    `INSERT INTO contacts (number, name, push_name, jid, last_seen_at, tags, variables, name_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(number) DO UPDATE SET
       name = CASE WHEN excluded.name_source <> '' THEN excluded.name ELSE contacts.name END,
       name_source = CASE WHEN excluded.name_source <> '' THEN excluded.name_source ELSE contacts.name_source END,
       push_name = CASE WHEN excluded.push_name <> '' THEN excluded.push_name ELSE contacts.push_name END,
       jid = CASE WHEN excluded.jid <> '' THEN excluded.jid ELSE contacts.jid END,
       last_seen_at = CASE WHEN ? = 1 THEN contacts.last_seen_at ELSE excluded.last_seen_at END`,
    [number, name, pushName, jid, seenAt, '[]', '{}', source, preserveActivity ? 1 : 0]
  );
  // The address book includes people with whom no conversation has started.
  // Update an existing conversation without filling the inbox with empty chats.
  if (source) {
    const canonical = await resolveConversationNumber(number);
    await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name, canonical]);
  }
  return getContact(number);
}

async function getContact(number) {
  const clean = cleanNumber(number);
  const row = await db.get(
    "SELECT number, name, jid, last_seen_at AS lastSeenAt, tags, variables FROM contacts WHERE number = ? AND name_source IN ('whatsapp', 'manual') AND name <> ''",
    [clean]
  );
  if (!row) return null;
  return { ...row, tags: parseJson(row.tags, []), variables: parseJson(row.variables, {}) };
}

// Import only the address book; importing must not create empty conversations or
// overwrite WhatsApp JIDs, variables, existing tags or actual last activity dates.
async function importContacts(contacts) {
  const result = { imported: 0, updated: 0, errors: [] };
  for (const contact of contacts) {
    try {
      const existing = await getContact(contact.number);
      const tags = [...new Set([...(existing?.tags || []), ...contact.tags])];
      await db.run(
        `INSERT INTO contacts (number, name, push_name, jid, last_seen_at, tags, variables, name_source)
         VALUES (?, ?, '', ?, '', ?, '{}', 'manual')
         ON CONFLICT(number) DO UPDATE SET
           name = CASE WHEN contacts.name_source = 'whatsapp' THEN contacts.name WHEN excluded.name <> '' THEN excluded.name ELSE contacts.name END,
           name_source = CASE WHEN contacts.name_source = 'whatsapp' THEN contacts.name_source ELSE 'manual' END,
           tags = excluded.tags`,
        [contact.number, contact.name, `${contact.number}@s.whatsapp.net`, JSON.stringify(tags)]
      );
      result[existing ? 'updated' : 'imported']++;
    } catch {
      result.errors.push({ line: contact.line, error: 'Não foi possível salvar este contato. Tente importar novamente.' });
    }
  }
  return result;
}

async function getContacts() {
  const rows = await db.all(
    "SELECT number, name, jid, last_seen_at AS lastSeenAt, tags, variables FROM contacts WHERE name_source IN ('whatsapp', 'manual') AND name <> '' ORDER BY name COLLATE NOCASE ASC, number ASC",
    []
  );
  return rows.map((r) => ({ ...r, tags: parseJson(r.tags, []), variables: parseJson(r.variables, {}) }));
}

async function removeSavedContact(number) {
  const clean = cleanNumber(number);
  await db.run("UPDATE contacts SET name = '', name_source = '', tags = '[]', variables = '{}' WHERE number = ?", [clean]);
  return { number: clean };
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

async function updateMessageStatus(waMsgId, status, returnConversation = true) {
  if (!waMsgId || !Number.isInteger(status) || status < 0 || status > 5) return null;
  const result = await db.run(`INSERT INTO message_receipts (whatsapp_msg_id, status) VALUES (?, ?)
    ON CONFLICT(whatsapp_msg_id) DO UPDATE SET status = excluded.status
    WHERE (excluded.status > message_receipts.status AND NOT (message_receipts.status = 0 AND excluded.status = 1)) OR (excluded.status = 0 AND message_receipts.status < 2 AND message_receipts.status <> 0)`, [waMsgId, status]);
  if (!returnConversation || !result.changes) return null;
  const message = await db.get("SELECT number FROM messages WHERE whatsapp_msg_id = ? AND from_role = 'admin'", [waMsgId]);
  return message ? getConversation(message.number, false, { messageId: waMsgId }) : null;
}

async function addMessage(number, from, text = '', name = '', media = {}, waMsgId = '', waStatus, details = {}) {
  // Serialize duplicate checks with insertion: history and a live echo can carry
  // the same WhatsApp ID concurrently. A failed insert must not leave half a record.
  const result = await db.transaction(() => insertMessage(number, from, text, name, media, waMsgId, waStatus, { ...details, deferConversation: true }));
  return details.deferConversation ? result : getConversation(result.number, true, details.delta && waMsgId ? { messageId: waMsgId } : {});
}

async function insertMessage(number, from, text, name, media, waMsgId, waStatus, details) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number, name);

  const at = details.at ? new Date(details.at).toISOString() : new Date().toISOString();
  if (from === 'admin' && waMsgId && Number.isInteger(waStatus)) await updateMessageStatus(waMsgId, waStatus, false);
  if (waMsgId && await db.get('SELECT id FROM messages WHERE number = ? AND whatsapp_msg_id = ?', [number, waMsgId])) {
    return details.deferConversation ? { number } : getConversation(number);
  }
  const hasMedia = !!(media && media.type && media.type !== 'text');

  await db.run(
    `INSERT INTO messages (number, from_role, text, at, type, media_url, mime_type, file_name, caption, whatsapp_msg_id, whatsapp_payload, message_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      serializeMessage(details.raw),
      JSON.stringify({ replyTo: details.replyTo || null, forwarded: !!details.forwarded }),
    ]
  );

  const lastMessage = hasMedia ? (media.caption || `[${MEDIA_LABELS[media.type] || 'Anexo'}]`) : text;
  await db.run(
    "UPDATE conversations SET last_message = ?, last_message_at = ?, last_from = ? WHERE number = ? AND (last_message_at IS NULL OR last_message_at = '' OR last_message_at <= ?)",
    [lastMessage, at, from, number, at]
  );
  if (name) {
    const existing = await db.get('SELECT name FROM conversations WHERE number = ?', [number]);
    if (!existing?.name) {
      await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name, number]);
    }
  }

  return details.deferConversation ? { number } : getConversation(number);
}

async function getStoredMessages(number, ids) {
  number = await resolveConversationNumber(number);
  ids = messageIds(ids);
  const rows = await db.all(`SELECT * FROM messages WHERE number = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY at ASC, id ASC`, [number, ...ids]);
  if (rows.length !== ids.length) throw Object.assign(new Error('Mensagem não encontrada nesta conversa.'), { statusCode: 404 });
  return rows.map(row => ({ ...row, raw: parseMessage(row.whatsapp_payload) }));
}

async function deleteMessages(number, ids) {
  const rows = await getStoredMessages(number, ids);
  number = rows[0].number;
  await db.transaction(async () => {
    for (const row of rows) await db.run('DELETE FROM messages WHERE id = ? AND number = ?', [row.id, number]);
    const last = await db.get('SELECT * FROM messages WHERE number = ? ORDER BY at DESC, id DESC LIMIT 1', [number]);
    const preview = last?.type ? last.caption || `[${MEDIA_LABELS[last.type] || 'Anexo'}]` : last?.text || '';
    await db.run('UPDATE conversations SET last_message = ?, last_message_at = ?, last_from = ? WHERE number = ?', [preview, last?.at || '', last?.from_role || '', number]);
  });
  return getConversation(number, false);
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
    'UPDATE conversations SET is_finalized = 0, finalized_at = NULL, flow_stopped = 0 WHERE number = ?',
    [number]
  );
  return getConversation(number);
}

async function stopConversationFlow(number) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  await db.run('UPDATE conversations SET flow_stopped = 1 WHERE number = ?', [number]);
  return getConversation(number);
}

async function setConversationDepartment(number, departmentId) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  await db.run('UPDATE conversations SET department_id = ? WHERE number = ?', [departmentId || null, number]);
  return getConversation(number);
}
async function assignConversation(number, userId) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  await db.run('UPDATE conversations SET assigned_user_id = ? WHERE number = ?', [userId || null, number]);
  return getConversation(number);
}

async function setDefaultConversationDepartment(number, departmentId) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number);
  await db.run('UPDATE conversations SET department_id = ? WHERE number = ? AND department_id IS NULL', [departmentId || null, number]);
  return getConversation(number);
}

async function setAllConversationsDepartment(departmentId) {
  await db.run('UPDATE conversations SET department_id = ?', [departmentId || null]);
  return true;
}

async function clearConversationsDepartment(departmentId) {
  await db.run('UPDATE conversations SET department_id = NULL WHERE department_id = ?', [departmentId]);
  return true;
}

async function resolveConversationNumber(number) {
  const clean = cleanNumber(number);
  if (!clean) return clean;
  const alias = await db.get('SELECT number FROM conversation_aliases WHERE alias = ?', [clean]);
  if (alias) return alias.number;
  const routing = await db.get('SELECT jid FROM contacts WHERE number = ?', [clean]);
  if (routing?.jid?.endsWith('@lid')) {
    const lid = routing.jid.split('@')[0].split(':')[0];
    const conversation = await db.get('SELECT number FROM conversations WHERE number = ?', [lid]);
    if (conversation) return conversation.number;
  }
  const phoneConversation = await db.get('SELECT conversations.number FROM contacts JOIN conversations ON contacts.number = conversations.number WHERE contacts.jid = ? LIMIT 1', [`${clean}@lid`]);
  if (phoneConversation) return phoneConversation.number;
  return clean;
}

async function registerConversationAliases(primary, phone = '', { create = true } = {}) {
  const primaryNumber = cleanNumber(primary);
  const phoneNumber = cleanNumber(phone);
  if (!primaryNumber) return phoneNumber;

  const existing = await db.get(
    'SELECT number FROM conversation_aliases WHERE alias IN (?, ?) ORDER BY CASE WHEN alias = ? THEN 0 ELSE 1 END LIMIT 1',
    [primaryNumber, phoneNumber || primaryNumber, primaryNumber]
  );
  const knownPrimary = await resolveConversationNumber(primaryNumber);
  const knownPhone = phoneNumber ? await resolveConversationNumber(phoneNumber) : '';
  const existingConversation = existing || await db.get(
    'SELECT number FROM conversations WHERE number IN (?, ?) ORDER BY CASE WHEN number = ? THEN 0 ELSE 1 END LIMIT 1',
    [knownPhone || knownPrimary, knownPrimary, knownPhone || knownPrimary]
  );
  const canonical = existingConversation?.number || primaryNumber;

  const hasConversation = await db.get('SELECT number FROM conversations WHERE number IN (?, ?, ?) LIMIT 1', [canonical, primaryNumber, phoneNumber || primaryNumber]);
  if (!hasConversation && !create) return canonical;
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

async function getAll({ metadataOnly = false } = {}) {
  const names = new Map((await getContacts()).map((contact) => [contact.number, contact.name]));
  const convos = await db.all('SELECT * FROM conversations WHERE EXISTS (SELECT 1 FROM messages WHERE messages.number = conversations.number)', []);
  const aliasRows = await db.all('SELECT alias, number FROM conversation_aliases', []);
  const aliasesByNumber = {};
  const canonicalByAlias = new Map(aliasRows.map((row) => [row.alias, row.number]));
  for (const row of aliasRows) (aliasesByNumber[row.number] ||= []).push(row.alias);
  const routing = await db.all('SELECT number, jid FROM contacts', []);
  for (const contact of routing) {
    if (!contact.jid?.endsWith('@lid') || !/^[1-9]\d{6,12}$/.test(contact.number)) continue;
    const lid = contact.jid.split('@')[0].split(':')[0];
    const canonical = canonicalByAlias.get(lid) || lid;
    (aliasesByNumber[canonical] ||= []).push(contact.number);
  }
  const result = {};
  const blockedContacts = await db.all('SELECT number FROM blocked_contacts', []);
  const blocked = new Set(blockedContacts.map(contact => contact.number));
  const messagesByNumber = new Map();
  const messageRows = metadataOnly ? [] : await db.all(`SELECT ${MESSAGE_VIEW_COLUMNS} FROM messages LEFT JOIN message_receipts ON messages.whatsapp_msg_id = message_receipts.whatsapp_msg_id ORDER BY number ASC, at ASC, id ASC`, []);
  for (const row of messageRows) {
    if (!messagesByNumber.has(row.number)) messagesByNumber.set(row.number, []);
    messagesByNumber.get(row.number).push(row);
  }
  for (const convo of convos) {
    convo.name = [convo.number, ...(aliasesByNumber[convo.number] || [])].map((number) => names.get(number)).find(Boolean) || '';
    convo.blocked = blocked.has(convo.number);
    const rows = messagesByNumber.get(convo.number) || [];
    result[convo.number] = formatConversation(convo, rows, aliasesByNumber[convo.number] || []);
  }

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
  return db.all('SELECT * FROM tags WHERE account_id = ? ORDER BY name ASC', [accountId()]);
}

async function createTag(name, color = '#5c8df6') {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO tags (name, color, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?)', [name.trim(), color, now, accountId(), actorId(), departmentId()]);
  return db.get('SELECT * FROM tags WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
}

async function updateTag(id, name, color) {
  await db.run('UPDATE tags SET name = ?, color = ? WHERE id = ? AND account_id = ?', [name.trim(), color, id, accountId()]);
  return db.get('SELECT * FROM tags WHERE id = ? AND account_id = ?', [id, accountId()]);
}

async function deleteTag(id) {
  await db.run('DELETE FROM tags WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

// ==================== DEPARTMENTS CRUD ====================
async function getDepartments() {
  return db.all('SELECT * FROM departments WHERE account_id = ? ORDER BY name ASC', [accountId()]);
}

async function createDepartment(name, description = '') {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO departments (name, description, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?)', [name.trim(), description, now, accountId(), actorId(), departmentId()]);
  return db.get('SELECT * FROM departments WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
}

async function updateDepartment(id, name, description) {
  await db.run('UPDATE departments SET name = ?, description = ? WHERE id = ? AND account_id = ?', [name.trim(), description, id, accountId()]);
  return db.get('SELECT * FROM departments WHERE id = ? AND account_id = ?', [id, accountId()]);
}

async function deleteDepartment(id) {
  await db.run('DELETE FROM departments WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

// ==================== CAMPAIGNS CRUD ====================
async function getCampaigns() {
  const rows = await db.all('SELECT * FROM campaigns WHERE account_id = ? ORDER BY created_at DESC', [accountId()]);
  return rows.map((r) => ({
    ...r,
    target_tags: parseJson(r.target_tags, []),
    blocked_tags: parseJson(r.blocked_tags, []),
  }));
}

async function createCampaign(data) {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO campaigns (name, message, target_tags, blocked_tags, scheduled_at, chip, status, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [data.name, data.message, JSON.stringify(data.target_tags || []), JSON.stringify(data.blocked_tags || []), data.scheduled_at || null, data.chip || null, 'draft', now, accountId(), actorId(), departmentId()]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

async function updateCampaign(id, data) {
  await db.run('UPDATE campaigns SET name = ?, message = ?, target_tags = ?, blocked_tags = ?, scheduled_at = ?, chip = ? WHERE id = ? AND account_id = ?', [data.name, data.message, JSON.stringify(data.target_tags || []), JSON.stringify(data.blocked_tags || []), data.scheduled_at || null, data.chip || null, id, accountId()]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ? AND account_id = ?', [id, accountId()]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

async function deleteCampaign(id) {
  await db.run('DELETE FROM campaigns WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

async function duplicateCampaign(id) {
  const original = await db.get('SELECT * FROM campaigns WHERE id = ? AND account_id = ?', [id, accountId()]);
  if (!original) throw new Error('Campanha não encontrada.');
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO campaigns (name, message, target_tags, blocked_tags, scheduled_at, chip, status, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`${original.name} (cópia)`, original.message, original.target_tags, original.blocked_tags, null, original.chip, 'draft', now, accountId(), actorId(), departmentId()]
  );
  const row = await db.get('SELECT * FROM campaigns WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  return { ...row, target_tags: parseJson(row.target_tags, []), blocked_tags: parseJson(row.blocked_tags, []) };
}

// ==================== WEBHOOKS CRUD ====================
async function getWebhooks() {
  const rows = await db.all('SELECT * FROM webhooks WHERE account_id = ? ORDER BY created_at DESC', [accountId()]);
  return rows.map((r) => ({ ...r, events: parseJson(r.events, []) }));
}

async function createWebhook(data) {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO webhooks (name, url, events, secret, active, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [data.name, data.url, JSON.stringify(data.events || []), data.secret || '', data.active !== false ? 1 : 0, now, accountId(), actorId(), departmentId()]
  );
  const row = await db.get('SELECT * FROM webhooks WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  return { ...row, events: parseJson(row.events, []) };
}

async function updateWebhook(id, data) {
  await db.run('UPDATE webhooks SET name = ?, url = ?, events = ?, secret = ?, active = ? WHERE id = ? AND account_id = ?', [data.name, data.url, JSON.stringify(data.events || []), data.secret || '', data.active !== false ? 1 : 0, id, accountId()]
  );
  const row = await db.get('SELECT * FROM webhooks WHERE id = ? AND account_id = ?', [id, accountId()]);
  return { ...row, events: parseJson(row.events, []) };
}

async function deleteWebhook(id) {
  await db.run('DELETE FROM webhooks WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

// ==================== KANBAN CRUD ====================
async function getKanbanColumns() {
  return db.all('SELECT * FROM kanban_columns WHERE account_id = ? ORDER BY position ASC', [accountId()]);
}

async function createKanbanColumn(name, funnelId) {
  const funnels = require('./funnel-store');
  const funnel = funnelId ? await db.get('SELECT * FROM funnels WHERE id = ? AND account_id = ?', [funnelId, accountId()]) : await funnels.defaultFunnel();
  if (!funnel) throw Object.assign(new Error('Funil não encontrado.'), { statusCode: 404 });
  const now = new Date().toISOString();
  const countRow = await db.get('SELECT COUNT(*) as c FROM kanban_columns WHERE account_id = ? AND funnel_id = ?', [accountId(), funnel.id]);
  const position = Number(countRow?.c || 0);
  const result = await db.run('INSERT INTO kanban_columns (name, position, created_at, account_id, created_by, department_id, funnel_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, position, now, accountId(), actorId(), departmentId(), funnel.id]);
  const actor = await db.get('SELECT funnels FROM users WHERE id = ? AND account_id = ?', [actorId(), accountId()]);
  if (actor) await db.run('UPDATE users SET funnels = ? WHERE id = ? AND account_id = ?', [JSON.stringify([...new Set([...parseJson(actor.funnels, []), String(result.lastID)])]), actorId(), accountId()]);
  const column = await db.get('SELECT * FROM kanban_columns WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  await funnels.columnHistory(column, `Etapa "${name}" criada.`);
  return column;
}

async function updateKanbanColumn(id, name) {
  await db.run('UPDATE kanban_columns SET name = ? WHERE id = ? AND account_id = ?', [name, id, accountId()]);
  const column = await db.get('SELECT * FROM kanban_columns WHERE id = ? AND account_id = ?', [id, accountId()]);
  await require('./funnel-store').columnHistory(column, `Etapa renomeada para "${name}".`);
  return column;
}

async function deleteKanbanColumn(id) {
  const column = await db.get('SELECT * FROM kanban_columns WHERE id = ? AND account_id = ?', [id, accountId()]);
  await require('./funnel-store').columnHistory(column, `Etapa "${column?.name}" excluída.`);
  await db.run('DELETE FROM opportunities WHERE column_id = ? AND account_id = ?', [id, accountId()]);
  await db.run('DELETE FROM kanban_columns WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

async function getOpportunities() {
  const opps = await db.all('SELECT * FROM opportunities WHERE account_id = ? ORDER BY column_id ASC, position ASC', [accountId()]);
  return opps;
}

async function createOpportunity(data) {
  const now = new Date().toISOString();
  const countRow = await db.get('SELECT COUNT(*) as c FROM opportunities WHERE column_id = ? AND account_id = ?', [data.column_id, accountId()]);
  const position = Number(countRow?.c || 0);
  const result = await db.run('INSERT INTO opportunities (title, contact_number, contact_name, value, column_id, position, status, created_at, updated_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [data.title, data.contact_number || '', data.contact_name || '', data.value || 0, data.column_id, position, 'open', now, now, accountId(), actorId(), departmentId()]
  );
  const item = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  await require('./funnel-store').opportunityHistory(item, `Oportunidade "${item.title}" criada.`);
  return item;
}

async function updateOpportunity(id, data) {
  const before = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  const now = new Date().toISOString();
  await db.run('UPDATE opportunities SET title = ?, contact_number = ?, contact_name = ?, value = ?, column_id = ?, position = ?, updated_at = ? WHERE id = ? AND account_id = ?', [data.title, data.contact_number || '', data.contact_name || '', data.value || 0, data.column_id, data.position || 0, now, id, accountId()]
  );
  const item = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  if (item) {
    const description = `Oportunidade "${item.title}" ${String(before?.column_id) !== String(item.column_id) ? 'movida de etapa' : 'atualizada'}.`;
    await require('./funnel-store').opportunityHistory(item, description);
    if (before && String(before.column_id) !== String(item.column_id)) {
      const [source, target] = await Promise.all([db.get('SELECT funnel_id FROM kanban_columns WHERE id = ?', [before.column_id]), db.get('SELECT funnel_id FROM kanban_columns WHERE id = ?', [item.column_id])]);
      if (source?.funnel_id !== target?.funnel_id) await require('./funnel-store').opportunityHistory(before, description);
    }
  }
  return item;
}

async function winOpportunity(id) {
  const now = new Date().toISOString();
  await db.run('UPDATE opportunities SET status = ?, won_at = ?, updated_at = ? WHERE id = ? AND account_id = ?', ['won', now, now, id, accountId()]);
  const item = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  if (item) await require('./funnel-store').opportunityHistory(item, `Oportunidade "${item.title}" marcada como ganha.`);
  return item;
}

async function loseOpportunity(id, lossReasonId) {
  const now = new Date().toISOString();
  await db.run('UPDATE opportunities SET status = ?, lost_at = ?, loss_reason_id = ?, updated_at = ? WHERE id = ? AND account_id = ?', ['lost', now, lossReasonId || null, now, id, accountId()]
  );
  const item = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  if (item) await require('./funnel-store').opportunityHistory(item, `Oportunidade "${item.title}" marcada como perdida.`);
  return item;
}

async function deleteOpportunity(id) {
  const item = await db.get('SELECT * FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  if (item) await require('./funnel-store').opportunityHistory(item, `Oportunidade "${item.title}" excluída.`);
  await db.run('DELETE FROM opportunities WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

// ==================== LOSS REASONS CRUD ====================
async function getLossReasons() {
  return db.all('SELECT * FROM loss_reasons WHERE account_id = ? ORDER BY name ASC', [accountId()]);
}

async function createLossReason(name) {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO loss_reasons (name, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?)', [name.trim(), now, accountId(), actorId(), departmentId()]);
  return db.get('SELECT * FROM loss_reasons WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
}

async function deleteLossReason(id) {
  await db.run('DELETE FROM loss_reasons WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

// ==================== FLOWS CRUD ====================
async function getFlows() { return require('./flows/store').list(); }
async function createFlow(data) { return require('./flows/store').create(data); }
async function updateFlow(id, data) { return require('./flows/store').update(id, data); }
async function duplicateFlow(id) {
  const flows = require('./flows/store'), original = await flows.get(id);
  if (!original) throw new Error('Fluxo nao encontrado.');
  return flows.create({name: original.name.slice(0,110) + ' (copia)', description: original.description, definition: flows.remap(original.definition), trigger_chips: original.trigger_chips});
}
async function deleteFlow(id) { await require('./flows/store').remove(id); return true; }

// ==================== GLOBAL VARIABLES ====================
async function getGlobalVariables() {
  return db.all('SELECT * FROM global_variables WHERE account_id = ? ORDER BY key ASC', [accountId()]);
}

async function setGlobalVariable(key, value, valueType = 'text') {
  const now = new Date().toISOString();
  await db.run(`INSERT INTO global_variables (key, value, value_type, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value, value_type = excluded.value_type`, [key.trim(), value, valueType, now, accountId(), actorId(), departmentId()]
  );
  return db.get('SELECT * FROM global_variables WHERE key = ? AND account_id = ?', [key.trim(), accountId()]);
}

async function deleteGlobalVariable(key) {
  await db.run('DELETE FROM global_variables WHERE key = ? AND account_id = ?', [key, accountId()]);
  return true;
}

// ==================== FOLLOW-UPS ====================
async function getFollowups() {
  const rows = await db.all('SELECT * FROM followups WHERE account_id = ? ORDER BY created_at DESC', [accountId()]);
  return rows.map((r) => ({
    ...r,
    active_days: parseJson(r.active_days, [0, 1, 2, 3, 4, 5, 6]),
    tags: parseJson(r.tags, []),
  }));
}

async function createFollowup(data) {
  const now = new Date().toISOString();
  const result = await db.run('INSERT INTO followups (name, message, delay_hours, active_days, chip, tags, active, created_at, account_id, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [data.name, data.message, data.delay_hours || 24, JSON.stringify(data.active_days || [0,1,2,3,4,5,6]), data.chip || null, JSON.stringify(data.tags || []), 1, now, accountId(), actorId(), departmentId()]
  );
  const row = await db.get('SELECT * FROM followups WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
  return { ...row, active_days: parseJson(row.active_days, [0,1,2,3,4,5,6]), tags: parseJson(row.tags, []) };
}

async function updateFollowup(id, data) {
  await db.run('UPDATE followups SET name = ?, message = ?, delay_hours = ?, active_days = ?, chip = ?, tags = ?, active = ? WHERE id = ? AND account_id = ?', [data.name, data.message, data.delay_hours || 24, JSON.stringify(data.active_days || [0,1,2,3,4,5,6]), data.chip || null, JSON.stringify(data.tags || []), data.active ? 1 : 0, id, accountId()]
  );
  const row = await db.get('SELECT * FROM followups WHERE id = ? AND account_id = ?', [id, accountId()]);
  return { ...row, active_days: parseJson(row.active_days, [0,1,2,3,4,5,6]), tags: parseJson(row.tags, []) };
}

async function deleteFollowup(id) {
  await db.run('DELETE FROM followups WHERE id = ? AND account_id = ?', [id, accountId()]);
  return true;
}

module.exports = {
  getStoredMessages,
  deleteMessages,
  removeSavedContact,
  assignConversation,
  updateMessageStatus,
  addMessage,
  saveContact,
  importContacts,
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
  stopConversationFlow,
  setConversationDepartment,
  setDefaultConversationDepartment,
  setAllConversationsDepartment,
  clearConversationsDepartment,
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

// Keep each board change and its history entry atomic.
for (const name of ['createKanbanColumn', 'updateKanbanColumn', 'deleteKanbanColumn', 'createOpportunity', 'updateOpportunity', 'winOpportunity', 'loseOpportunity', 'deleteOpportunity']) {
  const operation = module.exports[name];
  module.exports[name] = (...args) => db.transaction(() => operation(...args));
}
