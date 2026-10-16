/* =====================================================
   CONVELYA — app.js
   Versão: 20260924-3 (v5.0)
   ===================================================== */

const API_BASE = BotWapApi.baseUrl;
const socket = io(API_BASE, { withCredentials: true });

const apiUrl = BotWapApi.url;

function formatWhatsappNumber(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 13);
  if (!digits) return '';
  if (!digits.startsWith('55')) return `+${digits}`;
  if (digits.length <= 2) return `+${digits}`;
  if (digits.length <= 4) return `+55 (${digits.slice(2)}`;
  if (digits.length <= 9) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4)}`;
  return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
}

// ---- Elementos DOM ----
const els = {
  connDot:           document.getElementById('connDot'),
  connText:          document.getElementById('connText'),
  qrWrap:            document.getElementById('qrWrap'),
  qrImage:           document.getElementById('qrImage'),
  adminLabel:        document.getElementById('profileBtn'),
  convoList:         document.getElementById('convoList'),
  convoCount:        document.getElementById('convoCount'),
  chatTitle:         document.getElementById('chatTitle'),
  chatSub:           document.getElementById('chatSub'),
  chatAvatar:        document.getElementById('chatAvatar'),
  chatAvatarPhoto:   document.getElementById('chatAvatarPhoto'),
  chatLog:           document.getElementById('chatLog'),
  chatActions:       document.getElementById('chatActions'),
  composer:          document.getElementById('composer'),
  composerInput:     document.getElementById('composerInput'),
  fileInput:         document.getElementById('fileInput'),
  attachBtn:         document.getElementById('attachBtn'),
  filePreview:       document.getElementById('filePreview'),
  filePreviewName:   document.getElementById('filePreviewName'),
  removeFileBtn:     document.getElementById('removeFileBtn'),
  sendBtn:           document.getElementById('sendBtn'),
  assumeBtn:         document.getElementById('assumeBtn'),
  blockBtn:          document.getElementById('blockBtn'),
  tagsBtn:           document.getElementById('tagsBtn'),
  finalizeBtn:       document.getElementById('finalizeBtn'),
  clearBtn:          document.getElementById('clearBtn'),
  deleteBtn:         document.getElementById('deleteBtn'),
  newChatInput:      document.getElementById('newChatInput'),
  newChatBtn:        document.getElementById('newChatBtn'),
  conversationSearch:document.getElementById('conversationSearch'),
  filterButtons:     document.querySelectorAll('.filter-btn'),
  departmentFilter:  document.getElementById('departmentFilter'),
  overviewConversations: document.getElementById('overviewConversations'),
  overviewAssumed:   document.getElementById('overviewAssumed'),
  overviewStatus:    document.getElementById('overviewStatus'),
  disconnectBtn:     document.getElementById('disconnectBtn'),
  profileBtn:        document.getElementById('profileBtn'),
  profileModal:      document.getElementById('profileModal'),
  profileClose:      document.getElementById('profileClose'),
  profileForm:       document.getElementById('profileForm'),
  profileUsername:   document.getElementById('profileUsername'),
  profileDisplayName:document.getElementById('profileDisplayName'),
  profileWhatsappNumber: document.getElementById('profileWhatsappNumber'),
  profileError:      document.getElementById('profileError'),
  profileSaveBtn:    document.getElementById('profileSaveBtn'),
  contactsNavCount:  document.getElementById('contactsNavCount'),
  contactsCount:     document.getElementById('contactsCount'),
  contactSearch:     document.getElementById('contactSearch'),
  contactsGrid:      document.getElementById('contactsGrid'),
  overviewTotal:     document.getElementById('overviewTotal'),
  overviewFinalized: document.getElementById('overviewFinalized'),
  overviewMessages:  document.getElementById('overviewMessages'),
  overviewChannel:   document.getElementById('overviewChannel'),
  overviewChannelCard: document.getElementById('overviewChannelCard'),
  overviewList:      document.getElementById('overviewList'),
  overviewDate:      document.getElementById('overviewDate'),
  overviewStatusPill: document.getElementById('overviewStatusPill'),
  overviewRevenue:   document.getElementById('overviewRevenue'),
  overviewConversion: document.getElementById('overviewConversion'),
  settingsConnection: document.getElementById('settingsConnection'),
  settingsDisconnect: document.getElementById('settingsDisconnect'),
  settingsProfile:   document.getElementById('settingsProfile'),
  settingsLogout:    document.getElementById('settingsLogout'),
  settingsProfileInfo: document.getElementById('settingsProfileInfo'),
  settingsQrHint:    document.getElementById('settingsQrHint'),
  inboxTools:        document.getElementById('inboxTools'),
  inboxConvoHeader:  document.getElementById('inboxConvoHeader'),
  unreadBadge:       document.getElementById('unreadBadge'),
  confirmModal:      document.getElementById('confirmModal'),
  confirmTitle:      document.getElementById('confirmTitle'),
  confirmBody:       document.getElementById('confirmBody'),
  confirmOk:         document.getElementById('confirmOk'),
  confirmCancel:     document.getElementById('confirmCancel'),
  activeTagsRow:     document.getElementById('activeTagsRow'),
  activeTagsPills:   document.getElementById('activeTagsPills'),
  // Bulk
  bulkBar:           document.getElementById('bulkBar'),
  bulkCount:         document.getElementById('bulkCount'),
  bulkTagsBtn:       document.getElementById('bulkTagsBtn'),
  bulkTransferBtn:   document.getElementById('bulkTransferBtn'),
  bulkCancelBtn:     document.getElementById('bulkCancelBtn'),
  // Tags modal
  tagsModal:         document.getElementById('tagsModal'),
  tagsModalContent:  document.getElementById('tagsModalContent'),
  tagsModalClose:    document.getElementById('tagsModalClose'),
  tagsModalClose2:   document.getElementById('tagsModalClose2'),
  tagsModalSave:     document.getElementById('tagsModalSave'),
  // Campaign
  campaignsList:     document.getElementById('campaignsList'),
  newCampaignBtn:    document.getElementById('newCampaignBtn'),
  campaignModal:     document.getElementById('campaignModal'),
  campaignModalClose:document.getElementById('campaignModalClose'),
  campaignForm:      document.getElementById('campaignForm'),
  campaignName:      document.getElementById('campaignName'),
  campaignMessage:   document.getElementById('campaignMessage'),
  campaignScheduledAt: document.getElementById('campaignScheduledAt'),
  campaignError:     document.getElementById('campaignError'),
  campaignSaveBtn:   document.getElementById('campaignSaveBtn'),
  campaignTargetTagsPicker: document.getElementById('campaignTargetTagsPicker'),
  campaignBlockedTagsPicker: document.getElementById('campaignBlockedTagsPicker'),
  // Webhook
  webhooksList:      document.getElementById('webhooksList'),
  webhookSearch:     document.getElementById('webhookSearch'),
  newWebhookBtn:     document.getElementById('newWebhookBtn'),
  webhookModal:      document.getElementById('webhookModal'),
  webhookModalClose: document.getElementById('webhookModalClose'),
  webhookForm:       document.getElementById('webhookForm'),
  webhookName:       document.getElementById('webhookName'),
  webhookUrl:        document.getElementById('webhookUrl'),
  webhookSecret:     document.getElementById('webhookSecret'),
  webhookError:      document.getElementById('webhookError'),
  webhookSaveBtn:    document.getElementById('webhookSaveBtn'),
  // Kanban
  kanbanBoard:       document.getElementById('kanbanBoard'),
  kanbanMetrics:     document.getElementById('kanbanMetrics'),
  addKanbanColumnBtn: document.getElementById('addKanbanColumnBtn'),
  manageLossReasonsBtn: document.getElementById('manageLossReasonsBtn'),
  opportunityModal:  document.getElementById('opportunityModal'),
  opportunityModalClose: document.getElementById('opportunityModalClose'),
  opportunityForm:   document.getElementById('opportunityForm'),
  opportunityId:     document.getElementById('opportunityId'),
  opportunityColumnId: document.getElementById('opportunityColumnId'),
  opportunityTitle:  document.getElementById('opportunityTitle'),
  opportunityContact: document.getElementById('opportunityContact'),
  opportunityValue:  document.getElementById('opportunityValue'),
  opportunityError:  document.getElementById('opportunityError'),
  opportunitySaveBtn: document.getElementById('opportunitySaveBtn'),
  loseModal:         document.getElementById('loseModal'),
  loseReasonSelect:  document.getElementById('loseReasonSelect'),
  loseModalCancel:   document.getElementById('loseModalCancel'),
  loseModalConfirm:  document.getElementById('loseModalConfirm'),
  lossReasonsModal:  document.getElementById('lossReasonsModal'),
  lossReasonsClose:  document.getElementById('lossReasonsClose'),
  lossReasonsContent: document.getElementById('lossReasonsContent'),
  newLossReasonInput: document.getElementById('newLossReasonInput'),
  addLossReasonBtn:  document.getElementById('addLossReasonBtn'),
  // Flows
  flowsList:         document.getElementById('flowsList'),
  newFlowBtn:        document.getElementById('newFlowBtn'),
  manageGlobalVarsBtn: document.getElementById('manageGlobalVarsBtn'),
  flowModal:         document.getElementById('flowModal'),
  flowModalClose:    document.getElementById('flowModalClose'),
  flowForm:          document.getElementById('flowForm'),
  flowId:            document.getElementById('flowId'),
  flowName:          document.getElementById('flowName'),
  flowDescription:   document.getElementById('flowDescription'),
  flowKeywords:      document.getElementById('flowKeywords'),
  flowError:         document.getElementById('flowError'),
  flowSaveBtn:       document.getElementById('flowSaveBtn'),
  globalVarsModal:   document.getElementById('globalVarsModal'),
  globalVarsClose:   document.getElementById('globalVarsClose'),
  globalVarsList:    document.getElementById('globalVarsList'),
  newGlobalVarKey:   document.getElementById('newGlobalVarKey'),
  newGlobalVarValue: document.getElementById('newGlobalVarValue'),
  addGlobalVarBtn:   document.getElementById('addGlobalVarBtn'),
  // Settings
  tagsSettingsList:  document.getElementById('tagsSettingsList'),
  deptsSettingsList: document.getElementById('deptsSettingsList'),
  followupsList:     document.getElementById('followupsList'),
  addTagBtn:         document.getElementById('addTagBtn'),
  addDeptBtn:        document.getElementById('addDeptBtn'),
  addFollowupBtn:    document.getElementById('addFollowupBtn'),
  // Bulk transfer
  bulkTransferModal: document.getElementById('bulkTransferModal'),
  bulkTransferDeptSelect: document.getElementById('bulkTransferDeptSelect'),
  bulkTransferCancel: document.getElementById('bulkTransferCancel'),
  bulkTransferConfirm: document.getElementById('bulkTransferConfirm'),
  // Dashboard cards
  dashCardOpen:      document.getElementById('dashCardOpen'),
  dashCardFinalized: document.getElementById('dashCardFinalized'),
  overviewCardOpen:  document.getElementById('overviewCardOpen'),
  overviewCardAssumed: document.getElementById('overviewCardAssumed'),
};

// ---- Estado global ----
let workspaceState = {};
try { workspaceState = JSON.parse(BotWapStorage.session.get('bwap-workspace-state', '{}')) || {}; } catch { /* Ignora estado inválido da aba. */ }
let conversations    = {};
let activeTarget     = null;
let selectedNumber   = workspaceState.selectedNumber || null;
let botConnected     = false;
let selectedFile     = null;
let qrPollingTimer   = null;
let conversationFilter = workspaceState.conversationFilter || 'all';
let departmentFilter = workspaceState.departmentFilter || 'all';
let contacts         = [];
let activePage       = document.body.dataset.page || 'inbox';
let currentUser      = null;
let contactAlphaFilter = 'all';
let lastSyncAt       = 0;
let renderedChatNumber = null;
let renderedMsgCount = 0;
let allTags          = [];
let allDepartments   = [];
let bulkSelectedNumbers = new Set();
let bulkMode         = false;
let lossReasons      = [];
let emojiPickerOpen  = false;
const tablePages = {};
function persistWorkspaceState() {
  BotWapStorage.session.set('bwap-workspace-state', JSON.stringify({ selectedNumber, conversationFilter, departmentFilter }));
}

// =====================================================
// TEMA
// =====================================================
let savedTheme = 'dark';
savedTheme = BotWapStorage.local.get('bwap-theme', 'dark');
function applyTheme(name) {
  // Older saved palettes use the new dark identity.
  name = name === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.dataset.theme = name;
  BotWapStorage.local.set('bwap-theme', name);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.theme === name);
    b.setAttribute('aria-pressed', String(b.dataset.theme === name));
  });
}
applyTheme(savedTheme);

// =====================================================
// CONVERSAS: alias (LID <-> telefone) e placeholders
// =====================================================
function canonicalNumber(number) {
  const clean = normalizeNumber(number);
  if (!clean) return clean;
  if (conversations[clean] && !conversations[clean]._placeholder) return clean;
  for (const [key, convo] of Object.entries(conversations)) {
    if (!convo._placeholder && (convo.aliases || []).includes(clean)) return key;
  }
  return clean;
}

function adoptConversation(conversation) {
  if (!conversation || !conversation.number) return;
  const aliases = conversation.aliases || [];
  if (selectedNumber && selectedNumber !== conversation.number && aliases.includes(selectedNumber)) {
    selectedNumber = conversation.number;
  }
  aliases.forEach((alias) => {
    if (alias !== conversation.number && conversations[alias]?._placeholder) delete conversations[alias];
  });
  conversations[conversation.number] = conversation;
  if (activeTarget && aliases.includes(activeTarget)) activeTarget = conversation.number;
}

function dropStalePlaceholders() {
  Object.keys(conversations).forEach((key) => {
    if (conversations[key]?._placeholder && key !== selectedNumber) delete conversations[key];
  });
}

function reconcileSelection() {
  if (!selectedNumber) return;
  selectedNumber = canonicalNumber(selectedNumber);
  if (activeTarget) activeTarget = canonicalNumber(activeTarget);
}

// =====================================================
// MENSAGENS NA PÁGINA
// =====================================================
function pageWorkspace(page = activePage) {
  return document.querySelector(`[data-page-view="${page}"] .page-workspace`);
}

// Feedback stays in the page until dismissed or replaced by the next action.
function showToast(message, type = 'error') {
  const host = pageWorkspace();
  if (!host) return;
  let notice = host.querySelector('.page-notice');
  if (!notice) {
    notice = document.createElement('div');
    host.prepend(notice);
  }
  notice.className = `page-notice page-notice--${type}`;
  notice.setAttribute('role', 'status');
  notice.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'text-action';
  dismiss.textContent = 'Dispensar';
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(text, dismiss);
  notice.scrollIntoView({ block: 'nearest' });
}

function openInlinePanel(panel) {
  if (!panel) return;
  const host = panel.closest('.page-workspace') || pageWorkspace();
  if (!panel.closest('.page-workspace')) host.appendChild(panel);
  const page = host.closest('[data-page-view]').dataset.pageView;
  if (page !== activePage) showPage(page);
  panel.hidden = false;
  panel.scrollIntoView({ block: 'nearest' });
  const heading = panel.querySelector('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

async function saveResource(path, method, payload) {
  const res = await BotWapApi.checkedFetch(apiUrl(path), {
    method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível salvar. Tente novamente.');
  return data;
}

function reportPageError(error) {
  showToast(error?.message || 'N\u00e3o foi poss\u00edvel carregar os dados. Tente novamente.');
}

function runAction(action) {
  return async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try { await action(event); }
    catch (error) { reportPageError(error); }
    finally { button.disabled = false; }
  };
}

// A single, reusable form within each page; values survive validation errors.
function openInlineForm({ title, description = '', fields, onSave, saveText = 'Salvar' }) {
  const host = pageWorkspace();
  let panel = host.querySelector('.resource-editor');
  if (panel && !panel.hidden) {
    showToast('Conclua ou cancele o formulário aberto antes de iniciar outro cadastro.');
    panel.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (panel) panel.remove();
  panel = document.createElement('section');
  panel.className = 'inline-editor resource-editor';
  const fieldId = `editor-${activePage}`;
  panel.innerHTML = `<div class="editor-panel"><h2>${escapeHtml(title)}</h2>
    <p class="editor-description">${escapeHtml(description)}</p>
    <form class="profile-form" novalidate>
      ${fields.map((field) => `<div class="profile-field">
        <label for="${fieldId}-${field.name}">${escapeHtml(field.label)}</label>
        ${field.type === 'textarea'
          ? `<textarea id="${fieldId}-${field.name}" name="${field.name}" rows="3"></textarea>`
          : `<input id="${fieldId}-${field.name}" name="${field.name}" type="${field.type || 'text'}" />`}
      </div>`).join('')}
      <p class="profile-error" role="status" hidden></p>
      <div class="confirm-actions"><button type="button" class="confirm-cancel">Cancelar</button>
      <button type="submit" class="profile-save">${escapeHtml(saveText)}</button></div>
    </form></div>`;
  host.appendChild(panel);
  const form = panel.querySelector('form');
  const error = panel.querySelector('.profile-error');
  const submit = panel.querySelector('[type="submit"]');
  const cancel = panel.querySelector('.confirm-cancel');
  fields.forEach((field) => {
    const input = form.elements.namedItem(field.name);
    input.value = field.value ?? '';
    input.required = !!field.required;
    for (const attr of ['maxLength', 'min', 'max', 'step', 'placeholder', 'pattern']) {
      if (field[attr] !== undefined) input[attr] = field[attr];
    }
  });
  cancel.addEventListener('click', () => panel.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true;
    const values = Object.fromEntries(new FormData(form));
    for (const field of fields) {
      const input = form.elements.namedItem(field.name);
      values[field.name] = String(values[field.name]).trim();
      if ((field.required && !values[field.name]) || !input.validity.valid) {
        error.textContent = `Revise o campo “${field.label}”. ${input.validationMessage || 'Preencha este campo.'}`;
        error.hidden = false;
        input.focus();
        return;
      }
    }
    submit.disabled = cancel.disabled = true;
    submit.textContent = 'Salvando…';
    try {
      await onSave(values);
      panel.remove();
      showToast('Alterações salvas.', 'success');
    } catch (err) {
      error.textContent = err.message || 'Não foi possível salvar. Tente novamente.';
      error.hidden = false;
    } finally {
      submit.disabled = cancel.disabled = false;
      submit.textContent = saveText;
    }
  });
  openInlinePanel(panel);
  form.querySelector('input, textarea')?.focus({ preventScroll: true });
  return panel;
}

// =====================================================
// CONFIRMAÇÃO NA PÁGINA
// =====================================================
let cancelPendingConfirmation = null;
function showConfirm({ title = 'Confirmar ação', body = '', okText = 'Confirmar', okClass = '' } = {}) {
  cancelPendingConfirmation?.();
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmBody.textContent = body;
    els.confirmOk.textContent = okText;
    els.confirmOk.className = `confirm-ok ${okClass}`;
    pageWorkspace().appendChild(els.confirmModal);
    openInlinePanel(els.confirmModal);

    function cleanup(result) {
      els.confirmModal.hidden = true;
      els.confirmOk.removeEventListener('click', onOk);
      els.confirmCancel.removeEventListener('click', onCancel);
      cancelPendingConfirmation = null;
      resolve(result);
    }
    const onOk      = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    cancelPendingConfirmation = onCancel;

    els.confirmOk.addEventListener('click', onOk);
    els.confirmCancel.addEventListener('click', onCancel);
  });
}

// =====================================================
// AVATAR — cor por hash do número
// =====================================================
const AVATAR_COLORS = [
  ['#c2d8ce', '#2e4b40'],
  ['#c3d1e6', '#354960'],
  ['#e2d2b0', '#5c4725'],
  ['#d0c4e9', '#51416c'],
  ['#e9c3bd', '#683f39'],
  ['#b9d8d5', '#2f5350'],
  ['#edc8b1', '#664632'],
  ['#d5cedc', '#4e425c'],
];

function avatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function setAvatarEl(el, label) {
  if (!el) return;
  const initial = (label || '?').slice(0, 1).toUpperCase();
  const [bg, color] = avatarColor(label || '?');
  el.textContent = initial;
  el.style.background = bg;
  el.style.color = color;
}

// =====================================================
// TIMESTAMPS RELATIVOS
// =====================================================
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'agora';
  if (mins < 60)  return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)   return `${days}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// =====================================================
