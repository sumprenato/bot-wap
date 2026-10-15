const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const tempRoot = path.resolve(__dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const storageDir = fs.mkdtempSync(path.join(tempRoot, 'dashboard-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'dashboard-test';
process.env.ADMIN_PASSWORD = 'dashboard-test-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    const chips = [];
    for (const name of ['Comercial', 'Suporte']) chips.push((await db.run('INSERT INTO chips(name,user_id,is_primary,created_at) VALUES (?,1,?,?)', [name, chips.length ? 0 : 1, new Date().toISOString()])).lastID);
    const messages = [];
    for (let offset = 0; offset < 30; offset++) {
      const date = new Date(); date.setUTCDate(date.getUTCDate() - offset);
      for (let index = 0; index < (offset % 5) + 1; index++) messages.push({ from: index % 2 ? 'admin' : 'client', at: date.toISOString(), text: 'Mensagem de teste' });
    }
    const states = new Map(chips.map((id, index) => [id, { status: { connected: index === 0 }, conversations: {
      [`551199999000${index}`]: { number: `551199999000${index}`, messages: index === 0 ? messages : messages.slice(0, 3), isFinalized: index === 1 },
    }, activeTarget: null }]));
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (chip, action) => action === 'state' ? states.get(Number(chip.id)) || { status: {}, conversations: {} } : action === 'status' ? { status: states.get(Number(chip.id))?.status || {} } : action === 'contacts' ? [] : { ok: true };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
    const context = await browser.newContext();
    const login = await context.request.post(`${base}/api/login`, { data: { username: 'dashboard-test', password: 'dashboard-test-password' } });
    assert.ok(login.ok());
    assert.equal((await context.request.get(`${base}/api/dashboard/stats?days=8`)).status(), 400);
    assert.equal((await context.request.get(`${base}/api/dashboard/stats?chipId=99999`)).status(), 404);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/dashboard`);
    await page.locator('.analytics-metrics').waitFor();
    const output = path.join(tempRoot, 'dashboard-preview'); fs.mkdirSync(output, { recursive: true });
    for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440], [3440, 1440], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const bounds = await page.evaluate(() => {
        const inner = document.querySelector('.dashboard-inner').getBoundingClientRect();
        const main = document.querySelector('.chat').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, width: inner.width, available: main.width, header: document.querySelector('.analytics-header').getBoundingClientRect().height };
      });
      assert.equal(bounds.overflow, false, `overflow at ${width}`);
      assert.ok(bounds.width >= bounds.available - 70, `dashboard should fill available width at ${width}`);
      if (width > 720) assert.ok(bounds.header < 120, `compact header at ${width}`);
      await page.screenshot({ path: path.join(output, `dashboard-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    const initialStats = await (await context.request.get(`${base}/api/dashboard/stats?days=7`)).json();
    const dailyChart = page.locator('.analytics-daily-svg');
    const inspectDay = async (index, type) => {
      const bounds = await dailyChart.boundingBox();
      const x = 42 + (type === 'Barras' ? (index + .5) / initialStats.daily.length : index / (initialStats.daily.length - 1)) * (bounds.width - 60);
      await dailyChart.hover({ position: { x, y: bounds.height * .6 } });
      const detail = page.locator('.chart-detail--daily');
      await detail.waitFor();
      const row = initialStats.daily[index];
      assert.deepEqual((await detail.locator('dd').allTextContents()).slice(0, 3), [String(row.received), String(row.sent), `${row.received + row.sent} mensagens`]);
      assert.match(await detail.locator('.chart-detail-title').innerText(), new RegExp(String(Number(row.date.slice(8, 10)))));
    };
    for (const type of ['Linhas', 'Barras', 'Área']) {
      await page.getByRole('button', { name: type, exact: true }).click();
      assert.equal(await page.getByRole('button', { name: type, exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.analytics-daily-svg').count(), 1);
      await inspectDay(2, type);
      await inspectDay(6, type);
    }
    await page.screenshot({ path: path.join(output, 'dashboard-cursor-detail.png'), animations: 'disabled' });
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).hover();
    assert.equal(await page.locator('.chart-detail--daily').count(), 0, 'tooltip closes outside the plot');
    await dailyChart.focus();
    await dailyChart.press('Home');
    await page.locator('.chart-detail--daily').waitFor();
    await dailyChart.press('End');
    assert.match(await page.locator('.chart-screenreader').textContent(), /recebidas.*enviadas/);
    await dailyChart.press('Escape');
    assert.equal(await page.locator('.chart-detail--daily').count(), 0);
    await page.getByRole('button', { name: 'Ampliar gráfico', exact: true }).click();
    const pan = page.getByRole('slider', { name: 'Navegar pelo período do gráfico' });
    await pan.waitFor();
    await pan.focus();
    await pan.press('Home');
    await dailyChart.scrollIntoViewIfNeeded();
    let chartBounds = await dailyChart.boundingBox();
    await page.mouse.move(chartBounds.x + chartBounds.width * .75, chartBounds.y + chartBounds.height * .65);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * .25, chartBounds.y + chartBounds.height * .65, { steps: 8 });
    await page.mouse.up();
    assert.ok(Number(await pan.inputValue()) > 0, 'drag pans the zoomed timeline');
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
    chartBounds = await dailyChart.boundingBox();
    await page.mouse.move(chartBounds.x + 42 + (chartBounds.width - 60) / 6, chartBounds.y + chartBounds.height * .65);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + 42 + (chartBounds.width - 60) * 4 / 6, chartBounds.y + chartBounds.height * .65, { steps: 8 });
    await page.mouse.up();
    await pan.waitFor();
    assert.equal(await pan.getAttribute('max'), '3', 'drag selects four days out of seven');
    await dailyChart.dblclick();
    assert.equal(await pan.count(), 0, 'double click restores the complete period');
    await page.locator('.analytics-status-item').first().hover();
    await page.locator('.chart-detail--floating').waitFor();
    assert.equal(await page.locator('.chart-detail--floating .chart-detail-title').textContent(), 'Abertas');
    assert.equal(await page.locator('.analytics-donut > div > span').textContent(), 'Abertas');
    await page.locator('.analytics-hour').first().hover();
    assert.match(await page.locator('.chart-detail--floating').innerText(), /Recebidas.*Enviadas.*Total/s);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await context.storageState() });
    const mobilePage = await mobile.newPage();
    mobilePage.on('pageerror', error => errors.push(error.message));
    await mobilePage.goto(`${base}/dashboard`);
    await mobilePage.locator('.analytics-daily-svg').tap();
    await mobilePage.locator('.chart-detail--daily').waitFor();
    await mobilePage.waitForFunction(() => [...document.querySelectorAll('.analytics-metrics .animated-number')].every(element => element.textContent === element.getAttribute('aria-label')));
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'touch detail fits mobile viewport');
    await mobilePage.screenshot({ path: path.join(output, 'dashboard-touch-detail.png'), fullPage: true, animations: 'disabled' });
    assert.equal(await mobilePage.locator('.chart-detail--daily').isVisible(), true, 'touch detail stays open while the page is scrolled');
    await mobilePage.locator('.analytics-hour').first().tap();
    await mobilePage.locator('.chart-detail--floating').waitFor();
    assert.match(await mobilePage.locator('.chart-detail--floating').innerText(), /Recebidas.*Enviadas.*Total/s);
    await mobilePage.getByRole('heading', { name: 'Quando chegam as mensagens?' }).tap();
    assert.equal(await mobilePage.locator('.chart-detail--floating').count(), 0, 'outside tap dismisses touch details');
    await mobile.close();
    await page.screenshot({ path: path.join(output, 'dashboard-interactive.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '30 dias', exact: true }).click();
    await page.locator('.analytics-metrics').waitFor();
    await page.getByRole('button', { name: 'Ver dados por dia', exact: true }).click();
    assert.equal(await page.locator('.analytics-data-table tbody tr').count(), 30);
    await page.getByLabel('Filtrar dashboard por chip').selectOption(String(chips[1]));
    await page.locator('.analytics-metrics').waitFor();
    const selected = await context.request.get(`${base}/api/dashboard/stats?days=30&chipId=${chips[1]}`);
    const stats = await selected.json();
    assert.equal(stats.received + stats.sent, 3);
    assert.equal(stats.finalized, 1);
    assert.equal(stats.open, 0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Exportar relatório/ }).click();
    const file = await download; assert.equal(file.suggestedFilename(), 'relatorio-bot-wap.csv');
    const csv = (await context.request.get(`${base}/api/dashboard/export?days=30&chipId=${chips[1]}`));
    assert.ok(csv.ok()); assert.match(await csv.text(), /Data;Recebidas;Enviadas/);
    await page.getByLabel('Filtrar dashboard por chip').selectOption('');
    await page.locator('.analytics-metrics').waitFor();
    await page.getByRole('button', { name: 'Ocultar dados', exact: true }).click();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({ path: path.join(output, 'dashboard-light-1920.png'), animations: 'disabled' });
    for (const width of [1366, 1920, 2560, 3440]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
      for (const route of ['atendimento', 'dashboard', 'funis', 'campanhas', 'fluxos', 'contatos', 'webhooks', 'departamentos', 'tags', 'chips', 'configuracoes', 'equipe']) {
        await page.goto(`${base}/${route}`);
        await page.waitForFunction(() => !!window.AppCore);
        const layout = await page.evaluate(() => {
          const inner = document.querySelector('.page-panel-inner');
          const main = document.querySelector('.chat').getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > innerWidth + 1, available: main.width, content: inner?.getBoundingClientRect().width };
        });
        assert.equal(layout.overflow, false, `${route} overflow at ${width}`);
        if (layout.content !== undefined) assert.ok(layout.content >= layout.available - 70, `${route} should use available width at ${width}`);
      }
    }
    // Accessibility: reduced motion must show exact values without any running effects.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/dashboard`);
    await page.locator('.analytics-metrics').waitFor();
    const motion = await page.evaluate(() => ({
      running: document.getAnimations().filter(animation => animation.playState === 'running').length,
      values: [...document.querySelectorAll('.animated-number')].every(element => element.textContent === element.getAttribute('aria-label')),
    }));
    assert.equal(motion.running, 0, 'reduced motion disables CSS and Web Animations');
    assert.equal(motion.values, true, 'reduced motion renders final numbers immediately');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      window.__premiumSidebar = document.getElementById('appNavigation');
      document.querySelector('.nav-item[href="/contatos"]').click();
      document.querySelector('.nav-item[href="/chips"]').click();
    });
    await page.waitForURL(`${base}/chips`);
    await page.waitForFunction(() => document.body.dataset.page === 'chips');
    assert.equal(await page.evaluate(() => document.getElementById('appNavigation') === window.__premiumSidebar), true);
    await page.goBack();
    await page.waitForFunction(() => document.body.dataset.page === 'overview');
    await page.locator('.analytics-metrics').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.analytics-metrics .animated-number')].every(element => element.textContent === element.getAttribute('aria-label')));
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.page-notice--error').count(), 0);
    console.log('PASS: chart cursor details in all 3 modes, keyboard, zoom, drag to select/pan, touch details, donut/hour details, filters/export, 5 dashboard sizes, 12 pages at 4 widths, reduced motion and rapid navigation/back.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => io.close(resolve));
    await db.close();
    const resolved = path.resolve(storageDir);
    if (resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith('dashboard-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
