(function (core) {
  const fetch = core.request;
const { els, apiUrl, escapeHtml, formatRelativeTime, openInlinePanel, showConfirm, showToast } = core;
let editingWebhookId = null;
let editingWebhookActive = true;
let searchVersion = 0;

async function loadWebhooks() {
  const version = ++searchVersion;
  const search = els.webhookSearch?.value || '';
  const res = await fetch(apiUrl(`/api/webhooks${search ? `?search=${encodeURIComponent(search)}` : ''}`), { credentials: 'include' });
  if (!res.ok) return;
  const { webhooks } = await res.json();
  if (version === searchVersion) renderWebhooks(webhooks);
}

function renderWebhooks(webhooks) {
  if (!els.webhooksList) return;
  if (!webhooks || webhooks.length === 0) {
    els.webhooksList.innerHTML = '<p class="panel-empty">Nenhum webhook configurado. Clique em "+ Novo Webhook" para começar.</p>';
    return;
  }
  els.webhooksList.innerHTML = webhooks.map((webhook) => `
    <div class="webhook-card ${webhook.active ? '' : 'webhook-card--inactive'}">
      <div class="webhook-card-header">
        <div><strong>${escapeHtml(webhook.name)}</strong><span class="webhook-status">${webhook.active ? '🟢 Ativo' : '⚫ Inativo'}</span></div>
        <div class="campaign-card-actions">
          <button class="text-action webhook-edit" data-id="${webhook.id}">Editar</button>
          <button class="text-action text-action--danger webhook-delete" data-id="${webhook.id}">Excluir</button>
        </div>
      </div>
      <p class="webhook-url" title="${escapeHtml(webhook.url)}">${escapeHtml(webhook.url)}</p>
      <div class="campaign-meta">
        ${(webhook.events || []).map((event) => `<span class="campaign-meta-item">📡 ${escapeHtml(event)}</span>`).join('')}
        ${webhook.last_triggered_at ? `<span class="campaign-meta-item">⏱ Último disparo: ${formatRelativeTime(webhook.last_triggered_at)}</span>` : ''}
      </div>
    </div>`).join('');
  els.webhooksList.querySelectorAll('.webhook-edit').forEach((button) => button.addEventListener('click', () => {
    const webhook = webhooks.find((item) => item.id == button.dataset.id);
    if (webhook) openWebhookModal(webhook);
  }));
  els.webhooksList.querySelectorAll('.webhook-delete').forEach((button) => button.addEventListener('click', core.runAction(async () => {
    const ok = await showConfirm({ title: 'Excluir webhook', body: 'Tem certeza?', okText: 'Excluir' });
    if (!ok) return;
    await fetch(apiUrl(`/api/webhooks/${button.dataset.id}`), { method: 'DELETE', credentials: 'include' });
    showToast('🗑️ Webhook excluído.', 'success');
    await loadWebhooks();
  })));
}

function openWebhookModal(webhook = null) {
  editingWebhookId = webhook?.id || null;
  editingWebhookActive = webhook ? !!webhook.active : true;
  document.getElementById('webhookModalTitle').textContent = webhook ? 'Editar Webhook' : 'Novo Webhook';
  if (els.webhookName) els.webhookName.value = webhook?.name || '';
  if (els.webhookUrl) els.webhookUrl.value = webhook?.url || '';
  if (els.webhookSecret) els.webhookSecret.value = webhook?.secret || '';
  if (els.webhookError) els.webhookError.hidden = true;
  document.querySelectorAll('[name="events"]').forEach((checkbox) => {
    checkbox.checked = (webhook?.events || []).includes(checkbox.value);
  });
  if (els.webhookModal) openInlinePanel(els.webhookModal);
}

if (els.newWebhookBtn) els.newWebhookBtn.addEventListener('click', () => openWebhookModal());
if (els.webhookModalClose) els.webhookModalClose.addEventListener('click', () => { els.webhookModal.hidden = true; });
if (els.webhookSearch) els.webhookSearch.addEventListener('input', () => loadWebhooks().catch(core.reportError));
if (els.webhookForm) els.webhookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const events = [...document.querySelectorAll('[name="events"]:checked')].map((checkbox) => checkbox.value);
  const payload = { name: els.webhookName.value, url: els.webhookUrl.value, events, secret: els.webhookSecret.value, active: editingWebhookActive };
  if (els.webhookError) els.webhookError.hidden = true;
  if (els.webhookSaveBtn) els.webhookSaveBtn.disabled = true;
  try {
    const url = editingWebhookId ? apiUrl(`/api/webhooks/${editingWebhookId}`) : apiUrl('/api/webhooks');
    const method = editingWebhookId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`✅ Webhook ${editingWebhookId ? 'atualizado' : 'criado'}.`, 'success');
    els.webhookModal.hidden = true;
    await loadWebhooks();
  } catch (error) {
    if (els.webhookError) { els.webhookError.textContent = error.message; els.webhookError.hidden = false; }
  } finally {
    if (els.webhookSaveBtn) els.webhookSaveBtn.disabled = false;
  }
});

core.WebhooksPage = { init: loadWebhooks };
})(window.AppCore);