// RENDERIZAR STATUS DO BOT
// =====================================================
function renderStatus(status) {
  const connectionLabel = document.getElementById('topbarConnection');
  if (connectionLabel) connectionLabel.textContent = status.connected ? 'WhatsApp conectado' : 'WhatsApp desconectado';
  const connectionLink = connectionLabel?.closest('a');
  if (connectionLink) {
    connectionLink.setAttribute('aria-label', `${connectionLabel.textContent}. Gerenciar chips`);
    connectionLink.title = connectionLabel.textContent;
  }
  const online = !!status.connected;
  botConnected = online;

  els.connDot.className = 'brand-mark ' + (online ? 'online' : 'offline');

  const connLabel = status.needsNumber
    ? 'configure o número'
    : (online ? 'conectado' : 'desconectado');
  els.connText.textContent = connLabel;
  els.connText.className = 'conn-value ' + (online ? 'is-online' : 'is-offline');

  if (els.overviewStatus) {
    els.overviewStatus.textContent = online ? 'online' : 'aguardando QR';
    els.overviewStatus.className = online ? 'is-online' : 'is-offline';
  }

  const channelText = online ? 'online' : 'offline';
  if (els.overviewChannel) els.overviewChannel.textContent = channelText;
  if (els.overviewChannelCard) els.overviewChannelCard.textContent = channelText;

  if (els.overviewStatusPill) {
    els.overviewStatusPill.className = `status-pill ${online ? 'is-online' : 'is-offline'}`;
  }

  if (els.settingsConnection) {
    els.settingsConnection.textContent = online
      ? 'Conectado e pronto para atender.'
      : 'Desconectado. Escaneie o QR Code para reconectar.';
  }
  if (els.settingsQrHint) {
    els.settingsQrHint.hidden = online;
  }

  if (els.sendBtn) {
    els.sendBtn.disabled = !online;
    els.sendBtn.title = online ? 'Enviar' : 'Bot desconectado do WhatsApp';
  }
  if (els.composerInput) {
    els.composerInput.placeholder = status.needsNumber
      ? 'Configure o número WhatsApp no perfil…'
      : (online ? 'Escrever mensagem…' : 'Bot desconectado…');
    els.composerInput.disabled = !online;
  }

  if (!online && status.qr) {
    els.qrWrap.hidden = false;
    els.qrImage.src = status.qr;
  } else {
    els.qrWrap.hidden = true;
  }

  if (online || !els.qrWrap.hidden) stopQrPolling();
}

