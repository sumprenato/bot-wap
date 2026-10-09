(function (core) {
  const fetch = core.request;
  const { els, apiUrl, escapeHtml, openInlineForm, saveResource, showConfirm, showToast } = core;
  const refreshTags = core.refreshTags;
  const refreshDepartments = core.refreshDepartments;
  const getTags = core.getTags;
  const getDepartments = core.getDepartments;

  function editTag(tag = null, duplicate = false) {
    const panel = openInlineForm({
      title: duplicate ? 'Duplicar tag' : tag ? 'Editar tag' : 'Nova tag',
      description: 'Dê um nome ao rótulo e escolha uma cor para identificar seus contatos.',
      fields: [
        { name: 'name', label: 'Nome da tag', required: true, maxLength: 60, value: tag ? `${tag.name}${duplicate ? ' (cópia)' : ''}` : '', placeholder: 'Ex.: Cliente novo' },
        { name: 'color', label: 'Cor (código hexadecimal)', required: true, value: tag?.color || '#3ddc84', pattern: '#[0-9a-fA-F]{6}', placeholder: '#3ddc84' },
      ],
      onSave: async (values) => {
        await saveResource(tag && !duplicate ? `/api/tags/${tag.id}` : '/api/tags', tag && !duplicate ? 'PUT' : 'POST', values);
        await refreshTags();
      },
    });
    const input = panel?.querySelector('[name="color"]');
    if (!input || input.parentElement.querySelector('.color-options')) return;
    const palette = document.createElement('div');
    palette.className = 'color-options';
    const colors = [['Verde', '#3ddc84'], ['Azul', '#5c8df6'], ['Roxo', '#8e5cf6'], ['Amarelo', '#f2b84b'], ['Vermelho', '#f07070'], ['Rosa', '#ec4899'], ['Cinza', '#94a3b8']];
    const update = () => palette.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color.toLowerCase() === input.value.toLowerCase())));
    colors.forEach(([name, color]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-option';
      button.dataset.color = color;
      button.style.setProperty('--swatch', color);
      button.textContent = name;
      button.addEventListener('click', () => { input.value = color; update(); });
      palette.appendChild(button);
    });
    input.before(palette);
    input.addEventListener('input', update);
    update();
  }

  function editDepartment(department = null, duplicate = false) {
    openInlineForm({
      title: duplicate ? 'Duplicar departamento' : department ? 'Editar departamento' : 'Novo departamento',
      description: 'Depois de salvar, associe o departamento a um número na página Meus chips.',
      fields: [
        { name: 'name', label: 'Nome do departamento', required: true, maxLength: 60, value: department ? `${department.name}${duplicate ? ' (cópia)' : ''}` : '', placeholder: 'Ex.: Financeiro' },
        { name: 'description', label: 'Descrição (opcional)', type: 'textarea', value: department?.description || '', placeholder: 'Ex.: Cobranças, pagamentos e segunda via de boletos' },
      ],
      onSave: async (values) => {
        await saveResource(department && !duplicate ? `/api/departments/${department.id}` : '/api/departments', department && !duplicate ? 'PUT' : 'POST', values);
        await refreshDepartments();
      },
    });
  }

  function renderResourceList(host, items, kind) {
    if (!host) return;
    const isTag = kind === 'tags';
    core.renderDataTable(host, kind, items, [isTag ? 'Rótulo' : 'Nome', isTag ? 'Cor' : 'Descrição', 'Ações'], (item) => `<tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${isTag ? `<span class="table-tag" style="--tag-color:${/^#[\da-f]{6}$/i.test(item.color) ? item.color : '#3ddc84'}"><span class="color-dot"></span>${escapeHtml(item.color)}</span>` : escapeHtml(item.description || '—')}</td>
      <td class="actions-cell"><details class="row-actions"><summary aria-label="Ações de ${escapeHtml(item.name)}">•••</summary><div class="row-action-buttons">
        <button type="button" class="text-action" data-action="edit" data-id="${item.id}">Editar</button>
        <button type="button" class="text-action" data-action="duplicate" data-id="${item.id}">Duplicar</button>
        <button type="button" class="text-action text-action--danger" data-action="delete" data-id="${item.id}">Excluir</button>
      </div></details></td></tr>`, () => renderResourceList(host, items, kind), isTag ? 'Crie sua primeira tag para organizar os contatos por nome e cor.' : 'Crie seu primeiro departamento para organizar o atendimento.');
    host.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      const actions = button.closest('details');
      if (actions) actions.open = false;
      const item = items.find((entry) => String(entry.id) === button.dataset.id);
      if (!item) return;
      if (button.dataset.action !== 'delete') {
        (isTag ? editTag : editDepartment)(item, button.dataset.action === 'duplicate');
        return;
      }
      const confirmed = await showConfirm({
        title: `Excluir ${isTag ? 'tag' : 'departamento'} “${item.name}”?`,
        body: isTag ? 'Este rótulo deixará de estar disponível para organizar os contatos.' : 'As conversas ficarão sem este departamento. Se houver chips associados, altere o departamento deles em Meus chips antes de excluir.',
        okText: 'Excluir',
      });
      if (!confirmed) return;
      button.disabled = true;
      try {
        await saveResource(`/api/${kind}/${item.id}`, 'DELETE');
        await (isTag ? refreshTags() : refreshDepartments());
        showToast(isTag ? 'Tag excluída.' : 'Departamento excluído.', 'success');
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    })));
  }

  function renderTags() { renderResourceList(els.tagsSettingsList, getTags(), 'tags'); }
  function renderDepartments() { renderResourceList(els.deptsSettingsList, getDepartments(), 'departments'); }
  if (els.addTagBtn) els.addTagBtn.addEventListener('click', () => editTag());
  if (els.addDeptBtn) els.addDeptBtn.addEventListener('click', () => editDepartment());

  async function loadFollowups() {
    const res = await fetch(apiUrl('/api/followups'), { credentials: 'include' });
    if (!res.ok) return;
    const { followups } = await res.json();
    renderFollowupsList(followups);
  }

  function renderFollowupsList(followups) {
    if (!els.followupsList) return;
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    els.followupsList.innerHTML = followups.length
      ? followups.map((followup) => `<div class="tag-settings-item" style="flex-wrap:wrap;gap:8px"><span class="tag-settings-dot" style="background:${followup.active ? 'var(--live)' : 'var(--text-faint)'}"></span><span class="tag-settings-name">${escapeHtml(followup.name)}</span><span style="font-size:11px;color:var(--text-faint)">⏱ ${followup.delay_hours}h · 📅 ${(followup.active_days || []).map((day) => dayNames[day]).join(', ')}</span><button class="text-action followup-delete" data-id="${followup.id}">Excluir</button></div>`).join('')
      : '<p style="color:var(--text-faint);font-size:12px">Nenhum follow-up configurado.</p>';
    els.followupsList.querySelectorAll('.followup-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      await fetch(apiUrl(`/api/followups/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      await loadFollowups();
    })));
  }

  if (els.addFollowupBtn) els.addFollowupBtn.addEventListener('click', () => openInlineForm({
    title: 'Novo acompanhamento automático',
    description: 'Defina a mensagem e o tempo de inatividade para retomar o contato.',
    fields: [
      { name: 'name', label: 'Nome do acompanhamento', required: true, maxLength: 60 },
      { name: 'message', label: 'Mensagem', type: 'textarea', required: true },
      { name: 'delay_hours', label: 'Horas de inatividade antes do envio', type: 'number', required: true, min: 1, step: 1, value: 24 },
    ],
    onSave: async (values) => {
      await saveResource('/api/followups', 'POST', { ...values, delay_hours: Number(values.delay_hours) });
      await loadFollowups();
    },
  }));

  core.SettingsPage = { renderTags, renderDepartments, loadFollowups };
})(window.AppCore);