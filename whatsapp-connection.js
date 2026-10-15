const fs = require('node:fs');
const path = require('node:path');

const REASONS = { 401: 'logged_out', 403: 'forbidden', 408: 'connection_lost', 411: 'multidevice_mismatch', 428: 'connection_closed', 440: 'connection_replaced', 500: 'stream_error', 503: 'service_unavailable', 515: 'restart_required' };
const PAUSED = {
  440: 'Outra instância assumiu esta sessão do WhatsApp. Encerre a instância duplicada antes de reiniciar este serviço.',
  403: 'O WhatsApp recusou esta conexão. Confira a conta e a autorização do dispositivo antes de tentar novamente.',
  411: 'O WhatsApp recusou a configuração de múltiplos dispositivos. Confira os dispositivos vinculados e a compatibilidade da conexão.',
};

function disconnectInfo(error) {
  const value = Number(error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode);
  const code = Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
  // 500 is also Baileys' fallback for unknown stream errors: it is not proof of revoked credentials.
  return { code, reason: REASONS[code] || 'unknown', action: code === 401 ? 'new_qr' : PAUSED[code] ? 'paused' : 'reconnect', error: PAUSED[code] || '' };
}

function createConnectionLog(storageDir, chipId, report = line => console.info(line)) {
  const file = path.join(storageDir, 'connection-events.log');
  return (event, detail = {}) => {
    // An allowlist keeps QR data, account IDs, server payloads and encryption keys out of logs.
    const entry = { at: new Date().toISOString(), chipId: String(chipId).replace(/\D/g, '') || 'local', pid: process.pid, event };
    for (const name of ['code', 'reason', 'action', 'attempt', 'retryInMs', 'uptimeMs']) {
      if (detail[name] !== undefined) entry[name] = detail[name];
    }
    const line = JSON.stringify(entry);
    report(`[WHATSAPP] ${line}`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size >= 128 * 1024) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line + '\n');
    } catch { report('[WHATSAPP] Não foi possível gravar o diagnóstico local de conexão.'); }
  };
}

module.exports = { disconnectInfo, createConnectionLog };