// =====================================================
// DADOS / FETCH
// =====================================================
async function refreshBotState() {
  const res = await fetch(apiUrl('/api/state'), { credentials: 'include' });
  if (res.status === 401) { Auth.redirectToLogin(); return; }
  if (!res.ok) return;
  const data = await res.json();
  applyServerState(data);
  renderOverview();
}

function applyServerState(data) {
  lastSyncAt = Date.now();
  const placeholder = selectedNumber && conversations[selectedNumber]?._placeholder
    ? conversations[selectedNumber]
    : null;

  // Detecta se a conversa selecionada mudou de conteúdo
  const prevMsgCount = selectedNumber ? (conversations[selectedNumber]?.messages?.length || 0) : 0;
  const prevConvoJson = selectedNumber ? JSON.stringify({
    blocked: conversations[selectedNumber]?.blocked,
    tags:    conversations[selectedNumber]?.tags,
    isFinalized: conversations[selectedNumber]?.isFinalized,
    assumed: selectedNumber === activeTarget,
  }) : '';

  conversations = data.conversations || {};
  activeTarget  = data.activeTarget || null;
  if (placeholder && !conversations[canonicalNumber(selectedNumber)]) {
    conversations[selectedNumber] = placeholder;
  }
  reconcileSelection();
  if (data.user) {
    currentUser = data.user;
    updateUserLabel(data.user, data.admin);
  }
  renderStatus(data.status || {});
  renderConvoList();

  // Só re-renderiza o chat se houve mudança real na conversa selecionada
  if (selectedNumber) {
    const newMsgCount = conversations[selectedNumber]?.messages?.length || 0;
    const newConvoJson = JSON.stringify({
      blocked: conversations[selectedNumber]?.blocked,
      tags:    conversations[selectedNumber]?.tags,
      isFinalized: conversations[selectedNumber]?.isFinalized,
      assumed: selectedNumber === activeTarget,
    });
    if (renderedChatNumber !== selectedNumber || newMsgCount !== prevMsgCount || newConvoJson !== prevConvoJson) {
      renderChat();
    } else {
      // Só atualiza o header (status de assumed/blocked muda no sidebar)
      updateChatHeader();
    }
  } else {
    renderChat();
  }
}

async function refreshContacts() {
  const res = await BotWapApi.checkedFetch(apiUrl('/api/contacts'), { credentials: 'include' });
  if (!res.ok) return;
  contacts = (await res.json()).contacts || [];
  renderContacts();
  renderOverview();
}

async function refreshTags() {
  const res = await BotWapApi.checkedFetch(apiUrl('/api/tags'), { credentials: 'include' });
  if (!res.ok) return;
  allTags = (await res.json()).tags || [];
  renderTagsSettings();
  window.AppCore?.ContactsPage?.render();
}

async function refreshDepartments() {
  const res = await BotWapApi.checkedFetch(apiUrl('/api/departments'), { credentials: 'include' });
  if (!res.ok) return;
  allDepartments = (await res.json()).departments || [];
  renderDepartmentsSettings();
  renderDepartmentFilter();
  renderChipDepartmentInput();
  window.AppCore?.ChipsPage?.render();
}

function renderDepartmentFilter() {
  const select = els.departmentFilter;
  if (!select) return;
  const valid = departmentFilter === 'all' || departmentFilter === 'none' || allDepartments.some((department) => String(department.id) === String(departmentFilter));
  if (!valid) departmentFilter = 'all';
  select.innerHTML = '<option value="all">Todos os departamentos</option><option value="none">Sem departamento</option>' + allDepartments
    .map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`).join('');
  select.value = departmentFilter;
}

function renderChipDepartmentInput() {
  const select = document.getElementById('chipDepartmentInput');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Selecione</option>' + allDepartments
    .map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`).join('');
  select.value = selected;
}

if (els.departmentFilter) {
  els.departmentFilter.addEventListener('change', () => {
    departmentFilter = els.departmentFilter.value || 'all';
    persistWorkspaceState();
    renderConvoList();
  });
}

