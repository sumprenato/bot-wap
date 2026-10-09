(function (core) {
  const fetch = core.request;
const { els, apiUrl, escapeHtml, openInlinePanel, showConfirm, showToast } = core;
let editingCampaignId = null;

async function loadCampaigns() {
  const res = await fetch(apiUrl('/api/campaigns'), { credentials: 'include' });
  if (!res.ok) return;
  const { campaigns } = await res.json();
  renderCampaigns(campaigns);
}

function renderCampaigns(campaigns) {
  if (!els.campaignsList) return;
  if (!campaigns || campaigns.length === 0) {
    els.campaignsList.innerHTML = '<p class="panel-empty">Nenhuma campanha criada ainda. Clique em "+ Nova Campanha" para começar.</p>';
    return;
  }

  const statusLabel = { draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando', finished: 'Finalizada', cancelled: 'Cancelada' };
  const statusClass = { draft: '', scheduled: 'campaign-status--scheduled', running: 'campaign-status--running', finished: 'campaign-status--finished', cancelled: 'campaign-status--cancelled' };
  els.campaignsList.innerHTML = campaigns.map((campaign) => `
    <div class="campaign-card" data-id="${campaign.id}">
      <div class="campaign-card-header">
        <div><strong>${escapeHtml(campaign.name)}</strong><span class="campaign-status ${statusClass[campaign.status] || ''}">${statusLabel[campaign.status] || campaign.status}</span></div>
        <div class="campaign-card-actions">
          <button class="text-action campaign-duplicate" data-id="${campaign.id}">Duplicar</button>
          <button class="text-action campaign-edit" data-id="${campaign.id}">Editar</button>
          <button class="text-action text-action--danger campaign-delete" data-id="${campaign.id}">Excluir</button>
        </div>
      </div>
      <p class="campaign-message">${escapeHtml(campaign.message.slice(0, 120))}${campaign.message.length > 120 ? '…' : ''}</p>
      <div class="campaign-meta">
        ${campaign.target_tags?.length ? `<span class="campaign-meta-item">🏷️ Enviar para: ${escapeHtml(campaign.target_tags.join(', '))}</span>` : '<span class="campaign-meta-item">🏷️ Todos os contatos</span>'}
        ${campaign.blocked_tags?.length ? `<span class="campaign-meta-item campaign-meta-item--danger">🚫 Excluir: ${escapeHtml(campaign.blocked_tags.join(', '))}</span>` : ''}
        ${campaign.scheduled_at ? `<span class="campaign-meta-item">📅 ${new Date(campaign.scheduled_at).toLocaleString('pt-BR')}</span>` : ''}
        ${campaign.sent_count > 0 ? `<span class="campaign-meta-item">✅ ${campaign.sent_count} enviados · ❌ ${campaign.failed_count} falhas</span>` : ''}
      </div>
    </div>`).join('');

  els.campaignsList.querySelectorAll('.campaign-edit').forEach((button) => button.addEventListener('click', () => {
    const campaign = campaigns.find((item) => item.id == button.dataset.id);
    if (campaign) openCampaignModal(campaign);
  }));
  els.campaignsList.querySelectorAll('.campaign-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
    const ok = await showConfirm({ title: 'Excluir campanha', body: 'Tem certeza que deseja excluir esta campanha?', okText: 'Excluir' });
    if (!ok) return;
    await fetch(apiUrl(`/api/campaigns/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
    showToast('🗑️ Campanha excluída.', 'success');
    await loadCampaigns();
  })));
  els.campaignsList.querySelectorAll('.campaign-duplicate').forEach((button) => button.addEventListener('click', core.runAction(async () => {
    await fetch(apiUrl(`/api/campaigns/${button.dataset.id}/duplicate`), { method: 'POST', credentials: 'include' });
    showToast('✅ Campanha duplicada.', 'success');
    await loadCampaigns();
  })));
}

function openCampaignModal(campaign = null) {
  editingCampaignId = campaign?.id || null;
  if (!els.campaignModal) return;
  document.getElementById('campaignModalTitle').textContent = campaign ? 'Editar Campanha' : 'Nova Campanha';
  if (els.campaignName) els.campaignName.value = campaign?.name || '';
  if (els.campaignMessage) els.campaignMessage.value = campaign?.message || '';
  if (els.campaignScheduledAt) els.campaignScheduledAt.value = campaign?.scheduled_at ? campaign.scheduled_at.replace(' ', 'T').slice(0, 16) : '';
  if (els.campaignError) els.campaignError.hidden = true;
  renderTagPicker('campaignTargetTagsPicker', campaign?.target_tags || []);
  renderTagPicker('campaignBlockedTagsPicker', campaign?.blocked_tags || [], true);
  openInlinePanel(els.campaignModal);
}

function renderTagPicker(containerId, selectedTags, isDanger = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const tags = core.getTags();
  container.innerHTML = tags.length
    ? tags.map((tag) => {
        const isActive = selectedTags.includes(tag.name);
        return `<button type="button" class="tag-toggle-btn ${isActive ? 'is-active' : ''} ${isDanger ? 'tag-toggle-btn--danger' : ''}" data-tag="${escapeHtml(tag.name)}" style="--tag-color:${isDanger ? '#f87171' : tag.color}"><span class="tag-toggle-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}</button>`;
      }).join('')
    : '<p style="color:var(--text-faint);font-size:12px;margin:0">Nenhuma tag disponível</p>';
  container.querySelectorAll('.tag-toggle-btn').forEach((button) => button.addEventListener('click', () => button.classList.toggle('is-active')));
}

if (els.newCampaignBtn) els.newCampaignBtn.addEventListener('click', () => openCampaignModal());
if (els.campaignModalClose) els.campaignModalClose.addEventListener('click', () => { els.campaignModal.hidden = true; });
if (els.campaignForm) els.campaignForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const targetTags = [...document.querySelectorAll('#campaignTargetTagsPicker .tag-toggle-btn.is-active')].map((button) => button.dataset.tag);
  const blockedTags = [...document.querySelectorAll('#campaignBlockedTagsPicker .tag-toggle-btn.is-active')].map((button) => button.dataset.tag);
  const payload = {
    name: els.campaignName.value,
    message: els.campaignMessage.value,
    target_tags: targetTags,
    blocked_tags: blockedTags,
    scheduled_at: els.campaignScheduledAt.value || null,
  };
  if (els.campaignError) els.campaignError.hidden = true;
  if (els.campaignSaveBtn) els.campaignSaveBtn.disabled = true;
  try {
    const url = editingCampaignId ? apiUrl(`/api/campaigns/${editingCampaignId}`) : apiUrl('/api/campaigns');
    const method = editingCampaignId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`✅ Campanha ${editingCampaignId ? 'atualizada' : 'criada'}.`, 'success');
    els.campaignModal.hidden = true;
    await loadCampaigns();
  } catch (error) {
    if (els.campaignError) { els.campaignError.textContent = error.message; els.campaignError.hidden = false; }
  } finally {
    if (els.campaignSaveBtn) els.campaignSaveBtn.disabled = false;
  }
});

core.CampaignsPage = { init: loadCampaigns };
})(window.AppCore);