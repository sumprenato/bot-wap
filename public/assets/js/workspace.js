// Shared presentation for the dashboard and management pages.
// Data and API actions continue to be owned by app.js.
function renderDataTable(host, key, items, headings, row, refresh, emptyText) {
  const state = tablePages[key] || (tablePages[key] = { page: 0, size: 10 });
  const lastPage = Math.max(0, Math.ceil(items.length / state.size) - 1);
  state.page = Math.min(state.page, lastPage);
  const start = state.page * state.size;
  const visible = items.slice(start, start + state.size);
  const tableLabel = { contacts: 'Contatos', tags: 'Tags e rótulos', departments: 'Departamentos' }[key] || 'Dados';
  host.innerHTML = `<div class="data-table-wrap" role="region" tabindex="0" aria-label="${tableLabel}"><table class="data-table">
    <thead><tr>${headings.map((heading) => `<th scope="col">${escapeHtml(heading)}</th>`).join('')}</tr></thead>
    <tbody>${visible.length ? visible.map(row).join('') : `<tr><td colspan="${headings.length}" class="table-empty">${escapeHtml(emptyText)}</td></tr>`}</tbody>
    </table></div>
    <div class="table-pagination">
      <label>Linhas por página <select aria-label="Linhas por página">${[10, 25, 50].map((size) => `<option value="${size}" ${size === state.size ? 'selected' : ''}>${size}</option>`).join('')}</select></label>
      <span aria-live="polite">${items.length ? start + 1 : 0}–${Math.min(start + state.size, items.length)} de ${items.length}</span>
      <button type="button" data-pagination="previous" aria-label="Página anterior" ${state.page === 0 ? 'disabled' : ''}>‹</button>
      <button type="button" data-pagination="next" aria-label="Próxima página" ${state.page === lastPage ? 'disabled' : ''}>›</button>
    </div>`;
  host.querySelector('.table-pagination select').addEventListener('change', (event) => {
    state.size = Number(event.target.value);
    state.page = 0;
    refresh();
  });
  host.querySelectorAll('[data-pagination]').forEach((button) => button.addEventListener('click', () => {
    state.page += button.dataset.pagination === 'next' ? 1 : -1;
    refresh();
  }));
}

function initializeWorkspace() {
  document.getElementById('accountAvatarBtn')?.addEventListener('click', openProfile);
  document.querySelectorAll('.nav-item').forEach((button) => {
    const label = button.querySelector('.nav-label')?.textContent.trim();
    if (label) { button.title = label; button.setAttribute('aria-label', label); }
  });
  ['dashCardOpen', 'dashCardFinalized'].forEach((id) => {
    const card = document.getElementById(id);
    if (!card) return;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    });
  });
  document.getElementById('sidebarToggle')?.addEventListener('click', (event) => {
    const collapsed = document.querySelector('.app').classList.toggle('app--collapsed');
    event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    event.currentTarget.setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
  });
  document.getElementById('kanbanSearch')?.addEventListener('input', () => AppCore.KanbanPage?.render());
}
