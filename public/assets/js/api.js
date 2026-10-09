(function (root) {
  'use strict';

  const baseUrl = root.BACKEND_URL || '';

  async function checkedFetch(url, options = {}) {
    let response;
    try {
      response = await root.fetch(url, { credentials: 'include', ...options });
    } catch {
      throw new Error('Falha de conex\u00e3o. Verifique sua rede e tente novamente.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || (response.status === 401
        ? 'Sua sess\u00e3o expirou. Entre novamente no painel.'
        : 'N\u00e3o foi poss\u00edvel concluir a opera\u00e7\u00e3o. Tente novamente.'));
    }
    return response;
  }

  root.BotWapApi = {
    checkedFetch,
    baseUrl,
    url: (path) => `${baseUrl}${path}`,
    request(path, options = {}) {
      return root.fetch(`${baseUrl}${path}`, { credentials: 'include', ...options });
    },
  };
})(window);