const { test } = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../flows/schema");
const { createState, executeNode, inHours } = require("../flows/engine");

test("API definitions with an omitted renderer type use the flow block without mutating their source", () => {
  const definition = graph("text", { text: "Importado" });
  assert.equal(definition.nodes[1].type, undefined);
  const normalized = schema.normalizeDefinition(definition);
  assert.equal(normalized.nodes[1].type, "flowBlock");
  assert.equal(definition.nodes[1].type, undefined);
  assert.equal(schema.normalizeDefinition(normalized), normalized);
});

test("assignments reject empty numbers and impossible dates; dynamic dates remain publishable", async () => {
  for (const [valueType, value] of [
    ["number", ""],
    ["number", "abc"],
    ["date", "2026-02-30"],
    ["boolean", "0"],
    ["json", "{invalid"],
  ]) {
    const definition = graph("set", { valueType, value });
    assert.ok(schema.validate(definition, true).errors.length);
    const state = createState(definition);
    await executeNode(state, {});
    await assert.rejects(executeNode(state, {}));
  }
  const definition = graph("delay", { until: "{{fluxo.prazo}}" });
  definition.variables = [
    { key: "prazo", type: "date", default: "2026-10-18" },
  ];
  assert.deepEqual(schema.validate(definition, true).errors, []);
  const state = createState(definition, {}, Date.parse("2026-10-16T00:00:00Z"));
  await executeNode(state, {});
  await executeNode(state, {});
  assert.equal(state.wakeAt, Date.parse("2026-10-18T00:00:00Z"));
});

function graph(kind, config, ports = ["next"]) {
  const def = schema.empty();
  def.nodes.push({
    id: "action",
    position: { x: 400, y: 0 },
    data: { kind, config: { ...schema.defaults(kind), ...config } },
  });
  def.edges.push({
    id: "start-action",
    source: "start",
    target: "action",
    sourceHandle: "next",
  });
  for (const port of ports) {
    def.nodes.push({
      id: "end-" + port,
      position: { x: 800, y: 0 },
      data: { kind: "stop", config: {} },
    });
    def.edges.push({
      id: "end-" + port,
      source: "action",
      target: "end-" + port,
      sourceHandle: port,
    });
  }
  return def;
}

test("HTTP templates preserve quotes, newlines, backslashes, nested JSON and value types", async () => {
  const name = 'Ana "Comercial"\nSão Paulo\\Brasil';
  const definition = graph("http", {
    url: "https://example.test/customer",
    method: "POST",
    headers: { "X-Name": "{{contato.nome}}" },
    body: {
      name: "{{contato.nome}}",
      nested: { note: "Olá, {{contato.nome}}" },
      items: ["{{contato.nome}}", 42, true, null],
    },
    mapping: { "cliente.ativo": "active", "cliente.zero": "zero" },
  });
  const state = createState(definition, { name }),
    effects = [];
  await executeNode(state, {});
  await executeNode(state, {
    effect: async (type, payload) => {
      effects.push({ type, payload });
      return { active: false, zero: 0 };
    },
  });
  assert.equal(effects[0].payload.body.name, name);
  assert.equal(effects[0].payload.body.nested.note, "Olá, " + name);
  assert.deepEqual(effects[0].payload.body.items, [name, 42, true, null]);
  assert.equal(effects[0].payload.headers["X-Name"], name);
  assert.equal(state.vars.fluxo.cliente.ativo, false);
  assert.equal(state.vars.fluxo.cliente.zero, 0);
});

test("overnight business hours belong to their opening day, including Sunday transitions", () => {
  const config = {
    schedule: { 1: [["22:00", "02:00"]] },
    holidays: [],
    exceptions: {},
  };
  const at = (date) => Date.parse(date + "-03:00");
  assert.equal(
    inHours(config, at("2026-10-19T01:00:00"), "America/Sao_Paulo"),
    false,
    "Monday before opening",
  );
  assert.equal(
    inHours(config, at("2026-10-19T22:00:00"), "America/Sao_Paulo"),
    true,
    "Monday opening",
  );
  assert.equal(
    inHours(config, at("2026-10-20T01:59:00"), "America/Sao_Paulo"),
    true,
    "Tuesday continuation",
  );
  assert.equal(
    inHours(config, at("2026-10-20T02:00:00"), "America/Sao_Paulo"),
    false,
    "closing boundary",
  );
  assert.equal(
    inHours(
      { ...config, schedule: { 6: [["23:00", "03:00"]] } },
      at("2026-10-18T01:00:00"),
      "America/Sao_Paulo",
    ),
    true,
    "Saturday continues into Sunday",
  );
  assert.equal(
    inHours(
      { ...config, holidays: ["2026-10-20"] },
      at("2026-10-20T01:00:00"),
      "America/Sao_Paulo",
    ),
    false,
    "a closed holiday overrides an overnight continuation",
  );
});

