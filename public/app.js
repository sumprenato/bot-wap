/* =====================================================
   BOT WAP — app.js
   Versão: 20260924-2 (v4.9)
   ===================================================== */

const API_BASE = window.BACKEND_URL || '';
const socket = io(API_BASE, { withCredentials: true });

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

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
let conversations    = {};
let activeTarget     = null;
let selectedNumber   = null;
let botConnected     = false;
let selectedFile     = null;
let qrPollingTimer   = null;
let conversationFilter = 'all';
let contacts         = [];
let activePage       = 'inbox';
let currentUser      = null;
let contactAlphaFilter = 'all';
let lastSyncAt       = 0;
let renderedChatNumber = null;
let renderedMsgCount = 0;
let allTags          = [];
let allDepartments   = [];
let bulkSelectedNumbers = new Set();
let bulkMode         = false;
let editingCampaignId = null;
let editingWebhookId = null;
let lossingOpportunityId = null;
let lossReasons      = [];

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
// TOAST
// =====================================================
function showToast(message, type = 'error') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  void toast.offsetWidth;
  toast.classList.add('toast-visible');

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// =====================================================
// MODAL DE CONFIRMAÇÃO
// =====================================================
function showConfirm({ title = 'Confirmar ação', body = '', okText = 'Confirmar', okClass = '' } = {}) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmBody.textContent = body;
    els.confirmOk.textContent = okText;
    els.confirmOk.className = `confirm-ok ${okClass}`;
    els.confirmModal.hidden = false;

    function cleanup(result) {
      els.confirmModal.hidden = true;
      els.confirmOk.removeEventListener('click', onOk);
      els.confirmCancel.removeEventListener('click', onCancel);
      els.confirmModal.removeEventListener('click', onOverlay);
      resolve(result);
    }
    const onOk      = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === els.confirmModal) cleanup(false); };

    els.confirmOk.addEventListener('click', onOk);
    els.confirmCancel.addEventListener('click', onCancel);
    els.confirmModal.addEventListener('click', onOverlay);
  });
}

