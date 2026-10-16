const db = require('./db');
const { accountId, actorId, departmentId } = require('./account-context');

async function history(funnelId, description, record = {}) {
  await db.run(`INSERT INTO funnel_history(account_id, funnel_id, column_id, opportunity_id, created_by, assigned_user_id, department_id, actor_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [accountId(), funnelId, record.column_id || null, record.opportunity_id || null,
    record.created_by || actorId(), record.assigned_user_id || null, record.department_id || departmentId(), actorId(), description, new Date().toISOString()]);
}
async function list() {
  return db.all('SELECT * FROM funnels WHERE account_id = ? ORDER BY id', [accountId()]);
}
async function create(name) {
  const result = await db.run('INSERT INTO funnels(name, account_id, created_by, department_id, created_at) VALUES (?, ?, ?, ?, ?)', [name, accountId(), actorId(), departmentId(), new Date().toISOString()]);
  await history(result.lastID, `Funil "${name}" criado.`);
  return db.get('SELECT * FROM funnels WHERE id = ? AND account_id = ?', [result.lastID, accountId()]);
}
async function defaultFunnel() {
  return (await list())[0] || create('Funil principal');
}
async function rename(id, name) {
  await db.run('UPDATE funnels SET name = ? WHERE id = ? AND account_id = ?', [name, id, accountId()]);
  await history(id, `Funil renomeado para "${name}".`);
  return db.get('SELECT * FROM funnels WHERE id = ? AND account_id = ?', [id, accountId()]);
}
async function remove(id) {
  await db.run('DELETE FROM opportunities WHERE account_id = ? AND column_id IN (SELECT id FROM kanban_columns WHERE account_id = ? AND funnel_id = ?)', [accountId(), accountId(), id]);
  await db.run('DELETE FROM kanban_columns WHERE account_id = ? AND funnel_id = ?', [accountId(), id]);
  await db.run('DELETE FROM funnel_history WHERE account_id = ? AND funnel_id = ?', [accountId(), id]);
  await db.run('DELETE FROM funnels WHERE account_id = ? AND id = ?', [accountId(), id]);
}
async function columnHistory(column, description) {
  if (column?.funnel_id) await history(column.funnel_id, description, { ...column, column_id: column.id });
}
async function opportunityHistory(item, description) {
  if (!item) return;
  const column = await db.get('SELECT * FROM kanban_columns WHERE account_id = ? AND id = ?', [accountId(), item.column_id]);
  if (column) await history(column.funnel_id, description, { ...item, opportunity_id: item.id });
}
module.exports = {
  list, defaultFunnel, history, columnHistory, opportunityHistory,
  create: name => db.transaction(() => create(name)),
  rename: (id, name) => db.transaction(() => rename(id, name)),
  remove: id => db.transaction(() => remove(id)),
};
