const crypto = require("node:crypto");
const db = require("../db");
const { accountId, actorId, departmentId } = require("../account-context");
const schema = require("./schema");
const parse = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
function decode(row) {
  if (!row) return null;
  const stored = parse(row.definition, {});
  const definition = schema.normalizeDefinition(
    stored.schemaVersion === 1
      ? stored
      : schema.fromLegacy(
          parse(row.nodes, []),
          parse(row.edges, []),
          parse(row.trigger_keywords, []),
        ),
  );
  definition.settings.chipIds ??= parse(row.trigger_chips, []);
  const published = schema.normalizeDefinition(
    parse(row.published_definition, null),
  );
  if (published) published.settings.chipIds ??= parse(row.trigger_chips, []);
  const triggers = (published?.triggers || []).filter(
    (t) => t.enabled !== false,
  );
  const automation = {
    status: !published
      ? "draft"
      : !row.active
        ? "paused"
        : !row.triggers_enabled
          ? "disabled"
          : !triggers.length
            ? "manual"
            : "ready",
    triggers,
    unpublishedChanges:
      !!published && JSON.stringify(definition) !== JSON.stringify(published),
  };
  return {
    ...row,
    definition,
    published_definition: published,
    automation,
    nodes: definition.nodes,
    edges: definition.edges,
    trigger_keywords: parse(row.trigger_keywords, []),
    trigger_chips: parse(row.trigger_chips, []),
  };
}
const publishedQuery =
  "SELECT flows.*, published.definition AS published_definition FROM flows LEFT JOIN flow_versions published ON published.flow_id = flows.id AND published.account_id = flows.account_id AND published.version = flows.published_version";
const get = async (id) =>
  decode(
    await db.get(
      `${publishedQuery} WHERE flows.id = ? AND flows.account_id = ?`,
      [id, accountId()],
    ),
  );
const list = async () =>
  (
    await db.all(
      `${publishedQuery} WHERE flows.account_id = ? ORDER BY flows.updated_at DESC`,
      [accountId()],
    )
  ).map(decode);
