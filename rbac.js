const db = require('./db');
const catalog = require('./permissions');
const { withAccount } = require('./account-context');
const parse = (value) => { try { const result = JSON.parse(value || '[]'); return Array.isArray(result) ? result : []; } catch { return []; } };
const fail = (message = 'Você não tem autorização para esta ação.', statusCode = 403) => { throw Object.assign(new Error(message), { statusCode }); };
const ids = (values) => [...new Set((values || []).map(String))];

async function userById(id, includeBlocked = false) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user || user.deleted_at || (user.status !== 'active' && !includeBlocked)) return null;
  // Direct inserts used by legacy integrations represent independent accounts.
  if (!user.account_id) {
    if (user.email) return null;
    await db.run('INSERT INTO accounts(id, owner_id) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [user.id, user.id]);
    await db.run("UPDATE users SET account_id = ?, role = ?, scope = 'account' WHERE id = ? AND account_id IS NULL", [user.id, catalog.roles.owner, user.id]);
    user.account_id = user.id; user.role = catalog.roles.owner; user.scope = 'account';
  }
  return user;
}
async function accessFor(id, includeBlocked = false) {
  const user = await userById(id, includeBlocked);
  if (!user) return null;
  const account = await db.get('SELECT * FROM accounts WHERE id = ?', [user.account_id]);
  if (!account) return null;
  const owner = account.owner_id === user.id;
  const access = { user, accountId: account.id, owner, role: owner ? catalog.roles.owner : user.role, scope: owner ? 'account' : user.scope,
    departments: ids(parse(user.departments)), funnels: ids(parse(user.funnels)), team: ids(parse(user.supervised_users)), tags: ids(parse(user.allowed_tags)), permissions: [], denied: [], version: account.authorization_version };
  if (owner) { access.permissions = catalog.permissions; return access; }
  const grants = await db.all('SELECT * FROM permission_grants WHERE user_id = ? AND account_id = ?', [id, account.id]);
  access.denied = grants.filter((row) => row.grant_kind === 'owner' && !row.allowed).map((row) => row.permission);
  const effective = new Set(grants.filter((row) => row.grant_kind === 'owner' && row.allowed).map((row) => row.permission));
  access.directPermissions = [...effective];
  if (user.role === catalog.roles.attendant) {
    const managers = new Map();
    for (const grant of grants.filter((row) => row.grant_kind === 'manager' && row.allowed)) {
      if (!managers.has(grant.granted_by)) managers.set(grant.granted_by, await accessFor(grant.granted_by));
      const manager = managers.get(grant.granted_by);
      if (manager && manager.accountId === account.id && manager.role === catalog.roles.manager && can(manager, 'equipe.gerenciar_permissoes') && can(manager, grant.permission) && withinMember(manager, user) && scopeContained(manager, access)) effective.add(grant.permission);
    }
  }
  access.permissions = [...effective].filter((permission) => catalog.permissions.includes(permission) && !access.denied.includes(permission));
  return access;
}
const can = (access, permission) => !!access && (access.owner || access.permissions.includes(permission));
const departmentAllowed = (access, departmentId) => access.owner || (departmentId != null && access.departments.includes(String(departmentId)));
function withinMember(access, member) {
  if (!access || member.account_id !== access.accountId) return false;
  if (access.owner) return true;
  if (member.role !== catalog.roles.attendant || member.id === access.user.id) return false;
  const departments = ids(parse(member.departments));
  return departments.every((id) => access.departments.includes(id)) && (member.supervisor_id === access.user.id || access.team.includes(String(member.id)) || access.scope === 'account' || access.scope === 'department');
}
function scopeContained(manager, member) {
  if (manager.owner) return true;
  if (!member.departments.every((id) => manager.departments.includes(id)) || !member.funnels.every((id) => manager.funnels.includes(id)) || !member.tags.every((id) => manager.tags.includes(id))) return false;
  if (member.scope === 'account' && manager.scope !== 'account') return false;
  if (member.scope === 'team' && !['account', 'team'].includes(manager.scope)) return false;
  if (member.scope === 'department' && !['account', 'department'].includes(manager.scope)) return false;
  return member.team.every((id) => manager.team.includes(id));
}
function conversationAllowed(access, conversation, chip) {
  if (!conversation) return false;
  if (access.owner) return true;
  const department = conversation.departmentId || chip?.department_id;
  if (!departmentAllowed(access, department)) return false;
  if (access.scope === 'own') return Number(conversation.assignedUserId) === access.user.id;
  if (access.scope === 'team') return Number(conversation.assignedUserId) === access.user.id || access.team.includes(String(conversation.assignedUserId));
  return ['department', 'account'].includes(access.scope) && can(access, 'atendimento.visualizar_todos');
}
function recordAllowed(access, row, type) {
  if (!row || Number(row.account_id) !== access.accountId) return false;
  if (access.owner) return true;
  if (type === 'departments') return departmentAllowed(access, row.id);
  if (type === 'kanban_columns') return access.funnels.includes(String(row.id));
  if (type === 'tags') return access.tags.includes(String(row.id));
  if (row.column_id != null && !access.funnels.includes(String(row.column_id))) return false;
  if (row.department_id != null && !departmentAllowed(access, row.department_id)) return false;
  const assigned = row.assigned_user_id || row.created_by;
  if (access.scope === 'own') return Number(assigned) === access.user.id;
  if (access.scope === 'team') return Number(assigned) === access.user.id || access.team.includes(String(assigned));
  if (access.scope === 'department') return departmentAllowed(access, row.department_id);
  return access.scope === 'account';
}
function publicAccess(access) {
  return { accountId: access.accountId, userId: access.user.id, owner: access.owner, role: access.role, permissions: access.permissions, denied: access.denied, scope: access.scope, departments: access.departments, funnels: access.funnels, team: access.team, tags: access.tags, version: access.version };
}
async function audit(access, action, target, before = {}, after = {}) {
  await db.run('INSERT INTO audit_log(account_id, actor_id, target_id, action, before_value, after_value, created_at) VALUES (?,?,?,?,?,?,?)', [access.accountId, access.user.id, target || null, action, JSON.stringify(before), JSON.stringify(after), new Date().toISOString()]);
}
async function bump(accountId) { await db.run('UPDATE accounts SET authorization_version = authorization_version + 1 WHERE id = ?', [accountId]); }

