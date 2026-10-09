const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

test('legacy chips migrate to QR-only channels without losing IDs, metadata or storage reservations', async (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-chip-migration-'));
  const legacy = new sqlite3.Database(path.join(storageDir, 'database.sqlite'));
  await new Promise((resolve, reject) => legacy.exec(`CREATE TABLE chips (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, number TEXT UNIQUE NOT NULL,
    user_id INTEGER DEFAULT NULL, department_id INTEGER DEFAULT NULL,
    is_primary INTEGER DEFAULT 0, status TEXT DEFAULT 'offline', created_at TEXT NOT NULL);
    INSERT INTO chips VALUES (7, 'Antigo', '5511999991234', 1, 9, 1, 'offline', '2026-01-01');
    INSERT INTO chips VALUES (99, 'Removido', '5511999995555', 2, 9, 1, 'offline', '2026-01-01');
    DELETE FROM chips WHERE id=99;`, (error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => legacy.close((error) => error ? reject(error) : resolve()));
  process.env.STORAGE_DIR = storageDir;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  const db = require('../db');
  t.after(async () => { await db.close(); fs.rmSync(storageDir, { recursive: true, force: true }); });
  await db.ready;
  const old = await db.get('SELECT * FROM chips WHERE id = 7');
  assert.equal(old.number, '5511999991234');
  assert.equal(old.identity_verified, 0, 'typed legacy phone is not a verified identity');
  assert.equal(old.name, 'Antigo');
  assert.equal(old.department_id, 9);
  const next = await db.run("INSERT INTO chips(name,number,user_id,is_primary,created_at) VALUES ('Novo',NULL,1,0,'2026-10-08')");
  assert.ok(next.lastID > 99, 'deleted chip IDs cannot be reused for another account storage');
  await db.run("INSERT INTO chips(name,number,user_id,is_primary,created_at) VALUES ('Outro',NULL,1,0,'2026-10-08')");
  await assert.rejects(() => db.run("INSERT INTO chips(name,number,user_id,is_primary,created_at) VALUES ('Principal',NULL,1,1,'2026-10-08')"), /UNIQUE/);
});