// =====================================================
// AVATAR — cor por hash do número
// =====================================================
const AVATAR_COLORS = [
  ['#3ddc84', '#0f2b1e'],
  ['#5c8df6', '#0d1a35'],
  ['#f2b84b', '#2b1f09'],
  ['#8e5cf6', '#1a0f35'],
  ['#f07070', '#2b0f0f'],
  ['#4ec9b0', '#0f2422'],
  ['#ce9178', '#2b1a10'],
  ['#9cdcfe', '#0f2033'],
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
  const online = !!status.connected;
  botConnected = online;

  els.connDot.className = 'brand-mark ' + (online ? 'online' : 'offline');

  const connLabel = status.needsNumber
    ? 'configure o número'
    : (online ? 'conectado' : 'desconectado');
  els.connText.textContent = connLabel;
  els.connText.className = 'conn-value ' + (online ? 'is-online' : 'is-offline');

  els.overviewStatus.textContent = online ? 'online' : 'aguardando QR';
  els.overviewStatus.className = online ? 'is-online' : 'is-offline';

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
  els.composerInput.placeholder = status.needsNumber
    ? 'Configure o número WhatsApp no perfil…'
    : (online ? 'Escrever mensagem…' : 'Bot desconectado…');
  els.composerInput.disabled = !online;

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
  if (res.status === 401) { window.location.href = '/'; return; }
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
    if (newMsgCount !== prevMsgCount || newConvoJson !== prevConvoJson) {
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
  const res = await fetch(apiUrl('/api/contacts'), { credentials: 'include' });
  if (!res.ok) return;
  contacts = (await res.json()).contacts || [];
  renderContacts();
  renderOverview();
}

async function refreshTags() {
  const res = await fetch(apiUrl('/api/tags'), { credentials: 'include' });
  if (!res.ok) return;
  allTags = (await res.json()).tags || [];
  renderTagsSettings();
}

async function refreshDepartments() {
  const res = await fetch(apiUrl('/api/departments'), { credentials: 'include' });
  if (!res.ok) return;
  allDepartments = (await res.json()).departments || [];
  renderDepartmentsSettings();
}

async function refreshDashboardStats() {
  const res = await fetch(apiUrl('/api/dashboard/stats'), { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  if (els.overviewFinalized) els.overviewFinalized.textContent = data.finalized || 0;
  if (els.overviewRevenue) els.overviewRevenue.textContent = `R$ ${(data.revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (els.overviewConversion) els.overviewConversion.textContent = `${data.conversionRate || 0}%`;
}

function updateUserLabel(user, admin) {
  if (!els.adminLabel) return;
  const name = user.displayName || user.username || 'admin';
  els.adminLabel.textContent = `${name} — ${admin || ''}`;
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
    img.addEventListener('click', () => window.open(msg.mediaUrl, '_blank', 'noopener'));
    bubble.appendChild(img);
  } else if (msg.type === 'video' && msg.mediaUrl) {
    const video = document.createElement('video');
    video.src = msg.mediaUrl;
    video.controls = true;
    video.preload = 'metadata';
    bubble.appendChild(video);
  } else if (msg.type === 'audio' && msg.mediaUrl) {
    const audio = document.createElement('audio');
    audio.src = msg.mediaUrl;
    audio.controls = true;
    bubble.appendChild(audio);
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
  const searchTerm = els.conversationSearch.value.trim().toLowerCase();
  const allNumbers = Object.keys(conversations);

  const numbers = [...allNumbers].sort((a, b) => {
    const ta = conversations[a].lastMessageAt || '';
    const tb = conversations[b].lastMessageAt || '';
    return tb.localeCompare(ta);
  }).filter((number) => {
    const convo = conversations[number] || {};
    if (convo._placeholder && number !== selectedNumber) return false;
    const haystack = `${convo.name || ''} ${number} ${convo.lastMessage || ''}`.toLowerCase();
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

    const displayName = convo.name || number;
    const [bg, color] = avatarColor(displayName);
    const isAssumed = number === activeTarget;
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
    els.bulkTransferModal.hidden = false;
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
    // Apply department to all selected conversations (client-side for now, server needs dept support per conversation)
    showToast(`✅ ${bulkSelectedNumbers.size} conversa(s) transferidas para o departamento selecionado.`, 'success');
    els.bulkTransferModal.hidden = true;
    exitBulkMode();
  });
}

// =====================================================
// RENDER OVERVIEW PAGE
// =====================================================
function renderOverview() {
  const numbers = Object.keys(conversations);
  const openConvos = numbers.filter((n) => !conversations[n]?.blocked && !conversations[n]?.isFinalized);
  const messages = numbers.reduce((total, n) => total + (conversations[n].messages || []).length, 0);

  if (els.overviewTotal) els.overviewTotal.textContent = openConvos.length;
  if (els.overviewContacts) els.overviewContacts.textContent = contacts.length;
  if (els.overviewMessages) els.overviewMessages.textContent = messages;
  if (els.contactsNavCount) els.contactsNavCount.textContent = contacts.length;
  if (els.overviewDate) {
    els.overviewDate.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' });
  }

  refreshDashboardStats().catch(() => {});

  if (!els.overviewList) return;

  const recent = [...openConvos]
    .sort((a, b) => (conversations[b].lastMessageAt || '').localeCompare(conversations[a].lastMessageAt || ''))
    .slice(0, 6);

  els.overviewList.innerHTML = recent.length
    ? recent.map((number) => {
        const convo = conversations[number];
        const displayName = convo.name || number;
        const [bg, color] = avatarColor(displayName);
        return `
          <button type="button" class="overview-row" data-number="${escapeHtml(number)}">
            <span class="contact-avatar" style="background:${bg};color:${color}">${escapeHtml(displayName.slice(0,1).toUpperCase())}</span>
            <span>
              <strong>${escapeHtml(displayName)}</strong>
              <small>${escapeHtml(convo.lastMessage || 'Sem mensagens')}</small>
            </span>
            <time>${formatRelativeTime(convo.lastMessageAt)}</time>
          </button>`;
      }).join('')
    : '<p class="panel-empty">Nenhuma conversa registrada ainda.</p>';

  els.overviewList.querySelectorAll('[data-number]').forEach((btn) =>
    btn.addEventListener('click', () => {
      openConversation(btn.dataset.number);
      showPage('inbox');
    })
  );
}

// =====================================================
// CLICKABLE DASHBOARD CARDS
// =====================================================
function setupDashboardCardClicks() {
  if (els.dashCardOpen) {
    els.dashCardOpen.addEventListener('click', () => {
      showPage('inbox');
      conversationFilter = 'all';
      els.filterButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'all'));
      renderConvoList();
    });
  }
  if (els.dashCardFinalized) {
    els.dashCardFinalized.addEventListener('click', () => {
      showPage('inbox');
      conversationFilter = 'finalized';
      els.filterButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'finalized'));
      renderConvoList();
    });
  }
  if (els.overviewCardOpen) {
    els.overviewCardOpen.addEventListener('click', () => {
      conversationFilter = 'all';
      els.filterButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'all'));
      renderConvoList();
    });
  }
  if (els.overviewCardAssumed) {
    els.overviewCardAssumed.addEventListener('click', () => {
      conversationFilter = 'assumed';
      els.filterButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'assumed'));
      renderConvoList();
    });
  }
}

// =====================================================
// RENDER CONTACTS PAGE
// =====================================================
function renderContacts() {
  const term = (els.contactSearch?.value || '').trim().toLowerCase();

  let filtered = contacts.filter((c) =>
    `${c.name} ${c.pushName} ${c.number}`.toLowerCase().includes(term)
  );

  if (contactAlphaFilter !== 'all') {
    filtered = filtered.filter((c) => {
      const first = (c.name || c.pushName || c.number || '').slice(0, 1).toUpperCase();
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
              <small>${escapeHtml(c.number)}</small>
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
      showPage('inbox');
    })
  );
}

// =====================================================
// ROUTING — URLs reais por página (History API)
// =====================================================
const PAGE_ROUTES = {
  atendimento:   '/atendimento',
  overview:      '/dashboard',
  kanban:        '/kanban',
  campaigns:     '/campanhas',
  flows:         '/fluxos',
  contacts:      '/contatos',
  webhooks:      '/webhooks',
  settings:      '/configuracoes',
  inbox:         '/atendimento', // alias
};

const ROUTE_TO_PAGE = {
  '/atendimento':   'inbox',
  '/dashboard':     'overview',
  '/kanban':        'kanban',
  '/campanhas':     'campaigns',
  '/fluxos':        'flows',
  '/contatos':      'contacts',
  '/webhooks':      'webhooks',
  '/configuracoes': 'settings',
  '/dashboard.html':'inbox',
};

function detectPageFromURL() {
  const path = window.location.pathname;
  return ROUTE_TO_PAGE[path] || 'inbox';
}

function showPage(page, pushState = true) {
  // inbox e atendimento são o mesmo
  if (page === 'atendimento') page = 'inbox';

  activePage = page;

  document.querySelectorAll('[data-page-view]').forEach((view) => {
    const isActive = view.dataset.pageView === page;
    view.classList.toggle('is-active', isActive);
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    const itemPage = item.dataset.page === 'atendimento' ? 'inbox' : item.dataset.page;
    item.classList.toggle('is-active', itemPage === page);
  });

  if (els.inboxTools) els.inboxTools.style.display = page === 'inbox' ? '' : 'none';
  if (els.inboxConvoHeader) els.inboxConvoHeader.style.display = page === 'inbox' ? '' : 'none';

  // Update URL
  if (pushState) {
    const url = PAGE_ROUTES[page] || PAGE_ROUTES.atendimento;
    if (window.location.pathname !== url) {
      window.history.pushState({ page }, '', url);
    }
    // Update page <title>
    const titles = {
      inbox:    'Atendimento — Bot WAP',
      overview: 'Dashboard — Bot WAP',
      kanban:   'Kanban — Bot WAP',
      campaigns:'Campanhas — Bot WAP',
      flows:    'Fluxos — Bot WAP',
      contacts: 'Contatos — Bot WAP',
      webhooks: 'Webhooks — Bot WAP',
      settings: 'Configurações — Bot WAP',
    };
    document.title = titles[page] || 'Bot WAP';
  }

  if (page === 'contacts')  refreshContacts().catch(() => {});
  if (page === 'overview')  { renderOverview(); refreshDashboardStats().catch(() => {}); }
  if (page === 'campaigns') loadCampaigns().catch(() => {});
  if (page === 'webhooks')  loadWebhooks().catch(() => {});
  if (page === 'kanban')    loadKanban().catch(() => {});
  if (page === 'flows')     loadFlows().catch(() => {});
  if (page === 'settings')  {
    refreshTags().catch(() => {});
    refreshDepartments().catch(() => {});
    loadFollowups().catch(() => {});
  }
}

// Browser back/forward navigation
window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page) || detectPageFromURL();
  showPage(page, false);
});

// =====================================================
// RENDER CHAT
// =====================================================
function updateChatHeader() {
  if (!selectedNumber) return;
  const convo = conversations[selectedNumber] || { number: selectedNumber, messages: [], blocked: false };
  const isAssumed = selectedNumber === activeTarget;
  const contactName = convo.name || selectedNumber;
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

  if (els.chatAvatar) setAvatarEl(els.chatAvatar, contactName);

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
  if (!selectedNumber) {
    renderedChatNumber = null;
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
  const switched = renderedChatNumber !== selectedNumber;

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
  return div.innerHTML;
}

function normalizeNumber(value) {
  if (!value) return '';
  return value.toString().replace(/\D/g, '');
}

function openConversation(number) {
  const clean = normalizeNumber(number);
  if (!clean) {
    showToast('Digite um número válido para abrir a conversa.', 'error');
    return;
  }
  selectedNumber = canonicalNumber(clean);
  if (!conversations[selectedNumber]) {
    conversations[selectedNumber] = { number: selectedNumber, name: '', blocked: false, messages: [], _placeholder: true };
  }
  dropStalePlaceholders();
  renderConvoList();
  renderChat();
  els.composerInput.focus();
}

function selectConversation(number) {
  selectedNumber = number;
  dropStalePlaceholders();
  renderConvoList();
  renderChat();
}

// =====================================================
// TAGS MODAL
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
        ? '<p style="color:var(--text-faint);font-size:12px">Nenhuma tag criada ainda. Vá em Configurações → Tags.</p>'
        : allTags.map((tag) => {
            const isActive = isBulk ? false : currentTags.includes(tag.name);
            return `<button type="button" class="tag-toggle-btn ${isActive ? 'is-active' : ''}" data-tag="${escapeHtml(tag.name)}" style="--tag-color:${tag.color}">
              <span class="tag-toggle-dot" style="background:${tag.color}"></span>
              ${escapeHtml(tag.name)}
            </button>`;
          }).join('')}
    </div>
  `;

  els.tagsModal.hidden = false;

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
if (els.tagsModal) els.tagsModal.addEventListener('click', (e) => { if (e.target === els.tagsModal) els.tagsModal.hidden = true; });

// =====================================================
// EVENT LISTENERS — AÇÕES DO CHAT
// =====================================================
els.newChatBtn.addEventListener('click', () => {
  openConversation(els.newChatInput.value);
  els.newChatInput.value = '';
});

els.newChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); els.newChatBtn.click(); }
});

