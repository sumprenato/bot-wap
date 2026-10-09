const pino = require('pino');

// Baileys logs decoding errors at info level and then resolves resyncAppState.
// Capture only the agenda failure; never print keys, messages or raw log objects.
function createContactSyncLog(chipId, report = line => console.warn(line)) {
  let failure = '';
  const logger = pino({ level: 'info' }, {
    write(line) {
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      if (entry.name !== 'critical_unblock_low' || !/failed to sync/i.test(entry.msg || '')) return;
      const error = String(entry.error?.message || entry.error || '').split('\n')[0];
      if (/failed to find key/i.test(error)) failure = 'O WhatsApp ainda não enviou todas as chaves da agenda.';
      else if (/LTHash|MAC|HMAC/i.test(error)) failure = 'O WhatsApp enviou uma agenda que não passou na verificação de integridade.';
      else if (/timeout|timed out/i.test(error)) failure = 'O WhatsApp não respondeu a tempo à sincronização da agenda.';
      else failure = 'Não foi possível decodificar a agenda recebida do WhatsApp.';
      report(`[CONTACTS] Chip ${String(chipId).replace(/\D/g, '') || 'local'}: ${failure}`);
    },
  });
  return { logger, reset: () => { failure = ''; }, getFailure: () => failure };
}

module.exports = { createContactSyncLog };
