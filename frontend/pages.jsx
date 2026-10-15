import React from "react";
import {
  api,
  cleanNumber,
  phone,
  internalId,
  relative,
  downloadCsv,
} from "./api";
import { Action, ActionMenu, DataTable, Empty } from "./components";
import { Avatar } from "./avatar";
import { Chips } from "./chips";
import { Dashboard } from './dashboard';

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const text = (value) => String(value || "").toLocaleLowerCase("pt-BR");
export function filteredContacts(ctx) {
  const f = ctx.fields;
  return ctx.data.contacts
    .filter(
      (item) =>
        text(
          `${item.name || ""} ${internalId(item.number, item) ? "" : item.number} ${phone(item.number)}`,
        ).includes(text(f.contactsPageSearch)) &&
        (!f.contactsTagFilter || item.tags?.includes(f.contactsTagFilter)),
    )
    .sort((a, b) =>
      f.contactsPageSort === "recent"
        ? String(b.lastSeenAt || "").localeCompare(a.lastSeenAt || "")
        : (a.name || "").localeCompare(
            b.name || "",
            "pt-BR",
          ),
    );
}
export function TagPicker({ ctx, field, danger = false }) {
  const selected = ctx.fields[field] || [];
  return ctx.data.tags.length ? (
    ctx.data.tags.map((tag) => (
      <button
        type="button"
        key={tag.id}
        data-tag={tag.name}
        className={`tag-toggle-btn${selected.includes(tag.name) ? " is-active" : ""}${danger ? " tag-toggle-btn--danger" : ""}`}
        style={{ "--tag-color": danger ? "#f87171" : tag.color }}
        aria-pressed={selected.includes(tag.name)}
        onClick={() =>
          ctx.setField(
            field,
            selected.includes(tag.name)
              ? selected.filter((name) => name !== tag.name)
              : [...selected, tag.name],
          )
        }
      >
        <span className="tag-toggle-dot" style={{ background: tag.color }} />
        {tag.name}
      </button>
    ))
  ) : (
    <Empty>Nenhuma tag disponível.</Empty>
  );
}