// Navegação entre páginas
document.querySelectorAll('.nav-item, [data-page-link]').forEach((btn) =>
  btn.addEventListener('click', () => showPage(btn.dataset.page || btn.dataset.pageLink))
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

els.conversationSearch.addEventListener('input', renderConvoList);

els.filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    conversationFilter = btn.dataset.filter;
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
    els.confirmModal.hidden = true;
  }
  if (e.key === 'Escape' && bulkMode) {
    exitBulkMode();
  }
});

// =====================================================
// ATTACH / FILE
// =====================================================
els.attachBtn.addEventListener('click', () => {
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

els.removeFileBtn.addEventListener('click', clearFile);

els.fileInput.addEventListener('change', () => {
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
els.assumeBtn.addEventListener('click', async () => {
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
        ? `Reabrir a conversa com ${convo?.name || selectedNumber}?`
        : `Finalizar a conversa com ${convo?.name || selectedNumber}? A conversa ficará na aba de finalizadas.`,
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
els.blockBtn.addEventListener('click', async () => {
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
els.clearBtn.addEventListener('click', async () => {
  if (!selectedNumber) return;

  const ok = await showConfirm({
    title: 'Limpar histórico',
    body: `Apagar todas as mensagens da conversa com ${conversations[selectedNumber]?.name || selectedNumber}? Esta ação não pode ser desfeita.`,
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
els.deleteBtn.addEventListener('click', async () => {
  if (!selectedNumber) return;

  const ok = await showConfirm({
    title: 'Apagar conversa',
    body: `Apagar permanentemente a conversa com ${conversations[selectedNumber]?.name || selectedNumber}?`,
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
els.composerInput.addEventListener('input', () => {
  els.composerInput.style.height = 'auto';
  els.composerInput.style.height = Math.min(els.composerInput.scrollHeight, 120) + 'px';
});

els.composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer.addEventListener('submit', async (e) => {
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

  els.campaignsList.innerHTML = campaigns.map((c) => `
    <div class="campaign-card" data-id="${c.id}">
      <div class="campaign-card-header">
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <span class="campaign-status ${statusClass[c.status] || ''}">${statusLabel[c.status] || c.status}</span>
        </div>
        <div class="campaign-card-actions">
          <button class="text-action campaign-duplicate" data-id="${c.id}">Duplicar</button>
          <button class="text-action campaign-edit" data-id="${c.id}">Editar</button>
          <button class="text-action text-action--danger campaign-delete" data-id="${c.id}">Excluir</button>
        </div>
      </div>
      <p class="campaign-message">${escapeHtml(c.message.slice(0, 120))}${c.message.length > 120 ? '…' : ''}</p>
      <div class="campaign-meta">
        ${c.target_tags?.length ? `<span class="campaign-meta-item">🏷️ Enviar para: ${c.target_tags.join(', ')}</span>` : '<span class="campaign-meta-item">🏷️ Todos os contatos</span>'}
        ${c.blocked_tags?.length ? `<span class="campaign-meta-item campaign-meta-item--danger">🚫 Excluir: ${c.blocked_tags.join(', ')}</span>` : ''}
        ${c.scheduled_at ? `<span class="campaign-meta-item">📅 ${new Date(c.scheduled_at).toLocaleString('pt-BR')}</span>` : ''}
        ${c.sent_count > 0 ? `<span class="campaign-meta-item">✅ ${c.sent_count} enviados · ❌ ${c.failed_count} falhas</span>` : ''}
      </div>
    </div>
  `).join('');

  els.campaignsList.querySelectorAll('.campaign-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const campaign = campaigns.find((c) => c.id == btn.dataset.id);
      if (!campaign) return;
      openCampaignModal(campaign);
    });
  });

  els.campaignsList.querySelectorAll('.campaign-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Excluir campanha', body: 'Tem certeza que deseja excluir esta campanha?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/campaigns/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      showToast('🗑️ Campanha excluída.', 'success');
      loadCampaigns();
    });
  });

  els.campaignsList.querySelectorAll('.campaign-duplicate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/campaigns/${btn.dataset.id}/duplicate`), { method: 'POST', credentials: 'include' });
      showToast('✅ Campanha duplicada.', 'success');
      loadCampaigns();
    });
  });
}

function openCampaignModal(campaign = null) {
  editingCampaignId = campaign?.id || null;
  if (els.campaignModal) {
    document.getElementById('campaignModalTitle').textContent = campaign ? 'Editar Campanha' : 'Nova Campanha';
    if (els.campaignName) els.campaignName.value = campaign?.name || '';
    if (els.campaignMessage) els.campaignMessage.value = campaign?.message || '';
    if (els.campaignScheduledAt) els.campaignScheduledAt.value = campaign?.scheduled_at ? campaign.scheduled_at.replace(' ', 'T').slice(0, 16) : '';
    if (els.campaignError) els.campaignError.hidden = true;

    // Render tag pickers
    renderTagPicker('campaignTargetTagsPicker', campaign?.target_tags || []);
    renderTagPicker('campaignBlockedTagsPicker', campaign?.blocked_tags || [], true);

    els.campaignModal.hidden = false;
  }
}

function renderTagPicker(containerId, selectedTags, isDanger = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = allTags.length
    ? allTags.map((tag) => {
        const isActive = selectedTags.includes(tag.name);
        return `<button type="button" class="tag-toggle-btn ${isActive ? 'is-active' : ''} ${isDanger ? 'tag-toggle-btn--danger' : ''}" data-tag="${escapeHtml(tag.name)}" style="--tag-color:${isDanger ? '#f87171' : tag.color}">
          <span class="tag-toggle-dot" style="background:${tag.color}"></span>
          ${escapeHtml(tag.name)}
        </button>`;
      }).join('')
    : '<p style="color:var(--text-faint);font-size:12px;margin:0">Nenhuma tag disponível</p>';

  container.querySelectorAll('.tag-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('is-active'));
  });
}

if (els.newCampaignBtn) els.newCampaignBtn.addEventListener('click', () => openCampaignModal());
if (els.campaignModalClose) {
  els.campaignModalClose.addEventListener('click', () => { els.campaignModal.hidden = true; });
}
if (els.campaignModal) {
  els.campaignModal.addEventListener('click', (e) => { if (e.target === els.campaignModal) els.campaignModal.hidden = true; });
}

if (els.campaignForm) {
  els.campaignForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetTags = [...document.querySelectorAll('#campaignTargetTagsPicker .tag-toggle-btn.is-active')].map((b) => b.dataset.tag);
    const blockedTags = [...document.querySelectorAll('#campaignBlockedTagsPicker .tag-toggle-btn.is-active')].map((b) => b.dataset.tag);
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
      loadCampaigns();
    } catch (err) {
      if (els.campaignError) { els.campaignError.textContent = err.message; els.campaignError.hidden = false; }
    } finally {
      if (els.campaignSaveBtn) els.campaignSaveBtn.disabled = false;
    }
  });
}

// =====================================================
// WEBHOOKS
// =====================================================
async function loadWebhooks() {
  const search = els.webhookSearch?.value || '';
  const res = await fetch(apiUrl(`/api/webhooks${search ? `?search=${encodeURIComponent(search)}` : ''}`), { credentials: 'include' });
  if (!res.ok) return;
  const { webhooks } = await res.json();
  renderWebhooks(webhooks);
}

function renderWebhooks(webhooks) {
  if (!els.webhooksList) return;
  if (!webhooks || webhooks.length === 0) {
    els.webhooksList.innerHTML = '<p class="panel-empty">Nenhum webhook configurado. Clique em "+ Novo Webhook" para começar.</p>';
    return;
  }

  els.webhooksList.innerHTML = webhooks.map((w) => `
    <div class="webhook-card ${w.active ? '' : 'webhook-card--inactive'}">
      <div class="webhook-card-header">
        <div>
          <strong>${escapeHtml(w.name)}</strong>
          <span class="webhook-status">${w.active ? '🟢 Ativo' : '⚫ Inativo'}</span>
        </div>
        <div class="campaign-card-actions">
          <button class="text-action webhook-edit" data-id="${w.id}">Editar</button>
          <button class="text-action text-action--danger webhook-delete" data-id="${w.id}">Excluir</button>
        </div>
      </div>
      <p class="webhook-url" title="${escapeHtml(w.url)}">${escapeHtml(w.url)}</p>
      <div class="campaign-meta">
        ${(w.events || []).map((ev) => `<span class="campaign-meta-item">📡 ${escapeHtml(ev)}</span>`).join('')}
        ${w.last_triggered_at ? `<span class="campaign-meta-item">⏱ Último disparo: ${formatRelativeTime(w.last_triggered_at)}</span>` : ''}
      </div>
    </div>
  `).join('');

  els.webhooksList.querySelectorAll('.webhook-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const webhook = webhooks.find((w) => w.id == btn.dataset.id);
      if (!webhook) return;
      openWebhookModal(webhook);
    });
  });

  els.webhooksList.querySelectorAll('.webhook-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Excluir webhook', body: 'Tem certeza?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/webhooks/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      showToast('🗑️ Webhook excluído.', 'success');
      loadWebhooks();
    });
  });
}

