// Shared by the editor, publication validator and execution engine.
const fields = (...items) =>
  items.map(([key, label, type = "text", value = ""]) => ({
    key,
    label,
    type,
    value,
  }));
const catalog = {
  start: ["Início", "Estrutura", fields(), ["next"]],
  trigger: ["Início por gatilho", "Estrutura", fields(), ["next"]],
  text: [
    "Texto",
    "Mensagem",
    fields(
      ["text", "Mensagem", "textarea"],
      ["messages", "Mensagens sequenciais (opcional)", "json", []],
    ),
    ["next"],
  ],
  image: [
    "Imagem",
    "Mensagem",
    fields(["assetId", "Arquivo", "asset"], ["caption", "Legenda", "textarea"]),
    ["next"],
  ],
  audio: [
    "Áudio",
    "Mensagem",
    fields(["assetId", "Arquivo", "asset"]),
    ["next"],
  ],
  video: [
    "Vídeo",
    "Mensagem",
    fields(["assetId", "Arquivo", "asset"], ["caption", "Legenda", "textarea"]),
    ["next"],
  ],
  document: [
    "Documento",
    "Mensagem",
    fields(
      ["assetId", "Arquivo", "asset"],
      ["fileName", "Nome do arquivo"],
      ["caption", "Legenda", "textarea"],
    ),
    ["next"],
  ],
  menu: [
    "Menu numérico",
    "Menus interativos",
    fields(
      ["text", "Mensagem", "textarea"],
      [
        "options",
        "Opções",
        "options",
        [
          { id: "1", label: "Opção 1" },
          { id: "2", label: "Opção 2" },
        ],
      ],
      ["timeout", "Espera (segundos)", "number", 300],
      ["attempts", "Tentativas", "number", 3],
      ["repeat", "Repetir menu inválido", "boolean", true],
    ),
    ["timeout"],
  ],
  buttons: [
    "Menu de botões",
    "Menus interativos",
    fields(
      ["text", "Mensagem", "textarea"],
      ["options", "Opções", "options", [{ id: "1", label: "Opção 1" }]],
      ["timeout", "Espera (segundos)", "number", 300],
      ["attempts", "Tentativas", "number", 3],
    ),
    ["timeout"],
  ],
  quickReply: [
    "Resposta rápida",
    "Menus interativos",
    fields(
      ["text", "Mensagem", "textarea"],
      ["options", "Opções", "options", [{ id: "1", label: "Opção 1" }]],
      ["timeout", "Espera (segundos)", "number", 300],
      ["attempts", "Tentativas", "number", 3],
    ),
    ["timeout"],
  ],
  condition: [
    "Condicional",
    "Ações e automações",
    fields(
      [
        "rules",
        "Regras {variable, operator, value}",
        "json",
        [{ variable: "contato.nome", operator: "notEmpty", value: "" }],
      ],
      ["join", "Combinação (and / or)", "text", "and"],
    ),
    ["true", "false"],
  ],
  chipCondition: [
    "Condicional de chip",
    "Ações e automações",
    fields(
      ["field", "Campo (id / number / connected)", "text", "connected"],
      ["value", "Valor esperado", "text", "true"],
    ),
    ["true", "false"],
  ],
  tagCondition: [
    "Condicional de tag",
    "Ações e automações",
    fields(["tag", "Tag"]),
    ["true", "false"],
  ],
  distribute: [
    "Distribuir atendimento",
    "Ações e automações",
    fields(
      [
        "strategy",
        "Estratégia (roundRobin / random / leastBusy)",
        "text",
        "roundRobin",
      ],
      ["users", "IDs de atendentes", "json", []],
      ["departmentId", "Departamento", "department"],
      ["capacity", "Capacidade por atendente", "number", 20],
    ),
    ["next"],
  ],
  finish: [
    "Finalizar conversa",
    "Ações e automações",
    fields(["reason", "Motivo"], ["tag", "Tag opcional"]),
    [],
  ],
  hours: [
    "Horário de funcionamento",
    "Ações e automações",
    fields(
      [
        "schedule",
        "Horários por dia (0=domingo)",
        "json",
        {
          1: [["08:00", "18:00"]],
          2: [["08:00", "18:00"]],
          3: [["08:00", "18:00"]],
          4: [["08:00", "18:00"]],
          5: [["08:00", "18:00"]],
        },
      ],
      ["holidays", "Feriados (AAAA-MM-DD)", "json", []],
      ["exceptions", "Exceções por data", "json", {}],
    ),
    ["true", "false"],
  ],
  moveOpportunity: [
    "Mover oportunidade",
    "Ações e automações",
    fields(["columnId", "Etapa de destino", "column"]),
    ["next"],
  ],
  question: [
    "Pergunta",
    "Ações e automações",
    fields(
      ["text", "Pergunta", "textarea"],
      ["variable", "Variável de execução", "text", "resposta"],
      ["answerType", "Tipo (text / number / date / option)", "text", "text"],
      ["choices", "Opções permitidas", "json", []],
      ["attempts", "Tentativas", "number", 3],
      ["timeout", "Espera (segundos)", "number", 300],
    ),
    ["next", "timeout"],
  ],
  wait: [
    "Aguardar resposta",
    "Estrutura",
    fields(
      ["variable", "Variável", "text", "resposta"],
      ["timeout", "Espera (segundos)", "number", 300],
    ),
    ["next", "timeout"],
  ],
  random: [
    "Randomizador",
    "Ações e automações",
    fields([
      "paths",
      "Caminhos {id, weight}",
      "json",
      [
        { id: "a", weight: 50 },
        { id: "b", weight: 50 },
      ],
    ]),
    [],
  ],
  redirect: [
    "Redirecionar",
    "Ações e automações",
    fields(
      [
        "target",
        "Destino (flow / department / user / team)",
        "text",
        "department",
      ],
      ["targetId", "Identificador do destino"],
      ["users", "Equipe (IDs)", "json", []],
    ),
    ["next"],
  ],
  http: [
    "Requisição HTTP",
    "Integrações",
    fields(
      ["method", "Método", "text", "GET"],
      ["url", "URL HTTPS"],
      ["headers", "Headers sem credenciais", "json", {}],
      ["secretName", "Credencial no servidor (FLOW_SECRET_...)"],
      ["body", "Body JSON", "json", {}],
      ["timeout", "Timeout (ms)", "number", 10000],
      [
        "mapping",
        "Mapeamento variável → caminho JSON",
        "json",
        { resposta: "" },
      ],
    ),
    ["next"],
  ],
  script: [
    "Script JavaScript",
    "Integrações",
    fields(
      [
        "code",
        "JavaScript isolado",
        "code",
        'const hora = new Date().getHours();\nreturn hora < 12 ? "manha" : hora < 18 ? "tarde" : "noite";',
      ],
      ["variable", "Variável de saída", "text", "periodo"],
      ["outputs", "Saídas", "json", ["manha", "tarde", "noite"]],
    ),
    [],
  ],
  switch: [
    "Switch variável",
    "Ações e automações",
    fields(
      ["variable", "Variável", "text", "fluxo.periodo"],
      ["outputs", "Valores", "json", ["manha", "tarde", "noite"]],
    ),
    [],
  ],
  tags: [
    "Atribuir tags",
    "Ações e automações",
    fields(
      ["add", "Adicionar", "json", []],
      ["remove", "Remover", "json", []],
      ["create", "Criar tags ausentes (proprietário)", "boolean", false],
    ),
    ["next"],
  ],
  delay: [
    "Temporizador",
    "Ações e automações",
    fields(
      ["duration", "Duração", "number", 10],
      ["unit", "Unidade (seconds / minutes / hours / days)", "text", "seconds"],
      ["until", "Ou data e hora ISO 8601"],
    ),
    ["next"],
  ],
  set: [
    "Atribuir variável",
    "Ações e automações",
    fields(
      ["variable", "Nome", "text", "valor"],
      [
        "valueType",
        "Tipo (text / number / boolean / date / json)",
        "text",
        "text",
      ],
      ["value", "Valor", "textarea"],
    ),
    ["next"],
  ],
  stop: ["Interromper", "Estrutura", fields(["reason", "Motivo"]), []],
};
const blocks = Object.fromEntries(
  Object.entries(catalog).map(([type, [label, category, fields, outputs]]) => [
    type,
    { type, label, category, fields, outputs },
  ]),
);
function defaults(type) {
  return Object.fromEntries(
    blocks[type].fields.map((f) => [
      f.key,
      JSON.parse(JSON.stringify(f.value)),
    ]),
  );
}
function outputs(node) {
  const c = node.data?.config || {};
  return [
    ...(Array.isArray(c.options) ? c.options : []).map((o) => String(o?.id)),
    ...(Array.isArray(c.paths) ? c.paths : []).map((o) => String(o?.id)),
    ...(Array.isArray(c.outputs) ? c.outputs : []).map(String),
    ...(blocks[node.data?.kind]?.outputs || []),
  ].filter((port) => !["default", "error"].includes(port));
}

