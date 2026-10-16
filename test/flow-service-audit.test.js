const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");

test(
  "flow audit: published scopes, pending inputs, retries, routing and assignment",
  { timeout: 60000 },
  async (t) => {
    const folder = fs.mkdtempSync(
      path.join(os.tmpdir(), "convelya-flow-audit-"),
    );
    process.env.STORAGE_DIR = folder;
    process.env.ADMIN_USERNAME = "flow-audit-owner";
    process.env.ADMIN_PASSWORD = "test-password";
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_PRIVATE_URL;
    if (process.env.FLOW_TEST_DATABASE_URL)
      process.env.DATABASE_URL = process.env.FLOW_TEST_DATABASE_URL;
    const db = require("../db"),
      schema = require("../flows/schema"),
      flows = require("../flows/store");
    const { FlowService } = require("../flows/service");
    await db.ready;
    const contexts = new Map(),
      sent = [],
      assignments = [];
    let refuse = null,
      contactIndex = 0,
      eventIndex = 0,
      assignmentFixture;
    const phone = () => "55117777" + String(++contactIndex).padStart(5, "0");
    const context = (chip, number) => {
      const key = chip + ":" + number;
      if (!contexts.has(key))
        contexts.set(key, {
          connected: true,
          readyToSend: true,
          tags: [],
          conversation: { number, departmentId: null },
        });
      return contexts.get(key);
    };
    const service = new FlowService({
      requestChip: async (chip, action, payload = {}) => {
        const ctx = context(chip.id, payload.number);
        if (action === "flow-context") return ctx;
        if (action === "state")
          return {
            conversations: Object.fromEntries(
              [...contexts]
                .filter(([key]) => key.startsWith(chip.id + ":"))
                .map(([key, ctx]) => [key, ctx.conversation]),
            ),
          };
        if (action === "flow-send") {
          if (refuse?.(payload)) {
            refuse = null;
            throw Object.assign(
              new Error("Fixture: contatos ainda não verificados"),
              { code: "WHATSAPP_NOT_READY", deliveryAttempted: false },
            );
          }
          sent.push({ chip: chip.id, ...payload });
        }
        if (action === "set-conversation-department")
          ctx.conversation.departmentId = payload.departmentId;
        if (action === "assign-conversation") {
          ctx.conversation.assignedUserId = payload.userId;
          assignments.push(payload.userId);
        }
        if (action === "set-contact-tags" || action === "set-conversation-tags")
          ctx.tags = payload.tags;
        if (action === "finalize-conversation")
          ctx.conversation.isFinalized = true;
        if (action === "flow-stop-conversation")
          ctx.conversation.flowStopped = true;
        return { conversation: ctx.conversation };
      },
    });
    t.after(async () => {
      await service.stop();
      await db.close();
      assert.equal(path.dirname(folder), os.tmpdir());
      fs.rmSync(folder, { recursive: true, force: true });
    });
    const chipA = (
      await db.run(
        "INSERT INTO chips(name,number,user_id,created_at) VALUES (?,?,1,?)",
        ["A", "5511999900001", new Date().toISOString()],
      )
    ).lastID;
    const chipB = (
      await db.run(
        "INSERT INTO chips(name,number,user_id,created_at) VALUES (?,?,1,?)",
        ["B", "5511999900002", new Date().toISOString()],
      )
    ).lastID;
    function graph(kind, config = {}) {
      const def = schema.empty();
      def.nodes.push(
        {
          id: "action",
          position: { x: 400, y: 0 },
          data: { kind, config: { ...schema.defaults(kind), ...config } },
        },
        {
          id: "end",
          position: { x: 800, y: 0 },
          data: { kind: "stop", config: {} },
        },
      );
      def.edges = [
        {
          id: "start-action",
          source: "start",
          target: "action",
          sourceHandle: "next",
        },
        ...(["question", "wait", "menu", "buttons", "quickReply"].includes(kind)
          ? ["next", "timeout"]
          : ["next"]
        ).map((port) => ({
          id: "action-" + port,
          source: "action",
          target: "end",
          sourceHandle: port,
        })),
      ];
      return def;
    }
    const publish = async (def, name = "Audit") => {
      const flow = await flows.create({ name, definition: def });
      return flows.publish(flow.id, flow.revision);
    };
    const event = async (flow, chip, number, text = "oi", extra = {}) => {
      await service.enqueue(1, chip, {
        id: "audit-" + ++eventIndex,
        type: "message",
        number,
        text,
        flowId: flow.id,
        ...extra,
      });
      await service.tick();
    };
    const runFor = (number) =>
      db.get(
        "SELECT * FROM flow_runs WHERE contact=? AND mode='live' ORDER BY created_at DESC LIMIT 1",
        [number],
      );
    const due = async (row) => {
      const state = JSON.parse(row.state);
      state.retryAt = Date.now() - 1;
      await service.persist(row, state);
      await service.tick();
    };

    await t.test(
      "Interromper prevents fresh messages from restarting the same conversation",
      async () => {
        const flow = await publish(graph("text", { text: "Última mensagem" })),
          number = phone();
        await event(flow, chipA, number);
        await event(flow, chipA, number, "Mais uma mensagem");
        assert.deepEqual(
          sent.filter((v) => v.number === number).map((v) => v.text),
          ["Última mensagem"],
        );
        assert.equal((await runFor(number)).status, "stopped");
        context(chipA, number).conversation.flowStopped = false; // Explicitly reopen the conversation.
        await event(flow, chipA, number, "Novo atendimento");
        assert.equal(sent.filter((v) => v.number === number).length, 2);
      },
    );

    await t.test(
      "pausing or disabling a flow cancels waiting and sleeping executions",
      async () => {
        for (const setting of ["active", "triggers_enabled"])
          for (const kind of ["question", "delay"]) {
            const definition = graph(
              kind,
              kind === "question" ? { text: "Nome?" } : { duration: 1 },
            );
            definition.nodes.push({
              id: "reply",
              position: { x: 600, y: 0 },
              data: {
                kind: "text",
                config: { ...schema.defaults("text"), text: "Não enviar" },
              },
            });
            definition.edges.find(
              (e) => e.source === "action" && e.sourceHandle === "next",
            ).target = "reply";
            definition.edges.push({
              id: "reply-end",
              source: "reply",
              target: "end",
              sourceHandle: "next",
            });
            const flow = await publish(definition),
              number = phone();
            await event(flow, chipA, number);
            await flows.update(flow.id, {
              revision: flow.revision,
              [setting]: false,
            });
            if (kind === "question") await event(flow, chipA, number, "Ana");
            else await due(await runFor(number));
            const row = await runFor(number);
            assert.equal(row.status, "stopped", setting + " / " + kind);
            assert.equal(row.wake_at, null);
            assert.ok(
              !sent.some((v) => v.number === number && v.text === "Não enviar"),
            );
          }
      },
    );

    await t.test(
      "assigned conversations neither start nor resume automatic messages",
      async () => {
        const flow = await publish(graph("question", { text: "Nome?" })),
          assigned = phone(),
          waiting = phone();
        context(chipA, assigned).conversation.assignedUserId = 1;
        await event(flow, chipA, assigned);
        assert.equal(await runFor(assigned), undefined);
        await event(flow, chipA, waiting);
        context(chipA, waiting).conversation.assignedUserId = 1;
        await event(flow, chipA, waiting, "Ana");
        assert.equal((await runFor(waiting)).status, "stopped");
        assert.equal(
          JSON.parse((await runFor(waiting)).state).answers.length,
          0,
        );
      },
    );

    await t.test(
      "pausing between sequential messages blocks the next send",
      async () => {
        const flow = await publish(
            graph("text", { messages: ["Primeira", "Segunda"] }),
          ),
          number = phone();
        const original = service.requestChip;
        service.requestChip = async (...args) => {
          const result = await original(...args);
          if (
            args[1] === "flow-send" &&
            args[2].number === number &&
            args[2].text === "Primeira"
          )
            await flows.update(flow.id, {
              revision: flow.revision,
              active: false,
            });
          return result;
        };
        try {
          await event(flow, chipA, number);
        } finally {
          service.requestChip = original;
        }
        assert.deepEqual(
          sent.filter((v) => v.number === number).map((v) => v.text),
          ["Primeira"],
        );
        assert.equal((await runFor(number)).status, "stopped");
      },
    );

    await t.test(
      "assigning an attendant between sequential messages blocks the next send",
      async () => {
        const flow = await publish(
            graph("text", { messages: ["Primeira", "Segunda"] }),
          ),
          number = phone();
        const original = service.requestChip;
        service.requestChip = async (...args) => {
          const result = await original(...args);
          if (args[1] === "flow-send" && args[2].number === number)
            context(chipA, number).conversation.assignedUserId = 1;
          return result;
        };
        try {
          await event(flow, chipA, number);
        } finally {
          service.requestChip = original;
        }
        assert.deepEqual(
          sent.filter((v) => v.number === number).map((v) => v.text),
          ["Primeira"],
        );
        assert.equal((await runFor(number)).status, "stopped");
        assert.equal(
          await db.get(
            "SELECT id FROM flow_effects WHERE run_id = ? AND status = 'uncertain'",
            [(await runFor(number)).id],
          ),
          undefined,
        );
      },
    );

    await t.test(
      "a contact blocked while awaiting reconnection stops instead of retaining its retry",
      async () => {
        const flow = await publish(
            graph("text", { text: "Mensagem bloqueada" }),
          ),
          number = phone();
        context(chipA, number).connected = false;
        await event(flow, chipA, number);
        const pending = await runFor(number);
        assert.equal(pending.status, "ready");
        context(chipA, number).blocked = true;
        context(chipA, number).connected = true;
        await due(pending);
        const stopped = await runFor(number);
        assert.equal(stopped.status, "stopped");
        assert.equal(stopped.wake_at, null);
        assert.equal(JSON.parse(stopped.state).retryAt, undefined);
        assert.equal(sent.filter((v) => v.number === number).length, 0);
      },
    );

    await t.test(
      "only the published chip selection receives incoming messages",
      async () => {
        const def = graph("text", { text: "Apenas A" });
        def.settings.chipIds = [chipA];
        let flow = await publish(def);
        const excluded = phone();
        await event(flow, chipB, excluded);
        assert.equal(
          await runFor(excluded),
          undefined,
          "an excluded chip must never start the flow",
        );
        const draft = structuredClone(def);
        draft.settings.chipIds = [chipB];
        flow = await flows.update(flow.id, {
          revision: flow.revision,
          definition: draft,
          trigger_chips: [chipB],
        });
        const allowed = phone();
        await event(flow, chipA, allowed);
        assert.equal(
          (await runFor(allowed)).status,
          "stopped",
          "saving a draft cannot change the published chip selection",
        );
        const stillExcluded = phone();
        await event(flow, chipB, stillExcluded);
        assert.equal(await runFor(stillExcluded), undefined);
        flow = await flows.publish(flow.id, flow.revision);
        const newAllowed = phone();
        await event(flow, chipB, newAllowed);
        assert.equal((await runFor(newAllowed)).status, "stopped");
      },
    );

    await t.test(
      "a sequential text node resumes without duplicate deliveries or transcript entries",
      async () => {
        const def = graph("text", { messages: ["Primeira", "Segunda"] });
        const flow = await publish(def),
          number = phone();
        refuse = (payload) =>
          payload.number === number && payload.text === "Segunda";
        await event(flow, chipA, number);
        const queued = await runFor(number);
        assert.equal(queued.status, "ready");
        await due(queued);
        const finished = await runFor(number),
          state = JSON.parse(finished.state);
        assert.equal(finished.status, "stopped");
        assert.deepEqual(
          sent.filter((v) => v.number === number).map((v) => v.text),
          ["Primeira", "Segunda"],
        );
        assert.deepEqual(
          state.messages.map((v) => v.text),
          ["Primeira", "Segunda"],
        );
      },
    );

    await t.test(
      "refusing an invalid-answer prompt does not consume the next attempt or duplicate the answer",
      async () => {
        const def = graph("question", {
          text: "Número?",
          variable: "numero",
          answerType: "number",
          attempts: 2,
        });
        const flow = await publish(def),
          number = phone();
        await event(flow, chipA, number);
        refuse = (payload) =>
          payload.number === number &&
          payload.text.startsWith("Resposta inválida");
        await event(flow, chipA, number, "texto");
        await due(await runFor(number));
        const resumed = await runFor(number),
          state = JSON.parse(resumed.state);
        assert.equal(
          resumed.status,
          "waiting",
          "an unsent prompt must not exhaust the answer attempts",
        );
        assert.equal(state.attempts, 1);
        assert.equal(state.answers.length, 1);
        await event(flow, chipA, number, "42");
        assert.equal((await runFor(number)).status, "stopped");
        assert.equal(
          JSON.parse((await runFor(number)).state).vars.fluxo.numero,
          42,
        );
      },
    );

    await t.test(
      "blocked contacts do not start new executions or receive messages",
      async () => {
        const flow = await publish(graph("text", { text: "Bloqueado" })),
          number = phone();
        context(chipA, number).blocked = true;
        await event(flow, chipA, number);
        assert.equal(await runFor(number), undefined);
        assert.equal(
          sent.some((v) => v.number === number),
          false,
        );
      },
    );

    await t.test(
      "an explicit distribution department controls eligibility before assignment",
      async () => {
        const stamp = new Date().toISOString();
        const first = (
          await db.run(
            "INSERT INTO departments(name,created_at,account_id,created_by) VALUES (?,?,1,1)",
            ["Origem", stamp],
          )
        ).lastID;
        const second = (
          await db.run(
            "INSERT INTO departments(name,created_at,account_id,created_by) VALUES (?,?,1,1)",
            ["Destino", stamp],
          )
        ).lastID;
        const member = (
          await db.run(
            "INSERT INTO users(username,display_name,password,account_id,role,status,scope,departments) VALUES (?,?,?,1,'Atendente','active','department',?)",
            ["audit-agent", "Atendente", "unused", JSON.stringify([second])],
          )
        ).lastID;
        await db.run(
          "INSERT INTO permission_grants(user_id,account_id,permission,allowed,grant_kind,granted_by) VALUES (?,1,'atendimento.responder',1,'owner',1)",
          [member],
        );
        const flow = await publish(
            graph("distribute", {
              users: [member],
              departmentId: String(second),
              capacity: 5,
              strategy: "roundRobin",
            }),
          ),
          number = phone();
        context(chipA, number).conversation.departmentId = first;
        await event(flow, chipA, number);
        const row = await runFor(number);
        assert.equal(row.status, "stopped", JSON.parse(row.state).error);
        assert.equal(
          context(chipA, number).conversation.departmentId,
          String(second),
        );
        assert.equal(
          context(chipA, number).conversation.assignedUserId,
          member,
        );
        assignmentFixture = { department: second, origin: first, member };
      },
    );

    await t.test(
      "round robin, least busy, random and capacity use the actual assignment adapter",
      async (ct) => {
        const { department, member } = assignmentFixture;
        const other = (
          await db.run(
            "INSERT INTO users(username,display_name,password,account_id,role,status,scope,departments) VALUES (?,?,?,1,'Atendente','active','department',?)",
            ["audit-other", "Outro", "unused", JSON.stringify([department])],
          )
        ).lastID;
        await db.run(
          "INSERT INTO permission_grants(user_id,account_id,permission,allowed,grant_kind,granted_by) VALUES (?,1,'atendimento.responder',1,'owner',1)",
          [other],
        );
        const config = {
          users: [member, other],
          departmentId: String(department),
          capacity: 10,
          strategy: "roundRobin",
        };
        const round = await publish(graph("distribute", config));
        for (const expected of [member, other]) {
          const number = phone();
          await event(round, chipA, number);
          assert.equal(
            context(chipA, number).conversation.assignedUserId,
            expected,
          );
        }
        const least = await publish(
            graph("distribute", { ...config, strategy: "leastBusy" }),
          ),
          number = phone();
        await event(least, chipA, number);
        assert.equal(
          context(chipA, number).conversation.assignedUserId,
          other,
          "the less busy member should receive the next conversation",
        );
        ct.mock.method(Math, "random", () => 0.99);
        const random = await publish(
            graph("distribute", { ...config, strategy: "random" }),
          ),
          randomNumber = phone();
        await event(random, chipA, randomNumber);
        assert.equal(
          context(chipA, randomNumber).conversation.assignedUserId,
          other,
        );
        const full = await publish(
            graph("distribute", { ...config, capacity: 1 }),
          ),
          fullNumber = phone();
        await event(full, chipA, fullNumber);
        assert.equal((await runFor(fullNumber)).status, "failed");
        assert.equal(
          context(chipA, fullNumber).conversation.assignedUserId,
          undefined,
        );
      },
    );

    await t.test(
      "trigger priority is deterministic and pausing the winner activates the next eligible flow",
      async () => {
        const keyword = "audit-priority";
        const make = (label) => {
          const def = graph("text", { text: label });
          def.triggers = [
            { id: "keyword", type: "keyword", value: keyword, priority: 1000 },
          ];
          return def;
        };
        let first = await publish(make("Primeiro"));
        const second = await publish(make("Segundo"));
        const firstNumber = phone();
        await event(first, chipA, firstNumber, keyword, { flowId: undefined });
        assert.equal((await runFor(firstNumber)).flow_id, first.id);
        first = await flows.update(first.id, {
          revision: first.revision,
          active: false,
        });
        const secondNumber = phone();
        await event(second, chipA, secondNumber, keyword, {
          flowId: undefined,
        });
        assert.equal((await runFor(secondNumber)).flow_id, second.id);
        await assert.rejects(
          service.enqueue(999, chipA, {
            id: "wrong-account",
            number: phone(),
            type: "message",
          }),
          /conta/,
        );
      },
    );

    await t.test(
      "permissions revoked during a waiting execution prevent the next automatic reply",
      async () => {
        const { origin } = assignmentFixture;
        await db.run("UPDATE chips SET department_id=? WHERE id=?", [
          origin,
          chipA,
        ]);
        const actor = (
          await db.run(
            "INSERT INTO users(username,display_name,password,account_id,role,status,scope,departments) VALUES (?,?,?,1,'Atendente','active','account',?)",
            ["audit-publisher", "Editor", "unused", JSON.stringify([origin])],
          )
        ).lastID;
        for (const permission of [
          "fluxos.visualizar",
          "fluxos.editar",
          "atendimento.visualizar",
          "atendimento.responder",
          "atendimento.visualizar_todos",
        ])
          await db.run(
            "INSERT INTO permission_grants(user_id,account_id,permission,allowed,grant_kind,granted_by) VALUES (?,1,?,1,'owner',1)",
            [actor, permission],
          );
        const def = graph("question", { text: "Nome?", variable: "nome" });
        def.nodes.push({
          id: "reply",
          position: { x: 600, y: 0 },
          data: {
            kind: "text",
            config: { ...schema.defaults("text"), text: "Olá, {{fluxo.nome}}" },
          },
        });
        def.edges.find(
          (e) => e.source === "action" && e.sourceHandle === "next",
        ).target = "reply";
        def.edges.push({
          id: "reply-end",
          source: "reply",
          target: "end",
          sourceHandle: "next",
        });
        const flow = await require("../account-context").withAccount(
            1,
            () => publish(def),
            actor,
            origin,
          ),
          number = phone();
        await event(flow, chipA, number);
        assert.equal((await runFor(number)).status, "waiting");
        await db.run(
          "DELETE FROM permission_grants WHERE user_id=? AND permission='atendimento.responder'",
          [actor],
        );
        await event(flow, chipA, number, "Ana");
        assert.equal((await runFor(number)).status, "failed");
        assert.deepEqual(
          sent.filter((v) => v.number === number).map((v) => v.text),
          ["Nome?"],
        );
      },
    );

    await t.test(
      "a delay starts when its node is reached, after prior effects have finished",
      async (ct) => {
        let clock = Date.now();
        ct.mock.method(Date, "now", () => clock);
        const original = service.requestChip;
        service.requestChip = async (...args) => {
          const result = await original(...args);
          if (args[1] === "flow-send" && args[2].text === "Antes do tempo")
            clock += 10000;
          return result;
        };
        try {
          const def = graph("text", { text: "Antes do tempo" });
          def.nodes.push({
            id: "delay",
            position: { x: 600, y: 0 },
            data: {
              kind: "delay",
              config: { ...schema.defaults("delay"), duration: 1 },
            },
          });
          def.edges.find((e) => e.source === "action").target = "delay";
          def.edges.push({
            id: "delay-end",
            source: "delay",
            target: "end",
            sourceHandle: "next",
          });
          const flow = await publish(def),
            number = phone();
          await event(flow, chipA, number);
          const row = await runFor(number);
          assert.equal(row.status, "sleeping");
          assert.equal(JSON.parse(row.state).wakeAt, clock + 1000);
        } finally {
          service.requestChip = original;
        }
      },
    );
  },
);
