// WhatsApp sends its saved address book through both history and app-state events.
// Keep these separate from live messages: syncing a contact must never forward a message.
const userJid = (value) =>
  String(value || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
const individual = (jid) => /@(s\.whatsapp\.net|lid)$/.test(jid || "");

class WhatsAppDirectory {
  constructor({ socket, store, emit, authKeys, connected = () => true, canSave = async () => true, readyForSync = async () => true, syncTimeoutMs = 180000 }) {
    this.socket = socket;
    this.store = store;
    this.emit = emit;
    this.connected = connected;
    this.canSave = canSave;
    this.authKeys = authKeys;
    this.readyForSync = readyForSync;
    this.queue = Promise.resolve();
    this.photos = new Map();
    this.photoRequests = new Map();
    this.syncPromise = null;
    this.syncedAt = 0;
    this.hasSnapshot = false;
    this.syncState = { syncing: false, verified: false, stage: 'waiting', error: '' };
    this.queueError = null;
    this.pendingBatches = 0;
    this.syncTimeoutMs = syncTimeoutMs;
    this.syncAttempt = 0;
    const enqueue = (contacts) => {
      contacts = contacts.filter(contact => typeof contact.name === 'string' || contact.imgUrl !== undefined || contact.lid && contact.phoneNumber);
      // Profile notifications accompany every live message; they are not an agenda import.
      if (!contacts.length) return;
      this.pendingBatches++;
      if (this.syncState.stage !== 'error' || this.syncPromise) {
        this.updateSync({ syncing: true, verified: false, stage: 'loading', error: '' });
      }
      this.queue = this.queue
        .then(() => this.save(contacts))
        .catch((error) => { this.queueError = error; })
        .finally(() => {
          this.pendingBatches--;
          if (!this.pendingBatches && !this.syncPromise && this.hasSnapshot) {
            try { this.finishSync(); } catch { /* Exposed through syncState; retry remains available. */ }
          }
        });
    };
    socket.ev.on("contacts.upsert", enqueue);
    socket.ev.on("contacts.update", enqueue);
    socket.ev.on("messaging-history.set", ({ contacts = [], chats = [] }) =>
      enqueue([
        ...chats
          .filter((chat) => individual(chat.id) && typeof chat.name === 'string' && chat.name.trim())
          .map((chat) => ({
            id: chat.id,
            name: chat.name || "",
          })),
        ...contacts,
      ]),
    );
  }
  updateSync(patch) {
    const next = { ...this.syncState, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.syncState)) return;
    this.syncState = next;
    this.emit('contacts:sync', next);
  }
  finishSync() {
    if (this.queueError) {
      this.updateSync({ syncing: false, verified: false, stage: 'error', error: 'Não foi possível concluir a carga dos contatos. Tente novamente.' });
      throw this.queueError;
    }
    if (!this.connected()) throw new Error('WhatsApp desconectado durante a sincronização.');
    this.updateSync({ syncing: false, verified: true, stage: 'ready', error: '' });
    this.emit('contacts:updated', { synced: true });
  }
  async save(contacts = []) {
    if (!(await this.canSave())) return;
    let count = 0;
    for (const contact of contacts) {
      const jid = contact.id || contact.jid;
      if (!individual(jid)) continue;
      const phoneJid = [contact.phoneNumber, contact.jid, jid].find((value) =>
        /@s\.whatsapp\.net$/.test(value || ""),
      );
      const number = userJid(phoneJid || contact.phoneNumber || jid);
      if (!number) continue;
      // notify/verifiedName describe a profile, not the user's address book.
      const hasSavedName = typeof contact.name === 'string';
      if (contact.lid && phoneJid && this.store.registerConversationAliases) {
        await this.store.registerConversationAliases(userJid(contact.lid), number, { create: false });
      }
      if (hasSavedName) await this.store.saveContact({
        number,
        name: contact.name,
        nameSource: 'whatsapp',
        jid: contact.lid || jid,
        preserveActivity: true,
      });
      if (contact.imgUrl !== undefined) {
        this.photos.delete(number);
        this.photos.delete("me");
        this.emit("profile:updated", { number });
      }
      if (hasSavedName) {
        count++;
      }
    }
    if (count && !this.syncState.syncing) this.emit("contacts:updated", { count });
  }
  async sync() {
    if (!this.connected()) return { connected: false, synced: false };
    if (this.syncPromise) return this.syncPromise;
    if (this.syncState.verified && Date.now() - this.syncedAt < 5 * 60 * 1000)
      return { connected: true, synced: true };
    const needsSnapshot = !this.hasSnapshot || !this.syncState.verified;
    this.queueError = null;
    this.updateSync({ syncing: true, verified: false, stage: 'loading', error: '' });
    const attempt = ++this.syncAttempt;
    let timer;
    const work = (async () => {
      // New pairings receive encryption keys and an automatic history sync after
      // connection.open. Do not reset their cursor or flush their buffer mid-sync.
      while (!(await this.readyForSync()) || this.socket.ev.isBuffering?.()) {
        if (attempt !== this.syncAttempt) throw new Error('Sincronização expirada.');
        if (!this.connected()) throw new Error('WhatsApp desconectado durante a sincronização.');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (attempt !== this.syncAttempt) throw new Error('Sincronização expirada.');
      // Recover the complete address book even for sessions established before
      // this handler existed. Only reset the contact collection's local cursor.
      if (needsSnapshot && this.authKeys?.set) {
        await this.authKeys.set({
          "app-state-sync-version": { critical_unblock_low: null },
        });
      }
      try {
        await this.socket.resyncAppState(["critical_unblock_low"], true);
      } finally {
        // Baileys' buffered function does not flush a manually requested sync.
        // Release contacts before draining/verifying the persistence queue, and
        // release live-message events even if the request fails.
        this.socket.ev.flush?.();
      }
      if (attempt !== this.syncAttempt) throw new Error('Sincronização expirada.');
      if (this.authKeys?.get) {
        const snapshot = await this.authKeys.get('app-state-sync-version', ['critical_unblock_low']);
        if (!Number.isFinite(snapshot?.critical_unblock_low?.version)) {
          throw new Error('O WhatsApp não confirmou a sincronização da agenda.');
        }
      }
      this.updateSync({ stage: 'verifying' });
      // History may enqueue another batch while the previous one is being saved.
      let queue;
      do {
        queue = this.queue;
        await queue;
        if (this.store.getContacts) await this.store.getContacts();
      } while (queue !== this.queue);
      if (attempt !== this.syncAttempt) throw new Error('Sincronização expirada.');
      this.finishSync();
      this.hasSnapshot = true;
      this.syncedAt = Date.now();
      return { connected: true, synced: true };
    })();
    this.syncPromise = Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.syncAttempt++;
        reject(new Error('A sincronização demorou demais. Tente novamente.'));
      }, this.syncTimeoutMs);
    })]).catch(error => {
      this.queueError = error;
      this.updateSync({ syncing: false, verified: false, stage: 'error', error: 'Não foi possível concluir a carga dos contatos. Tente novamente.' });
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      this.syncPromise = null;
    });
    return this.syncPromise;
  }
  async profile(number) {
    const key = number === "me" ? "me" : userJid(number);
    const cached = this.photos.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (!this.connected())
      return { number: key, profilePic: "", connected: false };
    if (this.photoRequests.has(key)) return this.photoRequests.get(key);
    const request = (async () => {
      const jid =
        key === "me"
          ? this.socket.user?.id
          : (await this.store.getKnownJid(key)) || `${key}@s.whatsapp.net`;
      if (!jid) return { number: key, profilePic: "", connected: true };
      let profilePic = "";
      try {
        profilePic =
          (await this.socket.profilePictureUrl(jid, "image", 10000)) || "";
      } catch (error) {
        const code = error.output?.statusCode || error.statusCode;
        // Privacy/no-photo responses are normal. Transient failures may be retried.
        if (![401, 403, 404].includes(code)) throw error;
      }
      const value = { number: key, profilePic, connected: true };
      this.photos.set(key, {
        value,
        expires:
          Date.now() + (profilePic ? 6 * 60 * 60 * 1000 : 15 * 60 * 1000),
      });
      return value;
    })().finally(() => this.photoRequests.delete(key));
    this.photoRequests.set(key, request);
    return request;
  }
}
module.exports = { WhatsAppDirectory };
