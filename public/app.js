const API_BASE = window.BACKEND_URL || '';
const socket = io(API_BASE, { withCredentials: true });

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

const els = {
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  qrWrap: document.getElementById('qrWrap'),
  qrImage: document.getElementById('qrImage'),
  adminLabel: document.getElementById('profileBtn'),
  convoList: document.getElementById('convoList'),
  convoCount: document.getElementById('convoCount'),
  chatTitle: document.getElementById('chatTitle'),
  chatSub: document.getElementById('chatSub'),
  chatLog: document.getElementById('chatLog'),
  composer: document.getElementById('composer'),
  composerInput: document.getElementById('composerInput'),
  fileInput: document.getElementById('fileInput'),
  attachBtn: document.getElementById('attachBtn'),
  assumeBtn: document.getElementById('assumeBtn'),
  blockBtn: document.getElementById('blockBtn'),
  clearBtn: document.getElementById('clearBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  newChatInput: document.getElementById('newChatInput'),
  newChatBtn: document.getElementById('newChatBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  profileBtn: document.getElementById('profileBtn'),
  profileModal: document.getElementById('profileModal'),
  profileClose: document.getElementById('profileClose'),
  profileForm: document.getElementById('profileForm'),
  profileUsername: document.getElementById('profileUsername'),
  profileError: document.getElementById('profileError'),
};

let conversations = {};
let activeTarget = null;
let selectedNumber = null;
let botConnected = false;
let selectedFile = null;
let qrPollingTimer = null;

// ---------- Toast ----------

function showToast(message, type = 'error') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // força reflow para animação
  void toast.offsetWidth;
  toast.classList.add('toast-visible');

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ---------- Rendering ----------

function renderStatus(status) {
  const online = !!status.connected;
  botConnected = online;
  els.connDot.className = 'brand-mark ' + (online ? 'online' : 'offline');
  els.connText.textContent = online ? 'conectado' : 'desconectado';
  els.connText.className = 'conn-value ' + (online ? 'is-online' : 'is-offline');

  // Atualiza estado do input de envio
  const sendBtn = els.composer.querySelector('button[type="submit"]');
  if (sendBtn) {
    sendBtn.disabled = !online;
    sendBtn.title = online ? '' : 'Bot desconectado do WhatsApp';
  }
  els.composerInput.placeholder = online ? 'Escrever mensagem…' : 'Bot desconectado…';
  els.composerInput.disabled = !online;

  if (!online && status.qr) {
    els.qrWrap.hidden = false;
    els.qrImage.src = status.qr;
  } else {
    els.qrWrap.hidden = true;
  }

  if (online || !els.qrWrap.hidden) stopQrPolling();
}

async function refreshBotState() {
  const res = await fetch(apiUrl('/api/state'), { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  conversations = data.conversations || {};
  activeTarget = data.activeTarget || null;
  els.adminLabel.textContent = `${data.user?.username || 'admin'} — ${data.admin}`;
  renderStatus(data.status || {});
  renderConvoList();
  renderChat();
}

function waitForQr() {
  stopQrPolling();
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    try {
      await refreshBotState();
    } catch (err) {
      console.error('[PANEL] Falha ao atualizar o QR:', err);
    }
    if (botConnected || attempts >= 20 || !els.qrWrap.hidden) {
      stopQrPolling();
      return;
    }
    qrPollingTimer = setTimeout(poll, 1000);
  };
  poll();
}

function stopQrPolling() {
  if (qrPollingTimer) {
    clearTimeout(qrPollingTimer);
    qrPollingTimer = null;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(msg) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (msg.from === 'admin' ? 'admin' : 'client');

  if (msg.type === 'image' && msg.mediaUrl) {
    const image = document.createElement('img');
    image.src = msg.mediaUrl;
    image.alt = msg.fileName || 'Imagem recebida';
    image.loading = 'lazy';
    image.addEventListener('click', () => window.open(msg.mediaUrl, '_blank', 'noopener'));
    bubble.appendChild(image);
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
    link.textContent = msg.fileName || 'Baixar documento';
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

function renderConvoList() {
  const numbers = Object.keys(conversations).sort((a, b) => {
    const ta = conversations[a].lastMessageAt || '';
    const tb = conversations[b].lastMessageAt || '';
    return tb.localeCompare(ta);
  });

  els.convoCount.textContent = numbers.length;
  els.convoList.innerHTML = '';

  if (numbers.length === 0) {
    const li = document.createElement('li');
    li.className = 'convo-empty';
    li.textContent = 'Nenhuma conversa ainda. Mensagens de clientes vão aparecer aqui.';
    els.convoList.appendChild(li);
    return;
  }

  numbers.forEach((number) => {
    const convo = conversations[number] || { number, messages: [] };
    const li = document.createElement('li');
    li.className = 'convo-item';
    if (number === selectedNumber) li.classList.add('active');
    if (number === activeTarget) li.classList.add('assumed');
    if (convo.blocked) li.classList.add('blocked');

    const displayName = convo.name || number;
    li.innerHTML = `
      <div class="convo-header-row">
        <span class="convo-name">${escapeHtml(displayName)}</span>
        ${convo.blocked ? '<span class="convo-badge">bloqueado</span>' : ''}
      </div>
      <span class="convo-number">${number}</span>
      <span class="convo-preview">${escapeHtml(convo.lastMessage || '')}</span>
    `;
    li.addEventListener('click', () => selectConversation(number));
    els.convoList.appendChild(li);
  });
}

function renderChat() {
  if (!selectedNumber) {
    els.chatTitle.textContent = 'Selecione uma conversa';
    els.chatSub.textContent = 'as mensagens aparecem aqui em tempo real';
    els.assumeBtn.hidden = true;
    els.blockBtn.hidden = true;
    els.clearBtn.hidden = true;
    els.deleteBtn.hidden = true;
    els.composer.hidden = true;
    els.chatLog.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma conversa selecionada.</p>
        <p class="empty-sub">Mensagens de clientes vão aparecer na lista à esquerda assim que chegarem.</p>
      </div>
    `;
    return;
  }

  const convo = conversations[selectedNumber] || { number: selectedNumber, messages: [], blocked: false };
  const isAssumed = selectedNumber === activeTarget;
  const contactName = convo.name || selectedNumber;
  const isBlocked = !!convo.blocked;

  els.chatTitle.textContent = contactName;
  els.chatSub.textContent = isBlocked
    ? `bloqueado • ${selectedNumber} • mensagens ignoradas`
    : isAssumed
      ? `você assumiu esta conversa • ${selectedNumber}`
      : `${selectedNumber} • assuma a conversa para responder por aqui`;

  els.assumeBtn.hidden = false;
  els.assumeBtn.textContent = isAssumed ? 'conversa assumida' : 'assumir conversa';
  els.assumeBtn.className = 'assume-btn' + (isAssumed ? ' is-assumed' : '');

  els.blockBtn.hidden = false;
  els.blockBtn.textContent = isBlocked ? 'desbloquear' : 'bloquear';
  els.blockBtn.classList.toggle('is-blocked', isBlocked);

  els.clearBtn.hidden = false;
  els.deleteBtn.hidden = false;
  els.composer.hidden = false;

  els.chatLog.innerHTML = '';
  (convo.messages || []).forEach((msg) => {
    els.chatLog.appendChild(renderMessage(msg));
  });
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

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

  selectedNumber = clean;
  if (!conversations[clean]) {
    conversations[clean] = { number: clean, name: '', blocked: false, messages: [] };
  }
  renderConvoList();
  renderChat();
  els.composerInput.focus();
}

function selectConversation(number) {
  selectedNumber = number;
  renderConvoList();
  renderChat();
}

// ---------- Actions ----------

els.newChatBtn.addEventListener('click', () => {
  openConversation(els.newChatInput.value);
  els.newChatInput.value = '';
});

els.newChatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.newChatBtn.click();
  }
});

els.attachBtn.addEventListener('click', () => {
  if (selectedFile) {
    selectedFile = null;
    els.fileInput.value = '';
    els.attachBtn.textContent = 'anexar';
    els.attachBtn.title = 'Anexar arquivo';
    return;
  }
  els.fileInput.click();
});

els.fileInput.addEventListener('change', () => {
  selectedFile = els.fileInput.files[0] || null;
  els.attachBtn.textContent = selectedFile ? `anexo: ${selectedFile.name}` : 'anexar';
  els.attachBtn.title = selectedFile ? 'Remover anexo' : 'Anexar arquivo';
});

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

els.blockBtn.addEventListener('click', async () => {
  if (!selectedNumber) return;
  const conversation = conversations[selectedNumber] || { blocked: false };
  const blocked = !conversation.blocked;

  try {
    const res = await fetch(apiUrl('/api/conversation/block'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber, blocked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível atualizar o bloqueio.');
    conversations[selectedNumber] = data.conversation;
    showToast(blocked ? '🚫 Conversa bloqueada.' : '✅ Conversa desbloqueada.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao bloquear a conversa.', 'error');
  }
});

els.clearBtn.addEventListener('click', async () => {
  if (!selectedNumber) return;

  try {
    const res = await fetch(apiUrl('/api/conversation/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível limpar a conversa.');
    conversations[selectedNumber] = data.conversation;
    showToast('🧹 Conversa limpa.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao limpar a conversa.', 'error');
  }
});

els.deleteBtn.addEventListener('click', async () => {
  if (!selectedNumber) return;

  const confirmed = window.confirm(`Apagar a conversa com ${selectedNumber}?`);
  if (!confirmed) return;

  try {
    const res = await fetch(apiUrl('/api/conversation/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ number: selectedNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível apagar a conversa.');
    delete conversations[selectedNumber];
    if (selectedNumber === activeTarget) activeTarget = null;
    selectedNumber = null;
    showToast('🗑️ Conversa apagada.', 'success');
    renderConvoList();
    renderChat();
  } catch (err) {
    showToast(err.message || 'Erro ao apagar a conversa.', 'error');
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

  const sendBtn = els.composer.querySelector('button[type="submit"]');
  const fileToSend = selectedFile;
  els.composerInput.value = '';
  els.composerInput.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const request = fileToSend
      ? (() => {
        const formData = new FormData();
        formData.append('number', selectedNumber);
        formData.append('caption', text);
        formData.append('file', fileToSend);
        return fetch(apiUrl('/api/reply-media'), { method: 'POST', body: formData, credentials: 'include' });
      })()
      : fetch(apiUrl('/api/reply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ number: selectedNumber, text }),
      });
    const res = await request;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || `Erro ${res.status} ao enviar mensagem.`;
      showToast(`❌ ${msg}`, 'error');
      els.composerInput.value = text;
      return;
    }

    const data = await res.json();
    if (data.conversation) {
      conversations[data.conversation.number] = data.conversation;
      renderConvoList();
      renderChat();
    }
    selectedFile = null;
    els.fileInput.value = '';
    els.attachBtn.textContent = 'anexar';
    els.attachBtn.title = 'Anexar arquivo';
  } catch (err) {
    showToast('❌ Falha de rede ao enviar mensagem.', 'error');
    els.composerInput.value = text;
  } finally {
    els.composerInput.disabled = !botConnected;
    if (sendBtn) sendBtn.disabled = !botConnected;
    els.composerInput.focus();
  }
});

// ---------- Socket events ----------

socket.on('init', (data) => {
  conversations = data.conversations || {};
  activeTarget = data.activeTarget || null;
  els.adminLabel.textContent = `${data.user?.username || 'admin'} — ${data.admin}`;
  renderStatus(data.status || {});
  renderConvoList();
  renderChat();
});

socket.on('connect', () => {
  refreshBotState().catch((err) => {
    console.error('[PANEL] Falha ao carregar o estado inicial:', err);
  });
});

refreshBotState().catch((err) => {
  console.error('[PANEL] Falha ao carregar o estado inicial:', err);
});

async function openProfile() {
  try {
    const res = await fetch(apiUrl('/api/profile'), { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível carregar o perfil.');
    els.profileUsername.value = data.username;
    els.profileError.hidden = true;
    els.profileForm.reset();
    els.profileUsername.value = data.username;
    els.profileModal.hidden = false;
    els.profileUsername.focus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

els.profileBtn?.addEventListener('click', openProfile);
els.profileClose?.addEventListener('click', () => { els.profileModal.hidden = true; });
els.profileModal?.addEventListener('click', (event) => {
  if (event.target === els.profileModal) els.profileModal.hidden = true;
});
els.profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.profileError.hidden = true;
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
    els.adminLabel.textContent = `${data.username} — ${els.adminLabel.textContent.split('—').slice(1).join('—')}`;
    els.profileModal.hidden = true;
    showToast('Perfil atualizado.', 'success');
  } catch (err) {
    els.profileError.textContent = err.message;
    els.profileError.hidden = false;
  }
});

socket.on('status', (status) => renderStatus(status));

socket.on('message', (conversation) => {
  conversations[conversation.number] = conversation;
  renderConvoList();
  if (conversation.number === selectedNumber) renderChat();
});

socket.on('conversation:deleted', (number) => {
  delete conversations[number];
  if (selectedNumber === number) {
    selectedNumber = null;
  }
  renderConvoList();
  renderChat();
});

socket.on('active-target', (target) => {
  activeTarget = target;
  renderConvoList();
  renderChat();
});

// ---------- Logout ----------
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch(apiUrl('/api/logout'), { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error(e);
    }
    window.location.href = '/';
  });
}

if (els.disconnectBtn) {
  els.disconnectBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('Desconectar o WhatsApp do bot? Você precisará escanear o QR novamente para voltar a conectar.');
    if (!confirmed) return;

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
