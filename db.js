const path = require('path');
const fs = require('fs');

// Todos os dados que precisam sobreviver a um redeploy (banco SQLite local,
// caso não haja Postgres) ficam dentro de STORAGE_DIR. No Railway, aponte essa
// variável para um Volume (ex.: STORAGE_DIR=/app/storage) para persistir.
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
const defaultPassword = process.env.ADMIN_PASSWORD || 'troque-esta-senha';

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

async function seedAdminUser() {
  const existing = await get('SELECT id, password FROM users WHERE username = ?', [defaultUsername]);
  if (existing) {
    if (existing.password === 'troque-esta-senha' && defaultPassword !== existing.password) {
      await run('UPDATE users SET password = ? WHERE id = ?', [defaultPassword, existing.id]);
    }
    return;
  }

  const legacyAdmin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (legacyAdmin && defaultUsername !== 'admin') {
    await run(
      'UPDATE users SET username = ?, password = ? WHERE id = ?',
      [defaultUsername, defaultPassword, legacyAdmin.id]
    );
    return;
  }

  if (!existing) {
    await run('INSERT INTO users (username, password) VALUES (?, ?)', [defaultUsername, defaultPassword]);
  }
}

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
        password TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        number TEXT PRIMARY KEY,
        name TEXT DEFAULT '',
        blocked INTEGER DEFAULT 0,
        last_message TEXT DEFAULT '',
        last_message_at TEXT DEFAULT '',
        last_from TEXT DEFAULT ''
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_aliases (
        alias TEXT PRIMARY KEY,
        number TEXT NOT NULL REFERENCES conversations(number) ON DELETE CASCADE
      )
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

  ready = new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL
        )
      `);
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          number TEXT PRIMARY KEY,
          name TEXT DEFAULT '',
          blocked INTEGER DEFAULT 0,
          last_message TEXT DEFAULT '',
          last_message_at TEXT DEFAULT '',
          last_from TEXT DEFAULT ''
        )
      `);
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS conversation_aliases (
          alias TEXT PRIMARY KEY,
          number TEXT NOT NULL,
          FOREIGN KEY (number) REFERENCES conversations(number) ON DELETE CASCADE
        )
      `);
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT NOT NULL,
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
      sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_messages_number ON messages(number)', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }).then(seedAdminUser);
}

module.exports = { run, get, all, ready, backend: () => backend, STORAGE_DIR };
