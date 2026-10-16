const {
  blocks,
  read,
  write,
  interpolate,
  safeKey,
  normalizeDefinition,
  parseVariableInput,
} = require("./schema");
const { script, safeRequest } = require("./security");
const menus = new Set(["menu", "buttons", "quickReply"]);
const waits = new Set([...menus, "question", "wait"]);
function createState(definition, context = {}, now = Date.now()) {
  definition = normalizeDefinition(definition);
  const globals = context.globals || {};
  const vars = {
    global: globals,
    conta: context.account || {},
    empresa: context.company || {},
    contato: {
      nome: context.name || "",
      telefone: context.number || "",
      tags: context.tags || [],
      ...(context.variables || {}),
    },
    atendimento: {
      protocolo: context.protocol || "",
      ...(context.conversation || {}),
    },
    chip: context.chip || {},
    fluxo: {},
  };
  for (const v of definition.variables || [])
    if (safeKey(v.key))
      vars.fluxo[v.key] = Object.hasOwn(v, "default")
        ? structuredClone(v.default)
        : "";
  return {
    definition,
    vars,
    current: definition.nodes.find((n) =>
      ["start", "trigger"].includes(n.data.kind),
    )?.id,
    status: "ready",
    step: 0,
    attempts: 0,
    messages: [],
    trace: [],
    answers: [],
    now,
    startedAt: now,
  };
}
function compare(a, op, b) {
  switch (op) {
    case "eq":
      return String(a ?? "") === String(b ?? "");
    case "ne":
      return String(a ?? "") !== String(b ?? "");
    case "contains":
      return String(a ?? "").includes(String(b));
    case "notContains":
      return !String(a ?? "").includes(String(b));
    case "gt":
      return Number(a) > Number(b);
    case "lt":
      return Number(a) < Number(b);
    case "gte":
      return Number(a) >= Number(b);
    case "lte":
      return Number(a) <= Number(b);
    case "empty":
      return a == null || a === "";
    case "notEmpty":
      return a != null && a !== "";
    default:
      throw new Error("Operador condicional inválido.");
  }
}
function inHours(c, now, timezone) {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(now));
  const date = local.slice(0, 10),
    time = local.slice(11, 16),
    weekday = new Date(date + "T12:00:00Z").getUTCDay();
  const rangesFor = (day, index) =>
    Object.hasOwn(c.exceptions || {}, day)
      ? c.exceptions[day]
      : (c.holidays || []).includes(day)
        ? []
        : c.schedule?.[index] || [];
  const today = rangesFor(date, weekday);
  if (
    today.some(([a, b]) => (a < b ? time >= a && time < b : a > b && time >= a))
  )
    return true;
  // After midnight, consult the opening day's schedule. A date exception or
  // holiday on the current day overrides the continuation from yesterday.
  if (
    Object.hasOwn(c.exceptions || {}, date) ||
    (c.holidays || []).includes(date)
  )
    return false;
  const previous = new Date(Date.parse(date + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  return rangesFor(previous, (weekday + 6) % 7).some(
    ([a, b]) => a > b && time < b,
  );
}
async function executeNode(state, adapter, input) {
  const node = state.definition.nodes.find((n) => n.id === state.current);
  if (!node) throw new Error("Bloco atual não existe.");
  if (state.step >= 500 || state.now - state.startedAt > 30 * 86400000)
    throw new Error("Limite de execução atingido.");
  const kind = node.data.kind,
    c = node.data.config,
    vars = state.vars;
  const render = (v) => interpolate(v, vars);
  let effectIndex = 0;
  const effect = (type, payload) =>
    adapter.effect(type, payload, `${state.step}:${effectIndex++}`);
  const say = async (text, extra = {}) => {
    const message = { text: render(text), ...extra };
    if (!message.kind && !message.text.trim())
      throw new Error("Mensagem sem conteúdo após substituir as variáveis.");
    await effect("send", message);
    state.messages.push({
      from: "bot",
      ...message,
      nodeId: node.id,
      at: state.now,
    });
    state.messages = state.messages.slice(-300);
  };
  let port = "next",
    wait = null,
    detail = blocks[kind]?.label || kind;
  if (state.status === "waiting" && waits.has(kind)) {
    if (input?.timeout) port = "timeout";
    else {
      const text = String(input?.text ?? "").trim();
      state.messages.push({ from: "user", text, at: state.now });
      state.answers.push({ nodeId: node.id, text, at: state.now });
      let valid = !!text,
        value = text;
      if (menus.has(kind)) {
        const option = c.options.find(
          (o) =>
            String(o.id).trim().toLocaleLowerCase("pt-BR") ===
              text.toLocaleLowerCase("pt-BR") ||
            render(o.label).trim().toLocaleLowerCase("pt-BR") ===
              text.toLocaleLowerCase("pt-BR"),
        );
        valid = !!option;
        port = option ? String(option.id) : null;
      } else {
        if (c.answerType === "number") {
          valid =
            text !== "" && Number.isFinite(Number(text.replace(",", ".")));
          value = Number(text.replace(",", "."));
        }
        if (c.answerType === "date") {
          valid =
            /^\d{4}-\d{2}-\d{2}$/.test(text) &&
            !Number.isNaN(Date.parse(text)) &&
            new Date(text).toISOString().slice(0, 10) === text;
        }
        if (c.answerType === "option")
          valid = c.choices?.map((v) => String(v).trim()).includes(text);
        port = valid ? "next" : null;
        if (valid) write(vars.fluxo, c.variable, value);
      }
      if (!valid && ++state.attempts < Number(c.attempts || 3)) {
        await say("Resposta inválida. Tente novamente.");
        if (c.repeat)
          await say(
            c.text +
              "\n" +
              c.options.map((o) => `${o.id} — ${o.label}`).join("\n"),
          );
        state.step++;
        return {
          waiting: true,
          node,
          detail: "Resposta inválida; aguardando nova tentativa.",
        };
      }
      state.attempts = 0;
    }
  } else {
    switch (kind) {
      case "start":
      case "trigger":
        break;
      case "text":
        for (const text of Array.isArray(c.messages) && c.messages.length
          ? c.messages
          : [c.text])
          await say(text);
        break;
      case "image":
      case "audio":
      case "video":
      case "document":
        await say(c.caption || "", {
          kind,
          assetId: c.assetId,
          fileName: render(c.fileName || ""),
        });
        break;
      case "menu":
      case "buttons":
      case "quickReply":
        await say(
          c.text +
            "\n\n" +
            c.options.map((o) => `${o.id} — ${o.label}`).join("\n"),
          { options: c.options.map((o) => ({ ...o, label: render(o.label) })) },
        );
        wait = "waiting";
        break;
      case "question":
        await say(c.text);
        wait = "waiting";
        break;
      case "wait":
        wait = "waiting";
        break;
      case "condition": {
        const results = c.rules.map((rule) =>
          compare(read(vars, rule.variable), rule.operator, render(rule.value)),
        );
        port = (
          c.join === "or" ? results.some(Boolean) : results.every(Boolean)
        )
          ? "true"
          : "false";
        break;
      }
      case "chipCondition":
        port =
          String(vars.chip[c.field]) === render(c.value) ? "true" : "false";
        break;
      case "tagCondition":
        port = vars.contato.tags.includes(render(c.tag)) ? "true" : "false";
        break;
      case "hours":
        port = inHours(c, state.now, state.definition.settings.timezone)
          ? "true"
          : "false";
        break;
      case "set": {
        const value = parseVariableInput(render(c.value), c.valueType);
        write(vars.fluxo, c.variable, value);
        break;
      }
      case "switch":
        port = c.outputs.map(String).includes(String(read(vars, c.variable)))
          ? String(read(vars, c.variable))
          : null;
        break;
      case "random": {
        const draw = adapter.random() * 100;
        let total = 0;
        port = c.paths.find((p) => draw < (total += Number(p.weight)))?.id;
        if (!port) throw new Error("Probabilidades inválidas.");
        break;
      }
      case "script": {
        const result = await script(
          c.code,
          vars,
          state.now,
          state.definition.settings.timezone,
        );
        write(vars.fluxo, c.variable, result);
        port = c.outputs.map(String).includes(String(result))
          ? String(result)
          : null;
        break;
      }
      case "http": {
        const renderJson = (value) =>
          typeof value === "string"
            ? render(value)
            : Array.isArray(value)
              ? value.map(renderJson)
              : value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).map(([key, entry]) => [
                      key,
                      renderJson(entry),
                    ]),
                  )
                : value;
        const config = {
          ...c,
          url: render(c.url),
          headers: renderJson(c.headers),
          body: renderJson(c.body),
        };
        const result = await effect("http", config);
        for (const [key, path] of Object.entries(c.mapping || {}))
          if (safeKey(key))
            write(
              vars.fluxo,
              key,
              read(result, path) ?? (path === "" ? result : null),
            );
        break;
      }
      case "tags": {
        const added = c.add.map(render),
          removed = c.remove.map(render);
        const tags = [...new Set([...vars.contato.tags, ...added])].filter(
          (t) => !removed.includes(t),
        );
        await effect("tags", { tags, create: c.create });
        vars.contato.tags = tags;
        break;
      }
      case "distribute":
        await effect("distribute", c);
        break;
      case "moveOpportunity":
        await effect("moveOpportunity", { columnId: c.columnId });
        break;
      case "redirect": {
        if (c.target === "flow") {
          const next = await adapter.flow(Number(c.targetId));
          if (!next) throw new Error("Fluxo de destino indisponível.");
          state.definition = normalizeDefinition(next.definition);
          for (const variable of state.definition.variables || []) {
            if (!Object.hasOwn(state.vars.fluxo, variable.key))
              state.vars.fluxo[variable.key] = Object.hasOwn(
                variable,
                "default",
              )
                ? structuredClone(variable.default)
                : "";
          }
          state.redirectFlowId = next.id;
          state.redirectVersion = next.version;
          state.current = next.definition.nodes.find((n) =>
            ["start", "trigger"].includes(n.data.kind),
          ).id;
          state.step++;
          state.status = "ready";
          return {
            node,
            port: "flow",
            detail: `Redirecionado para fluxo ${next.id}.`,
          };
        }
        await effect("redirect", c);
        break;
      }
      case "delay": {
        const factor = {
          seconds: 1000,
          minutes: 60000,
          hours: 3600000,
          days: 86400000,
        }[c.unit];
        const until = c.until
          ? Date.parse(render(c.until))
          : state.now + Number(c.duration) * factor;
        if (
          !Number.isFinite(until) ||
          until <= state.now ||
          until - state.now > 30 * 86400000
        )
          throw new Error("Temporizador inválido ou superior a 30 dias.");
        wait = "sleeping";
        state.wakeAt = until;
        break;
      }
      case "finish":
        if (c.tag) {
          const tags = [...new Set([...vars.contato.tags, render(c.tag)])];
          await effect("tags", { tags });
          vars.contato.tags = tags;
        }
        await effect("finish", { reason: render(c.reason) });
        state.status = "completed";
        break;
      case "stop":
        await effect("stop", {});
        state.status = "stopped";
        detail = c.reason || detail;
        break;
      default:
        throw new Error("Tipo de bloco não suportado.");
    }
  }
  state.step++;
  if (port === null) {
    state.status = "stopped";
    state.wakeAt = null;
    return { node, detail: "Execução encerrada sem saída correspondente." };
  }
  if (wait) {
    state.status = wait;
    if (wait === "waiting")
      state.wakeAt = state.now + Number(c.timeout || 300) * 1000;
    else state.resumePort = "next";
    return { node, waiting: true, detail };
  }
  if (!["completed", "stopped"].includes(state.status)) advance(state, port);
  const edge = state.definition.edges.find(
    (e) => e.source === node.id && (e.sourceHandle || "next") === port,
  );
  return { node, port, edge, detail };
}
function advance(state, port) {
  const edge = state.definition.edges.find(
    (e) => e.source === state.current && (e.sourceHandle || "next") === port,
  );
  if (!edge) throw new Error(`Saída ${port} sem conexão.`);
  state.current = edge.target;
  state.status = "ready";
  state.wakeAt = null;
  return edge;
}
function simulatorAdapter(state) {
  return {
    random: Math.random,
    flow: async () => null,
    effect: async (type, payload) => {
      if (type === "http") return state.simulation?.httpResponse || {};
      if (!["send", "stop"].includes(type))
        state.trace.push({
          detail: `Simulação isolada: ${type}`,
          payload,
          at: state.now,
        });
      return { simulated: true };
    },
  };
}
module.exports = {
  createState,
  executeNode,
  advance,
  compare,
  inHours,
  simulatorAdapter,
  safeRequest,
};
