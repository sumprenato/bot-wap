const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseContactCsv, decodeContactCsv } = require('../contact-import');

test('CSV round-trip: BOM, export quoting, international numbers, accents and tags', () => {
  const result = parseContactCsv('\uFEFF"Nome";"Telefone";"Rótulos"\r\n"João ""Silva""";"\'+55 (11) 98888-7777";"VIP, Novo"\r\n');
  assert.deepEqual(result.contacts, [{ number: '5511988887777', name: 'João "Silva"', tags: ['VIP', 'Novo'], line: 2 }]);
  assert.equal(result.errors.length, 0);
  const comma = parseContactCsv('Name,Phone,Tags\n"Ana, Maria\nSouza",14155552671,Cliente');
  assert.equal(comma.contacts[0].name, 'Ana, Maria\nSouza');
  assert.equal(comma.contacts[0].number, '14155552671');
});

test('CSV reports bad rows, merges duplicates and refuses malformed/header-only/oversized files', () => {
  const result = parseContactCsv('Nome;Telefone;Rótulos\nAna;5511988887777;VIP\n;5511988887777;Novo\nRuim;123;\nOutro;abc5511988887777;\nExtra;5511988887777;;\n');
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].name, 'Ana');
  assert.deepEqual(result.contacts[0].tags, ['VIP', 'Novo']);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.errors.map(item => item.line), [4, 5, 6]);
  for (const csv of ['', 'Nome;Email\nAna;a@b.c', 'Nome;Telefone', 'Nome;Telefone\n"Ana;123', 'Nome;Telefone\n"Ana"oops;123']) {
    assert.throws(() => parseContactCsv(csv));
  }
  assert.throws(() => parseContactCsv('Telefone\n' + '5511988887777\n'.repeat(5001)), /5000/);
  assert.throws(() => decodeContactCsv(Buffer.from([0xff, 0xfe])), /UTF-8/);
});

test('authenticated CSV upload persists, updates safely and routes to the owner primary chip', async t => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-import-'));
  process.env.STORAGE_DIR = storageDir;
  process.env.ADMIN_USERNAME = 'import-test';
  process.env.ADMIN_PASSWORD = 'import-test-password';
  process.env.ADMIN_NUMBER = '5511999999999';
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  const { server, io, bot, db } = require('../server');
  const store = require('../store');
  await db.ready;
  const importedChips = [];
  bot.ensureWorker = () => ({ child: { connected: true } });
  bot.request = async (chip, action, payload) => {
    if (action === 'sync-contacts') return { connected: false, synced: false };
    if (action === 'import-contacts') { importedChips.push(chip); return store.importContacts(payload.contacts); }
    if (action === 'contacts') return store.getContacts();
    if (action === 'status') return { status: { connected: false } };
    throw new Error(`Unexpected action: ${action}`);
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => io.close(resolve));
    await db.close();
    const target = path.resolve(storageDir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('bot-wap-import-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'import-test', password: 'import-test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const owner = await db.get('SELECT id FROM users WHERE username = ?', ['import-test']);
  const department = await store.createDepartment('Importação', 'Contatos de teste');
  const chipResponse = await fetch(base + '/api/chips', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Principal', number: '5511999998888', departmentId: department.id }),
  });
  assert.equal(chipResponse.status, 201);
  async function upload(csv, session = cookie, filename = 'contatos.csv') {
    const body = new FormData();
    body.append('file', new Blob([csv], { type: 'text/csv' }), filename);
    const response = await fetch(base + '/api/contacts/import', { method: 'POST', headers: session ? { cookie: session } : {}, body });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await upload('Telefone\n5511988887777', '')).status, 401);
  assert.equal((await upload('Nome;Telefone\nRuim;abc')).status, 422);
  assert.equal((await upload('Telefone\n5511988887777', cookie, 'arquivo.xlsx')).status, 400);
  assert.equal((await upload('Telefone\n' + '1'.repeat(2 * 1024 * 1024))).status, 400);
  assert.equal((await store.getContacts()).length, 0);
  const first = await upload('Nome;Telefone;Rótulos\nAna;5511988887777;VIP\n;5511988887777;Novo\nRuim;123;');
  assert.equal(first.status, 200);
  assert.deepEqual([first.data.imported, first.data.updated, first.data.duplicates, first.data.rejected], [1, 0, 1, 1]);
  assert.equal(importedChips[0].user_id, owner.id);
  assert.equal(importedChips[0].is_primary, 1);
  assert.equal((await store.getContact('5511988887777')).jid, '5511988887777@s.whatsapp.net');
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM conversations')).count, 0);
  await db.run('UPDATE contacts SET jid = ?, variables = ?, last_seen_at = ? WHERE number = ?', ['123456789012345@lid', '{"origem":"whatsapp"}', '2026-10-01', '5511988887777']);
  const second = await upload('Nome;Telefone;Rótulos\nAna Maria;5511988887777;Cliente');
  assert.deepEqual([second.data.imported, second.data.updated], [0, 1]);
  const contact = await store.getContact('5511988887777');
  assert.equal(contact.name, 'Ana Maria');
  assert.deepEqual(contact.tags, ['VIP', 'Novo', 'Cliente']);
  assert.equal(contact.jid, '123456789012345@lid');
  assert.equal(contact.lastSeenAt, '2026-10-01');
  assert.deepEqual(contact.variables, { origem: 'whatsapp' });
  const list = await fetch(base + '/api/contacts', { headers: { cookie } });
  assert.equal((await list.json()).contacts.length, 1);
  const registered = await fetch(base + '/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'another-owner', password: 'test-password', confirmPassword: 'test-password' }),
  });
  assert.equal(registered.status, 201);
  const otherCookie = registered.headers.get('set-cookie').split(';')[0];
  assert.equal((await upload('Telefone\n5511988887777', otherCookie)).status, 409);
  const otherList = await fetch(base + '/api/contacts', { headers: { cookie: otherCookie } });
  assert.deepEqual((await otherList.json()).contacts, []);
  assert.equal(importedChips.length, 2);
});
