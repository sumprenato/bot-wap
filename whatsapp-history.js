const HISTORY_DAYS = 7;
const HISTORY_WINDOW_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;

function messageTime(message) {
  const seconds = Number(message?.messageTimestamp);
  const milliseconds = seconds * 1000;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 8640000000000000 ? milliseconds : null;
}

function recentMessages(messages = [], anchor = Date.now(), until = anchor) {
  return messages.filter(message => {
    const time = messageTime(message);
    return message?.key?.id && /@(s\.whatsapp\.net|lid)$/.test(message.key.remoteJid || '')
      && message.message && time !== null && time >= anchor - HISTORY_WINDOW_MS && time <= until;
  }).sort((a, b) => messageTime(a) - messageTime(b));
}

module.exports = { HISTORY_DAYS, HISTORY_WINDOW_MS, messageTime, recentMessages };