export function MultiSelectDropdown({ label, labelledBy, options, selected = [], onToggle }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handleOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [open]);

  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || selected[0]
        : `${selected.length} selecionados`;

  return (
    <div className={`multi-dropdown${open ? " is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className="multi-dropdown-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-labelledby={labelledBy}
      >
        <span className={selected.length ? "multi-dropdown-val" : "multi-dropdown-ph"}>
          {summary}
        </span>
        <span className="multi-dropdown-arrow">▾</span>
      </button>
      {open && (
        <div className="multi-dropdown-menu">
          {options.map((opt) => {
            const isChecked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`multi-dropdown-item${isChecked ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
function edit(ctx, kind, item = null) {
  if (kind === "campaigns")
    ctx.openEditor(
      "campaignModal",
      {
        campaignName: item?.name || "",
        campaignMessage: item?.message || "",
        campaignScheduledAt:
          item?.scheduled_at?.replace(" ", "T").slice(0, 16) || "",
        campaignTargetTags: item?.target_tags || [],
        campaignBlockedTags: item?.blocked_tags || [],
      },
      item,
    );
  if (kind === "flows")
    ctx.openEditor(
      "flowModal",
      {
        flowId: item?.id || "",
        flowName: item?.name || "",
        flowDescription: item?.description || "",
        flowKeywords: item?.trigger_keywords?.join(", ") || "",
      },
      item,
    );
  if (kind === "webhooks") {
    const events = Object.fromEntries(
      Object.keys(ctx.fields)
        .filter((key) => key.startsWith("events:"))
        .map((key) => [key, !!item?.events?.includes(key.slice(7))]),
    );
    ctx.openEditor(
      "webhookModal",
      {
        webhookName: item?.name || "",
        webhookUrl: item?.url || "",
        webhookSecret: item?.secret || "",
        ...events,
      },
      item,
    );
  }
  if (kind === "team")
    ctx.openEditor(
      "teamMemberModal",
      {
        teamMemberId: item?.id || "",
        teamMemberName: item?.name || item?.displayName || "",
        teamMemberEmail: item?.email || item?.username || "",
        teamMemberRole: item?.role || "Gerente",
        teamMemberAccess: item?.accessAreas || ["atendimento", "dashboard", "funis"],
        teamMemberFunnels: item?.funnels || [],
        teamMemberPassword: "",
      },
      item,
    );
}
function opportunity(ctx, column, item = null) {
  ctx.openEditor(
    "opportunityModal",
    {
      opportunityId: item?.id || "",
      opportunityColumnId: String(
        column || ctx.data.kanban.columns[0]?.id || "",
      ),
      opportunityTitle: item?.title || "",
      opportunityContact: item?.contact_number || "",
      opportunityValue: item?.value ?? "",
    },
    item,
  );
}
function resourceEditor(ctx, kind, item = null, duplicate = false) {
  const tag = kind === "tags";
  ctx.resource({
    title: `${duplicate ? "Duplicar" : item ? "Editar" : tag ? "Nova" : "Novo"} ${tag ? "tag" : "departamento"}`,
    fields: [
      {
        name: "name",
        label: tag ? "Nome da tag" : "Nome do departamento",
        required: true,
        maxLength: 60,
        value: (item?.name || "") + (duplicate ? " (cópia)" : ""),
      },
      tag
        ? {
            name: "color",
            label: "Cor (código hexadecimal)",
            required: true,
            pattern: "#[0-9a-fA-F]{6}",
            value: item?.color || "#3ddc84",
          }
        : {
            name: "description",
            label: "Descrição (opcional)",
            type: "textarea",
            value: item?.description || "",
          },
    ],
    save: async (values) => {
      await api(
        `/api/${kind}${item && !duplicate ? "/" + item.id : ""}`,
        item && !duplicate ? "PUT" : "POST",
        values,
      );
      await ctx.load(kind);
    },
  });
}
async function remove(ctx, kind, item, url = `/api/${kind}/${item.id}`) {
  if (
    !(await ctx.confirm({
      title: `Excluir ${item.name || item.title || "registro"}?`,
      body:
        kind === "departments"
          ? "Transfira os chips associados antes de excluir este departamento."
          : "Confirme a exclusão deste registro.",
      okText: "Excluir",
    }))
  )
    return;
  await api(url, "DELETE");
  await ctx.load(
    kind === "columns" || kind === "opportunities" ? "kanban" : kind,
  );
  ctx.notify("Registro excluído.", "success");
}
function ResourceList({ ctx, kind }) {
  const tag = kind === "tags";
  return (
    <DataTable
      kind={tag ? "Tags" : "Departamentos"}
      rows={ctx.data[kind]}
      headings={[tag ? "Rótulo" : "Nome", tag ? "Cor" : "Descrição", "Ações"]}
      row={(item) => (
        <tr key={item.id}>
          <td>
            <strong>{item.name}</strong>
          </td>
          <td>
            {tag ? (
              <span className="table-tag" style={{ "--tag-color": item.color }}>
                <span className="color-dot" />
                {item.color}
              </span>
            ) : (
              item.description || "—"
            )}
          </td>
          <td className="actions-cell">
            <ActionMenu label={"Ações de " + item.name}>
                {["edit", "duplicate", "delete"].map((action) => (
                  <Action
                    key={action}
                    className={`text-action${action === "delete" ? " text-action--danger" : ""}`}
                    data-action={action}
                    data-kind={kind}
                    data-id={item.id}
                    action={(event) => {
                      return action === "delete"
                        ? remove(ctx, kind, item)
                        : resourceEditor(
                            ctx,
                            kind,
                            item,
                            action === "duplicate",
                          );
                    }}
                  >
                    {
                      {
                        edit: "Editar",
                        duplicate: "Duplicar",
                        delete: "Excluir",
                      }[action]
                    }
                  </Action>
                ))}
            </ActionMenu>
          </td>
        </tr>
      )}
    />
  );
}
function Cards({ ctx, kind }) {
  const singular = {
    campaigns: "campaign",
    flows: "flow",
    webhooks: "webhook",
  }[kind];
  const items = ctx.data[kind].filter(
    (item) =>
      kind !== "webhooks" ||
      text(`${item.name} ${item.url}`).includes(text(ctx.fields.webhookSearch)),
  );
  return items.length ? (
    items.map((item) => (
      <article
        key={item.id}
        className={`${singular}-card${kind === "flows" && item.active ? " flow-card--active" : ""}${kind === "webhooks" && !item.active ? " webhook-card--inactive" : ""}`}
        data-id={item.id}
      >
        <div
          className={
            kind === "webhooks" ? "webhook-card-header" : "campaign-card-header"
          }
        >
          <div>
            <strong>{item.name}</strong>
            <span
              className={
                kind === "webhooks"
                  ? "webhook-status"
                  : `campaign-status campaign-status--${item.status || (item.active ? "finished" : "")}`
              }
            >
              {kind === "campaigns"
                ? {
                    draft: "Rascunho",
                    scheduled: "Agendada",
                    running: "Enviando",
                    finished: "Finalizada",
                    cancelled: "Cancelada",
                  }[item.status] || item.status
                : item.active
                  ? "Ativo"
                  : "Inativo"}
            </span>
            {kind === "flows" && !!item.trigger_keywords?.length && (
              <small>Gatilhos: {item.trigger_keywords.join(", ")}</small>
            )}
          </div>
          <div className="campaign-card-actions">
            <ActionMenu label={`Ações de ${item.name}`}>
            {kind === "flows" && (
              <Action
                className="text-action flow-toggle"
                data-id={item.id}
                action={async () => {
                  await api(`/api/flows/${item.id}`, "PUT", {
                    ...item,
                    active: !item.active,
                  });
                  await ctx.load(kind);
                }}
              >
                {item.active ? "Desativar" : "Ativar"}
              </Action>
            )}
            {kind !== "webhooks" && (
              <Action
                className={`text-action ${singular}-duplicate`}
                data-id={item.id}
                action={async () => {
                  await api(`/api/${kind}/${item.id}/duplicate`, "POST");
                  await ctx.load(kind);
                  ctx.notify("Registro duplicado.", "success");
                }}
              >
                Duplicar
              </Action>
            )}
            <Action
              className={`text-action ${singular}-edit`}
              data-id={item.id}
              action={() => edit(ctx, kind, item)}
            >
              Editar
            </Action>
            <Action
              className={`text-action text-action--danger ${singular}-delete`}
              data-id={item.id}
              action={() => remove(ctx, kind, item)}
            >
              Excluir
            </Action>
            </ActionMenu>
          </div>
        </div>
        <p className={kind === "webhooks" ? "webhook-url" : "campaign-message"}>
          {kind === "campaigns"
            ? (item.message || "").slice(0, 120)
            : kind === "webhooks"
              ? item.url
              : item.description}
        </p>
        <div className="campaign-meta">
          {kind === "campaigns" && (
            <>
              <span className="campaign-meta-item">
                Enviar para:{" "}
                {item.target_tags?.join(", ") || "Todos os contatos"}
              </span>
              {!!item.blocked_tags?.length && (
                <span className="campaign-meta-item campaign-meta-item--danger">
                  Excluir: {item.blocked_tags.join(", ")}
                </span>
              )}
              {item.scheduled_at && (
                <span className="campaign-meta-item">
                  {new Date(item.scheduled_at).toLocaleString("pt-BR")}
                </span>
              )}
              {item.sent_count > 0 && (
                <span className="campaign-meta-item">
                  {item.sent_count} enviados · {item.failed_count} falhas
                </span>
              )}
            </>
          )}
          {kind === "webhooks" && (
            <>
              {item.events?.map((event) => (
                <span className="campaign-meta-item" key={event}>
                  {event}
                </span>
              ))}
              {item.last_triggered_at && (
                <span>Último disparo: {relative(item.last_triggered_at)}</span>
              )}
            </>
          )}
        </div>
      </article>
    ))
  ) : (
    <Empty>
      {kind === "campaigns"
        ? "Nenhuma campanha criada ainda."
        : kind === "flows"
          ? "Nenhum fluxo criado ainda."
          : "Nenhum webhook encontrado."}
    </Empty>
  );
}
function Board({ ctx }) {
  const { columns, opportunities } = ctx.data.kanban;
  return (
    <>
      {columns.map((column, index) => {
        const items = opportunities.filter(
          (item) =>
            String(item.column_id) === String(column.id) &&
            (ctx.fields.funnelStatus === "all" ||
              item.status === (ctx.fields.funnelStatus || "open")) &&
            text(`${item.title} ${item.contact_name}`).includes(
              text(ctx.fields.kanbanSearch),
            ),
        );
        return (
          <section
            key={column.id}
            className="kanban-column"
            data-col-id={column.id}
            style={{
              "--stage-color": [
                "var(--accent)",
                "var(--admin)",
                "var(--live)",
                "var(--warm)",
                "var(--danger)",
              ][index % 5],
            }}
          >
            <div className="kanban-column-header">
              <span className="kanban-column-name">{column.name}</span>
              <span className="kanban-column-count">{items.length}</span>
              <Action
                className="kanban-add-opp text-action"
                data-col-id={column.id}
                aria-label={"Nova oportunidade em " + column.name}
                action={() => opportunity(ctx, column.id)}
              >
                +
              </Action>
              <Action
                className="kanban-delete-col"
                aria-label={"Excluir etapa " + column.name}
                action={() =>
                  remove(
                    ctx,
                    "columns",
                    column,
                    `/api/kanban/columns/${column.id}`,
                  )
                }
              >
                ×
              </Action>
            </div>
            <div className="kanban-cards">
              {items.length ? (
                items.map((item) => (
                  <article
                    className="kanban-card"
                    data-id={item.id}
                    key={item.id}
                  >
                    <div className="kanban-card-title">{item.title}</div>
                    {item.contact_name && (
                      <div className="kanban-card-contact">
                        {item.contact_name}
                      </div>
                    )}
                    {!!item.value && (
                      <div className="kanban-card-value">
                        {money(item.value)}
                      </div>
                    )}
                    <span className="funnel-outcome">
                      {
                        { open: "Em andamento", won: "Ganha", lost: "Perdida" }[
                          item.status
                        ]
                      }
                    </span>
                    <label className="funnel-move">
                      Etapa
                      <select
                        data-move-id={item.id}
                        disabled={!ctx.can('funis.editar')}
                        aria-label={"Etapa de " + item.title}
                        value={item.column_id}
                        onChange={(event) =>
                          ctx.execute("move-" + item.id, async () => {
                            await api(
                              `/api/kanban/opportunities/${item.id}`,
                              "PUT",
                              {
                                ...item,
                                column_id: Number(event.target.value),
                              },
                            );
                            await ctx.load("kanban");
                          })
                        }
                      >
                        {columns.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="kanban-card-actions">
                      <ActionMenu label={`Ações de ${item.title}`}>
                      <Action
                        className="kanban-card-btn kanban-edit"
                        data-id={item.id}
                        action={() => opportunity(ctx, column.id, item)}
                      >
                        Editar
                      </Action>
                      {item.status === "open" && (
                        <>
                          <Action
                            className="kanban-card-btn kanban-win"
                            data-id={item.id}
                            action={async () => {
                              await api(
                                `/api/kanban/opportunities/${item.id}/win`,
                                "POST",
                              );
                              await ctx.load("kanban");
                            }}
                          >
                            Ganha
                          </Action>
                          <Action
                            className="kanban-card-btn kanban-lose"
                            data-id={item.id}
                            action={() =>
                              ctx.openEditor(
                                "loseModal",
                                { loseReasonSelect: "" },
                                item,
                              )
                            }
                          >
                            Perdida
                          </Action>
                        </>
                      )}
                      <Action
                        className="kanban-card-btn kanban-delete"
                        data-id={item.id}
                        action={() =>
                          remove(
                            ctx,
                            "opportunities",
                            item,
                            `/api/kanban/opportunities/${item.id}`,
                          )
                        }
                      >
                        Excluir
                      </Action>
                      </ActionMenu>
                    </div>
                  </article>
                ))
              ) : (
                <div className="kanban-empty">
                  <span>Nenhuma oportunidade encontrada</span>
                  <Action
                    className="kanban-add-opp text-action"
                    action={() => opportunity(ctx, column.id)}
                  >
                    + Adicionar oportunidade
                  </Action>
                </div>
              )}
            </div>
          </section>
        );
      })}
      <Action
        id="kanbanAddStage"
        className="kanban-new-stage"
        action={() => pageActions(ctx).addKanbanColumnBtn()}
      >
        ⊕ Adicionar etapa
      </Action>
    </>
  );
}
function chart(ctx) {
  const now = new Date(),
    days = Array.from({ length: ctx.chartDays }, (_, index) => ({
      date: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - ctx.chartDays + index + 1,
      ),
      received: 0,
      sent: 0,
    }));
  for (const conversation of Object.values(ctx.data.state.conversations || {}))
    for (const message of conversation.messages || []) {
      const day = days.find(
        (item) =>
          item.date.toDateString() === new Date(message.at).toDateString(),
      );
      if (day) day[message.from === "admin" ? "sent" : "received"]++;
    }
  return days;
}
export function pageActions(ctx) {
  const run = (id, fn, error) => () => ctx.execute(id, fn, error);
  const actions = {
    newCampaignBtn: () => edit(ctx, "campaigns"),
    newFlowBtn: () => edit(ctx, "flows"),
    newWebhookBtn: () => edit(ctx, "webhooks"),
    addTagBtn: () => resourceEditor(ctx, "tags"),
    addDeptBtn: () => resourceEditor(ctx, "departments"),
    importContactsBtn: () => {
      ctx.setImportResult(null);
      ctx.setFile("importContactsFile", null);
      ctx.openEditor("importContactsPanel");
    },
    downloadContactsTemplate: () =>
      downloadCsv(
        [
          ["Nome", "Telefone", "Rótulos"],
          ["Maria Exemplo", "5511999999999", "Cliente, Novo"],
        ],
        "modelo-contatos.csv",
      ),
    newTeamMemberBtn: () => edit(ctx, "team"),
    teamMemberCancel: () => ctx.closeEditor(),
    teamMemberModalClose: () => ctx.closeEditor(),
    teamLearnMoreBtn: () =>
      ctx.notify(
        "O proprietário define os acessos. Gerentes podem delegar apenas as permissões autorizadas; atendentes veem os dados dentro do escopo recebido.",
        "info",
      ),
    exportContactsBtn: async () => {
      const parameters = new URLSearchParams({ chipId: ctx.data.state.chipId || '', search: ctx.fields.contactsPageSearch || '', tag: ctx.fields.contactsTagFilter || '' });
      const response = await fetch(`/api/contacts/export?${parameters}`, { credentials: 'include' });
      if (!response.ok) throw Error((await response.json()).error || 'Exportacao nao autorizada.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'contatos-bot-wap.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    manageGlobalVarsBtn: () => ctx.openEditor("globalVarsModal"),
    manageLossReasonsBtn: () => ctx.openEditor("lossReasonsModal"),
    addKanbanColumnBtn: () =>
      ctx.resource({
        title: "Nova etapa",
        fields: [
          {
            name: "name",
            label: "Nome da etapa",
            required: true,
            maxLength: 60,
          },
        ],
        save: async (values) => {
          await api("/api/kanban/columns", "POST", values);
          await ctx.load("kanban");
        },
      }),
    addFollowupBtn: () =>
      ctx.resource({
        title: "Novo acompanhamento automático",
        fields: [
          {
            name: "name",
            label: "Nome do acompanhamento",
            required: true,
            maxLength: 60,
          },
          {
            name: "message",
            label: "Mensagem",
            type: "textarea",
            required: true,
          },
          {
            name: "delay_hours",
            label: "Horas de inatividade antes do envio",
            type: "number",
            required: true,
            min: 1,
            step: 1,
            value: 24,
          },
        ],
        save: async (values) => {
          await api("/api/followups", "POST", {
            ...values,
            delay_hours: Number(values.delay_hours),
          });
          await ctx.load("followups");
        },
      }),
    addGlobalVarBtn: run("addGlobalVarBtn", async () => {
      const key = (ctx.fields.newGlobalVarKey || "").trim().toUpperCase();
      if (!key) throw Error("Informe uma chave para a variável.");
      await api("/api/global-variables", "POST", {
        key,
        value: ctx.fields.newGlobalVarValue || "",
      });
      ctx.setField("newGlobalVarKey", "");
      ctx.setField("newGlobalVarValue", "");
      await ctx.load("variables");
    }),
    addLossReasonBtn: run("addLossReasonBtn", async () => {
      const name = (ctx.fields.newLossReasonInput || "").trim();
      if (!name) throw Error("Informe o nome do motivo.");
      await api("/api/loss-reasons", "POST", { name });
      ctx.setField("newLossReasonInput", "");
      await ctx.load("reasons");
    }),
    loseModalConfirm: run("loseModalConfirm", async () => {
      await api(
        `/api/kanban/opportunities/${ctx.editor.item.id}/lose`,
        "POST",
        { loss_reason_id: Number(ctx.fields.loseReasonSelect) || null },
      );
      ctx.closeEditor();
      await ctx.load("kanban");
    }),
    dashCardOpen: () => dashboardInbox(ctx, "all"),
    dashCardFinalized: () => dashboardInbox(ctx, "finalized"),
  };
  for (const id of [
    "campaignModalClose",
    "flowModalClose",
    "webhookModalClose",
    "opportunityModalClose",
    "loseModalCancel",
    "lossReasonsClose",
    "globalVarsClose",
    "cancelContactsImport",
  ])
    actions[id] = ctx.closeEditor;
  return actions;
}
function dashboardInbox(ctx, filter) {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem("bwap-workspace-state") || "{}",
    );
    sessionStorage.setItem(
      "bwap-workspace-state",
      JSON.stringify({ ...stored, conversationFilter: filter }),
    );
  } catch {}
  ctx.navigate("inbox");
}
export function pageSubmits(ctx) {
  const f = ctx.fields,
    item = ctx.editor?.item;
  const save = (kind, button, payload, error) =>
    ctx.execute(
      button,
      async () => {
        await api(
          `/api/${kind}${item ? "/" + item.id : ""}`,
          item ? "PUT" : "POST",
          payload,
        );
        ctx.closeEditor();
        await ctx.load(kind);
        ctx.notify("Registro salvo.", "success");
      },
      error,
    );
  return {
    campaignForm: () =>
      save(
        "campaigns",
        "campaignSaveBtn",
        {
          name: f.campaignName,
          message: f.campaignMessage,
          scheduled_at: f.campaignScheduledAt || null,
          target_tags: f.campaignTargetTags || [],
          blocked_tags: f.campaignBlockedTags || [],
        },
        "campaignError",
      ),
    flowForm: () =>
      save(
        "flows",
        "flowSaveBtn",
        {
          name: f.flowName,
          description: f.flowDescription,
          trigger_keywords: (f.flowKeywords || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          nodes: item?.nodes || [],
          edges: item?.edges || [],
          trigger_chips: item?.trigger_chips || [],
          active: !!item?.active,
        },
        "flowError",
      ),
    webhookForm: () =>
      save(
        "webhooks",
        "webhookSaveBtn",
        {
          name: f.webhookName,
          url: f.webhookUrl,
          secret: f.webhookSecret,
          events: Object.keys(f)
            .filter((key) => key.startsWith("events:") && f[key])
            .map((key) => key.slice(7)),
          active: item ? !!item.active : true,
        },
        "webhookError",
      ),
    opportunityForm: () =>
      ctx.execute(
        "opportunitySaveBtn",
        async () => {
          await api(
            `/api/kanban/opportunities${item ? "/" + item.id : ""}`,
            item ? "PUT" : "POST",
            {
              title: f.opportunityTitle,
              contact_number: f.opportunityContact,
              contact_name:
                ctx.data.contacts.find(
                  (contact) =>
                    contact.number === cleanNumber(f.opportunityContact),
                )?.name ||
                item?.contact_name ||
                "",
              value: Number(f.opportunityValue) || 0,
              column_id: Number(f.opportunityColumnId),
              position: item?.position || 0,
            },
          );
          if (!item) ctx.setField("funnelStatus", "open");
          ctx.closeEditor();
          await ctx.load("kanban");
        },
        "opportunityError",
      ),
    importContactsForm: (event) =>
      ctx.execute(
        "submitContactsImport",
        async () => {
          const file = ctx.files.importContactsFile;
          if (
            !file ||
            !/\.csv$/i.test(file.name) ||
            file.size > 2 * 1024 * 1024
          )
            throw Error("Selecione um arquivo .csv de até 2 MB.");
          ctx.setImportResult(null);
          const body = new FormData();
          body.append("file", file);
          let result;
          try {
            result = await api("/api/contacts/import", "POST", body);
          } catch (error) {
            if (error.data?.errors)
              ctx.setImportResult({ ...error.data, success: false });
            throw error;
          }
          ctx.setImportResult({ ...result, success: true });
          ctx.setFile("importContactsFile", null);
          ctx.setField("contactsPageSearch", "");
          ctx.setField("contactsTagFilter", "");
          await Promise.all([ctx.load("contacts"), ctx.load("tags")]);
        },
        "importContactsError",
      ),
    teamMemberForm: () =>
      ctx.execute(
        "teamMemberSave",
        async () => {
          const body = {
            name: f.teamMemberName,
            email: f.teamMemberEmail,
            role: f.teamMemberRole || "Gerente",
            accessAreas: f.teamMemberAccess || [],
            funnels: f.teamMemberFunnels || [],
            departments: (f.teamMemberFunnels || []).map((id) => {
              const col = (ctx.data.kanban?.columns || []).find(
                (c) => String(c.id) === String(id),
              );
              return col ? col.name : id;
            }),
            password: f.teamMemberPassword,
          };
          if (item?.id) {
            await api(`/api/team/${item.id}`, "PUT", body);
          } else {
            await api("/api/team", "POST", body);
          }
          ctx.closeEditor();
          await ctx.load("team");
          ctx.notify("Membro da equipe salvo.", "success");
        },
        "teamMemberError",
      ),
  };
}
export function pageAttributes(ctx, id, node) {
  if (id === "importContactsBtn")
    return { "aria-expanded": ctx.editor?.id === "importContactsPanel" };
  if (id === "importContactsResult") return { hidden: !ctx.importResult };
  if (id === "importContactsForm")
    return { "aria-busy": ctx.busy === "submitContactsImport" };
  if (["cancelContactsImport", "importContactsFile"].includes(id))
    return { disabled: ctx.busy === "submitContactsImport" };
  if (["dashCardOpen", "dashCardFinalized"].includes(id))
    return {
      role: "button",
      tabIndex: 0,
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ctx.actions[id]();
        }
      },
    };
  if (id === "settingsQrHint")
    return { hidden: ctx.data.state.status?.connected };
  if (id === "activityChart")
    return {
      hidden: !chart(ctx).some((day) => day.received + day.sent),
      style: { "--chart-days": ctx.chartDays },
    };
  if (id === "activityChartLegend" || id === "activityChartEmpty") {
    const active = chart(ctx).some((day) => day.received + day.sent);
    return { hidden: id === "activityChartEmpty" ? active : !active };
  }
  return {};
}
export function pageSlot(ctx, id, node) {
  if (id === 'dashboardAnalytics') return <Dashboard ctx={ctx} />;
  if (id === 'reportExportSlot') return <Action className="text-action" permission="relatorios.exportar" action={async () => { const response = await fetch('/api/dashboard/export', { credentials: 'same-origin' }); if (!response.ok) throw new Error((await response.json()).error); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'relatorio-bot-wap.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Exportar relatório</Action>;
  const d = ctx.data,
    f = ctx.fields;
  if (id === "contactsNavCount" || id === "overviewContactTotal")
    return d.contacts.length;
  if (id === "contactsTagFilter")
    return (
      <>
        <option value="">Todas as tags</option>
        {d.tags.map((tag) => (
          <option key={tag.id} value={tag.name}>
            {tag.name}
          </option>
        ))}
      </>
    );
  if (id === "departmentFilter")
    return (
      <>
        <option value="all">Todos os departamentos</option>
        <option value="none">Sem departamento</option>
        {d.departments.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </>
    );
  if (id === "chipDepartmentInput" || id === "bulkTransferDeptSelect")
    return (
      <>
        <option value="">Selecione um departamento</option>
        {d.departments.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </>
    );
  if (id === "contactsPageCount")
    return `${filteredContacts(ctx).length} contatos encontrados`;
  if (id === "exportContactsBtn") {
    const total = filteredContacts(ctx).length;
    return `Exportar ${total} contato${total === 1 ? "" : "s"}`;
  }
  if (id === "contactsTable")
    return (
      <DataTable
        kind="Contatos"
        rows={filteredContacts(ctx)}
        headings={["Contato", "Telefone", "Rótulos", "Atividade", "Ações"]}
        empty="Nenhum contato encontrado. Ajuste os filtros ou conecte seu WhatsApp em Meus chips."
        row={(item) => (
          <tr key={item.number}>
            <td>
              <div className="table-contact">
                <Avatar
                  className="contact-avatar"
                  number={item.number}
                  label={item.name || "Contato"}
                />
                <strong>
                  {item.name || phone(item.number)}
                </strong>
              </div>
            </td>
            <td>
              {internalId(item.number, item)
                ? "Número não disponível"
                : phone(item.number)}
            </td>
            <td>
              <div className="table-tag-list">{item.tags?.length ? item.tags.map((tag) => (
                <span
                  className="table-tag"
                  key={tag}
                  style={{
                    "--tag-color": d.tags.find((entry) => entry.name === tag)
                      ?.color,
                  }}
                >
                  {tag}
                </span>
              )) : <span className="table-muted">Sem rótulos</span>}</div>
            </td>
            <td>{relative(item.lastSeenAt)}</td>
            <td>
              <div className="contact-row-actions">
              <Action
                className="table-action"
                permission="atendimento.visualizar"
                data-contact-number={item.number}
                action={() => ctx.openConversation(item.number)}
              >
                Conversar ↗
              </Action>
              <ActionMenu label={`Ações de ${item.name || phone(item.number)}`}><Action className="table-action table-action--danger" permission="contatos.excluir" action={async () => { if (await ctx.confirm({ title: 'Remover da agenda do painel', body: 'O histórico será preservado. Contatos salvos no WhatsApp podem reaparecer na próxima sincronização.', okText: 'Remover' })) { await api(`/api/contacts/${item.number}`, 'DELETE'); await ctx.load('contacts'); } }}>Remover</Action></ActionMenu>
              </div>
            </td>
          </tr>
        )}
      />
    );
  if (id === "teamTable")
    return (
      <DataTable
        kind="Minha equipe"
        rows={d.team || []}
        headings={["Nome", "E-mail", "Permissões", "Departamentos", "Ações"]}
        empty="Nenhum membro cadastrado na equipe. Clique em + Novo membro para cadastrar."
        row={(member) => (
          <tr key={member.id}>
            <td>
              <div className="table-team-member">
                <span className="team-member-avatar" aria-hidden="true">
                  {(member.name || member.displayName || member.username || "?").trim().slice(0, 1).toLocaleUpperCase("pt-BR")}
                </span>
                <strong>{member.name || member.displayName}</strong>
              </div>
            </td>
            <td>{member.email || member.username}</td>
            <td>
              <span className="role-badge">
                {member.role || (member.isOwner ? "Proprietário da conta" : "Atendente")}
              </span>
            </td>
            <td>
              {(member.departments && member.departments.length)
                ? (Array.isArray(member.departments) ? member.departments.join(", ") : member.departments)
                : "—"}
            </td>
            <td>
              <div className="team-row-actions">
                <Action
                  className="table-action"
                  action={() => edit(ctx, "team", member)}
                >
                  Editar
                </Action>
                {!member.isOwner && member.id !== 1 && (
                  <Action
                    className="table-action table-action--danger"
                    action={async () => {
                      if (
                        await ctx.confirm({
                          title: "Excluir membro",
                          body: `Tem certeza que deseja excluir ${member.name || member.displayName} da equipe?`,
                          okText: "Excluir",
                        })
                      ) {
                        await api(`/api/team/${member.id}`, "DELETE");
                        await ctx.load("team");
                      }
                    }}
                  >
                    Excluir
                  </Action>
                )}
              </div>
            </td>
          </tr>
        )}
      />
    );
  if (id === "teamMemberAccessSlot") {
    const accessOptions = [
      { value: "atendimento", label: "Atendimento" },
      { value: "dashboard", label: "Dashboard" },
      { value: "funis", label: "Funis (Kanban)" },
      { value: "campanhas", label: "Campanhas" },
      { value: "fluxos", label: "Fluxos" },
      { value: "contatos", label: "Contatos" },
      { value: "webhooks", label: "Webhooks" },
      { value: "departamentos", label: "Departamentos" },
      { value: "tags", label: "Tags e rótulos" },
      { value: "chips", label: "Meus chips" },
      { value: "configuracoes", label: "Configurações" },
    ];
    const current = f.teamMemberAccess || [];
    return (
      <MultiSelectDropdown
        label="Áreas de acesso"
        labelledBy="teamMemberAccessLabel"
        options={accessOptions}
        selected={current}
        onToggle={(val) => {
          const next = current.includes(val)
            ? current.filter((x) => x !== val)
            : [...current, val];
          ctx.setField("teamMemberAccess", next);
        }}
      />
    );
  }
  if (id === "teamMemberFunnelsSlot") {
    const columns = d.kanban?.columns || [];
    const funnelOptions = columns.length
      ? columns.map((col) => ({ value: String(col.id), label: col.name }))
      : [
          { value: "vendas", label: "Funil de Vendas" },
          { value: "comercial", label: "Suporte Comercial" },
          { value: "posvendas", label: "Pós-Venda" },
        ];
    const current = f.teamMemberFunnels || [];
    return (
      <MultiSelectDropdown
        label="Funis (Kanban)"
        labelledBy="teamMemberFunnelsLabel"
        options={funnelOptions}
        selected={current}
        onToggle={(val) => {
          const next = current.includes(val)
            ? current.filter((x) => x !== val)
            : [...current, val];
          ctx.setField("teamMemberFunnels", next);
        }}
      />
    );
  }
  if (id === "tagsSettingsList") return <ResourceList ctx={ctx} kind="tags" />;
  if (id === "deptsSettingsList")
    return <ResourceList ctx={ctx} kind="departments" />;
  if (id === "campaignsList") return <Cards ctx={ctx} kind="campaigns" />;
  if (id === "flowsList") return <Cards ctx={ctx} kind="flows" />;
  if (id === "webhooksList") return <Cards ctx={ctx} kind="webhooks" />;
  if (id === "chipsList") return <Chips ctx={ctx} />;
  if (id === "chipsBadge") return d.chips.length;
  if (id === "campaignTargetTagsPicker")
    return <TagPicker ctx={ctx} field="campaignTargetTags" />;
  if (id === "campaignBlockedTagsPicker")
    return <TagPicker ctx={ctx} field="campaignBlockedTags" danger />;
  if (
    id === "campaignModalTitle" ||
    id === "flowModalTitle" ||
    id === "webhookModalTitle" ||
    id === "opportunityModalTitle"
  )
    return `${ctx.editor?.item ? "Editar" : "Nova"} ${{ campaignModalTitle: "Campanha", flowModalTitle: "Fluxo", webhookModalTitle: "Webhook", opportunityModalTitle: "Oportunidade" }[id]}`;
  if (id === "opportunityColumnId")
    return d.kanban.columns.map((column) => (
      <option key={column.id} value={column.id}>
        {column.name}
      </option>
    ));
  if (id === "loseReasonSelect")
    return (
      <>
        <option value="">Sem motivo específico</option>
        {d.reasons.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </>
    );
  if (id === "kanbanBoard") return <Board ctx={ctx} />;
  if (id === "kanbanMetrics") {
    const all = d.kanban.opportunities,
      won = all.filter((item) => item.status === "won"),
      lost = all.filter((item) => item.status === "lost");
    return (
      <div className="kanban-metric-bar">
        {[
          ["Total", all.length],
          ["Ganhos", won.length],
          ["Perdidos", lost.length],
          [
            "Receita",
            money(
              won.reduce((total, item) => total + Number(item.value || 0), 0),
            ),
          ],
          [
            "Conversão",
            `${all.length ? ((won.length / all.length) * 100).toFixed(1) : 0}%`,
          ],
        ].map(([name, value]) => (
          <div className="kanban-metric" key={name}>
            <span>{name}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    );
  }
  if (id === "lossReasonsContent")
    return d.reasons.length ? (
      d.reasons.map((item) => (
        <div className="loss-reason-item" key={item.id}>
          <span>{item.name}</span>
          <Action
            className="text-action text-action--danger"
            data-id={item.id}
            action={async () => {
              await api(`/api/loss-reasons/${item.id}`, "DELETE");
              await ctx.load("reasons");
            }}
          >
            Excluir
          </Action>
        </div>
      ))
    ) : (
      <Empty>Nenhum motivo cadastrado.</Empty>
    );
  if (id === "globalVarsList")
    return d.variables.length ? (
      d.variables.map((item) => (
        <div className="tag-settings-item" key={item.key}>
          <code>{`{global:${item.key}}`}</code>
          <span>{item.value}</span>
          <Action
            className="text-action text-action--danger global-var-delete"
            data-key={item.key}
            action={async () => {
              await api(
                `/api/global-variables/${encodeURIComponent(item.key)}`,
                "DELETE",
              );
              await ctx.load("variables");
            }}
          >
            Excluir
          </Action>
        </div>
      ))
    ) : (
      <Empty>Nenhuma variável global cadastrada.</Empty>
    );
  if (id === "followupsList")
    return d.followups.length ? (
      d.followups.map((item) => (
        <div className="tag-settings-item" key={item.id}>
          <span
            className="tag-settings-dot"
            style={{
              background: item.active ? "var(--live)" : "var(--text-faint)",
            }}
          />
          <span className="tag-settings-name">{item.name}</span>
          <span>
            {item.delay_hours}h ·{" "}
            {(item.active_days || [])
              .map(
                (day) => ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][day],
              )
              .join(", ")}
          </span>
          <Action
            className="text-action followup-delete"
            data-id={item.id}
            action={async () => {
              await api(`/api/followups/${item.id}`, "DELETE");
              await ctx.load("followups");
            }}
          >
            Excluir
          </Action>
        </div>
      ))
    ) : (
      <Empty>Nenhum follow-up configurado.</Empty>
    );
  if (id === "importContactsResult" && ctx.importResult) {
    const r = ctx.importResult;
    return (
      <>
        <p>
          {r.success
            ? `${r.imported} novo(s), ${r.updated} atualizado(s), ${r.duplicates} repetido(s) agrupado(s) e ${r.rejected} linha(s) rejeitada(s). Destino: ${r.chip?.name || r.chip?.number}.`
            : `${r.rejected || 0} linha(s) rejeitada(s). Nenhum contato foi importado.`}
        </p>
        {!!r.errors?.length && (
          <details>
            <summary>Ver linhas rejeitadas ({r.errors.length})</summary>
            <ul>
              {r.errors.map((item, index) => (
                <li key={index}>
                  Linha {item.line}: {item.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }
  if (id === "submitContactsImport")
    return ctx.busy === id ? "Importando…" : "Importar arquivo";
  const conversations = Object.values(d.state.conversations || {}),
    open = conversations.filter((item) => !item.blocked && !item.isFinalized),
    connected = d.state.status?.connected;
  if (id === "overviewTotal") return open.length;
  if (id === "overviewFinalized")
    return conversations.filter((item) => item.isFinalized).length;
  if (id === "overviewMessages")
    return conversations.reduce(
      (total, item) => total + (item.messages?.length || 0),
      0,
    );
  if (
    ["overviewChannel", "overviewChannelCard", "settingsConnection"].includes(
      id,
    )
  )
    return connected ? "Conectado" : "Desconectado";
  if (id === "settingsProfileInfo")
    return d.state.user?.displayName || d.state.user?.username || "";
  if (id === "overviewDate")
    return new Date().toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "long",
    });
  if (id === "overviewRevenue")
    return money(d.stats.revenue ?? d.stats.kanban?.revenue);
  if (id === "overviewConversion")
    return `${d.stats.conversionRate ?? d.stats.kanban?.conversionRate ?? 0}%`;
  if (id === "overviewList")
    return open.length ? (
      open
        .sort((a, b) =>
          String(b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""),
        )
        .slice(0, 6)
        .map((item) => (
          <Action
            className="overview-row"
            data-number={item.number}
            key={item.number}
            action={() => ctx.openConversation(item.number)}
          >
            <Avatar
              className="contact-avatar"
              number={item.number}
              label={item.name || "Contato"}
              url={item.profilePic || ""}
            />
            <span>
              <strong>{item.name || phone(item.number)}</strong>
              <small>{item.lastMessage || "Sem mensagens"}</small>
            </span>
            <time>{relative(item.lastMessageAt)}</time>
          </Action>
        ))
    ) : (
      <Empty>Nenhuma conversa registrada ainda.</Empty>
    );
  if (id === "activityChart") {
    const days = chart(ctx),
      maximum = Math.max(1, ...days.flatMap((day) => [day.received, day.sent]));
    return days.map((day) => (
      <div
        className="chart-day"
        key={day.date.toISOString()}
        role="img"
        aria-label={`${day.date.toLocaleDateString("pt-BR")}: ${day.received} recebidas e ${day.sent} enviadas`}
      >
        <div className="chart-bars">
          <span
            className="chart-bar received"
            style={{ height: `${(day.received / maximum) * 100}%` }}
            title={`${day.received} recebidas`}
          />
          <span
            className="chart-bar sent"
            style={{ height: `${(day.sent / maximum) * 100}%` }}
            title={`${day.sent} enviadas`}
          />
        </div>
        <span className="chart-date">
          {day.date.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
          })}
        </span>
      </div>
    ));
  }
  if (id === "activityChartSummary") {
    const days = chart(ctx),
      received = days.reduce((sum, day) => sum + day.received, 0),
      sent = days.reduce((sum, day) => sum + day.sent, 0);
    return received + sent
      ? `${received} recebidas · ${sent} enviadas nos últimos ${ctx.chartDays} dias.`
      : `Nenhuma mensagem no histórico dos últimos ${ctx.chartDays} dias.`;
  }
  return undefined;
}