async function refreshDashboardStats() {
  const res = await fetch(apiUrl('/api/dashboard/stats'), { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  if (els.overviewRevenue) els.overviewRevenue.textContent = `R$ ${(data.revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (els.overviewConversion) els.overviewConversion.textContent = `${data.conversionRate || 0}%`;
}

function updateUserLabel(user, admin) {
  if (!els.adminLabel) return;
  const name = user.displayName || user.username || 'admin';
  els.adminLabel.textContent = `${name} — ${admin || ''}`;
  els.adminLabel.title = els.adminLabel.textContent;
  const avatar = document.getElementById('accountAvatarBtn');
  if (avatar) avatar.textContent = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toLocaleUpperCase('pt-BR') || 'W';
  if (els.settingsProfileInfo) {
    const num = user.whatsappNumber ? formatWhatsappNumber(user.whatsappNumber) : 'não configurado';
    els.settingsProfileInfo.textContent = `${user.username} · ${num}`;
  }
}

// =====================================================
// QR POLLING
// =====================================================
function waitForQr() {
  stopQrPolling();
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    try { await refreshBotState(); } catch (err) { /* ignora */ }
    if (botConnected || attempts >= 25 || !els.qrWrap.hidden) {
      stopQrPolling();
      return;
    }
    qrPollingTimer = setTimeout(poll, 1500);
  };
  poll();
}

function stopQrPolling() {
  if (qrPollingTimer) { clearTimeout(qrPollingTimer); qrPollingTimer = null; }
}

// =====================================================
// RENDER MENSAGEM
// =====================================================
function renderMessage(msg) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (msg.from === 'admin' ? 'admin' : 'client');

  if (msg.type === 'image' && msg.mediaUrl) {
    const img = document.createElement('img');
    img.src = msg.mediaUrl;
    img.alt = msg.fileName || 'Imagem recebida';
    img.loading = 'lazy';
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `Ampliar ou reduzir: ${img.alt}`);
    img.setAttribute('aria-expanded', 'false');
    const toggleImage = () => img.setAttribute('aria-expanded', String(img.classList.toggle('is-expanded')));
    img.addEventListener('click', toggleImage);
    img.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleImage(); }
    });
    bubble.appendChild(img);
  } else if (msg.type === 'video' && msg.mediaUrl) {
    const video = document.createElement('video');
    video.src = msg.mediaUrl;
    video.controls = true;
    video.preload = 'metadata';
    bubble.appendChild(video);
  } else if (msg.type === 'audio' && msg.mediaUrl) {
    // Beautiful custom audio player
    const audioWrap = document.createElement('div');
    audioWrap.className = 'audio-player';
    const isFromAdmin = msg.from === 'admin';
    audioWrap.innerHTML = `
      <div class="audio-avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9A9 9 0 0 0 12 3zm-1 13V8l6 4z"/></svg>
      </div>
      <div class="audio-controls">
        <div class="audio-row">
          <button class="audio-play-btn" type="button" aria-label="Reproduzir">
            <svg class="icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            <svg class="icon-pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <div class="audio-progress-wrap">
            <div class="audio-waveform">${Array.from({length: 24}, (_, i) => `<span style="height:${8 + Math.sin(i * 0.7) * 6 + Math.random() * 6}px"></span>`).join('')}</div>
            <input type="range" class="audio-seekbar" min="0" max="100" value="0" step="0.1" />
          </div>
          <span class="audio-time">0:00</span>
        </div>
      </div>
    `;
    const audio = document.createElement('audio');
    audio.src = msg.mediaUrl;
    audio.preload = 'metadata';
    audioWrap.appendChild(audio);

    const playBtn  = audioWrap.querySelector('.audio-play-btn');
    const seekBar  = audioWrap.querySelector('.audio-seekbar');
    const timeEl   = audioWrap.querySelector('.audio-time');
    const iconPlay = audioWrap.querySelector('.icon-play');
    const iconPause= audioWrap.querySelector('.icon-pause');

    function fmtDur(s) {
      if (!isFinite(s)) return '0:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60).toString().padStart(2, '0');
      return `${m}:${sec}`;
    }
    audio.addEventListener('loadedmetadata', () => { timeEl.textContent = fmtDur(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) seekBar.value = (audio.currentTime / audio.duration) * 100;
      timeEl.textContent = audio.paused ? fmtDur(audio.duration) : fmtDur(audio.currentTime);
    });
    audio.addEventListener('play', () => { iconPlay.style.display = 'none'; iconPause.style.display = ''; audioWrap.classList.add('is-playing'); });
    audio.addEventListener('pause', () => { iconPlay.style.display = ''; iconPause.style.display = 'none'; audioWrap.classList.remove('is-playing'); });
    audio.addEventListener('ended', () => { iconPlay.style.display = ''; iconPause.style.display = 'none'; audioWrap.classList.remove('is-playing'); seekBar.value = 0; });
    playBtn.addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
    seekBar.addEventListener('input', () => { if (audio.duration) audio.currentTime = (seekBar.value / 100) * audio.duration; });
    bubble.appendChild(audioWrap);
  } else if (msg.type === 'document' && msg.mediaUrl) {
    const link = document.createElement('a');
    link.href = msg.mediaUrl;
    link.download = msg.fileName || 'documento';
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'document-link';
    link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(msg.fileName || 'Baixar documento')}`;
    bubble.appendChild(link);
  }

  const caption = msg.caption || msg.text;
  if (caption) {
    const text = document.createElement('div');
    text.className = 'bubble-text';
    text.textContent = caption;
    bubble.appendChild(text);
  }

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = formatTime(msg.at);
  bubble.appendChild(time);
  return bubble;
}

// =====================================================
// RENDER LISTA DE CONVERSAS
// =====================================================
function renderConvoList() {
  if (!els.convoList || !els.conversationSearch) return;
  const searchTerm = els.conversationSearch.value.trim().toLowerCase();
  const allNumbers = Object.keys(conversations);

  const numbers = [...allNumbers].sort((a, b) => {
    const ta = conversations[a].lastMessageAt || '';
    const tb = conversations[b].lastMessageAt || '';
    return tb.localeCompare(ta);
  }).filter((number) => {
    const convo = conversations[number] || {};
    if (convo._placeholder && number !== selectedNumber) return false;
    if (departmentFilter === 'none' && convo.departmentId) return false;
    if (departmentFilter !== 'all' && departmentFilter !== 'none' && String(convo.departmentId || '') !== String(departmentFilter)) return false;
    const visibleNumber = isInternalWhatsAppId(number, convo) ? '' : number;
    const haystack = `${convo.name || ''} ${visibleNumber} ${convo.lastMessage || ''}`.toLowerCase();
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);
    let matchesFilter = false;
    if (conversationFilter === 'all') {
      matchesFilter = !convo.blocked && !convo.isFinalized;
    } else if (conversationFilter === 'assumed') {
      matchesFilter = number === activeTarget;
    } else if (conversationFilter === 'blocked') {
      matchesFilter = convo.blocked;
    } else if (conversationFilter === 'finalized') {
      matchesFilter = convo.isFinalized;
    }
    return matchesSearch && matchesFilter;
  });

  els.convoCount.textContent = numbers.length;
  if (els.overviewConversations) {
    const openCount = allNumbers.filter((n) => !conversations[n]?.blocked && !conversations[n]?.isFinalized).length;
    els.overviewConversations.textContent = openCount;
  }
  if (els.overviewAssumed) els.overviewAssumed.textContent = allNumbers.filter((n) => n === activeTarget).length;
  els.convoList.innerHTML = '';

  if (numbers.length === 0) {
    const li = document.createElement('li');
    li.className = 'convo-empty';
    li.textContent = searchTerm
      ? 'Nenhuma conversa encontrada para essa busca.'
      : conversationFilter === 'finalized'
        ? 'Nenhuma conversa finalizada.'
        : 'Nenhuma conversa ainda. Mensagens de clientes aparecerão aqui.';
    els.convoList.appendChild(li);
    return;
  }

  numbers.forEach((number) => {
    const convo = conversations[number] || { number, messages: [] };
    const li = document.createElement('li');
    li.className = 'convo-item';
    if (number === selectedNumber) li.classList.add('active');
    if (number === activeTarget)   li.classList.add('assumed');
    if (convo.blocked) li.classList.add('blocked');
    if (convo.isFinalized) li.classList.add('finalized');
    if (bulkMode && bulkSelectedNumbers.has(number)) li.classList.add('bulk-selected');

    const displayName = conversationDisplayName(number, convo);
    const [bg, color] = avatarColor(displayName);
    const isAssumed = number === activeTarget;
    const departmentName = allDepartments.find((department) => String(department.id) === String(convo.departmentId))?.name;
    const tags = convo.tags || [];
    const tagPills = tags.slice(0, 2).map((t) => {
      const tagObj = allTags.find((tag) => tag.name === t);
      const tagColor = tagObj?.color || '#5c8df6';
      return `<span class="convo-tag-pill" style="background:${tagColor}22;color:${tagColor};border-color:${tagColor}44">${escapeHtml(t)}</span>`;
    }).join('');

    li.innerHTML = `
      ${bulkMode ? `<span class="bulk-checkbox ${bulkSelectedNumbers.has(number) ? 'is-checked' : ''}"></span>` : ''}
      <span class="convo-avatar" style="background:${bg};color:${color}">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</span>
      <div class="convo-body">
        <div class="convo-header-row">
          <span class="convo-name">${escapeHtml(displayName)}</span>
          <span class="convo-time">${formatRelativeTime(convo.lastMessageAt)}</span>
        </div>
        <div class="convo-footer-row">
          ${isAssumed ? '<span class="convo-assumed-dot"></span>' : ''}
          <span class="convo-preview">${escapeHtml(convo.lastMessage || 'Sem mensagens')}</span>
          ${convo.blocked ? '<span class="convo-badge">bloqueado</span>' : ''}
          ${convo.isFinalized ? '<span class="convo-badge convo-badge--finalized">finalizada</span>' : ''}
        </div>
        ${departmentName ? `<div class="convo-tags-row"><span class="convo-department-pill">${escapeHtml(departmentName)}</span></div>` : ''}
        ${tagPills ? `<div class="convo-tags-row">${tagPills}</div>` : ''}
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (bulkMode) {
        e.stopPropagation();
        if (bulkSelectedNumbers.has(number)) {
          bulkSelectedNumbers.delete(number);
        } else {
          bulkSelectedNumbers.add(number);
        }
        updateBulkBar();
        renderConvoList();
        return;
      }
      selectConversation(number);
    });

    els.convoList.appendChild(li);
  });
}

// =====================================================
// BULK MODE
// =====================================================
function enterBulkMode() {
  bulkMode = true;
  bulkSelectedNumbers.clear();
  updateBulkBar();
  renderConvoList();
}

function exitBulkMode() {
  bulkMode = false;
  bulkSelectedNumbers.clear();
  if (els.bulkBar) els.bulkBar.hidden = true;
  renderConvoList();
}

function updateBulkBar() {
  if (!els.bulkBar) return;
  const count = bulkSelectedNumbers.size;
  if (count > 0) {
    els.bulkBar.hidden = false;
    if (els.bulkCount) els.bulkCount.textContent = `${count} selecionada${count !== 1 ? 's' : ''}`;
  } else {
    els.bulkBar.hidden = true;
  }
}

if (els.bulkCancelBtn) els.bulkCancelBtn.addEventListener('click', exitBulkMode);

if (els.bulkTagsBtn) {
  els.bulkTagsBtn.addEventListener('click', () => {
    if (bulkSelectedNumbers.size === 0) {
      showToast('Selecione pelo menos uma conversa.', 'error');
      return;
    }
    openTagsModal(null, true);
  });
}

if (els.bulkTransferBtn) {
  els.bulkTransferBtn.addEventListener('click', async () => {
    if (bulkSelectedNumbers.size === 0) {
      showToast('Selecione pelo menos uma conversa.', 'error');
      return;
    }
    // Populate departments select
    if (els.bulkTransferDeptSelect) {
      els.bulkTransferDeptSelect.innerHTML = '<option value="">Selecione um departamento…</option>' +
        allDepartments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    }
    openInlinePanel(els.bulkTransferModal);
  });
}

if (els.bulkTransferCancel) {
  els.bulkTransferCancel.addEventListener('click', () => { els.bulkTransferModal.hidden = true; });
}

if (els.bulkTransferConfirm) {
  els.bulkTransferConfirm.addEventListener('click', async () => {
    const deptId = els.bulkTransferDeptSelect?.value;
    if (!deptId) {
      showToast('Selecione um departamento.', 'error');
      return;
    }
    const transferResponse = await fetch(apiUrl('/api/conversations/bulk-department'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ numbers: [...bulkSelectedNumbers], departmentId: deptId }),
    });
    const transferResult = await transferResponse.json();
    if (!transferResponse.ok) {
      showToast(transferResult.error || 'Erro ao transferir conversas.', 'error');
      return;
    }
    for (const conversation of Object.values(conversations)) {
      if (bulkSelectedNumbers.has(conversation.number)) conversation.departmentId = Number(deptId);
    }
    showToast(`✅ ${bulkSelectedNumbers.size} conversa(s) transferidas para o departamento selecionado.`, 'success');
    els.bulkTransferModal.hidden = true;
    exitBulkMode();
  });
}

// =====================================================
// RENDER OVERVIEW PAGE
// =====================================================
function renderOverview() {
  AppCore.DashboardPage?.render();
}

// =====================================================
// CLICKABLE DASHBOARD CARDS
// =====================================================
function setupDashboardCardClicks() {
  AppCore.DashboardPage?.init();
}

// =====================================================
// RENDER CONTACTS PAGE
// =====================================================
function renderContacts() {
  AppCore.ContactsPage?.render();
  const term = (els.contactSearch?.value || '').trim().toLowerCase();

  let filtered = contacts.filter((c) =>
    `${c.name} ${c.pushName} ${isInternalWhatsAppId(c.number, c) ? '' : c.number}`.toLowerCase().includes(term)
  );

  if (contactAlphaFilter !== 'all') {
    filtered = filtered.filter((c) => {
      const first = (c.name || c.pushName || (isInternalWhatsAppId(c.number, c) ? 'Contato sem nome' : c.number) || '').slice(0, 1).toUpperCase();
      if (contactAlphaFilter === '0-9') return /^[0-9]/.test(first);
      const [start, end] = contactAlphaFilter.split('-');
      return first >= start && first <= end;
    });
  }

  if (els.contactsCount) els.contactsCount.textContent = `${filtered.length} contato${filtered.length === 1 ? '' : 's'}`;

  if (!els.contactsGrid) return;

  els.contactsGrid.innerHTML = filtered.length
    ? filtered.map((c) => {
        const displayName = c.name || c.pushName || 'Sem nome';
        const [bg, color] = avatarColor(c.number || displayName);
        const lastSeen = c.lastSeenAt ? `visto ${formatRelativeTime(c.lastSeenAt)}` : 'contato salvo';
        const tags = (c.tags || []).map((t) => {
          const tagObj = allTags.find((tag) => tag.name === t);
          const tagColor = tagObj?.color || '#5c8df6';
          return `<span class="tag-pill" style="background:${tagColor}22;color:${tagColor};border-color:${tagColor}44">${escapeHtml(t)}</span>`;
        }).join('');
        return `
          <article class="contact-card">
            <span class="contact-avatar" style="background:${bg};color:${color}">${escapeHtml((displayName).slice(0,1).toUpperCase())}</span>
            <div>
              <strong>${escapeHtml(displayName)}</strong>
              <small>${isInternalWhatsAppId(c.number, c) ? 'Telefone não identificado' : escapeHtml(c.number)}</small>
              <small>${escapeHtml(lastSeen)}</small>
              ${tags ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${tags}</div>` : ''}
            </div>
            <button class="contact-action" type="button" data-number="${escapeHtml(c.number)}" title="Abrir atendimento">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </article>`;
      }).join('')
    : '<p class="panel-empty">Nenhum contato encontrado.</p>';

  els.contactsGrid.querySelectorAll('[data-number]').forEach((btn) =>
    btn.addEventListener('click', () => {
      openConversation(btn.dataset.number);
    })
  );
}

// =====================================================
// ROUTING — URLs reais por página (History API)
// =====================================================
const chipsPageHost = document.getElementById('chipsPageHost');
const tagsPageHost = document.getElementById('tagsPageHost');
const departmentsPageHost = document.getElementById('departmentsPageHost');
const chipsGroup = document.getElementById('chipsGroup');
const tagsGroup = document.getElementById('tagsGroup');
const departmentsGroup = document.getElementById('departmentsGroup');
if (chipsPageHost && chipsGroup) chipsPageHost.appendChild(chipsGroup);
if (tagsPageHost && tagsGroup) tagsPageHost.appendChild(tagsGroup);
if (departmentsPageHost && departmentsGroup) departmentsPageHost.appendChild(departmentsGroup);

// Each page owns its forms and feedback; opening a form never covers the screen.
document.querySelectorAll('[data-page-view]').forEach((view) => {
  const host = document.createElement('div');
  host.className = 'page-workspace';
  const heading = view.querySelector('.page-heading, .chat-header');
  if (heading) heading.after(host);
  else view.prepend(host);
});
const editorPages = {
  profileModal: 'settings', tagsModal: 'inbox', bulkTransferModal: 'inbox',
  campaignModal: 'campaigns', webhookModal: 'webhooks',
  opportunityModal: 'kanban', loseModal: 'kanban', lossReasonsModal: 'kanban',
  flowModal: 'flows', globalVarsModal: 'flows',
};
Object.entries(editorPages).forEach(([id, page]) => {
  const host = pageWorkspace(page);
  const editor = document.getElementById(id);
  if (host && editor) host.appendChild(editor);
});

// Validation errors also stay inside the form, without browser bubbles.
document.querySelectorAll('.inline-editor form').forEach((form) => {
  form.noValidate = true;
  form.addEventListener('submit', (event) => {
    const invalid = [...form.elements].find((input) => input.willValidate && !input.validity.valid);
    if (!invalid) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const error = form.querySelector('.profile-error');
    const label = invalid.labels?.[0]?.textContent || 'Campo';
    if (error) {
      error.textContent = `${label.trim()}: ${invalid.validationMessage}`;
      error.hidden = false;
      error.setAttribute('role', 'status');
    }
    invalid.focus();
  }, true);
});

const PAGE_ROUTES = {
  atendimento:   '/atendimento',
  overview:      '/dashboard',
  kanban:        '/funis',
  campaigns:     '/campanhas',
  flows:         '/fluxos',
  contacts:      '/contatos',
  webhooks:      '/webhooks',
  departments:   '/departamentos',
  tags:          '/tags',
  chips:         '/chips',
  settings:      '/configuracoes',
  inbox:         '/atendimento', // alias
};

const ROUTE_TO_PAGE = {
  '/atendimento':   'inbox',
  '/dashboard':     'overview',
  '/kanban':        'kanban',
  '/funis':         'kanban',
  '/campanhas':     'campaigns',
  '/fluxos':        'flows',
  '/contatos':      'contacts',
  '/webhooks':      'webhooks',
  '/departamentos': 'departments',
  '/tags':          'tags',
  '/chips':         'chips',
  '/configuracoes': 'settings',
  '/dashboard.html':'inbox',
};

function detectPageFromURL() {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  return ROUTE_TO_PAGE[path] || document.body.dataset.page || 'inbox';
}

function showPage(page, pushState = true) {
  // inbox e atendimento são o mesmo
  if (page === 'atendimento') page = 'inbox';
  const destination = PAGE_ROUTES[page];
  if (!destination) return;

  if (!document.querySelector(`[data-page-view="${page}"]`)) {
    persistWorkspaceState();
    window.location.assign(destination);
    return;
  }

  if (page !== activePage) cancelPendingConfirmation?.();
  activePage = page;
  document.querySelector('.app').classList.toggle('app--management', page !== 'inbox');
  const pageLabel = document.querySelector(`[data-page-view="${page}"] .page-heading h2`);
  document.getElementById('currentPageLabel').textContent = page === 'inbox' ? 'Atendimento' : pageLabel?.textContent || 'Convelya';

  document.querySelectorAll('[data-page-view]').forEach((view) => {
    const isActive = view.dataset.pageView === page;
    view.classList.toggle('is-active', isActive);
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    const itemPage = item.dataset.page === 'atendimento' ? 'inbox' : item.dataset.page;
    item.classList.toggle('is-active', itemPage === page);
    if (itemPage === page) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  if (els.inboxTools) els.inboxTools.style.display = page === 'inbox' ? '' : 'none';
  if (els.inboxConvoHeader) els.inboxConvoHeader.style.display = page === 'inbox' ? '' : 'none';

  // Update URL
  if (pushState) {
    const url = destination;
    if (window.location.pathname !== url) {
      window.history.pushState({ page }, '', url);
    }
    // Update page <title>
    const titles = {
      inbox:    'Atendimento — Convelya',
      overview: 'Dashboard — Convelya',
      kanban:   'Funis — Convelya',
      campaigns:'Campanhas — Convelya',
      flows:    'Fluxos — Convelya',
      contacts: 'Contatos — Convelya',
      webhooks: 'Webhooks — Convelya',
      departments: 'Departamentos — Convelya',
      tags: 'Tags e rótulos — Convelya',
      chips: 'Meus chips — Convelya',
      settings: 'Configurações — Convelya',
    };
    document.title = titles[page] || 'Convelya';
  }

  if (page === 'contacts')  refreshContacts().catch(reportPageError);
  if (page === 'overview')  { renderOverview(); refreshDashboardStats().catch(reportPageError); }
  if (page === 'campaigns') AppCore.CampaignsPage?.init().catch(reportPageError);
  if (page === 'webhooks')  AppCore.WebhooksPage?.init().catch(reportPageError);
  if (page === 'kanban')    AppCore.KanbanPage?.init().catch(reportPageError);
  if (page === 'flows')     AppCore.FlowsPage?.init().catch(reportPageError);
  if (page === 'tags')      refreshTags().catch(reportPageError);
  if (page === 'departments') refreshDepartments().catch(reportPageError);
  if (page === 'chips')     { AppCore.ChipsPage?.init().catch(reportPageError); refreshDepartments().catch(reportPageError); }
  if (page === 'settings')  {
    refreshTags().catch(reportPageError);
    refreshDepartments().catch(reportPageError);
    AppCore.ChipsPage?.init().catch(reportPageError);
    AppCore.SettingsPage?.loadFollowups().catch(reportPageError);
  }
}

// Browser back/forward navigation
window.addEventListener('popstate', () => {
  showPage(detectPageFromURL(), false);
});

// =====================================================
// RENDER CHAT
// =====================================================
function updateChatHeader() {
  if (!selectedNumber || !els.chatTitle) return;
  const convo = conversations[selectedNumber] || { number: selectedNumber, messages: [], blocked: false };
  const isAssumed = selectedNumber === activeTarget;
  const contactName = conversationDisplayName(selectedNumber, convo);
  const visibleNumber = isInternalWhatsAppId(selectedNumber, convo) ? '' : selectedNumber;
  const isBlocked = !!convo.blocked;
  const isFinalized = !!convo.isFinalized;

  els.chatTitle.textContent = contactName;
  els.chatSub.textContent = isFinalized
    ? `finalizada · ${selectedNumber}`
    : isBlocked
      ? `bloqueado · ${selectedNumber} · mensagens ignoradas`
      : isAssumed
        ? `você assumiu esta conversa · ${selectedNumber}`
        : `${selectedNumber} · assuma a conversa para responder`;

  if (!visibleNumber) {
    els.chatSub.textContent = els.chatSub.textContent
      .replaceAll(selectedNumber, '')
      .replace(/\s*·\s*/g, ' ')
      .trim();
  }
  if (els.chatAvatar) setAvatarEl(els.chatAvatar, contactName);
  // Profile photo from WhatsApp
  if (els.chatAvatarPhoto) {
    const profilePic = convo.profilePic || '';
    if (profilePic) {
      els.chatAvatarPhoto.src = profilePic;
      els.chatAvatarPhoto.style.display = '';
      els.chatAvatarPhoto.onerror = () => { els.chatAvatarPhoto.style.display = 'none'; };
    } else {
      els.chatAvatarPhoto.style.display = 'none';
    }
  }

  els.assumeBtn.hidden = false;
  els.assumeBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    ${isAssumed ? 'conversa assumida' : 'assumir conversa'}
  `;
  els.assumeBtn.className = 'assume-btn' + (isAssumed ? ' is-assumed' : '');

  els.blockBtn.hidden = false;
  els.blockBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
    <span>${isBlocked ? 'desbloquear' : 'bloquear'}</span>
  `;
  els.blockBtn.classList.toggle('is-blocked', isBlocked);

  els.tagsBtn.hidden = false;
  els.finalizeBtn.hidden = false;
  els.finalizeBtn.innerHTML = isFinalized
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg> <span>reabrir</span>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> <span>finalizar</span>`;

  els.clearBtn.hidden  = false;
  els.deleteBtn.hidden = false;
  els.composer.hidden  = false;

  const tags = convo.tags || [];
  if (els.activeTagsRow) {
    if (tags.length > 0) {
      els.activeTagsRow.hidden = false;
      if (els.activeTagsPills) {
        els.activeTagsPills.innerHTML = tags.map((t) => {
          const tagObj = allTags.find((tag) => tag.name === t);
          const tagColor = tagObj?.color || '#5c8df6';
          return `<span class="tag-pill" style="background:${tagColor}22;color:${tagColor};border-color:${tagColor}44">${escapeHtml(t)}</span>`;
        }).join('');
      }
    } else {
      els.activeTagsRow.hidden = true;
    }
  }
}

function renderChat() {
  if (!els.chatLog) return;
  if (!selectedNumber) {
    renderedChatNumber = null;
    renderedMsgCount = 0;
    els.chatTitle.textContent = 'Selecione uma conversa';
    els.chatSub.textContent = 'as mensagens aparecem aqui em tempo real';
    if (els.chatAvatar) { els.chatAvatar.textContent = ''; els.chatAvatar.style.background = ''; }
    els.assumeBtn.hidden = true;
    els.blockBtn.hidden  = true;
    els.clearBtn.hidden  = true;
    els.deleteBtn.hidden = true;
    els.tagsBtn.hidden   = true;
    els.finalizeBtn.hidden = true;
    els.composer.hidden  = true;
    if (els.activeTagsRow) els.activeTagsRow.hidden = true;
    els.chatLog.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <p>Nenhuma conversa selecionada</p>
        <p class="empty-sub">Mensagens de clientes vão aparecer na lista à esquerda assim que chegarem.</p>
      </div>
    `;
    return;
  }

  const convo = conversations[selectedNumber] || { number: selectedNumber, messages: [], blocked: false };
  const isAssumed = selectedNumber === activeTarget;
  updateChatHeader();

  const log = els.chatLog;
  const switched = renderedChatNumber !== selectedNumber || (convo.messages || []).length < renderedMsgCount;

  if (switched) {
    // Troca de conversa: limpa e renderiza do zero
    log.innerHTML = '';
    renderedChatNumber = selectedNumber;
    renderedMsgCount = 0;
  }

  const msgs = convo.messages || [];
  const alreadyRendered = switched ? 0 : (renderedMsgCount || 0);
  const newMsgs = msgs.slice(alreadyRendered);

  if (newMsgs.length === 0 && !switched) {
    // Nada novo: não pisca, não faz nada
    return;
  }

  const wasNearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const previousScroll = log.scrollTop;

  if (switched && msgs.length === 0) {
    log.innerHTML = `<div class="empty-state" style="height:100%">
      <div class="empty-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <p>Sem mensagens ainda</p>
    </div>`;
    renderedMsgCount = 0;
    return;
  }

  // Adiciona apenas as novas mensagens (sem piscar)
  log.querySelector('.empty-state')?.remove();
  const frag = document.createDocumentFragment();
  newMsgs.forEach((msg) => frag.appendChild(renderMessage(msg)));
  log.appendChild(frag);
  renderedMsgCount = msgs.length;

  log.scrollTop = (switched || wasNearBottom) ? log.scrollHeight : previousScroll;
}

// =====================================================
// UTILITIES
// =====================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizeNumber(value) {
  if (!value) return '';
  return value.toString().replace(/\D/g, '');
}

function isInternalWhatsAppId(number, conversationOrContact = {}) {
  const jid = conversationOrContact.jid || '';
  // WhatsApp LIDs normally appear as internal IDs with 14 or more digits.
  return jid.endsWith('@lid') || (!jid.endsWith('@s.whatsapp.net') && /^\d{14,}$/.test(normalizeNumber(number)));
}

function conversationDisplayName(number, conversation = {}) {
  return conversation.name || (isInternalWhatsAppId(number, conversation) ? 'Contato sem nome' : number);
}

function openConversation(number) {
  cancelPendingConfirmation?.();
  if (els.tagsModal) els.tagsModal.hidden = true;
  if (els.bulkTransferModal) els.bulkTransferModal.hidden = true;
  const clean = normalizeNumber(number);
  if (!clean) {
    showToast('Digite um número válido para abrir a conversa.', 'error');
    return;
  }
  selectedNumber = canonicalNumber(clean);
  persistWorkspaceState();
  if (!els.chatLog) {
    window.location.assign(PAGE_ROUTES.inbox);
    return;
  }
  if (!conversations[selectedNumber]) {
    conversations[selectedNumber] = { number: selectedNumber, name: '', blocked: false, messages: [], _placeholder: true };
  }
  dropStalePlaceholders();
  renderConvoList();
  renderChat();
  els.composerInput.focus();
}

function selectConversation(number) {
  cancelPendingConfirmation?.();
  if (els.tagsModal) els.tagsModal.hidden = true;
  if (els.bulkTransferModal) els.bulkTransferModal.hidden = true;
  selectedNumber = number;
  persistWorkspaceState();
  dropStalePlaceholders();
  renderConvoList();
  renderChat();
}

// =====================================================
// TAGS DA CONVERSA
// =====================================================
function openTagsModal(number, isBulk = false) {
  const targetNumber = number || selectedNumber;
  const currentTags = isBulk ? [] : (conversations[targetNumber]?.tags || []);

  if (!els.tagsModal || !els.tagsModalContent) return;

  els.tagsModalContent.innerHTML = `
    <p style="font-size:12px;color:var(--text-dim);margin:0 0 14px">
      ${isBulk ? `Aplicar tags às ${bulkSelectedNumbers.size} conversas selecionadas.` : 'Selecione as tags desta conversa.'}
    </p>
    <div class="tags-picker-full">
      ${allTags.length === 0
        ? '<p style="color:var(--text-faint);font-size:12px">Nenhuma tag criada ainda. Vá em Tags e rótulos no menu lateral.</p>'
        : allTags.map((tag) => {
            const isActive = isBulk ? false : currentTags.includes(tag.name);
            return `<button type="button" class="tag-toggle-btn ${isActive ? 'is-active' : ''}" data-tag="${escapeHtml(tag.name)}" style="--tag-color:${tag.color}">
              <span class="tag-toggle-dot" style="background:${tag.color}"></span>
              ${escapeHtml(tag.name)}
            </button>`;
          }).join('')}
    </div>
  `;

  openInlinePanel(els.tagsModal);

  // Toggle tag buttons
  els.tagsModalContent.querySelectorAll('.tag-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('is-active'));
  });

  els.tagsModalSave.onclick = async () => {
    const selected = [...els.tagsModalContent.querySelectorAll('.tag-toggle-btn.is-active')]
      .map((b) => b.dataset.tag);

    if (isBulk) {
      const action = selected.length > 0 ? 'add' : 'set';
      try {
        await fetch(apiUrl('/api/conversations/bulk-tags'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ numbers: [...bulkSelectedNumbers], tags: selected, action }),
        });
        showToast(`✅ Tags aplicadas a ${bulkSelectedNumbers.size} conversa(s).`, 'success');
        els.tagsModal.hidden = true;
        exitBulkMode();
      } catch (err) {
        showToast('Erro ao aplicar tags.', 'error');
      }
    } else {
      try {
        const res = await fetch(apiUrl(`/api/conversation/${targetNumber}/tags`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tags: selected }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        adoptConversation(data.conversation);
        renderConvoList();
        renderChat();
        showToast('✅ Tags atualizadas.', 'success');
        els.tagsModal.hidden = true;
      } catch (err) {
        showToast(err.message || 'Erro ao salvar tags.', 'error');
      }
    }
  };
}

