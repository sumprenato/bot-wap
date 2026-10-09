const db = require('./db');
const rbac = require('./rbac');

function memberView(user, access) {
  return { id: user.id, username: user.username, name: user.display_name || user.username, displayName: user.display_name || user.username,
    email: user.email || '', role: access?.role || user.role, isOwner: !!access?.owner, status: user.status, departments: rbac.parse(user.departments),
    funnels: rbac.parse(user.funnels), scope: user.scope, supervisorId: user.supervisor_id, team: rbac.parse(user.supervised_users), allowedTags: rbac.parse(user.allowed_tags),
    permissions: access?.permissions || [], directPermissions: access?.directPermissions || [], denied: access?.denied || [] };
}
async function member(access, id) {
  const row = await db.get('SELECT * FROM users WHERE id = ? AND account_id = ? AND deleted_at IS NULL', [id, access.accountId]);
  if (!row) rbac.fail('Membro não encontrado nesta conta.', 404);
  if (!access.owner && !rbac.withinMember(access, row)) rbac.fail();
  return row;
}
async function validateConfig(actor, target, body, currentAccess) {
  const role = body.role || target.role;
  if (![rbac.roles.manager, rbac.roles.attendant, rbac.roles.owner].includes(role)) rbac.fail('Cargo inválido.', 400);
  if (!actor.owner && (role !== rbac.roles.attendant || target.id === actor.user.id)) rbac.fail();
  if (role === rbac.roles.owner && target.id !== actor.user.id) rbac.fail('Utilize a transferência de propriedade para alterar o proprietário.', 400);
  const isOwner = (await db.get('SELECT owner_id FROM accounts WHERE id = ?', [actor.accountId])).owner_id === target.id;
  if (isOwner && role !== rbac.roles.owner) rbac.fail('A conta precisa manter um proprietário ativo.');
  const scope = body.scope ?? target.scope ?? 'own';
  if (!['own', 'department', 'team', 'account'].includes(scope)) rbac.fail('Escopo inválido.', 400);
  const departments = rbac.ids(body.departments ?? rbac.parse(target.departments));
  const funnels = rbac.ids(body.funnels ?? rbac.parse(target.funnels));
  const tags = rbac.ids(body.allowedTags ?? rbac.parse(target.allowed_tags));
  const team = rbac.ids(body.team ?? rbac.parse(target.supervised_users));
  for (const [table, values] of [['departments', departments], ['kanban_columns', funnels], ['tags', tags], ['users', team]]) {
    for (const id of values) {
      if (!/^\d+$/.test(id) || !(await db.get(`SELECT id FROM ${table} WHERE id = ? AND account_id = ?`, [id, actor.accountId]))) rbac.fail('Selecione recursos desta conta.', 400);
    }
  }
  const permissions = body.permissions === undefined ? currentAccess?.permissions || [] : body.permissions;
  if (!Array.isArray(permissions) || permissions.some((item) => !rbac.permissions.includes(item))) rbac.fail('Permissões inválidas.', 400);
  const denied = body.denied ?? currentAccess?.denied ?? [];
  if (!actor.owner && Array.isArray(denied) && permissions.some((permission) => denied.includes(permission))) rbac.fail('Permissão bloqueada pelo proprietário.');
  if (!Array.isArray(denied) || denied.some((item) => !rbac.permissions.includes(item) || permissions.includes(item))) rbac.fail('Bloqueios de permissão inválidos.', 400);
  const directPermissions = actor.owner ? body.directPermissions ?? [...new Set([...(currentAccess?.directPermissions || []), ...permissions.filter((permission) => !(currentAccess?.permissions || []).includes(permission))])].filter((permission) => permissions.includes(permission)) : [];
  if (!Array.isArray(directPermissions) || directPermissions.some((permission) => !permissions.includes(permission))) rbac.fail('Concessões diretas inválidas.', 400);
  const config = { role, scope, departments, funnels, tags, team, denied, directPermissions, permissions: [...new Set(permissions)], supervisorId: body.supervisorId ?? target.supervisor_id ?? null };
  if (!actor.owner) {
    if (!rbac.can(actor, 'equipe.gerenciar_permissoes') && (target.id || config.permissions.length || scope !== 'own')) rbac.fail();
    if (body.denied !== undefined) rbac.fail('Somente o proprietário pode impor ou retirar bloqueios de delegação.');
    if (!rbac.scopeContained(actor, config)) rbac.fail('O escopo excede os limites concedidos pelo proprietário.');
    const directOwnerGrants = await db.all("SELECT permission, allowed FROM permission_grants WHERE user_id = ? AND grant_kind = 'owner'", [target.id]);
    const denied = new Set(directOwnerGrants.filter((row) => !row.allowed).map((row) => row.permission));
    const independent = new Set(directOwnerGrants.filter((row) => row.allowed).map((row) => row.permission));
    for (const permission of config.permissions) {
      if (denied.has(permission) || (!independent.has(permission) && !rbac.can(actor, permission))) rbac.fail('Você não pode conceder esta permissão.');
    }
    if (config.supervisorId !== target.supervisor_id && config.supervisorId !== actor.user.id) rbac.fail();
  }
  if (config.supervisorId != null) {
    const supervisor = await db.get('SELECT role, status FROM users WHERE id = ? AND account_id = ? AND deleted_at IS NULL', [config.supervisorId, actor.accountId]);
    if (!supervisor || supervisor.role !== rbac.roles.manager || supervisor.status !== 'active') rbac.fail('Supervisor inválido.', 400);
  }
  return config;
}
async function saveConfig(actor, target, config) {
  if (target.role === rbac.roles.owner) return;
  await db.run('UPDATE users SET role = ?, scope = ?, departments = ?, funnels = ?, supervised_users = ?, allowed_tags = ?, supervisor_id = ? WHERE id = ? AND account_id = ?',
    [config.role, config.scope, JSON.stringify(config.departments), JSON.stringify(config.funnels), JSON.stringify(config.team), JSON.stringify(config.tags), config.supervisorId, target.id, actor.accountId]);
  if (actor.owner) {
    await db.run("DELETE FROM permission_grants WHERE user_id = ? AND account_id = ? AND grant_kind = 'owner'", [target.id, actor.accountId]);
    const grants = await db.all("SELECT * FROM permission_grants WHERE user_id = ? AND account_id = ? AND grant_kind = 'manager'", [target.id, actor.accountId]);
    for (const grant of grants) if (!config.permissions.includes(grant.permission)) await db.run('DELETE FROM permission_grants WHERE user_id = ? AND permission = ? AND granted_by = ?', [target.id, grant.permission, grant.granted_by]);
  }
  else await db.run("DELETE FROM permission_grants WHERE user_id = ? AND account_id = ? AND granted_by = ? AND grant_kind = 'manager'", [target.id, actor.accountId, actor.user.id]);
  for (const permission of actor.owner ? [...config.directPermissions, ...config.denied] : config.permissions.filter((item) => rbac.can(actor, item))) {
    await db.run(`INSERT INTO permission_grants(account_id,user_id,permission,granted_by,grant_kind,allowed) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,permission,granted_by) DO UPDATE SET allowed = excluded.allowed, grant_kind = excluded.grant_kind`,
      [actor.accountId, target.id, permission, actor.user.id, actor.owner ? 'owner' : 'manager', config.permissions.includes(permission) ? 1 : 0]);
  }
}
function install(app, { hashPassword, changed }) {
  const handle = (action, permission, fn) => async (req, res) => {
    try {
      const result = await db.transaction(async () => {
        const actor = await rbac.accessFor(req.session.userId);
        if (!actor || (permission === 'owner' ? !actor.owner : !rbac.can(actor, permission))) rbac.fail();
        const result = await fn(req, actor);
        await rbac.audit(actor, action, result.target?.id, result.before, result.after);
        await rbac.bump(actor.accountId);
        return { ...result, accountId: actor.accountId };
      });
      await changed(result.accountId);
      res.status(result.created ? 201 : 200).json({ ok: true, ...result.response });
    } catch (error) {
      const duplicate = error.code === '23505' || error.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed: users\.(username|email)/i.test(error.message);
      if (!error.statusCode && !duplicate) console.error('[TEAM] Falha administrativa:', { action, code: error.code, message: error.message });
      res.status(error.statusCode || (duplicate ? 409 : 500)).json({ error: error.statusCode ? error.message : duplicate ? 'E-mail ou ID já está em uso.' : 'Não foi possível salvar o membro. Ocorreu um erro interno no cadastro.' });
    }
  };
  app.get('/api/team', async (req, res) => {
    const rows = await db.all('SELECT * FROM users WHERE account_id = ? AND deleted_at IS NULL ORDER BY id', [req.access.accountId]);
    const team = [];
    for (const row of rows) if (req.access.owner || row.id === req.access.user.id || rbac.withinMember(req.access, row)) team.push(memberView(row, await rbac.accessFor(row.id, true)));
    res.json({ team });
  });
  app.get('/api/team/:id/permissions', async (req, res) => {
    try { const row = await member(req.access, req.params.id); res.json({ member: memberView(row, await rbac.accessFor(row.id, true)), catalog: rbac.groups }); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
  });
  app.post('/api/team', handle('member.create', 'equipe.criar_atendente', async (req, actor) => {
    const { name, email, password } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || typeof password !== 'string' || password.length < 6 || password.length > 128) rbac.fail('Informe nome, e-mail válido e senha de pelo menos 6 caracteres.', 400);
    let username = String(req.body.username || email.split('@')[0]).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
    if (username.length < 3) rbac.fail('O ID deve ter pelo menos 3 caracteres.', 400);
    if (await db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email.trim().toLowerCase(), username])) rbac.fail('E-mail ou ID já está em uso.', 409);
    const role = req.body.role || rbac.roles.attendant;
    if (role === rbac.roles.owner || (!actor.owner && role !== rbac.roles.attendant)) rbac.fail();
    const target = { account_id: actor.accountId, role, scope: 'own', supervisor_id: actor.owner ? null : actor.user.id };
    const config = await validateConfig(actor, target, { ...req.body, permissions: req.body.permissions ?? (actor.owner && role === rbac.roles.attendant ? rbac.operational : []) }, null);
    const result = await db.run('INSERT INTO users(username,display_name,email,password,account_id,role,scope,supervisor_id) VALUES (?,?,?,?,?,?,?,?)', [username, name.trim(), email.trim().toLowerCase(), hashPassword(password), actor.accountId, role, config.scope, config.supervisorId]);
    target.id = result.lastID;
    await saveConfig(actor, target, config);
    const row = await db.get('SELECT * FROM users WHERE id = ?', [target.id]);
    const view = memberView(row, await rbac.accessFor(row.id, true));
    return { target, created: true, before: {}, after: view, response: { member: view } };
  }));
  app.put('/api/team/:id', handle('member.update', 'equipe.editar_atendente', async (req, actor) => {
    const target = await member(actor, req.params.id), before = memberView(target, await rbac.accessFor(target.id, true));
    const { name, email, password } = req.body;
    if (!name?.trim() || name.length > 60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || (password && (password.length < 6 || password.length > 128))) rbac.fail('Dados de cadastro inválidos.', 400);
    if (!actor.owner && (req.body.role && req.body.role !== target.role)) rbac.fail();
    const securityFields = ['permissions', 'scope', 'departments', 'funnels', 'allowedTags', 'team', 'supervisorId'];
    const modifiesSecurity = securityFields.some((key) => req.body[key] !== undefined) || req.body.role && req.body.role !== target.role;
    if (modifiesSecurity) {
      if (!actor.owner && !rbac.can(actor, 'equipe.gerenciar_permissoes')) rbac.fail();
      await saveConfig(actor, target, await validateConfig(actor, target, req.body, await rbac.accessFor(target.id, true)));
    }
    await db.run('UPDATE users SET display_name = ?, email = ?, password = ?, auth_version = auth_version + ? WHERE id = ?', [name.trim(), email.trim().toLowerCase(), password ? hashPassword(password) : target.password, password ? 1 : 0, target.id]);
    return { target, before, after: memberView(await db.get('SELECT * FROM users WHERE id = ?', [target.id]), await rbac.accessFor(target.id, true)) };
  }));
  app.put('/api/team/:id/permissions', handle('member.permissions', 'equipe.gerenciar_permissoes', async (req, actor) => {
    const target = await member(actor, req.params.id);
    if (target.role === rbac.roles.owner || target.id === actor.user.id) rbac.fail('O proprietário mantém acesso total; não é permitido alterar seus próprios acessos por esta operação.');
    const before = memberView(target, await rbac.accessFor(target.id, true));
    await saveConfig(actor, target, await validateConfig(actor, target, req.body, await rbac.accessFor(target.id, true)));
    const after = memberView(await db.get('SELECT * FROM users WHERE id = ?', [target.id]), await rbac.accessFor(target.id, true));
    return { target, before, after, response: { member: after } };
  }));
  app.put('/api/team/:id/status', handle('member.status', 'equipe.bloquear_atendente', async (req, actor) => {
    const target = await member(actor, req.params.id);
    if (target.role === rbac.roles.owner || target.id === actor.user.id) rbac.fail('O proprietário ativo não pode ser bloqueado.');
    if (!['active', 'blocked'].includes(req.body.status)) rbac.fail('Status inválido.', 400);
    await db.run('UPDATE users SET status = ?, auth_version = auth_version + 1 WHERE id = ?', [req.body.status, target.id]);
    return { target, before: { status: target.status }, after: { status: req.body.status } };
  }));
  app.delete('/api/team/:id', handle('member.remove', 'equipe.remover_atendente', async (req, actor) => {
    const target = await member(actor, req.params.id);
    if (target.role === rbac.roles.owner || target.id === actor.user.id) rbac.fail('Não é possível remover o proprietário ativo ou a própria conta.');
    await db.run("UPDATE users SET status = 'deleted', deleted_at = ?, auth_version = auth_version + 1 WHERE id = ?", [new Date().toISOString(), target.id]);
    return { target, before: memberView(target, await rbac.accessFor(target.id, true)), after: { status: 'deleted' } };
  }));
  app.post('/api/team/:id/transfer-ownership', handle('account.transfer', 'owner', async (req, actor) => {
    const target = await member(actor, req.params.id);
    if (target.id === actor.user.id || target.status !== 'active') rbac.fail('Selecione outro membro ativo.', 400);
    const changed = await db.run('UPDATE accounts SET owner_id = ? WHERE id = ? AND owner_id = ?', [target.id, actor.accountId, actor.user.id]);
    if (!changed.changes) rbac.fail();
    await db.run('UPDATE users SET role = ? WHERE id = ?', [rbac.roles.manager, actor.user.id]);
    await db.run("UPDATE users SET role = ?, scope = 'account', supervisor_id = NULL WHERE id = ?", [rbac.roles.owner, target.id]);
    return { target, before: { ownerId: actor.user.id }, after: { ownerId: target.id } };
  }));
  app.get('/api/audit', async (req, res) => {
    let entries = await db.all('SELECT * FROM audit_log WHERE account_id = ? ORDER BY id DESC LIMIT 500', [req.access.accountId]);
    if (!req.access.owner) {
      const permitted = new Set([req.access.user.id]);
      const members = await db.all('SELECT * FROM users WHERE account_id = ?', [req.access.accountId]);
      for (const row of members) if (rbac.withinMember(req.access, row)) permitted.add(row.id);
    entries = entries.filter((entry) => permitted.has(entry.target_id));
    }
    res.json({ entries: entries.map((entry) => ({ ...entry, before: JSON.parse(entry.before_value), after: JSON.parse(entry.after_value) })) });
  });
}
module.exports = { install, memberView };
