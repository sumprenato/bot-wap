import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Action, ActionMenu, DataTable } from './components';
import catalog from '../permissions';

const names = { atendimento: 'Atendimento', contatos: 'Contatos', funis: 'Funis', campanhas: 'Campanhas', fluxos: 'Fluxos', equipe: 'Minha equipe', chips: 'Meus chips', tags: 'Tags e rótulos', departamentos: 'Departamentos', webhooks: 'Webhooks', configuracoes: 'Configurações', relatorios: 'Relatórios', auditoria: 'Auditoria' };
const actions = { visualizar: 'Visualizar', responder: 'Responder', visualizar_todos: 'Ver atendimentos de outros usuários', transferir: 'Transferir', atribuir: 'Atribuir responsável', finalizar: 'Finalizar e reabrir', tags: 'Aplicar tags', bloquear: 'Bloquear contato', excluir: 'Excluir', limpar: 'Limpar histórico', criar: 'Criar', editar: 'Editar', exportar: 'Exportar', gerenciar: 'Gerenciar', criar_atendente: 'Criar atendentes', editar_atendente: 'Editar atendentes', bloquear_atendente: 'Bloquear atendentes', remover_atendente: 'Remover atendentes', gerenciar_permissoes: 'Gerenciar permissões dos atendentes' };
function Checks({ label, options, values, onChange }) {
  return <fieldset className="access-checks"><legend>{label}</legend>{options.length ? options.map((item) => <label key={item.id}><input type="checkbox" checked={values.map(String).includes(String(item.id))} onChange={() => onChange(values.map(String).includes(String(item.id)) ? values.filter((id) => String(id) !== String(item.id)) : [...values, String(item.id)])} />{item.name}</label>) : <small>Nenhuma opção disponível.</small>}</fieldset>;
}
export function TeamEditor({ ctx }) {
  const member = ctx.editor.item;
  const permissionOnly = ctx.editor.mode === 'permissions';
  const [options, setOptions] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const initial = { name: member?.name || '', email: member?.email || '', role: member?.role || catalog.roles.attendant, password: '',
    permissions: member?.permissions || (ctx.access?.owner ? catalog.operational : []), directPermissions: member?.directPermissions || (ctx.access?.owner ? catalog.operational : []), denied: member?.denied || [], departments: member?.departments || [], funnels: member?.funnels || [], allowedTags: member?.allowedTags || [], team: member?.team || [], scope: member?.scope || 'own', supervisorId: member?.supervisorId || '' };
  const [form, setForm] = useState(initial);
  const [baseline] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(form) !== baseline;
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  useEffect(() => { api('/api/team/options').then(setOptions).catch((error) => setError(error.message)); }, []);
  const owner = ctx.access?.owner, ownMember = member?.isOwner;
  const permitted = catalog.permissions.filter((permission) => owner || ctx.can(permission) && !form.denied.includes(permission));
  const editable = !ownMember && (owner || ctx.can('equipe.gerenciar_permissoes'));
  const close = async () => { if (!dirty || await ctx.confirm({ title: 'Descartar alterações?', body: 'Existem alterações não salvas neste membro.', okText: 'Descartar' })) ctx.closeEditor(); };
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, supervisorId: form.supervisorId || null };
      if (!owner) { delete body.denied; delete body.directPermissions; }
      else body.directPermissions = [...new Set([...form.directPermissions.filter((permission) => form.permissions.includes(permission)), ...form.permissions.filter((permission) => !initial.permissions.includes(permission))])];
      if (member && !editable) for (const key of ['permissions', 'denied', 'scope', 'departments', 'funnels', 'allowedTags', 'team', 'supervisorId', 'role']) delete body[key];
      const url = member ? `/api/team/${member.id}${permissionOnly ? '/permissions' : ''}` : '/api/team';
      await api(url, member ? 'PUT' : 'POST', body);
      ctx.closeEditor(); await ctx.load('team'); ctx.notify('Membro atualizado.', 'success');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <div className="inline-editor" id="teamMemberModal"><div className="editor-panel editor-panel--team" role="region" aria-labelledby="teamMemberModalTitle">
    <header className="editor-header"><div><p className="eyebrow">equipe e acessos</p><h2 id="teamMemberModalTitle">{permissionOnly ? 'Gerenciar permissões' : member ? 'Editar membro' : 'Novo membro'}</h2></div><button type="button" className="editor-close" aria-label="Fechar" onClick={close}>×</button></header>
    <form id="teamMemberForm" className="profile-form team-form" onSubmit={save}>
      {!permissionOnly && <><div className="profile-field"><label htmlFor="teamMemberName">Nome</label><input id="teamMemberName" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} required /></div>
      <div className="profile-field"><label htmlFor="teamMemberEmail">E-mail</label><input id="teamMemberEmail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={120} required /></div>
      <div className="profile-field"><label htmlFor="teamMemberPassword">{member ? 'Nova senha (opcional)' : 'Senha'}</label><input id="teamMemberPassword" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} minLength={6} maxLength={128} required={!member} /></div></>}
      <div className="profile-field"><label htmlFor="teamMemberRole">Cargo</label><select id="teamMemberRole" value={form.role} disabled={!!member && !owner || ownMember} onChange={(e) => { set('role', e.target.value); if (!member) set('permissions', e.target.value === catalog.roles.manager ? [] : owner ? catalog.operational : []); }}>{ownMember ? <option>{catalog.roles.owner}</option> : <><option>{catalog.roles.attendant}</option>{owner && <option>{catalog.roles.manager}</option>}</>}</select></div>
      {editable && <><div className="profile-field"><label htmlFor="memberScope">Escopo de visualização</label><select id="memberScope" value={form.scope} onChange={(e) => set('scope', e.target.value)}><option value="own">Somente próprios</option>{(owner || ['account','department'].includes(ctx.access.scope)) && <option value="department">Departamentos autorizados</option>}{(owner || ['account','team'].includes(ctx.access.scope)) && <option value="team">Equipe supervisionada</option>}{(owner || ctx.access.scope === 'account') && <option value="account">Toda a conta, dentro dos departamentos autorizados</option>}</select></div>
      <Checks label="Departamentos autorizados" options={options?.departments || []} values={form.departments} onChange={(value) => set('departments', value)} />
      <Checks label="Funis autorizados" options={options?.columns || []} values={form.funnels} onChange={(value) => set('funnels', value)} />
      <Checks label="Tags permitidas" options={options?.tags || []} values={form.allowedTags} onChange={(value) => set('allowedTags', value)} />
      {owner && <div className="profile-field"><label htmlFor="memberSupervisor">Gerente responsável</label><select id="memberSupervisor" value={form.supervisorId} onChange={(e) => set('supervisorId', e.target.value)}><option value="">Sem supervisor</option>{(options?.members || []).filter((item) => item.role === catalog.roles.manager && item.id !== member?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
      {form.scope === 'team' && <Checks label="Equipe supervisionada" options={(options?.members || []).filter((item) => item.id !== member?.id)} values={form.team} onChange={(value) => set('team', value)} />}
      <div className="team-permission-tools"><button type="button" className="text-action" onClick={() => set('permissions', [...new Set([...form.permissions, ...permitted])])}>Selecionar todas as permitidas</button><button type="button" className="text-action" onClick={() => set('permissions', [])}>Limpar permissões</button></div>
      {Object.entries(catalog.groups).map(([group, entries]) => <fieldset className="access-checks" key={group}><legend>{names[group]}</legend>{entries.map((action) => {
        const permission = `${group}.${action}`, denied = form.denied.includes(permission), allowed = permitted.includes(permission);
        return <div className="permission-row" key={permission}><label><input type="checkbox" data-permission={permission} checked={form.permissions.includes(permission)} disabled={!owner && !allowed} onChange={() => { set('permissions', form.permissions.includes(permission) ? form.permissions.filter((item) => item !== permission) : [...form.permissions, permission]); if (denied) set('denied', form.denied.filter((item) => item !== permission)); }} />{actions[action] || action}</label>{owner && form.permissions.includes(permission) && <label className="delegation-block"><input type="checkbox" data-direct-permission={permission} checked={form.directPermissions.includes(permission) || !initial.permissions.includes(permission)} onChange={() => set('directPermissions', form.directPermissions.includes(permission) ? form.directPermissions.filter((item) => item !== permission) : [...form.directPermissions, permission])} />Concessão direta do proprietário</label>}{owner && <label className="delegation-block"><input type="checkbox" checked={denied} onChange={() => { set('denied', denied ? form.denied.filter((item) => item !== permission) : [...form.denied, permission]); if (!denied) set('permissions', form.permissions.filter((item) => item !== permission)); }} />Bloquear delegação</label>}</div>;
      })}</fieldset>)}<small>Gerentes começam sem acesso administrativo. “Visualizar todos” também exige um escopo e departamentos autorizados. Bloqueios do proprietário impedem delegação.</small></>}
      <p className="profile-error" role="alert" hidden={!error}>{error}</p><p className="field-hint" aria-live="polite">{dirty ? 'Alterações não salvas' : 'Sem alterações pendentes'}</p>
      <div className="confirm-actions"><button type="button" className="confirm-cancel" onClick={close}>Cancelar</button><button type="submit" className="profile-save" id="teamMemberSave" disabled={busy || !options}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>
    </form></div></div>;
}
function MemberActions({ ctx, member, children }) {
  const eligible = ctx.access.owner || member.role === catalog.roles.attendant && member.id !== ctx.access.userId;
  const other = !member.isOwner && member.id !== ctx.access.userId;
  const available = eligible && (ctx.can('equipe.editar_atendente') || other && ['equipe.gerenciar_permissoes', 'equipe.bloquear_atendente', 'equipe.remover_atendente'].some((permission) => ctx.can(permission)) || ctx.access.owner && !member.isOwner && member.status === 'active');
  if (!available) return null;
  return <ActionMenu label={`Ações de ${member.name}`}>{children}</ActionMenu>;
}
export function TeamList({ ctx }) {
  const [role, setRole] = useState(''), [department, setDepartment] = useState(''), [status, setStatus] = useState(''), [audit, setAudit] = useState(null);
  const rows = ctx.data.team.filter((member) => (!role || member.role === role) && (!status || member.status === status) && (!department || member.departments.map(String).includes(department)));
  const manage = (member, mode) => { ctx.openEditor('teamMemberModal', {}, member); if (mode) ctx.setEditorMode(mode); };
  return <><div className="team-filters"><label>Cargo<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">Todos</option>{Object.values(catalog.roles).map((role) => <option key={role}>{role}</option>)}</select></label><label>Departamento<select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">Todos</option>{ctx.data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="active">Ativo</option><option value="blocked">Bloqueado</option></select></label></div>
    <DataTable kind="Minha equipe" rows={rows} headings={['Nome', 'E-mail', 'Cargo', 'Departamentos', 'Status', 'Acessos', 'Ações']} empty="Nenhum membro encontrado." row={(member) => <tr key={member.id}><td><strong>{member.name}</strong><small className="member-login">ID: {member.username}</small></td><td>{member.email || '—'}</td><td><span className="role-badge">{member.role}</span></td><td>{member.departments.map((id) => ctx.data.departments.find((item) => String(item.id) === String(id))?.name || id).join(', ') || '—'}</td><td>{member.status === 'active' ? 'Ativo' : 'Bloqueado'}</td><td>{member.isOwner ? 'Acesso total' : `${member.permissions.length} permissões`}</td><td><MemberActions ctx={ctx} member={member}>
      {(ctx.access.owner || member.role === catalog.roles.attendant) && <><Action className="table-action" permission="equipe.editar_atendente" action={() => manage(member)}>Editar</Action>
      {!member.isOwner && member.id !== ctx.access.userId && <><Action className="table-action" permission="equipe.gerenciar_permissoes" action={() => manage(member, 'permissions')}>Gerenciar permissões</Action><Action className="table-action" permission="equipe.bloquear_atendente" action={async () => { await api(`/api/team/${member.id}/status`, 'PUT', { status: member.status === 'active' ? 'blocked' : 'active' }); await ctx.load('team'); }}>{member.status === 'active' ? 'Bloquear' : 'Ativar'}</Action><Action className="table-action table-action--danger" permission="equipe.remover_atendente" action={async () => { if (await ctx.confirm({ title: 'Remover membro', body: `Remover o acesso de ${member.name}? O histórico será preservado.`, okText: 'Remover' })) { await api(`/api/team/${member.id}`, 'DELETE'); await ctx.load('team'); } }}>Remover</Action></>}
      {ctx.access.owner && !member.isOwner && member.status === 'active' && <Action className="table-action" action={async () => { if (await ctx.confirm({ title: 'Transferir propriedade', body: `${member.name} terá acesso total à conta. Você passará a gerente e precisará receber permissões do novo proprietário.`, okText: 'Transferir' })) { await api(`/api/team/${member.id}/transfer-ownership`, 'POST'); location.reload(); } }}>Transferir propriedade</Action>}</>}
    </MemberActions></td></tr>} />
    {ctx.can('auditoria.visualizar') && <><Action className="text-action" action={async () => setAudit(audit ? null : (await api('/api/audit')).entries)}>{audit ? 'Fechar histórico de atividades' : 'Histórico de atividades'}</Action>{audit && <div className="audit-list"><h3>Histórico de atividades</h3>{audit.length ? audit.map((entry) => <details key={entry.id}><summary>{new Date(entry.created_at).toLocaleString('pt-BR')} · Usuário {entry.actor_id} · {entry.action}</summary><pre>{JSON.stringify({ usuarioAfetado: entry.target_id, antes: entry.before, depois: entry.after }, null, 2)}</pre></details>) : <p>Nenhuma atividade registrada.</p>}</div>}</>}
  </>;
}