// Explicit policy for every protected API, including requests made outside the UI.
function routePermission(method, path) {
  if (['/logout', '/session', '/authorization', '/profile'].includes(path)) return null;
  if (path === '/state') return 'state';
  if (path === '/whatsapp/sync-contacts') return 'contacts-sync';
  if (path.startsWith('/team')) {
    if (path.endsWith('/transfer-ownership')) return 'owner';
    if (path.endsWith('/permissions')) return method === 'GET' ? 'equipe.visualizar' : 'equipe.gerenciar_permissoes';
    if (path.endsWith('/status')) return 'equipe.bloquear_atendente';
    return method === 'GET' ? 'equipe.visualizar' : method === 'POST' ? 'equipe.criar_atendente' : method === 'PUT' ? 'equipe.editar_atendente' : 'equipe.remover_atendente';
  }
  if (path === '/audit') return 'auditoria.visualizar';
  if (path === '/account-settings') return method === 'GET' ? 'configuracoes.visualizar' : 'configuracoes.editar';
  if (path.startsWith('/chips') || path === '/disconnect') return method === 'GET' ? 'chips.visualizar' : 'chips.gerenciar';
  if (path.startsWith('/reply')) return 'atendimento.responder';
  if (path === '/assumir' || path.endsWith('/assign')) return 'atendimento.atribuir';
  if (path === '/assignees') return 'atendimento.atribuir';
  if (path.startsWith('/conversation')) {
    if (/\/messages\/forward$/.test(path)) return 'atendimento.responder';
    if (/\/messages\/delete$/.test(path)) return 'atendimento.excluir';
    if (method === 'GET') return 'atendimento.visualizar';
    if (path.endsWith('/bulk-department')) return 'atendimento.transferir';
    if (path.endsWith('/block')) return 'atendimento.bloquear';
    if (path.endsWith('/clear')) return 'atendimento.limpar';
    if (path.endsWith('/delete')) return 'atendimento.excluir';
    if (path.endsWith('/tags') || path.endsWith('/bulk-tags')) return 'atendimento.tags';
    if (path.endsWith('/finalize') || path.endsWith('/reopen')) return 'atendimento.finalizar';
  }
  if (path.startsWith('/whatsapp/profile')) return 'profile-photo';
  if (path.startsWith('/contacts')) return path.endsWith('/export') ? 'contatos.exportar' : method === 'GET' ? 'contatos.visualizar' : method === 'DELETE' ? 'contatos.excluir' : path === '/contacts/import' ? 'contatos.criar' : 'contatos.editar';
  if (path.startsWith('/dashboard')) return path.endsWith('/export') ? 'relatorios.exportar' : 'relatorios.visualizar';
  if (path.startsWith('/tags')) return method === 'GET' ? 'tags.visualizar' : 'tags.gerenciar';
  if (path.startsWith('/departments')) return method === 'GET' ? 'departamentos.visualizar' : 'departamentos.gerenciar';
  if (path.startsWith('/webhooks')) return method === 'GET' ? 'webhooks.visualizar' : 'webhooks.gerenciar';
  if (path.startsWith('/kanban') || path.startsWith('/loss-reasons')) return method === 'GET' ? 'funis.visualizar' : method === 'DELETE' ? 'funis.excluir' : method === 'POST' && !/\/(win|lose)$/.test(path) ? 'funis.criar' : 'funis.editar';
  for (const [url, group] of [['/campaigns', 'campanhas'], ['/flows', 'fluxos'], ['/global-variables', 'fluxos'], ['/followups', 'fluxos']]) {
    if (path.startsWith(url)) return `${group}.${method === 'GET' ? 'visualizar' : method === 'DELETE' ? 'excluir' : method === 'POST' ? 'criar' : 'editar'}`;
  }
  return 'deny';
}
module.exports = { ...catalog, parse, ids, fail, accessFor, can, departmentAllowed, withinMember, scopeContained, conversationAllowed, recordAllowed, publicAccess, audit, bump, routePermission, withAccount };
