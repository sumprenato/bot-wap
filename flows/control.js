function conversationStopReason(context) {
  const conversation = context?.conversation || {};
  if (context?.blocked || conversation.blocked) return "Conversa bloqueada.";
  if (conversation.flowStopped)
    return "Automação interrompida nesta conversa. Reabra o atendimento para iniciar novamente.";
  if (conversation.assignedUserId)
    return "Atendimento assumido por um atendente.";
  if (conversation.isFinalized) return "Atendimento finalizado.";
  return null;
}
function stopped(reason) {
  return Object.assign(new Error(reason), {
    code: "FLOW_STOPPED",
    deliveryAttempted: false,
  });
}
module.exports = { conversationStopReason, stopped };
