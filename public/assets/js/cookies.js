(function (root) {
  'use strict';

  function defaultOptions(options = {}) {
    return {
      path: '/',
      sameSite: 'Lax',
      secure: root.location.protocol === 'https:',
      ...options,
    };
  }

  function set(name, value, options = {}) {
    const settings = defaultOptions(options);
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;
    if (settings.maxAge !== undefined) cookie += `; Max-Age=${Math.floor(settings.maxAge)}`;
    if (settings.expires) cookie += `; Expires=${new Date(settings.expires).toUTCString()}`;
    if (settings.path) cookie += `; Path=${settings.path}`;
    if (settings.domain) cookie += `; Domain=${settings.domain}`;
    if (settings.sameSite) cookie += `; SameSite=${settings.sameSite}`;
    if (settings.secure) cookie += '; Secure';
    root.document.cookie = cookie;
  }

  function get(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const item = root.document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
    if (!item) return null;
    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch {
      return item.slice(prefix.length);
    }
  }

  root.CookieManager = {
    set,
    get,
    exists: (name) => get(name) !== null,
    remove(name, options = {}) { set(name, '', { ...options, maxAge: 0 }); },
  };
})(window);