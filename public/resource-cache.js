/* Session-local read cache. No customer data is written to browser storage. */
(function (root) {
  'use strict';

  function createResourceCache({ load, ttl = 30000, now = Date.now, maxEntries = 60 }) {
    const entries = new Map();
    let epoch = 0;
    const copy = (value) => structuredClone(value);
    const entryFor = (key) => {
      if (!entries.has(key)) entries.set(key, { version: 0, expires: 0, hasData: false, pending: null });
      const entry = entries.get(key);
      // Touch the entry for bounded, least-recently-used storage.
      entries.delete(key);
      entries.set(key, entry);
      for (const [oldKey, oldEntry] of entries) {
        if (entries.size <= maxEntries) break;
        if (oldKey !== key && !oldEntry.pending) entries.delete(oldKey);
      }
      return entry;
    };

    async function read(key, { force = false } = {}) {
      const entry = entryFor(key);
      if (!force && entry.hasData && entry.expires > now()) return copy(entry.data);
      if (entry.pending) return copy(await entry.pending);
      const version = entry.version;
      const startedEpoch = epoch;
      const pending = Promise.resolve().then(() => load(key)).then((data) => {
        if (epoch !== startedEpoch) throw new Error('A sessão de carregamento foi encerrada.');
        // A write or socket event supersedes any read that was already in flight.
        if (entry.version !== version) return read(key);
        entry.data = copy(data);
        entry.hasData = true;
        entry.expires = now() + (typeof ttl === 'function' ? ttl(key) : ttl);
        return data;
      }).finally(() => {
        if (entry.pending === pending) entry.pending = null;
      });
      entry.pending = pending;
      return copy(await pending);
    }

    return {
      read,
      isFresh: (key) => !!entries.get(key)?.hasData && entries.get(key).expires > now(),
      invalidate(match = () => true) {
        const matches = typeof match === 'function' ? match : (key) => key === match;
        for (const [key, entry] of entries) {
          if (!matches(key)) continue;
          entry.version++;
          entry.expires = 0;
          entry.pending = null;
        }
      },
      clear() { epoch++; entries.clear(); },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createResourceCache };
  else root.createResourceCache = createResourceCache;
})(typeof globalThis === 'object' ? globalThis : this);
