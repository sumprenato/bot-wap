const { parseMessage } = require('./message-data');

function normalizedJid(jid) {
  if (typeof jid !== 'string') return '';
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(jid);
  return match ? `${match[1]}@${match[2]}` : '';
}

// Each worker owns one account. Keep recent sends available even before their
// database insert completes; persisted payloads cover reconnects and restarts.
function createMessageRetryStore({ db, store, maxEntries = 512, ttlMs = 3600000, now = Date.now }) {
  const recent = new Map();
  const cacheKey = (jid, id) => `${jid}/${id}`;

  function remember(msg) {
    if (!msg?.key?.id || !msg.message) return;
    for (const jid of new Set([msg.key.remoteJid, msg.key.remoteJidAlt].map(normalizedJid).filter(Boolean))) {
      const key = cacheKey(jid, msg.key.id);
      recent.delete(key);
      recent.set(key, { message: msg.message, expires: now() + ttlMs });
    }
    while (recent.size > maxEntries) recent.delete(recent.keys().next().value);
  }

  async function getMessage(key) {
    const jid = normalizedJid(key?.remoteJid);
    if (!jid || !key?.id) return undefined;
    const cachedKey = cacheKey(jid, key.id);
    const cached = recent.get(cachedKey);
    if (cached?.expires > now()) return cached.message;
    recent.delete(cachedKey);
    const number = await store.resolveConversationNumber(jid.split('@')[0]);
    const row = await db.get('SELECT whatsapp_payload FROM messages WHERE number = ? AND whatsapp_msg_id = ? ORDER BY id DESC LIMIT 1', [number, key.id]);
    // Never fabricate an empty message on a miss: it consumes a retry without
    // giving the receiving device the original encrypted content.
    return parseMessage(row?.whatsapp_payload)?.message || undefined;
  }

  return { remember, getMessage, clear: () => recent.clear() };
}

module.exports = { createMessageRetryStore };
