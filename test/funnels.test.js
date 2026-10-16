const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('funnels preserve legacy boards, isolate accounts and scopes, and record lifecycle history', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-funnels-'));
  process.env.STORAGE_DIR = folder;
  process.env.ADMIN_USERNAME = 'funnels-owner'; process.env.ADMIN_PASSWORD = 'test-password';
  delete process.env.DATABASE_URL; delete process.env.DATABASE_PRIVATE_URL;
  const { server, io, bot, db } = require('../server');
  await db.ready;
  t.after(async () => { await new Promise(resolve => io.close(resolve)); await db.close(); assert.equal(path.dirname(folder), os.tmpdir()); fs.rmSync(folder, { recursive: true, force: true }); });
  bot.ensureWorker = () => ({ child: { connected: true } });
  bot.request = async (_, action) => action === 'state' ? { conversations: {}, status: {} } : { ok: true };
  const now = new Date().toISOString();
  const old = await db.run('INSERT INTO kanban_columns(name,position,created_at,account_id,created_by) VALUES (?,0,?,1,1)', ['Etapa antiga', now]);
  const oldOpp = await db.run('INSERT INTO opportunities(title,column_id,created_at,updated_at,account_id,created_by) VALUES (?,?,?, ?,1,1)', ['Histórico preservado', old.lastID, now, now]);
  await require('../funnel-migration').migrate(db);
  const legacy = await db.get('SELECT * FROM kanban_columns WHERE id = ?', [old.lastID]);
  assert.ok(legacy.funnel_id);
  await require('../funnel-migration').migrate(db);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM funnels')).n, 1);
  assert.equal((await db.get('SELECT * FROM opportunities WHERE id = ?', [oldOpp.lastID])).column_id, old.lastID);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = {};
  async function request(who, url, method = 'GET', body) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: cookies[who] || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookies[who] = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  async function create(url, body, who = 'owner') {
    const result = await request(who, url, 'POST', body); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
  }
  assert.equal((await request('owner', '/api/login', 'POST', { username: 'funnels-owner', password: 'test-password' })).status, 200);
  const funnel = (await create('/api/kanban/funnels', { name: 'Comercial' })).funnel;
  const stage = (await create('/api/kanban/columns', { name: 'Proposta', funnel_id: funnel.id })).column;
  const item = (await create('/api/kanban/opportunities', { title: 'Contrato', column_id: stage.id })).opportunity;
  await request('owner', `/api/kanban/funnels/${funnel.id}`, 'PUT', { name: 'Vendas' });
  await request('owner', `/api/kanban/opportunities/${item.id}/win`, 'POST');
  const entries = (await request('owner', `/api/kanban/funnels/${funnel.id}/history`)).body.entries;
  assert.equal(entries.length, 5);
  assert.ok(entries.some(entry => /ganha/.test(entry.description)));
  const foreign = await db.run('INSERT INTO funnels(name,account_id,created_by,created_at) VALUES (?,999,999,?)', ['Outra conta', now]);
  for (const [method, suffix] of [['GET','/history'], ['PUT',''], ['DELETE','']]) assert.equal((await request('owner', `/api/kanban/funnels/${foreign.lastID}${suffix}`, method, method === 'PUT' ? { name: 'Inválido' } : undefined)).status, 404);
  const member = (await create('/api/team', { name: 'Atendente', email: 'funnels-member@test.invalid', password: 'test-password', role: 'Atendente' })).member;
  const permissions = ['funis.visualizar', 'funis.criar', 'funis.editar', 'funis.excluir'];
  assert.equal((await request('owner', `/api/team/${member.id}/permissions`, 'PUT', { permissions, funnels: [old.lastID], scope: 'own' })).status, 200);
  assert.equal((await request('member', '/api/login', 'POST', { username: member.username, password: 'test-password' })).status, 200);
  const restricted = (await create('/api/kanban/columns', { name: 'Restrita', funnel_id: legacy.funnel_id })).column;
  const visible = (await request('member', '/api/kanban')).body;
  assert.deepEqual(visible.funnels.map(row => row.id), [legacy.funnel_id]);
  assert.equal(visible.funnels[0].canManage, false);
  assert.equal(visible.columns.some(row => row.id === restricted.id), false);
  assert.equal(visible.opportunities.length, 0);
  assert.equal((await request('member', `/api/kanban/funnels/${legacy.funnel_id}`, 'PUT', { name: 'Sem acesso' })).status, 403);
  assert.equal((await request('member', `/api/kanban/funnels/${legacy.funnel_id}`, 'DELETE')).status, 403);
  assert.equal((await request('member', '/api/kanban/columns', 'POST', { name: 'Sem acesso', funnel_id: legacy.funnel_id })).status, 403);
  const own = (await create('/api/kanban/funnels', { name: 'Meu funil' }, 'member')).funnel;
  const ownStage = (await create('/api/kanban/columns', { name: 'Meu contato', funnel_id: own.id }, 'member')).column;
  assert.ok((await request('member', '/api/kanban')).body.columns.some(row => row.id === ownStage.id));
  assert.equal((await request('owner', `/api/kanban/funnels/${funnel.id}`, 'DELETE')).status, 200);
  assert.equal(await db.get('SELECT id FROM opportunities WHERE id = ?', [item.id]), undefined);
  assert.ok(await db.get('SELECT id FROM opportunities WHERE id = ?', [oldOpp.lastID]));
});
