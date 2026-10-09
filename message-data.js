function serializeMessage(message) {
  return message ? JSON.stringify(message, (_, value) => value instanceof Uint8Array ? { type: 'Buffer', data: [...value] } : value) : '';
}
function parseMessage(value) {
  if (!value) return null;
  return JSON.parse(value, (_, entry) => entry?.type === 'Buffer' && Array.isArray(entry.data) ? Buffer.from(entry.data) : entry);
}
function messageIds(values) {
  if (!Array.isArray(values) || !values.length || values.length > 30 || values.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw Object.assign(new Error('Selecione de 1 a 30 mensagens válidas.'), { statusCode: 400 });
  }
  return [...new Set(values.map(Number))];
}
module.exports = { serializeMessage, parseMessage, messageIds };
