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

function filteredPageContacts() {
  const term = document.getElementById('contactsPageSearch').value.trim().toLocaleLowerCase('pt-BR');
  const tag = document.getElementById('contactsTagFilter').value;
  const order = document.getElementById('contactsPageSort').value;
  const filtered = contacts.filter((contact) => {
    const name = contact.name || contact.pushName || '';
    const number = isInternalWhatsAppId(contact.number, contact) ? '' : contact.number;
    return `${name} ${number} ${formatPhoneDisplay(number)}`.toLocaleLowerCase('pt-BR').includes(term)
      && (!tag || (contact.tags || []).includes(tag));
  });
  return filtered.sort((a, b) => order === 'recent'
    ? (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')
    : (a.name || a.pushName || '').localeCompare(b.name || b.pushName || '', 'pt-BR'));
}

function renderContactsTable() {
  const host = document.getElementById('contactsTable');
  if (!host) return;
  const tagSelect = document.getElementById('contactsTagFilter');
  const selectedTag = tagSelect.value;
  const names = [...new Set([...allTags.map((tag) => tag.name), ...contacts.flatMap((contact) => contact.tags || [])])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  tagSelect.innerHTML = '<option value="">Todas as tags</option>' + names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  tagSelect.value = names.includes(selectedTag) ? selectedTag : '';
  const filtered = filteredPageContacts();
  document.getElementById('contactsPageCount').textContent = `${filtered.length} contato${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}`;
  const exportButton = document.getElementById('exportContactsBtn');
  exportButton.textContent = `Exportar ${filtered.length} contato${filtered.length === 1 ? '' : 's'}`;
  exportButton.disabled = !filtered.length;
  renderDataTable(host, 'contacts', filtered, ['Nome', 'Rótulos', 'Telefone', 'Última atividade', 'Ações'], (contact) => {
    const internal = isInternalWhatsAppId(contact.number, contact);
    const name = contact.name || contact.pushName || 'Contato sem nome';
    const [bg, color] = avatarColor(name);
    const tags = (contact.tags || []).map((name) => {
      const tag = allTags.find((item) => item.name === name);
      const tagColor = /^#[\da-f]{6}$/i.test(tag?.color || '') ? tag.color : '#3ddc84';
      return `<span class="table-tag" style="--tag-color:${tagColor}">${escapeHtml(name)}</span>`;
    }).join('');
    return `<tr><td><div class="table-contact"><span class="contact-avatar" style="background:${bg};color:${color}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(name)}</strong></div></td>
      <td><div class="table-tags">${tags || '<span class="cell-muted">Sem rótulo</span>'}</div></td>
      <td class="phone-cell">${internal ? '<span class="cell-muted">Não identificado</span>' : escapeHtml(formatPhoneDisplay(contact.number))}</td>
      <td class="cell-muted">${escapeHtml(contact.lastSeenAt ? formatRelativeTime(contact.lastSeenAt) : 'Sem atividade')}</td>
      <td><button type="button" class="table-action" data-contact-number="${escapeHtml(contact.number)}">Conversar <span aria-hidden="true">↗</span></button></td></tr>`;
  }, renderContactsTable, 'Nenhum contato encontrado. Ajuste os filtros ou conecte seu WhatsApp em Meus chips.');
  host.querySelectorAll('[data-contact-number]').forEach((button) => button.addEventListener('click', () => {
    showPage('inbox');
    openConversation(button.dataset.contactNumber);
  }));
}

function renderActivityChart() {
  const host = document.getElementById('activityChart');
  if (!host) return;
  const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const now = new Date();
  const days = Array.from({ length: chartDays }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - chartDays + index + 1);
    return { date, key: dayKey(date), received: 0, sent: 0 };
  });
  const byDay = new Map(days.map((day) => [day.key, day]));
  Object.values(conversations).forEach((conversation) => (conversation.messages || []).forEach((message) => {
    const at = new Date(message.at);
    if (Number.isNaN(at.getTime())) return;
    const day = byDay.get(dayKey(at));
    if (day) day[message.from === 'admin' ? 'sent' : 'received']++;
  }));
  const maximum = Math.max(1, ...days.flatMap((day) => [day.received, day.sent]));
  host.style.setProperty('--chart-days', chartDays);
  host.innerHTML = days.map((day) => {
    const label = day.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<div class="chart-day" role="img" aria-label="${label}: ${day.received} recebidas e ${day.sent} enviadas">
      <div class="chart-bars"><span class="chart-bar received" style="height:${day.received / maximum * 100}%" title="${day.received} recebidas"></span><span class="chart-bar sent" style="height:${day.sent / maximum * 100}%" title="${day.sent} enviadas"></span></div><span class="chart-date">${label}</span></div>`;
  }).join('');
  const received = days.reduce((sum, day) => sum + day.received, 0);
  const sent = days.reduce((sum, day) => sum + day.sent, 0);
  const empty = received + sent === 0;
  host.hidden = empty;
  document.getElementById('activityChartLegend').hidden = empty;
  document.getElementById('activityChartEmpty').hidden = !empty;
  document.getElementById('activityChartSummary').textContent = received + sent
    ? `${received} recebidas · ${sent} enviadas nos últimos ${chartDays} dias.`
    : `Nenhuma mensagem no histórico dos últimos ${chartDays} dias.`;
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
  document.querySelectorAll('[data-chart-days]').forEach((button) => button.addEventListener('click', () => {
    chartDays = Number(button.dataset.chartDays);
    document.querySelectorAll('[data-chart-days]').forEach((item) => {
      item.classList.toggle('is-active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderActivityChart();
  }));
  ['contactsPageSearch', 'contactsTagFilter', 'contactsPageSort'].forEach((id) => {
    document.getElementById(id)?.addEventListener(id === 'contactsPageSearch' ? 'input' : 'change', () => {
      if (tablePages.contacts) tablePages.contacts.page = 0;
      renderContactsTable();
    });
  });
  document.getElementById('exportContactsBtn')?.addEventListener('click', () => {
    const cell = (value) => {
      let text = String(value || '');
      if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [['Nome', 'Telefone', 'Rótulos'], ...filteredPageContacts().map((contact) => [contact.name || contact.pushName || '', isInternalWhatsAppId(contact.number, contact) ? '' : contact.number, (contact.tags || []).join(', ')])];
    const blob = new Blob(['\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'contatos-convelya.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('kanbanSearch')?.addEventListener('input', () => renderKanban(kanbanData.columns, kanbanData.opportunities));
}
