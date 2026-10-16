const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const ExcelJS = require('exceljs');

const tempRoot = path.resolve(__dirname, "../.tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const storageDir = fs.mkdtempSync(path.join(tempRoot, "pages-"));
process.env.STORAGE_DIR = storageDir;
process.env.ADMIN_USERNAME = "pages-test";
process.env.ADMIN_PASSWORD = "pages-test-password";
process.env.ADMIN_NUMBER = "5511999999999";
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db, flowService } = require("../server");
const store = require("../store");

async function main() {
  await db.ready;
  // Keep all tests local: no WhatsApp worker or external message is started.
  const mockState = {
    conversations: {},
    status: { connected: false },
    activeTarget: null,
  };
  bot.ensureWorker = () => ({ child: { connected: true } });
  bot.request = async (_, action, payload) => {
    if (action === "import-contacts")
      return store.importContacts(payload.contacts);
    if (action === "contacts") return store.getContacts();
    if (action === "sync-contacts") return { connected: false, synced: false };
    if (action === "profile-picture")
      return { number: payload.number, profilePic: "", connected: false };
    if (action === "status") return { status: { connected: false, qr: null } };
    if (action === "state") return mockState;
    if (action === "reply" || action === "reply-media") {
      const conversation = mockState.conversations[payload.number] || {
        number: payload.number,
        name: "Cliente teste",
        messages: [],
      };
      conversation.messages.push({
        from: "admin",
        text: payload.text || payload.media?.caption || "",
        type: payload.media?.type || "text",
        fileName: payload.media?.fileName,
        mediaUrl: payload.media?.mediaUrl,
        at: new Date().toISOString(),
      });
      mockState.conversations[payload.number] = conversation;
      return { conversation, activeTarget: payload.number };
    }
    if (action === "assume") {
      mockState.activeTarget = payload.number;
      return { activeTarget: payload.number };
    }
    if (
      action === "block" ||
      action === "clear" ||
      action === "finalize-conversation" ||
      action === "reopen-conversation" ||
      action === "set-conversation-tags"
    ) {
      const conversation = mockState.conversations[payload.number] || {
        number: payload.number,
        messages: [],
      };
      if (action === "block") conversation.blocked = payload.blocked;
      if (action === "clear") conversation.messages = [];
      if (action === "set-conversation-tags") conversation.tags = payload.tags;
      if (
        action === "finalize-conversation" ||
        action === "reopen-conversation"
      )
        conversation.isFinalized = action === "finalize-conversation";
      mockState.conversations[payload.number] = conversation;
      return { conversation };
    }
    return { ok: true };
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: process.env.UI_BROWSER || "chrome",
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.install();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    if (process.env.VISUAL_AUDIT === '1') {
      const destination = path.join(tempRoot, 'visual-audit'); fs.mkdirSync(destination, { recursive: true });
      for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
        await page.screenshot({ path: path.join(destination, `${theme}-${width}-login.png`), animations: 'disabled' });
      }
    }
    assert.equal(
      await page.locator(".login-card").getAttribute("data-react-component"),
      "Login",
    );
    const remember = page.getByRole("switch", { name: "Lembrar o login" });
    assert.equal(await remember.getAttribute("aria-checked"), "false");
    await remember.focus();
    await page.keyboard.press("Space");
    assert.equal(await remember.getAttribute("aria-checked"), "true");
    await remember.click();
    assert.equal(await remember.getAttribute("aria-checked"), "false");
    await page.locator("#registerTab").click();
    assert.equal(await remember.count(), 0);
    await page.locator("#loginTab").click();
    await remember.click();
    await page.locator("#username").fill("pages-test");
    await page.locator("#password").fill("senha-incorreta");
    await page.locator("#authSubmit").click();
    await page.locator("#errorMsg").waitFor({ state: "visible" });
    assert.equal(await page.locator("#username").inputValue(), "pages-test");
    assert.equal(await page.locator("#authSubmit").isEnabled(), true);
    await page.locator("#password").fill("pages-test-password");
    await page.locator("#authSubmit").click();
    await page.waitForURL("**/atendimento");
    const loginCookie = (await context.cookies()).find((cookie) => cookie.name === "connect.sid");
    assert.ok(loginCookie.expires > Date.now() / 1000 + 7190);
    assert.ok(loginCookie.expires <= Date.now() / 1000 + 7200);

    async function api(url, method = "GET", data) {
      const response = await context.request.fetch(base + url, {
        method,
        data,
      });
      assert.ok(response.ok(), url + ": " + (await response.text()));
      return response.json();
    }
    const department = (
      await api("/api/departments", "POST", {
        name: "Comercial",
        description: "Equipe de vendas",
      })
    ).department;
    await api("/api/tags", "POST", {
      name: 'VIP "Especial"',
      color: "#3ddc84",
    });
    await store.saveContact({
      number: "551188887777",
      name: "Cliente teste",
      nameSource: 'whatsapp',
      tags: ['VIP "Especial"'],
    });
    await api("/api/campaigns", "POST", {
      name: "Campanha teste",
      message: "Mensagem de teste",
      target_tags: ["<b>VIP</b>"],
      blocked_tags: [],
    });
    const flow = (
      await api("/api/flows", "POST", {
        name: "Fluxo teste",
        description: "Automacao",
        trigger_keywords: ["<b>oi</b>"],
      })
    ).flow;
    const testChip = (await api('/api/chips', 'POST', { name: '<b>Chip teste</b>', departmentId: department.id })).chip;
    const flowDefinition = require('../flows/schema').empty();
    flowDefinition.nodes.push({id:'end',type:'flowBlock',position:{x:440,y:220},data:{kind:'stop',label:'Encerrar',config:{reason:'Fim'}}});
    flowDefinition.edges.push({id:'start-end',source:'start',target:'end',sourceHandle:'next',type:'default'});
    const flowData = {
      ...flow,
      definition: flowDefinition,
      trigger_chips: [String(testChip.id)],
    };
    const savedFlow=(await api("/api/flows/" + flow.id, "PUT", flowData)).flow;
    await api(`/api/flows/${flow.id}/publish`,'POST',{revision:savedFlow.revision});
    const webhook = (
      await api("/api/webhooks", "POST", {
        name: "Webhook teste",
        url: "https://example.invalid/events",
        events: ["message"],
        active: false,
      })
    ).webhook;
    const first = (
      await api("/api/kanban/columns", "POST", { name: "Novo contato" })
    ).column;
    const second = (
      await api("/api/kanban/columns", "POST", { name: "Proposta" })
    ).column;
    await api("/api/kanban/opportunities", "POST", {
      title: "Negociacao teste",
      value: 1500,
      column_id: first.id,
      contact_name: "Cliente teste",
    });
    await api("/api/followups", "POST", {
      name: "Retorno teste",
      message: "Mensagem teste",
      delay_hours: 24,
    });

    const routes = [
      "atendimento",
      "dashboard",
      "funis",
      "campanhas",
      "fluxos",
      "contatos",
      "webhooks",
      "departamentos",
      "tags",
      "chips",
      "configuracoes",
      "equipe",
    ];
    if (process.env.VISUAL_AUDIT === '1') {
      const destination = path.join(tempRoot, 'visual-audit');
      fs.mkdirSync(destination, { recursive: true });
      const captureRoutes = process.env.VISUAL_AUDIT_ROUTES ? routes.filter((route) => process.env.VISUAL_AUDIT_ROUTES.split(',').includes(route)) : routes;
      for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of captureRoutes) {
          await page.goto(base + '/' + route);
          await page.waitForFunction(() => !!window.AppCore);
          await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; localStorage.setItem('bwap-theme', theme); }, theme);
          await page.clock.runFor(50);
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(destination, `${theme}-${width}-${route}.png`), animations: 'disabled' });
        }
        console.log(`CAPTURED: ${theme} ${width}px`);
      }
      assert.deepEqual(errors, []);
      return;
    }
    // A persisted conversation exposed null references on every management page.
    await page.evaluate(() =>
      sessionStorage.setItem(
        "bwap-workspace-state",
        JSON.stringify({ selectedNumber: "551188887777" }),
      ),
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        const response = await page.goto(base + "/" + route);
        assert.equal(response.status(), 200, route);
        await page.waitForFunction(() => !!window.AppCore);
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.framework),
          "react",
        );
        assert.equal(await page.locator("#site-root").count(), 1);
        assert.equal(
          await page.locator(".page-view").getAttribute("data-react-component"),
          await page.locator("body").getAttribute("data-page"),
        );
        assert.equal(
          await page
            .locator(
              'script[src*="app.js"],script[src*="pages/"],script[src*="motion.js"]',
            )
            .count(),
          0,
        );
        const expectedPage = await page
          .locator("body")
          .getAttribute("data-page");
        assert.equal(
          await page
            .locator('.nav-item[aria-current="page"]')
            .getAttribute("data-page"),
          expectedPage,
        );
        await page.reload();
        await page.waitForFunction(() => !!window.AppCore);
        assert.equal(
          new URL(page.url()).pathname,
          "/" + route,
          "F5 must preserve " + route,
        );
        assert.equal(
          await page
            .locator(".page-view.is-active")
            .getAttribute("data-page-view"),
          expectedPage,
        );
        const requests = await page.evaluate(async () => {
          const core = window.AppCore;
          await Promise.all([core.refreshTags(), core.refreshDepartments()]);
          for (const module of [
            "KanbanPage",
            "CampaignsPage",
            "FlowsPage",
            "WebhooksPage",
            "ChipsPage",
          ]) {
            if (core[module]) await core[module].init();
          }
          return true;
        });
        assert.ok(requests);
        const layout = await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            tablesFit: innerWidth > 720 || [...document.querySelectorAll('.data-table tbody tr')].every((row) => { const rect = row.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }),
            duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
            selected: document.querySelectorAll(
              '.nav-item[aria-current="page"]',
            ).length,
            hiddenErrors: [
              ...document.querySelectorAll(".page-notice--error"),
            ].map((e) => e.textContent),
          };
        });
        if (!layout.tablesFit) console.log('Table bounds:', await page.evaluate(() => [...document.querySelectorAll('.data-table tbody tr')].map((row) => ({ text: row.textContent.slice(0, 60), left: row.getBoundingClientRect().left, right: row.getBoundingClientRect().right, table: row.closest('table').getBoundingClientRect().width }))));
        assert.deepEqual(
          layout,
          { overflow: false, tablesFit: true, duplicates: [], selected: 1, hiddenErrors: [] },
          route + " @ " + width,
        );
        assert.deepEqual(errors, [], route);
      }
      console.log(`PASS: all ${routes.length} populated pages at ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Exercise the menu itself: opening URLs directly does not catch click regressions.
    const navigationRequests = [];
    const trackNavigation = (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        navigationRequests.push(new URL(request.url()).pathname);
    };
    page.on("request", trackNavigation);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...routes.slice(1), routes[0]]) {
        navigationRequests.length = 0;
        await page.evaluate(() => {
          window.__navigationShell = document.getElementById("appNavigation");
        });
        const link = page.locator('.main-nav .nav-item[href="/' + route + '"]');
        assert.equal(await link.evaluate((el) => el.tagName), "A");
        await link.click();
        await page.waitForURL((url) => url.pathname === "/" + route);
        await page.waitForFunction(() => !!window.AppCore);
        const selected = await page
          .locator('.nav-item[aria-current="page"]')
          .getAttribute("data-page");
        assert.equal(
          selected,
          await page.locator("body").getAttribute("data-page"),
        );
        assert.deepEqual(
          navigationRequests,
          [],
          "Menu must keep the document mounted when opening " + route,
        );
        assert.equal(
          await page.evaluate(
            () =>
              document.getElementById("appNavigation") ===
              window.__navigationShell,
          ),
          true,
          "React must preserve the sidebar while switching pages",
        );
      }
    }
    page.off("request", trackNavigation);
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log(
      "PASS: actual sidebar clicks reach all 11 routes without reloading the document or sidebar",
    );

    // Express accepts trailing slashes/case variants; the client must resolve the same page.
    for (const route of ["/contatos/", "/FUNIS/", "/configuracoes/"]) {
      await page.goto(base + route + "?reload=1");
      await page.reload();
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(new URL(page.url()).search, "?reload=1");
      assert.equal(
        await page
          .locator('.nav-item[aria-current="page"]')
          .getAttribute("data-page"),
        await page.locator("body").getAttribute("data-page"),
      );
    }
    const noScripts = await browser.newContext({ javaScriptEnabled: false });
    await noScripts.addCookies(await context.cookies());
    const initial = await noScripts.newPage();
    await initial.goto(base + "/contatos");
    assert.equal(
      await initial.locator("#currentPageLabel").textContent(),
      "Contatos",
    );
    assert.equal(
      await initial
        .locator('.nav-item[aria-current="page"]')
        .getAttribute("data-page"),
      "contacts",
    );
    assert.equal(
      await initial
        .locator(".app")
        .evaluate((el) => el.classList.contains("app--management")),
      true,
    );
    for (const route of routes) {
      await initial
        .locator('.main-nav .nav-item[href="/' + route + '"]')
        .click();
      assert.equal(new URL(initial.url()).pathname, "/" + route);
      assert.equal(
        await initial
          .locator('.nav-item[aria-current="page"]')
          .getAttribute("data-page"),
        await initial.locator("body").getAttribute("data-page"),
      );
      assert.equal(
        await initial
          .locator(".page-view.is-active")
          .getAttribute("data-page-view"),
        await initial.locator("body").getAttribute("data-page"),
      );
    }
    await noScripts.close();
    console.log(
      "PASS: F5, trailing slashes, URL parameters and all menu links without JavaScript",
    );

    await page.goto(base + "/kanban?legacy=1");
    assert.equal(new URL(page.url()).pathname, "/funis");
    assert.equal(new URL(page.url()).search, "?legacy=1");
    assert.match(await page.title(), /^Funis/);
    await page.locator(".kanban-card select").selectOption(String(second.id));
    await page
      .locator('[data-col-id="' + second.id + '"] .kanban-card')
      .waitFor();
    assert.equal(
      (await api("/api/kanban")).opportunities[0].column_id,
      second.id,
    );
    await page.locator('.kanban-card .record-actions-trigger').click();
    await page.locator(".kanban-win").click();
    await page.locator(".kanban-card").waitFor({ state: "detached" });
    await page.locator("#funnelStatus").selectOption("won");
    await page.locator(".kanban-card").waitFor();
    assert.match(await page.locator(".kanban-card").innerText(), /Ganha/);
    console.log("PASS: old route, funnel movement and closed opportunities");

    await page.goto(base + "/fluxos");
    await page.getByRole('button',{name:'Editar Fluxo teste',exact:true}).click();
    await page.getByLabel('Nome do fluxo',{exact:true}).fill('Fluxo revisado');
    await page.locator('.fb-editor-top').getByRole('button',{name:'Salvar',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.fb-title small')?.textContent.includes('Salvo'));
    const updatedFlow = (await api("/api/flows")).flows[0];
    assert.deepEqual(updatedFlow.nodes, flowDefinition.nodes);
    assert.deepEqual(updatedFlow.edges, flowDefinition.edges);
    assert.deepEqual(updatedFlow.trigger_chips, flowData.trigger_chips);
    assert.equal(!!updatedFlow.active, true);
    assert.equal(await page.locator(".flow-card b").count(), 0);
    console.log("PASS: flow edit preserves automation and active state");

    await page.goto(base + "/webhooks");
    await page.locator('.webhook-card .record-actions-trigger').click();
    await page.locator(".webhook-edit").click();
    await page.locator("#webhookName").fill("Webhook revisado");
    await page.locator("#webhookSaveBtn").click();
    await page.locator("#webhookModal").waitFor({ state: "hidden" });
    assert.equal(!!(await api("/api/webhooks")).webhooks[0].active, false);
    await page.locator("#webhookSearch").fill("nao-existe");
    await page.locator(".webhook-card").waitFor({ state: "detached" });
    await page.locator("#webhookSearch").fill("revisado");
    await page.locator(".webhook-card").waitFor();
    console.log("PASS: webhook edit and search");

    await page.goto(base + "/campanhas");
    assert.equal(await page.locator(".campaign-card b").count(), 0);
    await page.route("**/api/campaigns/*/duplicate", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Falha simulada" }),
      }),
    );
    await page.locator('.campaign-card .record-actions-trigger').click();
    await page.locator(".campaign-duplicate").click();
    await page.getByText("Falha simulada", { exact: true }).waitFor();
    assert.equal((await api("/api/campaigns")).campaigns.length, 1);
    await page.unroute("**/api/campaigns/*/duplicate");
    await page.locator('.campaign-card .record-actions-trigger').click();
    await page.locator(".campaign-duplicate").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".campaign-card").length === 2,
    );
    console.log("PASS: failed action reports error and can be retried");

    await page.goto(base + "/contatos");
    await page.locator("#contactsPageSearch").fill("Cliente teste");
    await page.locator("#contactsTable [data-contact-number]").waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportContactsBtn").click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "contatos-convelya.xlsx");
    await page.locator("#contactsTable [data-contact-number]").click();
    await page.waitForURL("**/atendimento");
    assert.match(
      await page.locator("#chatTitle").innerText(),
      /551188887777|Cliente teste|\+55 \(11\) 8888-7777/,
    );
    await page.reload();
    await page
      .locator("#chatLog")
      .getByText("Sem mensagens ainda", { exact: true })
      .waitFor();
    assert.match(
      await page.locator("#chatTitle").innerText(),
      /551188887777|Cliente teste|\+55 \(11\) 8888-7777/,
    );
    io.emit("message", {
      number: "551188887777",
      name: "Cliente teste",
      messages: [
        {
          from: "client",
          text: "Primeira mensagem após F5",
          at: new Date().toISOString(),
        },
      ],
    });
    await page
      .locator("#chatLog")
      .getByText("Primeira mensagem após F5", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#chatLog .empty-state").count(), 0);
    io.emit("message", {
      number: "551188887777",
      name: "Cliente teste",
      messages: [],
    });
    await page
      .locator("#chatLog")
      .getByText("Sem mensagens ainda", { exact: true })
      .waitFor();
    console.log("PASS: contact search, CSV and opening conversation");

    await page.goto(base + "/contatos");
    await page.locator("#importContactsBtn").click();
    await page
      .locator("#importContactsFile")
      .setInputFiles({
        name: "importar.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "\uFEFFNome;Telefone;Rótulos\nContato importado;5511977776666;Novo\nContato revisado;5511977776666;VIP\nInválido;abc;",
        ),
      });
    await page.locator("#submitContactsImport").click();
    await page
      .getByText(
        "1 novo(s), 0 atualizado(s), 1 repetido(s) agrupado(s) e 1 linha(s) rejeitada(s).",
        { exact: false },
      )
      .waitFor();
    await page
      .locator("#contactsTable")
      .getByText("Contato revisado", { exact: true })
      .waitFor();
    await page.reload();
    await page
      .locator("#contactsTable")
      .getByText("Contato revisado", { exact: true })
      .waitFor();
    await page.locator("#contactsPageSearch").fill("Contato revisado");
    const exportedFile = page.waitForEvent("download");
    await page.locator("#exportContactsBtn").click();
    const xlsx = await (await exportedFile).path();
    const book = new ExcelJS.Workbook(); await book.xlsx.readFile(xlsx);
    const contactsSheet = book.getWorksheet('Contatos');
    assert.equal(contactsSheet.rowCount, 2, 'export respects the contact search');
    assert.equal(contactsSheet.getCell('B2').value, '5511977776666', 'phones remain text in Excel');
    const csvRows = [];
    contactsSheet.eachRow(row => csvRows.push(row.values.slice(1).map(value => '"' + String(value || '').replace(/"/g, '""') + '"').join(';')));
    await page.locator("#importContactsBtn").click();
    await page
      .locator("#importContactsFile")
      .setInputFiles({
        name: "reimportar.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvRows.join('\r\n')),
      });
    await page.locator("#submitContactsImport").click();
    await page
      .getByText("0 novo(s), 1 atualizado(s)", { exact: false })
      .waitFor();
    assert.equal(
      (await api("/api/contacts")).contacts.filter(
        (contact) => contact.number === "5511977776666",
      ).length,
      1,
    );
    await page
      .locator("#importContactsFile")
      .setInputFiles({
        name: "invalido.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Nome;Telefone\nErro;abc"),
      });
    await page.locator("#submitContactsImport").click();
    await page.locator("#importContactsError").waitFor({ state: "visible" });
    assert.equal(await page.locator("#submitContactsImport").isEnabled(), true);
    console.log(
      "PASS: CSV upload persists, XLSX export preserves filtered contacts and phone text, converted CSV reimports without duplicates and bad files can be retried",
    );

    await page.goto(base + "/tags");
    await page.locator("#tagsSettingsList .record-actions-trigger").click();
    await page.locator("#tagsSettingsList [data-action=edit]").click();
    assert.equal(
      await page.locator(".resource-editor [name=name]").inputValue(),
      'VIP "Especial"',
    );
    await page.locator(".resource-editor [name=name]").fill("VIP revisado");
    await page.locator(".resource-editor [type=submit]").click();
    await page
      .locator("#tagsSettingsList")
      .getByText("VIP revisado", { exact: true })
      .waitFor();
    await page.goto(base + "/departamentos");
    await page.locator("#deptsSettingsList .record-actions-trigger").click();
    await page.locator("#deptsSettingsList [data-action=delete]").click();
    await page.locator("#confirmOk").click();
    await page
      .getByText(
        "Transfira os chips deste departamento antes de exclu\u00ed-lo.",
        { exact: true },
      )
      .waitFor();
    assert.equal((await api("/api/departments")).departments.length, 1);
    await page.locator("#accountAvatarBtn").click();
    await page.waitForURL("**/configuracoes");
    await page.locator("#profileForm").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.getElementById("profileUsername")?.value === "pages-test");
    assert.equal(await page.locator("#profileModal").count(), 0);
    assert.equal(await page.locator("#profileUsername").inputValue(), "pages-test");
    await page.locator("#profileDisplayName").fill("Operador revisado");
    await page.locator("#profileCurrentPassword").fill("senha-incorreta");
    await page.locator("#profileSaveBtn").click();
    await page.locator("#profileError").getByText("Senha atual incorreta.", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/configuracoes");
    assert.equal(await page.locator("#profileDisplayName").inputValue(), "Operador revisado");
    await page.locator("#profileCurrentPassword").fill("pages-test-password");
    await page.locator("#profileSaveBtn").click();
    await page.getByText("Perfil atualizado.", { exact: true }).waitFor();
    assert.equal(await page.locator("#profileCurrentPassword").inputValue(), "");
    await page.reload();
    await page.waitForFunction(() => document.getElementById("profileDisplayName")?.value === "Operador revisado");
    await page.goto(base + "/atendimento");
    await page.locator("#myAccountBtn").click();
    await page.waitForURL("**/configuracoes");
    await page.waitForFunction(() => document.getElementById("profileUsername")?.value === "pages-test");
    await page.goto(base + "/contatos");
    await page.locator("#profileBtn").click();
    await page.waitForURL("**/configuracoes");
    await page.locator("#profileForm").waitFor({ state: "visible" });
    console.log(
      "PASS: tag editing, department conflict and dedicated profile page through all account links",
    );

    await page.goto(base + "/chips");
    await page.locator(".chip-name").waitFor();
    assert.equal(await page.locator(".chip-name b").count(), 0);
    assert.equal(
      await page.locator(".chip-department-field select").inputValue(),
      String(department.id),
    );
    await page.goto(base + "/configuracoes");
    assert.ok(await page.locator("#profileForm").isVisible());
    assert.equal(await page.locator("#settingsPage .settings-group").count(), 0);
    assert.equal(await page.locator("#settingsPage #chipsList, #settingsPage #followupsList").count(), 0);
    assert.deepEqual(errors, []);
    await page.goto(base + "/funis");
    await page.locator("#funnelStatus").selectOption("all");
    await page.screenshot({
      path: path.join(tempRoot, "funis-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(tempRoot, "funis-mobile.png"),
      fullPage: true,
    });
    await page.goto(base + "/equipe");
    await page.locator("#newTeamMemberBtn").click();
    await page.locator("#teamMemberName").fill("Renato Soares");
    await page.locator("#teamMemberEmail").fill("renato@waprepresentacoes.com.br");
    await page.locator("#teamMemberRole").selectOption("Gerente");
    await page.locator("#teamMemberPassword").fill("123456");
    await page.locator("#teamMemberSave").click();
    await page.locator("#teamMemberModal").waitFor({ state: "hidden" });
    await page.locator("#teamTable").getByText("Renato Soares", { exact: true }).waitFor();
    console.log("PASS: chips, profile-only settings and team member creation");

    // Exercise React state, async errors and retry without any external WhatsApp send.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/atendimento");
    await page.waitForFunction(() => !!window.AppCore);
    await page.locator("#tabBtnContacts").click();
    assert.equal(await page.locator("#tabContacts").isVisible(), true);
    await page.locator("#tabBtnConversations").click();
    await page.keyboard.press("/");
    assert.equal(
      await page
        .locator("#conversationSearch")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.locator("#sidebarToggle").click();
    assert.equal(
      await page
        .locator(".app")
        .evaluate((element) => element.classList.contains("app--collapsed")),
      true,
    );
    await page.locator("#sidebarToggle").click();
    mockState.status = { connected: true };
    io.emit("status", mockState.status);
    await page.locator("#composerInput").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.getElementById("composerInput").disabled,
    );
    await page.locator("#composerInput").fill("Mensagem com emoji ");
    await page.locator("#emojiBtn").click();
    await page.getByRole("button", { name: "Inserir 👍", exact: true }).click();
    assert.equal(
      await page.locator("#composerInput").inputValue(),
      "Mensagem com emoji 👍",
    );
    await page.route("**/api/reply", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Envio indisponível" }),
      }),
    );
    await page.locator("#sendBtn").click();
    await page.getByText("Envio indisponível", { exact: true }).waitFor();
    assert.equal(
      await page.locator("#composerInput").inputValue(),
      "Mensagem com emoji 👍",
    );
    await page.unroute("**/api/reply");
    await page.locator("#sendBtn").click();
    await page
      .locator("#chatLog")
      .getByText("Mensagem com emoji 👍", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#composerInput").inputValue(), "");
    const incomingAudioConversation = {
      number: "551188887777",
      name: "Cliente teste",
      messages: [
        {
          id: 1,
          from: "client",
          text: "Mensagem com emoji 👍",
          at: new Date().toISOString(),
        },
        {
          id: 2,
          from: "client",
          type: "audio",
          mediaUrl: "/audio-de-teste.ogg",
          fileName: "audio.ogg",
          at: new Date().toISOString(),
        },
      ],
    };
    mockState.conversations[incomingAudioConversation.number] = incomingAudioConversation;
    io.emit("message", incomingAudioConversation);

    await page.locator(".react-audio-player").waitFor();
    assert.ok(
      (await page.locator(".react-audio-player").boundingBox()).width > 220,
    );
    assert.equal(
      await page.getByRole("button", { name: "Reproduzir áudio" }).count(),
      1,
    );
    assert.equal(await page.getByLabel("Velocidade do áudio").count(), 1);
    // Existing messages stay mounted and don't replay entrance effects when switching chats/tabs.
    await page.locator("#tabBtnContacts").click();
    await page.locator("#tabBtnConversations").click();
    assert.equal(
      await page
        .locator(".message-bubble")
        .evaluateAll((items) =>
          items.some((item) => item.getAnimations().length > 0),
        ),
      false,
    );
    await page
      .locator("#fileInput")
      .setInputFiles({
        name: "anexo.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("teste local"),
      });
    await page.locator("#filePreviewName").getByText("anexo.txt").waitFor();
    await page.locator("#removeFileBtn").click();
    assert.equal(
      await page.locator("#fileInput").evaluate((input) => input.files.length),
      0,
    );
    await page
      .locator("#fileInput")
      .setInputFiles({
        name: "anexo.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("teste local"),
      });
    await page.locator("#composerInput").fill("Legenda do arquivo");
    await page.locator("#sendBtn").click();
    await page
      .locator("#chatLog")
      .getByText("Legenda do arquivo", { exact: true })
      .waitFor();
    await page
      .locator("#chatLog .document-link")
      .getByText("anexo.txt")
      .waitFor();
    await page.locator("#chatMoreDetails summary").click();
    assert.equal(await page.locator("#chatMoreDetails").getAttribute("open"), "");
    await page.getByRole("button", { name: "Dados do contato", exact: true }).click();
    assert.match(await page.locator("#chatMoreName").innerText(), /Cliente teste/);
    assert.equal(await page.locator("#chatMoreViewProfileBtn").count(), 0);
    const openChatMenu = async () => {
      if (!(await page.locator("#chatMoreDetails").evaluate((element) => element.open)))
        await page.locator("#chatMoreDetails summary").click();
    };
    await openChatMenu();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#chatMoreDetails").evaluate((element) => element.open), false);
    await openChatMenu();
    await page.locator("#composerInput").click();
    assert.equal(await page.locator("#chatMoreDetails").evaluate((element) => element.open), false);
    await openChatMenu();
    await page.locator("#transferConversationBtn").click();
    await page.locator("#bulkTransferModal").waitFor({ state: "visible" });
    await page.locator("#bulkTransferCancel").click();
    await openChatMenu();
    await page.locator("#tagsBtn").click();
    await page.locator('#tagsModalContent [data-tag="VIP revisado"]').click();
    await page.locator("#tagsModalSave").click();
    await page
      .locator("#activeTagsPills")
      .getByText("VIP revisado", { exact: true })
      .waitFor();
    await openChatMenu();
    await page.locator("#blockBtn").click();
    await openChatMenu();
    await page
      .locator("#blockBtn")
      .getByText("Desbloquear contato", { exact: true })
      .waitFor();
    await page.locator("#blockBtn").click();
    await openChatMenu();
    await page.locator("#finalizeBtn").click();
    await page.locator("#confirmOk").click();
    await openChatMenu();
    await page
      .locator("#finalizeBtn")
      .getByText("Reabrir atendimento", { exact: true })
      .waitFor();
    await page.locator("#finalizeBtn").click();
    await page.locator("#confirmOk").click();
    await openChatMenu();
    await page
      .locator("#finalizeBtn")
      .getByText("Finalizar atendimento", { exact: true })
      .waitFor();
    await page.locator("#clearBtn").click();
    await page.locator("#confirmOk").click();
    await page
      .locator("#chatLog")
      .getByText("Sem mensagens ainda", { exact: true })
      .waitFor();
    // A cancelled confirmation must settle its promise and re-enable its trigger.
    await openChatMenu();
    await page.locator("#deleteBtn").click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.getElementById("deleteBtn").disabled,
    );
    assert.equal(await page.locator("#confirmModal").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: React tabs, keyboard, sidebar, emojis, text/media retry, tags, block, finalize/reopen and clear",
    );

    await page.goto(base + "/fluxos");
    await page.getByRole('button',{name:'Variáveis Globais',exact:true}).click();
    await page.getByLabel('Nome da variável',{exact:true}).fill('empresa');
    await page.getByLabel('Valor padrão',{exact:true}).fill('Empresa teste');
    await page.getByRole('button',{name:'Salvar variável',exact:true}).click();
    await page.locator('.fb-variable-list').getByText(/Empresa teste/).waitFor();
    await page.locator('.fb-variable-list').getByRole('button',{name:'Excluir',exact:true}).click();
    await page.locator('#confirmOk').click();
    await page.waitForFunction(()=>document.querySelectorAll('.fb-variable-list article').length===0);
    await page.goto(base + "/tags");
    await page.locator("#addTagBtn").click();
    await page.getByRole("button", { name: "Azul", exact: true }).click();
    assert.equal(
      await page.locator(".resource-editor [name=color]").inputValue(),
      "#5c8df6",
    );
    await page.keyboard.press("Escape");
    // Pointer and keyboard clicks animate; device preference disables all effects.
    await page
      .locator("#addTagBtn")
      .evaluate((button) =>
        button.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            isPrimary: true,
            button: 0,
            clientX: button.getBoundingClientRect().x + 10,
            clientY: button.getBoundingClientRect().y + 10,
          }),
        ),
      );
    assert.ok((await page.locator(".motion-ripple").count()) > 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelectorAll(".motion-ripple").length === 0,
    );
    await page.locator("#addTagBtn").click();
    assert.equal(await page.locator(".motion-ripple").count(), 0);
    assert.equal(
      await page
        .locator(".resource-editor")
        .evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    console.log(
      "PASS: React global variables, tag color selection, click effects and reduced motion",
    );

    for (const theme of ["light", "dark"]) {
      await page.locator('[data-theme="' + theme + '"].theme-btn').click();
      for (const route of ["atendimento", "funis", "contatos"]) {
        await page.goto(base + "/" + route);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        const field = page.locator(
          route === "atendimento"
            ? "#departmentFilter"
            : route === "funis"
              ? "#funnelStatus"
              : "#contactsPageSort",
        );
        const overflow = await field.evaluate(
          (el) => el.getBoundingClientRect().right > innerWidth,
        );
        assert.equal(overflow, false, route + " select overflows");
        await field.click();
        await page.screenshot({
          path: path.join(tempRoot, route + "-" + theme + "-select.png"),
          fullPage: true,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        if (route === "contatos") {
          await page.locator("#importContactsBtn").click();
          await page.screenshot({
            path: path.join(tempRoot, "import-" + theme + "-mobile.png"),
            fullPage: true,
            animations: "disabled",
          });
          assert.equal(
            await page.locator("#importContactsFile").isVisible(),
            true,
          );
          await page.locator("#cancelContactsImport").click();
        }
      }
    }
    await page.goto(base + "/funis");
    await page.goto(base + "/contatos/?origem=f5");
    await page.goBack();
    assert.equal(new URL(page.url()).pathname, "/funis");
    await page.goForward();
    assert.equal(new URL(page.url()).pathname, "/contatos/");
    await context.request.post(base + "/api/logout");
    // The open socket can redirect to login before reload completes.
    await page.reload().catch(error => {
      if (!error.message.includes('net::ERR_ABORTED')) throw error;
    });
    await page.waitForURL((url) => url.pathname === "/");
    assert.equal(
      new URL(page.url()).searchParams.get("redirect"),
      "/contatos/?origem=f5",
    );
    await page.locator("#username").fill("pages-test");
    await page.locator("#password").fill("pages-test-password");
    await page.locator("#authSubmit").click();
    await page.waitForURL("**/contatos/?origem=f5");
    await page
      .locator("#contactsTable")
      .getByText("Contato revisado", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: light/dark filters, mobile import, back/forward and session renewal preserve route",
    );
    // Advance both clocks to verify the open panel returns to login on expiry.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 2 * 60 * 60 * 1000 + 1000;
      await page.clock.fastForward(2 * 60 * 60 * 1000 + 1000);
      await page.waitForURL((url) => url.pathname === "/");
      await page.locator("#loginForm").waitFor();
      assert.equal(new URL(page.url()).searchParams.get("redirect"), "/contatos/?origem=f5");
    } finally {
      Date.now = realNow;
    }
    console.log("PASS: remember-login switch, two-hour cookie and automatic expiry redirect");
    console.log("All page checks passed.");
  } finally {
    await flowService.stop();
    if (browser) await browser.close();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    const resolved = path.resolve(storageDir);
    if (
      resolved.startsWith(tempRoot + path.sep) &&
      path.basename(resolved).startsWith("pages-")
    )
      fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
