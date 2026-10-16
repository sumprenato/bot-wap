const { test } = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../flows/schema");
const { createState, executeNode } = require("../flows/engine");

test("the block library exposes only business outputs, with no fallback or error handler", () => {
  assert.equal(schema.blocks.error, undefined);
  for (const block of Object.values(schema.blocks)) {
    const ports = schema.outputs({
      data: { kind: block.type, config: schema.defaults(block.type) },
    });
    assert.ok(!ports.includes("default"), block.type);
    assert.ok(!ports.includes("error"), block.type);
  }
});

test("saved graphs discard retired branches and preserve normal and unrelated blocks", () => {
  const legacy = graph(
    "script",
    { code: 'return "manha";', outputs: ["manha"] },
    ["manha", "default", "error"],
  );
  const original = structuredClone(legacy);
  const cleaned = schema.normalizeDefinition(legacy);
  assert.deepEqual(
    cleaned.edges
      .filter((e) => e.source === "action")
      .map((e) => e.sourceHandle),
    ["manha"],
  );
  assert.deepEqual(
    cleaned.nodes.map((n) => n.id),
    ["start", "action", "end-manha"],
  );
  assert.deepEqual(schema.validate(cleaned, true).errors, []);
  assert.deepEqual(
    legacy,
    original,
    "reading old graphs must not rewrite their stored history",
  );
  legacy.nodes.push({
    id: "unrelated",
    position: { x: 0, y: 0 },
    data: { kind: "stop", config: {} },
  });
  assert.ok(
    schema.normalizeDefinition(legacy).nodes.some((n) => n.id === "unrelated"),
  );
});

test("old handler blocks on a normal path are bypassed without sending their message", async () => {
  const legacy = schema.empty();
  legacy.nodes.push(
    {
      id: "handler",
      position: { x: 0, y: 0 },
      data: { kind: "error", config: { text: "Mensagem removida" } },
    },
    {
      id: "end",
      position: { x: 400, y: 0 },
      data: { kind: "stop", config: {} },
    },
  );
  legacy.edges = [
    { id: "a", source: "start", target: "handler", sourceHandle: "next" },
    { id: "b", source: "handler", target: "end", sourceHandle: "next" },
  ];
  const state = createState(legacy);
  assert.equal(state.definition.edges[0].target, "end");
  const adapter = {
    effect: async (type) => {
      if (type === "send")
        assert.fail("a removed handler cannot send a message");
    },
  };
  await executeNode(state, adapter);
  await executeNode(state, adapter);
  assert.equal(state.status, "stopped");
});

test("an unmatched script result ends without a fallback transition", async () => {
  const result = await action(
    graph("script", { code: 'return "other";', outputs: ["manha"] }, ["manha"]),
  );
  assert.equal(result.state.status, "stopped");
  assert.equal(result.entry.edge, undefined);
  assert.equal(result.entry.port, undefined);
});

