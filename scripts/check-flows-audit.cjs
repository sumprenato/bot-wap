const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const schema = require("../flows/schema");
const folder = fs.mkdtempSync(
  path.join(os.tmpdir(), "convelya-flow-inspectors-"),
);
process.env.STORAGE_DIR = folder;
process.env.ADMIN_USERNAME = "inspectors-owner";
process.env.ADMIN_PASSWORD = "test-password";
delete process.env.DATABASE_URL;
delete process.env.DATABASE_PRIVATE_URL;
const { server, io, bot, db, flowService } = require("../server");

async function main() {
  let browser, page;
  try {
    await db.ready;
    bot.ensureWorker = () => ({ child: { connected: true } });
    bot.request = async (_, action) =>
      action === "state"
        ? { conversations: {}, status: { connected: false } }
        : { ok: true };
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      channel: process.env.UI_BROWSER || "chrome",
    });
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      reducedMotion: "reduce",
    });
    const call = async (url, data, method = "post") => {
      const res = await context.request[method](
        base + url,
        data ? { data } : {},
      );
      assert.ok(res.ok(), `${res.status()} ${url}: ${await res.text()}`);
      return res.json();
    };
    await call("/api/login", {
      username: "inspectors-owner",
      password: "test-password",
    });
    const department = (
      await call("/api/departments", { name: "Audit department" })
    ).department;
    const column = (await call("/api/kanban/columns", { name: "Audit stage" }))
      .column;
    const target = (await call("/api/flows", { name: "Audit destination" }))
      .flow;
    const flow = (await call("/api/flows", { name: "Audit all blocks" })).flow;
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/fluxos");
    await page
      .getByRole("button", { name: "Editar Audit all blocks", exact: true })
      .click();
    const expected = new Map();
    const field = (label) =>
      page
        .locator(".fb-inspector label")
        .filter({
          hasText: new RegExp(
            "^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        })
        .first()
        .locator("input,textarea,select")
        .first();
    await page.locator('.react-flow__node[data-id="start"]').click();
    await field("Nome do bloco").fill("Início inspecionado");
    assert.equal(
      await page
        .locator(".fb-inspector")
        .getByRole("button", { name: "Excluir bloco", exact: true })
        .count(),
      0,
    );
    for (const block of Object.values(schema.blocks)) {
      if (["start", "trigger"].includes(block.type)) continue;
      console.log("Inspector:", block.type);
      await page.locator(`[data-block-kind="${block.type}"]`).click();
      await page.locator(".fb-inspector").waitFor();
      await field("Nome do bloco").fill("Audit " + block.type);
      if (block.fields.some((f) => f.key === "text"))
        await field(block.fields.find((f) => f.key === "text").label).fill(
          "Mensagem " + block.type + " {{contato.nome}}",
        );
      if (block.fields.some((f) => f.key === "variable"))
        await field(block.fields.find((f) => f.key === "variable").label).fill(
          block.type === "switch" ? "fluxo.audit" : "audit_" + block.type,
        );
      if (block.type === "http") {
        await field("URL HTTPS").fill("https://example.test/audit");
        await field("Método").fill("POST");
        await field("Body JSON").fill(
          JSON.stringify({ name: "{{contato.nome}}", quote: '"á"' }),
        );
        await field("Body JSON").press("Tab");
        await field("Body JSON").fill('{"incomplete":');
        await field("Body JSON").press("Tab");
        await page
          .locator(".fb-editor-top")
          .getByRole("button", { name: "Salvar", exact: true })
          .click();
        await page
          .locator(".fb-editor > .page-notice")
          .getByText("Corrija o JSON inválido antes de salvar ou publicar.", {
            exact: true,
          })
          .waitFor();
        await page
          .locator(".fb-editor > .page-notice")
          .getByRole("button", { name: "Dispensar" })
          .click();
        await field("Body JSON").fill(
          JSON.stringify({ name: "{{contato.nome}}", quote: '"á"' }),
        );
        await field("Body JSON").press("Tab");
      }
      if (block.type === "script") {
        await page.getByLabel("Código JavaScript").fill('return "manha";');
        await page
          .getByRole("button", { name: "Testar script", exact: true })
          .click();
        await page
          .locator(".fb-inspector pre")
          .filter({ hasText: '"result": "manha"' })
          .waitFor();
      }
      if (["menu", "buttons", "quickReply"].includes(block.type)) {
        await page
          .getByLabel("Texto da opção 1", { exact: true })
          .fill("Primeira opção");
        await page
          .getByRole("button", { name: "+ Adicionar opção", exact: true })
          .click();
        const count = await page.locator(".fb-option").count();
        await page
          .getByLabel("Texto da opção " + count, { exact: true })
          .fill("Última opção");
        await page.getByTitle("Remover opção", { exact: true }).last().click();
        assert.equal(await page.locator(".fb-option").count(), count - 1);
      }
      if (block.type === "moveOpportunity")
        await field("Etapa de destino").selectOption(String(column.id));
      if (block.type === "redirect")
        await field("Identificador do destino").selectOption(
          String(department.id),
        );
      if (block.type === "distribute")
        await field("Departamento").selectOption(String(department.id));
      if (block.fields.some((f) => f.key === "caption"))
        await field("Legenda").fill("Legenda " + block.type);
      if (block.fields.some((f) => f.type === "asset")) {
        const buffers = {
          image: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPp0AAAAASUVORK5CYII=",
            "base64",
          ),
          audio: Buffer.concat([
            Buffer.from("RIFF"),
            Buffer.alloc(4),
            Buffer.from("WAVEfmt "),
            Buffer.alloc(32),
          ]),
          video: Buffer.from([
            0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
            105, 115, 111, 109,
          ]),
          document: Buffer.from("%PDF-1.4\n%%EOF"),
        };
        const info = {
          image: ["image/png", "png"],
          audio: ["audio/wav", "wav"],
          video: ["video/mp4", "mp4"],
          document: ["application/pdf", "pdf"],
        }[block.type];
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        await page.route("**/api/flows-assets", async (route) => {
          const response = await route.fetch();
          await gate;
          await route.fulfill({ response });
        });
        await page.locator(".fb-inspector input[type=file]").setInputFiles({
          name: "audit." + info[1],
          mimeType: info[0],
          buffer: buffers[block.type],
        });
        await page.getByText("Enviando arquivo…", { exact: true }).waitFor();
        if (block.type === "image")
          await field("Legenda").fill("Legenda alterada durante upload");
        release();
        await page
          .locator(".fb-inspector a")
          .filter({ hasText: "audit." + info[1] })
          .waitFor();
        await page.unroute("**/api/flows-assets");
        if (block.type === "image")
          assert.equal(
            await field("Legenda").inputValue(),
            "Legenda alterada durante upload",
            "an upload must not overwrite edits made while it was in progress",
          );
      }
      const name = await field("Nome do bloco").inputValue();
      expected.set(block.type, name);
    }
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    const saved = (await call("/api/flows/" + flow.id, undefined, "get")).flow;
    for (const [kind, name] of expected) {
      const node = saved.definition.nodes.find((n) => n.data.kind === kind);
      assert.equal(node?.data.label, name, "inspector save " + kind);
      if (["image", "audio", "video", "document"].includes(kind))
        assert.ok(node.data.config.assetId, "asset save " + kind);
    }
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page
      .getByRole("button", { name: "Editar Audit all blocks", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ajustar à tela", exact: true })
      .click();
    assert.equal(await page.locator('[data-block-kind="error"]').count(), 0);
    await page
      .getByRole("button", { name: "Ver gatilhos", exact: true })
      .click();
    assert.ok(
      await page.getByText("Gatilhos automáticos", { exact: true }).isVisible(),
    );
    await page
      .locator(".fb-check")
      .filter({ hasText: "Salvamento automático" })
      .locator("input")
      .check();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".fb-editor-top button") &&
        !document
          .querySelector(".fb-title small")
          .textContent.includes("não salvas"),
    );
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page
      .getByRole("button", { name: "Editar Audit all blocks", exact: true })
      .click();
    const title = page.getByLabel("Nome do fluxo", { exact: true });
    await title.fill("Recuperação de rascunho");
    await page.waitForFunction(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("convelya-flow:") &&
          localStorage.getItem(key).includes("Recuperação de rascunho"),
      ),
    );
    // Disable autosave in memory through the visible checkbox before testing recovery.
    await page
      .getByRole("button", { name: "Ver gatilhos", exact: true })
      .click();
    await page
      .locator(".fb-check")
      .filter({ hasText: "Salvamento automático" })
      .locator("input")
      .uncheck();
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page.locator("#confirmOk").click();
    await page
      .getByRole("button", { name: "Editar Audit all blocks", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Recuperar alterações", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Nome do fluxo", { exact: true }).inputValue(),
      "Recuperação de rascunho",
    );
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Variáveis Globais", exact: true })
      .click();
    const variables = page
      .locator(".fb-panel-content")
      .filter({ has: page.getByLabel("Nome da variável", { exact: true }) });
    const typed = {
      text: "false",
      number: 0.25,
      boolean: false,
      date: "2026-10-16",
      json: { items: [0, false, null] },
    };
    for (const scope of ["global", "flow"]) {
      await variables
        .getByRole("button", {
          name: scope === "global" ? "Da conta" : "Da execução",
          exact: true,
        })
        .click();
      for (const [type, value] of Object.entries(typed)) {
        const key = `ui_${scope}_${type}`;
        await variables
          .getByLabel("Nome da variável", { exact: true })
          .fill(key);
        await variables.getByLabel("Tipo", { exact: true }).selectOption(type);
        const control = variables.getByLabel("Valor padrão", { exact: true });
        if (type === "boolean") await control.selectOption(String(value));
        else
          await control.fill(
            type === "json" ? JSON.stringify(value) : String(value),
          );
        await control.press("Tab");
        await variables
          .getByRole("button", { name: "Salvar variável", exact: true })
          .click();
        await variables
          .locator("article")
          .filter({
            hasText: `{{${scope === "global" ? "global" : "fluxo"}.${key}}}`,
          })
          .waitFor();
      }
      const textRow = variables
        .locator("article")
        .filter({ hasText: `ui_${scope}_text` });
      await textRow
        .getByRole("button", { name: "Editar", exact: true })
        .click();
      await variables
        .getByLabel("Valor padrão", { exact: true })
        .fill("Texto revisado");
      await variables
        .getByRole("button", { name: "Salvar variável", exact: true })
        .click();
      await textRow
        .getByText('text · "Texto revisado"', { exact: true })
        .waitFor();
      await textRow
        .getByRole("button", { name: "Excluir", exact: true })
        .click();
      await page.locator("#confirmOk").click();
      await textRow.waitFor({ state: "detached" });
    }
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    const withVariables = (
      await call("/api/flows/" + flow.id, undefined, "get")
    ).flow;
    const globals = (await call("/api/global-variables", undefined, "get"))
      .variables;
    for (const [type, value] of Object.entries(typed)) {
      if (type === "text") continue;
      assert.deepEqual(
        withVariables.definition.variables.find(
          (v) => v.key === "ui_flow_" + type,
        )?.default,
        value,
      );
      const global = globals.find((v) => v.key === "ui_global_" + type);
      assert.deepEqual(
        schema.decodeVariable(global.value, global.value_type),
        value,
      );
    }
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    const triggerDefinition = schema.empty();
    triggerDefinition.nodes[0].data.kind = "trigger";
    triggerDefinition.nodes[0].data.label = "Início por gatilho";
    await call(
      "/api/flows/" + target.id,
      { revision: target.revision, definition: triggerDefinition },
      "put",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Editar Audit destination", exact: true })
      .click();
    await page
      .locator(".react-flow__node")
      .filter({ hasText: "Início por gatilho" })
      .click();
    await field("Nome do bloco").fill("Gatilho inspecionado");
    assert.equal(
      await page
        .locator(".fb-inspector")
        .getByRole("button", { name: "Excluir bloco", exact: true })
        .count(),
      0,
    );
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    assert.equal(
      (await call("/api/flows/" + target.id, undefined, "get")).flow.definition
        .nodes[0].data.label,
      "Gatilho inspecionado",
    );
    await page
      .getByRole("button", { name: "Ver gatilhos", exact: true })
      .click();
    const triggerKinds = [
      "message",
      "keyword",
      "firstMessage",
      "newContact",
      "tagAdded",
      "system",
      "api",
      "integration",
    ];
    for (const [index, type] of triggerKinds.entries()) {
      if (index)
        await page
          .getByRole("button", { name: "+ Adicionar gatilho", exact: true })
          .click();
      const item = page.locator(".fb-trigger").last();
      await item.locator("select").first().selectOption(type);
      if (!["message", "firstMessage", "newContact"].includes(type))
        await item.locator("input:not([type])").fill("audit-trigger");
      if (type === "keyword") {
        for (const mode of ["exact", "contains", "startsWith"])
          await item.locator("select").last().selectOption(mode);
      }
      await item.locator("input[type=number]").fill(String(index + 20));
      await item.locator("input[type=checkbox]").uncheck();
      await item.locator("input[type=checkbox]").check();
    }
    await page
      .getByRole("button", { name: "+ Adicionar gatilho", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Excluir gatilho 9", exact: true })
      .click();
    await page
      .getByLabel("Fuso horário", { exact: true })
      .fill("America/Manaus");
    await page
      .locator(".fb-editor-top")
      .getByRole("button", { name: "Salvar", exact: true })
      .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    const triggersSaved = (
      await call("/api/flows/" + target.id, undefined, "get")
    ).flow.definition;
    assert.deepEqual(
      triggersSaved.triggers.map((t) => t.type),
      triggerKinds,
    );
    assert.equal(triggersSaved.triggers[1].match, "startsWith");
    assert.equal(triggersSaved.settings.timezone, "America/Manaus");
    assert.ok(
      triggersSaved.triggers.every(
        (t, i) => t.priority === i + 20 && t.enabled,
      ),
    );
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();

    const historyDefinition = schema.empty();
    historyDefinition.nodes.push({
      id: "question",
      position: { x: 400, y: 0 },
      data: {
        kind: "question",
        label: "Pergunta auditada",
        config: { ...schema.defaults("question"), text: "Pergunta publicada" },
      },
    });
    historyDefinition.nodes.push({
      id: "end",
      position: { x: 800, y: 0 },
      data: { kind: "stop", label: "Fim", config: {} },
    });
    historyDefinition.edges.push({
      id: "start-question",
      source: "start",
      target: "question",
      sourceHandle: "next",
    });
    for (const port of ["next", "timeout"])
      historyDefinition.edges.push({
        id: "question-" + port,
        source: "question",
        target: "end",
        sourceHandle: port,
      });
    const historyFlow = (
      await call("/api/flows", {
        name: "Audit history",
        definition: historyDefinition,
      })
    ).flow;
    await call(`/api/flows/${historyFlow.id}/publish`, {
      revision: historyFlow.revision,
    });
    const publishedVersion = (
      await call(`/api/flows/${historyFlow.id}/versions`, undefined, "get")
    ).versions[0].version;
    historyDefinition.nodes[1].data.config.text = "Pergunta no rascunho";
    const historyDraft = (
      await call(
        `/api/flows/${historyFlow.id}`,
        { revision: historyFlow.revision, definition: historyDefinition },
        "put",
      )
    ).flow;
    const simulation = await call(`/api/flows/${historyFlow.id}/simulate`, {});
    assert.equal(simulation.run.status, "waiting");
    await page.reload();
    await page
      .getByRole("button", { name: "Editar Audit history", exact: true })
      .click();
    await page
      .locator(".fb-editor-top")
      .getByTitle("Histórico", { exact: true })
      .click();
    await page
      .locator(".fb-history-item")
      .getByRole("button")
      .filter({ hasText: "Simulação · waiting" })
      .click();
    await page
      .locator(".fb-history-detail")
      .getByText("Variáveis e respostas", { exact: true })
      .click();
    assert.ok(
      (await page.locator(".fb-history-detail pre").textContent()).includes(
        "variables",
      ),
    );
    await page
      .locator(".fb-history-item")
      .getByRole("button", { name: "Encerrar", exact: true })
      .click();
    await page.locator("#confirmOk").click();
    await page
      .locator(".fb-history-item")
      .getByText("Simulação · stopped", { exact: true })
      .waitFor();
    assert.equal(
      (
        await call(
          `/api/flows/${historyFlow.id}/runs/${simulation.run.id}`,
          undefined,
          "get",
        )
      ).run.status,
      "stopped",
    );
    await page
      .getByRole("button", { name: "Versões publicadas", exact: true })
      .click();
    await page
      .locator(".fb-history-item")
      .filter({ hasText: `Versão ${publishedVersion}` })
      .getByRole("button", { name: "Carregar como rascunho", exact: true })
      .click();
    await page.locator("#confirmOk").click();
    await page.locator('.react-flow__node[data-id="question"]').click();
    assert.equal(await field("Pergunta").inputValue(), "Pergunta publicada");
    assert.equal(
      (await call(`/api/flows/${historyFlow.id}`, undefined, "get")).flow
        .definition.nodes[1].data.config.text,
      "Pergunta no rascunho",
    );
    await page
      .locator(".fb-editor-top")
      .getByTitle("Histórico", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Revisões salvas", exact: true })
      .click();
    await page
      .locator(".fb-history-item")
      .filter({ hasText: `Revisão ${historyDraft.revision}` })
      .getByRole("button", { name: "Carregar como rascunho", exact: true })
      .click();
    await page.locator("#confirmOk").click();
    await page.locator('.react-flow__node[data-id="question"]').click();
    assert.equal(await field("Pergunta").inputValue(), "Pergunta no rascunho");
    await page
      .getByLabel("Nome do fluxo", { exact: true })
      .fill("Nome temporário");
    await page.getByRole("button", { name: "Redefinir", exact: true }).click();
    await page.locator("#confirmOk").click();
    assert.equal(
      await page.getByLabel("Nome do fluxo", { exact: true }).inputValue(),
      "Audit history",
    );
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.resolve(".tmp/flow-audit"), { recursive: true });
    await page.screenshot({
      path: path.resolve(".tmp/flow-audit/history-and-restore.png"),
    });
    console.log(
      `PASS: all 28 block inspectors, menu options, media uploads, script execution, persistence, autosave, recovery, five global/flow variable types, trigger controls, history details, stop, version/revision restore and reset.`,
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.resolve(".tmp/flow-audit-ui-failure.png") })
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
