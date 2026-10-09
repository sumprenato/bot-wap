const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wap-access-ui-'));
process.env.ADMIN_USERNAME = 'access-owner'; process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.DATABASE_URL; delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db } = require('../server');
const { roles } = require('../permissions');
async function main() {
  await db.ready;
  bot.ensureWorker = () => ({ child: { connected: true } });
  bot.request = async (_, action) => action === 'state' ? { conversations: {}, status: { connected: false } } : action === 'contacts' ? [] : {};
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER || 'chrome' });
  const errors = [];
  try {
    const owner = await browser.newContext(), manager = await browser.newContext();
    const ownerPage = await owner.newPage(), managerPage = await manager.newPage();
    for (const page of [ownerPage, managerPage]) page.on('pageerror', (error) => errors.push(error.message));
    const login = async (context, username) => { const response = await context.request.post(base + '/api/login', { data: { username, password: 'test-password' } }); assert.equal(response.status(), 200); };
    await login(owner, 'access-owner');
    await ownerPage.goto(base + '/equipe');
    await ownerPage.locator('#newTeamMemberBtn').click();
    await ownerPage.locator('#teamMemberName').fill('Gerente UI');
    await ownerPage.locator('#teamMemberEmail').fill('access-manager@test.invalid');
    await ownerPage.locator('#teamMemberPassword').fill('test-password');
    await ownerPage.locator('#teamMemberRole').selectOption(roles.manager);
    assert.equal(await ownerPage.locator('[data-permission]:checked').count(), 0);
    await ownerPage.locator('#teamMemberSave').click();
    await ownerPage.locator('#teamMemberModal').waitFor({ state: 'hidden' });
    const member = (await (await owner.request.get(base + '/api/team')).json()).team.find((member) => member.name === 'Gerente UI');
    assert.deepEqual(member.permissions, []);
    await login(manager, member.username);
    await managerPage.goto(base + '/configuracoes');
    await managerPage.waitForFunction(() => !!window.AppCore);
    assert.equal(await managerPage.locator('[data-page="campaigns"]').isVisible(), false);
    assert.equal((await manager.request.get(base + '/campanhas')).status(), 403);
    const grant = async (permissions) => { const response = await owner.request.put(base + `/api/team/${member.id}/permissions`, { data: { permissions, scope: 'account' } }); assert.equal(response.status(), 200, await response.text()); };
    await grant(['equipe.visualizar', 'configuracoes.visualizar']);
    await managerPage.locator('[data-page="team"]').waitFor({ state: 'visible' });
    await managerPage.locator('[data-page="team"]').click();
    await managerPage.locator('#teamTable').getByText('Gerente UI', { exact: true }).waitFor();
    assert.equal(await managerPage.locator('#newTeamMemberBtn').isVisible(), false);
    assert.equal(await managerPage.locator('#teamTable').getByRole('button', { name: 'Editar', exact: true }).count(), 0);
    const managerRow = ownerPage.locator('#teamTable tr').filter({ hasText: 'Gerente UI' });
    assert.equal(await managerRow.getByRole('button', { name: 'Gerenciar permissões', exact: true }).isVisible(), false);
    const menuTrigger = managerRow.getByRole('button', { name: 'Ações de Gerente UI', exact: true });
    await menuTrigger.click();
    await managerRow.getByRole('button', { name: 'Gerenciar permissões', exact: true }).waitFor();
    await ownerPage.keyboard.press('Escape');
    await managerRow.getByRole('button', { name: 'Gerenciar permissões', exact: true }).waitFor({ state: 'hidden' });
    for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await ownerPage.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await menuTrigger.click();
      const menuBox = await managerRow.locator('.record-actions-menu').boundingBox();
      assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, 'menu stays inside the viewport');
      await ownerPage.keyboard.press('Escape');
      await managerRow.locator('.record-actions-menu').waitFor({ state: 'hidden' });
    }
    await menuTrigger.click();
    await managerRow.getByRole('button', { name: 'Gerenciar permissões', exact: true }).click();
    for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await ownerPage.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      assert.equal(await ownerPage.locator('[data-permission="equipe.visualizar"]').isChecked(), true);
      assert.equal(await ownerPage.locator('#teamMemberSave').isVisible(), true);
      assert.equal(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    }
    await ownerPage.locator('[data-permission="campanhas.visualizar"]').check();
    await ownerPage.locator('#teamMemberSave').click();
    await ownerPage.locator('#teamMemberModal').waitFor({ state: 'hidden' });
    await managerPage.locator('[data-page="campaigns"]').waitFor({ state: 'visible' });
    await managerPage.locator('[data-page="campaigns"]').click();
    await managerPage.waitForURL('**/campanhas');
    await grant([]);
    await managerPage.waitForURL('**/configuracoes');
    assert.equal(await managerPage.locator('[data-page="campaigns"]').isVisible(), false);
    assert.equal((await (await manager.request.get(base + '/api/session')).json()).authenticated, true);
    assert.deepEqual(errors, []);
    console.log('PASS: real permission editor, zero-access manager, direct-route denial, live sidebar grants/revocation, active session, mobile/desktop and both themes');
  } finally { await browser.close(); await new Promise((resolve) => io.close(resolve)); await db.close(); fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