function assertDefinition(def, publish = false) {
  let result;
  try {
    result = schema.validate(def, publish);
  } catch {
    throw Object.assign(
      new Error("Estrutura de blocos ou configurações inválida."),
      { statusCode: 400 },
    );
  }
  if (result.errors.length)
    throw Object.assign(new Error(result.errors.join("\n")), {
      statusCode: 400,
      validation: result,
    });
  return result;
}
function definitionFor(data, fallback) {
  const definition = schema.normalizeDefinition(
    data.definition ||
      fallback ||
      (data.nodes || data.edges || data.trigger_keywords
        ? schema.fromLegacy(
            data.nodes || [],
            data.edges || [],
            data.trigger_keywords || [],
          )
        : schema.empty()),
  );
  if (!definition?.settings) return definition;
  return {
    ...definition,
    settings: {
      ...definition.settings,
      chipIds: data.trigger_chips ?? definition.settings.chipIds ?? [],
    },
  };
}
async function create(data) {
  const definition = definitionFor(data);
  assertDefinition(definition);
  const name = String(data.name || "").trim();
  if (!name || name.length > 120)
    throw Object.assign(new Error("Informe um nome de até 120 caracteres."), {
      statusCode: 400,
    });
  const now = new Date().toISOString();
  const row = await db.run(
    "INSERT INTO flows(name,description,nodes,edges,active,trigger_keywords,trigger_chips,created_at,updated_at,account_id,created_by,department_id,definition,revision) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,1)",
    [
      name,
      String(data.description || "").slice(0, 2000),
      JSON.stringify(definition.nodes),
      JSON.stringify(definition.edges),
      "[]",
      JSON.stringify(definition.settings.chipIds),
      now,
      now,
      accountId(),
      actorId(),
      departmentId(),
      JSON.stringify(definition),
    ],
  );
  await db.run(
    "INSERT INTO flow_revisions(account_id,flow_id,revision,name,definition,created_by,created_at) VALUES (?,?,1,?,?,?,?)",
    [accountId(), row.lastID, name, JSON.stringify(definition), actorId(), now],
  );
  return get(row.lastID);
}
async function update(id, data) {
  return db.transaction(async () => {
    const old = await get(id);
    if (!old)
      throw Object.assign(new Error("Fluxo não encontrado."), {
        statusCode: 404,
      });
    if (data.revision == null || Number(data.revision) !== old.revision)
      throw Object.assign(
        new Error(
          "Este fluxo foi alterado em outra aba. Reabra antes de salvar.",
        ),
        { statusCode: 409 },
      );
    const def = definitionFor(data, old.definition);
    assertDefinition(def);
    const name = String(data.name ?? old.name).trim();
    if (!name || name.length > 120)
      throw Object.assign(new Error("Nome inválido."), { statusCode: 400 });
    if (data.active && !old.published_version)
      throw Object.assign(new Error("Publique uma versão antes de ativar."), {
        statusCode: 400,
      });
    const changed = await db.run(
      "UPDATE flows SET name = ?, description = ?, definition = ?, nodes = ?, edges = ?, active = ?, triggers_enabled = ?, trigger_chips = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND account_id = ? AND revision = ?",
      [
        name,
        String(data.description ?? old.description).slice(0, 2000),
        JSON.stringify(def),
        JSON.stringify(def.nodes),
        JSON.stringify(def.edges),
        data.active == null ? old.active : Number(!!data.active),
        data.triggers_enabled == null
          ? old.triggers_enabled
          : Number(!!data.triggers_enabled),
        JSON.stringify(def.settings.chipIds),
        new Date().toISOString(),
        id,
        accountId(),
        old.revision,
      ],
    );
    if (!changed.changes)
      throw Object.assign(new Error("Conflito de versão. Reabra o fluxo."), {
        statusCode: 409,
      });
    await db.run(
      "INSERT INTO flow_revisions(account_id,flow_id,revision,name,definition,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        accountId(),
        id,
        old.revision + 1,
        name,
        JSON.stringify(def),
        actorId(),
        new Date().toISOString(),
      ],
    );
    return get(id);
  });
}
async function publish(id, revision) {
  return db.transaction(async () => {
    const flow = await get(id);
    if (flow.revision !== Number(revision))
      throw Object.assign(
        new Error("Salve a revisão atual antes de publicar."),
        { statusCode: 409 },
      );
    assertDefinition(flow.definition, true);
    const version = flow.revision;
    await db.run(
      "INSERT INTO flow_versions(account_id,flow_id,version,definition,created_by,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(flow_id,version) DO NOTHING",
      [
        accountId(),
        id,
        version,
        JSON.stringify(flow.definition),
        actorId(),
        new Date().toISOString(),
      ],
    );
    await db.run(
      "UPDATE flows SET published_version = ?, active = 1 WHERE id = ? AND account_id = ?",
      [version, id, accountId()],
    );
    return get(id);
  });
}
function remap(def) {
  const result = JSON.parse(JSON.stringify(schema.normalizeDefinition(def))),
    map = new Map(result.nodes.map((n) => [n.id, crypto.randomUUID()]));
  result.nodes.forEach((n) => {
    n.id = map.get(n.id);
    delete n.selected;
    delete n.measured;
  });
  result.edges.forEach((e) => {
    e.id = crypto.randomUUID();
    e.source = map.get(e.source);
    e.target = map.get(e.target);
    delete e.selected;
  });
  return result;
}
async function remove(id) {
  if (
    await db.get(
      "SELECT id FROM flow_runs WHERE flow_id = ? AND account_id = ? AND mode = 'live' AND status IN ('ready','running','waiting','sleeping','attention')",
      [id, accountId()],
    )
  )
    throw Object.assign(
      new Error("Há execuções abertas. Encerre-as antes de excluir."),
      { statusCode: 409 },
    );
  await db.run("DELETE FROM flows WHERE id = ? AND account_id = ?", [
    id,
    accountId(),
  ]);
}
module.exports = {
  definitionFor,
  get,
  list,
  create,
  update,
  publish,
  remap,
  remove,
  assertDefinition,
  parse,
  decode,
};
