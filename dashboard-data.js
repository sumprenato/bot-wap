const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });

function dashboardPeriod(query = {}, now = new Date()) {
  const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  let startDate, endDate;
  if (query.startDate !== undefined || query.endDate !== undefined) {
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(query.startDate) || !valid(query.endDate)) invalid('Informe as datas inicial e final válidas.');
    ({ startDate, endDate } = query);
    if (startDate > endDate) invalid('A data inicial deve ser anterior ou igual à data final.');
  } else {
    const days = Number(query.days || 7);
    if (![7, 14, 30].includes(days)) invalid('Escolha um período de 7, 14 ou 30 dias.');
    endDate = dayFormat.format(now);
    const start = new Date(`${endDate}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    startDate = start.toISOString().slice(0, 10);
  }
  const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
  if (days > 3660) invalid('Selecione um período de até 3.660 dias.');
  return { days, startDate, endDate };
}

function dashboardActivity(conversations, days = 7, now = new Date()) {
  const period = typeof days === 'object' ? days : dashboardPeriod({ days }, now);
  days = period.days;
  const today = dayFormat.format(now);
  const anchor = new Date(`${period.endDate || today}T12:00:00Z`);
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
  return { ...period, timeZone: 'America/Sao_Paulo', daily, hourly, ...status,
    received: daily.reduce((sum, row) => sum + row.received, 0), sent: daily.reduce((sum, row) => sum + row.sent, 0) };
}
module.exports = { dashboardActivity, dashboardPeriod };
