function mergeConversation(previous, incoming) {
  if (!incoming?.partialMessages) return incoming;
  const updates = new Map((incoming.messages || []).map(message => [message.id, message]));
  const messages = (previous?.messages || []).map(message => {
    const updated = updates.get(message.id);
    updates.delete(message.id);
    return updated || message;
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
module.exports = { mergeConversation, mergeConversationMap };
