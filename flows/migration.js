async function migrate(db) {
  const pg = db.backend() === "pg",
    pk = pg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const columns = pg
    ? await db.all(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'flows'",
      )
    : await db.all("PRAGMA table_info(flows)");
  const conversationColumns = pg
    ? await db.all(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'conversations'",
      )
    : await db.all("PRAGMA table_info(conversations)");
  if (!conversationColumns.some((c) => c.name === "flow_stopped"))
    await db.run(
      `ALTER TABLE conversations ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}flow_stopped INTEGER NOT NULL DEFAULT 0`,
    );
  for (const [name, type] of [
    ["definition", "TEXT NOT NULL DEFAULT '{}'"],
    ["revision", "INTEGER NOT NULL DEFAULT 0"],
    ["published_version", "INTEGER"],
    ["triggers_enabled", "INTEGER NOT NULL DEFAULT 1"],
  ]) {
    if (!columns.some((c) => c.name === name))
      await db.run(
        `ALTER TABLE flows ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}${name} ${type}`,
      );
  }
  const variableColumns = pg
    ? await db.all(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'global_variables'",
      )
    : await db.all("PRAGMA table_info(global_variables)");
  if (!variableColumns.some((c) => c.name === "value_type"))
    await db.run(
      `ALTER TABLE global_variables ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}value_type TEXT NOT NULL DEFAULT 'text'`,
    );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_versions (id ${pk}, account_id INTEGER NOT NULL, flow_id INTEGER NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(flow_id, version))`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_revisions (id ${pk}, account_id INTEGER NOT NULL, flow_id INTEGER NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(flow_id,revision))`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_runs (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, flow_id INTEGER NOT NULL, version INTEGER NOT NULL, chip_id INTEGER, contact TEXT NOT NULL, mode TEXT NOT NULL, actor_id INTEGER NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, wake_at TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_active_contact ON flow_runs(account_id, chip_id, contact) WHERE mode = 'live' AND status IN ('ready','running','waiting','sleeping','attention')",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_flow_due ON flow_runs(status, wake_at)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_flow_history ON flow_runs(account_id,flow_id,created_at)",
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_inbox (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, chip_id INTEGER NOT NULL, contact TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, lease_until TEXT, created_at TEXT NOT NULL)`,
  );
  const inboxColumns = pg
    ? await db.all(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'flow_inbox'",
      )
    : await db.all("PRAGMA table_info(flow_inbox)");
  if (!inboxColumns.some((c) => c.name === "lease_until"))
    await db.run(
      `ALTER TABLE flow_inbox ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}lease_until TEXT`,
    );
  if (!inboxColumns.some((c) => c.name === "run_id"))
    await db.run(
      `ALTER TABLE flow_inbox ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}run_id TEXT`,
    );
  if (!inboxColumns.some((c) => c.name === "received_order"))
    await db.run(
      `ALTER TABLE flow_inbox ADD COLUMN ${pg ? "IF NOT EXISTS " : ""}received_order BIGINT NOT NULL DEFAULT 0`,
    );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_flow_inbox_pending ON flow_inbox(status,received_order)",
  );
  await db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_inbox_contact ON flow_inbox(account_id,chip_id,contact) WHERE status = 'processing'",
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_effects (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_logs (id ${pk}, account_id INTEGER NOT NULL, run_id TEXT NOT NULL, node_id TEXT, edge_id TEXT, port TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL)`,
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS idx_flow_logs_run ON flow_logs(run_id, id)",
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_assets (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created_by INTEGER NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL, file_name TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS flow_asset_deliveries (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, asset_id TEXT NOT NULL, chip_id INTEGER NOT NULL, contact TEXT NOT NULL)",
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS flow_counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,
  );
}
module.exports = { migrate };
