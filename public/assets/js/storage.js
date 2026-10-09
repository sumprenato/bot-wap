(function (root) {
  'use strict';

  function storageFor(kind) {
    try {
      return root[kind];
    } catch {
      return null;
    }
  }

  function createStorage(kind) {
    return {
      get(key, fallback = null) {
        try {
          const value = storageFor(kind)?.getItem(key);
          return value === null || value === undefined ? fallback : value;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          storageFor(kind)?.setItem(key, String(value));
          return true;
        } catch {
          return false;
        }
      },
      remove(key) {
        try {
          storageFor(kind)?.removeItem(key);
          return true;
        } catch {
          return false;
        }
      },
      has(key) {
        return this.get(key) !== null;
      },
    };
  }

  root.BotWapStorage = {
    local: createStorage('localStorage'),
    session: createStorage('sessionStorage'),
  };
})(window);