if (els.tagsBtn) els.tagsBtn.addEventListener('click', () => openTagsModal(selectedNumber));
if (els.tagsModalClose) els.tagsModalClose.addEventListener('click', () => { els.tagsModal.hidden = true; });
if (els.tagsModalClose2) els.tagsModalClose2.addEventListener('click', () => { els.tagsModal.hidden = true; });

// =====================================================
// EVENT LISTENERS — AÇÕES DO CHAT
// =====================================================
els.newChatBtn?.addEventListener('click', () => {
  openConversation(els.newChatInput.value);
  els.newChatInput.value = '';
});

els.newChatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.newChatBtn.click(); }
});

// Navegação entre páginas
document.querySelectorAll('.nav-item, [data-page-link]').forEach((btn) =>
  btn.addEventListener('click', (event) => {
    if (btn.matches('a[href]')) {
      persistWorkspaceState();
      return; // Let the browser follow the server route, including modified clicks.
    }
    event.preventDefault();
    showPage(btn.dataset.page || btn.dataset.pageLink);
  })
);

if (els.contactSearch) els.contactSearch.addEventListener('input', renderContacts);

document.querySelectorAll('.alpha-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.alpha-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    contactAlphaFilter = btn.dataset.alpha;
    renderContacts();
  });
});

if (els.settingsDisconnect) els.settingsDisconnect.addEventListener('click', () => els.disconnectBtn.click());
if (els.settingsProfile)    els.settingsProfile.addEventListener('click', () => openProfile());
if (els.settingsLogout)     els.settingsLogout.addEventListener('click', () => document.getElementById('logoutBtn').click());

