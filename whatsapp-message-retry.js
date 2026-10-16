const { parseMessage, serializeMessage } = require("./message-data");

async function migrate(db) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS whatsapp_retry_messages (jid TEXT NOT NULL, id TEXT NOT NULL, number TEXT NOT NULL, payload TEXT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(jid,id))",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_whatsapp_retry_contact ON whatsapp_retry_messages(number,id)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_whatsapp_retry_expiry ON whatsapp_retry_messages(expires_at)",
  );
}

function content(message) {
  const original = message?.deviceSentMessage?.message || message;
  return original && Object.keys(original).length ? original : undefined;
}

function normalizedJid(jid) {
  if (typeof jid !== "string") return "";
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(jid);
  return match ? `${match[1]}@${match[2]}` : "";
}

// Each worker owns one account. Keep recent sends available even before their
// database insert completes; persisted payloads cover reconnects and restarts.
function createMessageRetryStore({
  db,
  store,
  maxEntries = 512,
  ttlMs = 3600000,
  retentionMs = 7 * 86400000,
  now = Date.now,
}) {
  const recent = new Map();
  const cacheKey = (jid, id) => `${jid}/${id}`;
  let lastPrune = 0;

  function remember(msg) {
    const message = content(msg?.message);
    if (!msg?.key?.id || !message) return;
    for (const jid of new Set(
      [msg.key.remoteJid, msg.key.remoteJidAlt]
        .map(normalizedJid)
        .filter(Boolean),
    )) {
      const key = cacheKey(jid, msg.key.id);
      recent.delete(key);
      recent.set(key, { message, expires: now() + ttlMs });
    }
    while (recent.size > maxEntries) recent.delete(recent.keys().next().value);
  }

  async function persist(msg) {
    const message = content(msg?.message);
    if (!msg?.key?.id || !message) return;
    remember(msg);
    for (const jid of new Set(
      [msg.key.remoteJid, msg.key.remoteJidAlt]
        .map(normalizedJid)
        .filter(Boolean),
    )) {
      const number = await store.resolveConversationNumber(jid.split("@")[0]);
      await db.run(
        "INSERT INTO whatsapp_retry_messages(jid,id,number,payload,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(jid,id) DO UPDATE SET number = excluded.number, payload = excluded.payload, expires_at = excluded.expires_at",
        [
          jid,
          msg.key.id,
          number,
          serializeMessage({ message }),
          now() + retentionMs,
        ],
      );
    }
    if (now() - lastPrune >= 3600000) {
      await db.run(
        "DELETE FROM whatsapp_retry_messages WHERE expires_at <= ?",
        [now()],
      );
      lastPrune = now();
    }
  }

  async function getMessage(key) {
    const jid = normalizedJid(key?.remoteJid);
    if (!jid || !key?.id) return undefined;
    const cachedKey = cacheKey(jid, key.id);
    const cached = recent.get(cachedKey);
    if (cached?.expires > now()) return cached.message;
    recent.delete(cachedKey);
    const number = await store.resolveConversationNumber(jid.split("@")[0]);
    const saved = await db.get(
      "SELECT payload FROM whatsapp_retry_messages WHERE id = ? AND expires_at > ? AND (jid = ? OR number = ? OR number IN (SELECT alias FROM conversation_aliases WHERE number = ?)) ORDER BY CASE WHEN jid = ? THEN 0 ELSE 1 END LIMIT 1",
      [key.id, now(), jid, number, number, jid],
    );
    if (saved?.payload) {
      const message = content(parseMessage(saved.payload)?.message);
      if (message) return message;
    }
    const row = await db.get(
      "SELECT whatsapp_payload FROM messages WHERE number = ? AND whatsapp_msg_id = ? ORDER BY id DESC LIMIT 1",
      [number, key.id],
    );
    // Never fabricate an empty message on a miss: it consumes a retry without
    // giving the receiving device the original encrypted content.
    return content(parseMessage(row?.whatsapp_payload)?.message);
  }

  async function forget(key) {
    const jid = normalizedJid(key?.remoteJid);
    if (!jid || !key?.id) return;
    const number = await store.resolveConversationNumber(jid.split("@")[0]);
    for (const cachedKey of recent.keys()) {
      if (!cachedKey.endsWith(`/${key.id}`)) continue;
      const cachedNumber = await store.resolveConversationNumber(
        cachedKey.split("@")[0],
      );
      if (cachedNumber === number) recent.delete(cachedKey);
    }
    await db.run(
      "DELETE FROM whatsapp_retry_messages WHERE id = ? AND (jid = ? OR number = ? OR number IN (SELECT alias FROM conversation_aliases WHERE number = ?))",
      [key.id, jid, number, number],
    );
  }

  return { remember, persist, getMessage, forget, clear: () => recent.clear() };
}

module.exports = { createMessageRetryStore, migrate };
