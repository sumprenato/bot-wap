const crypto = require("node:crypto");
const db = require("../db");
const rbac = require("../rbac");
const { withAccount } = require("../account-context");
const {
  createState,
  executeNode,
  advance,
  simulatorAdapter,
} = require("./engine");
const { createLiveAdapter, allowedResource } = require("./adapter");
const { parse } = require("./store");
const { normalizeDefinition, decodeVariable } = require("./schema");
const nowISO = () => new Date().toISOString();
const { triggerMatch } = require("./triggers");
const { conversationStopReason, stopped } = require("./control");
class FlowService {
  constructor({ requestChip, broadcast = async () => {} }) {
    this.requestChip = requestChip;
    this.broadcast = broadcast;
    this.timer = null;
    this.ticking = null;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.tick().catch((e) => console.error("[FLOWS]", e.message)),
      1000,
    );
    this.timer.unref();
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }
  async enqueue(accountId, chipId, event) {
    if (!event.id || !/^\d+$/.test(String(event.number)))
      throw new Error("Evento de fluxo inválido.");
    const chip = await db.get(
      "SELECT id FROM chips WHERE id = ? AND user_id = ?",
      [chipId, accountId],
    );
    if (!chip) throw new Error("Chip não pertence à conta.");
    const id = `${accountId}:${chipId}:${event.id}`;
    await db.transaction(async () => {
      await db.run(
        "INSERT INTO flow_counters(id,value) VALUES ('inbox',0) ON CONFLICT(id) DO NOTHING",
      );
      await db.run(
        "UPDATE flow_counters SET value = value + 1 WHERE id = 'inbox'",
      );
      const order = await db.get(
        "SELECT value FROM flow_counters WHERE id = 'inbox'",
      );
      await db.run(
        "INSERT INTO flow_inbox(id,account_id,chip_id,contact,payload,status,created_at,received_order) VALUES (?,?,?,?,?,'pending',?,?) ON CONFLICT(id) DO NOTHING",
        [
          id,
          accountId,
          chipId,
          event.number,
          JSON.stringify(event),
          nowISO(),
          order.value,
        ],
      );
    });
    return id;
  }
  async persist(run, state, lease = null) {
    if (!["ready", "waiting", "sleeping"].includes(state.status)) {
      delete state.retryAt;
      state.wakeAt = null;
      delete state.pendingInput;
    }
    await db.run(
      "UPDATE flow_runs SET state = ?, status = ?, wake_at = ?, lease_until = ?, updated_at = ? WHERE id = ? AND account_id = ?",
      [
        JSON.stringify(state),
        lease ? "running" : state.retryAt ? "ready" : state.status,
        state.retryAt || state.wakeAt
          ? new Date(state.retryAt || state.wakeAt).toISOString()
          : null,
        lease,
        nowISO(),
        run.id,
        run.account_id,
      ],
    );
  }
  async log(run, entry) {
    await db.run(
      "INSERT INTO flow_logs(account_id,run_id,node_id,edge_id,port,detail,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        run.account_id,
        run.id,
        entry.node?.id || null,
        entry.edge?.id || null,
        entry.port || null,
        String(entry.detail || "").slice(0, 1000),
        nowISO(),
      ],
    );
  }
  async assertActive(run, state) {
    for (const id of new Set(
      [run.flow_id, state.redirectFlowId].filter(Boolean),
    )) {
      const flow = await db.get(
        "SELECT active,triggers_enabled,published_version FROM flows WHERE id = ? AND account_id = ?",
        [id, run.account_id],
      );
      if (
        !flow ||
        !flow.active ||
        !flow.triggers_enabled ||
        !flow.published_version
      )
        throw stopped("Fluxo pausado, desligado ou indisponível.");
    }
  }
  async authorizeSend(accountId, chipId, runId, contact) {
    const run = await db.get(
      "SELECT * FROM flow_runs WHERE id = ? AND account_id = ? AND chip_id = ? AND contact = ? AND mode = 'live'",
      [runId, accountId, chipId, contact],
    );
    if (!run || run.status !== "running") throw stopped("Execução encerrada.");
    await this.assertActive(run, JSON.parse(run.state));
  }
  async stopDisabledRuns(accountId, flowId) {
    const runs = await db.all(
      "SELECT * FROM flow_runs WHERE account_id = ? AND mode = 'live' AND status IN ('ready','waiting','sleeping','attention')",
      [accountId],
    );
    for (const run of runs) {
      const state = JSON.parse(run.state);
      if (
        Number(run.flow_id) !== Number(flowId) &&
        Number(state.redirectFlowId) !== Number(flowId)
      )
        continue;
      await this.stopIdleRun(run, "Fluxo pausado ou desligado.");
    }
  }
  async stopConversationRuns(accountId, chipId, contact) {
    const runs = await db.all(
      "SELECT * FROM flow_runs WHERE account_id = ? AND chip_id = ? AND contact = ? AND mode = 'live' AND status IN ('ready','waiting','sleeping','attention')",
      [accountId, chipId, contact],
    );
    for (const run of runs) {
      await this.stopIdleRun(run, "Atendimento assumido por um atendente.");
    }
  }
  async stopIdleRun(run, reason) {
    const state = JSON.parse(run.state);
    state.status = "stopped";
    state.stopReason = reason;
    delete state.retryAt;
    delete state.pendingInput;
    state.wakeAt = null;
    const changed = await db.run(
      "UPDATE flow_runs SET state = ?, status = 'stopped', wake_at = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND account_id = ? AND status IN ('ready','waiting','sleeping','attention')",
      [JSON.stringify(state), nowISO(), run.id, run.account_id],
    );
    if (changed.changes) await this.log(run, { detail: reason });
  }
  async run(id, input, eventId) {
    const lease = new Date(Date.now() + 120000).toISOString();
    const claimed = await db.run(
      "UPDATE flow_runs SET status = 'running', lease_until = ? WHERE id = ? AND status IN ('ready','waiting','sleeping') AND (lease_until IS NULL OR lease_until < ?)",
      [lease, id, nowISO()],
    );
    if (!claimed.changes) return null;
    const row = await db.get("SELECT * FROM flow_runs WHERE id = ?", [id]),
      state = JSON.parse(row.state);
    state.definition = normalizeDefinition(state.definition);
    if (eventId) {
      state.processedEvents = [...(state.processedEvents || []), eventId].slice(
        -1000,
      );
      state.pendingInput = input;
      await db.transaction(async () => {
        await this.persist(row, state, lease);
        await db.run("UPDATE flow_inbox SET run_id = ? WHERE id = ?", [
          row.id,
          eventId,
        ]);
      });
    }
    input = input || state.pendingInput;
    return withAccount(
      row.account_id,
      async () => {
        let checkpoint = null;
        try {
          if (!state.definition.nodes.some((n) => n.id === state.current)) {
            state.status = "stopped";
            state.wakeAt = null;
            await this.persist(row, state);
            return state;
          }
          let adapter;
          if (row.mode === "simulation") {
            adapter = simulatorAdapter(state);
            adapter.flow = async (target) => {
              const access = await rbac.accessFor(row.actor_id);
              const flow = await allowedResource(access, "flows", target);
              const version = await db.get(
                "SELECT * FROM flow_versions WHERE flow_id = ? AND account_id = ? AND version = ?",
                [target, row.account_id, flow.published_version],
              );
              return version
                ? {
                    id: target,
                    version: version.version,
                    definition: normalizeDefinition(
                      JSON.parse(version.definition),
                    ),
                  }
                : null;
            };
          } else {
            await this.assertActive(row, state);
            const chip = await db.get(
              "SELECT * FROM chips WHERE id = ? AND user_id = ?",
              [row.chip_id, row.account_id],
            );
            const access = await rbac.accessFor(row.actor_id);
            if (
              !chip ||
              !access ||
              access.accountId !== row.account_id ||
              !rbac.can(access, "fluxos.editar") ||
              !rbac.departmentAllowed(access, chip.department_id)
            )
              throw new Error("Chip ou autorização de execução indisponível.");
            await allowedResource(access, "flows", row.flow_id);
            if (state.redirectFlowId && state.redirectFlowId !== row.flow_id)
              await allowedResource(access, "flows", state.redirectFlowId);
            const current = await this.requestChip(chip, "flow-context", {
              number: row.contact,
            });
            const reason = conversationStopReason(current);
            if (reason) throw stopped(reason);
            if (!current.connected || current.readyToSend === false) {
              if (!state.retryAt)
                await this.log(row, {
                  detail: current.connected
                    ? "Aguardando sincronização e verificação dos contatos do WhatsApp."
                    : "Aguardando reconexão do WhatsApp.",
                });
              state.retryAt = Date.now() + 5000;
              if (input) state.pendingInput = input;
              await this.persist(row, state);
              return state;
            }
            delete state.retryAt;
            const conversationAccess = {
              ...access,
              permissions: [
                ...access.permissions,
                "atendimento.visualizar_todos",
              ],
            };
            if (
              !rbac.conversationAllowed(
                conversationAccess,
                current.conversation,
                chip,
              )
            )
              throw new Error(
                "Atendimento fora do escopo atual do responsável pelo fluxo.",
              );
            state.vars.chip = {
              id: chip.id,
              number: chip.number,
              connected: current.connected,
            };
            state.vars.contato.tags = current.tags || [];
            adapter = createLiveAdapter({
              run: row,
              state,
              chip,
              access,
              requestChip: this.requestChip,
              broadcast: this.broadcast,
              guard: async () => {
                await this.assertActive(row, state);
                const current = await this.requestChip(chip, "flow-context", {
                  number: row.contact,
                });
                const reason = conversationStopReason(current);
                if (reason) throw stopped(reason);
              },
            });
          }
          state.now = row.mode === "simulation" ? state.now : Date.now();
          if (row.mode === "simulation" && input?.timeout && state.wakeAt)
            state.now = Math.max(state.now, state.wakeAt);
          if (state.status === "sleeping") {
            if (!input?.timeout && state.wakeAt > state.now) {
              await this.persist(row, state);
              return state;
            }
            const node = { id: state.current },
              edge = advance(state, "next");
            await this.log(row, {
              node,
              edge,
              port: "next",
              detail: "Temporizador concluído.",
            });
            input = undefined;
          } else if (state.status === "waiting" && !input) {
            await this.persist(row, state);
            return state;
          }
          const deadline = Date.now() + 45000;
          for (let i = 0; i < 30 && Date.now() < deadline; i++) {
            if (row.mode === "live") await this.assertActive(row, state);
            if (row.mode === "live") state.now = Date.now();
            const before = state.current;
            const { definition, ...runtime } = state;
            checkpoint = { ...structuredClone(runtime), definition };
            const entry = await executeNode(state, adapter, input);
            checkpoint = null;
            delete state.pendingInput;
            input = undefined;
            state.trace.push({
              nodeId: before,
              edgeId: entry.edge?.id,
              port: entry.port,
              detail: entry.detail,
              at: state.now,
            });
            state.trace = state.trace.slice(-500);
            await this.log(row, entry);
            await this.persist(
              row,
              state,
              state.status === "ready" ? lease : null,
            );
            if (state.status !== "ready") return state;
          }
          await this.persist(row, state);
          return state;
        } catch (error) {
          if (error.code === "FLOW_STOPPED") {
            state.status = "stopped";
            state.stopReason = error.message;
            await this.log(row, {
              node: { id: state.current },
              detail: error.message,
            });
            await this.persist(row, state);
            return state;
          }
          if (
            error.code === "WHATSAPP_NOT_READY" &&
            error.deliveryAttempted === false
          ) {
            if (checkpoint) {
              for (const key of Object.keys(state))
                if (!(key in checkpoint)) delete state[key];
              Object.assign(state, checkpoint);
            }
            state.retryAt = Date.now() + 5000;
            if (input) state.pendingInput = input;
            await this.log(row, { detail: error.message });
            await this.persist(row, state);
            return state;
          }
          state.error = error.uncertain
            ? "Resultado de envio incerto; confira o histórico do atendimento. A execução foi suspensa para evitar duplicidade."
            : String(error.message).slice(0, 500);
          state.step++;
          state.status = error.uncertain ? "attention" : "failed";
          await this.log(row, {
            node: { id: state.current },
            detail: state.error,
          });
          await this.persist(row, state);
          return state;
        }
      },
      row.actor_id,
    );
  }
  async createRun({
    accountId,
    flowId,
    version,
    definition,
    chipId,
    contact,
    actorId,
    context,
    mode = "live",
    simulation,
  }) {
    const id = crypto.randomUUID(),
      state = createState(
        definition,
        context,
        simulation?.now ? Date.parse(simulation.now) : Date.now(),
      );
    if (!Number.isFinite(state.now))
      throw Object.assign(new Error("Data de simulação inválida."), {
        statusCode: 400,
      });
    state.simulation = simulation || {};
    await db.run(
      "INSERT INTO flow_runs(id,account_id,flow_id,version,chip_id,contact,mode,actor_id,status,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        accountId,
        flowId,
        version,
        chipId || null,
        contact || "",
        mode,
        actorId,
        "ready",
        JSON.stringify(state),
        nowISO(),
        nowISO(),
      ],
    );
    await this.run(id);
    return id;
  }
  async processEvent(row) {
    const receipt = await db.get("SELECT run_id FROM flow_inbox WHERE id = ?", [
      row.id,
    ]);
    if (receipt?.run_id) return;
    const event = JSON.parse(row.payload);
    return withAccount(row.account_id, async () => {
      const current = await db.get(
        "SELECT * FROM flow_runs WHERE account_id = ? AND chip_id = ? AND contact = ? AND mode = 'live' AND status IN ('ready','running','waiting','sleeping','attention')",
        [row.account_id, row.chip_id, row.contact],
      );
      if (current) {
        const state = JSON.parse(current.state);
        if ((state.processedEvents || []).includes(row.id)) return;
        if (current.status === "running" || current.status === "ready")
          throw new Error("Execução ocupada.");
        if (current.status === "waiting" && event.type === "message") {
          if (!(await this.run(current.id, { text: event.text }, row.id)))
            throw new Error("Execução ocupada.");
        }
        return;
      }
      const flows = await db.all(
        "SELECT * FROM flows WHERE account_id = ? AND active = 1 AND triggers_enabled = 1 AND published_version IS NOT NULL",
        [row.account_id],
      );
      const matches = [];
      for (const flow of flows) {
        if (event.flowId && Number(event.flowId) !== flow.id) continue;
        const version = await db.get(
          "SELECT * FROM flow_versions WHERE flow_id = ? AND account_id = ? AND version = ?",
          [flow.id, row.account_id, flow.published_version],
        );
        if (!version) continue;
        const definition = normalizeDefinition(JSON.parse(version.definition));
        const chips =
          definition.settings.chipIds ?? parse(flow.trigger_chips, []);
        if (chips.length && !chips.map(String).includes(String(row.chip_id)))
          continue;
        for (const trigger of definition.triggers || [])
          if (triggerMatch(trigger, event))
            matches.push({
              flow,
              version,
              definition,
              priority: Number(trigger.priority || 0),
            });
      }
      matches.sort((a, b) => b.priority - a.priority || a.flow.id - b.flow.id);
      if (!matches.length) return;
      const { flow, version, definition } = matches[0];
      const chip = await db.get(
        "SELECT * FROM chips WHERE id = ? AND user_id = ?",
        [row.chip_id, row.account_id],
      );
      if (!chip) return;
      const context = await this.requestChip(chip, "flow-context", {
        number: row.contact,
      });
      if (conversationStopReason(context)) return;
      const publisher = await rbac.accessFor(version.created_by);
      if (!publisher || publisher.accountId !== row.account_id) return;
      const globals = Object.fromEntries(
        (
          await db.all("SELECT * FROM global_variables WHERE account_id = ?", [
            row.account_id,
          ])
        )
          .filter((v) => rbac.recordAllowed(publisher, v, "global_variables"))
          .map((v) => [v.key, decodeVariable(v.value, v.value_type)]),
      );
      const account = await db.get(
        "SELECT display_name FROM accounts WHERE id = ?",
        [row.account_id],
      );
      // The version author is the principal whose permissions authorize every operation.
      const state = createState(definition, {
        ...context,
        number: row.contact,
        globals,
        company: { nome: account?.display_name || "" },
        protocol: crypto.randomUUID(),
      });
      state.processedEvents = [row.id];
      const id = crypto.randomUUID();
      await db.transaction(async () => {
        await db.run(
          "INSERT INTO flow_runs(id,account_id,flow_id,version,chip_id,contact,mode,actor_id,status,state,created_at,updated_at) VALUES (?,?,?,?,?,?,'live',?,'ready',?,?,?)",
          [
            id,
            row.account_id,
            flow.id,
            version.version,
            row.chip_id,
            row.contact,
            version.created_by,
            JSON.stringify(state),
            nowISO(),
            nowISO(),
          ],
        );
        await db.run("UPDATE flow_inbox SET run_id = ? WHERE id = ?", [
          id,
          row.id,
        ]);
      });
      await this.run(id);
    });
  }
  tick() {
    if (this.ticking) return this.ticking;
    this.ticking = this._tick().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }
  async _tick() {
    await db.run(
      "UPDATE flow_inbox SET status = 'pending', lease_until = NULL WHERE status = 'processing' AND lease_until < ?",
      [nowISO()],
    );
    const expired = await db.all(
      "SELECT * FROM flow_runs WHERE status = 'running' AND lease_until < ?",
      [nowISO()],
    );
    for (const run of expired) {
      const state = JSON.parse(run.state);
      const uncertain = await db.get(
        "SELECT id FROM flow_effects WHERE run_id = ? AND status IN ('pending','uncertain') LIMIT 1",
        [run.id],
      );
      if (!uncertain) {
        await db.run(
          "UPDATE flow_runs SET status = ?, lease_until = NULL WHERE id = ? AND status = ? AND lease_until < ?",
          [
            state.pendingInput ? "ready" : state.status,
            run.id,
            "running",
            nowISO(),
          ],
        );
        await this.log(run, {
          detail:
            "Execução recuperada após interrupção; efeitos confirmados não serão repetidos.",
        });
        continue;
      }
      state.status = "attention";
      state.error =
        "Execução interrompida durante uma operação. Confira o atendimento e encerre esta execução antes de reiniciar.";
      await this.persist(run, state);
      await this.log(run, { detail: state.error });
    }
    const rows = await db.all(
      "SELECT * FROM flow_inbox WHERE status = 'pending' ORDER BY received_order, created_at, id LIMIT 50",
    );
    for (const row of rows) {
      // Serialize claims across processes using a conditional update and a short DB transaction.
      try {
        await db.transaction(async () => {
          const claim = await db.run(
            "UPDATE flow_inbox SET status = 'processing', lease_until = ? WHERE id = ? AND status = 'pending'",
            [new Date(Date.now() + 180000).toISOString(), row.id],
          );
          row.claimed = !!claim.changes;
        });
        if (!row.claimed) continue;
        await this.processEvent(row);
        await db.run(
          "UPDATE flow_inbox SET status = 'done', error = NULL, lease_until = NULL WHERE id = ?",
          [row.id],
        );
      } catch (error) {
        await db.run(
          "UPDATE flow_inbox SET status = 'pending', error = ? WHERE id = ?",
          [String(error.message).slice(0, 500), row.id],
        );
      }
    }
    const due = await db.all(
      "SELECT id,status FROM flow_runs WHERE mode = 'live' AND ((status = 'ready' AND (wake_at IS NULL OR wake_at <= ?)) OR (status IN ('waiting','sleeping') AND wake_at <= ?)) ORDER BY updated_at LIMIT 50",
      [nowISO(), nowISO()],
    );
    for (const row of due)
      await this.run(
        row.id,
        row.status === "ready" ? undefined : { timeout: true },
      );
  }
}
module.exports = { FlowService, triggerMatch };