els.conversationSearch?.addEventListener('input', renderConvoList);

els.filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    conversationFilter = btn.dataset.filter;
    persistWorkspaceState();
    els.filterButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    renderConvoList();
  });
});

// Long press on conversation filter to enter bulk mode
let bulkEnterTimer = null;
if (els.conversationSearch) {
  els.conversationSearch.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    enterBulkMode();
  });
}

// Atalho de teclado /
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    els.conversationSearch.focus();
  }
  if (e.key === 'Escape' && document.activeElement === els.conversationSearch) {
    els.conversationSearch.value = '';
    renderConvoList();
    els.conversationSearch.blur();
  }
  if (e.key === 'Escape' && !els.confirmModal.hidden) {
    cancelPendingConfirmation?.();
  }
  if (e.key === 'Escape' && bulkMode) {
    exitBulkMode();
  }
});

// =====================================================
// ATTACH / FILE
// =====================================================
els.attachBtn?.addEventListener('click', () => {
  if (selectedFile) {
    clearFile();
    return;
  }
  els.fileInput.click();
});

function clearFile() {
  selectedFile = null;
  els.fileInput.value = '';
  els.attachBtn.classList.remove('has-file');
  els.filePreview.hidden = true;
}

els.removeFileBtn?.addEventListener('click', clearFile);

