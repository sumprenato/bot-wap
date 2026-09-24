const path = require('path');
const fs = require('fs');

// Todos os dados que precisam sobreviver a um redeploy (banco SQLite local,
// caso não haja Postgres) ficam dentro de STORAGE_DIR. No Railway, aponte essa
// variável para um Volume (ex.: STORAGE_DIR=/app/storage) para persistir.
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const defaultUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
const defaultWhatsappNumber = String(process.env.ADMIN_NUMBER || '').replace(/\D/g, '');

const usingPostgres = !!(process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL);

let backend;
let pool = null;
let sqliteDb = null;

// Converte SQL escrito com "?" (estilo sqlite) para "$1, $2, ..." (estilo pg)
function toPgQuery(sql, params) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

function run(sql, params = []) {
  if (backend === 'pg') {
    const { text, values } = toPgQuery(sql, params);
    return pool.query(text, values).then((r) => ({ changes: r.rowCount, lastID: r.rows?.[0]?.id }));
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(sql, params = []) {
  if (backend === 'pg') {
    const { text, values } = toPgQuery(sql, params);
    return pool.query(text, values).then((r) => r.rows[0]);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  if (backend === 'pg') {
    const { text, values } = toPgQuery(sql, params);
    return pool.query(text, values).then((r) => r.rows);
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
  `ALTER TABLE messages ADD COLUMN whatsapp_msg_id TEXT DEFAULT ''`,
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
    number TEXT UNIQUE NOT NULL,
    department_id INTEGER DEFAULT NULL,
    status TEXT DEFAULT 'offline',
    created_at TEXT NOT NULL
  )`,
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
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_number ON messages(number)');
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
        number TEXT UNIQUE NOT NULL,
        department_id INTEGER DEFAULT NULL,
        status TEXT DEFAULT 'offline',
        created_at TEXT NOT NULL
      )
    `);
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
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }).then(seedAdminUser);
}

module.exports = { run, get, all, ready, backend: () => backend, STORAGE_DIR };
