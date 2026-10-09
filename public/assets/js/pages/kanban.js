(function (core) {
  const fetch = core.request;
  const {
    els, apiUrl, escapeHtml, normalizeNumber, openInlineForm, openInlinePanel,
    saveResource, showConfirm, showToast,
  } = core;
  const getContacts = core.getContacts;
  let lossingOpportunityId = null;
  let editingOpportunity = null;
  let lossReasons = [];
  let kanbanData = { columns: [], opportunities: [] };

  async function loadKanban() {
    const res = await fetch(apiUrl('/api/kanban'), { credentials: 'include' });
    if (!res.ok) return;
    const { columns, opportunities } = await res.json();
    kanbanData = { columns, opportunities };
    const lrRes = await fetch(apiUrl('/api/loss-reasons'), { credentials: 'include' });
    if (lrRes.ok) lossReasons = (await lrRes.json()).reasons || [];
    renderKanban(columns, opportunities);
  }

  function renderKanban(columns, opportunities) {
    if (!els.kanbanBoard) return;
    if (els.kanbanMetrics) {
      const won = opportunities.filter((item) => item.status === 'won');
      const lost = opportunities.filter((item) => item.status === 'lost');
      const revenue = won.reduce((total, item) => total + (Number(item.value) || 0), 0);
      const conversionRate = opportunities.length ? (won.length / opportunities.length * 100).toFixed(1) : 0;
      const lossMap = {};
      lost.forEach((item) => {
        const reason = lossReasons.find((entry) => entry.id === item.loss_reason_id);
        const key = reason?.name || 'Sem motivo';
        lossMap[key] = (lossMap[key] || 0) + 1;
      });
      const topLossReasons = Object.entries(lossMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
      els.kanbanMetrics.innerHTML = `
        <div class="kanban-metric-bar">
          <div class="kanban-metric"><span>Total</span><strong>${opportunities.length}</strong></div>
          <div class="kanban-metric kanban-metric--won"><span>Ganhos</span><strong>${won.length}</strong></div>
          <div class="kanban-metric kanban-metric--lost"><span>Perdidos</span><strong>${lost.length}</strong></div>
          <div class="kanban-metric kanban-metric--revenue"><span>Receita</span><strong>R$ ${revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>
          <div class="kanban-metric"><span>Conversão</span><strong>${conversionRate}%</strong></div>
          ${topLossReasons.length ? `<div class="kanban-metric kanban-metric--loss"><span>Top perda</span><strong>${escapeHtml(topLossReasons[0][0])}</strong></div>` : ''}
        </div>`;
    }

    const term = document.getElementById('kanbanSearch').value.trim().toLocaleLowerCase('pt-BR');
    const status = document.getElementById('funnelStatus').value;
    const colors = ['var(--accent)', 'var(--admin)', 'var(--live)', 'var(--warm)', 'var(--danger)'];
    els.kanbanBoard.innerHTML = columns.map((column, index) => {
      const columnOpportunities = opportunities.filter((item) => String(item.column_id) === String(column.id)
        && (status === 'all' || item.status === status)
        && `${item.title} ${item.contact_name || ''}`.toLocaleLowerCase('pt-BR').includes(term));
      const cards = columnOpportunities.map((opportunity) => `
        <div class="kanban-card" data-id="${opportunity.id}">
          <div class="kanban-card-title">${escapeHtml(opportunity.title)}</div>
          ${opportunity.contact_name ? `<div class="kanban-card-contact">👤 ${escapeHtml(opportunity.contact_name)}</div>` : ''}
          ${opportunity.value ? `<div class="kanban-card-value">R$ ${Number(opportunity.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>` : ''}
          <span class="funnel-outcome">${{ open: 'Em andamento', won: 'Ganha', lost: 'Perdida' }[opportunity.status] || ''}</span>
          <label class="funnel-move">Etapa
            <select data-move-id="${opportunity.id}" aria-label="Etapa de ${escapeHtml(opportunity.title)}">
              ${columns.map((stage) => '<option value="' + stage.id + '" ' + (String(stage.id) === String(opportunity.column_id) ? 'selected' : '') + '>' + escapeHtml(stage.name) + '</option>').join('')}
            </select>
          </label>
          <div class="kanban-card-actions">
            <button type="button" class="kanban-card-btn kanban-edit" data-id="${opportunity.id}">Editar</button>
            ${opportunity.status === 'open' ? `<button type="button" class="kanban-card-btn kanban-win" data-id="${opportunity.id}">Ganha</button>` : ''}
            ${opportunity.status === 'open' ? `<button type="button" class="kanban-card-btn kanban-lose" data-id="${opportunity.id}">Perdida</button>` : ''}
            <button type="button" class="kanban-card-btn kanban-delete" data-id="${opportunity.id}">Excluir</button>
          </div>
        </div>`).join('');
      return `
        <div class="kanban-column" data-col-id="${column.id}" style="--stage-color:${colors[index % colors.length]}">
          <div class="kanban-column-header">
            <span class="kanban-column-name">${escapeHtml(column.name)}</span>
            <span class="kanban-column-count">${columnOpportunities.length}</span>
            <button type="button" class="kanban-add-opp text-action" data-col-id="${column.id}" aria-label="Nova oportunidade em ${escapeHtml(column.name)}">+</button>
            <button type="button" class="kanban-delete-col" data-col-id="${column.id}" title="Excluir etapa" aria-label="Excluir etapa ${escapeHtml(column.name)}">×</button>
          </div>
          <div class="kanban-cards">${cards || `<div class="kanban-empty"><span>Nenhuma oportunidade${term ? ' encontrada' : ''}</span><button type="button" class="kanban-add-opp text-action" data-col-id="${column.id}">+ Adicionar oportunidade</button></div>`}</div>
        </div>`;
    }).join('') + '<button type="button" class="kanban-new-stage" id="kanbanAddStage"><span aria-hidden="true">⊕</span>Adicionar etapa</button>';

    els.kanbanBoard.querySelectorAll('[data-move-id]').forEach((select) => {
      select.addEventListener('change', core.runAction(async () => {
        const item = opportunities.find((entry) => String(entry.id) === select.dataset.moveId);
        try {
          await saveResource('/api/kanban/opportunities/' + item.id, 'PUT', { ...item, column_id: Number(select.value) });
          await loadKanban();
          showToast('Oportunidade movida para a etapa selecionada.', 'success');
        } catch (error) {
          select.value = String(item.column_id);
          throw error;
        }
      }));
    });
    document.getElementById('kanbanAddStage').addEventListener('click', () => els.addKanbanColumnBtn.click());
    els.kanbanBoard.querySelectorAll('.kanban-edit').forEach((button) => button.addEventListener('click', () => {
      const opportunity = opportunities.find((item) => String(item.id) === button.dataset.id);
      if (opportunity) openOpportunityModal(opportunity.column_id, opportunity);
    }));
    els.kanbanBoard.querySelectorAll('.kanban-add-opp').forEach((button) => button.addEventListener('click', () => openOpportunityModal(button.dataset.colId)));
    els.kanbanBoard.querySelectorAll('.kanban-delete-col').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      const ok = await showConfirm({ title: 'Excluir etapa', body: 'Isso também excluirá as oportunidades nesta etapa.', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/kanban/columns/${button.dataset.colId}`), { method: 'DELETE', credentials: 'include' });
      await loadKanban();
    })));
    els.kanbanBoard.querySelectorAll('.kanban-win').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      await fetch(apiUrl(`/api/kanban/opportunities/${button.dataset.id}/win`), { method: 'POST', credentials: 'include' });
      showToast('🏆 Oportunidade ganha!', 'success');
      await loadKanban();
    })));
    els.kanbanBoard.querySelectorAll('.kanban-lose').forEach((button) => button.addEventListener('click', () => openLoseModal(button.dataset.id)));
    els.kanbanBoard.querySelectorAll('.kanban-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      const ok = await showConfirm({ title: 'Excluir oportunidade', body: 'Tem certeza?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/kanban/opportunities/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      await loadKanban();
    })));
  }

  function openOpportunityModal(columnId, opportunity = null) {
    editingOpportunity = opportunity;
    els.opportunityColumnId.innerHTML = kanbanData.columns.map((stage) => '<option value="' + stage.id + '">' + escapeHtml(stage.name) + '</option>').join('');
    if (els.opportunityId) els.opportunityId.value = opportunity?.id || '';
    if (els.opportunityColumnId) els.opportunityColumnId.value = columnId;
    if (els.opportunityTitle) els.opportunityTitle.value = opportunity?.title || '';
    if (els.opportunityContact) els.opportunityContact.value = opportunity?.contact_number || '';
    if (els.opportunityValue) els.opportunityValue.value = opportunity?.value || '';
    if (els.opportunityError) els.opportunityError.hidden = true;
    document.getElementById('opportunityModalTitle').textContent = opportunity ? 'Editar Oportunidade' : 'Nova Oportunidade';
    if (els.opportunityModal) openInlinePanel(els.opportunityModal);
  }

  function openLoseModal(opportunityId) {
    lossingOpportunityId = opportunityId;
    if (els.loseReasonSelect) {
      els.loseReasonSelect.innerHTML = '<option value="">Sem motivo específico</option>'
        + lossReasons.map((reason) => `<option value="${reason.id}">${escapeHtml(reason.name)}</option>`).join('');
    }
    if (els.loseModal) openInlinePanel(els.loseModal);
  }

  if (els.opportunityModalClose) els.opportunityModalClose.addEventListener('click', () => { els.opportunityModal.hidden = true; });
  if (els.opportunityForm) els.opportunityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const id = els.opportunityId.value;
    const payload = {
      title: els.opportunityTitle.value,
      contact_number: els.opportunityContact.value,
      contact_name: getContacts().find((contact) => contact.number === normalizeNumber(els.opportunityContact.value))?.name || editingOpportunity?.contact_name || '',
      value: parseFloat(els.opportunityValue.value) || 0,
      column_id: parseInt(els.opportunityColumnId.value),
      position: editingOpportunity?.position || 0,
    };
    if (els.opportunityError) els.opportunityError.hidden = true;
    try {
      const url = id ? apiUrl(`/api/kanban/opportunities/${id}`) : apiUrl('/api/kanban/opportunities');
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`✅ Oportunidade ${id ? 'atualizada' : 'criada'}.`, 'success');
      els.opportunityModal.hidden = true;
      if (!id) document.getElementById('funnelStatus').value = 'open';
      await loadKanban();
    } catch (error) {
      if (els.opportunityError) { els.opportunityError.textContent = error.message; els.opportunityError.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });
  if (els.loseModalCancel) els.loseModalCancel.addEventListener('click', () => { els.loseModal.hidden = true; });
  if (els.loseModalConfirm) els.loseModalConfirm.addEventListener('click', core.runAction(async () => {
    const reasonId = els.loseReasonSelect.value ? parseInt(els.loseReasonSelect.value) : null;
    await fetch(apiUrl(`/api/kanban/opportunities/${lossingOpportunityId}/lose`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ loss_reason_id: reasonId }),
    });
    showToast('📉 Oportunidade marcada como perdida.', 'success');
    els.loseModal.hidden = true;
    await loadKanban();
  }));
  if (els.addKanbanColumnBtn) els.addKanbanColumnBtn.addEventListener('click', () => openInlineForm({
    title: 'Nova etapa',
    description: 'Crie uma etapa para organizar as oportunidades de venda.',
    fields: [{ name: 'name', label: 'Nome da etapa', required: true, maxLength: 60, placeholder: 'Ex.: Em negociação' }],
    onSave: async (values) => {
      await saveResource('/api/kanban/columns', 'POST', values);
      await loadKanban();
    },
  }));
  if (els.manageLossReasonsBtn) els.manageLossReasonsBtn.addEventListener('click', core.runAction(() => openLossReasonsModal()));

  async function openLossReasonsModal() {
    const res = await fetch(apiUrl('/api/loss-reasons'), { credentials: 'include' });
    lossReasons = res.ok ? (await res.json()).reasons || [] : [];
    renderLossReasonsModal();
    if (els.lossReasonsModal) openInlinePanel(els.lossReasonsModal);
  }

  function renderLossReasonsModal() {
    if (!els.lossReasonsContent) return;
    els.lossReasonsContent.innerHTML = lossReasons.length
      ? lossReasons.map((reason) => `<div class="loss-reason-item"><span>${escapeHtml(reason.name)}</span><button class="text-action text-action--danger" data-id="${reason.id}">Excluir</button></div>`).join('')
      : '<p style="color:var(--text-faint);font-size:12px">Nenhum motivo cadastrado.</p>';
    els.lossReasonsContent.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      await fetch(apiUrl(`/api/loss-reasons/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      await openLossReasonsModal();
    })));
  }

  if (els.lossReasonsClose) els.lossReasonsClose.addEventListener('click', () => { els.lossReasonsModal.hidden = true; });
  if (els.addLossReasonBtn) els.addLossReasonBtn.addEventListener('click', core.runAction(async () => {
    const name = els.newLossReasonInput?.value?.trim();
    if (!name) return;
    await fetch(apiUrl('/api/loss-reasons'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
    if (els.newLossReasonInput) els.newLossReasonInput.value = '';
    await openLossReasonsModal();
  }));

  document.getElementById('funnelStatus').addEventListener('change', () => renderKanban(kanbanData.columns, kanbanData.opportunities));

  core.KanbanPage = {
    init: loadKanban,
    render: () => renderKanban(kanbanData.columns, kanbanData.opportunities),
  };
})(window.AppCore);