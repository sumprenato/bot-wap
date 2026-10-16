import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { CodeEditor, downloadFlow } from "./flows";
import schema from "../flows/schema";
const { blocks, interpolate } = schema;
const parse = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
export function JsonField({ label, value, onChange, disabled = false }) {
  const input = useRef(null);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)),
    [error, setError] = useState("");
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setError("");
    input.current?.setCustomValidity("");
  }, [JSON.stringify(value)]);
  return (
    <label>
      {label}
      <textarea
        ref={input}
        className="fb-json"
        aria-label={label}
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            JSON.parse(e.target.value);
            e.target.setCustomValidity("");
          } catch {
            e.target.setCustomValidity(
              "JSON inválido. Corrija o campo para aplicar a alteração.",
            );
          }
        }}
        onBlur={() => {
          try {
            const next = JSON.parse(text);
            onChange(next);
            setError("");
          } catch {
            setError(
              "JSON inválido. Corrija o campo para aplicar a alteração.",
            );
          }
        }}
      />
      {error && (
        <small className="fb-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
function MessageField({ value, onChange, definition, ctx, label }) {
  const ref = useRef(null),
    [open, setOpen] = useState(false);
  const tokens = [
    "contato.nome",
    "contato.telefone",
    "atendimento.protocolo",
    "empresa.nome",
    ...(definition.variables || []).map((v) => "fluxo." + v.key),
    ...ctx.data.variables.map((v) => "global." + v.key),
  ];
  const insert = (token) => {
    const el = ref.current,
      start = value.slice(0, el.selectionStart).endsWith("{{")
        ? el.selectionStart - 2
        : el.selectionStart,
      end = el.selectionEnd,
      next = value.slice(0, start) + `{{${token}}}` + value.slice(end);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length + 4, start + token.length + 4);
    });
  };
  return (
    <label>
      {label}
      <textarea
        ref={ref}
        value={value || ""}
        placeholder="Olá, {{contato.nome}}!"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(
            e.target.value.slice(0, e.target.selectionStart).endsWith("{{"),
          );
        }}
      />
      <div className="fb-inline-actions">
        <button type="button" onClick={() => setOpen(!open)}>
          {"{ }"} Inserir variável
        </button>
        <button type="button" onClick={() => insert("contato.nome")}>
          Nome do contato
        </button>
        <button type="button" onClick={() => onChange((value || "") + " 😊")}>
          😊
        </button>
      </div>
      {open && (
        <div className="fb-token-list">
          {tokens.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => insert(t)}
            >{`{{${t}}}`}</button>
          ))}
        </div>
      )}
    </label>
  );
}
export function FlowInspector({
  node,
  definition,
  onChange,
  onDelete,
  ctx,
  editable,
}) {
  const block = blocks[node.data.kind],
    c = node.data.config,
    [busy, setBusy] = useState(false),
    [test, setTest] = useState(null);
  if (!block)
    return (
      <div className="fb-panel-content">
        <p className="fb-error">
          Este bloco legado não possui um processador compatível. A configuração
          original foi preservada no JSON. Substitua-o por um bloco da
          biblioteca antes de publicar.
        </p>
        <pre>{JSON.stringify(node.data.config, null, 2)}</pre>
        {editable && (
          <button className="fb-danger" onClick={onDelete}>
            Excluir bloco legado
          </button>
        )}
      </div>
    );
  const config = (key, value) => onChange({ config: { ...c, [key]: value } });
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("kind", node.data.kind);
      data.append("file", file);
      const { asset } = await api("/api/flows-assets", "POST", data);
      onChange((current) => ({
        config: {
          ...current.config,
          assetId: asset.id,
          assetName: asset.fileName,
          assetMime: asset.mimeType,
        },
      }));
    } catch (e) {
      ctx.notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const select = (field, options) => (
    <label key={field.key}>
      {field.label}
      <select
        value={c[field.key] ?? ""}
        onChange={(e) => config(field.key, e.target.value)}
      >
        <option value="">Selecione...</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label || o.name || o.display_name || o.username}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="fb-inspector">
      <span className="fb-section-tag">{block.category}</span>
      <fieldset disabled={!editable}>
        <label>
          Nome do bloco
          <input
            value={node.data.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </label>
        {block.fields.map((field) => {
          const value = c[field.key] ?? field.value;
          if (field.type === "json")
            return (
              <JsonField
                key={field.key}
                label={field.label}
                value={value}
                onChange={(v) => config(field.key, v)}
              />
            );
          if (field.type === "code")
            return (
              <label key={field.key}>
                {field.label}
                <CodeEditor
                  value={value}
                  onChange={(v) => config(field.key, v)}
                />
                <small className="fb-help">
                  Use variables.fluxo, variables.contato e return. Date usa o
                  fuso do fluxo. Sem acesso à rede, arquivos ou servidor.
                </small>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setTest(
                        await api(
                          `/api/flows/${ctx.flowEditorId || definition.flowId || node.data.flowId || "0"}/script-test`,
                          "POST",
                          { code: c.code, variables: { fluxo: {} } },
                        ),
                      );
                    } catch (e) {
                      setTest({ error: e.message });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Testar script
                </button>
                {test && (
                  <pre className={test.error ? "fb-error" : ""}>
                    {JSON.stringify(test, null, 2)}
                  </pre>
                )}
              </label>
            );
          if (field.type === "asset")
            return (
              <label key={field.key}>
                Arquivo ({node.data.kind === "image" ? "até 5 MB" : "até 16 MB"}
                )
                <input
                  type="file"
                  accept={
                    {
                      image: "image/jpeg,image/png,image/webp",
                      audio: "audio/mpeg,audio/ogg,audio/mp4,audio/wav",
                      video: "video/mp4",
                      document: ".pdf,.txt,.docx,.xlsx",
                    }[node.data.kind]
                  }
                  disabled={busy}
                  onChange={(e) => upload(e.target.files[0])}
                />
                {busy && <small>Enviando arquivo…</small>}
                {value && (
                  <>
                    <a
                      href={`/api/flows-assets/${value}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.assetName || "Abrir arquivo"}
                    </a>
                    {node.data.kind === "image" && (
                      <img
                        className="fb-asset-preview"
                        src={`/api/flows-assets/${value}`}
                        alt={c.assetName || "Imagem configurada"}
                      />
                    )}{" "}
                    {node.data.kind === "audio" && (
                      <audio controls src={`/api/flows-assets/${value}`} />
                    )}{" "}
                    {node.data.kind === "video" && (
                      <video controls src={`/api/flows-assets/${value}`} />
                    )}
                  </>
                )}
              </label>
            );
          if (field.type === "options")
            return (
              <div className="fb-options" key={field.key}>
                <h4>{field.label}</h4>
                {value.map((o, i) => (
                  <div className="fb-option" key={i}>
                    <input
                      aria-label={`Identificador da opção ${i + 1}`}
                      value={o.id}
                      onChange={(e) =>
                        config(
                          field.key,
                          value.map((x, j) =>
                            i === j ? { ...x, id: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`Texto da opção ${i + 1}`}
                      value={o.label}
                      onChange={(e) =>
                        config(
                          field.key,
                          value.map((x, j) =>
                            i === j ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      title="Remover opção"
                      onClick={() =>
                        config(
                          field.key,
                          value.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    let id = 1;
                    while (value.some((o) => String(o.id) === String(id))) id++;
                    config(field.key, [
                      ...value,
                      { id: String(id), label: `Opção ${id}` },
                    ]);
                  }}
                >
                  + Adicionar opção
                </button>
                <p className="fb-help">
                  Cada identificador corresponde a uma saída no bloco. Botões e
                  respostas rápidas usam menu numérico neste provedor.
                </p>
              </div>
            );
          if (field.type === "boolean")
            return (
              <label key={field.key} className="fb-check">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => config(field.key, e.target.checked)}
                />
                {field.label}
              </label>
            );
          if (field.type === "department")
            return select(field, ctx.data.departments);
          if (field.type === "column")
            return select(field, ctx.data.kanban.columns || []);
          if (field.key === "targetId" && c.target === "department")
            return select(field, ctx.data.departments);
          if (field.key === "targetId" && c.target === "flow")
            return select(
              field,
              ctx.data.flows.filter((f) => f.id !== definition.flowId),
            );
          if (field.key === "targetId" && c.target === "user")
            return select(field, ctx.data.team);
          if (
            field.type === "textarea" &&
            ["text", "caption"].includes(field.key)
          )
            return (
              <MessageField
                key={field.key}
                label={field.label}
                value={value}
                onChange={(v) => config(field.key, v)}
                definition={definition}
                ctx={ctx}
              />
            );
          if (field.type === "textarea")
            return (
              <label key={field.key}>
                {field.label}
                <textarea
                  value={value}
                  onChange={(e) => config(field.key, e.target.value)}
                />
              </label>
            );
          return (
            <label key={field.key}>
              {field.label}
              <input
                type={field.type === "number" ? "number" : "text"}
                value={value}
                onChange={(e) =>
                  config(
                    field.key,
                    field.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            </label>
          );
        })}
        {["text", "menu", "buttons", "quickReply", "question"].includes(
          node.data.kind,
        ) && (
          <div className="fb-preview">
            <small>PRÉ-VISUALIZAÇÃO</small>
            <p>
              {interpolate(c.text, {
                contato: { nome: "[nome do contato]" },
                fluxo: Object.fromEntries(
                  (definition.variables || []).map((v) => [v.key, v.default]),
                ),
                global: Object.fromEntries(
                  ctx.data.variables.map((v) => [
                    v.key,
                    schema.decodeVariable(v.value, v.value_type),
                  ]),
                ),
              })}
            </p>
            {c.options?.map((o) => (
              <span key={o.id}>
                {o.id} — {o.label}
              </span>
            ))}
          </div>
        )}
        {!["start", "trigger"].includes(node.data.kind) && (
          <button className="fb-danger" type="button" onClick={onDelete}>
            Excluir bloco
          </button>
        )}
      </fieldset>
      <div className="fb-node-id">ID: {node.id}</div>
    </div>
  );
}
function VariableValue({ type, value, onChange }) {
  if (type === "json")
    return <JsonField label="Valor padrão" value={value} onChange={onChange} />;
  if (type === "boolean")
    return (
      <label>
        Valor padrão
        <select
          aria-label="Valor padrão"
          value={String(value)}
          onChange={(e) => onChange(e.target.value === "true")}
        >
          <option value="true">Verdadeiro</option>
          <option value="false">Falso</option>
        </select>
      </label>
    );
  return (
    <label>
      Valor padrão
      <input
        aria-label="Valor padrão"
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        step={type === "number" ? "any" : undefined}
        value={value ?? ""}
        onChange={(e) =>
          onChange(type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
}
export function VariablesPanel({
  ctx,
  definition,
  onDefinition,
  editable = true,
}) {
  const [scope, setScope] = useState("global"),
    [key, setKey] = useState(""),
    [type, setType] = useState("text"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false);
  const isGlobal = scope === "global",
    rows = isGlobal
      ? ctx.data.variables.map((v) => ({
          key: v.key,
          default: schema.decodeVariable(v.value, v.value_type),
          type:
            v.value_type ||
            (typeof parse(v.value, v.value) === "object"
              ? "json"
              : typeof parse(v.value, v.value) === "number"
                ? "number"
                : typeof parse(v.value, v.value) === "boolean"
                  ? "boolean"
                  : "text"),
        }))
      : definition?.variables || [];
  const usage = (k) =>
    ctx.data.flows
      .filter((f) =>
        JSON.stringify(f.definition).includes(
          `{{${scope === "global" ? "global" : "fluxo"}.${k}}}`,
        ),
      )
      .map((f) => f.name);
  const save = async (e) => {
    e.preventDefault();
    if (!schema.safeKey(key) || key.includes(".")) {
      ctx.notify("Use letras, números e sublinhado no nome da variável.");
      return;
    }
    if (!schema.validVariableValue(type, value)) {
      ctx.notify("O valor não corresponde ao tipo da variável.");
      return;
    }
    setBusy(true);
    try {
      if (isGlobal) {
        await api("/api/global-variables", "POST", {
          key,
          value: JSON.stringify(value),
          valueType: type,
        });
        await ctx.load("variables");
      } else
        onDefinition((d) => ({
          ...d,
          variables: [
            ...(d.variables || []).filter((v) => v.key !== key),
            { key, type, default: value },
          ],
        }));
      setKey("");
      setValue("");
    } catch (e) {
      ctx.notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fb-panel-content">
      <div className="fb-segment">
        <button
          className={isGlobal ? "is-active" : ""}
          onClick={() => setScope("global")}
        >
          Da conta
        </button>
        {definition && (
          <button
            className={!isGlobal ? "is-active" : ""}
            onClick={() => setScope("flow")}
          >
            Da execução
          </button>
        )}
      </div>
      <p className="fb-help">
        Variáveis da conta: {"{{global.chave}}"}. Variáveis de execução:{" "}
        {"{{fluxo.chave}}"}. Contato e atendimento são carregados da conversa e
        isolados por cliente.
      </p>
      <div className="fb-variable-list">
        {rows.map((v) => (
          <article key={v.key}>
            <strong>{`{{${isGlobal ? "global" : "fluxo"}.${v.key}}}`}</strong>
            <small>
              {v.type} · {JSON.stringify(v.default)}
            </small>
            {usage(v.key).length > 0 && (
              <small>Em uso: {usage(v.key).join(", ")}</small>
            )}
            <div className="fb-inline-actions">
              {editable && ctx.can("fluxos.editar") && (
                <button
                  onClick={() => {
                    setKey(v.key);
                    setType(v.type);
                    setValue(v.default);
                  }}
                >
                  Editar
                </button>
              )}
              {editable && ctx.can("fluxos.excluir") && (
                <button
                  className="fb-danger"
                  onClick={async () => {
                    if (
                      !(await ctx.confirm({
                        title: "Excluir variável?",
                        body: `A variável ${v.key} pode estar em uso nos fluxos indicados.`,
                        okText: "Excluir",
                      }))
                    )
                      return;
                    try {
                      if (isGlobal) {
                        await api(
                          `/api/global-variables/${encodeURIComponent(v.key)}`,
                          "DELETE",
                        );
                        await ctx.load("variables");
                      } else
                        onDefinition((d) => ({
                          ...d,
                          variables: d.variables.filter((x) => x.key !== v.key),
                        }));
                    } catch (e) {
                      ctx.notify(e.message);
                    }
                  }}
                >
                  Excluir
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editable && ctx.can("fluxos.editar") && (
        <form onSubmit={save}>
          <h4>Criar ou editar variável</h4>
          <label>
            Nome
            <input
              aria-label="Nome da variável"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
          </label>
          <label>
            Tipo
            <select
              aria-label="Tipo"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setValue(
                  e.target.value === "boolean"
                    ? false
                    : e.target.value === "json"
                      ? {}
                      : e.target.value === "number"
                        ? 0
                        : "",
                );
              }}
            >
              {["text", "number", "boolean", "date", "json"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <VariableValue type={type} value={value} onChange={setValue} />
          <button className="fb-primary" disabled={busy}>
            Salvar variável
          </button>
        </form>
      )}
      <details>
        <summary>Variáveis disponíveis no contexto</summary>
        <pre>
          {
            "contato.nome\ncontato.telefone\ncontato.tags\natendimento.protocolo\nempresa.nome\nchip.id\nchip.number\nchip.connected"
          }
        </pre>
      </details>
    </div>
  );
}
export function TriggersPanel({ definition, onChange, editable }) {
  const triggers = definition.triggers || [],
    settings = definition.settings;
  const update = (id, patch) =>
    onChange((d) => ({
      ...d,
      triggers: d.triggers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  return (
    <div className="fb-panel-content">
      <fieldset disabled={!editable}>
        <label>
          Fuso horário
          <input
            aria-label="Fuso horário"
            value={settings.timezone}
            onChange={(e) =>
              onChange((d) => ({
                ...d,
                settings: { ...d.settings, timezone: e.target.value },
              }))
            }
          />
        </label>
        <label className="fb-check">
          <input
            type="checkbox"
            checked={!!settings.autosave}
            onChange={(e) =>
              onChange((d) => ({
                ...d,
                settings: { ...d.settings, autosave: e.target.checked },
              }))
            }
          />
          Salvamento automático (3 segundos)
        </label>
        <JsonField
          label="Chips autorizados (IDs; vazio = todos no escopo)"
          value={settings.chipIds || []}
          onChange={(v) =>
            onChange((d) => ({ ...d, settings: { ...d.settings, chipIds: v } }))
          }
        />
        <h4>Gatilhos automáticos</h4>
        {!triggers.some((t) => t.enabled !== false) && (
          <div className="fb-trigger">
            <p>
              Este fluxo não tem gatilho ativo. Para responder aos clientes no
              WhatsApp, adicione Mensagem recebida e publique o fluxo.
            </p>
            <button
              onClick={() =>
                onChange((d) => ({
                  ...d,
                  triggers: [
                    ...d.triggers,
                    {
                      id: crypto.randomUUID(),
                      type: "message",
                      enabled: true,
                      priority: 0,
                    },
                  ],
                }))
              }
            >
              Adicionar Mensagem recebida
            </button>
          </div>
        )}
        <p className="fb-help">
          Maior prioridade vence. Em empate, vence o fluxo mais antigo. Uma
          mensagem inicia apenas um fluxo. Expressões regulares não são aceitas.
        </p>
        {triggers.map((t, i) => (
          <article className="fb-trigger" key={t.id}>
            <label>
              Tipo
              <select
                value={t.type}
                onChange={(e) => update(t.id, { type: e.target.value })}
              >
                {[
                  ["keyword", "Palavra-chave"],
                  ["message", "Mensagem recebida"],
                  ["firstMessage", "Primeira mensagem"],
                  ["newContact", "Novo contato"],
                  ["tagAdded", "Tag adicionada"],
                  ["system", "Evento do sistema"],
                  ["api", "Evento de API"],
                  ["integration", "Evento de integração"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!["message", "firstMessage", "newContact"].includes(t.type) && (
              <label>
                {t.type === "keyword"
                  ? "Palavra-chave"
                  : t.type === "tagAdded"
                    ? "Nome da tag"
                    : "Nome do evento"}
                <input
                  value={t.value || ""}
                  onChange={(e) => update(t.id, { value: e.target.value })}
                />
              </label>
            )}
            {t.type === "keyword" && (
              <label>
                Correspondência
                <select
                  value={t.match || "exact"}
                  onChange={(e) => update(t.id, { match: e.target.value })}
                >
                  <option value="exact">Exata</option>
                  <option value="contains">Contém</option>
                  <option value="startsWith">Inicia com</option>
                </select>
              </label>
            )}
            <label>
              Prioridade
              <input
                type="number"
                value={t.priority || 0}
                onChange={(e) =>
                  update(t.id, { priority: Number(e.target.value) })
                }
              />
            </label>
            <div className="fb-inline-actions">
              <label className="fb-check">
                <input
                  type="checkbox"
                  checked={t.enabled !== false}
                  onChange={(e) => update(t.id, { enabled: e.target.checked })}
                />
                Ativo
              </label>
              <button
                className="fb-danger"
                onClick={() =>
                  onChange((d) => ({
                    ...d,
                    triggers: d.triggers.filter((x) => x.id !== t.id),
                  }))
                }
              >
                Excluir gatilho {i + 1}
              </button>
            </div>
          </article>
        ))}
        <button
          onClick={() =>
            onChange((d) => ({
              ...d,
              triggers: [
                ...(d.triggers || []),
                {
                  id: crypto.randomUUID(),
                  type: "message",
                  priority: 0,
                  enabled: true,
                },
              ],
            }))
          }
        >
          + Adicionar gatilho
        </button>
      </fieldset>
      <p className="fb-help">
        Gatilhos da versão publicada iniciam conversas reais. Mensagens
        recebidas, primeira mensagem e contato novo vêm do WhatsApp. Eventos de
        API exigem sessão autenticada, eventId único e permissão de
        proprietário.
      </p>
    </div>
  );
}
export function SimulatorPanel({ flow, definition, ctx, onState }) {
  const [result, setResult] = useState(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(""),
    [context, setContext] = useState({ name: "", variables: {} }),
    [httpResponse, setHttpResponse] = useState({}),
    [showVars, setShowVars] = useState(false);
  const bottom = useRef(null),
    state = result?.run?.state;
  useEffect(() => {
    onState?.(state);
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [result]);
  const execute = async (fn) => {
    setBusy(true);
    try {
      setResult(await fn());
    } catch (e) {
      ctx.notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    execute(() =>
      api(`/api/flows/${flow.id}/simulate`, "POST", {
        definition,
        context,
        simulation: {
          now: now ? new Date(now).toISOString() : undefined,
          httpResponse,
        },
      }),
    );
  const send = (message) =>
    execute(() =>
      api(`/api/flows/${flow.id}/runs/${result.run.id}/input`, "POST", {
        text: message,
        now: now ? new Date(now).toISOString() : undefined,
      }),
    );
  return (
    <div className="fb-simulator">
      <div className="fb-sim-banner">AMBIENTE ISOLADO · Sem envios reais</div>
      <details className="fb-sim-settings">
        <summary>Horário e variáveis</summary>
        <label>
          Horário de teste (seu fuso local)
          <input
            type="datetime-local"
            value={now}
            onChange={(e) => setNow(e.target.value)}
          />
        </label>
        <JsonField
          label="Contexto {name, variables, tags, chip}"
          value={context}
          onChange={setContext}
        />
        <JsonField
          label="Resposta simulada para HTTP"
          value={httpResponse}
          onChange={setHttpResponse}
        />
      </details>
      <div className="fb-sim-chat">
        {!state && (
          <div className="fb-sim-empty">
            <span>▷</span>
            <h4>Converse com seu fluxo</h4>
            <p>
              Teste caminhos, respostas e condições com o mesmo motor usado no
              WhatsApp.
            </p>
            <button className="fb-primary" onClick={start} disabled={busy}>
              Iniciar simulação
            </button>
          </div>
        )}
        {state?.messages.map((m, i) => (
          <div
            className={`fb-bubble ${m.from === "user" ? "from-user" : ""}`}
            key={i}
          >
            {m.kind && <small>📎 {m.kind}</small>}
            <p>{m.text}</p>
            {m.assetId && (
              <a
                href={`/api/flows-assets/${m.assetId}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir anexo
              </a>
            )}
            {m.options &&
              state.status === "waiting" &&
              i === state.messages.length - 1 && (
                <div className="fb-sim-options">
                  {m.options.map((o) => (
                    <button
                      disabled={busy}
                      key={o.id}
                      onClick={() => send(o.id)}
                    >
                      {o.id} — {o.label}
                    </button>
                  ))}
                </div>
              )}
          </div>
        ))}
        {state && (
          <div className="fb-sim-status">
            {{
              waiting: "Aguardando resposta",
              sleeping: "Temporizador em espera",
              completed: "Conversa finalizada",
              stopped: "Fluxo encerrado",
              ready: "Pronto para continuar",
              failed: "Falha na execução",
              attention: "Conferência necessária",
            }[state.status] || state.status}
            {state.error && <p className="fb-error">{state.error}</p>}
            {state.status === "sleeping" && (
              <button
                disabled={busy}
                onClick={() =>
                  execute(() =>
                    api(
                      `/api/flows/${flow.id}/runs/${result.run.id}/input`,
                      "POST",
                      { timeout: true },
                    ),
                  )
                }
              >
                Avançar temporizador
              </button>
            )}
            {state.status === "ready" && (
              <button disabled={busy} onClick={() => send("")}>
                Continuar execução
              </button>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {state && (
        <>
          <form
            className="fb-sim-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) {
                send(text);
                setText("");
              }
            }}
          >
            <input
              aria-label="Mensagem de teste"
              placeholder="Digite uma resposta..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy || state.status !== "waiting"}
            />
            <button
              className="fb-primary"
              disabled={busy || state.status !== "waiting" || !text.trim()}
            >
              Enviar
            </button>
          </form>
          <div className="fb-sim-tools">
            <button onClick={start} disabled={busy}>
              ↻ Reiniciar
            </button>
            <button
              disabled={busy || state.status !== "waiting"}
              onClick={() =>
                execute(() =>
                  api(
                    `/api/flows/${flow.id}/runs/${result.run.id}/input`,
                    "POST",
                    { timeout: true },
                  ),
                )
              }
            >
              Simular timeout
            </button>
            <button onClick={() => setShowVars(!showVars)}>
              {showVars ? "Ocultar variáveis" : "Variáveis e logs"}
            </button>
          </div>
          {showVars && (
            <div className="fb-sim-debug">
              <h4>Variáveis</h4>
              <pre>{JSON.stringify(state.vars, null, 2)}</pre>
              <h4>Transições</h4>
              {result.logs.map((log) => (
                <p key={log.id}>
                  <code>
                    {log.node_id?.slice(0, 8)} → {log.port || "—"}
                  </code>{" "}
                  {log.detail}
                </p>
              ))}
              {state.trace
                .filter((t) => t.payload)
                .map((t, i) => (
                  <p key={i}>
                    {t.detail} · {JSON.stringify(t.payload)}
                  </p>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function HistoryPanel({ flow, ctx, onRestore }) {
  const [runs, setRuns] = useState([]),
    [versions, setVersions] = useState([]),
    [revisions, setRevisions] = useState([]),
    [detail, setDetail] = useState(null),
    [tab, setTab] = useState("runs");
  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([
        api(`/api/flows/${flow.id}/history`),
        api(`/api/flows/${flow.id}/versions`),
        api(`/api/flows/${flow.id}/revisions`),
      ]);
      setRuns(a.runs);
      setVersions(b.versions);
      setRevisions(c.revisions);
    } catch (e) {
      ctx.notify(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [flow.id]);
  return (
    <div className="fb-panel-content">
      <div className="fb-segment">
        <button
          className={tab === "runs" ? "is-active" : ""}
          onClick={() => setTab("runs")}
        >
          Execuções
        </button>
        <button
          className={tab === "versions" ? "is-active" : ""}
          onClick={() => setTab("versions")}
        >
          Versões publicadas
        </button>
        <button onClick={load}>↻</button>
        <button
          className={tab === "revisions" ? "is-active" : ""}
          onClick={() => setTab("revisions")}
        >
          Revisões salvas
        </button>
      </div>
      {tab === "versions" || tab === "revisions" ? (
        <>
          {!(tab === "revisions" ? revisions : versions).length && (
            <p className="fb-help">Nenhuma versão registrada.</p>
          )}
          {(tab === "revisions"
            ? revisions.map((r) => ({
                ...r,
                version: r.revision,
                id: r.revision,
              }))
            : versions
          ).map((v) => (
            <article className="fb-history-item" key={v.id}>
              <strong>
                {tab === "revisions" ? "Revisão" : "Versão"} {v.version}
              </strong>
              <small>{new Date(v.created_at).toLocaleString("pt-BR")}</small>
              <button
                onClick={async () => {
                  try {
                    const { definition } = await api(
                      `/api/flows/${flow.id}/${tab === "revisions" ? "revisions" : "versions"}/${v.version}`,
                    );
                    if (onRestore && ctx.can("fluxos.editar")) {
                      if (
                        await ctx.confirm({
                          title: "Carregar versão no editor?",
                          body: "Ela será carregada como rascunho. Execuções em andamento mantêm sua versão.",
                          okText: "Carregar versão",
                        })
                      )
                        onRestore(definition);
                    } else
                      downloadFlow({
                        format: "convelya-flow",
                        schemaVersion: 1,
                        name: flow.name,
                        definition,
                      });
                  } catch (e) {
                    ctx.notify(e.message);
                  }
                }}
              >
                {onRestore && ctx.can("fluxos.editar")
                  ? "Carregar como rascunho"
                  : "Exportar versão"}
              </button>
            </article>
          ))}
        </>
      ) : (
        <>
          {!runs.length && (
            <p className="fb-help">Nenhuma execução registrada.</p>
          )}
          {runs.map((run) => (
            <article className="fb-history-item" key={run.id}>
              <button
                onClick={async () => {
                  try {
                    setDetail(
                      await api(`/api/flows/${flow.id}/runs/${run.id}`),
                    );
                  } catch (e) {
                    ctx.notify(e.message);
                  }
                }}
              >
                <strong>
                  {run.mode === "simulation" ? "Simulação" : run.contact} ·{" "}
                  {run.status}
                </strong>
                <small>
                  v{run.version} ·{" "}
                  {new Date(run.created_at).toLocaleString("pt-BR")}
                </small>
              </button>
              {ctx.can("fluxos.editar") &&
                ["waiting", "sleeping", "ready", "attention"].includes(
                  run.status,
                ) && (
                  <button
                    className="fb-danger"
                    onClick={async () => {
                      if (
                        await ctx.confirm({
                          title: "Encerrar execução?",
                          body: "A automação desta conversa será interrompida.",
                          okText: "Encerrar",
                        })
                      ) {
                        try {
                          await api(
                            `/api/flows/${flow.id}/runs/${run.id}/stop`,
                            "POST",
                          );
                          setDetail(null);
                          load();
                        } catch (e) {
                          ctx.notify(e.message);
                        }
                      }
                    }}
                  >
                    Encerrar
                  </button>
                )}
            </article>
          ))}
          {detail && (
            <div className="fb-history-detail">
              <h4>Execução {detail.run.id.slice(0, 8)}</h4>
              {detail.run.state.error && (
                <p className="fb-error">{detail.run.state.error}</p>
              )}
              {detail.logs.map((log) => (
                <p key={log.id}>
                  <small>
                    {new Date(log.created_at).toLocaleTimeString("pt-BR")}
                  </small>{" "}
                  {log.detail}
                  <code>
                    {log.node_id?.slice(0, 8)} → {log.port || "—"}
                  </code>
                </p>
              ))}
              <details>
                <summary>Variáveis e respostas</summary>
                <pre>
                  {JSON.stringify(
                    {
                      variables: detail.run.state.vars,
                      answers: detail.run.state.answers,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
