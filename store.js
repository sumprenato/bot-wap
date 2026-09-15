const db = require('./db');

const MAX_MESSAGES_PER_CONVERSATION = 200;
const MEDIA_LABELS = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' };

function cleanNumber(number) {
  return (number || '').toString().replace(/\D/g, '');
}

function formatConversation(convo, rows) {
  return {
    number: convo.number,
    name: convo.name || '',
    blocked: !!convo.blocked,
    lastMessage: convo.last_message || '',
    lastMessageAt: convo.last_message_at || '',
    lastFrom: convo.last_from || '',
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
    await db.run('INSERT INTO conversations (number, name, blocked) VALUES (?, ?, ?)', [number, '', 0]);
    convo = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  }
  const rows = await db.all('SELECT * FROM messages WHERE number = ? ORDER BY id ASC', [number]);
  return formatConversation(convo, rows);
}

async function ensureConversation(number, name = '') {
  number = await resolveConversationNumber(number);
  const existing = await db.get('SELECT * FROM conversations WHERE number = ?', [number]);
  if (!existing) {
    await db.run('INSERT INTO conversations (number, name, blocked) VALUES (?, ?, ?)', [number, name || '', 0]);
  } else if (name && !existing.name) {
    await db.run('UPDATE conversations SET name = ? WHERE number = ?', [name, number]);
  }
}

async function addMessage(number, from, text = '', name = '', media = {}) {
  number = await resolveConversationNumber(number);
  await ensureConversation(number, name);

  const at = new Date().toISOString();
  const hasMedia = !!(media && media.type && media.type !== 'text');

  await db.run(
    `INSERT INTO messages (number, from_role, text, at, type, media_url, mime_type, file_name, caption)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  await db.run('UPDATE conversations SET blocked = ? WHERE number = ?', [blocked ? 1 : 0, number]);
  return getConversation(number);
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

async function getAll() {
  const convos = await db.all('SELECT * FROM conversations', []);
  const result = {};
  for (const convo of convos) {
    const rows = await db.all('SELECT * FROM messages WHERE number = ? ORDER BY id ASC', [convo.number]);
    result[convo.number] = formatConversation(convo, rows);
  }
  return result;
}

module.exports = {
  addMessage,
  getAll,
  getConversation,
  resolveConversationNumber,
  registerConversationAliases,
  setName,
  setBlocked,
  clearConversation,
  deleteConversation,
};
