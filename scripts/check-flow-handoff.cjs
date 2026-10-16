const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "convelya-handoff-ui-"));
process.env.STORAGE_DIR = folder;
process.env.ADMIN_USERNAME = "handoff-owner";
process.env.ADMIN_PASSWORD = "test-password";
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db, flowService } = require("../server");
const store = require("../store");

async function main() {
  let browser, page;
  try {
    await db.ready;
    const number = "5511998811223";
    await db.run(
      "INSERT INTO chips(name,number,user_id,is_primary,identity_verified,created_at) VALUES (?,?,1,1,1,?)",
      ["Fixture", "5511999900000", new Date().toISOString()],
    );
    await store.saveContact({
      number,
      name: "Cliente de teste",
      nameSource: "manual",
    });
    await store.addMessage(number, "client", "Olá");
    await store.stopConversationFlow(number);
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (chip, action, payload = {}) => {
      if (action === "state")
        return {
          conversations: await store.getAll(),
          activeTarget: null,
          status: {
            connected: true,
            contactsSync: { verified: true, syncing: false, stage: "ready" },
          },
        };
      if (action === "contacts") return store.getContacts();
      if (action === "get-conversation")
        return store.getConversation(payload.number);
      if (action === "reopen-conversation")
        return { conversation: await store.reopenConversation(payload.number) };
      if (action === "reply")
        return {
          conversation: await store.addMessage(
            payload.number,
            "admin",
            payload.text,
          ),
        };
      return { ok: true };
    };
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      channel: process.env.UI_BROWSER || "chrome",
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    assert.ok(
      (
        await context.request.post(base + "/api/login", {
          data: { username: "handoff-owner", password: "test-password" },
        })
      ).ok(),
    );
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/atendimento");
    await page
      .locator(".convo-item")
      .filter({ hasText: "Cliente de teste" })
      .click();
    await page
      .locator("#chatStatus")
      .getByText("Automação interrompida", { exact: true })
      .waitFor();
    await page.locator(".chat-more-details summary").click();
    await page
      .locator("#finalizeBtn")
      .getByText("Reativar automação", { exact: true })
      .click();
    await page.locator("#confirmOk").click();
    await page
      .locator("#chatStatus")
      .getByText("Atendimento automático", { exact: true })
      .waitFor();
    assert.equal((await store.getConversation(number)).flowStopped, false);
    const assigned = await store.assignConversation(number, 1);
    io.emit("message", assigned);
    await page
      .locator("#chatStatus")
      .getByText("Atendimento humano", { exact: true })
      .waitFor();
    await page.locator("#composerInput").fill("Resposta do atendente");
    await page.locator("#sendBtn").click();
    await page
      .locator(".bubble-text")
      .filter({ hasText: "Resposta do atendente" })
      .waitFor();
    assert.equal(
      (await store.getConversation(number)).messages.at(-1).text,
      "Resposta do atendente",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: interrupted status, explicit reactivation persisted by the API, assigned human status and manual reply remain available.",
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.resolve(".tmp/flow-handoff-ui-failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    await flowService.stop();
    await browser?.close();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
