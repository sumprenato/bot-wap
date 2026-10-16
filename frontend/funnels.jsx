import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Action, ActionMenu } from './components';
import { Icon } from './icons';
import { Modal as CenteredModal } from './modal';
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });

export function selectedFunnel(ctx) {
  const funnels = ctx.data.kanban.funnels || [];
  return funnels.find(item => String(item.id) === String(ctx.fields.kanbanFunnelId)) || funnels[0];
}
export function funnelColumns(ctx) {
  const funnel = selectedFunnel(ctx);
  return ctx.data.kanban.columns.filter(column => !funnel || String(column.funnel_id) === String(funnel.id));
}
export function filteredOpportunities(ctx, includeStatus = true) {
  const columns = new Set(funnelColumns(ctx).map(column => String(column.id)));
  const f = ctx.fields;
  const search = String(f.kanbanSearch || '').toLocaleLowerCase('pt-BR');
  return ctx.data.kanban.opportunities.filter(item => {
    const updated = new Date(item.updated_at);
    const day = item.updated_at && Number.isFinite(updated.getTime()) ? dayFormat.format(updated) : '';
    return columns.has(String(item.column_id)) && (!includeStatus || f.funnelStatus === 'all' || item.status === (f.funnelStatus || 'open'))
      && `${item.title} ${item.contact_name || ''}`.toLocaleLowerCase('pt-BR').includes(search)
      && (!f.funnelContact || String(item.contact_number) === f.funnelContact)
      && (!f.funnelResponsible || String(item.assigned_user_id || item.created_by || '') === f.funnelResponsible)
      && (!f.funnelFrom || day && day >= f.funnelFrom) && (!f.funnelUntil || day && day <= f.funnelUntil);
  });
}
export function createFunnel(ctx) {
  ctx.resource({ title: 'Novo funil', fields: [{ name: 'name', label: 'Nome do funil', required: true, maxLength: 60 }], save: async values => {
    const result = await api('/api/kanban/funnels', 'POST', values);
    ctx.setField('kanbanFunnelId', String(result.funnel.id));
    await ctx.load('kanban');
  } });
}
function Modal({ title, description, close, children }) {
  return <CenteredModal className="funnel-dialog" label={title} onClose={close}>
    <header><div><h2>{title}</h2><p>{description}</p></div></header>{children}
  </CenteredModal>;
}

const emptyFilters = { kanbanSearch: '', funnelContact: '', funnelResponsible: '', funnelFrom: '', funnelUntil: '' };
function Filters({ ctx, close }) {
  const [values, setValues] = useState(Object.fromEntries(Object.keys(emptyFilters).map(key => [key, ctx.fields[key] || ''])));
  const [error, setError] = useState('');
  const set = key => event => { setValues(old => ({ ...old, [key]: event.target.value })); setError(''); };
  const contacts = new Map(ctx.data.kanban.opportunities.filter(item => item.contact_number).map(item => [item.contact_number, item.contact_name || item.contact_number]));
  return <Modal title="Filtros" description="Filtre as oportunidades do funil" close={close}><form onSubmit={event => {
    event.preventDefault();
    if (values.funnelFrom && values.funnelUntil && values.funnelFrom > values.funnelUntil) { setError('A data inicial deve ser anterior ou igual à data final.'); return; }
    ctx.setFields(old => ({ ...old, ...values })); close();
  }}>
    <label>Busca por título ou contato<input type="search" value={values.kanbanSearch} onChange={set('kanbanSearch')} placeholder="Título da oportunidade ou contato" /></label>
    <label>Contato vinculado<select aria-label="Contato vinculado" value={values.funnelContact} onChange={set('funnelContact')}><option value="">Todos os contatos</option>{[...contacts].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>Responsáveis<select aria-label="Responsáveis" value={values.funnelResponsible} onChange={set('funnelResponsible')}><option value="">Todos os responsáveis</option>{(ctx.data.kanban.responsibles || []).map(user => <option key={user.id} value={user.id}>{user.display_name || user.username}</option>)}</select></label>
    <fieldset><legend>Período de atualização · horário de Brasília</legend><div className="funnel-date-range"><label>De<input type="date" value={values.funnelFrom} onChange={set('funnelFrom')} /></label><label>Até<input type="date" value={values.funnelUntil} onChange={set('funnelUntil')} /></label></div></fieldset>
    {error && <p role="alert" className="error-msg">{error}</p>}
    <footer><button className="text-action" type="button" onClick={() => { ctx.setFields(old => ({ ...old, ...emptyFilters })); close(); }}>Limpar filtros</button><button type="submit" className="text-action text-action--primary">Aplicar filtros</button></footer>
  </form></Modal>;
}
function History({ ctx, funnel, close }) {
  const [entries, setEntries] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; api(`/api/kanban/funnels/${funnel.id}/history`).then(result => { if (active) setEntries(result.entries); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [funnel.id]);
  return <Modal title="Histórico do funil" description={funnel.name} close={close}>{error ? <p role="alert">{error}</p> : !entries ? <p role="status">Carregando histórico…</p> : entries.length ? <ol className="funnel-history">{entries.map(entry => <li key={entry.id}><p>{entry.description}</p><small>{new Date(entry.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {entry.actor_name || 'Usuário'}</small></li>)}</ol> : <p>As próximas alterações deste funil aparecerão aqui.</p>}</Modal>;
}
export function FunnelToolbar({ ctx }) {
  const [modal, setModal] = useState('');
  const funnel = selectedFunnel(ctx);
  const filterCount = Object.keys(emptyFilters).filter(key => ctx.fields[key]).length;
  useEffect(() => { setModal(''); }, [funnel?.id]);
  return <><div className="funnel-toolbar"><label className="funnel-selector">Funil<select aria-label="Selecionar funil" value={funnel?.id || ''} onChange={event => ctx.setField('kanbanFunnelId', event.target.value)}>{!funnel && <option value="">Nenhum funil criado</option>}{(ctx.data.kanban.funnels || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <button className="text-action text-action--primary" type="button" onClick={() => setModal('filters')}>Filtros{filterCount > 0 ? ` (${filterCount})` : ''}</button>
    {funnel && <ActionMenu label="Configurações do funil" icon={<span aria-hidden="true">⚙</span>}>
      <Action permission="funis.visualizar" action={() => setModal('history')}><Icon name="clock" size={16}/>Ver histórico</Action>
      <Action permission="funis.editar" disabled={funnel.canManage === false} action={() => ctx.resource({ title: 'Editar nome do funil', fields: [{ name: 'name', label: 'Nome do funil', value: funnel.name, required: true, maxLength: 60 }], save: async values => { await api(`/api/kanban/funnels/${funnel.id}`, 'PUT', values); await ctx.load('kanban'); } })}><Icon name="pencil" size={16}/>Editar nome do funil</Action>
      <Action permission="funis.excluir" disabled={funnel.canManage === false} action={async () => {
        if (!await ctx.confirm({ title: 'Apagar funil?', body: `O funil "${funnel.name}", suas etapas e oportunidades serão apagados.`, okText: 'Apagar funil' })) return;
        await api(`/api/kanban/funnels/${funnel.id}`, 'DELETE'); await ctx.load('kanban');
      }}><Icon name="trash" size={16}/>Apagar funil</Action>
    </ActionMenu>}
  </div>{modal === 'filters' && <Filters ctx={ctx} close={() => setModal('')} />}{modal === 'history' && funnel && <History ctx={ctx} funnel={funnel} close={() => setModal('')} />}</>;
}