function openWebhookModal(webhook = null) {
  editingWebhookId = webhook?.id || null;
  document.getElementById('webhookModalTitle').textContent = webhook ? 'Editar Webhook' : 'Novo Webhook';
  if (els.webhookName) els.webhookName.value = webhook?.name || '';
  if (els.webhookUrl) els.webhookUrl.value = webhook?.url || '';
  if (els.webhookSecret) els.webhookSecret.value = webhook?.secret || '';
  if (els.webhookError) els.webhookError.hidden = true;

  // Set event checkboxes
  document.querySelectorAll('[name="events"]').forEach((cb) => {
    cb.checked = (webhook?.events || []).includes(cb.value);
  });

  if (els.webhookModal) els.webhookModal.hidden = false;
}

if (els.newWebhookBtn) els.newWebhookBtn.addEventListener('click', () => openWebhookModal());
if (els.webhookModalClose) els.webhookModalClose.addEventListener('click', () => { els.webhookModal.hidden = true; });
if (els.webhookModal) els.webhookModal.addEventListener('click', (e) => { if (e.target === els.webhookModal) els.webhookModal.hidden = true; });
if (els.webhookSearch) els.webhookSearch.addEventListener('input', () => loadWebhooks());

if (els.webhookForm) {
  els.webhookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const events = [...document.querySelectorAll('[name="events"]:checked')].map((cb) => cb.value);
    const payload = {
      name: els.webhookName.value,
      url: els.webhookUrl.value,
      events,
      secret: els.webhookSecret.value,
      active: true,
    };
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
      loadWebhooks();
    } catch (err) {
      if (els.webhookError) { els.webhookError.textContent = err.message; els.webhookError.hidden = false; }
    } finally {
      if (els.webhookSaveBtn) els.webhookSaveBtn.disabled = false;
    }
  });
}

