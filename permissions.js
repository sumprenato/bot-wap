// Shared catalog: the server is authoritative; the browser uses it for controls.
const groups = {
  atendimento: ['visualizar', 'responder', 'transferir', 'atribuir', 'visualizar_todos', 'finalizar', 'tags', 'bloquear', 'excluir', 'limpar'],
  contatos: ['visualizar', 'criar', 'editar', 'excluir', 'exportar'],
  funis: ['visualizar', 'criar', 'editar', 'excluir'],
  campanhas: ['visualizar', 'criar', 'editar', 'excluir'],
  fluxos: ['visualizar', 'criar', 'editar', 'excluir'],
  equipe: ['visualizar', 'criar_atendente', 'editar_atendente', 'bloquear_atendente', 'remover_atendente', 'gerenciar_permissoes'],
  chips: ['visualizar', 'gerenciar'], tags: ['visualizar', 'gerenciar'],
  departamentos: ['visualizar', 'gerenciar'], webhooks: ['visualizar', 'gerenciar'],
  configuracoes: ['visualizar', 'editar'], relatorios: ['visualizar', 'exportar'], auditoria: ['visualizar'],
};
const permissions = Object.entries(groups).flatMap(([group, actions]) => actions.map((action) => `${group}.${action}`));
const pagePermissions = { inbox: 'atendimento.visualizar', overview: 'relatorios.visualizar', kanban: 'funis.visualizar', campaigns: 'campanhas.visualizar', flows: 'fluxos.visualizar', contacts: 'contatos.visualizar', team: 'equipe.visualizar', chips: 'chips.visualizar', tags: 'tags.visualizar', departments: 'departamentos.visualizar', webhooks: 'webhooks.visualizar', settings: null };
const roles = { owner: 'Proprietário da conta', manager: 'Gerente', attendant: 'Atendente' };
const operational = ['atendimento.visualizar', 'atendimento.responder', 'atendimento.finalizar', 'atendimento.tags', 'contatos.visualizar', 'tags.visualizar'];
module.exports = { groups, permissions, pagePermissions, roles, operational };
