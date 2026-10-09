const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-chips-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'chips-test-admin';
process.env.ADMIN_PASSWORD = 'chips-test-password';
process.env.ADMIN_NUMBER = '5511999999999';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;

const { server, io, bot, db } = require('../server');
const store = require('../store');

test('all chips start independently and changing the default preserves the other workers', async (t) => {
  await db.ready;

  const started = [];
  const stopped = [];
  bot.ensureWorker = (chip) => {
    if (bot.workers.has(chip.id)) return bot.workers.get(chip.id);
    started.push(String(chip.id));
    const entry = { child: { exitCode: null, killed: false, connected: true } };
    bot.workers.set(chip.id, entry);
    return entry;
  };
  bot.stopChip = (chipId) => {
    stopped.push(String(chipId));
    bot.workers.delete(chipId);
  };
  bot.isAlive = (entry) => !!entry?.child?.connected;
  bot.request = async (chip, action, payload = {}) => {
    if (action === 'status') return { status: { connected: false, qr: 'test-qr' }, admin: chip.number };
    if (action === 'state') return { conversations: {}, activeTarget: null, status: { connected: false, qr: null }, admin: chip.number };
    if (action === 'disconnect') return { ok: true, status: { connected: false, qr: null } };
    if (action === 'set-department') return { ok: true, departmentId: payload.departmentId };
    if (action === 'set-conversation-department') return { conversation: { number: payload.number, departmentId: payload.departmentId } };
    if (action === 'sync-contacts') return { connected: false, synced: false };
    if (action === 'profile-picture') return { number: payload.number, profilePic: '', connected: false };
    throw new Error(`Unexpected worker action: ${action}`);
  };

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function request(url, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (url === '/api/login') cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
    const data = await response.json();
    return { response, data };
  }

  t.after(async () => {
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  const anonymousSession = await fetch(`${baseUrl}/api/session`);
  assert.equal(anonymousSession.status, 200);
  assert.deepEqual(await anonymousSession.json(), { authenticated: false });

  const login = await request('/api/login', {
    method: 'POST',
    body: { username: 'chips-test-admin', password: 'chips-test-password' },
  });
  assert.equal(login.response.status, 200);
  assert.match(login.response.headers.get('set-cookie') || '', /Path=\//i);
  assert.match(login.response.headers.get('set-cookie') || '', /HttpOnly/i);
  const authenticatedSession = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  const sessionInfo = await authenticatedSession.json();
  assert.equal(sessionInfo.authenticated, true);
  assert.ok(sessionInfo.remainingMs > 0 && sessionInfo.remainingMs <= 2 * 60 * 60 * 1000);

  const appRoutes = [
    ['/atendimento', 'inbox'], ['/dashboard', 'overview'], ['/funis', 'kanban'],
    ['/campanhas', 'campaigns'], ['/fluxos', 'flows'], ['/contatos', 'contacts'],
    ['/webhooks', 'webhooks'], ['/departamentos', 'departments'], ['/tags', 'tags'],
    ['/chips', 'chips'], ['/configuracoes', 'settings'],
  ];
  const legacyFunnel = await fetch(baseUrl + '/kanban?source=legacy', { headers: { cookie }, redirect: 'manual' });
  assert.equal(legacyFunnel.status, 302);
  assert.equal(legacyFunnel.headers.get('location'), '/funis?source=legacy');
  const routeEditors = {
    inbox: ['tagsModal', 'bulkTransferModal'],
    campaigns: ['campaignModal'],
    webhooks: ['webhookModal'],
    kanban: ['opportunityModal', 'loseModal', 'lossReasonsModal'],
    flows: ['flowModal', 'globalVarsModal'],
  };
  const pageEditors = [
    'tagsModal', 'bulkTransferModal', 'campaignModal', 'webhookModal',
    'opportunityModal', 'loseModal', 'lossReasonsModal', 'flowModal', 'globalVarsModal',
  ];
  for (const [route, page] of appRoutes) {
    const response = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
    assert.equal(response.status, 200, `${route} should load`);
    const html = await response.text();
    assert.deepEqual([...html.matchAll(/data-page-view="([^"]+)"/g)].map((match) => match[1]), [page]);
    assert.equal(html.includes('id="listSidebar"'), page === 'inbox');
    assert.match(html, /defer src="\/assets\/js\/site\.js/);
    assert.equal(html.includes('/assets/js/pages/'), false);
    assert.equal(html.includes('/assets/js/app.js'), false);
    assert.equal(html.includes('cdn.socket.io'), false);
    for (const stylePage of ['campaigns', 'webhooks', 'kanban', 'flows']) {
      assert.equal(html.includes(`/assets/css/pages/${stylePage}.css`), page === stylePage);
    }
    assert.equal(html.includes('/assets/css/pages/chips.css'), page === 'chips');
    assert.equal(html.includes('/assets/css/components.css'), ['campaigns', 'webhooks', 'flows', 'chips', 'settings'].includes(page));
    for (const editor of pageEditors) {
      assert.equal(html.includes(`id="${editor}"`), (routeEditors[page] || []).includes(editor), `${editor} on ${route}`);
    }
    assert.equal(html.includes('id="profileModal"'), false);
    assert.equal(html.includes('id="profileForm"'), page === 'settings');
    assert.match(html, /id="confirmModal"/);
    if (page === 'chips') assert.match(html, /id="chipsList"/);
    if (page === 'tags') assert.match(html, /id="tagsSettingsList"/);
    if (page === 'departments') assert.match(html, /id="deptsSettingsList"/);
  }

  for (const assetPath of ['/assets/css/global.css', '/assets/css/components.css', '/assets/css/pages/campaigns.css', '/assets/css/pages/webhooks.css', '/assets/css/pages/kanban.css', '/assets/css/pages/flows.css', '/assets/css/pages/chips.css', '/assets/js/workspace.js', '/assets/js/app.js', '/assets/js/pages/campaigns.js', '/assets/js/pages/webhooks.js', '/assets/js/pages/kanban.js', '/assets/js/pages/flows.js', '/assets/js/pages/chips.js', '/assets/js/pages/contacts.js', '/assets/js/pages/dashboard.js', '/assets/js/pages/settings.js', '/config/config.js']) {
    const assetResponse = await fetch(`${baseUrl}${assetPath}`, { headers: { cookie } });
    assert.equal(assetResponse.status, 200, `${assetPath} should be served`);
  }

  const departmentResult = await request('/api/departments', {
    method: 'POST',
    body: { name: 'Financeiro', description: 'Atendimento financeiro' },
  });
  assert.equal(departmentResult.response.status, 201);
  const departmentId = departmentResult.data.department.id;
  await store.addMessage('5511988887777', 'client', 'primeira mensagem');
  await store.setDefaultConversationDepartment('5511988887777', departmentId);
  assert.equal((await store.getConversation('5511988887777')).departmentId, departmentId);

  const tagResult = await request('/api/tags', {
    method: 'POST',
    body: { name: 'VIP', color: '#ff9900' },
  });
  assert.equal(tagResult.response.status, 201);
  const editTag = await request(`/api/tags/${tagResult.data.tag.id}`, {
    method: 'PUT',
    body: { name: 'Cliente VIP', color: '#00aa88' },
  });
  assert.equal(editTag.response.status, 200);
  assert.equal(editTag.data.tag.name, 'Cliente VIP');

  const missingDepartment = await request('/api/chips', {
    method: 'POST',
    body: { name: 'Sem departamento', number: '5511999999998' },
  });
  assert.equal(missingDepartment.response.status, 400);

  const first = await request('/api/chips', {
    method: 'POST',
    body: { name: 'Principal', departmentId },
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.data.chip.is_primary, 1);
  assert.equal(first.data.chip.number, null);
  assert.deepEqual(started, [String(first.data.chip.id)]);
  const primaryStatus = await request(`/api/chips/${first.data.chip.id}/status`);
  assert.equal(primaryStatus.data.qr, 'test-qr');
  assert.equal(primaryStatus.data.isPrimary, true);

  const second = await request('/api/chips', {
    method: 'POST',
    body: { name: 'Reserva', number: '5511999999997', departmentId },
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.data.chip.is_primary, 0);
  assert.equal(second.data.chip.number, null, 'typed numbers from old clients must not establish identity');
  assert.deepEqual(started, [String(first.data.chip.id), String(second.data.chip.id)]);

  const secondaryStatus = await request(`/api/chips/${second.data.chip.id}/status`);
  assert.equal(secondaryStatus.data.connected, false);
  assert.equal(secondaryStatus.data.qr, 'test-qr');

  const promote = await request(`/api/chips/${second.data.chip.id}/primary`, { method: 'POST' });
  assert.equal(promote.response.status, 200);
  assert.equal(promote.data.chip.is_primary, 1);
  assert.deepEqual(stopped, []);
  assert.deepEqual(started, [String(first.data.chip.id), String(second.data.chip.id)]);

  const chipsAfterPromotion = await request('/api/chips');
  assert.equal(chipsAfterPromotion.data.chips.filter((chip) => chip.is_primary).length, 1);

  await bot.verifyIdentity(second.data.chip.id, '5511999990000');
  assert.equal((await request('/api/chips')).data.chips.find((chip) => chip.id === second.data.chip.id).number, '5511999990000');
  await assert.rejects(() => bot.verifyIdentity(second.data.chip.id, '5511999990001'), /outro número/);
  assert.equal((await db.get('SELECT number FROM chips WHERE id = ?', [second.data.chip.id])).number, '5511999990000');
  await assert.rejects(() => bot.verifyIdentity(first.data.chip.id, '5511999990000'), /já está vinculado/);

  const supportDepartment = await request('/api/departments', {
    method: 'POST',
    body: { name: 'Suporte' },
  });
  await store.setConversationDepartment('5511988887777', supportDepartment.data.department.id);
  await store.setDefaultConversationDepartment('5511988887777', departmentId);
  assert.equal((await store.getConversation('5511988887777')).departmentId, supportDepartment.data.department.id);
  const reassignment = await request(`/api/chips/${second.data.chip.id}/department`, {
    method: 'PUT',
    body: { name: 'Canal Suporte', departmentId: supportDepartment.data.department.id },
  });
  assert.equal(reassignment.response.status, 200);
  assert.equal(reassignment.data.chip.department_id, supportDepartment.data.department.id);
  assert.equal(reassignment.data.chip.name, 'Canal Suporte');
  const protectedDepartmentDelete = await request(`/api/departments/${supportDepartment.data.department.id}`, { method: 'DELETE' });
  assert.equal(protectedDepartmentDelete.response.status, 409);

  const transfer = await request('/api/conversations/bulk-department', {
    method: 'POST',
    body: { chipId: second.data.chip.id, numbers: ['5511988887777'], departmentId: supportDepartment.data.department.id },
  });
  assert.equal(transfer.response.status, 200);
  assert.equal(transfer.data.updated, 1);

  const removePrimary = await request(`/api/chips/${second.data.chip.id}`, { method: 'DELETE' });
  assert.equal(removePrimary.response.status, 200);
  const chipsAfterRemoval = await request('/api/chips');
  assert.equal(chipsAfterRemoval.data.chips.length, 1);
  assert.equal(chipsAfterRemoval.data.chips[0].id, first.data.chip.id);
  assert.equal(chipsAfterRemoval.data.chips[0].is_primary, 1);
  assert.ok(bot.workers.has(first.data.chip.id));
  assert.ok(!bot.workers.has(second.data.chip.id));
});
