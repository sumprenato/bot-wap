async function migrate(db) {
  const pg = db.backend() === 'pg';
  await db.transaction(async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS funnels (
      id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      name TEXT NOT NULL, account_id INTEGER NOT NULL, created_by INTEGER,
      department_id INTEGER, created_at TEXT NOT NULL)`);
    const exists = pg
      ? await db.get("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'kanban_columns' AND column_name = 'funnel_id'")
      : (await db.all('PRAGMA table_info(kanban_columns)')).some(column => column.name === 'funnel_id');
    if (!exists) await db.run('ALTER TABLE kanban_columns ADD COLUMN funnel_id INTEGER REFERENCES funnels(id)');
    await db.run(`CREATE TABLE IF NOT EXISTS funnel_history (
      id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      account_id INTEGER NOT NULL, funnel_id INTEGER NOT NULL, column_id INTEGER,
      opportunity_id INTEGER, created_by INTEGER, assigned_user_id INTEGER, department_id INTEGER,
      actor_id INTEGER, description TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_columns_funnel ON kanban_columns(account_id, funnel_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_history_funnel ON funnel_history(account_id, funnel_id, id)');
    const accounts = await db.all('SELECT DISTINCT account_id FROM kanban_columns WHERE funnel_id IS NULL AND account_id IS NOT NULL');
    for (const { account_id } of accounts) {
      let funnel = await db.get('SELECT id FROM funnels WHERE account_id = ? ORDER BY id LIMIT 1', [account_id]);
      if (!funnel) {
        const owner = await db.get('SELECT owner_id FROM accounts WHERE id = ?', [account_id]);
        const result = await db.run('INSERT INTO funnels(name, account_id, created_by, created_at) VALUES (?, ?, ?, ?)', ['Funil principal', account_id, owner?.owner_id || account_id, new Date().toISOString()]);
        funnel = { id: result.lastID };
      }
      await db.run('UPDATE kanban_columns SET funnel_id = ? WHERE account_id = ? AND funnel_id IS NULL', [funnel.id, account_id]);
    }
  });
}
module.exports = { migrate };
