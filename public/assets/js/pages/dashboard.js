(function (core) {
  const { els, escapeHtml, formatRelativeTime, refreshDashboardStats, showPage } = core;
  const getConversations = core.getConversations;
  const getContacts = core.getContacts;
  let chartDays = 7;

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
    Object.values(getConversations()).forEach((conversation) => (conversation.messages || []).forEach((message) => {
      const at = new Date(message.at);
      if (Number.isNaN(at.getTime())) return;
      const day = byDay.get(dayKey(at));
      if (day) day[message.from === 'admin' ? 'sent' : 'received']++;
    }));
    const maximum = Math.max(1, ...days.flatMap((day) => [day.received, day.sent]));
    host.style.setProperty('--chart-days', chartDays);
    host.innerHTML = days.map((day) => {
      const label = day.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<div class="chart-day" role="img" aria-label="${label}: ${day.received} recebidas e ${day.sent} enviadas"><div class="chart-bars"><span class="chart-bar received" style="height:${day.received / maximum * 100}%" title="${day.received} recebidas"></span><span class="chart-bar sent" style="height:${day.sent / maximum * 100}%" title="${day.sent} enviadas"></span></div><span class="chart-date">${label}</span></div>`;
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

  function renderDashboard() {
    if (!document.querySelector('[data-page-view="overview"]')) return;
    const conversations = getConversations();
    const numbers = Object.keys(conversations);
    const openConversations = numbers.filter((number) => !conversations[number]?.blocked && !conversations[number]?.isFinalized);
    const messages = numbers.reduce((total, number) => total + (conversations[number].messages || []).length, 0);
    if (els.overviewTotal) els.overviewTotal.textContent = openConversations.length;
    if (els.overviewFinalized) els.overviewFinalized.textContent = numbers.filter((number) => conversations[number]?.isFinalized).length;
    const contactTotal = document.getElementById('overviewContactTotal');
    if (contactTotal) contactTotal.textContent = getContacts().length;
    renderActivityChart();
    if (els.overviewMessages) els.overviewMessages.textContent = messages;
    if (els.contactsNavCount) els.contactsNavCount.textContent = getContacts().length;
    if (els.overviewDate) els.overviewDate.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' });
    refreshDashboardStats().catch(() => {});
    if (!els.overviewList) return;
    const recent = [...openConversations]
      .sort((a, b) => (conversations[b].lastMessageAt || '').localeCompare(conversations[a].lastMessageAt || ''))
      .slice(0, 6);
    els.overviewList.innerHTML = recent.length
      ? recent.map((number) => {
          const conversation = conversations[number];
          const name = core.conversationDisplayName(number, conversation);
          const [background, color] = core.avatarColor(name);
          return `<button type="button" class="overview-row" data-number="${escapeHtml(number)}"><span class="contact-avatar" style="background:${background};color:${color}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(conversation.lastMessage || 'Sem mensagens')}</small></span><time>${formatRelativeTime(conversation.lastMessageAt)}</time></button>`;
        }).join('')
      : '<p class="panel-empty">Nenhuma conversa registrada ainda.</p>';
    els.overviewList.querySelectorAll('[data-number]').forEach((button) => button.addEventListener('click', () => core.openConversation(button.dataset.number)));
  }

  function setupDashboardCards() {
    if (els.dashCardOpen) els.dashCardOpen.addEventListener('click', () => {
      core.setConversationFilter('all');
      showPage('inbox');
    });
    if (els.dashCardFinalized) els.dashCardFinalized.addEventListener('click', () => {
      core.setConversationFilter('finalized');
      showPage('inbox');
    });
  }

  document.querySelectorAll('[data-chart-days]').forEach((button) => button.addEventListener('click', () => {
    chartDays = Number(button.dataset.chartDays);
    document.querySelectorAll('[data-chart-days]').forEach((item) => {
      item.classList.toggle('is-active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    renderActivityChart();
  }));

  core.DashboardPage = { init: setupDashboardCards, render: renderDashboard };
})(window.AppCore);