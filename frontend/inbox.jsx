import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, getApiChannel, cleanNumber, contactPhone, internalId, phone, relative } from "./api";
import { Action, Empty } from "./components";
import { TagPicker } from "./pages";
import { Avatar } from "./avatar";
import { AudioPlayer } from "./audio";
import { Icon } from "./icons";
import { VoiceRecorder } from "./voice-recorder";
import { useMessageActions, QuotedMessage } from './message-actions';

function name(ctx, number, item = {}) {
  const contact = ctx.data.contacts.find(
    (entry) => entry.number === number || entry.aliases?.includes(number),
  );
  return (
    contact?.name ||
    item.name ||
    (contactPhone(number, item) ? phone(contactPhone(number, item)) : "Telefone indisponível")
  );
}
function selected(ctx) {
  return (
    ctx.data.state.conversations?.[ctx.selected] || {
      number: ctx.selected,
      messages: [],
    }
  );
}
function adopt(ctx, result) {
  if (result.conversation?.chipId && String(result.conversation.chipId) !== getApiChannel()) return;
  if (result.conversation)
    ctx.setData((previous) => ({
      ...previous,
      state: {
        ...previous.state,
        conversations: {
          ...previous.state.conversations,
          [result.conversation.number]: result.conversation,
        },
      },
    }));
}
function conversations(ctx) {
  return Object.entries(ctx.data.state.conversations || {})
    .filter(([number, item]) => {
      const department = ctx.fields.departmentFilter || "all";
      return (
        item.messages?.length > 0 &&
        (department === "all" ||
          (department === "none" && !item.departmentId) ||
          String(item.departmentId) === department) &&
        `${name(ctx, number, item)} ${contactPhone(number, item)} ${item.lastMessage || ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(
            (ctx.fields.conversationSearch || "").toLocaleLowerCase("pt-BR"),
          ) &&
        (ctx.filter === "all"
          ? !item.blocked && !item.isFinalized
          : ctx.filter === "assumed"
            ? number === ctx.data.state.activeTarget
            : ctx.filter === "blocked"
              ? item.blocked
              : item.isFinalized)
      );
    })
    .sort(([, a], [, b]) =>
      String(b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""),
    );
}
function pills(ctx, tags, className = "tag-pill") {
  return (tags || []).map((tag) => {
    const color =
      ctx.data.tags.find((item) => item.name === tag)?.color || "#5c8df6";
    return (
      <span
        className={className}
        key={tag}
        style={{ background: color + "22", color, borderColor: color + "44" }}
      >
        {tag}
      </span>
    );
  });
}
function ConversationList({ ctx }) {
  const items = conversations(ctx);
  const choose = (number) =>
    ctx.bulkMode
      ? ctx.setBulk((previous) =>
          previous.includes(number)
            ? previous.filter((item) => item !== number)
            : [...previous, number],
        )
      : ctx.openConversation(number);
  return items.length ? (
    items.map(([number, item]) => (
      <li
        key={number}
        role="button"
        tabIndex={0}
        aria-pressed={
          ctx.bulkMode ? ctx.bulk.includes(number) : number === ctx.selected
        }
        className={`convo-item${number === ctx.selected ? " active" : ""}${number === ctx.data.state.activeTarget ? " assumed" : ""}${item.blocked ? " blocked" : ""}${item.isFinalized ? " finalized" : ""}${ctx.bulk.includes(number) ? " bulk-selected" : ""}`}
        onClick={() => choose(number)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose(number);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          ctx.setBulkMode(true);
          ctx.setBulk([number]);
        }}
      >
        {ctx.bulkMode && (
          <span
            className={`bulk-checkbox${ctx.bulk.includes(number) ? " is-checked" : ""}`}
          />
        )}
        <Avatar
          className="convo-avatar"
          number={number}
          label={name(ctx, number, item)}
          url={item.profilePic || ""}
        />
        <div className="convo-body">
          <div className="convo-header-row">
            <span className="convo-name">{name(ctx, number, item)}</span>
            <span className="convo-time">{relative(item.lastMessageAt)}</span>
          </div>
          <div className="convo-footer-row">
            {number === ctx.data.state.activeTarget && (
              <span className="convo-assumed-dot" />
            )}
            <span className="convo-preview">
              {item.lastMessage || "Sem mensagens"}
            </span>
            {item.blocked && <span className="convo-badge">bloqueado</span>}
            {item.isFinalized && (
              <span className="convo-badge convo-badge--finalized">
                finalizada
              </span>
            )}
          </div>
          {item.departmentId && (
            <div className="convo-tags-row">
              <span className="convo-department-pill">
                {
                  ctx.data.departments.find(
                    (dept) => String(dept.id) === String(item.departmentId),
                  )?.name
                }
              </span>
            </div>
          )}
          <div className="convo-tags-row">
            {pills(ctx, (item.tags || []).slice(0, 2), "convo-tag-pill")}
          </div>
        </div>
      </li>
    ))
  ) : (
    <li className="convo-empty">
      {ctx.fields.conversationSearch
        ? "Nenhuma conversa encontrada para essa busca."
        : ctx.filter === "finalized"
          ? "Nenhuma conversa finalizada."
          : "Nenhuma conversa ainda. Mensagens de clientes aparecerão aqui."}
    </li>
  );
}
function Messages({ ctx }) {
  const ref = useRef(null),
    nearBottom = useRef(true),
    previous = useRef({ number: null, count: 0 }),
    messages = selected(ctx).messages || [];
  const messageActions = useMessageActions(ctx, messages);
  useEffect(() => {
    const log = ref.current?.parentElement;
    if (!log) return;
    const track = () => {
      nearBottom.current =
        log.scrollHeight - log.scrollTop - log.clientHeight < 100;
    };
    log.addEventListener("scroll", track, { passive: true });
    return () => log.removeEventListener("scroll", track);
  }, [ctx.selected]);
  useLayoutEffect(() => {
    const log = ref.current?.parentElement;
    if (!log) return;
    const switched = previous.current.number !== ctx.selected;
    if (switched || nearBottom.current)
      log.scrollTo({
        top: log.scrollHeight,
        behavior:
          switched || matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
      });
    previous.current = { number: ctx.selected, count: messages.length };
  }, [ctx.selected, messages]);
  if (!ctx.selected)
    return (
      <div className="empty-state">
        <div className="empty-icon">☏</div>
        <p>Nenhuma conversa selecionada</p>
        <p className="empty-sub">
          Mensagens de clientes vão aparecer na lista à esquerda assim que
          chegarem.
        </p>
      </div>
    );
  return (
    <div
      ref={ref}
      className="react-messages"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messageActions.toolbar}
      {messages.length ? (
        messages.map((message, index) => (
          <div
            className={`bubble message-bubble${messageActions.chosen.includes(message.id) ? ' is-selected' : ''}${message.type === "audio" ? " has-audio" : ""} ${message.from === "admin" ? "admin" : "client"}`}
            key={`${ctx.selected}:${message.id || `${message.at}-${index}`}`}
            {...messageActions.bubble(message)}
          >
            {messageActions.trigger(message)}
            {message.forwarded && <small className="message-forwarded-label">Encaminhada</small>}
            {message.replyTo && <QuotedMessage quote={message.replyTo} contactName={name(ctx, ctx.selected, selected(ctx))} messages={messages} />}
            {["image", "gif"].includes(message.type) && message.mediaUrl && (
              <MessageImage message={message} />
            )}
            {message.type === "video" && message.mediaUrl && (
              <video
                controls
                className="bubble-video"
                src={message.mediaUrl}
                preload="metadata"
              />
            )}
            {message.type === "audio" && message.mediaUrl && (
              <AudioPlayer message={message} />
            )}
            {message.type === "document" && message.mediaUrl && (
              <a
                className="document-link"
                href={message.mediaUrl}
                target="_blank"
                rel="noopener"
                download={message.fileName || "documento"}
              >
                {message.fileName || "Baixar documento"}
              </a>
            )}
            {(message.caption || message.text) && (
              <div className="bubble-text">
                {message.caption || message.text}
              </div>
            )}
            <span className="time">
              {message.at
                ? new Date(message.at).toLocaleString("pt-BR", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
              {message.from === 'admin' && message.deliveryStatus != null && <span className="message-receipt" style={{ color: message.deliveryStatus >= 4 ? '#53bdeb' : 'inherit', display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }} title={message.deliveryStatus >= 4 ? 'Visualizado' : message.deliveryStatus === 3 ? 'Entregue' : message.deliveryStatus === 2 ? 'Enviado' : message.deliveryStatus === 0 ? 'Falha no envio' : 'Enviando'} aria-label={message.deliveryStatus >= 4 ? 'Visualizado' : message.deliveryStatus === 3 ? 'Entregue' : message.deliveryStatus === 2 ? 'Enviado' : message.deliveryStatus === 0 ? 'Falha no envio' : 'Enviando'}><Icon name={message.deliveryStatus >= 3 ? 'doubleCheck' : message.deliveryStatus === 2 ? 'check' : message.deliveryStatus === 0 ? 'block' : 'clock'} size={15} /></span>}
            </span>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <p>Sem mensagens ainda</p>
          <p className="empty-sub">Escreva abaixo para iniciar a conversa.</p>
        </div>
      )}
      {messageActions.tools}
    </div>
  );
}
function MessageImage({ message }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <img
      className={"bubble-image" + (expanded ? " is-expanded" : "")}
      src={message.mediaUrl}
      alt={message.fileName || message.caption || "Imagem recebida"}
      loading="lazy"
      role="button"
      tabIndex={0}
      aria-label="Ampliar ou reduzir imagem"
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded(!expanded);
        }
      }}
    />
  );
}
function AttachmentPreview({ ctx }) {
  const file = ctx.files.fileInput;
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file || !/^(audio|image)\//.test(file.type)) { setUrl(""); return; }
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  if (!file) return null;
  return <>
    <span id="filePreviewName">{file.name}</span>
    <button type="button" id="removeFileBtn" title="Remover arquivo" aria-label="Remover arquivo" onClick={ctx.actions.removeFileBtn}>×</button>
    {url && file.type.startsWith('audio/') && <audio className="attachment-audio-preview" src={url} controls aria-label="Revisar áudio gravado" />}
    {url && file.type.startsWith('image/') && <img src={url} alt="Imagem anexada para envio" style={{ maxWidth: 160, maxHeight: 120, objectFit: 'contain', borderRadius: 8 }} />}
  </>;
}
function ConversationActions({ ctx }) {
  const ref = useRef(null), [showContact, setShowContact] = useState(false);
  const item = selected(ctx);
  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.open) return;
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type !== "keydown" && ref.current.contains(event.target)) return;
      ref.current.open = false;
      if (event.type === "keydown") ref.current.querySelector("summary").focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  useEffect(() => { if (ref.current) ref.current.open = false; setShowContact(false); }, [ctx.selected]);
  if (!ctx.selected) return null;
  const actions = [
    ["assumeBtn", "user", ctx.selected === ctx.data.state.activeTarget ? "Liberar atendimento humano" : "Assumir atendimento"],
    ["assignBtn", "user", "Atribuir responsável"],
    ["tagsBtn", "tag", "Atribuir tags"],
    ["transferConversationBtn", "transfer", "Transferência"],
    ["finalizeBtn", "check", item.isFinalized ? "Reabrir atendimento" : "Finalizar atendimento"],
    ["blockBtn", "block", item.blocked ? "Desbloquear contato" : "Bloquear contato"],
    ["clearBtn", "trash", "Limpar histórico"],
    ["deleteBtn", "trash", "Apagar conversa"],
  ];
  return <details className="chat-more-details" id="chatMoreDetails" ref={ref}>
    <summary className="chat-more-btn" aria-label="Mais opções do cliente" title="Mais opções"><Icon name="more" /></summary>
    <div className="chat-more-menu" id="chatMoreMenu">
      <button type="button" className="chat-more-action" aria-expanded={showContact} onClick={() => setShowContact(!showContact)}><Icon name="contact" />Dados do contato</button>
      <div className="chat-contact-details" hidden={!showContact}>
        <span className="chat-more-label">Nome</span><strong id="chatMoreName">{name(ctx, ctx.selected, item)}</strong>
        <span className="chat-more-label">Número</span><span id="chatMoreNumber">{phone(contactPhone(ctx.selected, item)) || "Telefone indisponível"}</span>
      </div>
      <button type="button" id="notificationsToggle" className="chat-more-action" aria-pressed={ctx.preferences.notifications} onClick={() => ctx.togglePreference('notifications')}><Icon name={ctx.preferences.notifications ? 'volume' : 'muted'} /><span>{ctx.preferences.notifications ? 'Desativar notificações' : 'Ativar notificações'}</span></button>
      <button type="button" id="signatureToggle" className="chat-more-action" aria-pressed={ctx.preferences.signature} onClick={() => ctx.togglePreference('signature')}><Icon name="pencil" /><span>{ctx.preferences.signature ? 'Desativar assinatura' : 'Ativar assinatura'}</span></button>
      {actions.map(([id, icon, label]) => <Action key={id} id={id} className={"chat-more-action" + (["blockBtn", "clearBtn", "deleteBtn"].includes(id) ? " is-danger" : "")} action={() => { ref.current.open = false; return ctx.actions[id](); }}><Icon name={icon} /><span>{label}</span></Action>)}
    </div>
  </details>;
}
async function send(ctx) {
  if (ctx.contactsBlocked) throw Error('Aguarde a sincronização e verificação dos contatos antes de enviar mensagens.');
  const value = (ctx.fields.composerInput || "").trim(),
    file = ctx.files.fileInput,
    replyTarget = ctx.replyTarget;
  if (!ctx.selected || (!value && !file)) return;
  if (!(ctx.data.state.channelStatus || ctx.data.state.status)?.connected)
    throw Error("Bot desconectado. Conecte o WhatsApp antes de enviar.");
  let payload = { number: ctx.selected, chipId: ctx.data.state.chipId, text: value, signature: ctx.preferences.signature, replyTo: replyTarget?.message.id },
    url = "/api/reply";
  if (file) {
    url = "/api/reply-media";
    payload = new FormData();
    payload.append("number", ctx.selected);
    if (ctx.data.state.chipId) payload.append("chipId", ctx.data.state.chipId);
    payload.append("caption", value);
    payload.append("signature", String(ctx.preferences.signature));
    payload.append("file", file);
    if (replyTarget) payload.append('replyTo', String(replyTarget.message.id));
  }
  ctx.setField("composerInput", "");
  ctx.setReplyTarget(null);
  ctx.setEmojiOpen(false);
  document.getElementById('composerInput')?.focus({ preventScroll: true });
  try {
    adopt(ctx, await api(url, "POST", payload));
    if (ctx.current()?.files.fileInput === file) ctx.setFile("fileInput", null);
  } catch (error) {
    const current = ctx.current();
    if (current?.selected === ctx.selected && String(current.data.state.chipId) === String(ctx.data.state.chipId)) {
      ctx.setFields(previous => previous.composerInput ? previous : { ...previous, composerInput: value });
      if (!current.replyTarget) ctx.setReplyTarget(replyTarget);
    }
    throw error;
  }
}

function pasteAttachment(ctx, event) {
  const clipboard = event.clipboardData;
  const files = Array.from(clipboard?.files || []);
  if (!files.length) {
    for (const item of Array.from(clipboard?.items || [])) {
      if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
    }
  }
  if (!files.length) return; // Ordinary text keeps the browser's normal paste behavior.
  event.preventDefault();
  if (!ctx.selected || !ctx.can('atendimento.responder') || ctx.contactsBlocked || !(ctx.data.state.channelStatus || ctx.data.state.status)?.connected) return;
  if (ctx.fields.voiceRecording) { ctx.notify('Conclua ou descarte a gravação antes de colar um arquivo.'); return; }
  if (files.length > 1) { ctx.notify('Cole um arquivo por vez para revisar antes de enviar.'); return; }
  const file = files[0];
  if (file.size > 50 * 1024 * 1024) { ctx.notify('O arquivo deve ter no máximo 50 MB.'); return; }
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  ctx.setFile('fileInput', file.name ? file : new File([file], `arquivo-colado-${Date.now()}.${extension}`, { type: file.type }));
}
export function inboxActions(ctx) {
  const item = selected(ctx),
    run = (id, fn) => () => ctx.execute(id, fn),
    tags = (bulk) =>
      ctx.openEditor(
        "tagsModal",
        { conversationTags: bulk ? [] : item.tags || [] },
        { bulk, number: ctx.selected },
      );
  const actions = {
    newChatBtn: () => {
      const number = cleanNumber(ctx.fields.newChatInput);
      if (number.length < 8) {
        ctx.notify("Digite um número válido com DDI e DDD.");
        return;
      }
      ctx.openConversation(number);
      ctx.setField("newChatInput", "");
    },
    sendBtn: run("sendBtn", () => send(ctx)),
    assignBtn: run('assignBtn', async () => {
      const { members } = await api('/api/assignees');
      ctx.resource({ title: 'Atribuir responsável', fields: [{ name: 'userId', label: 'Responsável', type: 'select', value: String(item.assignedUserId || ''), options: [{ value: '', label: 'Sem responsável' }, ...members.map((member) => ({ value: String(member.id), label: member.name }))] }], save: async (values) => { adopt(ctx, await api(`/api/conversation/${ctx.selected}/assign`, 'POST', { userId: values.userId ? Number(values.userId) : null })); } });
    }),
    attachBtn: () => {
      if (ctx.files.fileInput) ctx.setFile("fileInput", null);
      else document.getElementById("fileInput")?.click();
    },
    removeFileBtn: () => ctx.setFile("fileInput", null),
    emojiBtn: () => ctx.setEmojiOpen(!ctx.emojiOpen),
    assumeBtn: run("assumeBtn", async () => {
      const result = await api("/api/assumir", "POST", {
        chipId: ctx.data.state.chipId,
        number:
          ctx.selected === ctx.data.state.activeTarget ? null : ctx.selected,
      });
      if (String(ctx.data.state.chipId) !== getApiChannel()) return;
      ctx.setData((previous) => ({
        ...previous,
        state: { ...previous.state, activeTarget: result.activeTarget },
      }));
    }),
    blockBtn: run("blockBtn", async () =>
      adopt(
        ctx,
        await api("/api/conversation/block", "POST", {
          number: ctx.selected,
          blocked: !item.blocked,
        }),
      ),
    ),
    finalizeBtn: run("finalizeBtn", async () => {
      const label = item.isFinalized ? "Reabrir" : "Finalizar";
      if (
        await ctx.confirm({
          title: label + " conversa",
          body: `${label} a conversa com ${name(ctx, ctx.selected, item)}?`,
          okText: label,
        })
      )
        adopt(
          ctx,
          await api(
            `/api/conversation/${ctx.selected}/${item.isFinalized ? "reopen" : "finalize"}`,
            "POST",
          ),
        );
    }),
    clearBtn: run("clearBtn", async () => {
      if (
        await ctx.confirm({
          title: "Limpar histórico",
          body: "Apagar todas as mensagens desta conversa? Esta ação não pode ser desfeita.",
          okText: "Limpar",
        })
      )
        adopt(
          ctx,
          await api("/api/conversation/clear", "POST", {
            number: ctx.selected,
          }),
        );
    }),
    deleteBtn: run("deleteBtn", async () => {
      if (
        !(await ctx.confirm({
          title: "Apagar conversa",
          body: "Apagar esta conversa e seu histórico?",
          okText: "Apagar",
        }))
      )
        return;
      await api("/api/conversation/delete", "POST", { number: ctx.selected });
      ctx.setData((previous) => {
        const conversations = { ...previous.state.conversations };
        delete conversations[ctx.selected];
        return { ...previous, state: { ...previous.state, conversations } };
      });
      ctx.setSelected("");
    }),
    tagsBtn: () => tags(false),
    bulkTagsBtn: () => tags(true),
    bulkCancelBtn: () => {
      ctx.setBulk([]);
      ctx.setBulkMode(false);
    },
    bulkTransferBtn: () =>
      ctx.openEditor("bulkTransferModal", { bulkTransferDeptSelect: "" }),
    bulkTransferCancel: () => {
      ctx.closeEditor();
      if (!ctx.bulkMode) ctx.setBulk([]);
    },
    transferConversationBtn: () => {
      ctx.setBulk([ctx.selected]);
      ctx.openEditor("bulkTransferModal", { bulkTransferDeptSelect: "" });
    },
    bulkTransferConfirm: run("bulkTransferConfirm", async () => {
      if (!ctx.fields.bulkTransferDeptSelect)
        throw Error("Selecione um departamento.");
      await api("/api/conversations/bulk-department", "POST", {
        numbers: ctx.bulk,
        departmentId: ctx.fields.bulkTransferDeptSelect,
      });
      ctx.closeEditor();
      ctx.setBulk([]);
      ctx.setBulkMode(false);
      await ctx.load("state");
    }),
    tagsModalSave: run("tagsModalSave", async () => {
      const tags = ctx.fields.conversationTags || [];
      if (ctx.editor?.item?.bulk) {
        await api("/api/conversations/bulk-tags", "POST", {
          numbers: ctx.bulk,
          tags,
          action: tags.length ? "add" : "set",
        });
        ctx.setBulk([]);
        ctx.setBulkMode(false);
        await ctx.load("state");
      } else
        adopt(
          ctx,
          await api(
            `/api/conversation/${ctx.editor.item.number}/tags`,
            "POST",
            { tags },
          ),
        );
      ctx.closeEditor();
    }),
    overviewCardOpen: () => ctx.setFilter("all"),
    overviewCardAssumed: () => ctx.setFilter("assumed"),
    chatMoreTagsBtn: () => tags(false),
    photoViewClose: () => ctx.closeEditor(),
  };
  for (const id of ["tagsModalClose", "tagsModalClose2", "photoViewClose"])
    actions[id] = ctx.closeEditor;
  return actions;
}
export function inboxSubmit(ctx) {
  return { composer: () => ctx.actions.sendBtn() };
}
export function inboxAttributes(ctx, id, node) {
  const item = selected(ctx);
  if (
    [
      "tagsBtn",
      "finalizeBtn",
      "blockBtn",
      "clearBtn",
      "deleteBtn",
      "assumeBtn",
      "composer",
      "chatMoreDetails",
    ].includes(id)
  )
    return {
      hidden: !ctx.selected,
      ...(id === "assumeBtn"
        ? {
            className:
              "assume-btn" +
              (ctx.selected === ctx.data.state.activeTarget
                ? " is-assumed"
                : ""),
          }
        : {}),
    };
  if (id === "activeTagsRow")
    return { hidden: !ctx.selected || !item.tags?.length };
  if (id === "chatAvatarPhoto")
    return {
      hidden: true,
      style: { display: "none" },
    };
  if (id === "filePreview") return { hidden: !ctx.files.fileInput };
  if (id === "composerInput" || id === "sendBtn")
    return {
      disabled: !ctx.can('atendimento.responder') || ctx.contactsBlocked || !(ctx.data.state.channelStatus || ctx.data.state.status)?.connected || (id === 'sendBtn' && ctx.busy === "sendBtn"),
      ...(id === "composerInput"
        ? { style: { height: "auto", minHeight: 40 }, onPaste: event => pasteAttachment(ctx, event), title: 'Escreva uma mensagem ou cole uma imagem ou arquivo com Ctrl+V' }
        : {}),
    };
  if (id === "bulkBar") return { hidden: !ctx.bulkMode };
  if (id === "conversationSearch")
    return {
      onContextMenu: (event) => {
        event.preventDefault();
        ctx.setBulkMode(true);
      },
    };
  if (id === "attachBtn")
    return {
      className: "attach-btn" + (ctx.files.fileInput ? " has-file" : ""),
    };
  if (["overviewCardOpen", "overviewCardAssumed"].includes(id))
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
  return {};
}
export function inboxSlot(ctx, id, node) {
  if (id === 'messageReplyPreview') return ctx.replyTarget && <div className="message-reply-preview"><div><strong>Respondendo a {ctx.replyTarget.message.from === 'admin' ? 'você' : name(ctx, ctx.selected, selected(ctx))}</strong><p>{ctx.replyTarget.message.caption || ctx.replyTarget.message.text || `[${ctx.replyTarget.message.type || 'Mensagem'}]`}</p></div><button type="button" aria-label="Cancelar resposta" onClick={() => ctx.setReplyTarget(null)}>×</button></div>;
  const item = selected(ctx),
    all = Object.entries(ctx.data.state.conversations || {}).filter(([, conversation]) => conversation.messages?.length > 0);
  if (["inboxChannelSelect", "contactsChannelSelect"].includes(id)) return <label className="inbox-channel-field"><span>Canal de atendimento</span><select id="inboxChipSelect" aria-label="Canal de atendimento" value={ctx.data.state.chipId || ''} onChange={(event) => ctx.selectChannel(event.target.value)} disabled={!!ctx.busy || !!ctx.files.fileInput || !!ctx.fields.voiceRecording}><option value="" disabled>Selecione um chip</option>{(ctx.data.state.chips || []).map((chip) => <option key={chip.chipId} value={chip.chipId}>{chip.name} · {chip.connected ? 'Conectado' : 'Desconectado'}</option>)}</select></label>;
  if (id === "convoList") return <ConversationList ctx={ctx} />;
  if (id === "convoCount") return conversations(ctx).length;
  if (id === "overviewConversations")
    return all.filter(([, entry]) => !entry.blocked && !entry.isFinalized)
      .length;
  if (id === "overviewAssumed")
    return all.filter(([number]) => number === ctx.data.state.activeTarget)
      .length;
  if (id === "overviewStatus")
    return (ctx.data.state.channelStatus || ctx.data.state.status)?.connected ? "conectado" : "desconectado";
  if (id === "chatTitle")
    return ctx.selected
      ? name(ctx, ctx.selected, item)
      : "Selecione uma conversa";
  if (id === "chatActions") return <ConversationActions ctx={ctx} />;
  if (id === 'composerSignature') return ctx.selected && ctx.preferences.signature ? `Assinatura: ${ctx.data.state.user?.displayName || ctx.data.state.user?.username || ''}` : null;
  if (id === "filePreview") return <AttachmentPreview ctx={ctx} />;
  if (id === "chatStatus") return ctx.selected ? (item.isFinalized ? "Finalizado" : item.blocked ? "Bloqueado" : ctx.selected === ctx.data.state.activeTarget ? "Atendimento humano" : "Atendimento automático") : null;
  if (id === "chatDepartment") {
    const department = ctx.data.departments.find((entry) => String(entry.id) === String(item.departmentId));
    return ctx.selected && department ? <span className="chat-department-pill"><Icon name="department" size={14} />{department.name}</span> : null;
  }
  if (id === "chatAvatar")
    return ctx.selected ? (
      <Avatar
        number={ctx.selected}
        label={name(ctx, ctx.selected, item)}
        url={item.profilePic || ""}
      />
    ) : (
      ""
    );
  if (id === "chatSub")
    return ctx.selected
      ? `${phone(contactPhone(ctx.selected, item)) || "Telefone indisponível"} · ${ctx.data.state.chipName || "WhatsApp"}`
      : "as mensagens aparecem aqui em tempo real";
  if (id === "assumeBtn")
    return ctx.selected === ctx.data.state.activeTarget
      ? "conversa assumida"
      : "assumir conversa";
  if (id === "finalizeBtn") return item.isFinalized ? "reabrir" : "finalizar";
  if (id === "blockBtn") return item.blocked ? "desbloquear" : "bloquear";
  if (id === "tagsBtn") return "tags";
  if (id === "clearBtn") return "limpar";
  if (id === "deleteBtn") return "apagar";
  if (id === "chatLog") return <Messages ctx={ctx} />;
  if (id === "activeTagsPills") return pills(ctx, item.tags);
  if (id === "chatMoreNumber")
    return ctx.selected
      ? phone(contactPhone(ctx.selected, item)) || "Telefone indisponível"
      : "—";
  if (id === "chatMoreName")
    return ctx.selected ? name(ctx, ctx.selected, item) : "—";
  if (id === "photoViewTitle")
    return ctx.editor?.item?.name || "Foto de perfil";
  if (id === "photoViewSubtitle")
    return ctx.editor?.item?.number ? (internalId(ctx.editor.item.number) ? "" : phone(ctx.editor.item.number)) : "—";
  if (id === "photoViewContent") {
    const itm = ctx.editor?.item;
    const url = itm?.url;
    return (
      <div className="photo-preview-box">
        {url ? (
          <img src={url} alt={itm?.name || "Foto de perfil"} className="photo-preview-image" />
        ) : (
          <div className="photo-preview-fallback">
            <span className="photo-fallback-letter">{(itm?.name || "C").slice(0, 1).toUpperCase()}</span>
            <p>Sem foto de perfil pública</p>
          </div>
        )}
      </div>
    );
  }
  if (id === "filePreviewName") return ctx.files.fileInput?.name || "";
  if (id === "bulkCount") return `${ctx.bulk.length} selecionadas`;
  if (id === "tagsModalContent")
    return (
      <>
        <p>
          {ctx.editor?.item?.bulk
            ? `Aplicar tags às ${ctx.bulk.length} conversas selecionadas.`
            : "Selecione as tags desta conversa."}
        </p>
        <div className="tags-picker-full">
          <TagPicker ctx={ctx} field="conversationTags" />
        </div>
      </>
    );
  if (id === "contactsCount") return `${ctx.data.contacts.length} contatos`;
  if (id === "contactsGrid") {
    const items = ctx.data.contacts
      .filter(
        (contact) =>
          `${contact.name || ""} ${internalId(contact.number, contact) ? "" : contact.number}`
            .toLocaleLowerCase("pt-BR")
            .includes(
              (ctx.fields.contactSearch || "").toLocaleLowerCase("pt-BR"),
            ) &&
          (ctx.alpha === "all" ||
            (contact.name || "")
              .toUpperCase()
              .startsWith(ctx.alpha)),
      )
      .sort((a, b) =>
        (a.name || "").localeCompare(
          b.name || "",
          "pt-BR",
        ),
      );
    return items.length ? (
      items.map((contact) => (
        <Action
          className="contact-card"
          key={contact.number}
          data-number={contact.number}
          action={() => ctx.openConversation(contact.number)}
        >
          <Avatar
            className="contact-avatar"
            number={contact.number}
            label={name(ctx, contact.number, contact)}
          />
          <div className="contact-info">
            <strong>{name(ctx, contact.number, contact)}</strong>
            <small>
              {internalId(contact.number, contact)
                ? "Contato WhatsApp"
                : phone(contact.number)}
            </small>
            <div>{pills(ctx, contact.tags)}</div>
          </div>
        </Action>
      ))
    ) : (
      <Empty>Nenhum contato encontrado.</Empty>
    );
  }
  if (node.props.className?.split(" ").includes("composer-attach"))
    return (
      <>
        <button
          type="button"
          className="attach-btn"
          id="attachBtn"
          title="Anexar arquivo"
          onClick={ctx.actions.attachBtn}
        >
          <Icon name="paperclip" />
        </button>
        <VoiceRecorder key={ctx.selected} ctx={ctx} />
        <span className="react-emoji-wrap">
          <button
            type="button"
            className="attach-btn emoji-trigger"
            id="emojiBtn"
            title="Inserir emoji"
            aria-expanded={ctx.emojiOpen}
            onClick={ctx.actions.emojiBtn}
          >
            <Icon name="smile" />
          </button>
          {ctx.emojiOpen && (
            <span
              className="react-emoji-panel"
              role="group"
              aria-label="Emojis"
            >
              {["😀", "😊", "👍", "❤️", "🎉", "🙏", "✅", "👋"].map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  aria-label={"Inserir " + emoji}
                  onClick={() => {
                    ctx.setField(
                      "composerInput",
                      (ctx.fields.composerInput || "") + emoji,
                    );
                    ctx.setEmojiOpen(false);
                    requestAnimationFrame(() => document.getElementById('composerInput')?.focus({ preventScroll: true }));
                  }}
                >
                  {emoji}
                </button>
              ))}
            </span>
          )}
        </span>
      </>
    );
  return undefined;
}
