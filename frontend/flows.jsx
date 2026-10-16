import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  reconnectEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Prism from "prismjs";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Notice } from "./components";
import { api } from "./api";
import schema from "../flows/schema";
import {
  FlowInspector,
  VariablesPanel,
  TriggersPanel,
  SimulatorPanel,
  HistoryPanel,
} from "./flows-panels";
const { blocks, defaults, outputs, validate } = schema;
const uid = () => crypto.randomUUID();
const clone = (value) => JSON.parse(JSON.stringify(value));
const triggerLabel = (trigger) =>
  ({
    message: "Mensagem recebida",
    firstMessage: "Primeira mensagem",
    newContact: "Novo contato",
    keyword: `Palavra-chave: ${trigger.value}`,
    tagAdded: `Tag adicionada: ${trigger.value}`,
    system: "Evento do sistema",
    api: "Evento de API",
    integration: "Evento de integração",
  })[trigger.type] || trigger.type;
function BlockIcon({ kind, size = 17 }) {
  if (kind === "script" || kind === "set" || kind === "switch")
    return (
      <span className="fb-code-icon" aria-hidden="true">
        {"{ }"}
      </span>
    );
  const names = {
    start: "arrowRight",
    trigger: "activity",
    text: "conversation",
    image: "photo",
    audio: "mic",
    video: "photo",
    document: "paperclip",
    menu: "conversation",
    buttons: "conversation",
    quickReply: "conversation",
    condition: "transfer",
    chipCondition: "activity",
    tagCondition: "tag",
    distribute: "user",
    finish: "doubleCheck",
    hours: "clock",
    moveOpportunity: "arrowUpRight",
    question: "conversation",
    wait: "clock",
    random: "transfer",
    redirect: "transfer",
    http: "activity",
    tags: "tag",
    delay: "clock",
    stop: "stop",
  };
  return <Icon name={names[kind] || "activity"} size={size} />;
}
export function cleanDefinition(def) {
  return schema.normalizeDefinition({
    ...def,
    nodes: def.nodes.map(({ id, position, data }) => ({
      id,
      position,
      data,
      type: "flowBlock",
    })),
    edges: def.edges.map(({ id, source, target, sourceHandle }) => ({
      id,
      source,
      target,
      sourceHandle: sourceHandle || "next",
      type: "default",
    })),
  });
}
const signature = (name, def) => JSON.stringify([name, cleanDefinition(def)]);
export function downloadFlow(value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = (value.name || "fluxo").replace(/[^\p{L}\w-]/gu, "_") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const FlowBlock = memo(function FlowBlock({ id, data, selected }) {
  const ports = outputs({ data }),
    kind = blocks[data.kind];
  return (
    <article
      className={`fb-node ${selected ? "is-selected" : ""} ${data.running ? "is-running" : ""}`}
    >
      {!["start", "trigger"].includes(data.kind) && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          aria-label={`Entrada ${data.label}`}
        />
      )}
      <div className="fb-node-head">
        <span className="fb-node-icon">
          <BlockIcon kind={data.kind} />
        </span>
        <strong>{data.label || kind?.label}</strong>
        <small>{id.slice(0, 5)}</small>
      </div>
      <p className="fb-node-preview">
        {data.config.text ||
          data.config.caption ||
          data.config.variable ||
          data.config.reason ||
          kind?.label}
      </p>
      {ports.map((port) => (
        <div className="fb-port" key={port}>
          <span>
            {data.config.options?.find((o) => String(o.id) === port)?.label ||
              {
                next: "Continuar",
                timeout: "Tempo esgotado",
                true: "Verdadeiro",
                false: "Falso",
              }[port] ||
              port}
          </span>
          <Handle
            id={port}
            type="source"
            position={Position.Right}
            aria-label={`Saída ${port}`}
          />
        </div>
      ))}
    </article>
  );
});
const nodeTypes = { flowBlock: FlowBlock };
export function FlowsPage({ ctx }) {
  const [editing, setEditing] = useState(null),
    [search, setSearch] = useState(""),
    [panel, setPanel] = useState(null),
    [busy, setBusy] = useState(false),
    [newName, setNewName] = useState(""),
    [creating, setCreating] = useState(false);
  const input = useRef(null),
    canEdit = ctx.can("fluxos.editar");
  const task = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => ctx.load("flows");
  const open = async (row) =>
    setEditing((await api(`/api/flows/${row.id}`)).flow);
  const create = async (template) => {
    const row = (
      await api("/api/flows", "POST", {
        name:
          newName.trim() ||
          (template ? "Atendimento por horário" : "Novo fluxo"),
        template,
      })
    ).flow;
    await refresh();
    setCreating(false);
    setNewName("");
    setEditing(row);
  };
  if (editing)
    return createPortal(
      <ReactFlowProvider>
        <FlowEditor
          key={editing.id}
          flow={editing}
          ctx={ctx}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
          onSaved={refresh}
        />
      </ReactFlowProvider>,
      document.body,
    );
  const rows = ctx.data.flows.filter((f) =>
    f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section
      className="page-view is-active page-panel fb-page"
      id="flowsPage"
      data-page-view="flows"
      data-react-component="flows"
    >
      <link rel="stylesheet" href="/assets/js/site.css" />
      <header className="fb-page-heading">
        <div>
          <p className="eyebrow">AUTOMAÇÃO DE ATENDIMENTO</p>
          <h2>Chatbots de fluxo</h2>
          <p>Crie conversas que seguem o caminho certo, a qualquer hora.</p>
        </div>
        <div className="fb-actions">
          {ctx.can("fluxos.criar") && (
            <>
              <button onClick={() => input.current.click()} disabled={busy}>
                <span className="fb-icon-upload">
                  <Icon name="download" size={16} />
                </span>{" "}
                Importar Fluxo
              </button>
              <button
                className="fb-primary"
                id="newFlowBtn"
                onClick={() => setCreating(true)}
              >
                + Novo Fluxo
              </button>
            </>
          )}
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = "";
          if (file)
            task(async () => {
              if (file.size > 2000000)
                throw new Error("Arquivo maior que 2 MB.");
              await api("/api/flows", "POST", {
                import: JSON.parse(await file.text()),
              });
              await refresh();
              ctx.notify("Fluxo importado como rascunho.", "success");
            });
        }}
      />
      <div className="fb-list-tools">
        <label className="fb-search">
          <Icon name="search" size={17} />
          <input
            aria-label="Pesquisar fluxos"
            placeholder="Pesquisar por nome do fluxo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span>
          {rows.length} {rows.length === 1 ? "fluxo" : "fluxos"}
        </span>
        <button onClick={() => setPanel({ type: "variables" })}>
          Variáveis Globais
        </button>
      </div>
      <div className="fb-table-wrap">
        <table className="fb-table">
          <thead>
            <tr>
              <th>Nome do fluxo</th>
              <th>Gatilhos ativos</th>
              <th>Status</th>
              <th>Última atualização</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    className="fb-flow-name"
                    onClick={() => task(() => open(row))}
                  >
                    <span className="fb-flow-symbol">
                      <Icon name="activity" size={21} />
                    </span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {row.definition.nodes.length} blocos ·{" "}
                        {row.published_version
                          ? `versão ${row.published_version}`
                          : "rascunho"}
                      </small>
                      {row.automation?.unpublishedChanges && (
                        <small>Alterações aguardando publicação</small>
                      )}
                    </span>
                  </button>
                </td>
                <td>
                  <button
                    disabled={!canEdit || busy}
                    className={`fb-pill ${row.triggers_enabled ? "is-on" : ""}`}
                    onClick={() =>
                      task(async () => {
                        await api(`/api/flows/${row.id}`, "PUT", {
                          revision: row.revision,
                          triggers_enabled: !row.triggers_enabled,
                        });
                        await refresh();
                      })
                    }
                  >
                    {row.triggers_enabled
                      ? `${row.automation?.triggers.length || 0} publicados`
                      : "Desativados"}
                  </button>
                </td>
                <td>
                  <button
                    disabled={!canEdit || busy}
                    className={`fb-pill ${row.automation?.status === "ready" ? "is-on" : ""}`}
                    onClick={() =>
                      task(async () => {
                        await api(`/api/flows/${row.id}`, "PUT", {
                          revision: row.revision,
                          active: !row.active,
                        });
                        await refresh();
                      })
                    }
                  >
                    {row.active
                      ? row.automation?.status === "draft"
                        ? "Publicação pendente"
                        : row.automation?.status === "manual"
                          ? "Sem gatilho automático"
                          : row.automation?.status === "disabled"
                            ? "Gatilhos desativados"
                            : "● Ativo"
                      : row.published_version
                        ? "Pausado"
                        : "Rascunho"}
                  </button>
                </td>
                <td>
                  <time>
                    {new Date(row.updated_at).toLocaleString("pt-BR")}
                  </time>
                </td>
                <td>
                  <div className="fb-row-actions">
                    <button
                      aria-label={`Editar ${row.name}`}
                      title="Abrir editor"
                      onClick={() => task(() => open(row))}
                    >
                      Editar
                    </button>
                    {canEdit && (
                      <button
                        title="Testar fluxo"
                        onClick={() =>
                          setPanel({ type: "simulate", flow: row })
                        }
                      >
                        <Icon name="arrowRight" size={16} />
                      </button>
                    )}
                    <button
                      title="Histórico"
                      onClick={() => setPanel({ type: "history", flow: row })}
                    >
                      <Icon name="clock" size={16} />
                    </button>
                    <button
                      title="Exportar"
                      onClick={() =>
                        task(async () =>
                          downloadFlow(
                            await api(`/api/flows/${row.id}/export`),
                          ),
                        )
                      }
                    >
                      <Icon name="download" size={16} />
                    </button>
                    {ctx.can("fluxos.criar") && (
                      <button
                        title="Duplicar"
                        onClick={() =>
                          task(async () => {
                            await api(`/api/flows/${row.id}/duplicate`, "POST");
                            await refresh();
                          })
                        }
                      >
                        <Icon name="copy" size={16} />
                      </button>
                    )}
                    {ctx.can("fluxos.excluir") && (
                      <button
                        title="Excluir"
                        className="fb-danger"
                        onClick={() =>
                          task(async () => {
                            if (
                              await ctx.confirm({
                                title: "Excluir fluxo?",
                                body: `O fluxo “${row.name}” será excluído.`,
                                okText: "Excluir",
                              })
                            ) {
                              await api(`/api/flows/${row.id}`, "DELETE", {
                                confirm: true,
                              });
                              await refresh();
                            }
                          })
                        }
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="fb-empty">
            <span>⌘</span>
            <h3>
              {search
                ? "Nenhum fluxo encontrado"
                : "Seu próximo atendimento começa aqui"}
            </h3>
            <p>
              {search
                ? "Experimente outro nome."
                : "Crie um fluxo, conecte os blocos e teste sua automação."}
            </p>
          </div>
        )}
      </div>
      {creating && (
        <aside className="fb-drawer">
          <PanelHead title="Novo fluxo" close={() => setCreating(false)} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              task(() => create());
            }}
          >
            <label>
              Nome do fluxo
              <input
                autoFocus
                aria-label="Nome do fluxo"
                value={newName}
                maxLength={120}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </label>
            <button className="fb-primary" disabled={busy}>
              Criar fluxo vazio
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => task(() => create("reference"))}
            >
              Usar modelo de atendimento por horário
            </button>
            <p className="fb-help">
              O modelo é um rascunho. Configure departamentos, links e catálogos
              da sua empresa antes de publicar.
            </p>
          </form>
        </aside>
      )}
      {panel && (
        <aside className="fb-drawer fb-drawer-wide">
          <PanelHead
            title={
              panel.type === "variables"
                ? "Variáveis Globais"
                : panel.type === "history"
                  ? "Histórico de execução"
                  : "Testar Fluxo"
            }
            close={() => setPanel(null)}
          />
          {panel.type === "variables" ? (
            <VariablesPanel ctx={ctx} />
          ) : panel.type === "history" ? (
            <HistoryPanel flow={panel.flow} ctx={ctx} />
          ) : (
            <SimulatorPanel
              flow={panel.flow}
              definition={panel.flow.definition}
              ctx={ctx}
            />
          )}
        </aside>
      )}
    </section>
  );
}
export function PanelHead({ title, close }) {
  return (
    <div className="fb-panel-head">
      <h3>{title}</h3>
      <button type="button" onClick={close} aria-label="Fechar painel">
        ×
      </button>
    </div>
  );
}

