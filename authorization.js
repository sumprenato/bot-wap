const db = require('./db');
const rbac = require('./rbac');
const store = require('./store');
const { RESOURCE_TABLES } = require('./rbac-migration');
const collections = { tags: 'tags', departments: 'departments', campaigns: 'campaigns', webhooks: 'webhooks', columns: 'kanban_columns', opportunities: 'opportunities', reasons: 'loss_reasons', flows: 'flows', variables: 'global_variables', followups: 'followups' };
const resourcePatterns = [
  [/^\/(tags|departments|campaigns|webhooks|flows|followups|loss-reasons)\/([^/]+)/, (m) => ({ table: m[1] === 'loss-reasons' ? 'loss_reasons' : m[1], id: m[2] })],
  [/^\/kanban\/(columns|opportunities)\/([^/]+)/, (m) => ({ table: m[1] === 'columns' ? 'kanban_columns' : 'opportunities', id: m[2] })],
];
function safeState(access, state, chip) {
  const channelVisible = ['atendimento.visualizar', 'contatos.visualizar', 'chips.visualizar'].some((permission) => rbac.can(access, permission));
  const conversations = Object.fromEntries(Object.entries(state.conversations || {}).filter(([, item]) => rbac.can(access, 'atendimento.visualizar') && rbac.conversationAllowed(access, item, chip)));
  return { ...state, conversations, activeTarget: conversations[state.activeTarget] ? state.activeTarget : null, admin: access.owner ? state.admin : undefined,
    chipId: channelVisible ? state.chipId : null, chipName: channelVisible ? state.chipName : '',
    channelStatus: channelVisible ? { ...state.channelStatus, admin: access.owner ? state.channelStatus?.admin : undefined, qr: rbac.can(access, 'chips.gerenciar') ? state.channelStatus?.qr : null } : { connected: false, qr: null },
    chips: channelVisible ? (state.chips || []).map((entry) => ({ ...entry, admin: access.owner ? entry.admin : undefined, qr: rbac.can(access, 'chips.gerenciar') ? entry.qr : null })) : [],
    status: channelVisible ? { ...state.status, admin: access.owner ? state.status?.admin : undefined, qr: rbac.can(access, 'chips.gerenciar') ? state.status?.qr : null, adminNumber: access.owner ? state.status?.adminNumber : undefined } : { connected: false },
    authorization: rbac.publicAccess(access), user: { username: access.user.username, displayName: access.user.display_name || access.user.username } };
}
async function validateResources(req, path = req.path) {
  const access = req.access;
  if (/^\/chips\/[^/]+/.test(path)) {
    const id = path.split('/')[2];
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [id, access.accountId]);
    if (!chip) rbac.fail('Chip não encontrado nesta conta.', 404);
    if (!rbac.departmentAllowed(access, chip.department_id)) rbac.fail();
  }
  for (const [pattern, convert] of resourcePatterns) {
    const match = pattern.exec(path);
    if (!match) continue;
    const { table, id } = convert(match);
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ? AND account_id = ?`, [id, access.accountId]);
    if (!row) rbac.fail('Recurso não encontrado nesta conta.', 404);
    if (!rbac.recordAllowed(access, row, table)) rbac.fail();
    req.resource = row;
  }
  if (path.startsWith('/global-variables/') && req.method !== 'GET') {
    const row = await db.get('SELECT * FROM global_variables WHERE key = ? AND account_id = ?', [decodeURIComponent(path.slice('/global-variables/'.length)), access.accountId]);
    if (!row) rbac.fail('Variável não encontrada.', 404);
    if (!rbac.recordAllowed(access, row, 'global_variables')) rbac.fail();
  }
  const body = req.body || {};
  if (path === '/global-variables' && req.method === 'POST' && body.key) {
    const existing = await db.get('SELECT * FROM global_variables WHERE key = ? AND account_id = ?', [body.key.trim(), access.accountId]);
    if (existing && (!rbac.can(access, 'fluxos.editar') || !rbac.recordAllowed(access, existing, 'global_variables'))) rbac.fail();
  }
  for (const [field, table] of [['departmentId', 'departments'], ['department_id', 'departments'], ['column_id', 'kanban_columns'], ['loss_reason_id', 'loss_reasons']]) {
    if (body[field] == null || body[field] === '') continue;
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ? AND account_id = ?`, [body[field], access.accountId]);
    if (!row || !rbac.recordAllowed(access, row, table)) rbac.fail('Recurso fora do escopo autorizado.');
  }
  if (body.chip && /^\d+$/.test(String(body.chip))) {
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [body.chip, access.accountId]);
    if (!chip || !rbac.departmentAllowed(access, chip.department_id)) rbac.fail();
  }
  if (Array.isArray(body.trigger_chips)) for (const id of body.trigger_chips) {
    const chip = await db.get('SELECT * FROM chips WHERE id = ? AND user_id = ?', [id, access.accountId]);
    if (!chip || !rbac.departmentAllowed(access, chip.department_id)) rbac.fail();
  }
  if (Array.isArray(body.tags) || Array.isArray(body.target_tags) || Array.isArray(body.blocked_tags)) {
    const names = [...(body.tags || []), ...(body.target_tags || []), ...(body.blocked_tags || [])];
    for (const name of names) {
      const tag = await db.get('SELECT * FROM tags WHERE name = ? AND account_id = ?', [name, access.accountId]);
      if ((!tag && !access.owner) || (tag && !rbac.recordAllowed(access, tag, 'tags'))) rbac.fail('Rótulo fora do escopo autorizado.');
    }
  }
  const conversationOperation = /^\/(reply|assumir|conversation|conversations|contacts\/[^/]+(?:\/(tags|variables)|$)|whatsapp\/profile)/.test(path);
  if (conversationOperation && path !== '/contacts/import' && path !== '/contacts/export' && (path !== '/reply-media' || req.body?.number)) {
    const chipId = body.chipId || req.query.chipId;
    const chips = await db.all('SELECT * FROM chips WHERE user_id = ?', [access.accountId]);
    const chip = chips.find((entry) => String(entry.id) === String(chipId)) || (!chipId ? chips.find((entry) => entry.is_primary) || chips[0] : null);
    if (chipId && !chip) rbac.fail('Chip não encontrado nesta conta.', 404);
    const pathNumber = /^\/(?:conversation|contacts)\/([^/]+)(?:\/(?:tags|variables|finalize|reopen|assign|messages\/(?:forward|delete)))?$/.exec(path)?.[1];
    const profileNumber = /^\/whatsapp\/profile\/([^/]+)$/.exec(path)?.[1];
    const numbers = [...(Array.isArray(body.numbers) ? body.numbers : []), ...[body.number, pathNumber, path.endsWith('/messages/forward') ? body.targetNumber : null, profileNumber !== 'me' ? profileNumber : null].filter(Boolean)];
    if (chip && !access.owner && !numbers.length && !rbac.departmentAllowed(access, chip.department_id)) rbac.fail();
    if (chip && !access.owner) for (const number of numbers) {
      let conversation = await req.botRequest(chip, 'get-conversation', { number, metadataOnly: true });
      if (!conversation && path.startsWith('/contacts/') && ['department', 'account'].includes(access.scope) && rbac.departmentAllowed(access, chip.department_id)) conversation = { departmentId: chip.department_id };
      const scopedAccess = path.startsWith('/contacts/') || path.startsWith('/whatsapp/profile/') ? { ...access, permissions: [...access.permissions, 'atendimento.visualizar_todos'] } : access;
      if (!rbac.conversationAllowed(scopedAccess, conversation, chip)) rbac.fail('Atendimento fora do seu escopo.');
    }
    if (body.number === null && path === '/assumir' && !access.owner) rbac.fail('Informe o atendimento que deseja liberar.', 400);
  }
}
function middleware({ botRequest, getChips }) {
  return async (req, res, next) => {
    try {
      const access = await rbac.accessFor(req.session.userId);
      if (!access || (req.session.authVersion != null && req.session.authVersion !== access.user.auth_version)) return res.status(401).json({ error: 'Sessão revogada. Faça login novamente.' });
      req.access = access; req.botRequest = botRequest;
      const permission = rbac.routePermission(req.method, req.path);
      const allowed = permission === null || permission === 'state' || (permission === 'contacts-sync' ? ['atendimento.visualizar', 'contatos.visualizar', 'chips.visualizar'].some(value => rbac.can(access, value)) : permission === 'owner' ? access.owner : permission === 'profile-photo' ? rbac.can(access, 'atendimento.visualizar') || rbac.can(access, 'contatos.visualizar') || req.path.endsWith('/me') : rbac.can(access, permission));
      if (!allowed) {
        await rbac.audit(access, 'access.denied', null, {}, { method: req.method, path: req.path });
        return res.status(403).json({ error: 'Você não tem autorização para esta ação.' });
      }
      await validateResources(req);
      const json = res.json.bind(res);
      res.json = (body) => {
        if (body && !body.error) {
          if ('qr' in body && !rbac.can(access, 'chips.gerenciar')) body.qr = null;
          for (const [key, table] of Object.entries(collections)) if (Array.isArray(body[key])) body[key] = body[key].filter((row) => rbac.recordAllowed(access, row, table));
          if (body.conversations) {
            const filtered = Object.fromEntries(Object.entries(body.conversations).filter(([, item]) => rbac.conversationAllowed(access, item, req.selectedChip)));
            body = { ...body, conversations: filtered, activeTarget: filtered[body.activeTarget] ? body.activeTarget : null };
          }
        }
        const administrative = req.method !== 'GET' && res.statusCode < 400 && !body?.error && /^\/(tags|departments|campaigns|webhooks|kanban|loss-reasons|flows|global-variables|followups|chips|profile)(\/|$)/.test(req.path);
        if (administrative) {
          const redact = (value) => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|secret/i.test(key) ? '[omitido]' : Array.isArray(item) ? item.map(redact) : redact(item)])) : value;
          return rbac.audit(access, `resource.${req.method.toLowerCase()}:${req.path}`, null, redact(req.resource || {}), redact(body)).then(() => json(body)).catch(() => { res.statusCode = 500; return json({ error: 'Não foi possível registrar a operação administrativa.' }); });
        }
        return json(body);
      };
      rbac.withAccount(access.accountId, next, access.user.id, req.body?.department_id || req.body?.departmentId || access.departments[0]);
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
  };
}
module.exports = { middleware, safeState, validateResources, collections };
