const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-multi-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'multi-test';
process.env.ADMIN_PASSWORD = 'multi-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

test('two live chips isolate same-number conversations, all actions and worker lifecycle', async (t) => {
  await db.ready;
  const states = new Map(), calls = [], stopped = [], clientNumber = '5511988887777';
  bot.ensureWorker = (chip) => {
    if (!states.has(chip.id)) states.set(chip.id, { conversations: {}, activeTarget: null, status: { connected: true, qr: null } });
    if (!bot.workers.has(chip.id)) bot.workers.set(chip.id, { chip, child: { connected: true, killed: false, exitCode: null }, status: states.get(chip.id).status });
    return bot.workers.get(chip.id);
  };
  bot.stopChip = (id) => { stopped.push(id); bot.workers.delete(id); };
  bot.request = async (chip, action, payload = {}) => {
    bot.ensureWorker(chip); calls.push({ chipId: chip.id, action, payload });
    const state = states.get(chip.id);
    if (state.fail) throw new Error('Worker temporariamente indisponível.');
    if (action === 'state') return state;
    if (action === 'status') return { status: state.status };
    if (action === 'contacts') return [{ number: clientNumber, name: chip.name }];
    if (action === 'sync-contacts') return { connected: true };
    if (action === 'profile-picture') return { profilePic: chip.name, connected: true };
    if (action === 'disconnect') { state.status.connected = false; return { ok: true, status: state.status }; }
    if (action === 'assume') { state.activeTarget = payload.number; return { activeTarget: payload.number }; }
    if (action === 'get-conversation-tags') return { tags: state.conversations[payload.number]?.tags || [] };
    const conversation = state.conversations[payload.number] ||= { number: payload.number, messages: [] };
    if (action === 'reply' || action === 'reply-media') {
      if (!state.status.connected) throw new Error('Canal desconectado.');
      conversation.messages.push({ from: 'admin', text: payload.text || payload.media?.caption, type: payload.media?.type });
      return { conversation, activeTarget: payload.number };
    }
    if (action === 'block') conversation.blocked = payload.blocked;
    if (action === 'set-conversation-tags') conversation.tags = payload.tags;
    if (action === 'set-conversation-department') conversation.departmentId = payload.departmentId;
    if (action === 'finalize-conversation') conversation.isFinalized = true;
    if (action === 'reopen-conversation') conversation.isFinalized = false;
    if (action === 'clear') conversation.messages = [];
    if (action === 'delete') { delete state.conversations[payload.number]; return { conversation: null }; }
    return { conversation };
  };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', socket;
  t.after(async () => { socket?.disconnect(); await new Promise((resolve) => io.close(resolve)); await db.close(); fs.rmSync(storageDir, { recursive: true, force: true }); });
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    if (url === '/api/login') cookie = response.headers.get('set-cookie').split(';')[0];
    return { code: response.status, ...(await response.json()) };
  };
  await request('/api/login', 'POST', { username: 'multi-test', password: 'multi-password' });
  const department = (await request('/api/departments', 'POST', { name: 'Equipe' })).department;
  const first = (await request('/api/chips', 'POST', { name: 'Comercial', departmentId: department.id })).chip;
  const second = (await request('/api/chips', 'POST', { name: 'Suporte', departmentId: department.id })).chip;
  assert.equal(bot.workers.size, 2);
  await bot.verifyIdentity(first.id, '5511999991111');
  await bot.verifyIdentity(second.id, '5511999992222');
  await assert.rejects(() => bot.verifyIdentity(second.id, '5511999991111'), /outro número/);
  for (const chip of [first, second]) states.get(chip.id).conversations[clientNumber] = { number: clientNumber, name: 'Mesmo cliente', messages: [{ text: chip.name }], tags: [] };
  assert.equal((await request(`/api/state?chipId=${first.id}`)).conversations[clientNumber].messages[0].text, 'Comercial');
  const state = await request(`/api/state?chipId=${second.id}`);
  assert.equal(state.chipId, second.id); assert.equal(state.chips.filter((chip) => chip.connected).length, 2);
  assert.equal(state.conversations[clientNumber].messages[0].text, 'Suporte');
  assert.equal(state.conversations[clientNumber].chipId, second.id);
  assert.equal((await request('/api/reply', 'POST', { number: clientNumber, text: 'ambígua' })).code, 409);
  const reply = await request('/api/reply', 'POST', { chipId: second.id, number: clientNumber, text: 'Resposta do Suporte' });
  assert.equal(reply.code, 200); assert.equal(reply.conversation.chipId, second.id);
  const file = new FormData(); file.append('number', clientNumber); file.append('chipId', String(second.id)); file.append('file', new Blob(['arquivo'], { type: 'text/plain' }), 'teste.txt');
  assert.equal((await request('/api/reply-media', 'POST', file)).code, 200);
  const operations = [
    ['/api/assumir', { number: clientNumber }],
    ['/api/conversation/block', { number: clientNumber, blocked: true }],
    [`/api/conversation/${clientNumber}/tags`, { tags: ['VIP'] }],
    [`/api/conversation/${clientNumber}/finalize`, {}],
    [`/api/conversation/${clientNumber}/reopen`, {}],
    ['/api/conversations/bulk-tags', { numbers: [clientNumber], tags: ['Teste'], action: 'add' }],
    ['/api/conversations/bulk-department', { numbers: [clientNumber], departmentId: department.id }],
  ];
  for (const [url, body] of operations) assert.equal((await request(url + `?chipId=${second.id}`, 'POST', body)).code, 200, url);
  assert.deepEqual(states.get(first.id).conversations[clientNumber], { number: clientNumber, name: 'Mesmo cliente', messages: [{ text: 'Comercial' }], tags: [] });
  assert.equal((await request(`/api/contacts?chipId=${second.id}`)).contacts[0].name, 'Suporte');
  assert.equal((await request(`/api/whatsapp/profile/me?chipId=${second.id}`)).profilePic, 'Suporte');
  assert.equal((await request('/api/reply', 'POST', { chipId: 999, number: clientNumber, text: 'Não enviar' })).code, 404);
  const user = await db.get('SELECT id FROM users WHERE username = ?', ['multi-test']);
  const foreign = await db.run('INSERT INTO chips(name,user_id,created_at) VALUES (?, ?, ?)', ['Outra conta', user.id + 99, new Date().toISOString()]);
  assert.equal((await request('/api/reply', 'POST', { chipId: foreign.lastID, number: clientNumber, text: 'Não enviar' })).code, 404);

  socket = connect(base, { extraHeaders: { Cookie: cookie }, auth: { chipId: second.id }, transports: ['websocket'] });
  const initialized = await new Promise((resolve, reject) => { socket.once('init', resolve); socket.once('connect_error', reject); });
  assert.equal(initialized.chipId, second.id);
  const event = new Promise((resolve) => socket.once('message', resolve));
  bot.emit('event', { userId: user.id, chipId: first.id, event: 'message', payload: states.get(first.id).conversations[clientNumber] });
  assert.equal((await event).chipId, first.id);

  await request(`/api/chips/${second.id}/primary`, 'POST');
  assert.deepEqual(stopped, []); assert.equal(bot.workers.size, 2);
  await request(`/api/chips/${first.id}/disconnect`, 'POST');
  assert.equal(states.get(second.id).status.connected, true);
  assert.equal((await request(`/api/state?chipId=${first.id}`)).status.connected, true);
  assert.equal((await request(`/api/state?chipId=${first.id}`)).channelStatus.connected, false);
  states.get(first.id).fail = true;
  assert.equal((await request(`/api/state?chipId=${second.id}`)).conversations[clientNumber].messages.length, 3, 'a broken worker must not affect a healthy channel');
  assert.equal((await request('/api/reply', 'POST', { chipId: second.id, number: clientNumber, text: 'Ainda funciona' })).code, 200);
  await request('/api/conversation/clear', 'POST', { chipId: second.id, number: clientNumber });
  assert.equal(states.get(first.id).conversations[clientNumber].messages.length, 1);
  await request('/api/conversation/delete', 'POST', { chipId: second.id, number: clientNumber });
  assert.ok(states.get(first.id).conversations[clientNumber]);
  await request(`/api/chips/${second.id}`, 'DELETE');
  assert.deepEqual(stopped, [second.id]); assert.ok(bot.workers.has(first.id));
});
