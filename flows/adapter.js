const fs = require("node:fs/promises");
const path = require("node:path");
const db = require("../db");
const rbac = require("../rbac");
const store = require("../store");
const flowStore = require("./store");
const { safeRequest, script } = require("./security");
const effectPermission = {
  send: "atendimento.responder",
  tags: "atendimento.tags",
  redirect: "atendimento.transferir",
  distribute: "atendimento.atribuir",
  finish: "atendimento.finalizar",
  moveOpportunity: "funis.editar",
};
async function allowedResource(access, table, id) {
  const row = await db.get(
    `SELECT * FROM ${table} WHERE id = ? AND account_id = ?`,
    [id, access.accountId],
  );
  if (!row || !rbac.recordAllowed(access, row, table))
    rbac.fail("Destino inexistente ou fora do escopo autorizado.", 403);
  return row;
}
async function validateReferences(def, access) {
  for (const n of def.nodes) {
    const c = n.data.config,
      kind = n.data.kind;
    if (kind === "script")
      await script(c.code, {}, Date.now(), def.settings.timezone, true);
    const type = [
      "text",
      "image",
      "audio",
      "video",
      "document",
      "menu",
      "buttons",
      "quickReply",
      "question",
    ].includes(kind)
      ? "send"
      : kind === "tags" || (kind === "finish" && c.tag)
        ? "tags"
        : kind;
    if (effectPermission[type] && !rbac.can(access, effectPermission[type]))
      rbac.fail(`Sem permissão para executar ${n.data.label || kind}.`);
    if (kind === "finish" && !rbac.can(access, "atendimento.finalizar"))
      rbac.fail();
    if (["image", "audio", "video", "document"].includes(kind)) {
      const asset = await db.get(
        "SELECT * FROM flow_assets WHERE id = ? AND account_id = ?",
        [c.assetId, access.accountId],
      );
      if (
        !asset ||
        asset.kind !== kind ||
        (!access.owner && asset.created_by !== access.user.id)
      )
        rbac.fail("Arquivo ausente ou não autorizado.", 400);
    }
    if (
      kind === "http" &&
      Object.keys(c.headers || {}).some((k) =>
        /authorization|cookie|token|secret|api.key/i.test(k),
      )
    )
      rbac.fail("Guarde credenciais no servidor e use secretName.", 400);
    if (
      kind === "http" &&
      c.secretName &&
      !c.secretName.startsWith(`FLOW_SECRET_${access.accountId}_`)
    )
      rbac.fail(
        `Use uma credencial com prefixo FLOW_SECRET_${access.accountId}_.`,
        400,
      );
    if (kind === "redirect" && c.target !== "team") {
      if (c.target === "user") await allowedUser(access, c.targetId);
      else
        await allowedResource(
          access,
          c.target === "flow" ? "flows" : "departments",
          c.targetId,
        );
    }
    if (
      kind === "redirect" &&
      c.target === "flow" &&
      !rbac.can(access, "fluxos.visualizar")
    )
      rbac.fail();
    if (kind === "moveOpportunity")
      await allowedResource(access, "kanban_columns", c.columnId);
    if (c.departmentId)
      await allowedResource(access, "departments", c.departmentId);
    for (const id of c.users || []) await allowedUser(access, id);
    if (c.create && !access.owner)
      rbac.fail(
        "Somente o proprietário pode autorizar criação automática de tags.",
      );
    if (
      kind === "tags" ||
      kind === "tagCondition" ||
      (kind === "finish" && c.tag)
    ) {
      const names = kind === "tags" ? [...c.add, ...c.remove] : [c.tag];
      for (const name of names) {
        if (/\{\{/.test(name))
          rbac.fail(
            "Selecione tags fixas para permitir a verificação de acesso.",
            400,
          );
        const tag = await db.get(
          "SELECT * FROM tags WHERE name = ? AND account_id = ?",
          [name, access.accountId],
        );
        if (
          tag
            ? !rbac.recordAllowed(access, tag, "tags")
            : !(c.create && access.owner)
        )
          rbac.fail(`Tag não autorizada: ${name}.`, 400);
      }
    }
  }
}
async function allowedUser(access, id) {
  const member = await db.get(
    "SELECT * FROM users WHERE id = ? AND account_id = ? AND status = 'active' AND deleted_at IS NULL",
    [id, access.accountId],
  );
  if (!member || (!access.owner && !rbac.withinMember(access, member)))
    rbac.fail("Atendente não disponível no escopo autorizado.");
  const target = await rbac.accessFor(member.id);
  if (!rbac.can(target, "atendimento.responder"))
    rbac.fail("Atendente sem permissão de atendimento.");
  return member;
}
function createLiveAdapter({
  run,
  state,
  chip,
  access,
  requestChip,
  broadcast,
  guard = async () => {},
}) {
  const request = async (action, payload = {}) => {
    const result = await requestChip(
      chip,
      action,
      {
        ...payload,
        number: run.contact,
        ...(action === "flow-send" || action === "flow-send-media"
          ? { runId: run.id }
          : {}),
      },
      15000,
    );
    if (result?.conversation) {
      const { number, departmentId, assignedUserId, isFinalized, finalizedAt } =
        result.conversation;
      state.vars.atendimento = {
        ...state.vars.atendimento,
        number,
        departmentId,
        assignedUserId,
        isFinalized,
        finalizedAt,
      };
      await broadcast(run.account_id, "message", {
        ...result.conversation,
        chipId: chip.id,
      });
    }
    return result;
  };
  async function distribute(c) {
    const candidates = c.users?.length
      ? c.users
      : (
          await db.all(
            "SELECT id FROM users WHERE account_id = ? AND status = 'active' AND deleted_at IS NULL AND role <> ?",
            [access.accountId, rbac.roles.owner],
          )
        ).map((u) => u.id);
    const eligible = [];
    const allChips = await db.all("SELECT * FROM chips WHERE user_id = ?", [
      access.accountId,
    ]);
    const snapshots = await Promise.all(
      allChips.map((channel) =>
        requestChip(channel, "state", { metadataOnly: true }, 10000),
      ),
    );
    const conversations = snapshots.flatMap((snapshot) =>
      Object.values(snapshot.conversations || {}),
    );
    for (const id of candidates) {
      let member;
      try {
        member = await allowedUser(access, id);
      } catch {
        continue;
      }
      const target = await rbac.accessFor(member.id);
      if (
        !rbac.departmentAllowed(
          target,
          c.departmentId ||
            state.vars.atendimento.departmentId ||
            chip.department_id,
        )
      )
        continue;
      const count = conversations.filter(
        (v) => !v.isFinalized && Number(v.assignedUserId) === member.id,
      ).length;
      if (count < Number(c.capacity || 20)) eligible.push({ member, count });
    }
    if (!eligible.length)
      throw new Error("Nenhum atendente ativo com capacidade disponível.");
    let selected;
    if (c.strategy === "leastBusy")
      selected = eligible.sort(
        (a, b) => a.count - b.count || a.member.id - b.member.id,
      )[0];
    else if (c.strategy === "random")
      selected = eligible[Math.floor(Math.random() * eligible.length)];
    else {
      const key = `${access.accountId}:${run.flow_id}:${state.current}`;
      const index = await db.transaction(async () => {
        await db.run(
          "INSERT INTO flow_counters(id,value) VALUES (?,0) ON CONFLICT(id) DO NOTHING",
          [key],
        );
        const row = await db.get(
          "SELECT value FROM flow_counters WHERE id = ?",
          [key],
        );
        await db.run(
          "UPDATE flow_counters SET value = value + 1 WHERE id = ?",
          [key],
        );
        return row.value;
      });
      selected = eligible[index % eligible.length];
    }
    if (c.departmentId)
      await request("set-conversation-department", {
        departmentId: c.departmentId,
      });
    return request("assign-conversation", { userId: selected.member.id });
  }
  return {
    random: Math.random,
    flow: async (id) => {
      const flow = await allowedResource(access, "flows", id);
      if (!flow.active || !flow.published_version) return null;
      const version = await db.get(
        "SELECT * FROM flow_versions WHERE flow_id = ? AND account_id = ? AND version = ?",
        [id, access.accountId, flow.published_version],
      );
      return {
        id,
        version: version.version,
        definition: require("./schema").normalizeDefinition(
          JSON.parse(version.definition),
        ),
      };
    },
    effect: async (type, payload, suffix) => {
      await guard();
      if (effectPermission[type] && !rbac.can(access, effectPermission[type]))
        rbac.fail("Permissão de automação revogada.");
      // Reserve before calling an external system. An uncertain delivery is never blindly retried.
      const id = `${run.id}:${suffix}`;
      const old = await db.get("SELECT * FROM flow_effects WHERE id = ?", [id]);
      if (old?.status === "done") return flowStore.parse(old.result, null);
      if (old)
        throw Object.assign(
          new Error(
            "Efeito com resultado incerto. Verifique o atendimento antes de continuar.",
          ),
          { uncertain: true },
        );
      await db.run(
        "INSERT INTO flow_effects(id,run_id,status,created_at) VALUES (?,?,'pending',?)",
        [id, run.id, new Date().toISOString()],
      );
      let result;
      try {
        switch (type) {
          case "send": {
            if (!payload.kind)
              result = await request("flow-send", { text: payload.text });
            else {
              const asset = await db.get(
                "SELECT * FROM flow_assets WHERE id = ? AND account_id = ?",
                [payload.assetId, access.accountId],
              );
              if (!asset || asset.kind !== payload.kind)
                throw new Error("Arquivo não encontrado.");
              const buffer = await fs.readFile(
                path.join(
                  db.STORAGE_DIR,
                  "flow-assets",
                  String(access.accountId),
                  asset.id,
                ),
              );
              await db.run(
                "INSERT INTO flow_asset_deliveries(id,account_id,asset_id,chip_id,contact) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                [
                  `${asset.id}:${chip.id}:${run.contact}`,
                  access.accountId,
                  asset.id,
                  chip.id,
                  run.contact,
                ],
              );
              result = await request("flow-send-media", {
                media: {
                  type: payload.kind,
                  mimeType: asset.mime_type,
                  fileName: payload.fileName || asset.file_name,
                  caption: payload.text,
                  buffer: buffer.toString("base64"),
                  mediaUrl: `/api/flows-assets/${asset.id}`,
                },
              });
            }
            break;
          }
          case "http":
            if (
              payload.secretName &&
              !payload.secretName.startsWith(`FLOW_SECRET_${access.accountId}_`)
            )
              throw new Error("Credencial fora do escopo desta conta.");
            result = await safeRequest(payload);
            break;
          case "stop":
            result = await request("flow-stop-conversation");
            break;
          case "tags": {
            for (const name of payload.tags) {
              let tag = await db.get(
                "SELECT * FROM tags WHERE name = ? AND account_id = ?",
                [name, access.accountId],
              );
              if (!tag && payload.create && access.owner)
                tag = await store.createTag(name, "#30c58d");
              if (!tag || !rbac.recordAllowed(access, tag, "tags"))
                throw new Error(`Tag não autorizada: ${name}.`);
            }
            await request("set-contact-tags", { tags: payload.tags });
            result = await request("set-conversation-tags", {
              tags: payload.tags,
            });
            break;
          }
          case "finish":
            result = await request("finalize-conversation");
            break;
          case "redirect":
            if (payload.target === "department") {
              await allowedResource(access, "departments", payload.targetId);
              result = await request("set-conversation-department", {
                departmentId: payload.targetId,
              });
              await request("assign-conversation", { userId: null });
            } else if (payload.target === "user") {
              await allowedUser(access, payload.targetId);
              result = await request("assign-conversation", {
                userId: payload.targetId,
              });
            } else
              result = await distribute({ ...payload, strategy: "leastBusy" });
            break;
          case "distribute":
            result = await distribute(payload);
            break;
          case "moveOpportunity": {
            await allowedResource(access, "kanban_columns", payload.columnId);
            const opportunities = await db.all(
              "SELECT * FROM opportunities WHERE account_id = ? AND contact_number = ? AND status = 'open'",
              [access.accountId, run.contact],
            );
            if (!opportunities.length)
              throw new Error("Contato sem oportunidade aberta.");
            for (const item of opportunities) {
              if (!rbac.recordAllowed(access, item, "opportunities"))
                rbac.fail();
              await store.updateOpportunity(item.id, {
                ...item,
                column_id: payload.columnId,
              });
            }
            result = { moved: opportunities.length };
            break;
          }
          default:
            throw new Error("Efeito desconhecido.");
        }
      } catch (error) {
        if (
          type === "send" &&
          ["WHATSAPP_NOT_READY", "FLOW_STOPPED"].includes(error.code) &&
          error.deliveryAttempted === false
        ) {
          // No transmission started. Release the reservation so the service
          // can defer an unready channel or stop a cancelled automation.
          await db.run(
            "DELETE FROM flow_effects WHERE id = ? AND status = 'pending'",
            [id],
          );
          throw error;
        }
        // IPC/network errors can happen after a remote send succeeded.
        if (type === "send") error.uncertain = true;
        await db.run(
          "UPDATE flow_effects SET status = ?, result = ? WHERE id = ?",
          [
            error.uncertain ? "uncertain" : "failed",
            JSON.stringify({ error: "Falha na operação externa." }),
            id,
          ],
        );
        throw error;
      }
      // Keep transport results out of execution/audit payloads (raw messages may contain secrets).
      const stored = type === "http" ? result : { ok: true };
      await db.run(
        "UPDATE flow_effects SET status = 'done', result = ? WHERE id = ?",
        [JSON.stringify(stored), id],
      );
      return stored;
    },
  };
}
module.exports = {
  createLiveAdapter,
  validateReferences,
  allowedResource,
  effectPermission,
};
