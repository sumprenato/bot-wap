const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-multi-ui-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'multi-ui';
process.env.ADMIN_PASSWORD = 'multi-ui-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    const number = '5511988887777', states = new Map(), sent = [];
    bot.ensureWorker = (chip) => {
      if (!states.has(chip.id)) states.set(chip.id, { conversations: { [number]: { number, name: 'Mesmo cliente', messages: [{ from: 'client', text: `Histórico de ${chip.name}`, at: new Date().toISOString() }] } }, activeTarget: number, status: { connected: true, admin: chip.number } });
      if (!bot.workers.has(chip.id)) bot.workers.set(chip.id, { chip, child: { connected: true, killed: false, exitCode: null }, status: states.get(chip.id).status });
      return bot.workers.get(chip.id);
    };
    bot.stopChip = (id) => bot.workers.delete(id);
    bot.request = async (chip, action, payload = {}) => {
      const entry = bot.ensureWorker(chip), state = states.get(chip.id);
      if (action === 'state') return state;
      if (action === 'status') return { status: entry.status };
      if (action === 'contacts') return [{ number, name: 'Mesmo cliente' }];
      if (action === 'sync-contacts') return { connected: true };
      if (action === 'profile-picture') return { connected: true, profilePic: '' };
      if (action === 'reply' || action === 'reply-media') {
        sent.push({ chipId: chip.id, action });
        state.conversations[number].messages.push({ from: 'admin', text: payload.text || payload.media?.caption, type: payload.media?.type, mediaUrl: payload.media?.mediaUrl, fileName: payload.media?.fileName, at: new Date().toISOString() });
        return { conversation: state.conversations[number], activeTarget: number };
      }
      return { ok: true };
    };
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000); page.on('pageerror', (error) => errors.push(error.message));
    await context.request.post(base + '/api/login', { data: { username: 'multi-ui', password: 'multi-ui-password' } });
    const department = (await (await context.request.post(base + '/api/departments', { data: { name: 'Atendimento' } })).json()).department;
    const channels = [];
    for (const name of ['Comercial', 'Suporte']) channels.push((await (await context.request.post(base + '/api/chips', { data: { name, departmentId: department.id } })).json()).chip);
    const [first, second] = channels;
    const user = await db.get('SELECT id FROM users WHERE username = ?', ['multi-ui']);
    const status = (chip, connected) => {
      states.get(chip.id).status.connected = connected;
      bot.emit('event', { userId: user.id, chipId: chip.id, event: 'status', payload: states.get(chip.id).status });
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/atendimento');
    await page.locator('#inboxChipSelect').waitFor();
    await page.locator('.convo-item').click();
    await page.getByText('Histórico de Comercial', { exact: true }).waitFor();
    await page.locator('#inboxChipSelect').selectOption(String(second.id));
    await page.locator('.convo-item').click();
    await page.getByText('Histórico de Suporte', { exact: true }).waitFor();
    assert.equal(await page.getByText('Histórico de Comercial', { exact: true }).count(), 0);
    await page.locator('#composerInput').fill('Resposta somente do Suporte'); await page.locator('#sendBtn').click();
    await page.getByText('Resposta somente do Suporte', { exact: true }).last().waitFor();
    assert.equal(sent.at(-1).chipId, second.id);
    await page.locator('#fileInput').setInputFiles({ name: 'teste.txt', mimeType: 'text/plain', buffer: Buffer.from('Arquivo do Suporte') });
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !document.getElementById('sendBtn')?.disabled);
    assert.equal(sent.at(-1).chipId, second.id); assert.equal(sent.at(-1).action, 'reply-media');
    bot.emit('event', { userId: user.id, chipId: first.id, event: 'message', payload: { ...states.get(first.id).conversations[number], messages: [{ from: 'client', text: 'Mensagem de outro chip', at: new Date().toISOString() }] } });
    await page.waitForTimeout(150);
    assert.equal(await page.getByText('Mensagem de outro chip', { exact: true }).count(), 0);
    status(first, false);
    await page.waitForFunction(() => !document.getElementById('sendBtn')?.disabled);
    status(second, false);
    await page.waitForFunction(() => document.getElementById('sendBtn')?.disabled);
    status(first, true);
    await page.waitForFunction(() => document.getElementById('connText')?.textContent === 'Conectado');
    assert.equal(await page.locator('#sendBtn').isDisabled(), true, 'another online chip cannot enable sending on an offline channel');
    status(second, true);
    await page.waitForFunction(() => !document.getElementById('sendBtn')?.disabled);

    // Delay the old channel response until after the new channel has loaded.
    let release, entered, fulfilled;
    const received = new Promise((resolve) => { entered = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    const delivered = new Promise((resolve) => { fulfilled = resolve; });
    await page.route(`**/api/state?chipId=${first.id}`, async (route) => { const response = await route.fetch(); entered(); await held; await route.fulfill({ response }); fulfilled(); });
    await page.locator('#inboxChipSelect').selectOption(String(first.id)); await received;
    await page.locator('#inboxChipSelect').selectOption(String(second.id));
    await page.locator('.convo-item').click(); await page.getByText('Histórico de Suporte', { exact: true }).waitFor();
    release(); await delivered; await page.unroute(`**/api/state?chipId=${first.id}`);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#inboxChipSelect').inputValue(), String(second.id));
    assert.equal(await page.getByText('Histórico de Comercial', { exact: true }).count(), 0);
    await page.reload(); await page.getByText('Histórico de Suporte', { exact: true }).waitFor();
    assert.equal(await page.locator('#inboxChipSelect').inputValue(), String(second.id));
    const screenshots = path.resolve(__dirname, '../.tmp'); fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'multi-chip-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.screenshot({ path: path.join(screenshots, 'multi-chip-mobile.png'), fullPage: true });
    await context.request.delete(base + `/api/chips/${second.id}`);
    await page.reload();
    await page.waitForFunction((id) => document.getElementById('inboxChipSelect')?.value === String(id), first.id);
    assert.equal(bot.workers.has(first.id), true);
    assert.deepEqual(errors, []);
    console.log('PASS: independent chip selection, same-number histories, text/media routing, socket isolation, offline sending, stale responses, reload persistence and deleting one channel');
  } finally {
    if (browser) await browser.close(); await new Promise((resolve) => io.close(resolve)); await db.close();
    const target = path.resolve(storageDir);
    if (target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('bot-wap-multi-ui-')) fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
