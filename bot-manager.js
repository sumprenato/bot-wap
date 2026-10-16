const path = require('path');
const { fork } = require('child_process');
const EventEmitter = require('events');

const REQUEST_TIMEOUT_MS = 30000;
const LONG_REQUEST_TIMEOUT_MS = 90000;
const STABLE_AFTER_MS = 60000;
const MAX_RESPAWN_DELAY_MS = 30000;

// BotManager agora gerencia workers por chip (não por usuário).
// Cada chip tem seu próprio worker/socket WhatsApp independente.
// A chave dos workers é `chipId` (id da tabela chips).
class BotManager extends EventEmitter {
  constructor({ storageDir }) {
    super();
    this.storageDir = storageDir;
    // key: chipId → { child, chipId, userId, chip, pending, startedAt, intentional }
    this.workers = new Map();
    this.requests = new Map();
    this.respawnTimers = new Map();
    this.respawnAttempts = new Map();
    this.stopping = new Map();
    this.sequence = 0;
  }

  isAlive(entry) {
    return !!entry?.child && entry.child.exitCode === null && !entry.child.killed && entry.child.connected;
  }

  // chip = { id, number, name, user_id }
  ensureWorker(chip) {
    if (!chip?.id) throw new Error('Chip inválido: precisa de id.');
    const chipId = chip.id;
    if (this.stopping.has(chipId) || this.respawnTimers.has(chipId)) {
      throw Object.assign(new Error('O serviço deste chip está reiniciando. Aguarde alguns instantes.'), { code: 'WORKER_RESTARTING' });
    }
    let entry = this.workers.get(chipId);
    if (this.isAlive(entry)) return entry;

    if (entry?.child) {
      this.stopChip(chipId);
      throw Object.assign(new Error('O serviço deste chip está reiniciando. Aguarde alguns instantes.'), { code: 'WORKER_RESTARTING' });
    }
    clearTimeout(this.respawnTimers.get(chipId));
    this.respawnTimers.delete(chipId);

    // Cada chip usa storage isolado: storageDir/chips/{chipId}/
    const chipStorage = path.join(this.storageDir, 'chips', String(chipId));
    const env = {
      ...process.env,
      ADMIN_NUMBER: '',
      EXPECTED_ACCOUNT_NUMBER: chip.identity_verified ? chip.number : '',
      STORAGE_DIR: chipStorage,
      ACCOUNT_MEDIA_DIR: path.join(this.storageDir, 'users', String(chip.user_id), 'media'),
      CHIP_ID: String(chipId),
      DEPARTMENT_ID: chip.department_id ? String(chip.department_id) : '',
    };
    delete env.DATABASE_URL;
    delete env.DATABASE_PRIVATE_URL;

    const child = fork(path.join(__dirname, 'bot-worker.js'), [], { env, silent: false });
    entry = {
      child,
      chipId,
      userId: chip.user_id,
      chip,
      pending: new Map(),
      startedAt: Date.now(),
      intentional: false,
    };
    this.workers.set(chipId, entry);

    child.on('message', async (message) => {
      if (entry.intentional || this.workers.get(chipId) !== entry) return;
      if (message.type === 'flow-authorize') {
        try {
          if (!this.authorizeFlow) throw Object.assign(new Error('Verificação do fluxo indisponível.'),{code:'FLOW_STOPPED'});
          await this.authorizeFlow(chip.user_id,chipId,message.runId,message.number);
          if (!entry.intentional && child.connected) child.send({type:'flow-authorize-result',id:message.id});
        } catch (error) {
          if (!entry.intentional && child.connected) child.send({type:'flow-authorize-result',id:message.id,error:error.message,code:error.code || 'FLOW_STOPPED'});
        }
        return;
      }
      if (message.type === 'identity') {
        try {
          if (!this.verifyIdentity) throw new Error('Verificação da conta indisponível.');
          await this.verifyIdentity(chipId, message.number);
          if (entry.intentional || this.workers.get(chipId) !== entry) return;
          chip.number = message.number;
          chip.identity_verified = 1;
          child.send({ type: 'identity-result', id: message.id, number: message.number });
        } catch (error) {
          if (!entry.intentional && child.connected) child.send({ type: 'identity-result', id: message.id, error: error.message, code: error.code });
        }
        return;
      }
      if (message.type === 'response') {
        const request = entry.pending.get(message.id);
        if (!request) return;
        entry.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(Object.assign(new Error(message.error), { code: message.errorCode, deliveryAttempted: message.deliveryAttempted }));
        else request.resolve(message.result);
        return;
      }
      if (message.type === 'event') {
        if (message.event === 'status') entry.status = message.payload;
        this.emit('event', {
          userId: chip.user_id,
          chipId,
          chipNumber: chip.identity_verified ? chip.number : null,
          event: message.event,
          payload: message.payload,
        });
      }
    });

    child.on('error', (error) => {
      console.error(`[MANAGER] Erro no worker do chip ${chipId} (${chip.number}):`, error.message);
    });

    child.on('exit', (code, signal) => {
      for (const request of entry.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('O serviço do WhatsApp foi reiniciado. Tente novamente em instantes.'));
      }
      entry.pending.clear();

      const isCurrent = this.workers.get(chipId)?.child === child;
      if (isCurrent) this.workers.delete(chipId);
      if (entry.intentional) return;

      console.warn(`[MANAGER] Worker do chip ${chipId} (${chip.number}) encerrou (${code ?? signal}). Reiniciando...`);
      this.emit('event', {
        userId: chip.user_id,
        chipId,
        chipNumber: chip.number,
        event: 'chip:status',
        payload: { chipId, number: chip.number, connected: false, qr: null, error: `worker encerrado (${code ?? signal})` },
      });
      if (isCurrent) this.scheduleRespawn(chip, Date.now() - entry.startedAt);
    });

