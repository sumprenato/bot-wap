(function (core) {
  const { escapeHtml, formatPhoneDisplay, formatRelativeTime, isInternalWhatsAppId, avatarColor, openConversation } = core;
  const getContacts = core.getContacts;
  const getTags = core.getTags;

  function downloadCsv(rows, filename) {
    const cell = value => {
      let text = String(value || '');
      if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const importPanel = document.getElementById('importContactsPanel');
  const importButton = document.getElementById('importContactsBtn');
  const importForm = document.getElementById('importContactsForm');
  const importFile = document.getElementById('importContactsFile');
  const importError = document.getElementById('importContactsError');
  const importResult = document.getElementById('importContactsResult');
  const importSubmit = document.getElementById('submitContactsImport');
  const importCancel = document.getElementById('cancelContactsImport');

  function showImportResult(data, success) {
    importResult.replaceChildren();
    const summary = document.createElement('p');
    summary.textContent = success
      ? `${data.imported} novo(s), ${data.updated} atualizado(s), ${data.duplicates} repetido(s) agrupado(s) e ${data.rejected} linha(s) rejeitada(s). Destino: ${data.chip.name || data.chip.number}.`
      : `${data.rejected || 0} linha(s) rejeitada(s). Nenhum contato foi importado.`;
    importResult.append(summary);
    if (data.errors?.length) {
      const details = document.createElement('details');
      const label = document.createElement('summary');
      label.textContent = `Ver linhas rejeitadas (${data.errors.length}${data.rejected > data.errors.length ? ' primeiras' : ''})`;
      const list = document.createElement('ul');
      for (const entry of data.errors) {
        const item = document.createElement('li');
        item.textContent = `Linha ${entry.line}: ${entry.error}`;
        list.append(item);
      }
      details.append(label, list);
      importResult.append(details);
    }
    importResult.hidden = false;
    importResult.focus();
  }

  importButton?.addEventListener('click', () => {
    importPanel.hidden = false;
    importButton.setAttribute('aria-expanded', 'true');
    importPanel.scrollIntoView({ block: 'nearest' });
    importFile.focus();
  });
  importCancel?.addEventListener('click', () => {
    importPanel.hidden = true;
    importButton.setAttribute('aria-expanded', 'false');
    importButton.focus();
  });
  document.getElementById('downloadContactsTemplate')?.addEventListener('click', () => {
    downloadCsv([['Nome', 'Telefone', 'Rótulos'], ['Maria Exemplo', '5511999999999', 'Cliente, Novo']], 'modelo-contatos.csv');
  });
  importForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (importSubmit.disabled) return;
    importError.hidden = true;
    importResult.hidden = true;
    const file = importFile.files[0];
    if (!file || !/\.csv$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      importError.textContent = 'Selecione um arquivo .csv de até 2 MB.';
      importError.hidden = false;
      return;
    }
    importSubmit.disabled = importCancel.disabled = importFile.disabled = true;
    importSubmit.textContent = 'Importando…';
    importForm.setAttribute('aria-busy', 'true');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await BotWapApi.request('/api/contacts/import', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) {
        if (data.errors?.length) showImportResult(data, false);
        throw new Error(data.error || 'Não foi possível importar os contatos. Tente novamente.');
      }
      showImportResult(data, true);
      importFile.value = '';
      document.getElementById('contactsPageSearch').value = '';
      document.getElementById('contactsTagFilter').value = '';
      core.resetTablePage('contacts');
      try { await core.refreshContacts(); }
      catch { core.showToast('Importação salva. Não foi possível atualizar a lista; recarregue a página.', 'error'); }
    } catch (error) {
      importError.textContent = error.message || 'Falha de conexão. Confira a lista antes de tentar novamente.';
      importError.hidden = false;
    } finally {
      importSubmit.disabled = importCancel.disabled = importFile.disabled = false;
      importSubmit.textContent = 'Importar arquivo';
      importForm.removeAttribute('aria-busy');
    }
  });

  function filteredPageContacts() {
    const term = document.getElementById('contactsPageSearch').value.trim().toLocaleLowerCase('pt-BR');
    const tag = document.getElementById('contactsTagFilter').value;
    const order = document.getElementById('contactsPageSort').value;
    const filtered = getContacts().filter((contact) => {
      const name = contact.name || contact.pushName || '';
      const number = isInternalWhatsAppId(contact.number, contact) ? '' : contact.number;
      return `${name} ${number} ${formatPhoneDisplay(number)}`.toLocaleLowerCase('pt-BR').includes(term)
        && (!tag || (contact.tags || []).includes(tag));
    });
    return filtered.sort((a, b) => order === 'recent'
      ? (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')
      : (a.name || a.pushName || '').localeCompare(b.name || b.pushName || '', 'pt-BR'));
  }

  function renderContactsTable() {
    const host = document.getElementById('contactsTable');
    if (!host) return;
    const tagSelect = document.getElementById('contactsTagFilter');
    const selectedTag = tagSelect.value;
    const contacts = getContacts();
    const allTags = getTags();
    const names = [...new Set([...allTags.map((tag) => tag.name), ...contacts.flatMap((contact) => contact.tags || [])])]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    tagSelect.innerHTML = '<option value="">Todas as tags</option>' + names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    tagSelect.value = names.includes(selectedTag) ? selectedTag : '';
    const filtered = filteredPageContacts();
    document.getElementById('contactsPageCount').textContent = `${filtered.length} contato${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}`;
    const exportButton = document.getElementById('exportContactsBtn');
    exportButton.textContent = `Exportar ${filtered.length} contato${filtered.length === 1 ? '' : 's'}`;
    exportButton.disabled = !filtered.length;
    core.renderDataTable(host, 'contacts', filtered, ['Nome', 'Rótulos', 'Telefone', 'Última atividade', 'Ações'], (contact) => {
      const internal = isInternalWhatsAppId(contact.number, contact);
      const name = contact.name || contact.pushName || 'Contato sem nome';
      const [background, color] = avatarColor(name);
      const tags = (contact.tags || []).map((tagName) => {
        const tag = allTags.find((item) => item.name === tagName);
        const tagColor = /^#[\da-f]{6}$/i.test(tag?.color || '') ? tag.color : '#3ddc84';
        return `<span class="table-tag" style="--tag-color:${tagColor}">${escapeHtml(tagName)}</span>`;
      }).join('');
      return `<tr><td><div class="table-contact"><span class="contact-avatar" style="background:${background};color:${color}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(name)}</strong></div></td>
        <td><div class="table-tags">${tags || '<span class="cell-muted">Sem rótulo</span>'}</div></td>
        <td class="phone-cell">${internal ? '<span class="cell-muted">Não identificado</span>' : escapeHtml(formatPhoneDisplay(contact.number))}</td>
        <td class="cell-muted">${escapeHtml(contact.lastSeenAt ? formatRelativeTime(contact.lastSeenAt) : 'Sem atividade')}</td>
        <td><button type="button" class="table-action" data-contact-number="${escapeHtml(contact.number)}">Conversar <span aria-hidden="true">↗</span></button></td></tr>`;
    }, renderContactsTable, 'Nenhum contato encontrado. Ajuste os filtros ou conecte seu WhatsApp em Meus chips.');
    host.querySelectorAll('[data-contact-number]').forEach((button) => button.addEventListener('click', () => {
      openConversation(button.dataset.contactNumber);
    }));
  }

  ['contactsPageSearch', 'contactsTagFilter', 'contactsPageSort'].forEach((id) => {
    document.getElementById(id)?.addEventListener(id === 'contactsPageSearch' ? 'input' : 'change', () => {
      core.resetTablePage('contacts');
      renderContactsTable();
    });
  });

  document.getElementById('exportContactsBtn')?.addEventListener('click', () => {
    const rows = [['Nome', 'Telefone', 'Rótulos'], ...filteredPageContacts().map((contact) => [
      contact.name || contact.pushName || '',
      isInternalWhatsAppId(contact.number, contact) ? '' : contact.number,
      (contact.tags || []).join(', '),
    ])];
    downloadCsv(rows, 'contatos-bot-wap.csv');
  });

  core.ContactsPage = { render: renderContactsTable };
})(window.AppCore);