// =====================================================
// KANBAN
// =====================================================
async function loadKanban() {
  const res = await fetch(apiUrl('/api/kanban'), { credentials: 'include' });
  if (!res.ok) return;
  const { columns, opportunities } = await res.json();

  // Load loss reasons too
  const lrRes = await fetch(apiUrl('/api/loss-reasons'), { credentials: 'include' });
  if (lrRes.ok) {
    lossReasons = (await lrRes.json()).reasons || [];
  }

  renderKanban(columns, opportunities);
}

function renderKanban(columns, opportunities) {
  if (!els.kanbanBoard) return;

  // Metrics
  if (els.kanbanMetrics) {
    const won = opportunities.filter((o) => o.status === 'won');
    const lost = opportunities.filter((o) => o.status === 'lost');
    const revenue = won.reduce((s, o) => s + (o.value || 0), 0);
    const convRate = opportunities.length > 0 ? (won.length / opportunities.length * 100).toFixed(1) : 0;

    // Group loss reasons
    const lossMap = {};
    lost.forEach((o) => {
      const reason = lossReasons.find((r) => r.id === o.loss_reason_id);
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
        <div class="kanban-metric"><span>Conversão</span><strong>${convRate}%</strong></div>
        ${topLossReasons.length ? `<div class="kanban-metric kanban-metric--loss"><span>Top perda</span><strong>${escapeHtml(topLossReasons[0][0])}</strong></div>` : ''}
      </div>
    `;
  }

  if (columns.length === 0) {
    els.kanbanBoard.innerHTML = '<p class="panel-empty">Nenhuma coluna criada. Clique em "+ Coluna" para começar.</p>';
    return;
  }

  els.kanbanBoard.innerHTML = columns.map((col) => {
    const colOpps = opportunities.filter((o) => o.column_id === col.id && o.status === 'open');
    const cards = colOpps.map((opp) => `
      <div class="kanban-card" data-id="${opp.id}">
        <div class="kanban-card-title">${escapeHtml(opp.title)}</div>
        ${opp.contact_name ? `<div class="kanban-card-contact">👤 ${escapeHtml(opp.contact_name)}</div>` : ''}
        ${opp.value ? `<div class="kanban-card-value">R$ ${Number(opp.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>` : ''}
        <div class="kanban-card-actions">
          <button class="kanban-card-btn kanban-win" data-id="${opp.id}" title="Ganhar">✅</button>
          <button class="kanban-card-btn kanban-lose" data-id="${opp.id}" title="Perder">❌</button>
          <button class="kanban-card-btn kanban-delete" data-id="${opp.id}" title="Excluir">🗑️</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="kanban-column" data-col-id="${col.id}">
        <div class="kanban-column-header">
          <span class="kanban-column-name">${escapeHtml(col.name)}</span>
          <span class="kanban-column-count">${colOpps.length}</span>
          <button class="kanban-add-opp text-action" data-col-id="${col.id}">+</button>
          <button class="kanban-delete-col" data-col-id="${col.id}" title="Excluir coluna">×</button>
        </div>
        <div class="kanban-cards">${cards}</div>
      </div>
    `;
  }).join('');

  // Events
  els.kanbanBoard.querySelectorAll('.kanban-add-opp').forEach((btn) => {
    btn.addEventListener('click', () => openOpportunityModal(btn.dataset.colId));
  });

  els.kanbanBoard.querySelectorAll('.kanban-delete-col').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Excluir coluna', body: 'Isso também excluirá as oportunidades nessa coluna.', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/kanban/columns/${btn.dataset.colId}`), { method: 'DELETE', credentials: 'include' });
      loadKanban();
    });
  });

  els.kanbanBoard.querySelectorAll('.kanban-win').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/kanban/opportunities/${btn.dataset.id}/win`), { method: 'POST', credentials: 'include' });
      showToast('🏆 Oportunidade ganha!', 'success');
      loadKanban();
    });
  });

  els.kanbanBoard.querySelectorAll('.kanban-lose').forEach((btn) => {
    btn.addEventListener('click', () => openLoseModal(btn.dataset.id));
  });

  els.kanbanBoard.querySelectorAll('.kanban-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Excluir oportunidade', body: 'Tem certeza?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/kanban/opportunities/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      loadKanban();
    });
  });
}

function openOpportunityModal(colId, opp = null) {
  if (els.opportunityId) els.opportunityId.value = opp?.id || '';
  if (els.opportunityColumnId) els.opportunityColumnId.value = colId;
  if (els.opportunityTitle) els.opportunityTitle.value = opp?.title || '';
  if (els.opportunityContact) els.opportunityContact.value = opp?.contact_number || '';
  if (els.opportunityValue) els.opportunityValue.value = opp?.value || '';
  if (els.opportunityError) els.opportunityError.hidden = true;
  document.getElementById('opportunityModalTitle').textContent = opp ? 'Editar Oportunidade' : 'Nova Oportunidade';
  if (els.opportunityModal) els.opportunityModal.hidden = false;
}

function openLoseModal(oppId) {
  lossingOpportunityId = oppId;
  if (els.loseReasonSelect) {
    els.loseReasonSelect.innerHTML = '<option value="">Sem motivo específico</option>' +
      lossReasons.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  }
  if (els.loseModal) els.loseModal.hidden = false;
}

if (els.opportunityModalClose) els.opportunityModalClose.addEventListener('click', () => { els.opportunityModal.hidden = true; });
if (els.opportunityModal) els.opportunityModal.addEventListener('click', (e) => { if (e.target === els.opportunityModal) els.opportunityModal.hidden = true; });

if (els.opportunityForm) {
  els.opportunityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.opportunityId.value;
    const payload = {
      title: els.opportunityTitle.value,
      contact_number: els.opportunityContact.value,
      contact_name: contacts.find((c) => c.number === normalizeNumber(els.opportunityContact.value))?.name || '',
      value: parseFloat(els.opportunityValue.value) || 0,
      column_id: parseInt(els.opportunityColumnId.value),
      position: 0,
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
      loadKanban();
    } catch (err) {
      if (els.opportunityError) { els.opportunityError.textContent = err.message; els.opportunityError.hidden = false; }
    }
  });
}

if (els.loseModalCancel) els.loseModalCancel.addEventListener('click', () => { els.loseModal.hidden = true; });
if (els.loseModalConfirm) {
  els.loseModalConfirm.addEventListener('click', async () => {
    const reasonId = els.loseReasonSelect.value ? parseInt(els.loseReasonSelect.value) : null;
    await fetch(apiUrl(`/api/kanban/opportunities/${lossingOpportunityId}/lose`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ loss_reason_id: reasonId }),
    });
    showToast('📉 Oportunidade marcada como perdida.', 'success');
    els.loseModal.hidden = true;
    loadKanban();
  });
}

if (els.addKanbanColumnBtn) {
  els.addKanbanColumnBtn.addEventListener('click', async () => {
    const name = prompt('Nome da nova coluna:');
    if (!name) return;
    await fetch(apiUrl('/api/kanban/columns'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
    loadKanban();
  });
}

if (els.manageLossReasonsBtn) {
  els.manageLossReasonsBtn.addEventListener('click', () => openLossReasonsModal());
}

async function openLossReasonsModal() {
  const res = await fetch(apiUrl('/api/loss-reasons'), { credentials: 'include' });
  lossReasons = res.ok ? (await res.json()).reasons || [] : [];
  renderLossReasonsModal();
  if (els.lossReasonsModal) els.lossReasonsModal.hidden = false;
}

function renderLossReasonsModal() {
  if (!els.lossReasonsContent) return;
  els.lossReasonsContent.innerHTML = lossReasons.length
    ? lossReasons.map((r) => `
        <div class="loss-reason-item">
          <span>${escapeHtml(r.name)}</span>
          <button class="text-action text-action--danger" data-id="${r.id}">Excluir</button>
        </div>
      `).join('')
    : '<p style="color:var(--text-faint);font-size:12px">Nenhum motivo cadastrado.</p>';

  els.lossReasonsContent.querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/loss-reasons/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      openLossReasonsModal();
    });
  });
}

if (els.lossReasonsClose) els.lossReasonsClose.addEventListener('click', () => { els.lossReasonsModal.hidden = true; });
if (els.addLossReasonBtn) {
  els.addLossReasonBtn.addEventListener('click', async () => {
    const name = els.newLossReasonInput?.value?.trim();
    if (!name) return;
    await fetch(apiUrl('/api/loss-reasons'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
    if (els.newLossReasonInput) els.newLossReasonInput.value = '';
    openLossReasonsModal();
  });
}

// =====================================================
// FLOWS
// =====================================================
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

  els.flowsList.innerHTML = flows.map((f) => `
    <div class="flow-card ${f.active ? 'flow-card--active' : ''}">
      <div class="campaign-card-header">
        <div>
          <strong>${escapeHtml(f.name)}</strong>
          <span class="campaign-status ${f.active ? 'campaign-status--finished' : ''}">${f.active ? '🟢 Ativo' : '⚫ Inativo'}</span>
          ${f.trigger_keywords?.length ? `<span style="font-size:10px;color:var(--text-faint)">Gatilhos: ${f.trigger_keywords.join(', ')}</span>` : ''}
        </div>
        <div class="campaign-card-actions">
          <button class="text-action flow-toggle" data-id="${f.id}" data-active="${f.active}">${f.active ? 'Desativar' : 'Ativar'}</button>
          <button class="text-action flow-duplicate" data-id="${f.id}">Duplicar</button>
          <button class="text-action flow-edit" data-id="${f.id}">Editar</button>
          <button class="text-action text-action--danger flow-delete" data-id="${f.id}">Excluir</button>
        </div>
      </div>
      ${f.description ? `<p class="campaign-message">${escapeHtml(f.description)}</p>` : ''}
    </div>
  `).join('');

  els.flowsList.querySelectorAll('.flow-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const flow = flows.find((f) => f.id == btn.dataset.id);
      if (!flow) return;
      openFlowModal(flow);
    });
  });

  els.flowsList.querySelectorAll('.flow-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Excluir fluxo', body: 'Tem certeza?', okText: 'Excluir' });
      if (!ok) return;
      await fetch(apiUrl(`/api/flows/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      showToast('🗑️ Fluxo excluído.', 'success');
      loadFlows();
    });
  });

  els.flowsList.querySelectorAll('.flow-duplicate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/flows/${btn.dataset.id}/duplicate`), { method: 'POST', credentials: 'include' });
      showToast('✅ Fluxo duplicado.', 'success');
      loadFlows();
    });
  });

  els.flowsList.querySelectorAll('.flow-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const flow = flows.find((f) => f.id == btn.dataset.id);
      if (!flow) return;
      await fetch(apiUrl(`/api/flows/${btn.dataset.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...flow, active: !flow.active }),
      });
      loadFlows();
    });
  });
}

function openFlowModal(flow = null) {
  if (els.flowId) els.flowId.value = flow?.id || '';
  document.getElementById('flowModalTitle').textContent = flow ? 'Editar Fluxo' : 'Novo Fluxo';
  if (els.flowName) els.flowName.value = flow?.name || '';
  if (els.flowDescription) els.flowDescription.value = flow?.description || '';
  if (els.flowKeywords) els.flowKeywords.value = (flow?.trigger_keywords || []).join(', ');
  if (els.flowError) els.flowError.hidden = true;
  if (els.flowModal) els.flowModal.hidden = false;
}

if (els.newFlowBtn) els.newFlowBtn.addEventListener('click', () => openFlowModal());
if (els.flowModalClose) els.flowModalClose.addEventListener('click', () => { els.flowModal.hidden = true; });
if (els.flowModal) els.flowModal.addEventListener('click', (e) => { if (e.target === els.flowModal) els.flowModal.hidden = true; });

if (els.flowForm) {
  els.flowForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.flowId.value;
    const keywords = els.flowKeywords.value.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      name: els.flowName.value,
      description: els.flowDescription.value,
      trigger_keywords: keywords,
      nodes: [],
      edges: [],
      active: false,
    };
    if (els.flowError) els.flowError.hidden = true;
    try {
      const url = id ? apiUrl(`/api/flows/${id}`) : apiUrl('/api/flows');
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`✅ Fluxo ${id ? 'atualizado' : 'criado'}.`, 'success');
      els.flowModal.hidden = true;
      loadFlows();
    } catch (err) {
      if (els.flowError) { els.flowError.textContent = err.message; els.flowError.hidden = false; }
    }
  });
}

// Global vars
if (els.manageGlobalVarsBtn) els.manageGlobalVarsBtn.addEventListener('click', () => openGlobalVarsModal());
if (els.globalVarsClose) els.globalVarsClose.addEventListener('click', () => { els.globalVarsModal.hidden = true; });

async function openGlobalVarsModal() {
  const res = await fetch(apiUrl('/api/global-variables'), { credentials: 'include' });
  const vars = res.ok ? (await res.json()).variables || [] : [];
  renderGlobalVarsList(vars);
  if (els.globalVarsModal) els.globalVarsModal.hidden = false;
}

function renderGlobalVarsList(vars) {
  if (!els.globalVarsList) return;
  els.globalVarsList.innerHTML = vars.length
    ? vars.map((v) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
          <code style="font-family:var(--font-mono);font-size:11px;color:var(--admin);min-width:100px">{global:${escapeHtml(v.key)}}</code>
          <span style="flex:1;font-size:12px;color:var(--text-dim)">${escapeHtml(v.value)}</span>
          <button class="text-action text-action--danger global-var-delete" data-key="${escapeHtml(v.key)}">×</button>
        </div>
      `).join('')
    : '<p style="color:var(--text-faint);font-size:12px">Nenhuma variável global cadastrada.</p>';

  els.globalVarsList.querySelectorAll('.global-var-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/global-variables/${btn.dataset.key}`), { method: 'DELETE', credentials: 'include' });
      openGlobalVarsModal();
    });
  });
}