function graph(kind, config, ports = ["next"]) {
  const def = schema.empty();
  def.nodes.push({
    id: "action",
    position: { x: 400, y: 0 },
    data: {
      kind,
      label: kind,
      config: { ...schema.defaults(kind), ...config },
    },
  });
  def.edges.push({
    id: "start-action",
    source: "start",
    target: "action",
    sourceHandle: "next",
  });
  for (const port of ports) {
    def.nodes.push({
      id: `end-${port}`,
      position: { x: 800, y: 0 },
      data: { kind: "stop", config: { reason: port } },
    });
    def.edges.push({
      id: `edge-${port}`,
      source: "action",
      target: `end-${port}`,
      sourceHandle: port,
    });
  }
  return def;
}
test("legacy graphs retain messages, positions, edges, triggers and archival configuration", () => {
  const nodes = [
      { id: "start", type: "start", x: 10, y: 20 },
      {
        id: "message",
        type: "message",
        text: "Mensagem preservada",
        position: { x: 330, y: 20 },
      },
      { id: "end", type: "stop", position: { x: 660, y: 20 } },
    ],
    edges = [
      { source: "start", target: "message" },
      { source: "message", target: "end" },
    ];
  const converted = schema.fromLegacy(nodes, edges, ["olá"]);
  assert.equal(converted.nodes[1].data.kind, "text");
  assert.equal(converted.nodes[1].data.config.text, "Mensagem preservada");
  assert.deepEqual(converted.nodes[0].position, { x: 10, y: 20 });
  assert.equal(converted.triggers[0].value, "olá");
  assert.deepEqual(converted.legacy, { nodes, edges });
  assert.equal(new Set(converted.edges.map((e) => e.id)).size, 2);
  assert.deepEqual(schema.validate(converted, true).errors, []);
  const unknown = schema.fromLegacy(
    [
      { id: "start", type: "start", position: { x: 0, y: 0 } },
      {
        id: "old",
        type: "proprietary",
        position: { x: 330, y: 0 },
        config: { custom: "preserved" },
      },
    ],
    [{ source: "start", target: "old" }],
  );
  assert.equal(unknown.nodes[1].data.config.custom, "preserved");
  assert.ok(schema.validate(unknown, true).errors.length);
});
async function action(def, context = {}, options = {}) {
  const state = createState(def, context, Date.parse("2026-10-16T14:00:00Z")),
    effects = [];
  const adapter = {
    random: () => options.random ?? 0.2,
    flow: async () => options.flow,
    effect: async (type, payload) => {
      effects.push({ type, payload });
      return options.response || { ok: true };
    },
  };
  await executeNode(state, adapter);
  const entry = await executeNode(state, adapter);
  return { state, entry, effects, adapter };
}
test("condition AND/OR, chip state and tags select exactly one configured branch", async () => {
  const rules = [
    { variable: "contato.nome", operator: "eq", value: "Ana" },
    { variable: "chip.connected", operator: "eq", value: "true" },
  ];
  for (const [join, name, connected, port] of [
    ["and", "Ana", true, "true"],
    ["and", "Ana", false, "false"],
    ["or", "Ana", false, "true"],
    ["or", "Bia", false, "false"],
  ]) {
    const r = await action(
      graph("condition", { rules, join }, ["true", "false"]),
      { name, chip: { connected } },
    );
    assert.equal(r.entry.port, port);
    assert.equal(r.state.current, `end-${port}`);
  }
  for (const [kind, config, context, port] of [
    ["chipCondition", { field: "id", value: "7" }, { chip: { id: 7 } }, "true"],
    [
      "chipCondition",
      { field: "connected", value: "true" },
      { chip: { connected: false } },
      "false",
    ],
    ["tagCondition", { tag: "VIP" }, { tags: ["VIP"] }, "true"],
    ["tagCondition", { tag: "VIP" }, { tags: [] }, "false"],
  ])
    assert.equal(
      (await action(graph(kind, config, ["true", "false"]), context)).entry
        .port,
      port,
    );
});
test("randomizer honors probability intervals and switch stops without a matching output", async () => {
  const def = graph(
    "random",
    {
      paths: [
        { id: "a", weight: 50 },
        { id: "b", weight: 30 },
        { id: "c", weight: 20 },
      ],
    },
    ["a", "b", "c"],
  );
  for (const [draw, port] of [
    [0, "a"],
    [0.49, "a"],
    [0.5, "b"],
    [0.79, "b"],
    [0.8, "c"],
    [0.999, "c"],
  ])
    assert.equal((await action(def, {}, { random: draw })).entry.port, port);
  const fallback = await action(
    graph("switch", { variable: "contato.nome", outputs: ["Ana"] }, ["Ana"]),
    { name: "Bia" },
  );
  assert.equal(fallback.entry.port, undefined);
  assert.equal(fallback.state.status, "stopped");
});
test("all variable types, nested variable paths and sequential messages preserve values", async () => {
  for (const [valueType, value, expected] of [
    ["text", "Olá", "Olá"],
    ["number", "42", 42],
    ["boolean", "false", false],
    ["date", "2026-10-16", "2026-10-16T00:00:00.000Z"],
    ["json", '{"total":42}', { total: 42 }],
  ]) {
    const r = await action(
      graph("set", { variable: "cliente.resposta", valueType, value }),
    );
    assert.deepEqual(r.state.vars.fluxo.cliente.resposta, expected);
  }
  const r = await action(
    graph("text", {
      text: "",
      messages: ["Primeira, {{contato.nome}}", "Segunda"],
    }),
    { name: "Ana" },
  );
  assert.deepEqual(
    r.effects.map((e) => e.payload.text),
    ["Primeira, Ana", "Segunda"],
  );
});
test("HTTP methods, JSON mapping and variables use the same effect contract", async () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const result = await action(
      graph("http", {
        method,
        url: "https://example.test/{{contato.telefone}}",
        headers: { "X-Flow": "{{contato.nome}}" },
        body: { name: "{{contato.nome}}" },
        mapping: { "cliente.id": "customer.id" },
      }),
      { number: "5511999999999", name: "Ana" },
      { response: { customer: { id: 42 } } },
    );
    assert.equal(result.effects[0].payload.method, method);
    assert.equal(
      result.effects[0].payload.url,
      "https://example.test/5511999999999",
    );
    assert.equal(result.effects[0].payload.headers["X-Flow"], "Ana");
    assert.equal(result.state.vars.fluxo.cliente.id, 42);
  }
});
test("timer units and absolute deadlines persist waits; redirect preserves execution context", async () => {
  for (const [unit, factor] of [
    ["seconds", 1000],
    ["minutes", 60000],
    ["hours", 3600000],
    ["days", 86400000],
  ]) {
    const r = await action(graph("delay", { duration: 2, unit }));
    assert.equal(r.state.status, "sleeping");
    assert.equal(r.state.wakeAt - r.state.now, 2 * factor);
  }
  const absolute = await action(
    graph("delay", { until: "2026-10-17T14:00:00Z" }),
  );
  assert.equal(absolute.state.wakeAt, Date.parse("2026-10-17T14:00:00Z"));
  const target = graph("text", { text: "Olá, {{contato.nome}}!" }),
    source = graph("redirect", { target: "flow", targetId: "99" }, []);
  const r = await action(
    source,
    { name: "Ana" },
    { flow: { id: 99, version: 3, definition: target } },
  );
  assert.equal(r.state.redirectFlowId, 99);
  assert.equal(r.state.redirectVersion, 3);
  assert.equal(r.state.current, "start");
  assert.equal(r.state.vars.contato.nome, "Ana");
  await executeNode(r.state, r.adapter);
  await executeNode(r.state, r.adapter);
  assert.equal(r.effects.at(-1).payload.text, "Olá, Ana!");
});
