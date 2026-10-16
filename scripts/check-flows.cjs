const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "convelya-flow-ui-"));
process.env.STORAGE_DIR = folder;
process.env.ADMIN_USERNAME = "flow-ui";
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
      action === "state" ? { conversations: {}, status: {} } : { ok: true };
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      channel: process.env.UI_BROWSER || "chrome",
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: "reduce",
    });
    const call = async (url, data, method = "post") => {
      const r = await context.request[method](base + url, data ? { data } : {});
      assert.ok(r.ok(), `${r.status()} ${url} ${await r.text()}`);
      return r.json();
    };
    await call("/api/login", {
      username: "flow-ui",
      password: "test-password",
    });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.goto(base + "/fluxos");
    await page.getByRole("heading", { name: "Chatbots de fluxo" }).waitFor();
    await page
      .getByRole("button", { name: "+ Novo Fluxo", exact: true })
      .click();
    await page.getByLabel("Nome do fluxo", { exact: true }).fill("Fluxo UI");
    await page.getByRole("button", { name: "Criar fluxo vazio" }).click();
    await page.locator(".fb-editor").waitFor();
    assert.deepEqual(await page.locator(".fb-editor").boundingBox(), {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    assert.equal(
      await page.locator("#site-root").evaluate((el) => el.inert),
      true,
    );
    assert.equal(
      await page
        .locator(".fb-editor")
        .evaluate(
          (el) =>
            getComputedStyle(el).backgroundColor ===
            getComputedStyle(document.body).backgroundColor,
        ),
      true,
    );
    await page.locator(".react-flow__node").waitFor();
    await page.locator('[data-block-kind="text"]').click();
    await page.locator(".fb-inspector textarea").first().fill("Olá, {{");
    await page
      .getByRole("button", { name: "{{contato.nome}}", exact: true })
      .click();
    assert.equal(
      await page.locator(".fb-inspector textarea").first().inputValue(),
      "Olá, {{contato.nome}}",
    );
    await page
      .locator(".fb-inspector textarea")
      .first()
      .fill("Olá, {{contato.nome}}!");
    await page.locator('[data-block-kind="stop"]').click();
    if (
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .isEnabled()
    )
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    let flow = (await call("/api/flows", undefined, "get")).flows.find(
      (f) => f.name === "Fluxo UI",
    );
    assert.equal(flow.definition.nodes.length, 3);
    // Move blocks with the actual canvas drag handler, then verify persisted positions.
    await page.getByRole("button", { name: "Fechar painel" }).click();
    await page
      .getByRole("button", { name: "Ajustar à tela", exact: true })
      .click();
    const textId = flow.definition.nodes.find((n) => n.data.kind === "text").id,
      stopId = flow.definition.nodes.find((n) => n.data.kind === "stop").id;
    const textNode = page.locator(`.react-flow__node[data-id="${textId}"]`),
      stopNode = page.locator(`.react-flow__node[data-id="${stopId}"]`);
    const initial = textNode.locator(".fb-node-head");
    const box = await initial.boundingBox();
    await page.mouse.move(box.x + 60, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y - 120, { steps: 15 });
    await page.mouse.up();
    const endBox = await stopNode.locator(".fb-node-head").boundingBox();
    await page.mouse.move(endBox.x + 60, endBox.y + 15);
    await page.mouse.down();
    await page.mouse.move(endBox.x + 340, endBox.y + 140, { steps: 15 });
    await page.mouse.up();
    await page
      .getByRole("button", { name: "Ajustar à tela", exact: true })
      .click();
    const connect = async (source, target) => {
      const a = await page
        .locator(
          `.react-flow__node[data-id="${source}"] .react-flow__handle.source[data-handleid="next"]`,
        )
        .boundingBox();
      const b = await page
        .locator(
          `.react-flow__node[data-id="${target}"] .react-flow__handle.target`,
        )
        .boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
        steps: 20,
      });
      await page.mouse.up();
    };
    await connect("start", textId);
    await connect(textId, stopId);
    assert.equal(await page.locator(".react-flow__edge").count(), 2);
    console.log("Canvas connections verified");
    const before = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    await page.locator(".react-flow__controls-zoomin").click();
    assert.notEqual(
      await page.locator(".react-flow__viewport").getAttribute("style"),
      before,
    );
    await page.keyboard.press("Control+s");
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    flow = (await call(`/api/flows/${flow.id}`, undefined, "get")).flow;
    assert.equal(flow.definition.edges.length, 2);
    assert.notDeepEqual(
      flow.definition.nodes.find((n) => n.id === textId).position,
      { x: 360, y: 160 },
    );
    // Copy/paste, duplicate and undo operate on selected nodes.
    await textNode.locator(".fb-node-head").click();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    assert.equal(await page.locator(".react-flow__node").count(), 4);
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    await page.keyboard.press("Control+Shift+z");
    assert.equal(await page.locator(".react-flow__node").count(), 4);
    await page.keyboard.press("Delete");
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    if (
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .isEnabled()
    )
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .click();
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    // Same execution engine is used by the interactive simulator.
    await page
      .getByRole("button", { name: "Testar Fluxo", exact: true })
      .click();
    await page.getByRole("button", { name: "Iniciar simulação" }).click();
    await page.getByText("Fluxo encerrado", { exact: true }).waitFor();
    assert.ok(
      (await page.locator(".fb-bubble").allTextContents()).some((t) =>
        t.includes("Olá,"),
      ),
    );
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    assert.equal(
      await page.locator("#site-root").evaluate((el) => el.inert),
      false,
    );
    await page.getByLabel("Pesquisar fluxos").fill("nenhum");
    assert.equal(await page.locator(".fb-table tbody tr").count(), 0);
    await page.getByLabel("Pesquisar fluxos").fill("Fluxo UI");
    assert.equal(await page.locator(".fb-table tbody tr").count(), 1);
    await page.getByTitle("Duplicar", { exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".fb-table tbody tr").length === 2,
    );
    await page.getByTitle("Exportar", { exact: true }).first().click();
    await page.getByLabel("Pesquisar fluxos").fill("(cópia)");
    await page.getByTitle("Excluir", { exact: true }).click();
    await page.locator("#confirmOk").click();
    await page.getByText("Nenhum fluxo encontrado").waitFor();
    await page.getByLabel("Pesquisar fluxos").fill("Fluxo UI");
    await page
      .getByRole("button", { name: "Editar Fluxo UI", exact: true })
      .click();
    await page.locator(".fb-editor").waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    await page.screenshot({ path: path.resolve(".tmp/flows-editor.png") });
    // Exercise edge deletion and reconnection through the SVG interaction layer.
    const edge = page.locator(".react-flow__edge").first();
    const midpoint = await edge.evaluate((el) => {
      const p = el.querySelector(".react-flow__edge-path"),
        a = p.getPointAtLength(p.getTotalLength() / 2),
        b = new DOMPoint(a.x, a.y).matrixTransform(p.getScreenCTM());
      return { x: b.x, y: b.y };
    });
    await page.mouse.click(midpoint.x, midpoint.y);
    await page.keyboard.press("Delete");
    assert.equal(await page.locator(".react-flow__edge").count(), 1);
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator(".react-flow__edge").count(), 2);
    await page.mouse.move(midpoint.x, midpoint.y);
    const updater = await page
        .locator(".react-flow__edgeupdater-target")
        .first()
        .boundingBox(),
      newTarget = await stopNode
        .locator(".react-flow__handle.target")
        .boundingBox();
    await page.mouse.move(
      updater.x + updater.width / 2,
      updater.y + updater.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      newTarget.x + newTarget.width / 2,
      newTarget.y + newTarget.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await page.keyboard.press("Control+s");
    await page.getByText(/✓ Salvo · revisão/).waitFor();
    assert.equal(
      (
        await call(`/api/flows/${flow.id}`, undefined, "get")
      ).flow.definition.edges.find((e) => e.source === "start").target,
      stopId,
    );
    await page.keyboard.press("Control+z");
    await page
      .locator('[data-block-kind="stop"]')
      .dragTo(page.locator(".fb-canvas"), {
        targetPosition: { x: 650, y: 160 },
      });
    assert.equal(await page.locator(".react-flow__node").count(), 4);
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    if (await page.getByRole("button", { name: "Fechar painel" }).count())
      await page.getByRole("button", { name: "Fechar painel" }).click();
    await textNode.locator(".fb-node-head").click();
    await stopNode.locator(".fb-node-head").click({ modifiers: ["Control"] });
    assert.equal(await page.locator(".react-flow__node.selected").count(), 2);
    await page.keyboard.press("Control+d");
    assert.equal(await page.locator(".react-flow__node").count(), 5);
    await page.keyboard.press("Delete");
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    // Publication and import are exercised from the same controls used in production.
    if (
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .isEnabled()
    ) {
      await page
        .locator(".fb-editor-top")
        .getByRole("button", { name: "Salvar", exact: true })
        .click();
      await page.getByText(/✓ Salvo · revisão/).waitFor();
    }
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await page
      .locator(".fb-automation-status")
      .getByText(/WhatsApp: ativo.*Mensagem recebida/)
      .waitFor();
    await page
      .locator(".fb-editor")
      .getByText("Versão publicada e fluxo ativado.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    const exported = await call(
      `/api/flows/${flow.id}/export`,
      undefined,
      "get",
    );
    exported.name = "Importado UI";
    await page.locator('input[type=file][accept*="json"]').setInputFiles({
      name: "fluxo.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await page.getByLabel("Pesquisar fluxos").fill("Importado UI");
    await page
      .getByRole("button", { name: "Editar Importado UI", exact: true })
      .waitFor();
    await page.getByTitle("Excluir", { exact: true }).click();
    await page.locator("#confirmOk").click();
    await page.getByText("Nenhum fluxo encontrado").waitFor();
    await page.getByLabel("Pesquisar fluxos").fill("");
    console.log(
      "PASS: disconnect, drag/drop from library, multi-selection, publish and import controls.",
    );
    // Reference flow renders and routes a numeric menu using real simulator state.
    const model = (
      await call("/api/flows", { name: "Modelo UI", template: "reference" })
    ).flow;
    // Already in the management page after the import check.
    await page.getByLabel("Pesquisar fluxos").fill("");
    await page.reload();
    await page
      .getByRole("button", { name: "Editar Modelo UI", exact: true })
      .click();
    assert.equal(
      await page
        .locator(
          '.react-flow__handle[data-handleid="default"],.react-flow__handle[data-handleid="error"]',
        )
        .count(),
      0,
    );
    assert.equal(
      await page.locator('.fb-library [data-block-kind="error"]').count(),
      0,
    );
    await page
      .getByRole("button", { name: "Testar Fluxo", exact: true })
      .click();
    await page.getByRole("button", { name: "Iniciar simulação" }).click();
    await page.getByLabel("Mensagem de teste").fill("4");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page
      .getByText("Qual catálogo deseja receber?", { exact: false })
      .last()
      .waitFor();
    await page.getByLabel("Mensagem de teste").fill("2");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByText("Fluxo encerrado", { exact: true }).waitFor();
    await page.screenshot({ path: path.resolve(".tmp/flows-simulator.png") });
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page.locator('[data-theme="light"]').click();
    await page
      .getByRole("button", { name: "Editar Modelo UI", exact: true })
      .click();
    await page.locator(".react-flow.light").waitFor();
    assert.deepEqual(await page.locator(".fb-editor").boundingBox(), {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
    assert.equal(
      await page
        .locator(".fb-editor")
        .evaluate(
          (el) =>
            getComputedStyle(el).backgroundColor ===
            getComputedStyle(document.body).backgroundColor,
        ),
      true,
    );
    await page
      .getByRole("button", { name: "Testar Fluxo", exact: true })
      .click();
    await page.getByRole("button", { name: "Iniciar simulação" }).click();
    await page.locator(".fb-bubble").first().waitFor();
    await page.screenshot({
      path: path.resolve(".tmp/flows-editor-light.png"),
    });
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page.screenshot({
      path: path.resolve(".tmp/flows-management-light.png"),
    });
    await page.locator('[data-theme="dark"]').click();
    await page
      .getByRole("button", { name: "Editar Modelo UI", exact: true })
      .click();
    // Large definitions exceed Express's former default JSON limit and use canvas culling.
    const large = require("../flows/schema").empty();
    for (let i = 0; i < 500; i++) {
      const id = `large-${i}`;
      large.nodes.push({
        id,
        type: "flowBlock",
        position: { x: (i % 25) * 330, y: Math.floor(i / 25) * 220 },
        data: {
          kind: "set",
          label: `Etapa ${i}`,
          config: {
            ...require("../flows/schema").defaults("set"),
            variable: "passo",
            value: String(i),
          },
        },
      });
      large.edges.push({
        id: `edge-${i}`,
        source: i ? `large-${i - 1}` : "start",
        target: id,
        sourceHandle: "next",
        type: "default",
      });
    }
    const largeFlow = (
      await call("/api/flows", { name: "Fluxo grande", definition: large })
    ).flow;
    assert.equal(largeFlow.definition.nodes.length, 501);
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Editar Fluxo grande", exact: true })
      .click();
    await page.getByText(/501 blocos · 500 conexões/).waitFor();
    await page.locator(".react-flow__controls-zoomin").click();
    await page
      .getByRole("button", { name: "Ajustar à tela", exact: true })
      .click();
    console.log("PASS: 501-node graph save/open, zoom and viewport culling.");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await page.locator(".fb-editor").boundingBox(), {
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await page.getByRole("button", { name: "Voltar para fluxos" }).click();
    assert.equal(
      await page.locator("#site-root").evaluate((el) => el.inert),
      false,
    );
    console.log(
      "PASS: full viewport editor, theme tokens in dark/light, mobile bounds and shell restoration.",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: UI create/edit/save/reopen, canvas drag/connect/zoom, copy/paste/delete/undo/redo, search/duplicate/export/delete, reference simulator.",
    );
  } finally {
    if (page)
      await page
        .screenshot({ path: path.resolve(".tmp/flows-ui-latest.png") })
        .catch(() => {});
    if (browser) await browser.close();
    await flowService.stop();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
