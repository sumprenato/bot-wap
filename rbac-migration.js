const RESOURCE_TABLES = ['tags', 'departments', 'campaigns', 'webhooks', 'kanban_columns', 'opportunities', 'loss_reasons', 'flows', 'global_variables', 'followups'];

async function migrate(db) {
  const pg = db.backend() === 'pg';
  const add = async (table, column, type) => {
    const exists = pg ? await db.get('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?', [table, column]) : (await db.all(`PRAGMA table_info(${table})`)).some((item) => item.name === column);
    if (exists) return false;
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${pg ? 'IF NOT EXISTS ' : ''}${column} ${type}`);
    return true;
  };
  const upgrade = async () => db.transaction(async () => {
    await add('accounts', 'display_name', "TEXT NOT NULL DEFAULT ''");
    if (await add('permission_grants', 'grant_kind', "TEXT NOT NULL DEFAULT 'owner'")) {
      await db.run("UPDATE permission_grants SET grant_kind = 'manager' WHERE granted_by <> (SELECT owner_id FROM accounts WHERE id = permission_grants.account_id)");
    }
    await db.run('INSERT INTO rbac_migrations(version) VALUES (2) ON CONFLICT(version) DO NOTHING');
  });
  await db.run('CREATE TABLE IF NOT EXISTS rbac_migrations (version INTEGER PRIMARY KEY)');
  if (await db.get('SELECT version FROM rbac_migrations WHERE version = 1')) { await upgrade(); return; }
  await add('users', 'account_id', 'INTEGER');
  await add('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
  await add('users', 'scope', "TEXT NOT NULL DEFAULT 'own'");
  await add('users', 'supervisor_id', 'INTEGER');
  await add('users', 'supervised_users', "TEXT NOT NULL DEFAULT '[]'");
  await add('users', 'allowed_tags', "TEXT NOT NULL DEFAULT '[]'");
  await add('users', 'deleted_at', 'TEXT');
  await add('users', 'auth_version', 'INTEGER NOT NULL DEFAULT 0');
  await add('conversations', 'assigned_user_id', 'INTEGER');
  await db.run('CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, authorization_version INTEGER NOT NULL DEFAULT 0)');
  await db.run(`CREATE TABLE IF NOT EXISTS permission_grants (account_id INTEGER NOT NULL, user_id INTEGER NOT NULL, permission TEXT NOT NULL, granted_by INTEGER NOT NULL, grant_kind TEXT NOT NULL DEFAULT 'owner', allowed INTEGER NOT NULL, PRIMARY KEY(user_id, permission, granted_by))`);
  await db.run(`CREATE TABLE IF NOT EXISTS audit_log (id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'}, account_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, target_id INTEGER, action TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_log(account_id, id)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_id)');
  const users = await db.all('SELECT * FROM users ORDER BY id');
  const chips = await db.all('SELECT user_id FROM chips');
  const owner = users.find((user) => user.id === 1) || users[0];
  for (const user of users) {
    if (user.account_id) continue;
    const independent = user.id === owner?.id || user.role === 'Proprietário da conta' || !user.email || chips.some((chip) => chip.user_id === user.id);
    const account = independent ? user.id : owner.id;
    await db.run('UPDATE users SET account_id = ?, role = ?, scope = ? WHERE id = ?', [account, independent ? 'Proprietário da conta' : user.role === 'Gerente' ? 'Gerente' : 'Atendente', independent ? 'account' : 'own', user.id]);
    if (independent) await db.run('INSERT INTO accounts(id, owner_id) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [account, user.id]);
  }
  for (const table of RESOURCE_TABLES) {
    await add(table, 'account_id', 'INTEGER');
    await add(table, 'created_by', 'INTEGER');
    await add(table, 'department_id', 'INTEGER');
    await db.run(`UPDATE ${table} SET account_id = ?, created_by = ? WHERE account_id IS NULL`, [owner?.id || 1, owner?.id || 1]);
  }
  await add('opportunities', 'assigned_user_id', 'INTEGER');
  // Rebuild only tables with a legacy global unique name/key, retaining IDs.
  for (const [table, field] of [['tags', 'name'], ['departments', 'name'], ['loss_reasons', 'name'], ['global_variables', 'key']]) {
    if (pg) {
      await db.run(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${field}_key`);
    } else {
      const schema = await db.get('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]);
      if (schema.sql.includes(`${field} TEXT UNIQUE`)) {
        const sequence = await db.get('SELECT seq FROM sqlite_sequence WHERE name = ?', [table]);
        const columns = (await db.all(`PRAGMA table_info(${table})`)).map((row) => row.name).join(', ');
        await db.run('PRAGMA foreign_keys = OFF');
        await db.run('BEGIN IMMEDIATE');
        try {
          await db.run(schema.sql.replace(new RegExp(`CREATE TABLE (?:"${table}"|${table})`, 'i'), `CREATE TABLE ${table}_rbac`).replace(`${field} TEXT UNIQUE`, `${field} TEXT`));
          await db.run(`INSERT INTO ${table}_rbac (${columns}) SELECT ${columns} FROM ${table}`);
          if (sequence) await db.run('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?', [sequence.seq, `${table}_rbac`]);
          await db.run(`DROP TABLE ${table}`);
          await db.run(`ALTER TABLE ${table}_rbac RENAME TO ${table}`);
          await db.run('COMMIT');
        } catch (error) { await db.run('ROLLBACK'); throw error; }
        finally { await db.run('PRAGMA foreign_keys = ON'); }
      }
    }
    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_account_${field} ON ${table}(account_id, ${field})`);
  }
  await db.run('INSERT INTO rbac_migrations(version) VALUES (1)');
  await upgrade();
}
module.exports = { migrate, RESOURCE_TABLES };
