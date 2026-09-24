const path = require('path');
const { fork } = require('child_process');
const EventEmitter = require('events');

const REQUEST_TIMEOUT_MS = 30000;
const LONG_REQUEST_TIMEOUT_MS = 90000; // envio de mídia grande / desconectar
const STABLE_AFTER_MS = 60000;         // worker que viveu isso tudo zera o backoff
const MAX_RESPAWN_DELAY_MS = 30000;

class BotManager extends EventEmitter {
  constructor({ storageDir }) {
    super();
    this.storageDir = storageDir;
    this.workers = new Map();
    this.requests = new Map();
    this.respawnTimers = new Map();
    this.respawnAttempts = new Map();
    this.sequence = 0;
  }

  isAlive(entry) {
    return !!entry?.child && entry.child.exitCode === null && !entry.child.killed && entry.child.connected;
  }

  ensureWorker(user) {
    if (!user?.id || !user.whatsapp_number) throw new Error('Este cadastro ainda não possui número WhatsApp.');
    let entry = this.workers.get(user.id);
    if (this.isAlive(entry)) return entry;

    // Se sobrou um worker "meio morto" (canal IPC fechado), garante que ele saia.
    if (entry?.child) {
      entry.intentional = true;
      try { entry.child.kill(); } catch { /* já encerrado */ }
    }
    clearTimeout(this.respawnTimers.get(user.id));
    this.respawnTimers.delete(user.id);

    const userStorage = path.join(this.storageDir, 'users', String(user.id));
    const env = { ...process.env, ADMIN_NUMBER: user.whatsapp_number, STORAGE_DIR: userStorage };
    delete env.DATABASE_URL;
    delete env.DATABASE_PRIVATE_URL;
    const child = fork(path.join(__dirname, 'bot-worker.js'), [], { env, silent: false });
    entry = { child, userId: user.id, user, pending: new Map(), startedAt: Date.now(), intentional: false };
    this.workers.set(user.id, entry);

    child.on('message', (message) => {
      if (message.type === 'response') {
        const request = entry.pending.get(message.id);
        if (!request) return;
        entry.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
        return;
      }
      if (message.type === 'event') this.emit('event', { userId: user.id, event: message.event, payload: message.payload });
    });

    child.on('error', (error) => {
      console.error(`[MANAGER] Erro no worker do usuário ${user.id}:`, error.message);
    });

    child.on('exit', (code, signal) => {
      // Nada fica pendurado esperando resposta de um worker que morreu
      for (const request of entry.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('O serviço do WhatsApp foi reiniciado. Tente novamente em instantes.'));
      }
      entry.pending.clear();

      const isCurrent = this.workers.get(user.id)?.child === child;
      if (isCurrent) this.workers.delete(user.id);
      if (entry.intentional) return;

      console.warn(`[MANAGER] Worker do usuário ${user.id} encerrou (${code ?? signal}). Reiniciando...`);
      this.emit('event', { userId: user.id, event: 'status', payload: { connected: false, qr: null, admin: user.whatsapp_number, error: `worker encerrado (${code ?? signal})` } });
      if (isCurrent) this.scheduleRespawn(user, Date.now() - entry.startedAt);
    });

    return entry;
  }

  // Sobe o worker de novo sozinho (com espera crescente) — antes ele só voltava
  // quando alguém dava F5 e o servidor recebia uma requisição nova.
  scheduleRespawn(user, uptimeMs) {
    if (uptimeMs >= STABLE_AFTER_MS) this.respawnAttempts.set(user.id, 0);
    const attempts = this.respawnAttempts.get(user.id) || 0;
    this.respawnAttempts.set(user.id, attempts + 1);
    const delay = Math.min(1000 * 2 ** attempts, MAX_RESPAWN_DELAY_MS);

    clearTimeout(this.respawnTimers.get(user.id));
    this.respawnTimers.set(user.id, setTimeout(() => {
      this.respawnTimers.delete(user.id);
      try {
        this.ensureWorker(user);
      } catch (error) {
        console.error(`[MANAGER] Falha ao reiniciar worker do usuário ${user.id}:`, error.message);
      }
    }, delay));
  }

  request(user, action, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const entry = this.ensureWorker(user);
    const id = `${user.id}-${++this.sequence}`;
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

  async state(user) {
    if (!user?.whatsapp_number) {
      return {
        conversations: {},
        activeTarget: null,
        status: { connected: false, qr: null, admin: '', needsNumber: true },
        admin: '',
      };
    }
    return this.request(user, 'state');
  }
  async reply(user, number, text, displayName) { return this.request(user, 'reply', { number, text, displayName }); }
  async replyMedia(user, number, media, displayName) { return this.request(user, 'reply-media', { number, media, displayName }, LONG_REQUEST_TIMEOUT_MS); }
  async assume(user, number) { return this.request(user, 'assume', { number }); }
  async block(user, number, blocked) { return this.request(user, 'block', { number, blocked }); }
  async clear(user, number) { return this.request(user, 'clear', { number }); }
  async delete(user, number) { return this.request(user, 'delete', { number }); }
  async disconnect(user) { return this.request(user, 'disconnect', {}, LONG_REQUEST_TIMEOUT_MS); }

  restart(user) {
    clearTimeout(this.respawnTimers.get(user.id));
    this.respawnTimers.delete(user.id);
    this.respawnAttempts.set(user.id, 0);
    const entry = this.workers.get(user.id);
    if (entry?.child) {
      entry.intentional = true;
      entry.child.kill();
    }
    this.workers.delete(user.id);
    return this.ensureWorker(user);
  }

  async stopAll() {
    for (const timer of this.respawnTimers.values()) clearTimeout(timer);
    this.respawnTimers.clear();
    for (const entry of this.workers.values()) {
      entry.intentional = true;
      entry.child.kill();
    }
    this.workers.clear();
  }
}

module.exports = BotManager;
