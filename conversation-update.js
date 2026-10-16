function mergeMessage(previous, incoming) {
  if (!previous || previous.deliveryStatus == null) return incoming;
  const status = previous.deliveryStatus;
  // Receipts can arrive before an older HTTP snapshot or send response.
  const next = incoming.deliveryStatus;
  if (next == null || (status === 0 && next === 1) || (next < status && !(next === 0 && status < 2))) {
    return { ...incoming, deliveryStatus: status };
  }
  return incoming;
}
function mergeConversation(previous, incoming) {
  if (!incoming?.partialMessages) {
    if (!previous?.messages || !incoming?.messages) return incoming;
    const existing = new Map(previous.messages.map(message => [message.id, message]));
    return { ...incoming, messages: incoming.messages.map(message => mergeMessage(existing.get(message.id), message)) };
  }
  const updates = new Map((incoming.messages || []).map(message => [message.id, message]));
  const messages = (previous?.messages || []).map(message => {
    const updated = updates.get(message.id);
    updates.delete(message.id);
    return updated ? mergeMessage(message, updated) : message;
  });
  if (updates.size) {
    messages.push(...updates.values());
    messages.sort((a, b) => String(a.at).localeCompare(String(b.at)) || Number(a.id) - Number(b.id));
  }
  return { ...previous, ...incoming, partialMessages: false, messages };
}
function mergeConversationMap(conversations, incoming) {
  const next = { ...conversations };
  let previous = next[incoming.number];
  for (const alias of incoming.aliases || []) {
    if (alias === incoming.number || !next[alias]) continue;
    previous = mergeConversation(next[alias], { ...previous, number: incoming.number, partialMessages: true, messages: previous?.messages || [] });
    delete next[alias];
  }
  next[incoming.number] = mergeConversation(previous, incoming);
  return next;
}
function mergeState(previous, incoming) {
  if (String(previous?.chipId || '') !== String(incoming?.chipId || '')) return incoming;
  const conversations = {};
  for (const [number, conversation] of Object.entries(incoming.conversations || {})) {
    conversations[number] = mergeConversation(previous?.conversations?.[number], conversation);
  }
  return { ...incoming, conversations };
}
module.exports = { mergeConversation, mergeConversationMap, mergeState };
