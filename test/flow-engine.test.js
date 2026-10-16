const { test } = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../flows/schema");
const {
  createState,
  executeNode,
  simulatorAdapter,
  compare,
  inHours,
} = require("../flows/engine");
const { script, publicAddress, safeRequest } = require("../flows/security");
const { EventEmitter } = require("node:events");
function graph(nodes) {
  const def = schema.empty();
  def.nodes.push(
    ...nodes.map(([id, kind, config]) => ({
      id,
      type: "flowBlock",
      position: { x: 0, y: 0 },
      data: {
        kind,
        label: kind,
        config: { ...schema.defaults(kind), ...config },
      },
    })),
  );
  return def;
}
const link = (d, s, p, t) =>
  d.edges.push({ id: `${s}-${p}-${t}`, source: s, target: t, sourceHandle: p });
async function drive(state, input) {
  const adapter = simulatorAdapter(state);
  for (let i = 0; i < 600; i++) {
    await executeNode(state, adapter, input);
    input = undefined;
    if (state.status !== "ready") return state;
  }
  throw new Error("Test did not terminate");
}
test("graph validation rejects unsafe, missing, ambiguous and duplicate connections", () => {
  const d = graph([
    ["a", "text", { text: "Olá" }],
    ["end", "stop", {}],
  ]);
  link(d, "start", "next", "a");
  link(d, "a", "next", "end");
  assert.deepEqual(schema.validate(d, true).errors, []);
  const duplicate = structuredClone(d);
  duplicate.edges.push({ ...duplicate.edges[0], id: "other" });
  assert.match(schema.validate(duplicate).errors.join(" "), /inválida/);
  const broken = structuredClone(d);
  broken.edges[0].target = "missing";
  assert.ok(schema.validate(broken).errors.length);
  const bad = structuredClone(d);
  bad.nodes[1].data.config.options = "oops";
  assert.ok(schema.validate(bad, true).errors.length);
  const malicious = JSON.parse(
    JSON.stringify(d).replace(
      '"config":{}',
      '"config":{"__proto__":{"polluted":true}}',
    ),
  );
  assert.match(schema.validate(malicious).errors.join(" "), /reservadas/);
  const disconnected = structuredClone(d);
  disconnected.nodes.push({
    id: "unused",
    position: { x: 0, y: 0 },
    data: { kind: "stop", config: {} },
  });
  assert.ok(schema.validate(disconnected, true).errors.length);
  const random = graph([
    [
      "random",
      "random",
      {
        paths: [
          { id: "a", weight: 80 },
          { id: "b", weight: 40 },
        ],
      },
    ],
  ]);
  assert.match(schema.validate(random, true).errors.join(" "), /100%/);
});
test("questions preserve typed answers; invalid retries and timeouts take exclusive ports", async () => {
  const d = graph([
    ["q", "question", { text: "Seu nome?", variable: "nome", attempts: 2 }],
    ["msg", "text", { text: "Olá, {{fluxo.nome}}!" }],
    ["end", "stop", {}],
  ]);
  link(d, "start", "next", "q");
  link(d, "q", "next", "msg");
  link(d, "q", "timeout", "end");
  link(d, "msg", "next", "end");
  const s = createState(d);
  await drive(s);
  assert.equal(s.status, "waiting");
  await drive(s, { text: "Renato" });
  assert.equal(s.vars.fluxo.nome, "Renato");
  assert.equal(s.messages.at(-1).text, "Olá, Renato!");
  assert.equal(s.status, "stopped");
  const number = structuredClone(d);
  number.nodes[1].data.config.answerType = "number";
  const n = createState(number);
  await drive(n);
  await drive(n, { text: "inválido" });
  assert.equal(n.status, "waiting");
  await drive(n, { text: "ainda inválido" });
  assert.equal(n.status, "stopped");
  assert.equal(n.vars.fluxo.nome, undefined);
  const timeout = createState(d);
  await drive(timeout);
  await drive(timeout, { timeout: true });
  assert.equal(timeout.status, "stopped");
  assert.equal(timeout.messages.length, 1);
});
test("numeric, button and quick reply menus dispatch only the chosen output and handle invalid input", async () => {
  for (const kind of ["menu", "buttons", "quickReply"]) {
    const d = graph([
      [
        "m",
        kind,
        {
          text: "Escolha",
          options: [
            { id: "1", label: "Comercial" },
            { id: "2", label: "Suporte" },
          ],
          attempts: 2,
        },
      ],
      ["a", "text", { text: "comercial" }],
      ["b", "text", { text: "suporte" }],
      ["end", "stop", {}],
    ]);
    link(d, "start", "next", "m");
    link(d, "m", "1", "a");
    link(d, "m", "2", "b");
    link(d, "m", "timeout", "end");
    link(d, "a", "next", "end");
    link(d, "b", "next", "end");
    const s = createState(d);
    await drive(s);
    await drive(s, { text: "9" });
    assert.equal(s.status, "waiting");
    await drive(s, { text: "2" });
    assert.equal(s.messages.at(-1).text, "suporte");
    assert.ok(!s.messages.some((m) => m.text === "comercial"));
    const fallback = createState(d);
    await drive(fallback);
    await drive(fallback, { text: "9" });
    await drive(fallback, { text: "99" });
    assert.equal(fallback.status, "stopped");
  }
});
test("all message media types use the messaging adapter and preserve captions", async () => {
  for (const kind of ["image", "audio", "video", "document"]) {
    const d = graph([
      ["m", kind, { assetId: "owned-asset", caption: "Olá {{contato.nome}}" }],
      ["end", "stop", {}],
    ]);
    link(d, "start", "next", "m");
    link(d, "m", "next", "end");
    const state = createState(d, { name: "Cliente" }),
      calls = [];
    const adapter = {
      ...simulatorAdapter(state),
      effect: async (...args) => calls.push(args),
    };
    await executeNode(state, adapter);
    await executeNode(state, adapter);
    assert.equal(calls[0][0], "send");
    assert.equal(calls[0][1].kind, kind);
    assert.equal(calls[0][1].assetId, "owned-asset");
    assert.equal(calls[0][1].text, "Olá Cliente");
  }
});
test("conditions, business hours, variables, random and switch execute configured branches", async () => {
  for (const [op, a, b, expected] of [
    ["eq", "a", "a", true],
    ["ne", 1, 2, true],
    ["contains", "abc", "b", true],
    ["notContains", "abc", "z", true],
    ["gt", 3, 2, true],
    ["lt", 1, 2, true],
    ["gte", 2, 2, true],
    ["lte", 2, 2, true],
    ["empty", null, "", true],
    ["notEmpty", "x", "", true],
  ])
    assert.equal(compare(a, op, b), expected);
  const c = {
    schedule: { 5: [["08:00", "18:00"]] },
    holidays: [],
    exceptions: {},
  };
  assert.equal(
    inHours(c, Date.parse("2026-10-16T14:00:00Z"), "America/Sao_Paulo"),
    true,
  );
  assert.equal(
    inHours(c, Date.parse("2026-10-17T01:00:00Z"), "America/Sao_Paulo"),
    false,
  );
  assert.equal(
    inHours(
      { ...c, holidays: ["2026-10-16"] },
      Date.parse("2026-10-16T14:00:00Z"),
      "America/Sao_Paulo",
    ),
    false,
  );
  assert.equal(
    inHours(
      { ...c, exceptions: { "2026-10-16": [["20:00", "23:00"]] } },
      Date.parse("2026-10-17T01:00:00Z"),
      "America/Sao_Paulo",
    ),
    true,
  );
  const d = graph([
    ["set", "set", { variable: "n", valueType: "number", value: "42" }],
    ["sw", "switch", { variable: "fluxo.n", outputs: ["42"] }],
    ["end", "stop", {}],
  ]);
  link(d, "start", "next", "set");
  link(d, "set", "next", "sw");
  link(d, "sw", "42", "end");
  const s = createState(d);
  await drive(s);
  assert.equal(s.vars.fluxo.n, 42);
  assert.equal(s.status, "stopped");
});
test("JavaScript interpreter isolates host access, respects flow timezone and interrupts loops and memory abuse", async () => {
  const now = Date.parse("2026-10-16T14:00:00Z");
  assert.equal(
    await script("return new Date().getHours();", {}, now, "America/Sao_Paulo"),
    11,
  );
  assert.equal(
    await script("return new Date().getHours();", {}, now, "Asia/Tokyo"),
    23,
  );
  assert.deepEqual(
    await script(
      "return [typeof process,typeof require,typeof fetch];",
      {},
      now,
      "UTC",
    ),
    ["undefined", "undefined", "undefined"],
  );
  assert.equal(
    await script(
      "return variables.fluxo.n * 2;",
      { fluxo: { n: 21 } },
      now,
      "UTC",
    ),
    42,
  );
  await assert.rejects(script("while(true){}", {}, now, "UTC"), /Script/);
  await assert.rejects(
    script(
      'return new Array(100000000).fill("0123456789").join("")',
      {},
      now,
      "UTC",
    ),
  );
  await assert.rejects(script("return ;", {}, now, "UTC"), /JSON/);
});
test("SSRF blocks private, reserved, mapped IPv6 and unsafe transport endpoints", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "http://example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:secret@example.com",
    "https://example.com:8443",
  ])
    await assert.rejects(safeRequest({ url, method: "GET" }));
});
test("HTTPS contract pins DNS, injects server credentials, maps JSON and refuses redirects", async (t) => {
  const https = require("node:https"),
    dns = require("node:dns").promises;
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  let status = 200,
    captured,
    body = "";
  t.mock.method(https, "request", (url, options, callback) => {
    captured = { url, options };
    const request = new EventEmitter();
    request.write = (data) => {
      body += data;
    };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = status;
      callback(response);
      setImmediate(() => {
        response.emit("data", Buffer.from('{"customer":{"id":42}}'));
        response.emit("end");
      });
    };
    return request;
  });
  const result = await safeRequest(
    {
      url: "https://api.example.test/customer",
      method: "POST",
      headers: { "X-Request-ID": "flow" },
      body: { name: "Cliente" },
      secretName: "FLOW_SECRET_1_CRM",
    },
    { FLOW_SECRET_1_CRM: "server-only" },
  );
  assert.equal(result.customer.id, 42);
  assert.equal(captured.options.headers.Authorization, "Bearer server-only");
  assert.equal(body, '{"name":"Cliente"}');
  const pinned = await new Promise((resolve) =>
    captured.options.lookup("api.example.test", {}, (_, address, family) =>
      resolve({ address, family }),
    ),
  );
  assert.deepEqual(pinned, { address: "8.8.8.8", family: 4 });
  status = 302;
  await assert.rejects(
    safeRequest({ url: "https://api.example.test/customer", method: "GET" }),
    /302/,
  );
  await assert.rejects(
    safeRequest({
      url: "https://api.example.test",
      method: "GET",
      headers: { Host: "internal" },
    }),
    /Header/,
  );
  await assert.rejects(
    safeRequest(
      {
        url: "https://api.example.test",
        method: "GET",
        secretName: "FLOW_SECRET_1_MISSING",
      },
      {},
    ),
    /Credencial/,
  );
});
test("loop execution is bounded and simulator never performs production effects", async () => {
  const d = graph([
    ["a", "tags", { add: ["VIP"], remove: [] }],
    ["b", "distribute", {}],
    ["c", "redirect", { target: "department", targetId: "123" }],
    ["end", "stop", {}],
  ]);
  link(d, "start", "next", "a");
  link(d, "a", "next", "b");
  link(d, "b", "next", "c");
  link(d, "c", "next", "end");
  const s = createState(d);
  await drive(s);
  assert.deepEqual(s.vars.contato.tags, ["VIP"]);
  assert.equal(s.trace.filter((t) => t.payload).length, 3);
  const loop = graph([
    ["a", "set", { variable: "v", value: "a" }],
    ["b", "set", { variable: "v", value: "b" }],
  ]);
  link(loop, "start", "next", "a");
  link(loop, "a", "next", "b");
  link(loop, "b", "next", "a");
  assert.match(schema.validate(loop).warnings.join(" "), /Ciclo/);
  await assert.rejects(drive(createState(loop)), /Limite/);
});