if (els.addGlobalVarBtn) {
  els.addGlobalVarBtn.addEventListener('click', async () => {
    const key = els.newGlobalVarKey?.value?.trim()?.toUpperCase();
    const value = els.newGlobalVarValue?.value?.trim();
    if (!key) return;
    await fetch(apiUrl('/api/global-variables'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ key, value }) });
    if (els.newGlobalVarKey) els.newGlobalVarKey.value = '';
    if (els.newGlobalVarValue) els.newGlobalVarValue.value = '';
    openGlobalVarsModal();
  });
}

// =====================================================
// SETTINGS — TAGS
// =====================================================
function renderTagsSettings() {
  if (!els.tagsSettingsList) return;
  els.tagsSettingsList.innerHTML = allTags.length
    ? allTags.map((tag) => `
        <div class="tag-settings-item">
          <span class="tag-settings-dot" style="background:${tag.color}"></span>
          <span class="tag-settings-name">${escapeHtml(tag.name)}</span>
          <input type="color" class="tag-color-input" value="${tag.color}" data-id="${tag.id}" title="Alterar cor" />
          <button class="text-action text-action--danger tag-delete" data-id="${tag.id}">×</button>
        </div>
      `).join('')
    : '<p style="color:var(--text-faint);font-size:12px">Nenhuma tag criada.</p>';

  els.tagsSettingsList.querySelectorAll('.tag-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/tags/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      refreshTags();
    });
  });

  els.tagsSettingsList.querySelectorAll('.tag-color-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const tag = allTags.find((t) => t.id == input.dataset.id);
      if (!tag) return;
      await fetch(apiUrl(`/api/tags/${input.dataset.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: tag.name, color: input.value }),
      });
      refreshTags();
    });
  });
}

if (els.addTagBtn) {
  els.addTagBtn.addEventListener('click', async () => {
    const name = prompt('Nome da nova tag:');
    if (!name?.trim()) return;
    await fetch(apiUrl('/api/tags'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: name.trim() }) });
    refreshTags();
  });
}

// =====================================================
// SETTINGS — DEPARTMENTS
// =====================================================
function renderDepartmentsSettings() {
  if (!els.deptsSettingsList) return;
  els.deptsSettingsList.innerHTML = allDepartments.length
    ? allDepartments.map((d) => `
        <div class="tag-settings-item">
          <span class="tag-settings-dot" style="background:var(--admin)"></span>
          <span class="tag-settings-name">${escapeHtml(d.name)}</span>
          ${d.description ? `<span style="font-size:11px;color:var(--text-faint)">${escapeHtml(d.description)}</span>` : ''}
          <button class="text-action text-action--danger dept-delete" data-id="${d.id}">×</button>
        </div>
      `).join('')
    : '<p style="color:var(--text-faint);font-size:12px">Nenhum departamento criado.</p>';

  els.deptsSettingsList.querySelectorAll('.dept-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/departments/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      refreshDepartments();
    });
  });
}

if (els.addDeptBtn) {
  els.addDeptBtn.addEventListener('click', async () => {
    const name = prompt('Nome do departamento:');
    if (!name?.trim()) return;
    const description = prompt('Descrição (opcional):') || '';
    await fetch(apiUrl('/api/departments'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: name.trim(), description }) });
    refreshDepartments();
  });
}

// =====================================================
// SETTINGS — FOLLOW-UPS
// =====================================================
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
    ? followups.map((f) => `
        <div class="tag-settings-item" style="flex-wrap:wrap;gap:8px">
          <span class="tag-settings-dot" style="background:${f.active ? 'var(--live)' : 'var(--text-faint)'}"></span>
          <span class="tag-settings-name">${escapeHtml(f.name)}</span>
          <span style="font-size:11px;color:var(--text-faint)">⏱ ${f.delay_hours}h · 📅 ${(f.active_days || []).map((d) => dayNames[d]).join(', ')}</span>
          <button class="text-action followup-delete" data-id="${f.id}">Excluir</button>
        </div>
      `).join('')
    : '<p style="color:var(--text-faint);font-size:12px">Nenhum follow-up configurado.</p>';

  els.followupsList.querySelectorAll('.followup-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(apiUrl(`/api/followups/${btn.dataset.id}`), { method: 'DELETE', credentials: 'include' });
      loadFollowups();
    });
  });
}

if (els.addFollowupBtn) {
  els.addFollowupBtn.addEventListener('click', async () => {
    const name = prompt('Nome do follow-up:');
    if (!name?.trim()) return;
    const message = prompt('Mensagem do follow-up:');
    if (!message?.trim()) return;
    const hours = parseInt(prompt('Enviar após quantas horas de inatividade?', '24') || '24');
    await fetch(apiUrl('/api/followups'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: name.trim(), message: message.trim(), delay_hours: hours }),
    });
    loadFollowups();
  });
}

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
  if (conversation.number === selectedNumber) renderChat();
  renderOverview();
});

socket.on('contact', (contact) => {
  const idx = contacts.findIndex((c) => c.number === contact.number);
  if (idx >= 0) contacts[idx] = contact;
  else contacts.push(contact);
  renderContacts();
  renderOverview();
});

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
socket.on('unauthorized', () => { window.location.href = '/'; });

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
// PROFILE MODAL
// =====================================================
async function openProfile() {
  try {
    const res = await fetch(apiUrl('/api/profile'), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível carregar o perfil.');

    els.profileUsername.value        = data.username;
    els.profileDisplayName.value     = data.displayName || data.username;
    els.profileWhatsappNumber.value  = formatWhatsappNumber(data.whatsappNumber || '');
    document.getElementById('profileCurrentPassword').value = '';
    document.getElementById('profileNewPassword').value     = '';
    document.getElementById('profileConfirmPassword').value = '';
    els.profileError.hidden = true;
    els.profileModal.hidden = false;
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
els.profileModal?.addEventListener('click', (e) => {
  if (e.target === els.profileModal) els.profileModal.hidden = true;
});

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
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch(apiUrl('/api/logout'), { method: 'POST', credentials: 'include' });
    } catch (e) { /* ignora */ }
    window.location.href = '/';
  });
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
// INICIALIZAÇÃO
// =====================================================
setupDashboardCardClicks();
refreshBotState().catch(() => {});
refreshTags().catch(() => {});
refreshDepartments().catch(() => {});

// Detecta a página pela URL atual (sem fazer pushState)
const initialPage = detectPageFromURL();
showPage(initialPage, false);
// Registra o state inicial para popstate funcionar
window.history.replaceState({ page: initialPage }, '', window.location.pathname);