els.fileInput?.addEventListener('change', () => {
  selectedFile = els.fileInput.files[0] || null;
  if (selectedFile) {
    els.attachBtn.classList.add('has-file');
    els.filePreviewName.textContent = selectedFile.name;
    els.filePreview.hidden = false;
  } else {
    clearFile();
  }
});

// =====================================================
// ASSUMIR CONVERSA
// =====================================================
els.assumeBtn?.addEventListener('click', async () => {
  if (!selectedNumber) return;
  const isAssumed = selectedNumber === activeTarget;
  await fetch(apiUrl('/api/assumir'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ number: isAssumed ? null : selectedNumber }),
  });
});

// =====================================================
// FINALIZAR / REABRIR CONVERSA
// =====================================================
if (els.finalizeBtn) {
  els.finalizeBtn.addEventListener('click', async () => {
    if (!selectedNumber) return;
    const convo = conversations[selectedNumber];
    const isFinalized = !!convo?.isFinalized;
    const action = isFinalized ? 'reopen' : 'finalize';
    const label = isFinalized ? 'Reabrir conversa' : 'Finalizar conversa';

    const ok = await showConfirm({
      title: label,
      body: isFinalized
        ? `Reabrir a conversa com ${conversationDisplayName(selectedNumber, convo || {})}?`
        : `Finalizar a conversa com ${conversationDisplayName(selectedNumber, convo || {})}? A conversa ficará na aba de finalizadas.`,
      okText: isFinalized ? 'Reabrir' : 'Finalizar',
    });
    if (!ok) return;

    try {
      const res = await fetch(apiUrl(`/api/conversation/${selectedNumber}/${action}`), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      adoptConversation(data.conversation);
      showToast(isFinalized ? '✅ Conversa reaberta.' : '✅ Conversa finalizada.', 'success');
      renderConvoList();
      renderChat();
    } catch (err) {
      showToast(err.message || 'Erro ao alterar status da conversa.', 'error');
    }
  });
}

// =====================================================
// BLOQUEAR
// =====================================================
els.blockBtn?.addEventListener('click', async () => {
  if (!selectedNumber) return;
  const convo = conversations[selectedNumber] || { blocked: false };
  const blocked = !convo.blocked;

  els.blockBtn.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/conversation/block'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber, blocked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível atualizar o bloqueio.');
    adoptConversation(data.conversation);
    showToast(blocked ? '🚫 Conversa bloqueada.' : '✅ Conversa desbloqueada.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao bloquear a conversa.', 'error');
  } finally {
    els.blockBtn.disabled = false;
  }
});

// =====================================================
// LIMPAR HISTÓRICO
// =====================================================
els.clearBtn?.addEventListener('click', async () => {
  if (!selectedNumber) return;

  const ok = await showConfirm({
    title: 'Limpar histórico',
    body: `Apagar todas as mensagens da conversa com ${conversationDisplayName(selectedNumber, conversations[selectedNumber] || {})}? Esta ação não pode ser desfeita.`,
    okText: 'Limpar',
  });
  if (!ok) return;

  els.clearBtn.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/conversation/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível limpar a conversa.');
    adoptConversation(data.conversation);
    showToast('🧹 Histórico limpo.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao limpar a conversa.', 'error');
  } finally {
    els.clearBtn.disabled = false;
  }
});

// =====================================================
// APAGAR CONVERSA
// =====================================================
els.deleteBtn?.addEventListener('click', async () => {
  if (!selectedNumber) return;

  const ok = await showConfirm({
    title: 'Apagar conversa',
    body: `Apagar permanentemente a conversa com ${conversationDisplayName(selectedNumber, conversations[selectedNumber] || {})}?`,
    okText: 'Apagar',
  });
  if (!ok) return;

  els.deleteBtn.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/conversation/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível apagar a conversa.');
    if (data.conversation?.blocked) {
      conversations[selectedNumber] = data.conversation;
    } else {
      delete conversations[selectedNumber];
    }
    if (selectedNumber === activeTarget) activeTarget = null;
    selectedNumber = null;
    showToast('🗑️ Conversa apagada.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao apagar a conversa.', 'error');
  } finally {
    els.deleteBtn.disabled = false;
  }
});

// =====================================================
// COMPOSER — ENVIO
// =====================================================
els.composerInput?.addEventListener('input', () => {
  els.composerInput.style.height = 'auto';
  els.composerInput.style.height = Math.min(els.composerInput.scrollHeight, 120) + 'px';
});

els.composerInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.composerInput.value.trim();
  if ((!text && !selectedFile) || !selectedNumber) return;

  if (!botConnected) {
    showToast('❌ Bot desconectado. Conecte o WhatsApp antes de enviar.', 'error');
    return;
  }

  if (els.sendBtn) els.sendBtn.disabled = true;
  els.composerInput.disabled = true;

  const fileToSend = selectedFile;
  const textToSend = text;
  els.composerInput.value = '';
  els.composerInput.style.height = 'auto';

  try {
    const request = fileToSend
      ? (() => {
          const formData = new FormData();
          formData.append('number', selectedNumber);
          formData.append('caption', textToSend);
          formData.append('file', fileToSend);
          return fetch(apiUrl('/api/reply-media'), { method: 'POST', body: formData, credentials: 'include' });
        })()
      : fetch(apiUrl('/api/reply'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ number: selectedNumber, text: textToSend }),
        });

    const res = await request;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(`❌ ${data.error || `Erro ${res.status} ao enviar.`}`, 'error');
      els.composerInput.value = textToSend;
      return;
    }

    const data = await res.json();
    if (data.conversation) {
      adoptConversation(data.conversation);
      renderConvoList();
      renderChat();
    }
    clearFile();
  } catch (err) {
    showToast('❌ Falha de rede ao enviar mensagem.', 'error');
    els.composerInput.value = textToSend;
  } finally {
    els.composerInput.disabled = !botConnected;
    if (els.sendBtn) els.sendBtn.disabled = !botConnected;
    els.composerInput.focus();
  }
});

// =====================================================
// CAMPAIGNS
// =====================================================
// =====================================================
// WEBHOOKS
// =====================================================
// =====================================================
// SETTINGS — TAGS
// =====================================================
// Cadastros exibidos dentro da página.
function renderTagsSettings() { window.AppCore?.SettingsPage?.renderTags(); }
function renderDepartmentsSettings() { window.AppCore?.SettingsPage?.renderDepartments(); }

