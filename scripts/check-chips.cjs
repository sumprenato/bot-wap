const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const QRCode = require('qrcode');
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-chips-ui-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'chips-ui';
process.env.ADMIN_PASSWORD = 'chips-ui-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    const qr = await QRCode.toDataURL('bot-wap-ui-fixture-only');
    bot.ensureWorker = (chip) => {
      if (!bot.workers.has(chip.id)) bot.workers.set(chip.id, { chip, child: { exitCode: null, killed: false, connected: true }, status: { connected: !!chip.identity_verified, number: chip.identity_verified ? chip.number : null, qr: chip.identity_verified ? null : qr } });
      return bot.workers.get(chip.id);
    };
    bot.stopChip = (id) => bot.workers.delete(id);
    bot.request = async (chip, action) => {
      const entry = bot.ensureWorker(chip);
      if (action === 'status') return { status: entry.status };
      if (action === 'state') return { conversations: {}, status: entry.status };
      if (action === 'contacts') return [];
      if (action === 'sync-contacts') return { connected: false };
      return { ok: true };
    };
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
    const context = await browser.newContext();
    await context.request.post(base + '/api/login', { data: { username: 'chips-ui', password: 'chips-ui-password' } });
    const result = await (await context.request.post(base + '/api/departments', { data: { name: 'Suporte Comercial' } })).json();
    const departmentId = result.department.id;
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/chips');
    await page.locator('#newChipBtn').click();
    assert.equal(await page.locator('input[type=tel],#chipNumberInput').count(), 0);
    assert.equal(await page.locator('[role=dialog] select').count(), 1, 'only the real department selector is offered');
    await page.locator('#chipNameInput').fill('Comercial');
    await page.locator('#chipDepartmentInput').selectOption(String(departmentId));
    await page.locator('#addChipBtn').click();
    await page.locator('.chip-qr-img').waitFor();
    let chips = (await (await context.request.get(base + '/api/chips')).json()).chips;
    const firstId = chips[0].id;
    assert.equal(chips[0].number, null);
    await bot.verifyIdentity(firstId, '5511999992222');
    const entry = bot.workers.get(firstId);
    entry.chip.number = '5511999992222'; entry.chip.identity_verified = 1;
    entry.status = { connected: true, number: '5511999992222', admin: '5511999992222', qr: null, historySync: { days: 7, importing: false, imported: 237, failed: 0 } };
    bot.emit('event', { userId: entry.chip.user_id, chipId: firstId, chipNumber: entry.chip.number, event: 'status', payload: entry.status });
    await page.getByRole('heading', { name: 'WhatsApp conectado' }).waitFor();
    await page.getByText('237 mensagens do histórico salvas.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    await page.reload();
    await page.locator('.chip-status-pill.is-online').waitFor();
    assert.equal((await page.locator('.chip-number').innerText()).replace(/\D/g, ''), '5511999992222');
    await page.locator('.chip-row-menu summary').click();
    await page.getByRole('button', { name: 'Editar canal', exact: true }).click();
    await page.locator('#chipNameInput').fill('Comercial atualizado');
    await page.locator('#addChipBtn').click();
    await page.getByText('Comercial atualizado', { exact: true }).waitFor();
    await page.locator('#newChipBtn').click();
    await page.locator('#chipNameInput').fill('Suporte');
    await page.locator('#chipDepartmentInput').selectOption(String(departmentId));
    await page.locator('#addChipBtn').click();
    await page.getByText('Suporte', { exact: true }).waitFor();
    await page.locator('.chip-qr-img').waitFor();
    await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    assert.equal(await page.getByText('Aguardando QR', { exact: true }).count(), 1);
    chips = (await (await context.request.get(base + '/api/chips')).json()).chips;
    assert.equal(chips.length, 2);
    assert.equal(chips[1].number, null);
    assert.equal(chips.filter((chip) => chip.is_primary).length, 1);
    const screenshots = path.resolve(__dirname, '../.tmp');
    fs.mkdirSync(screenshots, { recursive: true });
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => { localStorage.setItem('bwap-theme', theme); }, theme);
        await page.reload();
        await page.getByText('Comercial atualizado', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(screenshots, `chips-${theme}-${width}.png`), fullPage: true });
        await page.locator('#newChipBtn').click();
        const panel = await page.locator('[role=dialog]').boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= width);
        assert.equal(await page.locator('#chipNumberInput').count(), 0);
        await page.screenshot({ path: path.join(screenshots, `chips-modal-${theme}-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape');
        await page.locator('[role=dialog]').waitFor({ state: 'hidden' });
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: QR-only channel creation, detected phone persistence, editing, independent channels, desktop/mobile and light/dark dialogs');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    const target = path.resolve(storageDir);
    if (target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('bot-wap-chips-ui-')) fs.rmSync(target, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
