import catalog from '../permissions';
export const pagePermissions = catalog.pagePermissions;
export const can = (access, permission) => !permission || !!access && (access.owner || access.permissions?.includes(permission));
export const resourcePermissions = { contacts: 'contatos.visualizar', tags: 'tags.visualizar', departments: 'departamentos.visualizar', team: 'equipe.visualizar', campaigns: 'campanhas.visualizar', flows: 'fluxos.visualizar', webhooks: 'webhooks.visualizar', chips: 'chips.visualizar', followups: 'fluxos.visualizar', kanban: 'funis.visualizar', reasons: 'funis.visualizar', variables: 'fluxos.visualizar', stats: 'relatorios.visualizar' };
export function actionPermission(props) {
  if (props.permission) return props.permission;
  const ids = { sendBtn: 'atendimento.responder', attachBtn: 'atendimento.responder', voiceRecordBtn: 'atendimento.responder', assumeBtn: 'atendimento.atribuir', assignBtn: 'atendimento.atribuir', transferConversationBtn: 'atendimento.transferir', bulkTransferBtn: 'atendimento.transferir', tagsBtn: 'atendimento.tags', bulkTagsBtn: 'atendimento.tags', blockBtn: 'atendimento.bloquear', finalizeBtn: 'atendimento.finalizar', clearBtn: 'atendimento.limpar', deleteBtn: 'atendimento.excluir', newCampaignBtn: 'campanhas.criar', newFlowBtn: 'fluxos.criar', newWebhookBtn: 'webhooks.gerenciar', newTeamMemberBtn: 'equipe.criar_atendente', exportContactsBtn: 'contatos.exportar', importContactsBtn: 'contatos.criar', importContactsInput: 'contatos.criar', addTagBtn: 'tags.gerenciar', addDeptBtn: 'departamentos.gerenciar', addKanbanColumnBtn: 'funis.criar', addFunnelBtn: 'funis.criar', newChipBtn: 'chips.gerenciar', settingsDisconnect: 'chips.gerenciar', disconnectBtn: 'chips.gerenciar', manageGlobalVarsBtn: 'fluxos.editar', manageLossReasonsBtn: 'funis.editar' };
  if (ids[props.id]) return ids[props.id];
  const kind = props['data-kind'];
  const classMatch = /\b(campaign|flow|webhook|tag|dept)-(edit|delete|duplicate|toggle)\b/.exec(props.className || '');
  if (classMatch) {
    const group = { campaign: 'campanhas', flow: 'fluxos', webhook: 'webhooks', tag: 'tags', dept: 'departamentos' }[classMatch[1]];
    return `${group}.${['webhooks','tags','departamentos'].includes(group) ? 'gerenciar' : classMatch[2] === 'delete' ? 'excluir' : classMatch[2] === 'duplicate' ? 'criar' : 'editar'}`;
  }
  if (props['data-col-id'] != null) return 'funis.criar';
  if (props['data-move-id'] != null || /kanban-(edit|win|lose)/.test(props.className || '')) return 'funis.editar';
  if (/kanban-delete/.test(props.className || '')) return 'funis.excluir';
  if (/followup-delete/.test(props.className || '')) return 'fluxos.excluir';
  if (kind) {
    const group = { campaigns: 'campanhas', flows: 'fluxos', webhooks: 'webhooks', tags: 'tags', departments: 'departamentos' }[kind];
    if (group) return `${group}.${['webhooks','tags','departamentos'].includes(group) ? 'gerenciar' : props['data-action'] === 'delete' ? 'excluir' : props['data-action'] === 'duplicate' ? 'criar' : 'editar'}`;
  }
  return null;
}