// =====================================================
// SOCKET.IO EVENTS
// =====================================================
socket.on('init', (data) => {
  applyServerState(data);
  refreshContacts().catch(() => {});
  refreshTags().catch(() => {});
  refreshDepartments().catch(() => {});
});

let didReceiveInit = false;
socket.on('init', () => { didReceiveInit = true; });
socket.on('connect', () => {
  if (!didReceiveInit) {
    refreshBotState().catch(() => {});
  }
  setTimeout(() => { didReceiveInit = false; }, 500);
});

socket.on('status', (status) => renderStatus(status));

socket.on('message', (conversation) => {
  adoptConversation(conversation);
  renderConvoList();
  // BUG FIX: use canonicalNumber so messages from phone appear in real time
  const canonNum = canonicalNumber(conversation.number);
  if (canonNum === selectedNumber || conversation.number === selectedNumber) renderChat();
  renderOverview();
});

socket.on('contact', (contact) => {
  const idx = contacts.findIndex((c) => c.number === contact.number);
  if (idx >= 0) contacts[idx] = contact;
  else contacts.push(contact);
  renderContacts();
  renderOverview();
});
socket.on('contacts:updated', () => refreshContacts().catch(reportPageError));

socket.on('conversation:deleted', (data) => {
  const number = typeof data === 'string' ? data : data.number;
  if (data.conversation?.blocked) {
    conversations[number] = data.conversation;
  } else {
    delete conversations[number];
  }
  if (selectedNumber === number && !data.conversation?.blocked) selectedNumber = null;
  renderConvoList();
  renderChat();
});

socket.on('active-target', (target) => {
  activeTarget = target ? canonicalNumber(target) : null;
  renderConvoList();
  renderChat();
});

// =====================================================
// RESILIÊNCIA
// =====================================================
async function safeRefresh() {
  try { await refreshBotState(); } catch (err) { /* tenta de novo */ }
}

socket.on('init-error', () => setTimeout(safeRefresh, 2000));
socket.on('unauthorized', () => Auth.redirectToLogin());

socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') return;
  els.connText.textContent = 'reconectando…';
  els.connText.className = 'conn-value is-offline';
});

socket.io.on('reconnect', () => safeRefresh());
document.addEventListener('visibilitychange', () => { if (!document.hidden) safeRefresh(); });
window.addEventListener('online', safeRefresh);
window.addEventListener('focus', () => { if (Date.now() - lastSyncAt > 15000) safeRefresh(); });

setInterval(() => {
  if (document.hidden) return;
  const limit = botConnected ? 60000 : 10000;
  if (Date.now() - lastSyncAt >= limit) safeRefresh();
}, 5000);

// =====================================================
// PERFIL
// =====================================================
async function openProfile() {
  try {
    const res = await fetch(apiUrl('/api/profile'), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível carregar o perfil.');

    els.profileUsername.value        = data.username;
    els.profileDisplayName.value     = data.displayName || data.username;
    if (els.profileWhatsappNumber) els.profileWhatsappNumber.value = formatWhatsappNumber(data.whatsappNumber || '');
    document.getElementById('profileCurrentPassword').value = '';
    document.getElementById('profileNewPassword').value     = '';
    document.getElementById('profileConfirmPassword').value = '';
    els.profileError.hidden = true;
    openInlinePanel(els.profileModal);
    els.profileUsername.focus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

els.profileWhatsappNumber?.addEventListener('input', () => {
  els.profileWhatsappNumber.value = formatWhatsappNumber(els.profileWhatsappNumber.value);
});

els.profileBtn?.addEventListener('click', openProfile);
els.profileClose?.addEventListener('click', () => { els.profileModal.hidden = true; });


els.profileForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.profileError.hidden = true;
  if (els.profileSaveBtn) els.profileSaveBtn.disabled = true;

  const form = new FormData(els.profileForm);
  const payload = Object.fromEntries(form.entries());

  try {
    const res = await fetch(apiUrl('/api/profile'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível salvar o perfil.');
    currentUser = { username: data.username, displayName: data.displayName, whatsappNumber: data.whatsappNumber };
    updateUserLabel(currentUser, els.adminLabel.textContent.split('—').slice(1).join('—').trim());
    els.profileModal.hidden = true;
    showToast('✅ Perfil atualizado com sucesso.', 'success');
  } catch (err) {
    els.profileError.textContent = err.message;
    els.profileError.hidden = false;
  } finally {
    if (els.profileSaveBtn) els.profileSaveBtn.disabled = false;
  }
});

// =====================================================
// LOGOUT
// =====================================================
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => Auth.logout());
}

// =====================================================
// DESCONECTAR WHATSAPP
// =====================================================
if (els.disconnectBtn) {
  els.disconnectBtn.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Desconectar WhatsApp',
      body: 'Desconectar o WhatsApp do bot? Você precisará escanear o QR novamente para reconectar.',
      okText: 'Desconectar',
    });
    if (!ok) return;

    try {
      const res = await fetch(apiUrl('/api/disconnect'), { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao desconectar o WhatsApp.');
      await refreshBotState();
      waitForQr();
      showToast('🔌 WhatsApp desconectado. Escaneie o QR para reconectar.', 'success');
    } catch (err) {
      showToast(err.message || 'Não foi possível desconectar o WhatsApp.', 'error');
    }
  });
}

// =====================================================
// EMOJI PICKER
// =====================================================
const EMOJI_LIST = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
  '😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐',
  '😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞',
  '😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖',
  '👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍',
  '👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','❤️','🧡','💛','💚','💙','💜','🖤','🤍',
  '🔥','⭐','✨','💫','💥','💢','💬','💭','💤','🎉','🎊','🎈','🎁','🎀','🏆','🥇','🌟','💎','🚀','⚡',
];

let emojiPickerEl = null;

function buildEmojiPicker() {
  if (emojiPickerEl) return emojiPickerEl;
  const picker = document.createElement('div');
  picker.id = 'emojiPicker';
  picker.className = 'emoji-picker';
  picker.innerHTML = `<div class="emoji-grid">${EMOJI_LIST.map(e => `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>`;
  picker.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pos = els.composerInput.selectionStart || els.composerInput.value.length;
      const val = els.composerInput.value;
      els.composerInput.value = val.slice(0, pos) + btn.dataset.emoji + val.slice(pos);
      els.composerInput.selectionStart = els.composerInput.selectionEnd = pos + btn.dataset.emoji.length;
      els.composerInput.dispatchEvent(new Event('input'));
      els.composerInput.focus();
    });
  });
  els.composer.before(picker);
  emojiPickerEl = picker;
  return picker;
}

function toggleEmojiPicker() {
  const btn = document.getElementById('emojiBtn');
  if (!btn) return;
  const picker = buildEmojiPicker();
  emojiPickerOpen = !emojiPickerOpen;
  if (emojiPickerOpen) {
    picker.style.display = 'block';
    btn.classList.add('is-active');
  } else {
    picker.style.display = 'none';
    btn.classList.remove('is-active');
  }
}

document.addEventListener('click', (e) => {
  if (emojiPickerOpen && !e.target.closest('#emojiPicker') && e.target.id !== 'emojiBtn' && !e.target.closest('#emojiBtn')) {
    emojiPickerOpen = false;
    if (emojiPickerEl) emojiPickerEl.style.display = 'none';
    const btn = document.getElementById('emojiBtn');
    if (btn) btn.classList.remove('is-active');
  }
});

const emojiBtn = document.getElementById('emojiBtn');
if (emojiBtn) emojiBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPicker(); });

// =====================================================
// TEMA — BOTÕES
// =====================================================
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// =====================================================
// INICIALIZAÇÃO
// =====================================================
window.AppCore = {
  request: BotWapApi.checkedFetch,
  runAction,
  reportError: reportPageError,
  els,
  apiUrl,
  escapeHtml,
  formatPhoneDisplay,
  formatRelativeTime,
  isInternalWhatsAppId,
  avatarColor,
  normalizeNumber,
  openConversation,
  openInlineForm,
  openInlinePanel,
  saveResource,
  showConfirm,
  showToast,
  socket,
  renderDataTable,
  resetTablePage: (key) => { if (tablePages[key]) tablePages[key].page = 0; },
  getContacts: () => contacts,
  getConversations: () => conversations,
  getDepartments: () => allDepartments,
  getTags: () => allTags,
  refreshTags,
  refreshContacts,
  refreshDepartments,
  conversationDisplayName,
  refreshDashboardStats,
  showPage,
  setConversationFilter: (filter) => {
    conversationFilter = filter;
    persistWorkspaceState();
  },
};

document.addEventListener('DOMContentLoaded', () => {
  initializeWorkspace();
  setupDashboardCardClicks();
  refreshBotState().catch(() => {});
  refreshTags().catch(() => {});
  refreshDepartments().catch(() => {});
  const initialPage = detectPageFromURL();
  showPage(initialPage, false);
  window.history.replaceState({ page: initialPage }, '', window.location.pathname + window.location.search + window.location.hash);
}, { once: true });
// =====================================================
// LIST SIDEBAR TABS (Conversas vs Contatos)
// =====================================================
document.querySelectorAll('.list-tab').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    // Remove active from all tabs
    document.querySelectorAll('.list-tab').forEach(btn => btn.classList.remove('is-active'));
    document.querySelectorAll('.list-tab-content').forEach(content => content.classList.remove('is-active'));
    document.querySelectorAll('.list-tab-content').forEach(content => content.hidden = true);
    
    // Add active to clicked tab
    tabBtn.classList.add('is-active');
    
    // Show correct content
    const targetId = tabBtn.dataset.tab === 'conversations' ? 'tabConversations' : 'tabContacts';
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.classList.add('is-active');
      targetEl.hidden = false;
    }
  });
});

// =====================================================
// CHIPS — Gerenciamento de múltiplos números WhatsApp
// =====================================================
function formatPhoneDisplay(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (!d) return number;
  if (d.startsWith('55') && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return `+${d}`;
}

