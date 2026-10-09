(function (root) {
  'use strict';

  const api = () => root.BotWapApi;

  root.Auth = {
    redirectToLogin() {
      const redirect = `${root.location.pathname}${root.location.search}${root.location.hash}`;
      root.location.replace(`/?redirect=${encodeURIComponent(redirect)}`);
    },
    loginDestination() {
      const requested = new URLSearchParams(root.location.search).get('redirect');
      if (requested && requested.startsWith('/') && !requested.startsWith('//')) {
        const url = new URL(requested, root.location.origin);
        if (url.origin === root.location.origin && url.pathname !== '/') return url.pathname + url.search + url.hash;
      }
      return '/atendimento';
    },
    async isAuthenticated() {
      try {
        const response = await api().request('/api/session', { cache: 'no-store' });
        if (!response.ok) return false;
        return (await response.json()).authenticated === true;
      } catch {
        return false;
      }
    },
    async requireLogin() {
      if (await this.isAuthenticated()) return true;
      this.redirectToLogin();
      return false;
    },
    async redirectIfLogged() {
      if (!(await this.isAuthenticated())) return false;
      root.location.replace(this.loginDestination());
      return true;
    },
    async logout() {
      try {
        await api().request('/api/logout', { method: 'POST' });
      } finally {
        root.location.assign('/');
      }
    },
  };
})(window);
