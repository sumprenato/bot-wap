const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-modals-'));
process.env.STORAGE_DIR = folder;
process.env.ADMIN_USERNAME = 'modal-test'; process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.DATABASE_URL; delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (_, action) => action === 'state' ? { conversations: {}, status: {} } : { ok: true };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    assert.ok((await context.request.post(base + '/api/login', { data: { username: 'modal-test', password: 'test-password' } })).ok());
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(base + '/funis');
    await page.waitForLoadState('networkidle');
    const output = path.resolve(__dirname, '../.tmp/modals-preview'); fs.mkdirSync(output, { recursive: true });
    const noDialogs = () => page.waitForFunction(() => document.querySelectorAll('dialog:modal').length === 0);
    const centred = async () => {
      const box = await page.locator('dialog:modal').boundingBox();
      const viewport = page.viewportSize();
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2, 'dialog centres horizontally');
      assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2, 'dialog centres vertically');
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
    };
    for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const before = await page.locator('.page-heading').boundingBox();
      await page.locator('#addFunnelBtn').click();
      await centred();
      const after = await page.locator('.page-heading').boundingBox();
      assert.equal(after.y, before.y, 'opening a form does not move the page');
      assert.equal(await page.locator('#editor-name').evaluate(element => document.activeElement === element), true);
      await page.locator('#editor-name').fill('Novo funil');
      for (let index = 0; index < 7; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog:modal')), true, 'focus stays in the dialog');
      }
      await page.screenshot({ path: path.join(output, `new-funnel-${theme}-${width}.png`) });
      await page.keyboard.press('Escape'); await noDialogs();
      await page.waitForFunction(() => document.activeElement === document.getElementById('addFunnelBtn'));
      await page.locator('#addFunnelBtn').click();
      const input = await page.locator('#editor-name').boundingBox();
      await page.mouse.move(input.x + 10, input.y + input.height / 2); await page.mouse.down();
      await page.mouse.move(1, 1); await page.mouse.up();
      assert.equal(await page.locator('dialog:modal').count(), 1, 'dragging from the input to the backdrop does not dismiss the form');
      await page.mouse.click(2, 2); await noDialogs();
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-modal')), false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/kanban/funnels', async route => { await gate; await route.continue(); });
    await page.locator('#addFunnelBtn').click(); await page.locator('#editor-name').fill('Salvo com segurança');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('dialog form')?.getAttribute('aria-busy') === 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
    assert.equal(await page.locator('dialog:modal').count(), 1, 'saving keeps the dialog open');
    release(); await noDialogs(); await page.unroute('**/api/kanban/funnels');
    await page.goto(base + '/equipe');
    await page.locator('#newTeamMemberBtn').click();
    await centred();
    await page.locator('#teamMemberName').fill('Alterações pendentes');
    await page.keyboard.press('Escape');
    await page.locator('#confirmModal').waitFor();
    assert.equal(await page.locator('dialog:modal').count(), 2, 'discard confirmation sits above the editor');
    await page.locator('#confirmCancel').click();
    assert.equal(await page.locator('#teamMemberName').inputValue(), 'Alterações pendentes');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-modal')), true);
    await page.locator('#teamMemberSave').scrollIntoViewIfNeeded();
    assert.ok(await page.getByRole('dialog').evaluate(element => element.scrollTop > 0), 'long permission forms scroll inside the dialog');
    await page.screenshot({ path: path.join(output, 'team-scrolled.png') });
    await page.keyboard.press('Escape'); await page.locator('#confirmOk').click(); await noDialogs();
    await page.waitForFunction(() => document.activeElement === document.getElementById('newTeamMemberBtn'));
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-modal')), false);
    assert.deepEqual(errors, []);
    console.log('PASS: centred dialogs in both themes and mobile, stable page, keyboard focus/restore, backdrop, drag selection, save protection, nested discard confirmation and long-form scrolling.');
  } finally {
    await browser?.close(); await new Promise(resolve => io.close(resolve)); await db.close();
    assert.equal(path.dirname(folder), os.tmpdir()); fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
