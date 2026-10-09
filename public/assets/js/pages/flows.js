(function (core) {
  const fetch = core.request;
  const { els, apiUrl, escapeHtml, openInlinePanel, showConfirm, showToast } = core;
  let editingFlowId = null;
  let editingFlow = null;

  async function loadFlows() {
    const res = await fetch(apiUrl('/api/flows'), { credentials: 'include' });
    if (!res.ok) return;
    const { flows } = await res.json();
    renderFlows(flows);
  }

  function renderFlows(flows) {
    if (!els.flowsList) return;
    if (!flows || flows.length === 0) {
      els.flowsList.innerHTML = '<p class="panel-empty">Nenhum fluxo criado ainda. Clique em "+ Novo Fluxo" para começar.</p>';
      return;
    }
    els.flowsList.innerHTML = flows.map((flow) => `
      <div class="flow-card ${flow.active ? 'flow-card--active' : ''}">
        <div class="campaign-card-header">
          <div>
            <strong>${escapeHtml(flow.name)}</strong>
            <span class="campaign-status ${flow.active ? 'campaign-status--finished' : ''}">${flow.active ? '🟢 Ativo' : '⚫ Inativo'}</span>
            ${flow.trigger_keywords?.length ? `<span style="font-size:10px;color:var(--text-faint)">Gatilhos: ${escapeHtml(flow.trigger_keywords.join(', '))}</span>` : ''}
          </div>
          <div class="campaign-card-actions">
            <button class="text-action flow-toggle" data-id="${flow.id}" data-active="${flow.active}">${flow.active ? 'Desativar' : 'Ativar'}</button>
            <button class="text-action flow-duplicate" data-id="${flow.id}">Duplicar</button>
            <button class="text-action flow-edit" data-id="${flow.id}">Editar</button>
            <button class="text-action text-action--danger flow-delete" data-id="${flow.id}">Excluir</button>
          </div>
        </div>
        ${flow.description ? `<p class="campaign-message">${escapeHtml(flow.description)}</p>` : ''}
      </div>`).join('');

    els.flowsList.querySelectorAll('.flow-edit').forEach((button) => button.addEventListener('click', () => {
      const flow = flows.find((item) => item.id == button.dataset.id);
      if (flow) openFlowModal(flow);
    }));
    els.flowsList.querySelectorAll('.flow-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      const ok = await showConfirm({ title: 'Excluir fluxo', body: 'Tem certeza?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/flows/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      showToast('🗑️ Fluxo excluído.', 'success');
      await loadFlows();
    })));
    els.flowsList.querySelectorAll('.flow-duplicate').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      await fetch(apiUrl(`/api/flows/${button.dataset.id}/duplicate`), { method: 'POST', credentials: 'include' });
      showToast('✅ Fluxo duplicado.', 'success');
      await loadFlows();
    })));
    els.flowsList.querySelectorAll('.flow-toggle').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      const flow = flows.find((item) => item.id == button.dataset.id);
      if (!flow) return;
      await fetch(apiUrl(`/api/flows/${button.dataset.id}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...flow, active: !flow.active }),
      });
      await loadFlows();
    })));
  }

  function openFlowModal(flow = null) {
    editingFlowId = flow?.id || null;
    editingFlow = flow;
    if (els.flowId) els.flowId.value = editingFlowId || '';
    document.getElementById('flowModalTitle').textContent = flow ? 'Editar Fluxo' : 'Novo Fluxo';
    if (els.flowName) els.flowName.value = flow?.name || '';
    if (els.flowDescription) els.flowDescription.value = flow?.description || '';
    if (els.flowKeywords) els.flowKeywords.value = (flow?.trigger_keywords || []).join(', ');
    if (els.flowError) els.flowError.hidden = true;
    if (els.flowModal) openInlinePanel(els.flowModal);
  }

  if (els.newFlowBtn) els.newFlowBtn.addEventListener('click', () => openFlowModal());
  if (els.flowModalClose) els.flowModalClose.addEventListener('click', () => { els.flowModal.hidden = true; });
  if (els.flowForm) els.flowForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const keywords = els.flowKeywords.value.split(',').map((keyword) => keyword.trim()).filter(Boolean);
    const payload = {
      name: els.flowName.value,
      description: els.flowDescription.value,
      trigger_keywords: keywords,
      nodes: editingFlow?.nodes || [],
      edges: editingFlow?.edges || [],
      trigger_chips: editingFlow?.trigger_chips || [],
      active: !!editingFlow?.active,
    };
    if (els.flowError) els.flowError.hidden = true;
    try {
      const url = editingFlowId ? apiUrl(`/api/flows/${editingFlowId}`) : apiUrl('/api/flows');
      const method = editingFlowId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`✅ Fluxo ${editingFlowId ? 'atualizado' : 'criado'}.`, 'success');
      els.flowModal.hidden = true;
      await loadFlows();
    } catch (error) {
      if (els.flowError) { els.flowError.textContent = error.message; els.flowError.hidden = false; }
    } finally {
      submit.disabled = false;
    }
  });

  if (els.manageGlobalVarsBtn) els.manageGlobalVarsBtn.addEventListener('click', core.runAction(() => openGlobalVarsModal()));
  if (els.globalVarsClose) els.globalVarsClose.addEventListener('click', () => { els.globalVarsModal.hidden = true; });

  async function openGlobalVarsModal() {
    const res = await fetch(apiUrl('/api/global-variables'), { credentials: 'include' });
    const vars = res.ok ? (await res.json()).variables || [] : [];
    renderGlobalVarsList(vars);
    if (els.globalVarsModal) openInlinePanel(els.globalVarsModal);
  }

  function renderGlobalVarsList(vars) {
    if (!els.globalVarsList) return;
    els.globalVarsList.innerHTML = vars.length
      ? vars.map((item) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
            <code style="font-family:var(--font-mono);font-size:11px;color:var(--admin);min-width:100px">{global:${escapeHtml(item.key)}}</code>
            <span style="flex:1;font-size:12px;color:var(--text-dim)">${escapeHtml(item.value)}</span>
            <button class="text-action text-action--danger global-var-delete" data-key="${escapeHtml(item.key)}">Excluir</button>
          </div>`).join('')
      : '<p style="color:var(--text-faint);font-size:12px">Nenhuma variável global cadastrada.</p>';
    els.globalVarsList.querySelectorAll('.global-var-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
      await fetch(apiUrl(`/api/global-variables/${encodeURIComponent(button.dataset.key)}`), { method: 'DELETE', credentials: 'include' });
      await openGlobalVarsModal();
    })));
  }

  if (els.addGlobalVarBtn) els.addGlobalVarBtn.addEventListener('click', core.runAction(async () => {
    const key = els.newGlobalVarKey?.value?.trim()?.toUpperCase();
    const value = els.newGlobalVarValue?.value?.trim();
    if (!key) return;
    await fetch(apiUrl('/api/global-variables'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ key, value }) });
    if (els.newGlobalVarKey) els.newGlobalVarKey.value = '';
    if (els.newGlobalVarValue) els.newGlobalVarValue.value = '';
    await openGlobalVarsModal();
  }));

  core.FlowsPage = { init: loadFlows };
})(window.AppCore);