test("node validation rejects missing switch variables, empty outputs and invalid duration before publication", () => {
  for (const def of [
    graph("switch", { variable: "", outputs: ["a"] }, ["a"]),
    graph("script", { outputs: [] }, []),
    graph("switch", { outputs: [] }, []),
    graph("delay", { until: "not-a-date" }),
    graph("delay", { duration: 31, unit: "days" }),
    graph("question", { text: "Opção?", answerType: "option", choices: [] }, [
      "next",
      "timeout",
    ]),
    graph("distribute", { strategy: "roundRobin", capacity: 1.5 }),
  ]) {
    assert.ok(
      schema.validate(def, true).errors.length,
      "bad " + def.nodes[1].data.kind + " must fail before execution",
    );
  }
});

test("menu matching rejects ambiguous identifiers and labels after normalization", () => {
  const def = graph(
    "menu",
    {
      text: "Escolha",
      options: [
        { id: "A", label: "Sim" },
        { id: "a", label: "Não" },
      ],
    },
    ["A", "a", "timeout"],
  );
  assert.ok(
    schema.validate(def, true).errors.length,
    "case-insensitive IDs cannot route to different branches",
  );
  def.nodes[1].data.config.options = [
    { id: "1", label: "Sim" },
    { id: "2", label: "sim" },
  ];
  def.edges = def.edges.filter((e) => e.source === "start");
  assert.ok(
    schema.validate(def, true).errors.some((e) => /opções/i.test(e)),
    "case-insensitive labels must also be unambiguous",
  );
});

test("every catalog block validates and executes its declared output contract", async (t) => {
  const fixtures = {
    text: { text: "Olá, {{contato.nome}}" },
    image: { assetId: "fixture-image", caption: "Foto" },
    audio: { assetId: "fixture-audio" },
    video: { assetId: "fixture-video" },
    document: { assetId: "fixture-document", caption: "PDF" },
    menu: { text: "Escolha" },
    buttons: { text: "Escolha" },
    quickReply: { text: "Escolha" },
    question: { text: "Nome?" },
    condition: {
      rules: [{ variable: "contato.nome", operator: "eq", value: "Cliente" }],
    },
    tagCondition: { tag: "VIP" },
    moveOpportunity: { columnId: "1" },
    redirect: { target: "department", targetId: "1" },
    http: { url: "https://example.test", mapping: { total: "total" } },
    script: { code: 'return "manha";' },
    switch: { variable: "contato.nome", outputs: ["Cliente"] },
  };
  for (const block of Object.values(schema.blocks))
    await t.test(block.type, async () => {
      let def;
      if (["start", "trigger"].includes(block.type)) {
        def = schema.empty();
        def.nodes[0].data.kind = block.type;
        def.nodes.push({
          id: "end",
          position: { x: 400, y: 0 },
          data: { kind: "stop", config: {} },
        });
        def.edges = [
          { id: "end", source: "start", target: "end", sourceHandle: "next" },
        ];
      } else {
        const config = {
          ...schema.defaults(block.type),
          ...fixtures[block.type],
        };
        const ports = schema.outputs({ data: { kind: block.type, config } });
        def = graph(block.type, config, ports);
      }
      assert.deepEqual(
        schema.validate(def, true).errors,
        [],
        block.type + " must be publishable",
      );
      const effects = [],
        state = createState(
          def,
          { name: "Cliente", tags: ["VIP"], chip: { connected: true } },
          Date.parse("2026-10-16T15:00:00Z"),
        );
      const adapter = {
        random: () => 0.1,
        effect: async (type, payload) => {
          effects.push({ type, payload });
          return { total: 0 };
        },
      };
      for (let i = 0; i < 4 && state.status === "ready"; i++)
        await executeNode(state, adapter);
      if (state.status === "waiting") {
        const answer = ["menu", "buttons", "quickReply"].includes(block.type)
          ? "1"
          : "Cliente";
        await executeNode(state, adapter, { text: answer });
        await executeNode(state, adapter);
      }
      assert.ok(
        ["stopped", "completed", "sleeping"].includes(state.status),
        block.type + " final state",
      );
      if (["image", "audio", "video", "document"].includes(block.type))
        assert.equal(effects[0].payload.kind, block.type);
    });
});

