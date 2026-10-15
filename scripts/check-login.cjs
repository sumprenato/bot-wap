const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-login-'));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = 'login-test';
process.env.ADMIN_PASSWORD = 'login-test-password';
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');

async function main() {
  let browser;
  try {
    await db.ready;
    bot.state = async () => ({ conversations: {}, status: { connected: false } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const launchBrowser = () => chromium.launchPersistentContext(path.join(storageDir, 'browser'), {
      headless: true,
      channel: process.env.UI_BROWSER || 'chrome',
    });
    let context = await launchBrowser();
    browser = context;
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    const visitLogin = async () => {
      const data = await (await context.request.get(base + '/api/session')).json();
      await page.goto(base + '/');
      // Let the session callback and any resulting navigation finish.
      await page.waitForLoadState('networkidle');
      return data;
    };
    const submit = async (remember) => {
      await page.locator('#username').fill('login-test');
      await page.locator('#password').fill('login-test-password');
      if (remember) await page.getByRole('switch', { name: 'Lembrar o login' }).click();
      await page.locator('#authSubmit').click();
      await page.waitForURL(base + '/atendimento');
    };
    await visitLogin();
    const output = path.resolve(__dirname, '../.tmp/login-preview');
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: theme === 'dark' ? 'Tema escuro' : 'Tema claro', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      for (const mode of ['login', 'register']) {
        await page.locator(mode === 'login' ? '#loginTab' : '#registerTab').click();
        for (const [width, height] of [[1440, 900], [1366, 768], [768, 1024], [390, 844], [320, 640]]) {
          await page.setViewportSize({ width, height });
          const bounds = await page.evaluate(() => {
            const card = document.querySelector('.login-card').getBoundingClientRect();
            return { overflow: document.documentElement.scrollWidth > innerWidth + 1, left: card.left, right: card.right };
          });
          assert.equal(bounds.overflow, false, `${theme} ${mode} overflow at ${width}`);
          assert.ok(bounds.left >= 0 && bounds.right <= width, `${mode} card fits at ${width}`);
          await page.screenshot({ path: path.join(output, `${theme}-${mode}-${width}.png`), fullPage: true, animations: 'disabled' });
        }
      }
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'theme persists on reload');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#username').fill('visual-test');
    await page.locator('#password').fill('preserved-password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    assert.equal(await page.locator('#password').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    assert.equal(await page.locator('#password').getAttribute('type'), 'password');
    await page.locator('#registerTab').click();
    assert.equal(await page.locator('#displayName').isVisible(), true);
    assert.equal(await page.locator('#confirmPassword').isVisible(), true);
    await page.locator('#registerTab').press('ArrowLeft');
    assert.equal(await page.locator('#loginTab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#password').inputValue(), 'preserved-password');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.login-card').evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Tema escuro', exact: true }).click();
    await page.locator('#authSubmit').click();
    await page.locator('#errorMsg').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#username').inputValue(), 'visual-test');
    assert.equal(await page.locator('#authSubmit').isEnabled(), true);
    await page.reload();
    assert.deepEqual(errors, []);
    console.log('PASS: login/register in both themes at 5 viewport sizes, persistent theme, password visibility, keyboard tabs, retry and reduced motion');
    await submit(false);
    await page.reload();
    assert.equal(new URL(page.url()).pathname, '/atendimento');
    const temporary = await visitLogin();
    assert.equal(temporary.authenticated, true);
    assert.equal(temporary.rememberLogin, false);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('#loginForm').isVisible(), true);
    assert.equal(await page.locator('#username').inputValue(), '');
    assert.equal(await page.locator('#password').inputValue(), '');
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    await visitLogin();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('#loginForm').isVisible(), true);
    console.log('PASS: unchecked login requires credentials when returning to login or reopening the site');

    await submit(true);
    const remembered = await visitLogin();
    assert.equal(remembered.rememberLogin, true);
    await page.waitForURL(base + '/atendimento');
    assert.ok(remembered.remainingMs > 0 && remembered.remainingMs <= 7200000);
    await page.close();
    page = await context.newPage();
    await visitLogin();
    await page.waitForURL(base + '/atendimento');
    console.log('PASS: checked login automatically restores access within the two-hour deadline');

    await context.close();
    context = await launchBrowser();
    browser = context;
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    const restored = await visitLogin();
    assert.equal(restored.rememberLogin, true);
    assert.equal(restored.expiresAt, remembered.expiresAt);
    await page.waitForURL(base + '/atendimento');
    console.log('PASS: remembered access survives closing the entire browser without extending the deadline');

    await context.request.post(base + '/api/logout');
    await visitLogin();
    await submit(false);
    const disabledAgain = await visitLogin();
    assert.equal(disabledAgain.rememberLogin, false);
    assert.equal(new URL(page.url()).pathname, '/');
    console.log('PASS: a new unchecked login does not reuse the previous remember-login preference');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    const resolved = path.resolve(storageDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('bot-wap-login-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
