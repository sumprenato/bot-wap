const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
test("flow API, simulator and persistent WhatsApp execution", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "convelya-flow-test-"));
  process.env.STORAGE_DIR = folder;
  process.env.ADMIN_USERNAME = "flows-owner";
  process.env.ADMIN_PASSWORD = "test-password";
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  if (process.env.FLOW_TEST_DATABASE_URL)
    process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL;
  const { server, io, bot, db, flowService } = require("../server");
  await db.ready;
  t.after(async () => {
    await flowService.stop();
    await new Promise((resolve) => io.close(resolve));
    await db.close();
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const { withAccount } = require("../account-context"),
    schema = require("../flows/schema");
  const calls = [],
    contacts = new Map();
  bot.ensureWorker = () => ({ child: { connected: true } });
  bot.request = async (chip, action, payload = {}) => {
    if (action === "state") return { conversations: {}, status: {} };
    const key = `${chip.id}:${payload.number}`,
      ctx = contacts.get(key) || {
        name: "Cliente",
        tags: [],
        variables: {},
        blocked: false,
        connected: true,
        conversation: { number: payload.number, departmentId: null },
      };
    if (action === "flow-context") return ctx;
    if (action === "get-conversation") return ctx.conversation;
    if (action === "assume") return { activeTarget: payload.number };
    if (action === "flow-send" || action === "flow-send-media")
      calls.push({ chipId: chip.id, action, ...payload });
    if (action === "set-conversation-department")
      ctx.conversation.departmentId = payload.departmentId;
    if (action === "assign-conversation")
      ctx.conversation.assignedUserId = payload.userId;
    if (action === "set-contact-tags" || action === "set-conversation-tags")
      ctx.tags = payload.tags;
    if (action === "finalize-conversation") ctx.conversation.isFinalized = true;
    if (action === "flow-stop-conversation")
      ctx.conversation.flowStopped = true;
    contacts.set(key, ctx);
    return { ok: true, conversation: ctx.conversation };
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    cookies = {};
  async function req(url, method = "GET", body, who = "owner") {
    const response = await fetch(base + url, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: cookies[who] || "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie"))
      cookies[who] = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  }
  async function ok(url, method, body, who) {
    const r = await req(url, method, body, who);
    assert.ok(r.status < 300, `${r.status} ${url}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  await ok("/api/login", "POST", {
    username: "flows-owner",
    password: "test-password",
  });
  const stamp = new Date().toISOString();
  const chip = (
    await db.run(
      "INSERT INTO chips(name,number,user_id,created_at) VALUES (?,?,1,?)",
      ["Test chip", "5511999999999", stamp],
    )
  ).lastID;
  function graph(nodes) {
    const d = schema.empty();
    d.nodes.push(
      ...nodes.map(([id, kind, c]) => ({
        id,
        type: "flowBlock",
        position: { x: 400, y: 100 },
        data: { kind, label: kind, config: { ...schema.defaults(kind), ...c } },
      })),
    );
    return d;
  }
  const link = (d, s, p, target) =>
    d.edges.push({
      id: `${s}-${p}-${target}`,
      source: s,
      target,
      sourceHandle: p,
    });
  const def = graph([
    [
      "q",
      "question",
      { text: "Qual seu nome?", variable: "nome", attempts: 2 },
    ],
    ["g", "text", { text: "Olá, {{fluxo.nome}}!" }],
    ["end", "stop", {}],
  ]);
  link(def, "start", "next", "q");
  link(def, "q", "next", "g");
  link(def, "q", "timeout", "end");
  link(def, "g", "next", "end");
  def.triggers = [
    {
      id: "hello",
      type: "keyword",
      value: "olá",
      match: "exact",
      enabled: true,
      priority: 10,
    },
  ];
  let flow = (
    await ok("/api/flows", "POST", { name: "Atendimento", definition: def })
  ).flow;
  await t.test(
    "CRUD, conflict checks, duplication IDs, import/export and permissions",
    async () => {
      const copy = (await ok(`/api/flows/${flow.id}/duplicate`, "POST")).flow;
      assert.notEqual(copy.definition.nodes[0].id, def.nodes[0].id);
      assert.equal(copy.definition.edges.length, def.edges.length);
      assert.equal(copy.active, 0);
      const exported = await ok(`/api/flows/${flow.id}/export`),
        imported = (await ok("/api/flows", "POST", { import: exported })).flow;
      assert.equal(imported.definition.nodes.length, def.nodes.length);
      assert.notEqual(imported.definition.nodes[1].id, def.nodes[1].id);
      assert.equal(imported.published_version, null);
      assert.equal(
        (
          await req(`/api/flows/${flow.id}`, "PUT", {
            revision: 999,
            name: "stale",
          })
        ).status,
        409,
      );
      assert.equal((await req(`/api/flows/${copy.id}`, "DELETE")).status, 400);
      await ok(`/api/flows/${copy.id}`, "DELETE", { confirm: true });
      const other = await db.run(
        "INSERT INTO flows(name,created_at,updated_at,account_id,created_by) VALUES ('foreign',?,?,999,999)",
        [stamp, stamp],
      );
      assert.equal((await req(`/api/flows/${other.lastID}`)).status, 404);
      const malformed = structuredClone(def);
      const legacyNodes = [
        { id: "start", type: "start", position: { x: 0, y: 0 } },
        {
          id: "old-text",
          type: "message",
          text: "Configuração antiga",
          position: { x: 330, y: 0 },
        },
      ];
      const legacy = await db.run(
        "INSERT INTO flows(name,nodes,edges,trigger_keywords,created_at,updated_at,account_id,created_by) VALUES (?,?,?,?,?,?,1,1)",
        [
          "Legado preservado",
          JSON.stringify(legacyNodes),
          JSON.stringify([{ source: "start", target: "old-text" }]),
          JSON.stringify(["oi"]),
          stamp,
          stamp,
        ],
      );
      const reopened = (await ok(`/api/flows/${legacy.lastID}`)).flow;
      assert.equal(
        reopened.definition.nodes[1].data.config.text,
        "Configuração antiga",
      );
      assert.equal(reopened.definition.triggers[0].value, "oi");
      assert.deepEqual(
        JSON.parse(
          (await db.get("SELECT nodes FROM flows WHERE id=?", [legacy.lastID]))
            .nodes,
        ),
        legacyNodes,
      );
      malformed.nodes[1].data.config.options = "bad";
      assert.equal(
        (
          await req("/api/flows", "POST", {
            name: "bad",
            definition: malformed,
          })
        ).status,
        400,
      );
      const member = (
        await ok("/api/team", "POST", {
          name: "Read only",
          email: "flows-reader@test.invalid",
          password: "test-password",
          role: "Atendente",
        })
      ).member;
      await ok(`/api/team/${member.id}/permissions`, "PUT", {
        permissions: ["fluxos.visualizar"],
        scope: "account",
      });
      await ok(
        "/api/login",
        "POST",
        { username: member.username, password: "test-password" },
        "reader",
      );
      assert.equal(
        (await req(`/api/flows/${flow.id}/simulate`, "POST", {}, "reader"))
          .status,
        403,
      );
      assert.equal(
        (
          await req(
            `/api/flows/${flow.id}/publish`,
            "POST",
            { revision: flow.revision },
            "reader",
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    "simulator uses real interpreter and produces no WhatsApp sends",
    async () => {
      const before = calls.length;
      let sim = await ok(`/api/flows/${flow.id}/simulate`, "POST", {});
      assert.equal(sim.run.state.status, "waiting");
      sim = await ok(`/api/flows/${flow.id}/runs/${sim.run.id}/input`, "POST", {
        text: "Renato",
      });
      assert.equal(sim.run.state.status, "stopped");
      assert.equal(sim.run.state.messages.at(-1).text, "Olá, Renato!");
      assert.equal(calls.length, before);
      assert.ok(sim.logs.some((log) => log.port === "next"));
      const script = await ok(`/api/flows/${flow.id}/script-test`, "POST", {
        code: "return typeof process;",
        variables: {},
      });
      assert.equal(script.result, "undefined");
    },
  );
  flow = (
    await ok(`/api/flows/${flow.id}/publish`, "POST", {
      revision: flow.revision,
    })
  ).flow;
  await flowService.stop();
  await t.test(
    "WhatsApp starts and resumes persisted versions, deduplicates events, isolates contacts",
    async () => {
      const event = {
        id: "wa-1",
        type: "message",
        number: "5511000000001",
        text: "Olá",
      };
      await Promise.all([
        flowService.enqueue(1, chip, event),
        flowService.enqueue(1, chip, event),
      ]);
      await flowService.tick();
      const first = await db.get(
        "SELECT * FROM flow_runs WHERE mode='live' AND contact=?",
        [event.number],
      );
      assert.equal(first.status, "waiting");
      assert.equal(calls.filter((c) => c.number === event.number).length, 1);
      // Changing a draft must leave the pinned active version intact.
      const next = structuredClone(def);
      next.nodes.find((n) => n.id === "g").data.config.text = "NOVA VERSÃO";
      flow = (
        await ok(`/api/flows/${flow.id}`, "PUT", {
          revision: flow.revision,
          definition: next,
        })
      ).flow;
      assert.equal(flow.automation.status, "ready");
      assert.equal(flow.automation.unpublishedChanges, true);
      assert.notEqual(
        flow.definition.nodes.find((n) => n.id === "g").data.config.text,
        flow.published_definition.nodes.find((n) => n.id === "g").data.config
          .text,
      );
      const { FlowService } = require("../flows/service"),
        restarted = new FlowService({
          requestChip: (...args) => bot.request(...args),
        });
      await restarted.enqueue(1, chip, {
        id: "wa-2",
        type: "message",
        number: event.number,
        text: "Renato",
      });
      await restarted.tick();
      const done = await db.get("SELECT * FROM flow_runs WHERE id=?", [
        first.id,
      ]);
      assert.equal(done.status, "stopped");
      assert.equal(calls.at(-1).text, "Olá, Renato!");
      await restarted.enqueue(1, chip, {
        id: "wa-2",
        type: "message",
        number: event.number,
        text: "Renato",
      });
      await restarted.tick();
      assert.equal(calls.filter((c) => c.number === event.number).length, 2);
      for (const [i, n] of [
        ["a", "5511000000002"],
        ["b", "5511000000003"],
      ])
        await restarted.enqueue(1, chip, {
          id: `start-${i}`,
          type: "message",
          number: n,
          text: "olá",
        });
      await restarted.tick();
      for (const [i, n] of [
        ["Ana", "5511000000002"],
        ["Bia", "5511000000003"],
      ])
        await restarted.enqueue(1, chip, {
          id: `reply-${i}`,
          type: "message",
          number: n,
          text: i,
        });
      await restarted.tick();
      assert.equal(
        calls.find(
          (c) => c.number === "5511000000002" && c.text === "Olá, Ana!",
        )?.text,
        "Olá, Ana!",
      );
      assert.ok(
        calls.some(
          (c) => c.number === "5511000000003" && c.text === "Olá, Bia!",
        ),
      );
      assert.ok((await ok(`/api/flows/${flow.id}/history`)).runs.length >= 3);
      assert.equal(
        (await ok(`/api/flows/${flow.id}/revisions`)).revisions.length,
        2,
      );
    },
  );
  await t.test(
    "persistent timer resumes after service recreation; uncertain sends suspend instead of repeating",
    async () => {
      const d = graph([
        ["delay", "delay", { duration: 1, unit: "seconds" }],
        ["message", "text", { text: "Depois do timer" }],
        ["end", "stop", {}],
      ]);
      link(d, "start", "next", "delay");
      link(d, "delay", "next", "message");
      link(d, "message", "next", "end");
      const created = await withAccount(1, () =>
        require("../flows/store").create({ name: "Timer", definition: d }),
      );
      await ok(`/api/flows/${created.id}/publish`, "POST", {
        revision: created.revision,
      });
      const id = await flowService.createRun({
        accountId: 1,
        flowId: created.id,
        version: 1,
        definition: d,
        chipId: chip,
        contact: "5511000000004",
        actorId: 1,
        context: {},
      });
      let row = await db.get("SELECT * FROM flow_runs WHERE id=?", [id]);
      assert.equal(row.status, "sleeping");
      const state = JSON.parse(row.state);
      state.wakeAt = Date.now() - 1000;
      await flowService.persist(row, state);
      const { FlowService } = require("../flows/service"),
        restarted = new FlowService({
          requestChip: (...args) => bot.request(...args),
        });
      await restarted.tick();
      assert.equal(
        (await db.get("SELECT * FROM flow_runs WHERE id=?", [id])).status,
        "stopped",
      );
      assert.ok(calls.some((c) => c.text === "Depois do timer"));
      const broken = new FlowService({
        requestChip: async (chip, action, payload) => {
          if (action === "flow-send") throw new Error("IPC lost after send");
          return bot.request(chip, action, payload);
        },
      });
      const direct = graph([
        ["message", "text", { text: "Uma vez" }],
        ["end", "stop", {}],
      ]);
      link(direct, "start", "next", "message");
      link(direct, "message", "next", "end");
      const offlineContact = "5511000000006";
      contacts.set(`${chip}:${offlineContact}`, {
        connected: false,
        tags: [],
        variables: {},
        conversation: { number: offlineContact },
      });
      const queued = await flowService.createRun({
        accountId: 1,
        flowId: created.id,
        version: 1,
        definition: direct,
        chipId: chip,
        contact: offlineContact,
        actorId: 1,
        context: {},
      });
      let queuedRun = await db.get("SELECT * FROM flow_runs WHERE id=?", [
        queued,
      ]);
      assert.equal(queuedRun.status, "ready");
      assert.equal(calls.filter((c) => c.number === offlineContact).length, 0);
      contacts.get(`${chip}:${offlineContact}`).connected = true;
      const queuedState = JSON.parse(queuedRun.state);
      queuedState.retryAt = Date.now() - 1;
      await flowService.persist(queuedRun, queuedState);
      await flowService.tick();
      queuedRun = await db.get("SELECT * FROM flow_runs WHERE id=?", [queued]);
      assert.equal(queuedRun.status, "stopped");
      assert.equal(calls.filter((c) => c.number === offlineContact).length, 1);
      const uncertain = await broken.createRun({
        accountId: 1,
        flowId: created.id,
        version: 1,
        definition: direct,
        chipId: chip,
        contact: "5511000000005",
        actorId: 1,
        context: {},
      });
      assert.equal(
        (await db.get("SELECT * FROM flow_runs WHERE id=?", [uncertain]))
          .status,
        "attention",
      );
      await broken.tick();
      assert.equal(
        Number(
          (
            await db.get(
              "SELECT COUNT(*) AS n FROM flow_effects WHERE run_id=?",
              [uncertain],
            )
          ).n,
        ),
        1,
      );
    },
  );
  await t.test(
    "live actions integrate departments, distribution, tags, opportunities, media and finish",
    async () => {
      const department = (
        await ok("/api/departments", "POST", { name: "Comercial de teste" })
      ).department;
      const member = (
        await ok("/api/team", "POST", {
          name: "Comercial",
          email: "flow-agent@test.invalid",
          password: "test-password",
          role: "Atendente",
        })
      ).member;
      await ok(`/api/team/${member.id}/permissions`, "PUT", {
        permissions: ["atendimento.visualizar", "atendimento.responder"],
        departments: [department.id],
        scope: "department",
      });
      const stage = (
        await ok("/api/kanban/columns", "POST", { name: "Automação" })
      ).column;
      const contact = "5511000000010";
      const opportunity = (
        await ok("/api/kanban/opportunities", "POST", {
          title: "Venda de teste",
          contact_number: contact,
          column_id: stage.id,
        })
      ).opportunity;
      const targetStage = (
        await ok("/api/kanban/columns", "POST", { name: "Qualificada" })
      ).column;
      const binary = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
      const form = new FormData();
      form.append("kind", "document");
      form.append(
        "file",
        new Blob([binary], { type: "application/pdf" }),
        "catalogo.pdf",
      );
      const uploaded = await fetch(base + "/api/flows-assets", {
        method: "POST",
        headers: { cookie: cookies.owner },
        body: form,
      });
      assert.equal(uploaded.status, 201);
      const asset = (await uploaded.json()).asset;
      const fetched = await fetch(base + asset.url, {
        headers: { cookie: cookies.owner },
      });
      assert.equal(fetched.status, 200);
      assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), binary);
      const badForm = new FormData();
      badForm.append("kind", "image");
      badForm.append(
        "file",
        new Blob(["<script>no</script>"], { type: "image/png" }),
        "bad.png",
      );
      assert.equal(
        (
          await fetch(base + "/api/flows-assets", {
            method: "POST",
            headers: { cookie: cookies.owner },
            body: badForm,
          })
        ).status,
        400,
      );
      const d = graph([
        [
          "transfer",
          "redirect",
          { target: "department", targetId: String(department.id) },
        ],
        [
          "assign",
          "distribute",
          {
            departmentId: String(department.id),
            users: [String(member.id)],
            capacity: 5,
            strategy: "leastBusy",
          },
        ],
        ["tag", "tags", { add: ["Qualificado"], remove: [], create: true }],
        ["move", "moveOpportunity", { columnId: String(targetStage.id) }],
        [
          "media",
          "document",
          {
            assetId: asset.id,
            caption: "Seu catálogo",
            fileName: "produtos.pdf",
          },
        ],
        ["finish", "finish", { reason: "Qualificação concluída" }],
      ]);
      link(d, "start", "next", "transfer");
      link(d, "transfer", "next", "tag");
      link(d, "tag", "next", "move");
      link(d, "move", "next", "media");
      link(d, "media", "next", "assign");
      link(d, "assign", "next", "finish");
      const created = (
        await ok("/api/flows", "POST", {
          name: "Ações integradas",
          definition: d,
        })
      ).flow;
      await ok(`/api/flows/${created.id}/publish`, "POST", {
        revision: created.revision,
      });
      await flowService.stop();
      const id = await flowService.createRun({
        accountId: 1,
        flowId: created.id,
        version: created.revision,
        definition: d,
        chipId: chip,
        contact,
        actorId: 1,
        context: {},
      });
      const row = await db.get("SELECT * FROM flow_runs WHERE id=?", [id]);
      assert.equal(row.status, "stopped", row.state);
      const current = contacts.get(`${chip}:${contact}`);
      assert.equal(current.conversation.departmentId, String(department.id));
      assert.equal(current.conversation.assignedUserId, member.id);
      assert.ok(current.tags.includes("Qualificado"));
      assert.ok(
        !current.conversation.isFinalized,
        "human handoff prevents subsequent automatic actions",
      );
      assert.equal(
        (
          await db.get("SELECT * FROM opportunities WHERE id=?", [
            opportunity.id,
          ])
        ).column_id,
        targetStage.id,
      );
      assert.ok(
        (
          await db.all("SELECT * FROM funnel_history WHERE opportunity_id=?", [
            opportunity.id,
          ])
        ).some((entry) => entry.description.includes("movida")),
      );
      const sent = calls.find(
        (c) => c.action === "flow-send-media" && c.number === contact,
      );
      assert.equal(sent.media.fileName, "produtos.pdf");
      assert.deepEqual(Buffer.from(sent.media.buffer, "base64"), binary);
      // Replaying an inbox receipt after a crash must not create a second run.
      const prior = calls.length;
      const receipt = await db.get(
        "SELECT * FROM flow_inbox WHERE status='done' AND run_id IS NOT NULL LIMIT 1",
      );
      await db.run("UPDATE flow_inbox SET status='pending' WHERE id=?", [
        receipt.id,
      ]);
      await flowService.tick();
      assert.equal(calls.length, prior);
    },
  );
  await t.test(
    "reference scenario routes all periods, menus and catalog branches in simulator",
    async () => {
      const model = (
        await ok("/api/flows", "POST", {
          name: "Referência",
          template: "reference",
        })
      ).flow;
      for (const [now, greeting] of [
        ["2026-10-16T11:00:00Z", "Bom dia"],
        ["2026-10-16T18:00:00Z", "Boa tarde"],
        ["2026-10-17T01:00:00Z", "Boa noite"],
      ]) {
        let sim = await ok(`/api/flows/${model.id}/simulate`, "POST", {
          simulation: { now },
        });
        assert.equal(sim.run.state.status, "waiting");
        assert.ok(sim.run.state.messages[0].text.startsWith(greeting));
        sim = await ok(
          `/api/flows/${model.id}/runs/${sim.run.id}/input`,
          "POST",
          { text: "4" },
        );
        assert.equal(sim.run.state.current, "catalog");
        sim = await ok(
          `/api/flows/${model.id}/runs/${sim.run.id}/input`,
          "POST",
          { text: "2" },
        );
        assert.equal(sim.run.state.status, "stopped");
        assert.ok(
          sim.run.state.messages.at(-1).text.includes("Catálogo de serviços"),
        );
      }
      let sim = await ok(`/api/flows/${model.id}/simulate`, "POST", {});
      sim = await ok(
        `/api/flows/${model.id}/runs/${sim.run.id}/input`,
        "POST",
        { text: "2" },
      );
      assert.ok(
        sim.run.state.trace.some(
          (t) => t.detail === "Simulação isolada: redirect",
        ),
      );
      assert.equal(sim.run.state.status, "stopped");
      assert.equal(
        (
          await req(`/api/flows/${model.id}/publish`, "POST", {
            revision: model.revision,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "finalization still completes an unassigned conversation",
    async () => {
      const definition = graph([["finish", "finish", {}]]);
      link(definition, "start", "next", "finish");
      const flow = (
        await ok("/api/flows", "POST", { name: "Finish audit", definition })
      ).flow;
      await ok(`/api/flows/${flow.id}/publish`, "POST", {
        revision: flow.revision,
      });
      await flowService.stop();
      const number = "5511998877888";
      const id = await flowService.createRun({
        accountId: 1,
        flowId: flow.id,
        version: flow.revision,
        definition,
        chipId: chip,
        contact: number,
        actorId: 1,
        context: {},
      });
      assert.equal(
        (await db.get("SELECT status FROM flow_runs WHERE id=?", [id])).status,
        "completed",
      );
      assert.equal(
        contacts.get(`${chip}:${number}`).conversation.isFinalized,
        true,
      );
    },
  );
  await t.test(
    "the pause endpoint cancels a waiting execution before another input arrives",
    async () => {
      const definition = graph([
        ["question", "question", { text: "Nome?" }],
        ["end", "stop", {}],
      ]);
      link(definition, "start", "next", "question");
      link(definition, "question", "next", "end");
      link(definition, "question", "timeout", "end");
      const flow = (
        await ok("/api/flows", "POST", { name: "Pause API audit", definition })
      ).flow;
      await ok(`/api/flows/${flow.id}/publish`, "POST", {
        revision: flow.revision,
      });
      await flowService.stop();
      const id = await flowService.createRun({
        accountId: 1,
        flowId: flow.id,
        version: flow.revision,
        definition,
        chipId: chip,
        contact: "5511998877889",
        actorId: 1,
        context: {},
      });
      assert.equal(
        (await db.get("SELECT status FROM flow_runs WHERE id=?", [id])).status,
        "waiting",
      );
      await ok(`/api/flows/${flow.id}`, "PUT", {
        revision: flow.revision,
        active: false,
      });
      assert.equal(
        (await db.get("SELECT status FROM flow_runs WHERE id=?", [id])).status,
        "stopped",
      );
    },
  );
  await t.test(
    "assigning, assuming or disabling a flow cancels the waiting execution immediately",
    async () => {
      for (const [index, action] of ["assign", "assume", "disable"].entries()) {
        const definition = graph([
          ["question", "question", { text: "Nome?" }],
          ["end", "stop", {}],
        ]);
        link(definition, "start", "next", "question");
        link(definition, "question", "next", "end");
        link(definition, "question", "timeout", "end");
        const flow = (
          await ok("/api/flows", "POST", {
            name: "Handoff API " + action,
            definition,
          })
        ).flow;
        await ok(`/api/flows/${flow.id}/publish`, "POST", {
          revision: flow.revision,
        });
        await flowService.stop();
        const number = "551199887789" + index;
        const id = await flowService.createRun({
          accountId: 1,
          flowId: flow.id,
          version: flow.revision,
          definition,
          chipId: chip,
          contact: number,
          actorId: 1,
          context: {},
        });
        assert.equal(
          (await db.get("SELECT status FROM flow_runs WHERE id=?", [id]))
            .status,
          "waiting",
        );
        if (action === "assign")
          await ok(`/api/conversation/${number}/assign`, "POST", { userId: 1 });
        if (action === "assume")
          await ok("/api/assumir", "POST", { number, chipId: chip });
        if (action === "disable")
          await ok(`/api/flows/${flow.id}`, "PUT", {
            revision: flow.revision,
            triggers_enabled: false,
          });
        assert.equal(
          (await db.get("SELECT status FROM flow_runs WHERE id=?", [id]))
            .status,
          "stopped",
          action,
        );
      }
    },
  );
  await t.test(
    "retired routing is removed from API versions and exceptions never dispatch a handler",
    async () => {
      const legacy = graph([
        [
          "script",
          "script",
          { code: 'throw new Error("fixture failure");', outputs: ["ok"] },
        ],
        ["end", "stop", {}],
      ]);
      legacy.nodes.push({
        id: "handler",
        position: { x: 500, y: 500 },
        data: { kind: "error", config: { text: "Mensagem que não deve sair" } },
      });
      link(legacy, "start", "next", "script");
      link(legacy, "script", "ok", "end");
      link(legacy, "script", "error", "handler");
      link(legacy, "handler", "next", "end");
      const created = (
        await ok("/api/flows", "POST", {
          name: "Sem rotas alternativas",
          definition: legacy,
        })
      ).flow;
      assert.ok(!created.definition.nodes.some((n) => n.data.kind === "error"));
      assert.ok(
        !created.definition.edges.some((e) => e.sourceHandle === "error"),
      );
      await db.run(
        "INSERT INTO flow_versions(account_id,flow_id,version,definition,created_by,created_at) VALUES (1,?,99,?,1,?)",
        [created.id, JSON.stringify(legacy), stamp],
      );
      const restored = await ok(`/api/flows/${created.id}/versions/99`);
      assert.ok(
        !restored.definition.nodes.some((n) => n.data.kind === "error"),
      );
      const simulated = await ok(
        `/api/flows/${created.id}/simulate`,
        "POST",
        {},
      );
      assert.equal(simulated.run.state.status, "failed");
      assert.equal(simulated.run.state.messages.length, 0);
      assert.equal("ultimoErro" in simulated.run.state.vars.fluxo, false);
      assert.ok(!simulated.logs.some((log) => log.port === "error"));
    },
  );
  await t.test(
    "stopping a reconnection wait clears its retry and refuses an operation already running",
    async () => {
      const definition = graph([
        ["send", "text", { text: "Não enviar após cancelar" }],
        ["end", "stop", {}],
      ]);
      link(definition, "start", "next", "send");
      link(definition, "send", "next", "end");
      const created = (
        await ok("/api/flows", "POST", { name: "Cancel audit", definition })
      ).flow;
      await ok(`/api/flows/${created.id}/publish`, "POST", {
        revision: created.revision,
      });
      const number = "5511998877999";
      contacts.set(`${chip}:${number}`, {
        connected: false,
        tags: [],
        conversation: { number },
      });
      const id = await flowService.createRun({
        accountId: 1,
        flowId: created.id,
        version: 1,
        definition,
        chipId: chip,
        contact: number,
        actorId: 1,
        context: {},
      });
      const pending = await db.get("SELECT * FROM flow_runs WHERE id=?", [id]);
      assert.equal(pending.status, "ready");
      assert.ok(JSON.parse(pending.state).retryAt);
      await ok(`/api/flows/${created.id}/runs/${id}/stop`, "POST", {});
      const stopped = await db.get("SELECT * FROM flow_runs WHERE id=?", [id]);
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.wake_at, null);
      assert.equal(JSON.parse(stopped.state).retryAt, undefined);
      contacts.get(`${chip}:${number}`).connected = true;
      await flowService.tick();
      assert.equal(calls.filter((c) => c.number === number).length, 0);
      await db.run("UPDATE flow_runs SET status='running' WHERE id=?", [id]);
      assert.equal(
        (await req(`/api/flows/${created.id}/runs/${id}/stop`, "POST", {}))
          .status,
        409,
      );
      assert.equal(
        (await db.get("SELECT status FROM flow_runs WHERE id=?", [id])).status,
        "running",
      );
      await db.run("UPDATE flow_runs SET status='stopped' WHERE id=?", [id]);
    },
  );
  await t.test(
    "typed global variables keep their values and reject incompatible types",
    async () => {
      const expected = {
        text: "false",
        number: 0,
        boolean: false,
        date: "2026-10-16",
        json: { nested: [1, false, null] },
      };
      for (const [type, value] of Object.entries(expected)) {
        await ok("/api/global-variables", "POST", {
          key: `audit_${type}`,
          value: JSON.stringify(value),
          valueType: type,
        });
      }
      for (const [valueType, value] of [
        ["number", '"abc"'],
        ["boolean", '"false"'],
        ["date", '"2026-02-30"'],
        ["json", "{invalid"],
        ["number", "null"],
      ]) {
        assert.equal(
          (
            await req("/api/global-variables", "POST", {
              key: "invalid_audit",
              value,
              valueType,
            })
          ).status,
          400,
        );
      }
      const result = await ok(`/api/flows/${flow.id}/simulate`, "POST", {});
      for (const [type, value] of Object.entries(expected))
        assert.deepEqual(result.run.state.vars.global[`audit_${type}`], value);
      await ok("/api/global-variables", "POST", {
        key: "audit_text",
        value: JSON.stringify("updated"),
        valueType: "text",
      });
      await ok("/api/global-variables/audit_text", "DELETE");
      const rows = (await ok("/api/global-variables")).variables;
      assert.ok(!rows.some((v) => v.key === "audit_text"));
    },
  );
  await t.test(
    "authenticated API, system, integration and tag events execute once",
    async () => {
      for (const type of ["api", "system", "integration", "tagAdded"]) {
        const definition = graph([
          ["message", "text", { text: `Evento ${type}` }],
          ["end", "stop", {}],
        ]);
        definition.triggers = [
          { id: "event", type, value: "audit-event", enabled: true },
        ];
        link(definition, "start", "next", "message");
        link(definition, "message", "next", "end");
        const created = (
          await ok("/api/flows", "POST", { name: `Event ${type}`, definition })
        ).flow;
        await ok(`/api/flows/${created.id}/publish`, "POST", {
          revision: created.revision,
        });
        const payload = {
          type,
          name: "audit-event",
          tags: ["audit-event"],
          chipId: chip,
          number: `55119988000${["api", "system", "integration", "tagAdded"].indexOf(type)}`,
          eventId: `audit-${type}`,
        };
        assert.equal(
          (
            await req(`/api/flows/${created.id}/event`, "POST", {
              ...payload,
              eventId: undefined,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req(`/api/flows/${created.id}/event`, "POST", {
              ...payload,
              chipId: 999999,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await req(
              `/api/flows/${created.id}/event`,
              "POST",
              payload,
              "reader",
            )
          ).status,
          403,
        );
        assert.equal(
          (await req(`/api/flows/${created.id}/event`, "POST", payload)).status,
          202,
        );
        await flowService.stop();
        await flowService.tick();
        assert.equal(
          calls.filter(
            (c) => c.number === payload.number && c.text === `Evento ${type}`,
          ).length,
          1,
        );
        await ok(`/api/flows/${created.id}/event`, "POST", payload);
        await flowService.stop();
        await flowService.tick();
        assert.equal(
          calls.filter(
            (c) => c.number === payload.number && c.text === `Evento ${type}`,
          ).length,
          1,
        );
      }
    },
  );
});