test("redirected flows initialize their own defaults while preserving values already collected", async () => {
  const target = graph("text", { text: "{{fluxo.saudacao}} {{fluxo.nome}}" });
  target.variables = [
    { key: "saudacao", type: "text", default: "Olá" },
    { key: "nome", type: "text", default: "Padrão" },
  ];
  const source = graph("redirect", { target: "flow", targetId: "99" }, []);
  const state = createState(source);
  state.vars.fluxo.nome = "Ana";
  const sent = [],
    adapter = {
      flow: async () => ({ id: 99, version: 1, definition: target }),
      effect: async (type, p) => {
        if (type === "send") sent.push(p.text);
      },
    };
  for (let i = 0; i < 6 && state.status === "ready"; i++)
    await executeNode(state, adapter);
  assert.deepEqual(sent, ["Olá Ana"]);
});

test("menu option previews render variables just like the outgoing menu text", async () => {
  const def = graph(
    "menu",
    {
      text: "Olá",
      options: [{ id: "1", label: "Falar com {{contato.nome}}" }],
    },
    ["1", "timeout"],
  );
  const state = createState(def, { name: "Ana" }),
    sent = [];
  await executeNode(state, {});
  await executeNode(state, {
    effect: async (_, payload) => sent.push(payload),
  });
  assert.equal(sent[0].options[0].label, "Falar com Ana");
});

test("an empty interpolated text is rejected before any message send is reserved", async () => {
  const state = createState(graph("text", { text: "{{contato.nome}}" }));
  await executeNode(state, {});
  await assert.rejects(
    executeNode(state, {
      effect: async () =>
        assert.fail("empty content cannot reach the transport"),
    }),
    /sem conteúdo/i,
  );
});

test("all automatic trigger types respect event kind, disabled state and keyword rules", () => {
  const { triggerMatch } = require("../flows/triggers");
  const message = {
    type: "message",
    text: "  Olá, cliente  ",
    firstMessage: true,
    newContact: true,
  };
  for (const type of ["message", "firstMessage", "newContact"]) {
    assert.equal(triggerMatch({ type }, message), true, type);
    assert.equal(
      triggerMatch({ type, enabled: false }, message),
      false,
      type + " disabled",
    );
    assert.equal(
      triggerMatch(
        { type },
        { type: "api", firstMessage: true, newContact: true },
      ),
      false,
      type + " wrong event",
    );
  }
  for (const [match, value, expected] of [
    ["exact", "Olá, cliente", true],
    ["contains", "CLIENTE", true],
    ["startsWith", "OLÁ", true],
    ["exact", "Olá", false],
    ["contains", "", false],
  ])
    assert.equal(
      triggerMatch({ type: "keyword", match, value }, message),
      expected,
      match,
    );
  assert.equal(
    triggerMatch(
      { type: "tagAdded", value: "VIP" },
      { type: "tagAdded", tags: ["VIP"] },
    ),
    true,
  );
  assert.equal(
    triggerMatch(
      { type: "tagAdded", value: "VIP" },
      { type: "message", tags: ["VIP"] },
    ),
    false,
  );
  for (const type of ["api", "system", "integration"]) {
    assert.equal(
      triggerMatch({ type, value: "evento" }, { type, name: "evento" }),
      true,
      type,
    );
    assert.equal(
      triggerMatch({ type, value: "evento" }, { type, name: "outro" }),
      false,
      type + " name",
    );
  }
});

test("typed defaults retain null, reject wrong types and never share objects across executions", () => {
  const def = graph("text", { text: "Ok" });
  def.variables = [
    { key: "json", type: "json", default: { total: 0 } },
    { key: "empty", type: "json", default: null },
  ];
  const first = createState(def),
    second = createState(def);
  first.vars.fluxo.json.total = 9;
  assert.equal(second.vars.fluxo.json.total, 0);
  assert.equal(def.variables[0].default.total, 0);
  assert.equal(first.vars.fluxo.empty, null);
  assert.deepEqual(schema.validate(def, true).errors, []);
  for (const [type, value] of [
    ["number", "abc"],
    ["boolean", "false"],
    ["date", "2026-02-30"],
    ["text", 42],
  ]) {
    def.variables = [{ key: "bad", type, default: value }];
    assert.ok(schema.validate(def, true).errors.length, type);
  }
  assert.equal(schema.decodeVariable("false", "text"), "false");
  assert.equal(schema.decodeVariable("false", "boolean"), false);
  assert.equal(schema.decodeVariable("0", "number"), 0);
});
