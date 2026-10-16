const path = require('path');
const fs = require('fs');

// Todos os dados que precisam sobreviver a um redeploy (banco SQLite local,
// caso não haja Postgres) ficam dentro de STORAGE_DIR. No Railway, aponte essa
// variável para um Volume (ex.: STORAGE_DIR=/app/storage) para persistir.
const STORAGE_DIR = require('./storage-path').resolveStorageDir();
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const defaultUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
const defaultWhatsappNumber = String(process.env.ADMIN_NUMBER || '').replace(/\D/g, '');

const usingPostgres = !!(process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL);

let backend;
let pool = null;
let sqliteDb = null;
const { AsyncLocalStorage } = require('node:async_hooks');
const transactions = new AsyncLocalStorage();
let transactionQueue = Promise.resolve(), activeTransaction = null;

// Converte SQL escrito com "?" (estilo sqlite) para "$1, $2, ..." (estilo pg)
function toPgQuery(sql, params) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

async function run(sql, params = []) {
  if (backend !== 'pg' && activeTransaction && !transactions.getStore()) await activeTransaction;
  if (backend === 'pg') {
    // SQLite exposes the inserted row id as `lastID`; ask PostgreSQL for the
    // same value so store.js CRUD methods can load the newly created row.
    const insertTable = /^\s*INSERT\s+INTO\s+([a-z_]+)/i.exec(sql)?.[1]?.toLowerCase();
    const tablesWithoutId = new Set(['contacts', 'conversations', 'blocked_contacts', 'conversation_aliases', 'message_receipts', 'accounts', 'permission_grants', 'rbac_migrations']);
    const query = insertTable && !tablesWithoutId.has(insertTable) && !/\bRETURNING\b/i.test(sql)
      ? `${sql.trimEnd()} RETURNING id`
      : sql;
    const { text, values } = toPgQuery(query, params);
    return (transactions.getStore()?.client || pool).query(text, values).then((r) => ({ changes: r.rowCount, lastID: r.rows?.[0]?.id }));
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function get(sql, params = []) {
  if (backend !== 'pg' && activeTransaction && !transactions.getStore()) await activeTransaction;
  if (backend === 'pg') {
    const { text, values } = toPgQuery(sql, params);
    return (transactions.getStore()?.client || pool).query(text, values).then((r) => r.rows[0]);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function all(sql, params = []) {
  if (backend !== 'pg' && activeTransaction && !transactions.getStore()) await activeTransaction;
  if (backend === 'pg') {
    const { text, values } = toPgQuery(sql, params);
    return (transactions.getStore()?.client || pool).query(text, values).then((r) => r.rows);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function seedAdminUser() {
  const existing = await get('SELECT id, username, password, display_name, whatsapp_number FROM users WHERE username = ?', [defaultUsername]);
  if (existing) {
    if (existing.password === 'troque-esta-senha' && defaultPassword !== existing.password) {
      await run('UPDATE users SET password = ? WHERE id = ?', [defaultPassword, existing.id]);
    }
    if (!existing.display_name || (defaultWhatsappNumber && !existing.whatsapp_number)) {
      await run('UPDATE users SET display_name = ?, whatsapp_number = CASE WHEN whatsapp_number = \'\' THEN ? ELSE whatsapp_number END WHERE id = ?', [existing.display_name || existing.username, defaultWhatsappNumber, existing.id]);
    }
    return;
  }

  const legacyAdmin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (legacyAdmin && defaultUsername !== 'admin') {
    await run(
      'UPDATE users SET username = ?, display_name = ?, whatsapp_number = ?, password = ? WHERE id = ?',
      [defaultUsername, defaultUsername, defaultWhatsappNumber, defaultPassword, legacyAdmin.id]
    );
    return;
  }

  if (!existing) {
    await run('INSERT INTO users (username, display_name, whatsapp_number, password) VALUES (?, ?, ?, ?)', [defaultUsername, defaultUsername, defaultWhatsappNumber, defaultPassword]);
  }
}

// ==================== MIGRATIONS SQLITE ====================
const SQLITE_MIGRATIONS = [
  // Core tables
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL
  )`,
  `ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN whatsapp_number TEXT NOT NULL DEFAULT ''`,
  `UPDATE users SET username = LOWER(username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp_number ON users (whatsapp_number) WHERE whatsapp_number <> ''`,
  `UPDATE users SET display_name = username WHERE display_name = '' OR display_name IS NULL`,
  `ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'Atendente'`,
  `ALTER TABLE users ADD COLUMN departments TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE users ADD COLUMN access_areas TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE users ADD COLUMN funnels TEXT NOT NULL DEFAULT '[]'`,
  `CREATE TABLE IF NOT EXISTS conversations (
    number TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    blocked INTEGER DEFAULT 0,
    last_message TEXT DEFAULT '',
    last_message_at TEXT DEFAULT '',
    last_from TEXT DEFAULT '',
    department_id INTEGER DEFAULT NULL,
    chip TEXT DEFAULT NULL,
    tags TEXT DEFAULT '[]',
    finalized_at TEXT DEFAULT NULL,
    is_finalized INTEGER DEFAULT 0
  )`,
  `ALTER TABLE conversations ADD COLUMN department_id INTEGER DEFAULT NULL`,
  `ALTER TABLE conversations ADD COLUMN chip TEXT DEFAULT NULL`,
  `ALTER TABLE conversations ADD COLUMN tags TEXT DEFAULT '[]'`,
  `ALTER TABLE conversations ADD COLUMN finalized_at TEXT DEFAULT NULL`,
  `ALTER TABLE conversations ADD COLUMN is_finalized INTEGER DEFAULT 0`,
  `ALTER TABLE conversations ADD COLUMN assigned_user_id INTEGER DEFAULT NULL`,
  `CREATE TABLE IF NOT EXISTS conversation_aliases (
    alias TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    FOREIGN KEY (number) REFERENCES conversations(number) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_contacts (
    number TEXT PRIMARY KEY
  )`,
  `INSERT INTO blocked_contacts (number)
   SELECT number FROM conversations WHERE blocked = 1
   ON CONFLICT(number) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    from_role TEXT NOT NULL,
    text TEXT DEFAULT '',
    at TEXT NOT NULL,
    type TEXT,
    media_url TEXT,
    mime_type TEXT,
    file_name TEXT,
    caption TEXT,
    whatsapp_msg_id TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_number ON messages(number)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_number_at ON messages(number, at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(whatsapp_msg_id)`,
  `CREATE TABLE IF NOT EXISTS contacts (
    number TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    push_name TEXT DEFAULT '',
    jid TEXT DEFAULT '',
    last_seen_at TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    variables TEXT DEFAULT '{}'
  )`,
  `ALTER TABLE contacts ADD COLUMN tags TEXT DEFAULT '[]'`,
  `ALTER TABLE contacts ADD COLUMN variables TEXT DEFAULT '{}'`,
  `ALTER TABLE contacts ADD COLUMN name_source TEXT DEFAULT ''`,
  `ALTER TABLE messages ADD COLUMN whatsapp_msg_id TEXT DEFAULT ''`,
  `ALTER TABLE messages ADD COLUMN whatsapp_payload TEXT DEFAULT ''`,
  `ALTER TABLE messages ADD COLUMN message_context TEXT DEFAULT '{}'`,
  `CREATE TABLE IF NOT EXISTS message_receipts (whatsapp_msg_id TEXT PRIMARY KEY, status INTEGER NOT NULL)`,
  // Tags
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#5c8df6',
    created_at TEXT NOT NULL
  )`,
  // Departments
  `CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  // Chips (WhatsApp numbers/channels)
  `CREATE TABLE IF NOT EXISTS chips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    number TEXT UNIQUE,
    user_id INTEGER DEFAULT NULL,
    department_id INTEGER DEFAULT NULL,
    is_primary INTEGER DEFAULT 0,
    status TEXT DEFAULT 'offline',
    created_at TEXT NOT NULL
  )`,
  `ALTER TABLE chips ADD COLUMN user_id INTEGER DEFAULT NULL`,
  `ALTER TABLE chips ADD COLUMN is_primary INTEGER DEFAULT 0`,
  `ALTER TABLE chips ADD COLUMN identity_verified INTEGER DEFAULT 0`,
  `UPDATE chips SET is_primary = 1 WHERE user_id IS NOT NULL AND id = (SELECT MIN(c2.id) FROM chips c2 WHERE c2.user_id = chips.user_id) AND NOT EXISTS (SELECT 1 FROM chips c3 WHERE c3.user_id = chips.user_id AND c3.is_primary = 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_chips_primary_user ON chips(user_id) WHERE is_primary = 1 AND user_id IS NOT NULL`,
  // Campaigns
  `CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    target_tags TEXT DEFAULT '[]',
    blocked_tags TEXT DEFAULT '[]',
    scheduled_at TEXT DEFAULT NULL,
    status TEXT DEFAULT 'draft',
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    chip TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT DEFAULT NULL,
    finished_at TEXT DEFAULT NULL
  )`,
  // Webhooks
  `CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    secret TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    last_triggered_at TEXT DEFAULT NULL
  )`,
  // Kanban / Opportunities
  `CREATE TABLE IF NOT EXISTS kanban_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    contact_number TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    value REAL DEFAULT 0,
    column_id INTEGER NOT NULL,
    position INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open',
    loss_reason_id INTEGER DEFAULT NULL,
    won_at TEXT DEFAULT NULL,
    lost_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (column_id) REFERENCES kanban_columns(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS loss_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // Flows
  `CREATE TABLE IF NOT EXISTS flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    nodes TEXT DEFAULT '[]',
    edges TEXT DEFAULT '[]',
    active INTEGER DEFAULT 0,
    trigger_keywords TEXT DEFAULT '[]',
    trigger_chips TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Global variables for flows
  `CREATE TABLE IF NOT EXISTS global_variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  // Follow-ups
  `CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    delay_hours INTEGER DEFAULT 24,
    active_days TEXT DEFAULT '[0,1,2,3,4,5,6]',
    chip TEXT DEFAULT NULL,
    tags TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
];

let ready;

if (usingPostgres) {
  backend = 'pg';
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('railway.internal') ? false : { rejectUnauthorized: false },
  });

  ready = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        whatsapp_number TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL
      )
    `);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT \'\'');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number TEXT NOT NULL DEFAULT \'\'');
    await pool.query('UPDATE users SET username = LOWER(username)');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))');
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp_number ON users (whatsapp_number) WHERE whatsapp_number <> ''");
    await pool.query("UPDATE users SET display_name = username WHERE display_name = '' OR display_name IS NULL");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Atendente'");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS departments TEXT NOT NULL DEFAULT '[]'");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_areas TEXT NOT NULL DEFAULT '[]'");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS funnels TEXT NOT NULL DEFAULT '[]'");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        number TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        blocked INTEGER DEFAULT 0,
        last_message TEXT DEFAULT '',
        last_message_at TEXT DEFAULT '',
        last_from TEXT DEFAULT '',
        department_id INTEGER DEFAULT NULL,
        chip TEXT DEFAULT NULL,
        tags TEXT DEFAULT '[]',
        finalized_at TEXT DEFAULT NULL,
        is_finalized INTEGER DEFAULT 0
      )
    `);
    await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS department_id INTEGER DEFAULT NULL');
    await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS chip TEXT DEFAULT NULL');
    await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]'");
    await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS finalized_at TEXT DEFAULT NULL');
    await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_finalized INTEGER DEFAULT 0');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_aliases (
        alias TEXT PRIMARY KEY,
        number TEXT NOT NULL REFERENCES conversations(number) ON DELETE CASCADE
      )
    `);
    await pool.query(`CREATE TABLE IF NOT EXISTS blocked_contacts (number TEXT PRIMARY KEY)`);
    await pool.query(`
      INSERT INTO blocked_contacts (number)
      SELECT number FROM conversations WHERE blocked = 1
      ON CONFLICT (number) DO NOTHING
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        number TEXT NOT NULL REFERENCES conversations(number) ON DELETE CASCADE,
        from_role TEXT NOT NULL,
        text TEXT DEFAULT '',
        at TEXT NOT NULL,
        type TEXT,
        media_url TEXT,
        mime_type TEXT,
        file_name TEXT,
        caption TEXT
      )
    `);
    await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_msg_id TEXT DEFAULT ''");
    await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_payload TEXT DEFAULT ''");
    await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_context TEXT DEFAULT '{}'");
    await pool.query('CREATE TABLE IF NOT EXISTS message_receipts (whatsapp_msg_id TEXT PRIMARY KEY, status INTEGER NOT NULL)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_number ON messages(number)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_number_at ON messages(number, at, id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(whatsapp_msg_id)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        number TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        push_name TEXT DEFAULT '',
        jid TEXT DEFAULT '',
        last_seen_at TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        variables TEXT DEFAULT '{}'
      )
    `);
    await pool.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]'");
    await pool.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS variables TEXT DEFAULT '{}'");
    await pool.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name_source TEXT DEFAULT ''");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#5c8df6',
        created_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chips (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        number TEXT UNIQUE,
        department_id INTEGER DEFAULT NULL,
        is_primary INTEGER DEFAULT 0,
        status TEXT DEFAULT 'offline',
        created_at TEXT NOT NULL
      )
    `);
    await pool.query('ALTER TABLE chips ADD COLUMN IF NOT EXISTS user_id INTEGER DEFAULT NULL');
    await pool.query('ALTER TABLE chips ADD COLUMN IF NOT EXISTS is_primary INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE chips ADD COLUMN IF NOT EXISTS identity_verified INTEGER DEFAULT 0');
    await pool.query('ALTER TABLE chips ALTER COLUMN number DROP NOT NULL');
    await pool.query('UPDATE chips c SET is_primary = 1 WHERE c.user_id IS NOT NULL AND c.id = (SELECT MIN(c2.id) FROM chips c2 WHERE c2.user_id = c.user_id) AND NOT EXISTS (SELECT 1 FROM chips c3 WHERE c3.user_id = c.user_id AND c3.is_primary = 1)');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_chips_primary_user ON chips(user_id) WHERE is_primary = 1 AND user_id IS NOT NULL');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        target_tags TEXT DEFAULT '[]',
        blocked_tags TEXT DEFAULT '[]',
        scheduled_at TEXT DEFAULT NULL,
        status TEXT DEFAULT 'draft',
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        chip TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT DEFAULT NULL,
        finished_at TEXT DEFAULT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        events TEXT DEFAULT '[]',
        secret TEXT DEFAULT '',
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        last_triggered_at TEXT DEFAULT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kanban_columns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        contact_number TEXT DEFAULT '',
        contact_name TEXT DEFAULT '',
        value REAL DEFAULT 0,
        column_id INTEGER NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
        position INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        loss_reason_id INTEGER DEFAULT NULL,
        won_at TEXT DEFAULT NULL,
        lost_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loss_reasons (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        nodes TEXT DEFAULT '[]',
        edges TEXT DEFAULT '[]',
        active INTEGER DEFAULT 0,
        trigger_keywords TEXT DEFAULT '[]',
        trigger_chips TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_variables (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS followups (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        delay_hours INTEGER DEFAULT 24,
        active_days TEXT DEFAULT '[0,1,2,3,4,5,6]',
        chip TEXT DEFAULT NULL,
        tags TEXT DEFAULT '[]',
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);
    await seedAdminUser();
    console.log('✅ Conectado ao PostgreSQL.');
  })();
} else {
  backend = 'sqlite';
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(STORAGE_DIR, 'database.sqlite');
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('❌ Erro ao conectar no SQLite:', err.message);
    else console.log('✅ Conectado ao banco de dados SQLite:', dbPath);
  });
  sqliteDb.run('PRAGMA foreign_keys = ON');

  // Helper to run a migration ignoring expected errors (duplicate column, etc.)
  function runMigration(sql) {
    return new Promise((resolve) => {
      sqliteDb.run(sql, (err) => {
        if (err && !/duplicate column name|already exists/i.test(err.message)) {
          console.error('❌ Migração:', err.message, '\nSQL:', sql.slice(0, 80));
        }
        resolve();
      });
    });
  }

  ready = new Promise((resolve, reject) => {
    sqliteDb.serialize(async () => {
      try {
        for (const sql of SQLITE_MIGRATIONS) {
          await runMigration(sql);
        }
        const columns = await all('PRAGMA table_info(chips)');
        if (columns.find((column) => column.name === 'number')?.notnull) {
          await run('BEGIN IMMEDIATE');
          try {
            await run(`CREATE TABLE chips_qr_migration (
              id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, number TEXT UNIQUE,
              user_id INTEGER DEFAULT NULL, department_id INTEGER DEFAULT NULL,
              is_primary INTEGER DEFAULT 0, status TEXT DEFAULT 'offline', created_at TEXT NOT NULL,
              identity_verified INTEGER DEFAULT 0)`);
            await run('INSERT INTO chips_qr_migration SELECT id, name, number, user_id, department_id, is_primary, status, created_at, identity_verified FROM chips');
            // Keep deleted IDs reserved: worker storage is addressed by chip ID.
            await run("UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'chips'), 0)) WHERE name = 'chips_qr_migration'");
            await run('DROP TABLE chips');
            await run('ALTER TABLE chips_qr_migration RENAME TO chips');
            await run('CREATE UNIQUE INDEX idx_chips_primary_user ON chips(user_id) WHERE is_primary = 1 AND user_id IS NOT NULL');
            await run('COMMIT');
          } catch (error) {
            await run('ROLLBACK');
            throw error;
          }
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }).then(seedAdminUser);
}

function close() {
  if (backend === 'pg') return pool.end();
  return new Promise((resolve, reject) => {
    if (!sqliteDb) return resolve();
    sqliteDb.close((err) => (err ? reject(err) : resolve()));
  });
}

async function transaction(fn) {
  if (transactions.getStore()) return fn();
  const previous = transactionQueue;
  let release;
  transactionQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  let client;
  try {
    client = backend === 'pg' ? await pool.connect() : null;
    if (!client) activeTransaction = transactionQueue;
    return await transactions.run({ client }, async () => {
      await run(client ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try { const result = await fn(); await run('COMMIT'); return result; }
      catch (error) { await run('ROLLBACK'); throw error; }
    });
  } finally { client?.release(); activeTransaction = null; release(); }
}
const database = { run, get, all, transaction, close, backend: () => backend, STORAGE_DIR };
database.ready = ready.then(() => require('./rbac-migration').migrate(database)).then(() => require('./funnel-migration').migrate(database)).then(() => require('./flows/migration').migrate(database)).then(() => require('./whatsapp-message-retry').migrate(database));
module.exports = database;
