(function (core) {
  const fetch = core.request;
  const { els, apiUrl, escapeHtml, showConfirm, showToast, socket } = core;
  const getDepartments = core.getDepartments;
  let allChips = [];
  const chipStatusTimers = {};

  async function loadChips() {
    const res = await fetch(apiUrl('/api/chips'), { credentials: 'include' });
    const data = await res.json();
    allChips = data.chips || [];
    renderChips();
  }

  async function fetchChipStatus(chipId) {
    try {
      const res = await fetch(apiUrl(`/api/chips/${chipId}/status`), { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function renderChips() {
    const list = document.getElementById('chipsList');
    const badge = document.getElementById('chipsBadge');
    if (!list) return;
    if (badge) badge.textContent = allChips.length;
    if (!allChips.length) {
      list.innerHTML = '<div class="chip-empty"><strong>📱 Nenhum número cadastrado ainda</strong><p>Adicione seu primeiro número WhatsApp abaixo para começar a receber mensagens.</p></div>';
      return;
    }
    list.replaceChildren();
    for (const chip of allChips) {
      list.appendChild(buildChipCard(chip));
      if (chip.is_primary) scheduleChipStatusFetch(chip.id);
    }
  }

  function buildChipCard(chip) {
    const isPrimary = !!chip.is_primary;
    const isOnline = chip._connected === true;
    const isLoading = isPrimary && chip._connected === undefined;
    const statusClass = isLoading ? 'is-loading' : (isOnline ? 'is-online' : 'is-offline');
    const statusText = isLoading ? 'verificando…' : (isOnline ? 'conectado' : 'desconectado');
    const cardClass = isLoading ? '' : (isOnline ? 'chip-online' : 'chip-offline');
    const displayStatusText = isPrimary ? statusText : 'reservado para fluxos';
    const departments = getDepartments();
    const card = document.createElement('div');
    card.className = `chip-card ${cardClass}`;
    card.dataset.chipId = chip.id;
    card.innerHTML = `
      <div class="chip-icon">${isOnline ? '📱' : '📴'}</div>
      <div class="chip-body">
        <div class="chip-header-row"><span class="chip-name">${escapeHtml(chip.name || 'Sem nome')}</span><span class="chip-status-pill ${statusClass}"><span class="chip-status-dot"></span>${displayStatusText}</span></div>
        <div class="chip-number">${core.formatPhoneDisplay(chip.number)}</div>
        <label class="chip-department-field">Departamento
          <select data-action="department" data-chip-id="${chip.id}">
            <option value="">Selecione um departamento</option>
            ${departments.map((department) => `<option value="${department.id}" ${String(chip.department_id || '') === String(department.id) ? 'selected' : ''}>${escapeHtml(department.name)}</option>`).join('')}
          </select>
        </label>
        ${(isPrimary && chip._qr && !isOnline) ? `<div class="chip-qr-wrap"><img class="chip-qr-img" src="${chip._qr}" alt="QR Code" /><div class="chip-qr-hint"><strong>Escaneie para conectar</strong>Abra o WhatsApp → Aparelhos conectados → Conectar dispositivo</div></div>` : ''}
      </div>
      <div class="chip-actions">
        ${!isPrimary ? `<button class="text-action" data-action="primary" data-chip-id="${chip.id}">tornar principal</button>` : ''}
        ${isOnline ? `<button class="text-action text-action--danger" data-action="disconnect" data-chip-id="${chip.id}">desconectar</button>` : ''}
        <button class="text-action" data-action="delete" data-chip-id="${chip.id}" style="color:var(--danger)">remover</button>
      </div>`;
    card.querySelectorAll('[data-action]').forEach((button) => {
      if (button.dataset.action === 'department') {
        button.addEventListener('change', () => handleChipAction('department', chip.id, button));
        return;
      }
      button.addEventListener('click', () => handleChipAction(button.dataset.action, chip.id, button));
    });
    return card;
  }

  function scheduleChipStatusFetch(chipId, delay = 400) {
    clearTimeout(chipStatusTimers[chipId]);
    chipStatusTimers[chipId] = setTimeout(async () => {
      const status = await fetchChipStatus(chipId);
      const index = allChips.findIndex((chip) => chip.id === chipId);
      if (index < 0 || !allChips[index].is_primary) return;
      if (!status) { scheduleChipStatusFetch(chipId, 3000); return; }
      allChips[index]._connected = status.connected;
      allChips[index]._qr = status.qr;
      const list = document.getElementById('chipsList');
      if (!list) return;
      const existing = list.querySelector(`[data-chip-id="${chipId}"]`);
      if (existing) list.replaceChild(buildChipCard(allChips[index]), existing);
      if (!status.connected && !status.qr) chipStatusTimers[chipId] = setTimeout(() => scheduleChipStatusFetch(chipId), 3000);
    }, delay);
  }

  async function handleChipAction(action, chipId, button) {
    if (action === 'department') {
      const chip = allChips.find((item) => String(item.id) === String(chipId));
      try {
        const res = await fetch(apiUrl(`/api/chips/${chipId}/department`), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ departmentId: button.value || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao alterar departamento.');
        if (chip) chip.department_id = data.chip.department_id;
        await loadChips();
        showToast('Departamento do chip atualizado.', 'success');
      } catch (error) {
        showToast(error.message, 'error');
        await loadChips();
      }
    } else if (action === 'primary') {
      button.disabled = true;
      try {
        const res = await fetch(apiUrl(`/api/chips/${chipId}/primary`), { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao definir chip principal.');
        await loadChips();
        showToast('Chip principal alterado. Escaneie o QR Code para conectar.', 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
    } else if (action === 'disconnect') {
      if (!await showConfirm({ title: 'Desconectar chip?', body: 'O atendimento deste número será interrompido. Você precisará escanear o QR Code para reconectar.', okText: 'Desconectar' })) return;
      button.disabled = true;
      button.textContent = 'desconectando…';
      try {
        const res = await fetch(apiUrl(`/api/chips/${chipId}/disconnect`), { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao desconectar.');
        await loadChips();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'desconectar';
        showToast(error.message, 'error');
      }
    } else if (action === 'delete') {
      if (!await showConfirm({ title: 'Remover chip?', body: 'O bot deixará de atender por este número. Se ele for o principal, outro chip cadastrado será promovido.', okText: 'Remover chip' })) return;
      button.disabled = true;
      try {
        const res = await fetch(apiUrl(`/api/chips/${chipId}`), { method: 'DELETE', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao remover o chip.');
        await loadChips();
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
    }
  }

  const addChipBtn = document.getElementById('addChipBtn');
  if (addChipBtn) addChipBtn.addEventListener('click', async () => {
    const nameInput = document.getElementById('chipNameInput');
    const numberInput = document.getElementById('chipNumberInput');
    const departmentInput = document.getElementById('chipDepartmentInput');
    const errorEl = document.getElementById('chipError');
    const name = (nameInput?.value || '').trim();
    const number = (numberInput?.value || '').replace(/\D/g, '');
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (!name) { if (errorEl) { errorEl.textContent = 'Informe um nome para este número.'; errorEl.hidden = false; } return; }
    if (!number || number.length < 8) { if (errorEl) { errorEl.textContent = 'Informe um número válido com DDI (ex: 5511999999999).'; errorEl.hidden = false; } numberInput?.focus(); return; }
    if (!departmentInput?.value) { if (errorEl) { errorEl.textContent = 'Selecione um departamento. Se necessário, crie um na página Departamentos.'; errorEl.hidden = false; } departmentInput?.focus(); return; }
    addChipBtn.disabled = true;
    addChipBtn.textContent = 'Adicionando…';
    try {
      const res = await fetch(apiUrl('/api/chips'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, number, departmentId: departmentInput.value || null }),
      });
      const data = await res.json();
      if (!res.ok) { if (errorEl) { errorEl.textContent = data.error || 'Erro ao adicionar.'; errorEl.hidden = false; } return; }
      if (nameInput) nameInput.value = '';
      if (numberInput) numberInput.value = '';
      if (departmentInput) departmentInput.value = '';
      await loadChips();
    } catch (error) {
      if (errorEl) { errorEl.textContent = error.message || 'Erro de rede. Tente novamente.'; errorEl.hidden = false; }
    } finally {
      addChipBtn.disabled = false;
      addChipBtn.textContent = 'Adicionar chip';
    }
  });

  socket.on('chip:status', (data) => {
    const { chipId, connected, qr } = data || {};
    if (!chipId) return;
    const index = allChips.findIndex((chip) => chip.id === chipId);
    if (index < 0) return;
    allChips[index]._connected = connected;
    allChips[index]._qr = qr;
    const list = document.getElementById('chipsList');
    if (!list) return;
    const existing = list.querySelector(`[data-chip-id="${chipId}"]`);
    if (existing) list.replaceChild(buildChipCard(allChips[index]), existing);
  });

  core.ChipsPage = { init: loadChips, render: renderChips };
})(window.AppCore);