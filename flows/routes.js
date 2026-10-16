const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const multer = require("multer");
const db = require("../db");
const rbac = require("../rbac");
const flows = require("./store");
const { validateReferences } = require("./adapter");
const { safeKey, normalizeDefinition, decodeVariable } = require("./schema");
const { script } = require("./security");
const { example } = require("./example");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1 },
});
const types = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav"],
  video: ["video/mp4"],
  document: [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};
function fileMatches(buffer, mime) {
  const s = buffer.subarray(0, 12);
  if (mime === "image/jpeg")
    return s[0] === 255 && s[1] === 216 && s[2] === 255;
  if (mime === "image/png")
    return s
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return (
      s.toString("ascii", 0, 4) === "RIFF" &&
      s.toString("ascii", 8, 12) === "WEBP"
    );
  if (mime === "application/pdf") return s.toString("ascii", 0, 5) === "%PDF-";
  if (mime.includes("openxmlformats")) return s[0] === 80 && s[1] === 75;
  if (mime.endsWith("/mp4")) return s.toString("ascii", 4, 8) === "ftyp";
  if (mime === "audio/ogg") return s.toString("ascii", 0, 4) === "OggS";
  if (mime === "audio/mpeg")
    return (
      s.toString("ascii", 0, 3) === "ID3" ||
      (s[0] === 255 && (s[1] & 224) === 224)
    );
  if (mime === "audio/wav")
    return (
      s.toString("ascii", 0, 4) === "RIFF" &&
      s.toString("ascii", 8, 12) === "WAVE"
    );
  return mime === "text/plain" && !buffer.includes(0);
}
function register(app, service) {
  const route = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res
        .status(error.statusCode || 400)
        .json({ error: error.message, validation: error.validation });
    }
  };
  const flow = async (req) => {
    const row = await flows.get(req.params.id);
    if (!row || !rbac.recordAllowed(req.access, row, "flows"))
      rbac.fail("Fluxo não encontrado.", 404);
    return row;
  };
  const run = async (req) => {
    const row = await db.get(
      "SELECT * FROM flow_runs WHERE id = ? AND account_id = ? AND flow_id = ?",
      [req.params.runId, req.access.accountId, req.params.id],
    );
    if (
      !row ||
      (row.mode === "simulation" && row.actor_id !== req.access.user.id) ||
      (!req.access.owner && row.actor_id !== req.access.user.id)
    )
      rbac.fail("Execução não encontrada.", 404);
    return row;
  };
  async function runView(req, id) {
    const row = await db.get(
      "SELECT * FROM flow_runs WHERE id = ? AND account_id = ?",
      [id, req.access.accountId],
    );
    return {
      run: { ...row, state: JSON.parse(row.state) },
      logs: await db.all(
        "SELECT * FROM flow_logs WHERE run_id = ? AND account_id = ? ORDER BY id",
        [id, req.access.accountId],
      ),
    };
  }
  app.get(
    "/api/flows",
    route(async (req, res) => res.json({ flows: await flows.list() })),
  );
  app.post(
    "/api/flows",
    route(async (req, res) => {
      let data = req.body || {};
      if (data.template === "reference")
        data = { ...data, definition: example() };
      if (data.import) {
        if (
          data.import.format !== "convelya-flow" ||
          data.import.schemaVersion !== 1
        )
          rbac.fail("Formato de importação inválido.", 400);
        data.import.definition = normalizeDefinition(data.import.definition);
        flows.assertDefinition(data.import.definition);
        data = {
          name: data.import.name,
          description: data.import.description,
          definition: flows.remap(data.import.definition),
        };
        // Imported flows are always drafts; no imported execution or activation state is trusted.
      }
      data.definition = flows.definitionFor(data);
      await validateReferencesForDraft(data.definition, req.access);
      res.status(201).json({ ok: true, flow: await flows.create(data) });
    }),
  );
  app.get(
    "/api/flows/:id",
    route(async (req, res) => res.json({ flow: await flow(req) })),
  );
  app.put(
    "/api/flows/:id",
    route(async (req, res) => {
      const current = await flow(req);
      if (req.body.definition || req.body.trigger_chips != null) {
        req.body.definition = flows.definitionFor(req.body, current.definition);
        await validateReferencesForDraft(req.body.definition, req.access);
      }
      const updated = await flows.update(req.params.id, req.body);
      if (!updated.active || !updated.triggers_enabled)
        await service.stopDisabledRuns(req.access.accountId, updated.id);
      res.json({ ok: true, flow: updated });
    }),
  );
  app.post(
    "/api/flows/:id/duplicate",
    route(async (req, res) => {
      if (!rbac.can(req.access, "fluxos.criar")) rbac.fail();
      const old = await flow(req);
      res.status(201).json({
        ok: true,
        flow: await flows.create({
          name: old.name.slice(0, 110) + " (cópia)",
          description: old.description,
          definition: flows.remap(old.definition),
          trigger_chips: old.trigger_chips,
        }),
      });
    }),
  );
  app.delete(
    "/api/flows/:id",
    route(async (req, res) => {
      await flow(req);
      if (req.body?.confirm !== true) rbac.fail("Confirme a exclusão.", 400);
      await flows.remove(req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/flows/:id/export",
    route(async (req, res) => {
      const row = await flow(req);
      res.json({
        format: "convelya-flow",
        schemaVersion: 1,
        name: row.name,
        description: row.description,
        definition: row.definition,
        exportedAt: new Date().toISOString(),
      });
    }),
  );
  app.post(
    "/api/flows/:id/publish",
    route(async (req, res) => {
      const row = await flow(req);
      flows.assertDefinition(row.definition, true);
      await validateReferences(row.definition, req.access);
      const published = await flows.publish(row.id, req.body.revision);
      service.start();
      res.json({ ok: true, flow: published });
    }),
  );
  app.get(
    "/api/flows/:id/versions",
    route(async (req, res) => {
      await flow(req);
      res.json({
        versions: await db.all(
          "SELECT id,version,created_by,created_at FROM flow_versions WHERE flow_id = ? AND account_id = ? ORDER BY version DESC",
          [req.params.id, req.access.accountId],
        ),
      });
    }),
  );
  app.get(
    "/api/flows/:id/revisions",
    route(async (req, res) => {
      await flow(req);
      res.json({
        revisions: await db.all(
          "SELECT revision,name,created_by,created_at FROM flow_revisions WHERE flow_id = ? AND account_id = ? ORDER BY revision DESC LIMIT 100",
          [req.params.id, req.access.accountId],
        ),
      });
    }),
  );
  app.get(
    "/api/flows/:id/revisions/:revision",
    route(async (req, res) => {
      await flow(req);
      const row = await db.get(
        "SELECT name,definition FROM flow_revisions WHERE flow_id = ? AND account_id = ? AND revision = ?",
        [req.params.id, req.access.accountId, req.params.revision],
      );
      if (!row) rbac.fail("Revisão não encontrada.", 404);
      res.json({
        name: row.name,
        definition: normalizeDefinition(JSON.parse(row.definition)),
      });
    }),
  );
  app.get(
    "/api/flows/:id/versions/:version",
    route(async (req, res) => {
      await flow(req);
      const row = await db.get(
        "SELECT definition FROM flow_versions WHERE flow_id = ? AND account_id = ? AND version = ?",
        [req.params.id, req.access.accountId, req.params.version],
      );
      if (!row) rbac.fail("Versão não encontrada.", 404);
      res.json({ definition: normalizeDefinition(JSON.parse(row.definition)) });
    }),
  );
  app.get(
    "/api/flows/:id/history",
    route(async (req, res) => {
      await flow(req);
      res.json({
        runs: await db.all(
          "SELECT id,version,chip_id,contact,mode,status,created_at,updated_at FROM flow_runs WHERE flow_id = ? AND account_id = ? AND (actor_id = ? OR (mode = 'live' AND ? = 1)) ORDER BY created_at DESC LIMIT 100",
          [
            req.params.id,
            req.access.accountId,
            req.access.user.id,
            Number(req.access.owner),
          ],
        ),
      });
    }),
  );
  app.get(
    "/api/flows/:id/runs/:runId",
    route(async (req, res) => {
      await flow(req);
      await run(req);
      res.json(await runView(req, req.params.runId));
    }),
  );
  app.post(
    "/api/flows/:id/runs/:runId/stop",
    route(async (req, res) => {
      await flow(req);
      const row = await run(req);
      if (row.status === "running")
        rbac.fail("Aguarde a operação em andamento.", 409);
      const state = JSON.parse(row.state);
      state.status = "stopped";
      state.wakeAt = null;
      delete state.retryAt;
      delete state.pendingInput;
      const stopped = await db.run(
        "UPDATE flow_runs SET state = ?, status = 'stopped', wake_at = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND account_id = ? AND status <> 'running'",
        [
          JSON.stringify(state),
          new Date().toISOString(),
          row.id,
          req.access.accountId,
        ],
      );
      if (!stopped.changes) rbac.fail("Aguarde a operação em andamento.", 409);
      await service.log(row, {
        detail: `Execução encerrada pelo usuário ${req.access.user.id}.`,
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/flows/:id/simulate",
    route(async (req, res) => {
      const row = await flow(req),
        definition = normalizeDefinition(req.body.definition || row.definition);
      flows.assertDefinition(definition);
      const simulation = req.body.simulation || {};
      const globals = Object.fromEntries(
        (
          await db.all("SELECT * FROM global_variables WHERE account_id = ?", [
            req.access.accountId,
          ])
        )
          .filter((v) => rbac.recordAllowed(req.access, v, "global_variables"))
          .map((v) => [v.key, decodeVariable(v.value, v.value_type)]),
      );
      const id = await service.createRun({
        accountId: req.access.accountId,
        flowId: row.id,
        version: row.revision,
        definition,
        actorId: req.access.user.id,
        mode: "simulation",
        context: { ...(req.body.context || {}), globals },
        simulation,
      });
      res.status(201).json(await runView(req, id));
    }),
  );
  app.post(
    "/api/flows/:id/runs/:runId/input",
    route(async (req, res) => {
      await flow(req);
      const row = await run(req);
      if (row.mode !== "simulation")
        rbac.fail("Entrada manual disponível apenas no simulador.", 400);
      const state = JSON.parse(row.state);
      if (req.body.now) {
        state.now = Date.parse(req.body.now);
        if (!Number.isFinite(state.now)) rbac.fail("Data inválida.", 400);
        await service.persist(row, state);
      }
      await service.run(row.id, {
        text: String(req.body.text || "").slice(0, 10000),
        timeout: req.body.timeout === true,
      });
      res.json(await runView(req, row.id));
    }),
  );
  app.post(
    "/api/flows/:id/script-test",
    route(async (req, res) => {
      const row = await flow(req);
      const result = await script(
        req.body.code,
        req.body.variables || {},
        Date.now(),
        row.definition.settings.timezone,
      );
      res.json({ result });
    }),
  );
  app.post(
    "/api/flows/:id/event",
    route(async (req, res) => {
      const target = await flow(req);
      if (!rbac.can(req.access, "fluxos.editar")) rbac.fail();
      if (!["api", "system", "integration", "tagAdded"].includes(req.body.type))
        rbac.fail("Tipo de evento inválido.", 400);
      const chip = await db.get(
        "SELECT * FROM chips WHERE id = ? AND user_id = ?",
        [req.body.chipId, req.access.accountId],
      );
      if (!chip || !rbac.departmentAllowed(req.access, chip.department_id))
        rbac.fail();
      if (!req.access.owner)
        rbac.fail(
          "Eventos de API exigem credencial de proprietário nesta sessão.",
        );
      const eventId = String(req.body.eventId || "");
      if (!eventId || eventId.length > 200)
        rbac.fail("Informe eventId para processamento idempotente.", 400);
      const id = await service.enqueue(req.access.accountId, chip.id, {
        ...req.body,
        id: `api:${eventId}`,
        number: String(req.body.number || ""),
        flowId: target.id,
      });
      service.start();
      res.status(202).json({ ok: true, eventId: id });
    }),
  );
  app.post(
    "/api/flows-assets",
    (req, res, next) =>
      upload.single("file")(req, res, (error) =>
        error
          ? res
              .status(400)
              .json({ error: "Arquivo inválido ou superior a 16 MB." })
          : next(),
      ),
    route(async (req, res) => {
      if (!rbac.can(req.access, "fluxos.editar")) rbac.fail();
      const file = req.file,
        kind = req.body.kind;
      if (
        !file ||
        !types[kind]?.includes(file.mimetype) ||
        !fileMatches(file.buffer, file.mimetype) ||
        (kind === "image" && file.size > 5 * 1024 * 1024)
      )
        rbac.fail(
          "Formato incompatível ou arquivo excede o limite (imagem: 5 MB; demais: 16 MB).",
          400,
        );
      const id = crypto.randomUUID(),
        directory = path.join(
          db.STORAGE_DIR,
          "flow-assets",
          String(req.access.accountId),
        );
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, id), file.buffer, { flag: "wx" });
      const name = path
        .basename(file.originalname)
        .replace(/[\r\n"<>]/g, "")
        .slice(0, 150);
      await db.run(
        "INSERT INTO flow_assets(id,account_id,created_by,kind,mime_type,file_name,size,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          id,
          req.access.accountId,
          req.access.user.id,
          kind,
          file.mimetype,
          name,
          file.size,
          new Date().toISOString(),
        ],
      );
      res.status(201).json({
        asset: {
          id,
          kind,
          fileName: name,
          mimeType: file.mimetype,
          size: file.size,
          url: `/api/flows-assets/${id}`,
        },
      });
    }),
  );
  app.get(
    "/api/flows-assets/:assetId",
    route(async (req, res) => {
      const asset = await db.get(
        "SELECT * FROM flow_assets WHERE id = ? AND account_id = ?",
        [req.params.assetId, req.access.accountId],
      );
      if (!asset) rbac.fail("Arquivo não encontrado.", 404);
      let permitted =
        req.access.owner ||
        (rbac.can(req.access, "fluxos.visualizar") &&
          asset.created_by === req.access.user.id);
      if (!permitted && rbac.can(req.access, "atendimento.visualizar")) {
        const deliveries = await db.all(
          "SELECT * FROM flow_asset_deliveries WHERE asset_id = ? AND account_id = ?",
          [asset.id, req.access.accountId],
        );
        for (const delivery of deliveries) {
          const chip = await db.get(
            "SELECT * FROM chips WHERE id = ? AND user_id = ?",
            [delivery.chip_id, req.access.accountId],
          );
          if (!chip) continue;
          const conversation = await req.botRequest(chip, "get-conversation", {
            number: delivery.contact,
            metadataOnly: true,
          });
          if (rbac.conversationAllowed(req.access, conversation, chip)) {
            permitted = true;
            break;
          }
        }
      }
      if (!permitted) rbac.fail("Arquivo não encontrado.", 404);
      res.setHeader("Content-Type", asset.mime_type);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `${asset.kind === "document" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.file_name)}`,
      );
      res.sendFile(asset.id, {
        root: path.join(
          db.STORAGE_DIR,
          "flow-assets",
          String(req.access.accountId),
        ),
      });
    }),
  );
}
async function validateReferencesForDraft(def, access) {
  flows.assertDefinition(def);
  for (const id of def.settings.chipIds || []) {
    const chip = await db.get(
      "SELECT * FROM chips WHERE id = ? AND user_id = ?",
      [id, access.accountId],
    );
    if (!chip || !rbac.departmentAllowed(access, chip.department_id))
      rbac.fail("Chip fora do escopo autorizado.");
  }
  // Drafts may be incomplete; configured references must still belong to the account.
  for (const n of def.nodes) {
    const c = n.data.config;
    if (n.data.kind === "http") {
      if (
        Object.keys(c.headers || {}).some((k) =>
          /authorization|cookie|token|secret|api.key/i.test(k),
        )
      )
        rbac.fail("Guarde credenciais no servidor e use secretName.", 400);
      if (
        c.secretName &&
        !c.secretName.startsWith(`FLOW_SECRET_${access.accountId}_`)
      )
        rbac.fail("Credencial fora do escopo da conta.", 400);
      if (/^https?:\/\/[^/]*@/i.test(c.url || ""))
        rbac.fail("Não inclua credenciais na URL.", 400);
    }
    if (c.columnId)
      await require("./adapter").allowedResource(
        access,
        "kanban_columns",
        c.columnId,
      );
    if (c.departmentId)
      await require("./adapter").allowedResource(
        access,
        "departments",
        c.departmentId,
      );
    if (
      n.data.kind === "redirect" &&
      c.targetId &&
      ["flow", "department"].includes(c.target)
    )
      await require("./adapter").allowedResource(
        access,
        c.target === "flow" ? "flows" : "departments",
        c.targetId,
      );
    if (c.variable && !safeKey(c.variable))
      rbac.fail("Nome de variável inválido.", 400);
  }
}
module.exports = { register, fileMatches };