// Upgrade existing drafts, published versions and run snapshots on read. Only
// remove branches made unreachable by the retired ports; preserve other blocks.
function normalizeDefinition(def) {
  if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges))
    return def;
  if (
    def.nodes.some(
      (node) => blocks[node?.data?.kind] && node.type !== "flowBlock",
    )
  )
    def = {
      ...def,
      nodes: def.nodes.map((node) =>
        blocks[node?.data?.kind] && node.type !== "flowBlock"
          ? { ...node, type: "flowBlock" }
          : node,
      ),
    };
  const handlers = new Set(
    def.nodes.filter((n) => n?.data?.kind === "error").map((n) => n.id),
  );
  const retired = (e) => ["default", "error"].includes(e?.sourceHandle);
  if (!handlers.size && !def.edges.some(retired)) return def;
  const reachable = (edges) => {
    const links = new Map();
    for (const edge of edges) {
      if (!links.has(edge.source)) links.set(edge.source, []);
      links.get(edge.source).push(edge.target);
    }
    const pending = def.nodes
      .filter((n) => ["start", "trigger"].includes(n?.data?.kind))
      .map((n) => n.id);
    const seen = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(links.get(id) || []));
    }
    return seen;
  };
  const before = reachable(def.edges);
  let edges = def.edges
    .filter((e) => !retired(e) && !handlers.has(e.source))
    .map((edge) => {
      let target = edge.target;
      const seen = new Set();
      while (handlers.has(target)) {
        if (seen.has(target)) return null;
        seen.add(target);
        target = def.edges.find(
          (e) => e.source === target && (e.sourceHandle || "next") === "next",
        )?.target;
        if (!target) return null;
      }
      return target === edge.target ? edge : { ...edge, target };
    })
    .filter(Boolean);
  const after = reachable(edges);
  const nodes = def.nodes.filter(
    (n) => !handlers.has(n.id) && (!before.has(n.id) || after.has(n.id)),
  );
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { ...def, nodes, edges };
}
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
function safeKey(key) {
  return (
    typeof key === "string" &&
    /^[\p{L}\w.-]{1,100}$/u.test(key) &&
    key.split(".").every((k) => !unsafeKeys.has(k))
  );
}
function read(obj, key) {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((o, k) => (unsafeKeys.has(k) ? undefined : o?.[k]), obj);
}
function write(obj, key, value) {
  if (!safeKey(key)) throw new Error("Nome de variável inválido.");
  const parts = key.replace(/^fluxo\./, "").split(".");
  let target = obj;
  for (const part of parts.slice(0, -1)) {
    if (
      !target[part] ||
      typeof target[part] !== "object" ||
      Array.isArray(target[part])
    )
      target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}
function interpolate(value, vars) {
  return String(value ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
    const v = read(vars, key);
    return v == null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  });
}
function decodeVariable(value, type) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  return type === "text" && typeof parsed !== "string"
    ? String(value ?? "")
    : parsed;
}
function validVariableValue(type, value) {
  if (type === "text") return typeof value === "string";
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "date") {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      return false;
    const date = value.slice(0, 10);
    return new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
  }
  if (type === "json") {
    try {
      return JSON.stringify(value) !== undefined;
    } catch {
      return false;
    }
  }
  return false;
}
function parseVariableInput(value, type) {
  const raw = String(value ?? "");
  let parsed = raw;
  if (type === "number") parsed = raw.trim() ? Number(raw) : NaN;
  if (type === "boolean" || type === "json") parsed = JSON.parse(raw);
  if (!validVariableValue(type, parsed))
    throw new Error("O valor não corresponde ao tipo da variável.");
  return type === "date" ? new Date(parsed).toISOString() : parsed;
}
function validate(def, publish = false) {
  const errors = [],
    warnings = [];
  if (
    !def ||
    def.schemaVersion !== 1 ||
    !Array.isArray(def.nodes) ||
    !Array.isArray(def.edges)
  )
    return {
      errors: ["Formato de fluxo inválido (schemaVersion: 1)."],
      warnings,
    };
  if (
    JSON.stringify(def).length > 2000000 ||
    def.nodes.length > 1000 ||
    def.edges.length > 5000
  )
    return { errors: ["Limite de tamanho excedido."], warnings };
  if (
    !def.settings ||
    typeof def.settings !== "object" ||
    !Array.isArray(def.variables) ||
    !Array.isArray(def.triggers)
  )
    return {
      errors: ["Informe settings, variables e triggers no formato correto."],
      warnings,
    };
  const unsafe = (obj) =>
    obj &&
    typeof obj === "object" &&
    Object.entries(obj).some(
      ([key, value]) => unsafeKeys.has(key) || unsafe(value),
    );
  if (unsafe(def))
    return {
      errors: ["Chaves reservadas não são permitidas no JSON."],
      warnings,
    };
  if (
    def.variables.some(
      (v) =>
        !v ||
        !safeKey(v.key) ||
        v.key.includes(".") ||
        !["text", "number", "boolean", "date", "json"].includes(v.type) ||
        (v.default !== undefined && !validVariableValue(v.type, v.default)),
    ) ||
    new Set(def.variables.map((v) => v.key)).size !== def.variables.length
  )
    errors.push("Variáveis inválidas ou duplicadas.");
  if (
    def.triggers.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        ![
          "keyword",
          "message",
          "firstMessage",
          "newContact",
          "tagAdded",
          "system",
          "api",
          "integration",
        ].includes(t.type) ||
        (t.match && !["exact", "contains", "startsWith"].includes(t.match)) ||
        !Number.isFinite(Number(t.priority || 0)),
    ) ||
    new Set(def.triggers.map((t) => t.id)).size !== def.triggers.length
  )
    errors.push("Gatilhos inválidos ou repetidos.");
  if (
    publish &&
    def.triggers.some(
      (t) =>
        t.enabled !== false &&
        ["keyword", "tagAdded"].includes(t.type) &&
        !String(t.value || "").trim(),
    )
  )
    errors.push("Informe o valor de cada gatilho ativo.");
  if (
    def.settings.chipIds &&
    (!Array.isArray(def.settings.chipIds) ||
      def.settings.chipIds.some((id) => !/^\d+$/.test(String(id))))
  )
    errors.push("IDs de chips inválidos.");
  const ids = new Set(),
    edges = new Set(),
    ports = new Set();
  for (const n of def.nodes) {
    if (!n || typeof n !== "object") {
      errors.push("Bloco inválido.");
      continue;
    }
    if (typeof n.id !== "string" || ids.has(n.id))
      errors.push("Identificador de bloco inválido ou duplicado.");
    ids.add(n.id);
    const b = blocks[n.data?.kind],
      c = n.data?.config;
    if (
      !b ||
      !c ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y) ||
      Math.abs(n.position.x) > 1000000 ||
      Math.abs(n.position.y) > 1000000 ||
      (n.data.label != null && typeof n.data.label !== "string")
    ) {
      errors.push(`Bloco ${n.id}: estrutura inválida.`);
      continue;
    }
    if (typeof c !== "object" || Array.isArray(c)) {
      errors.push(`Bloco ${n.id}: configurações inválidas.`);
      continue;
    }
    for (const f of b.fields) {
      const value = c[f.key];
      if (
        f.type === "json" &&
        Array.isArray(f.value) &&
        !Array.isArray(value) &&
        !(f.key === "messages" && value == null)
      )
        errors.push(`Bloco ${n.id}: ${f.label} deve ser uma lista.`);
      if (
        f.key === "messages" &&
        Array.isArray(value) &&
        value.some((v) => typeof v !== "string")
      )
        errors.push(`Bloco ${n.id}: mensagens devem ser textos.`);
      if (f.type === "boolean" && value != null && typeof value !== "boolean")
        errors.push(`Bloco ${n.id}: ${f.label} deve ser booleano.`);
      if (
        f.type === "options" &&
        (!Array.isArray(value) ||
          value.some(
            (o) =>
              !o || typeof o.id !== "string" || typeof o.label !== "string",
          ))
      )
        errors.push(`Bloco ${n.id}: opções inválidas.`);
      if (
        ["text", "textarea", "code"].includes(f.type) &&
        value != null &&
        typeof value !== "string"
      )
        errors.push(`Bloco ${n.id}: ${f.label} deve ser texto.`);
      if (
        f.type === "number" &&
        value != null &&
        !Number.isFinite(Number(value))
      )
        errors.push(`Bloco ${n.id}: ${f.label} deve ser número.`);
    }
    for (const key of [
      "options",
      "rules",
      "paths",
      "outputs",
      "users",
      "add",
      "remove",
      "holidays",
      "choices",
    ])
      if (c[key] != null && !Array.isArray(c[key]))
        errors.push(`Bloco ${n.id}: ${key} deve ser uma lista.`);
    if (
      Array.isArray(c.rules) &&
      c.rules.some(
        (r) =>
          !r ||
          typeof r.variable !== "string" ||
          ![
            "eq",
            "ne",
            "contains",
            "notContains",
            "gt",
            "lt",
            "gte",
            "lte",
            "empty",
            "notEmpty",
          ].includes(r.operator),
      )
    )
      errors.push(`Bloco ${n.id}: regra inválida.`);
    for (const key of ["headers", "mapping", "schedule", "exceptions"])
      if (
        c[key] != null &&
        (typeof c[key] !== "object" || Array.isArray(c[key]) || c[key] === null)
      )
        errors.push(`Bloco ${n.id}: ${key} deve ser objeto JSON.`);
    if (
      Array.isArray(c.outputs) &&
      (c.outputs.some(
        (v) =>
          typeof v !== "string" ||
          !v ||
          ["error", "default", "next", "timeout"].includes(v),
      ) ||
        new Set(c.outputs).size !== c.outputs.length)
    )
      errors.push(`Bloco ${n.id}: saídas inválidas ou repetidas.`);
    if (
      Array.isArray(c.paths) &&
      (c.paths.some(
        (p) =>
          !p ||
          typeof p.id !== "string" ||
          !p.id ||
          ["default", "error"].includes(p.id),
      ) ||
        new Set(c.paths.map((p) => p?.id)).size !== c.paths.length)
    )
      errors.push(`Bloco ${n.id}: caminhos inválidos.`);
    if (!publish || errors.length) continue;
    const issue = (text) => errors.push(`${b.label} (${n.id}): ${text}`);
    if (
      b.type === "condition" &&
      (!c.rules.length || !["and", "or"].includes(c.join))
    )
      issue("configure as regras e a combinação and / or.");
    if (
      b.type === "question" &&
      !["text", "number", "date", "option"].includes(c.answerType)
    )
      issue("tipo de resposta inválido.");
    if (
      b.type === "set" &&
      !["text", "number", "boolean", "date", "json"].includes(c.valueType)
    )
      issue("tipo de variável inválido.");
    if (b.type === "set" && !String(c.value).includes("{{")) {
      try {
        parseVariableInput(c.value, c.valueType);
      } catch {
        issue("o valor não corresponde ao tipo da variável.");
      }
    }
    if (
      b.type === "delay" &&
      !c.until &&
      !["seconds", "minutes", "hours", "days"].includes(c.unit)
    )
      issue("unidade de tempo inválida.");
    if (
      b.type === "distribute" &&
      (!["roundRobin", "random", "leastBusy"].includes(c.strategy) ||
        !Number.isInteger(Number(c.capacity)) ||
        !(Number(c.capacity) > 0))
    )
      issue("estratégia ou capacidade inválida.");
    if (
      c.attempts != null &&
      (!Number.isInteger(Number(c.attempts)) ||
        Number(c.attempts) < 1 ||
        Number(c.attempts) > 10)
    )
      issue("configure de 1 a 10 tentativas.");
    if (
      Array.isArray(c.users) &&
      (c.users.length > 100 || c.users.some((id) => !/^\d+$/.test(String(id))))
    )
      issue("lista de atendentes inválida (máximo 100).");
    if (b.type === "hours") {
      const validRanges = (ranges) =>
        Array.isArray(ranges) &&
        ranges.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every(
              (t) =>
                typeof t === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t),
            ),
        );
      if (
        !c.schedule ||
        Object.entries(c.schedule).some(
          ([day, ranges]) => !/^[0-6]$/.test(day) || !validRanges(ranges),
        ) ||
        Object.entries(c.exceptions || {}).some(
          ([date, ranges]) =>
            !/^\d{4}-\d{2}-\d{2}$/.test(date) || !validRanges(ranges),
        )
      )
        issue('horários inválidos. Use pares ["08:00", "18:00"].');
    }
    if (
      ["text", "question", "menu", "buttons", "quickReply"].includes(b.type) &&
      !String(c.text || "").trim() &&
      !(b.type === "text" && c.messages?.length)
    )
      issue("informe a mensagem.");
    if (b.type === "text" && c.messages?.some((message) => !message.trim()))
      issue("mensagens sequenciais não podem estar vazias.");
    if (["image", "audio", "video", "document"].includes(b.type) && !c.assetId)
      issue("anexe um arquivo.");
    if (
      ["set", "question", "wait", "script", "switch"].includes(b.type) &&
      !safeKey(c.variable)
    )
      issue("nome de variável inválido.");
    if (["script", "switch"].includes(b.type) && !c.outputs?.length)
      issue("configure pelo menos uma saída.");
    if (
      b.type === "question" &&
      c.answerType === "option" &&
      (!c.choices?.length ||
        c.choices.some((v) => !String(v).trim()) ||
        new Set(c.choices.map((v) => String(v).trim())).size !==
          c.choices.length)
    )
      issue("configure as opções de resposta sem valores vazios ou repetidos.");
    if (b.type === "delay") {
      const factor = {
        seconds: 1000,
        minutes: 60000,
        hours: 3600000,
        days: 86400000,
      }[c.unit];
      if (
        (c.until &&
          !String(c.until).includes("{{") &&
          !Number.isFinite(Date.parse(c.until))) ||
        (!c.until && Number(c.duration) * factor > 30 * 86400000)
      )
        issue("data inválida ou duração superior a 30 dias.");
    }
    if (
      Array.isArray(c.options) &&
      (!c.options.length ||
        c.options.length > 50 ||
        c.options.some(
          (o) =>
            !o?.id ||
            !o?.label ||
            ["default", "timeout", "error", "next"].includes(o.id),
        ) ||
        new Set(c.options.map((o) => String(o?.id))).size !== c.options.length)
    )
      issue("opções inválidas ou repetidas.");
    if (Array.isArray(c.options)) {
      const selectors = new Map();
      for (const [index, option] of c.options.entries()) {
        for (const value of [option.id, option.label]) {
          const normalized = String(value || "")
            .trim()
            .toLocaleLowerCase("pt-BR");
          if (
            !normalized ||
            (selectors.has(normalized) && selectors.get(normalized) !== index)
          ) {
            issue(
              "opções ambíguas: identificadores e textos devem selecionar uma única opção.",
            );
          }
          selectors.set(normalized, index);
        }
      }
    }
    if (
      b.type === "random" &&
      (!c.paths?.length ||
        c.paths.some((p) => !(Number(p.weight) > 0)) ||
        Math.abs(c.paths.reduce((s, p) => s + Number(p.weight), 0) - 100) >
          0.001)
    )
      issue("probabilidades devem somar 100%.");
    if (
      b.type === "http" &&
      (!/^https:\/\//i.test(c.url || "") ||
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(c.method))
    )
      issue("informe URL HTTPS e método válido.");
    if (b.type === "script" && !c.code?.trim()) issue("informe o código.");
    if (
      b.type === "redirect" &&
      (!["flow", "department", "user", "team"].includes(c.target) ||
        (c.target !== "team" && !c.targetId))
    )
      issue("configure o destino.");
    if (b.type === "moveOpportunity" && !c.columnId)
      issue("selecione a etapa.");
    if (b.type === "delay" && !c.until && !(Number(c.duration) > 0))
      issue("duração deve ser positiva.");
    if (
      c.timeout != null &&
      (!(Number(c.timeout) > 0) || Number(c.timeout) > 2592000)
    )
      issue("timeout inválido.");
  }
  if (errors.length) return { errors: [...new Set(errors)], warnings };
  for (const e of def.edges) {
    const source = def.nodes.find((n) => n.id === e.source),
      target = def.nodes.find((n) => n.id === e.target),
      port = `${e.source}:${e.sourceHandle || "next"}`;
    if (
      !e.id ||
      edges.has(e.id) ||
      !source ||
      !target ||
      e.source === e.target ||
      ["start", "trigger"].includes(target?.data?.kind) ||
      !outputs(source || {}).includes(e.sourceHandle || "next") ||
      ports.has(port)
    )
      errors.push(
        `Conexão ${e.id || "?"} inválida, repetida ou saída já conectada.`,
      );
    edges.add(e.id);
    ports.add(port);
  }
  const starts = def.nodes.filter((n) =>
    ["start", "trigger"].includes(n.data?.kind),
  );
  if (starts.length !== 1)
    errors.push("O fluxo deve possuir exatamente um início.");
  const seen = new Set(),
    visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      warnings.push(
        "Ciclo detectado: a execução tem limite de 500 transições.",
      );
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    visiting.add(id);
    def.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
    visiting.delete(id);
  }
  if (starts[0]) visit(starts[0].id);
  def.nodes
    .filter((n) => !seen.has(n.id))
    .forEach((n) =>
      warnings.push(`Bloco desconectado: ${n.data?.label || n.id}.`),
    );
  if (publish) {
    for (const n of def.nodes.filter((n) => seen.has(n.id))) {
      const c = n.data.config,
        kind = n.data.kind;
      let required = ["finish", "stop"].includes(kind)
        ? []
        : ["condition", "chipCondition", "tagCondition", "hours"].includes(kind)
          ? ["true", "false"]
          : ["menu", "buttons", "quickReply"].includes(kind)
            ? [...(c.options || []).map((o) => String(o.id)), "timeout"]
            : ["script", "switch"].includes(kind)
              ? [...(c.outputs || [])]
              : kind === "random"
                ? (c.paths || []).map((p) => p.id)
                : kind === "question" || kind === "wait"
                  ? ["next", "timeout"]
                  : kind === "redirect" && c.target === "flow"
                    ? []
                    : ["next"];
      required.forEach((p) => {
        if (!ports.has(`${n.id}:${p}`))
          errors.push(
            `${n.data.label || blocks[kind]?.label}: conecte a saída ${p}.`,
          );
      });
    }
    if (warnings.some((w) => w.startsWith("Bloco desconectado")))
      errors.push(
        "Remova ou conecte os blocos desconectados antes de publicar.",
      );
  }
  try {
    new Intl.DateTimeFormat("en", {
      timeZone: def.settings?.timezone || "America/Sao_Paulo",
    }).format();
  } catch {
    errors.push("Fuso horário inválido.");
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
function empty() {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "flowBlock",
        position: { x: 100, y: 220 },
        data: { kind: "start", label: "Início", config: {} },
      },
    ],
    edges: [],
    variables: [],
    triggers: [
      { id: "incoming-message", type: "message", enabled: true, priority: 0 },
    ],
    settings: { timezone: "America/Sao_Paulo", autosave: false },
  };
}
function fromLegacy(nodes = [], edges = [], keywords = []) {
  const def = empty();
  if (nodes.length || edges.length)
    def.legacy = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
  if (nodes.length) {
    def.legacy = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    def.nodes = nodes.map((node, index) => {
      const kind = blocks[node.data?.kind]
        ? node.data.kind
        : blocks[node.type]
          ? node.type
          : node.type === "message"
            ? "text"
            : "legacy";
      const config = {
        ...(blocks[kind] ? defaults(kind) : {}),
        ...(node.config || {}),
        ...(node.data?.config || {}),
      };
      if (config.text == null || config.text === "")
        config.text = node.text ?? node.data?.text ?? config.text ?? "";
      return {
        ...node,
        id: String(node.id ?? `legacy-node-${index}`),
        type: "flowBlock",
        position: {
          x: Number(node.position?.x ?? node.x ?? index * 330),
          y: Number(node.position?.y ?? node.y ?? 100),
        },
        data: {
          ...node.data,
          kind,
          label:
            typeof node.data?.label === "string"
              ? node.data.label
              : blocks[kind]?.label || "Bloco legado — revisar",
          config,
        },
      };
    });
  }
  def.edges = edges.map((edge, index) => ({
    ...edge,
    id: String(edge.id ?? `legacy-edge-${index}`),
    source: String(edge.source),
    target: String(edge.target),
    sourceHandle: edge.sourceHandle || "next",
    type: "default",
  }));
  def.triggers = keywords.map((value, index) => ({
    id: `legacy-keyword-${index}`,
    type: "keyword",
    value: String(value),
    match: "exact",
    priority: 0,
    enabled: true,
  }));
  return def;
}
module.exports = {
  decodeVariable,
  validVariableValue,
  parseVariableInput,
  normalizeDefinition,
  blocks,
  defaults,
  outputs,
  validate,
  empty,
  fromLegacy,
  read,
  write,
  interpolate,
  safeKey,
};
