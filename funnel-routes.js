const db = require('./db');
const store = require('./store');
const funnels = require('./funnel-store');
const rbac = require('./rbac');

const validName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) rbac.fail('Informe um nome de até 60 caracteres.', 400);
  return value.trim();
};
async function allowed(access, id, manage = false) {
  const funnel = await db.get('SELECT * FROM funnels WHERE id = ? AND account_id = ?', [id, access.accountId]);
  if (!funnel) rbac.fail('Funil não encontrado.', 404);
  const columns = await db.all('SELECT * FROM kanban_columns WHERE funnel_id = ? AND account_id = ?', [id, access.accountId]);
  const permitted = access.owner || (columns.length
    ? columns[manage ? 'every' : 'some'](column => rbac.recordAllowed(access, column, 'kanban_columns'))
    : Number(funnel.created_by) === access.user.id && rbac.recordAllowed(access, funnel, 'funnels'));
  if (!permitted) rbac.fail();
  return { funnel, columns };
}
function register(app) {
  const route = fn => async (req, res) => { try { await fn(req, res); } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); } };
  app.post('/api/kanban/funnels', route(async (req, res) => {
    res.status(201).json({ ok: true, funnel: await funnels.create(validName(req.body?.name)) });
  }));
  app.put('/api/kanban/funnels/:id', route(async (req, res) => {
    await allowed(req.access, req.params.id, true);
    res.json({ ok: true, funnel: await funnels.rename(req.params.id, validName(req.body?.name)) });
  }));
  app.delete('/api/kanban/funnels/:id', route(async (req, res) => {
    const { columns } = await allowed(req.access, req.params.id, true);
    const ids = new Set(columns.map(column => column.id));
    if ((await store.getOpportunities()).some(item => ids.has(item.column_id) && !rbac.recordAllowed(req.access, item, 'opportunities'))) rbac.fail();
    await funnels.remove(req.params.id);
    res.json({ ok: true });
  }));
  app.get('/api/kanban/funnels/:id/history', route(async (req, res) => {
    const { columns } = await allowed(req.access, req.params.id);
    const visible = new Set(columns.filter(column => rbac.recordAllowed(req.access, column, 'kanban_columns')).map(column => column.id));
    const entries = await db.all(`SELECT h.*, u.display_name AS actor_name FROM funnel_history h LEFT JOIN users u ON u.id = h.actor_id AND u.account_id = h.account_id
      WHERE h.account_id = ? AND h.funnel_id = ? ORDER BY h.id DESC`, [req.access.accountId, req.params.id]);
    res.json({ entries: entries.filter(entry => req.access.owner || (entry.opportunity_id
      ? rbac.recordAllowed(req.access, entry, 'opportunities')
      : entry.column_id ? visible.has(entry.column_id) : Number(entry.created_by) === req.access.user.id)).slice(0, 200) });
  }));
}
module.exports = { register, allowed, validName };