function FlowEditor({ flow, ctx, onClose, onSaved }) {
  useEffect(() => {
    const root = document.getElementById("site-root"),
      previous = document.activeElement,
      wasInert = root?.inert;
    document.body.classList.add("has-flow-editor");
    if (root) root.inert = !ctx.contactsBlocked;
    document
      .querySelector('.fb-editor [aria-label="Voltar para fluxos"]')
      ?.focus({ preventScroll: true });
    return () => {
      document.body.classList.remove("has-flow-editor");
      if (root) root.inert = wasInert;
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[inert]"))
          previous.focus({ preventScroll: true });
        else
          document.getElementById("newFlowBtn")?.focus({ preventScroll: true });
      });
    };
  }, [ctx.contactsBlocked]);
  const [def, setDef] = useState(() => clone(flow.definition)),
    [name, setName] = useState(flow.name),
    [revision, setRevision] = useState(flow.revision),
    [liveFlow, setLiveFlow] = useState(flow),
    [saved, setSaved] = useState(() => signature(flow.name, flow.definition)),
    [panel, setPanel] = useState(null),
    [selected, setSelected] = useState(null),
    [search, setSearch] = useState(""),
    [saving, setSaving] = useState(false),
    [issues, setIssues] = useState(null),
    [runState, setRunState] = useState(null),
    [undoCount, setUndoCount] = useState(0),
    [recovery, setRecovery] = useState(null);
  const instance = useReactFlow(),
    current = useRef(null),
    history = useRef({ past: [], future: [] }),
    clipboard = useRef(null),
    lastSaved = useRef({ name: flow.name, definition: clone(flow.definition) }),
    revisionRef = useRef(flow.revision),
    savingRef = useRef(false),
    reconnecting = useRef(null),
    canvas = useRef(null);
  const editable = ctx.can("fluxos.editar"),
    dirty = signature(name, def) !== saved,
    key = `convelya-flow:${ctx.access?.accountId || ctx.authorization?.accountId || "account"}:${flow.id}`;
  current.current = { def, name, dirty, revision };
  const change = useCallback(
    (value, record = true) => {
      if (!editable) return;
      setDef((old) => {
        const next = schema.normalizeDefinition(
          typeof value === "function" ? value(old) : value,
        );
        if (record) {
          history.current.past.push(clone(old));
          history.current.past = history.current.past.slice(-80);
          history.current.future = [];
          setUndoCount((v) => v + 1);
        }
        return next;
      });
    },
    [editable],
  );
  const undo = () => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(clone(current.current.def));
    setDef(h.past.pop());
    setUndoCount((v) => v + 1);
  };
  const redo = () => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(clone(current.current.def));
    setDef(h.future.pop());
    setUndoCount((v) => v + 1);
  };
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (
        stored &&
        stored.revision === flow.revision &&
        signature(stored.name, stored.definition) !== saved
      )
        setRecovery(stored);
    } catch {}
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            name,
            definition: cleanDefinition(def),
            revision: revisionRef.current,
          }),
        );
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [def, name, dirty]);
  useEffect(() => {
    const before = (e) => {
      if (current.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const validateFields = () => {
    const invalid = document.querySelector(".fb-editor .fb-json:invalid");
    if (!invalid) return true;
    invalid.reportValidity();
    ctx.notify("Corrija o JSON inválido antes de salvar ou publicar.");
    return false;
  };
  const save = useCallback(async () => {
    if (!validateFields()) return null;
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    try {
      const snapshot = current.current,
        definition = cleanDefinition(snapshot.def),
        validation = validate(definition);
      setIssues(validation);
      if (validation.errors.length)
        throw new Error(validation.errors.join("\n"));
      const result = (
        await api(`/api/flows/${flow.id}`, "PUT", {
          name: snapshot.name,
          definition,
          trigger_chips: definition.settings.chipIds || [],
          revision: revisionRef.current,
        })
      ).flow;
      revisionRef.current = result.revision;
      setRevision(result.revision);
      setLiveFlow(result);
      setSaved(signature(snapshot.name, definition));
      lastSaved.current = { name: snapshot.name, definition };
      if (
        signature(current.current.name, current.current.def) ===
        signature(snapshot.name, definition)
      )
        localStorage.removeItem(key);
      onSaved();
      return result;
    } catch (e) {
      ctx.notify(e.message);
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [flow.id]);
  useEffect(() => {
    if (!def.settings.autosave || !dirty || !editable) return;
    const timer = setTimeout(save, 3000);
    return () => clearTimeout(timer);
  }, [def, name, dirty, save]);
  const close = async () => {
    if (
      dirty &&
      !(await ctx.confirm({
        title: "Sair do editor?",
        body: "Há alterações não salvas. Uma cópia de recuperação ficará neste navegador.",
        okText: "Sair sem salvar",
      }))
    )
      return;
    onClose();
  };
  useEffect(() => {
    const nav = async (e) => {
      const a = e.target.closest("a[data-page]");
      if (!a || !current.current.dirty) return;
      e.preventDefault();
      e.stopPropagation();
      if (
        await ctx.confirm({
          title: "Sair do editor?",
          body: "Há alterações não salvas. O rascunho local poderá ser recuperado.",
          okText: "Sair sem salvar",
        })
      )
        ctx.navigate(a.dataset.page);
    };
    document.addEventListener("click", nav, true);
    return () => document.removeEventListener("click", nav, true);
  }, []);
  const add = useCallback(
    (kind, position) => {
      if (!editable) return;
      if (
        ["start", "trigger"].includes(kind) &&
        current.current.def.nodes.some((n) =>
          ["start", "trigger"].includes(n.data.kind),
        )
      ) {
        ctx.notify("O fluxo já possui um início.");
        return;
      }
      const node = {
        id: uid(),
        type: "flowBlock",
        position:
          position ||
          instance.screenToFlowPosition({
            x: canvas.current.getBoundingClientRect().left + 360,
            y: canvas.current.getBoundingClientRect().top + 160,
          }),
        data: { kind, label: blocks[kind].label, config: defaults(kind) },
      };
      change((old) => ({ ...old, nodes: [...old.nodes, node] }));
      setSelected(node.id);
      setPanel("properties");
    },
    [change, instance, editable],
  );
  const copy = () => {
    const d = current.current.def,
      nodes = d.nodes.filter(
        (n) => n.selected && !["start", "trigger"].includes(n.data.kind),
      );
    clipboard.current = {
      nodes: clone(nodes),
      edges: clone(
        d.edges.filter(
          (e) =>
            nodes.some((n) => n.id === e.source) &&
            nodes.some((n) => n.id === e.target),
        ),
      ),
    };
  };
  const paste = () => {
    if (!clipboard.current?.nodes.length) return;
    const c = clone(clipboard.current),
      ids = new Map(c.nodes.map((n) => [n.id, uid()]));
    c.nodes.forEach((n) => {
      n.id = ids.get(n.id);
      n.position = { x: n.position.x + 60, y: n.position.y + 60 };
      n.selected = true;
    });
    c.edges.forEach((e) => {
      e.id = uid();
      e.source = ids.get(e.source);
      e.target = ids.get(e.target);
    });
    change((old) => ({
      ...old,
      nodes: [...old.nodes.map((n) => ({ ...n, selected: false })), ...c.nodes],
      edges: [...old.edges, ...c.edges],
    }));
  };
  const remove = () => {
    change((old) => {
      const ids = new Set(
        old.nodes
          .filter(
            (n) => n.selected && !["start", "trigger"].includes(n.data.kind),
          )
          .map((n) => n.id),
      );
      return {
        ...old,
        nodes: old.nodes.filter((n) => !ids.has(n.id)),
        edges: old.edges.filter(
          (e) => !e.selected && !ids.has(e.source) && !ids.has(e.target),
        ),
      };
    });
    setSelected(null);
  };
  useEffect(() => {
    const keydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (editable) save();
        return;
      }
      if (e.target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (editable) save();
        }
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (editable) e.shiftKey ? redo() : undo();
        }
        if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          if (editable) redo();
        }
        if (e.key.toLowerCase() === "c") {
          e.preventDefault();
          copy();
        }
        if (e.key.toLowerCase() === "v") {
          e.preventDefault();
          if (editable) paste();
        }
        if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          if (editable) {
            copy();
            paste();
          }
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && editable) {
        e.preventDefault();
        remove();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });
  const isValid = useCallback(
    (c) =>
      !!c.source &&
      !!c.target &&
      c.source !== c.target &&
      !["start", "trigger"].includes(
        current.current.def.nodes.find((n) => n.id === c.target)?.data.kind,
      ) &&
      !current.current.def.edges.some(
        (e) =>
          e.source === c.source &&
          (e.sourceHandle || "next") === (c.sourceHandle || "next") &&
          e.id !== c.id &&
          e.id !== reconnecting.current,
      ),
    [],
  );
  const connect = useCallback(
    (connection) => {
      if (!isValid(connection)) return;
      const next = {
        ...current.current.def,
        edges: [
          ...current.current.def.edges,
          { ...connection, id: uid(), type: "default" },
        ],
      };
      change(next);
      setIssues(validate(cleanDefinition(next)));
    },
    [change, isValid],
  );
  const updateNode = (id, patch) =>
    change((old) => ({
      ...old,
      nodes: old.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                ...(typeof patch === "function" ? patch(n.data) : patch),
              },
            }
          : n,
      ),
    }));
  const node = def.nodes.find((n) => n.id === selected),
    filtered = Object.values(blocks).filter((b) =>
      b.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
    groups = [...new Set(filtered.map((b) => b.category))];
  const nodes = useMemo(
    () =>
      def.nodes.map((n) => ({
        ...n,
        data: { ...n.data, running: runState?.current === n.id },
      })),
    [def.nodes, runState?.current],
  );
  const edges = useMemo(
    () =>
      def.edges.map((e) => ({
        ...e,
        animated: !!runState?.trace?.some((t) => t.edgeId === e.id),
        style: {
          stroke: runState?.trace?.some((t) => t.edgeId === e.id)
            ? "var(--live)"
            : "var(--brand)",
          strokeWidth: 2,
        },
      })),
    [def.edges, runState],
  );
  return (
    <section
      className="fb-editor"
      id="flowsPage"
      data-page-view="flows"
      aria-label="Editor de fluxo"
      inert={ctx.contactsBlocked}
    >
      <link rel="stylesheet" href="/assets/js/site.css" />
      <Notice />
      <header className="fb-editor-top">
        <button onClick={close} aria-label="Voltar para fluxos">
          <span className="fb-icon-back">
            <Icon name="arrowRight" size={19} />
          </span>
        </button>
        <div className="fb-title">
          <input
            aria-label="Nome do fluxo"
            value={name}
            readOnly={!editable}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
          <small className={dirty ? "is-dirty" : ""}>
            {saving
              ? "Salvando…"
              : dirty
                ? "● Alterações não salvas"
                : `✓ Salvo · revisão ${revision}`}
          </small>
        </div>
        <div className="fb-actions">
          <button
            onClick={() => setPanel(panel === "variables" ? null : "variables")}
          >
            Variáveis Globais
          </button>
          <button
            onClick={() =>
              downloadFlow({
                format: "convelya-flow",
                schemaVersion: 1,
                name,
                definition: cleanDefinition(def),
              })
            }
          >
            Exportar
          </button>
          {editable && (
            <>
              <button
                onClick={async () => {
                  if (
                    await ctx.confirm({
                      title: "Redefinir alterações?",
                      body: "O editor voltará ao último salvamento.",
                      okText: "Redefinir",
                    })
                  ) {
                    change(clone(lastSaved.current.definition));
                    setName(lastSaved.current.name);
                  }
                }}
              >
                Redefinir
              </button>
              <button disabled={saving || !dirty} onClick={save}>
                Salvar
              </button>
              <button
                className="fb-primary"
                disabled={saving}
                onClick={async () => {
                  if (!validateFields()) return;
                  const row = dirty
                    ? await save()
                    : { revision: revisionRef.current };
                  if (!row) return;
                  if (
                    signature(current.current.name, current.current.def) !==
                    signature(
                      lastSaved.current.name,
                      lastSaved.current.definition,
                    )
                  ) {
                    ctx.notify(
                      "Há novas alterações. Salve novamente antes de publicar.",
                    );
                    return;
                  }
                  const result = validate(
                    cleanDefinition(current.current.def),
                    true,
                  );
                  setIssues(result);
                  if (result.errors.length) return;
                  try {
                    const published = await api(
                      `/api/flows/${flow.id}/publish`,
                      "POST",
                      {
                        revision: row.revision,
                      },
                    );
                    setLiveFlow(published.flow);
                    ctx.notify("Versão publicada e fluxo ativado.", "success");
                    onSaved();
                  } catch (e) {
                    ctx.notify(e.message);
                  }
                }}
              >
                Publicar
              </button>
              <button
                className="fb-test"
                onClick={() => {
                  setPanel("simulate");
                  setRunState(null);
                }}
              >
                <Icon name="arrowRight" size={16} /> Testar Fluxo
              </button>
            </>
          )}
          <button title="Histórico" onClick={() => setPanel("history")}>
            <Icon name="clock" size={16} />
          </button>
        </div>
      </header>
      <div className="fb-automation-status" role="status">
        <span>
          {liveFlow.automation?.status === "ready"
            ? `WhatsApp: ativo · versão ${liveFlow.published_version} · ${liveFlow.automation.triggers.map(triggerLabel).join("; ")}.`
            : liveFlow.automation?.status === "manual"
              ? "WhatsApp: sem gatilho automático. Configure Mensagem recebida para responder aos clientes."
              : liveFlow.automation?.status === "disabled"
                ? "WhatsApp: gatilhos desativados na lista de fluxos."
                : liveFlow.automation?.status === "paused"
                  ? "WhatsApp: fluxo pausado."
                  : "WhatsApp: publique o fluxo para ativar as respostas automáticas."}
          {(dirty || liveFlow.automation?.unpublishedChanges) &&
          liveFlow.published_version
            ? " Há alterações no rascunho; publique para aplicá-las ao WhatsApp."
            : ""}
        </span>
        <button onClick={() => setPanel("triggers")}>Ver gatilhos</button>
      </div>
      {recovery && (
        <div className="fb-recovery">
          Há um rascunho local desta revisão.
          <button
            onClick={() => {
              change(recovery.definition);
              setName(recovery.name);
              setRecovery(null);
            }}
          >
            Recuperar alterações
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(key);
              setRecovery(null);
            }}
          >
            Descartar cópia
          </button>
        </div>
      )}
      <div className="fb-editor-body">
        <aside className="fb-library">
          <div className="fb-library-title">
            <span>BLOCOS DO FLUXO</span>
            <small>Arraste para o canvas</small>
          </div>
          <label className="fb-search">
            <input
              aria-label="Pesquisar blocos"
              placeholder="Pesquisar blocos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="fb-library-scroll">
            {groups.map((group) => (
              <section key={group}>
                <h4>{group}</h4>
                {filtered
                  .filter((b) => b.category === group)
                  .map((b) => (
                    <button
                      key={b.type}
                      data-block-kind={b.type}
                      disabled={!editable}
                      draggable={editable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/convelya-block",
                          b.type,
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => add(b.type)}
                    >
                      <span>
                        <BlockIcon kind={b.type} />
                      </span>
                      {b.label}
                      <small>+</small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          <button
            className="fb-config-button"
            onClick={() => setPanel("triggers")}
          >
            <Icon name="activity" size={16} /> Gatilhos e configurações
          </button>
          <p className="fb-help">
            Shift + arrastar: selecionar
            <br />
            Ctrl+C / Ctrl+V: copiar e colar
            <br />
            Ctrl+Z: desfazer · Delete: excluir
          </p>
        </aside>
        <main
          className="fb-canvas"
          ref={canvas}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const kind = e.dataTransfer.getData("application/convelya-block");
            if (blocks[kind])
              add(
                kind,
                instance.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
              );
          }}
        >
          <div className="fb-canvas-toolbar">
            <button
              disabled={!editable || !history.current.past.length}
              onClick={undo}
              title="Desfazer"
            >
              ↶
            </button>
            <button
              disabled={!editable || !history.current.future.length}
              onClick={redo}
              title="Refazer"
            >
              ↷
            </button>
            <span />
            <button
              onClick={() =>
                instance.fitView({
                  padding: 0.2,
                  maxZoom: 1,
                  duration: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? 0
                    : 200,
                })
              }
            >
              Ajustar à tela
            </button>
            <button
              onClick={() =>
                instance.setViewport(
                  { x: 60, y: 80, zoom: 1 },
                  { duration: 200 },
                )
              }
            >
              Centralizar
            </button>
            <button
              onClick={() => {
                copy();
                paste();
              }}
              disabled={!editable}
            >
              Duplicar seleção
            </button>
            <button onClick={remove} disabled={!editable}>
              Excluir seleção
            </button>
            <button
              onClick={() => setIssues(validate(cleanDefinition(def), true))}
            >
              Validar
            </button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              const structural = changes.some(
                (c) => c.type === "position" || c.type === "remove",
              );
              const filtered = changes.filter(
                (c) =>
                  c.type !== "remove" ||
                  !["start", "trigger"].includes(
                    current.current.def.nodes.find((n) => n.id === c.id)?.data
                      .kind,
                  ),
              );
              if (structural && editable)
                change(
                  (old) => ({
                    ...old,
                    nodes: applyNodeChanges(filtered, old.nodes),
                  }),
                  false,
                );
              else
                setDef((old) => ({
                  ...old,
                  nodes: applyNodeChanges(
                    changes.filter((c) =>
                      ["select", "dimensions"].includes(c.type),
                    ),
                    old.nodes,
                  ),
                }));
            }}
            onEdgesChange={(changes) => {
              if (changes.some((c) => c.type === "remove") && editable)
                change((old) => ({
                  ...old,
                  edges: applyEdgeChanges(changes, old.edges),
                }));
              else
                setDef((old) => ({
                  ...old,
                  edges: applyEdgeChanges(
                    changes.filter((c) => c.type === "select"),
                    old.edges,
                  ),
                }));
            }}
            onNodeDragStart={() => {
              history.current.past.push(clone(current.current.def));
              history.current.future = [];
              setUndoCount((v) => v + 1);
            }}
            onConnect={connect}
            isValidConnection={isValid}
            onReconnectStart={(_, edge) => {
              reconnecting.current = edge.id;
            }}
            onReconnectEnd={() => {
              reconnecting.current = null;
            }}
            onReconnect={(old, connection) => {
              const others = current.current.def.edges.filter(
                (e) => e.id !== old.id,
              );
              if (
                connection.source !== connection.target &&
                !others.some(
                  (e) =>
                    e.source === connection.source &&
                    e.sourceHandle === connection.sourceHandle,
                )
              )
                change((d) => ({
                  ...d,
                  edges: reconnectEdge(old, connection, d.edges),
                }));
            }}
            onNodeClick={(_, node) => {
              setSelected(node.id);
              setPanel("properties");
            }}
            onPaneClick={() => setSelected(null)}
            nodesDraggable={editable}
            nodesConnectable={editable}
            edgesReconnectable={editable}
            deleteKeyCode={null}
            multiSelectionKeyCode={["Control", "Meta"]}
            selectionKeyCode="Shift"
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
            minZoom={0.15}
            maxZoom={2}
            onlyRenderVisibleElements
            colorMode={ctx.theme === "light" ? "light" : "dark"}
            defaultEdgeOptions={{ type: "default" }}
          >
            <Background color="var(--border)" gap={22} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor="var(--brand)"
              maskColor="color-mix(in srgb, var(--bg) 82%, transparent)"
              pannable
              zoomable
              position="bottom-right"
            />
          </ReactFlow>
          <div className="fb-canvas-meta">
            {def.nodes.length} blocos · {def.edges.length} conexões{" "}
            <span>Execução definida pelas conexões</span>
          </div>
          {issues &&
            (issues.errors.length > 0 || issues.warnings.length > 0) && (
              <div className="fb-validation" role="status">
                <button
                  onClick={() => setIssues(null)}
                  aria-label="Fechar validação"
                >
                  ×
                </button>
                <strong>
                  {issues.errors.length
                    ? "Revise antes de publicar"
                    : "Atenção ao fluxo"}
                </strong>
                {[...issues.errors, ...issues.warnings].map((text, i) => (
                  <p key={i}>{text}</p>
                ))}
              </div>
            )}
        </main>
        {panel && (
          <aside
            className={`fb-properties ${panel === "simulate" ? "fb-simulator-panel" : ""}`}
          >
            <PanelHead
              title={
                {
                  properties: "Configurar bloco",
                  variables: "Variáveis Globais",
                  triggers: "Gatilhos e configurações",
                  simulate: "Testar Fluxo",
                  history: "Histórico",
                }[panel]
              }
              close={() => setPanel(null)}
            />
            {panel === "properties" &&
              (node ? (
                <FlowInspector
                  key={node.id}
                  node={node}
                  definition={def}
                  ctx={{ ...ctx, flowEditorId: flow.id }}
                  editable={editable}
                  onChange={(patch) => updateNode(node.id, patch)}
                  onDelete={() => {
                    change((d) => ({
                      ...d,
                      nodes: d.nodes.filter((n) => n.id !== node.id),
                      edges: d.edges.filter(
                        (e) => e.source !== node.id && e.target !== node.id,
                      ),
                    }));
                    setSelected(null);
                  }}
                />
              ) : (
                <p className="fb-help">
                  Selecione um bloco para editar suas propriedades.
                </p>
              ))}
            {panel === "variables" && (
              <VariablesPanel
                ctx={ctx}
                definition={def}
                onDefinition={change}
                editable={editable}
              />
            )}
            {panel === "triggers" && (
              <TriggersPanel
                definition={def}
                onChange={change}
                editable={editable}
              />
            )}
            {panel === "simulate" && (
              <SimulatorPanel
                flow={{ ...flow, name }}
                definition={cleanDefinition(def)}
                ctx={ctx}
                onState={setRunState}
              />
            )}
            {panel === "history" && (
              <HistoryPanel
                flow={flow}
                ctx={ctx}
                onRestore={(definition) => change(definition)}
              />
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
export function CodeEditor({ value, onChange }) {
  const ref = useRef(null);
  const highlighted = useMemo(
    () => Prism.highlight(value, Prism.languages.javascript, "javascript"),
    [value],
  );
  return (
    <div className="fb-code">
      <pre ref={ref} aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: highlighted + "\n" }} />
      </pre>
      <textarea
        spellCheck={false}
        aria-label="Código JavaScript"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          ref.current.scrollTop = e.target.scrollTop;
          ref.current.scrollLeft = e.target.scrollLeft;
        }}
      />
    </div>
  );
}