    return entry;
  }

  scheduleRespawn(chip, uptimeMs) {
    const chipId = chip.id;
    if (uptimeMs >= STABLE_AFTER_MS) this.respawnAttempts.set(chipId, 0);
    const attempts = this.respawnAttempts.get(chipId) || 0;
    this.respawnAttempts.set(chipId, attempts + 1);
    const delay = Math.min(1000 * 2 ** attempts, MAX_RESPAWN_DELAY_MS);

    clearTimeout(this.respawnTimers.get(chipId));
    this.respawnTimers.set(chipId, setTimeout(() => {
      this.respawnTimers.delete(chipId);
      try {
        this.ensureWorker(chip);
      } catch (error) {
        console.error(`[MANAGER] Falha ao reiniciar worker do chip ${chipId}:`, error.message);
      }
    }, delay));
  }

  request(chip, action, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const entry = this.ensureWorker(chip);
    const id = `${chip.id}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error('O WhatsApp demorou para responder. Tente novamente.'));
      }, timeoutMs);
      entry.pending.set(id, { resolve, reject, timer });
      entry.child.send({ id, action, payload }, (error) => {
        if (error) {
          clearTimeout(timer);
          entry.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  // Retorna o status de um chip específico
  async chipState(chip) {
    return this.request(chip, 'status');
  }

  // Retorna estado completo: conversas + status de todos os chips do usuário
  async state(user, chips = [], selectedChipId) {
    const selected = chips.find((chip) => String(chip.id) === String(selectedChipId)) || chips.find((chip) => chip.is_primary) || chips[0];
    let current = {};
    if (selected) {
      try { current = await this.request(selected, 'state', {}, 8000); }
      catch { current = { status: { connected: false, qr: null, error: 'Conexão indisponível.' } }; }
    }
    // Other workers publish their own status. A slow/crashed worker must never delay this channel.
    const chipsStatus = chips.map((chip) => {
      const entry = this.workers.get(chip.id);
      return { chipId: chip.id, name: chip.name, number: chip.identity_verified ? chip.number : null,
        ...(chip.id === selected?.id ? current.status : this.isAlive(entry) ? entry.status : null) };
    });
    const channelStatus = chipsStatus.find((chip) => chip.chipId === selected?.id) || { connected: false, qr: null };
    return {
      conversations: Object.fromEntries(Object.entries(current.conversations || {}).map(([number, item]) => [number, { ...item, chipId: selected.id, chipName: selected.name }])),
      activeTarget: current.activeTarget || null,
      chipId: selected?.id || null, chipName: selected?.name || '',
      channelStatus, chips: chipsStatus,
      status: { connected: chipsStatus.some((chip) => chip.connected), connectedCount: chipsStatus.filter((chip) => chip.connected).length, admin: channelStatus.admin || '', needsNumber: !chips.length },
      admin: channelStatus.admin || '',
    };
  }

  async reply(chip, number, text, displayName, replyTo) { return this.request(chip, 'reply', { number, text, displayName, replyTo }); }
  async replyMedia(chip, number, media, displayName, replyTo) { return this.request(chip, 'reply-media', { number, media, displayName, replyTo }, LONG_REQUEST_TIMEOUT_MS); }
  async assume(chip, number) { return this.request(chip, 'assume', { number }); }
  async block(chip, number, blocked) { return this.request(chip, 'block', { number, blocked }); }
  async clear(chip, number) { return this.request(chip, 'clear', { number }); }
  async delete(chip, number) { return this.request(chip, 'delete', { number }); }
  async disconnect(chip) { return this.request(chip, 'disconnect', {}, LONG_REQUEST_TIMEOUT_MS); }

  stopChip(chipId) {
    if (this.stopping.has(chipId)) return this.stopping.get(chipId).stoppingPromise;
    clearTimeout(this.respawnTimers.get(chipId));
    this.respawnTimers.delete(chipId);
    this.respawnAttempts.delete(chipId);
    const entry = this.workers.get(chipId);
    if (entry?.child) {
      entry.intentional = true;
      for (const request of entry.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Este canal foi encerrado. Atualize a conexão antes de tentar novamente.'));
      }
      entry.pending.clear();
    }
    this.workers.delete(chipId);
    if (!entry?.child || entry.child.exitCode !== null) return Promise.resolve();
    this.stopping.set(chipId, entry);
    entry.stoppingPromise = new Promise(resolve => {
      let timer, fallback;
      const done = () => {
        clearTimeout(timer); clearTimeout(fallback);
        entry.child.removeListener('exit', done);
        if (this.stopping.get(chipId) === entry) this.stopping.delete(chipId);
        resolve();
      };
      entry.child.once('exit', done);
      timer = setTimeout(() => {
        fallback = setTimeout(done, 1000);
        try { entry.child.kill('SIGKILL'); } catch { /* already exited */ }
      }, 6000);
      // IPC shutdown also works on Windows, where kill(SIGTERM) terminates immediately.
      try {
        if (entry.child.connected) entry.child.send({ type: 'shutdown' }, error => {
          if (error) { try { entry.child.kill(); } catch { done(); } }
        });
        else entry.child.kill();
      } catch { try { entry.child.kill(); } catch { done(); } }
    });
    return entry.stoppingPromise;
  }

  // Reinicia o worker de um chip (ex: após edição do perfil)
  async restart(chip) {
    await this.stopChip(chip.id);
    return this.ensureWorker(chip);
  }

  async stopAll() {
    for (const timer of this.respawnTimers.values()) clearTimeout(timer);
    this.respawnTimers.clear();
    const stops = [...this.workers.keys()].map(chipId => this.stopChip(chipId));
    await Promise.all([...stops, ...[...this.stopping.values()].map(entry => entry.stoppingPromise)]);
  }
}

module.exports = BotManager;
