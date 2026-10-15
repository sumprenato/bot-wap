const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });

function dashboardActivity(conversations, days = 7, now = new Date()) {
  const today = dayFormat.format(now);
  const anchor = new Date(`${today}T12:00:00Z`);
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - days + index + 1);
    return { date: date.toISOString().slice(0, 10), received: 0, sent: 0 };
  });
  const byDate = new Map(daily.map(row => [row.date, row]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, received: 0, sent: 0 }));
  const status = { open: 0, finalized: 0, blocked: 0, awaitingReply: 0 };
  for (const conversation of conversations) {
    if (conversation.blocked) status.blocked++;
    else if (conversation.isFinalized) status.finalized++;
    else {
      status.open++;
      if (conversation.messages?.at(-1)?.from === 'client') status.awaitingReply++;
    }
    for (const message of conversation.messages || []) {
      if (!message.at) continue;
      const date = new Date(message.at);
      if (!Number.isFinite(date.getTime()) || date > now) continue;
      const row = byDate.get(dayFormat.format(date));
      if (!row) continue;
      const direction = message.from === 'admin' ? 'sent' : 'received';
      row[direction]++;
      hourly[Number(hourFormat.format(date))][direction]++;
    }
  }
  return { days, timeZone: 'America/Sao_Paulo', daily, hourly, ...status,
    received: daily.reduce((sum, row) => sum + row.received, 0), sent: daily.reduce((sum, row) => sum + row.sent, 0) };
}
module.exports = { dashboardActivity };
