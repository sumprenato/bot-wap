/* Shared request and page lifecycle; renderers remain in app.js. */
const pageLoads = new Map();
let sessionEnded = false;
let pageSyncAt = 0;
const responseLists = {
  '/api/contacts': ['contacts'], '/api/tags': ['tags'], '/api/departments': ['departments'],
  '/api/campaigns': ['campaigns'], '/api/webhooks': ['webhooks'], '/api/flows': ['flows'],
  '/api/kanban': ['columns', 'opportunities'], '/api/loss-reasons': ['reasons'],
  '/api/followups': ['followups'], '/api/chips': ['chips'], '/api/global-variables': ['variables'],
};

function finishSession() {
  if (sessionEnded) return;
  sessionEnded = true;
  apiCache.clear();
  pageLoads.clear();
  window.location.assign('/');
}

function validateApiData(url, data) {
  const path = new URL(url, window.location.origin).pathname;
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || (responseLists[path] || []).some((field) => !Array.isArray(data[field]))
      || (path === '/api/state' && (!data.conversations || typeof data.conversations !== 'object' || Array.isArray(data.conversations) || typeof data.status?.connected !== 'boolean'))
      || (path === '/api/profile' && typeof data.username !== 'string')
      || (path === '/api/dashboard/stats' && (!Number.isFinite(Number(data.revenue)) || !Number.isFinite(Number(data.conversionRate))))) {
    throw new Error('O servidor retornou dados incompletos. Tente novamente.');
  }
  return data;
}

async function fetchJsonResource(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (res.status === 401) { finishSession(); throw new Error('Sua sessão expirou. Entre novamente.'); }
      if (!res.ok) {
        const error = new Error(res.status >= 500 ? 'O servidor está indisponível no momento.' : 'Não foi possível carregar estes dados.');
        error.status = res.status;
        throw error;
      }
      return validateApiData(url, await res.json());
    } catch (error) {
      const retryable = !sessionEnded && (!error.status || error.status >= 500);
      if (attempt === 0 && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      if (controller.signal.aborted) throw new Error('O carregamento demorou mais que o esperado. Tente novamente.');
      if (error instanceof TypeError) throw new Error('Não foi possível conectar. Verifique sua internet e tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }
}

const apiCache = createResourceCache({
  load: fetchJsonResource,
  ttl: (url) => new URL(url, window.location.origin).pathname === '/api/state' ? 5000 : 30000,
});

async function apiFetch(url, options = {}) {
  if (sessionEnded) throw new Error('Sua sessão foi encerrada.');
  const { forceReload = false, ...requestOptions } = options;
  const method = (requestOptions.method || 'GET').toUpperCase();
  if (method === 'GET') {
    // QR codes and connection status must always come from the server.
    const liveStatus = /\/api\/chips\/[^/]+\/status$/.test(new URL(url, window.location.origin).pathname);
    const data = await apiCache.read(url, { force: forceReload || liveStatus });
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }
  const res = await fetch(url, { ...requestOptions, credentials: 'include' });
  if (res.status === 401) { finishSession(); throw new Error('Sua sessão expirou. Entre novamente.'); }
  if (res.ok) apiCache.invalidate();
  return res;
}

function pageTasks(page) {
  const tasks = {
    inbox: [refreshBotState, refreshContacts, refreshTags, refreshDepartments],
    overview: [refreshBotState, refreshContacts, refreshDashboardStats],
    contacts: [refreshContacts, refreshTags],
    kanban: [loadKanban],
    campaigns: [loadCampaigns, refreshTags],
    flows: [loadFlows],
    webhooks: [loadWebhooks],
    departments: [refreshDepartments],
    tags: [refreshTags],
    chips: [loadChips, refreshDepartments],
    settings: [refreshBotState, loadFollowups],
  };
  return tasks[page] || [];
}

function pageLoadFeedback(page, state) {
  const view = document.querySelector(`[data-page-view="${page}"]`);
  if (!view) return;
  let feedback = view.querySelector('.page-load-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.className = 'page-load-feedback';
    feedback.innerHTML = '<span class="page-load-indicator" aria-hidden="true"></span><div><strong></strong><p></p></div><button type="button" class="secondary-button">Tentar novamente</button>';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.querySelector('button').addEventListener('click', () => ensurePageLoaded(page, { force: true }));
    view.prepend(feedback);
  }
  const initial = !state.ready;
  view.classList.toggle('is-first-load', initial);
  view.classList.toggle('is-load-error', !!state.error);
  view.setAttribute('aria-busy', String(state.loading));
  // Prevent keyboard interaction with partial content while the first load is pending.
  [...view.children].forEach((child) => { if (child !== feedback) child.inert = initial; });
  if (page === 'inbox') document.getElementById('listSidebar').inert = initial;
  feedback.hidden = !state.loading && !state.error;
  feedback.querySelector('strong').textContent = state.error
    ? (state.ready ? 'Não foi possível atualizar a página' : 'Não foi possível carregar a página')
    : (state.ready ? 'Atualizando dados…' : 'Preparando sua página…');
  feedback.querySelector('p').textContent = state.error
    ? `${state.error.message}${state.ready ? ' Os dados carregados anteriormente continuam disponíveis.' : ''}`
    : (state.ready ? 'Você pode continuar usando os dados já carregados.' : 'Aguarde enquanto carregamos as informações.');
  feedback.querySelector('button').hidden = !state.error;
  feedback.querySelector('.page-load-indicator').hidden = !!state.error;
}

function ensurePageLoaded(page, { force = false } = {}) {
  if (sessionEnded) return Promise.resolve(false);
  let state = pageLoads.get(page);
  if (!state) { state = { ready: false, loading: false, pending: null, error: null }; pageLoads.set(page, state); }
  if (state.pending) return state.pending;
  state.loading = true;
  state.error = null;
  pageLoadFeedback(page, state);
  // Allow the loading frame to paint before starting the render work.
  state.pending = Promise.resolve().then(async () => {
    const results = await Promise.allSettled(pageTasks(page).map((task) => task({ forceReload: force })));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (page === 'contacts') renderContacts();
    if (page === 'overview') renderOverview();
    state.ready = true;
    return true;
  }).catch((error) => {
    state.error = error;
    return false;
  }).finally(() => {
    state.loading = false;
    state.pending = null;
    if (!sessionEnded) pageLoadFeedback(page, state);
  });
  return state.pending;
}

function reportLoadError(error) {
  if (sessionEnded) return;
  const state = pageLoads.get(activePage);
  if (state) { state.error = error; state.loading = false; pageLoadFeedback(activePage, state); }
}

function syncActivePage({ force = true } = {}) {
  if (sessionEnded || document.hidden) return;
  const now = Date.now();
  if (now - pageSyncAt < 1500) return;
  pageSyncAt = now;
  return ensurePageLoaded(activePage, { force });
}
