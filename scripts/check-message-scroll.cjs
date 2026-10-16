const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-scroll-'));
process.env.STORAGE_DIR = folder;
process.env.ADMIN_USERNAME = 'scroll-test'; process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.DATABASE_URL; delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    const number = '5511999990000';
    const messages = Array.from({ length: 300 }, (_, id) => ({ id: id + 1, whatsappId: `scroll-${id}`, from: id % 2 ? 'admin' : 'client', text: `Mensagem ${id + 1}\nPrimeira linha de conteúdo para verificar a rolagem.\nSegunda linha de conteúdo para verificar a rolagem.\nÚltima linha da mensagem.`, at: new Date(Date.now() - (300 - id) * 60000).toISOString(), ...(id % 2 ? { deliveryStatus: 3 } : {}) }));
    const conversation = { number, name: 'Contato de teste', messages, lastMessage: 'Histórico de teste', lastMessageAt: messages.at(-1).at };
    const state = { conversations: { [number]: conversation }, status: { connected: true }, activeTarget: null };
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (_, action) => action === 'state' ? state : action === 'status' ? { status: state.status } : action === 'contacts' ? [] : { ok: true };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.request.post(base + '/api/login', { data: { username: 'scroll-test', password: 'test-password' } });
    const department = (await (await context.request.post(base + '/api/departments', { data: { name: 'Teste' } })).json()).department;
    await context.request.post(base + '/api/chips', { data: { name: 'Simulado', departmentId: department.id } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let releaseImage;
    const imageGate = new Promise(resolve => { releaseImage = resolve; });
    let releaseOtherImage;
    const otherImageGate = new Promise(resolve => { releaseOtherImage = resolve; });
    messages.at(-2).type = 'image'; messages.at(-2).mediaUrl = base + '/other-message.svg';
    await page.route('**/other-message.svg', async route => {
      await otherImageGate;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#759fcf"/></svg>' });
    });
    messages.at(-1).type = 'image'; messages.at(-1).mediaUrl = base + '/slow-message.svg';
    await page.route('**/slow-message.svg', async route => {
      await imageGate;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#75cfa8"/></svg>' });
    });
    await page.goto(base + '/atendimento');
    await page.locator('.convo-item').first().click();
    await page.locator('.message-bubble').first().waitFor();
    await page.waitForFunction(() => { const log = document.getElementById('chatLog'); return log.scrollHeight - log.scrollTop - log.clientHeight <= 1; });
    releaseImage();
    await page.waitForFunction(() => { const image = document.querySelector('img[src$="slow-message.svg"]'); return image?.complete && image.naturalWidth > 0; });
    await page.waitForTimeout(100);
    const lateImageGap = await page.locator('#chatLog').evaluate(log => log.scrollHeight - log.scrollTop - log.clientHeight);
    assert.ok(lateImageGap <= 1, `late media moved the latest message ${lateImageGap}px away from the bottom`);
    const readingPosition = await page.locator('#chatLog').evaluate(log => { log.scrollTop -= 1000; return log.scrollTop; });
    await page.waitForTimeout(100);
    releaseOtherImage();
    await page.waitForFunction(() => { const image = document.querySelector('img[src$="other-message.svg"]'); return image?.complete && image.naturalWidth > 0; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#chatLog').evaluate(log => log.scrollTop), readingPosition, 'late media must not pull a reader back to the bottom');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      for (const offset of [0, 25, 75, 150, 1000]) for (const placement of ['clipped', 'middle']) {
        await page.evaluate(offset => { const log = document.getElementById('chatLog'); log.scrollTop = log.scrollHeight - log.clientHeight - offset; }, offset);
        await page.waitForTimeout(100);
        const point = await page.evaluate(placement => {
          const log = document.getElementById('chatLog'), bounds = log.getBoundingClientRect();
          const items = [...log.querySelectorAll('.bubble-text')].map(element => ({ element, rect: element.getBoundingClientRect() }));
          const target = placement === 'clipped'
            ? items.find(({ rect }) => rect.top < bounds.top + 5 && rect.bottom > bounds.top + 24)
            : items.find(({ rect }) => rect.top > bounds.top + 60 && rect.bottom < bounds.bottom - 60);
          if (!target) return null;
          return { x: target.rect.x + Math.min(30, target.rect.width / 2), y: Math.max(bounds.top + 14, target.rect.y + 12), before: log.scrollTop };
        }, placement);
        if (!point) continue;
        await page.mouse.click(point.x, point.y);
        await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).waitFor();
        const opened = await page.locator('#chatLog').evaluate(element => element.scrollTop);
        assert.ok(Math.abs(opened - point.before) <= 1, `click moved history ${opened - point.before}px at ${width}px (${placement}, offset ${offset})`);
        const menu = await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).boundingBox();
        assert.ok(menu.x >= 0 && menu.x + menu.width <= width && menu.y >= 0 && menu.y + menu.height <= 950, 'message menu fits the viewport');
        await page.keyboard.press('Escape');
        await page.getByRole('group', { name: 'Ações da mensagem', exact: true }).waitFor({ state: 'hidden' });
        assert.ok(Math.abs(await page.locator('#chatLog').evaluate(element => element.scrollTop) - point.before) <= 1, 'closing the menu preserves scroll');
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: real pointer clicks on visible/clipped messages and menu open/close preserve history scroll on desktop/mobile.');
  } finally {
    await browser?.close(); await new Promise(resolve => io.close(resolve)); await db.close();
    assert.equal(path.dirname(folder), os.tmpdir()); fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
