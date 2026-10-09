import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { UI, Template } from "./template";
import { api, getApiChannel, setApiChannel, cleanNumber, requireLogin, routes } from "./api";
import { Workspace, useSiteMotion } from "./components";
import { pageActions, pageAttributes, pageSlot, pageSubmits } from "./pages";
import { inboxActions, inboxAttributes, inboxSlot, inboxSubmit } from "./inbox";
import { InteractionEffects } from "./motion";
import { Avatar, invalidatePhotos } from "./avatar";
import { useAttendancePreferences } from './attendance-preferences';
import { can, pagePermissions, resourcePermissions, actionPermission } from './access';
import { TeamEditor, TeamList } from './team';
import { AccountSettings } from './account-settings';

const defaults = {
  contacts: [],
  tags: [],
  departments: [],
  team: [],
  campaigns: [],
  flows: [],
  webhooks: [],
  chips: [],
  followups: [],
  kanban: { columns: [], opportunities: [] },
  reasons: [],
  variables: [],
  stats: {},
  state: { conversations: {}, status: {}, activeTarget: null, user: {} },
};
const resources = {
  contacts: ["/api/contacts", "contacts"],
  tags: ["/api/tags", "tags"],
  departments: ["/api/departments", "departments"],
  team: ["/api/team", "team"],
  campaigns: ["/api/campaigns", "campaigns"],
  flows: ["/api/flows", "flows"],
  webhooks: ["/api/webhooks", "webhooks"],
  chips: ["/api/chips", "chips"],
  followups: ["/api/followups", "followups"],
  reasons: ["/api/loss-reasons", "reasons"],
  variables: ["/api/global-variables", "variables"],
  kanban: ["/api/kanban", null],
  stats: ["/api/dashboard/stats", null],
  state: ["/api/state", null],
};
const pageResources = {
  overview: ["stats", "kanban"],
  campaigns: ["campaigns"],
  flows: ["flows", "variables"],
  webhooks: ["webhooks"],
  kanban: ["kanban", "reasons"],
  chips: ["chips"],
  settings: [],
  team: ["team", "departments", "kanban"],
};
function storedWorkspace() {
  try {
    return (
      JSON.parse(sessionStorage.getItem("bwap-workspace-state") || "{}") || {}
    );
  } catch {
    return {};
  }
}
export function Application({ layout, page, title, onNavigate }) {
  const workspace = useMemo(storedWorkspace, []);
  const [access, setAccess] = useState(null);
  const accessRef = useRef(null);
  const [data, setData] = useState(defaults),
    [fields, setFields] = useState({
      ...layout.fields,
      departmentFilter: workspace.departmentFilter || "all",
    });
  const [files, setFiles] = useState({}),
    [replyTarget, setReplyTarget] = useState(null),
    [profileLoading, setProfileLoading] = useState(page === "settings"),
    [fileKeys, setFileKeys] = useState({}),
    [errors, setErrors] = useState({}),
    [notice, setNotice] = useState(null),
    [editor, setEditor] = useState(null);
  const [channel, setChannelId] = useState(getApiChannel());
  const [selected, setSelected] = useState(workspace.selectedNumber || ""),
    [filter, setFilter] = useState(workspace.conversationFilter || "all");
  const [tab, setTab] = useState("conversations"),
    [alpha, setAlpha] = useState("all"),
    [collapsed, setCollapsed] = useState(false),
    [chartDays, setChartDays] = useState(7);
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [confirmation, setConfirmation] = useState(null),
    [busy, setBusy] = useState(""),
    [importResult, setImportResult] = useState(null);
  const [bulk, setBulk] = useState([]),
    [bulkMode, setBulkMode] = useState(false),
    [emojiOpen, setEmojiOpen] = useState(false);
  const answerRef = useRef(null),
    runningActions = useRef(new Set()),
    socketRef = useRef(null),
    root = useRef(null),
    latest = useRef(null);
  useSiteMotion(root);
  const attendance = useAttendancePreferences(data.state.user?.username);
  const lastNotified = useRef(new Map());
  const synchronizingChip = [data.state.channelStatus, ...(data.state.chips || [])]
    .find(chip => chip?.connected && chip.contactsSync && !chip.contactsSync.verified);
  const contactsBlocked = Boolean(synchronizingChip);
  const syncDialog = useRef(null);
  useEffect(() => {
    if (!contactsBlocked) return;
    document.querySelectorAll('[popover]:popover-open').forEach(element => element.hidePopover());
    syncDialog.current?.focus();
  }, [contactsBlocked]);
  const notify = useCallback(
    (text, type = "error") => setNotice({ text, type }),
    [],
  );
  const setField = useCallback(
    (id, value) => setFields((previous) => ({ ...previous, [id]: value })),
    [],
  );
  const load = useCallback(async (key) => {
    if (key !== 'state' && !can(accessRef.current, resourcePermissions[key])) {
      setData((previous) => ({ ...previous, [key]: defaults[key] }));
      return defaults[key];
    }
    const [url, property] = resources[key];
    const requestedChannel = getApiChannel();
    const result = await api(url);
    if (["state", "contacts"].includes(key) && requestedChannel !== getApiChannel()) return result;
    const value = property ? result[property] || [] : result;
    if (key === "state") {
      if (value.authorization) { accessRef.current = value.authorization; setAccess(value.authorization); }
      setApiChannel(value.chipId);
      setChannelId(String(value.chipId || ""));
    }
    setData((previous) => ({ ...previous, [key]: value }));
    return value;
  }, []);
  const refresh = useCallback(async () => {
    await load('state');
    await Promise.allSettled(
      [
        "contacts",
        "tags",
        "departments",
        ...(pageResources[page] || []),
      ].map((key) =>
        load(key).catch((error) => {
          if (key !== "state") notify(error.message);
        }),
      ),
    );
  }, [page, load, notify]);
  useEffect(() => {
    if (!matchMedia('(max-width: 720px)').matches) return;
    const frame = requestAnimationFrame(() => {
      const navigation = document.querySelector('.main-nav');
      const current = navigation?.querySelector('[aria-current="page"]');
      if (!current || !navigation.clientWidth) return;
      const navRect = navigation.getBoundingClientRect(), rect = current.getBoundingClientRect();
      navigation.scrollLeft += rect.left - navRect.left - navigation.clientWidth / 2 + rect.width / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, collapsed, access]);
  const closeEditor = useCallback(() => {
    setEditor(null);
    setErrors({});
  }, []);
  const openEditor = useCallback((id, values = {}, item = null) => {
    setFields((previous) => ({ ...previous, ...values }));
    setEditor({ id, item });
    setErrors({});
  }, []);
  const resource = useCallback((definition) => {
    setEditor({ id: "resource-" + Date.now(), resource: definition });
  }, []);
  const confirm = useCallback(
    (definition) =>
      new Promise((resolve) => {
        answerRef.current?.(false);
        answerRef.current = resolve;
        setConfirmation(definition);
      }),
    [],
  );
  const answer = useCallback((value) => {
    setConfirmation(null);
    answerRef.current?.(value);
    answerRef.current = null;
  }, []);
  const execute = useCallback(
    async (id, action, errorId) => {
      if (runningActions.current.has(id)) return;
      runningActions.current.add(id);
      setBusy(id);
      if (errorId) setErrors((previous) => ({ ...previous, [errorId]: "" }));
      try {
        await action();
      } catch (error) {
        if (errorId)
          setErrors((previous) => ({ ...previous, [errorId]: error.message }));
        else notify(error.message);
      } finally {
        runningActions.current.delete(id);
        setBusy("");
      }
    },
    [notify],
  );
  const canonical = (number) => {
    const clean = cleanNumber(number),
      conversations = data.state.conversations || {};
    return conversations[clean]
      ? clean
      : Object.entries(conversations).find(([, item]) =>
          item.aliases?.includes(clean),
        )?.[0] || clean;
  };
  const navigate = (target) => {
    if (routes[target]) onNavigate(routes[target]);
  };
  const openConversation = (number) => {
    const target = canonical(number);
    if (!target) {
      notify("Digite um número válido para abrir a conversa.");
      return;
    }
    setSelected(target);
    try {
      sessionStorage.setItem(
        "bwap-workspace-state",
        JSON.stringify({
          selectedChipId: getApiChannel(),
          selectedNumber: target,
          conversationFilter: filter,
          departmentFilter: fields.departmentFilter || "all",
        }),
      );
    } catch {}
    if (page !== "inbox") navigate("inbox");
    requestAnimationFrame(() => {
      const current = latest.current;
      if (current?.page === 'inbox' && current.selected === target && !current.editor && !current.contactsBlocked) {
        document.getElementById('composerInput')?.focus({ preventScroll: true });
      }
    });
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("bwap-theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "bwap-workspace-state",
        JSON.stringify({
          selectedChipId: channel,
          selectedNumber: selected,
          conversationFilter: filter,
          departmentFilter: fields.departmentFilter || "all",
        }),
      );
    } catch {}
  }, [selected, channel, filter, fields.departmentFilter]);
  useEffect(() => {
    const number = canonical(selected);
    if (number !== selected) setSelected(number);
  }, [data.state.conversations]);
  useEffect(() => {
    setFields((previous) => ({ ...layout.fields, ...previous }));
    closeEditor();
    refresh();
  }, [page, refresh]);
  useEffect(() => {
    let active = true;
    let expiryTimer;
    let expiresAt = 0;
    const checkSession = async () => {
      if (expiresAt && Date.now() >= expiresAt) {
        requireLogin();
        return;
      }
      try {
        const session = await api("/api/session");
        if (!active) return;
        if (!session.authenticated) return requireLogin();
        expiresAt = Date.now() + session.remainingMs;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(requireLogin, Math.max(0, session.remainingMs));
      } catch {
        // Keep the existing expiry timer when the network is unavailable.
      }
    };
    const resume = () => {
      if (!document.hidden) checkSession();
    };
    checkSession();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      clearTimeout(expiryTimer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    const socket = io(window.BACKEND_URL || undefined, {
      withCredentials: true,
      auth: { chipId: getApiChannel() },
    });
    socketRef.current = socket;
    socket.on("init", (state) =>
      { if (!getApiChannel() || String(state.chipId) === getApiChannel()) { if (state.authorization) { accessRef.current = state.authorization; setAccess(state.authorization); } setApiChannel(state.chipId); setChannelId(String(state.chipId || "")); setData((previous) => ({ ...previous, state })); } },
    );
    socket.on('authorization:changed', ({ authorization }) => {
      const previousAccess = accessRef.current;
      const comparable = (value) => JSON.stringify(value && { ...value, version: undefined });
      const changed = comparable(previousAccess) !== comparable(authorization);
      accessRef.current = authorization; setAccess(authorization);
      if (changed) {
        setData((previous) => ({ ...defaults, state: { ...previous.state, conversations: {}, authorization } }));
        if (!authorization.owner) setSelected('');
        closeEditor();
      }
      refresh().catch(() => {});
    });
    socket.on("status", (status) => {
      setData(previous => ({ ...previous, state: { ...previous.state,
        channelStatus: !status?.chipId || String(status.chipId) === String(previous.state.chipId)
          ? { ...previous.state.channelStatus, ...status } : previous.state.channelStatus,
        chips: previous.state.chips?.map(chip => String(chip.chipId) === String(status?.chipId) ? { ...chip, ...status } : chip),
      } }));
      // Contact batches already carry their state; avoid querying full history per batch.
      if (!status?.contactsSync) load("state").catch(() => {});
    });
    socket.on("message", (conversation) => {
      if (!conversation?.number) return;
      if (conversation.chipId && String(conversation.chipId) !== getApiChannel()) return;
      const message = conversation.messages?.at(-1);
      const key = `${conversation.chipId}:${conversation.number}`;
      const previous = latest.current?.data.state.conversations?.[conversation.number]?.messages?.at(-1);
      const messageKey = message && `${message.id}:${message.at}:${message.text}`;
      if (!conversation.mutation && message?.from === 'client' && messageKey !== lastNotified.current.get(key) && messageKey !== (previous && `${previous.id}:${previous.at}:${previous.text}`)) {
        lastNotified.current.set(key, messageKey);
        latest.current?.playNotification().catch(() => {});
      }
      setData((previous) => ({
        ...previous,
        state: {
          ...previous.state,
          conversations: {
            ...previous.state.conversations,
            [conversation.number]: conversation,
          },
        },
      }));
    });
    socket.on("contact", (contact) => {
      if (contact.chipId && String(contact.chipId) !== getApiChannel()) return;
      setData((previous) => ({
        ...previous,
        contacts: [
          ...previous.contacts.filter((item) => item.number !== contact.number),
          contact,
        ],
      }));
    });
    let contactsRefresh = null;
    socket.on("contacts:updated", (payload) => {
      if (payload?.chipId && String(payload.chipId) !== getApiChannel()) return;
      if (!contactsRefresh) contactsRefresh = Promise.all([load("contacts"), load("state")])
        .catch(error => notify(error.message)).finally(() => { contactsRefresh = null; });
    });
    socket.on("profile:updated", ({ number }) => invalidatePhotos(number));
    socket.on("active-target", (target) => {
      if (target?.chipId && String(target.chipId) !== getApiChannel()) return;
      setData((previous) => ({ ...previous, state: { ...previous.state, activeTarget: typeof target === 'object' ? target?.number : target } }));
    });
    socket.on("conversation:deleted", (result) => {
      if (result.chipId && String(result.chipId) !== getApiChannel()) return;
      setData((previous) => {
        const conversations = { ...previous.state.conversations };
        const number = typeof result === "string" ? result : result.number;
        delete conversations[number];
        if (result.conversation) conversations[number] = result.conversation;
        return { ...previous, state: { ...previous.state, conversations } };
      });
    });
    socket.on("chip:status", (status) => setData((previous) => {
      const chips = previous.state.chips?.map((chip) => String(chip.chipId) === String(status.chipId) ? { ...chip, ...status } : chip) || [];
      return { ...previous,
        chips: previous.chips.map((chip) => String(chip.id) === String(status.chipId) ? { ...chip, number: status.number ?? chip.number, _connected: status.connected, _qr: status.qr, _error: status.error || '' } : chip),
        state: { ...previous.state, chips, status: { ...previous.state.status, connected: chips.some((chip) => chip.connected), connectedCount: chips.filter((chip) => chip.connected).length },
          channelStatus: String(previous.state.chipId) === String(status.chipId) ? { ...previous.state.channelStatus, ...status } : previous.state.channelStatus }
      };
    }));
    socket.on("unauthorized", requireLogin);
    socket.on("init-error", () => load("state").catch(() => {}));
    socket.io.on("reconnect", () => latest.current.refresh());
    const focus = () => {
      if (!document.hidden) latest.current.refresh();
    };
    window.addEventListener("online", focus);
    document.addEventListener("visibilitychange", focus);
    const interval = setInterval(() => {
      if (!document.hidden) {
        load("state").catch(() => {});
        if (!latest.current?.contactsBlocked) load("contacts").catch(() => {});
      }
    }, 15000);
    return () => {
      socket.disconnect();
      clearInterval(interval);
      window.removeEventListener("online", focus);
      document.removeEventListener("visibilitychange", focus);
      answerRef.current?.(false);
    };
  }, [load, notify]);
  useEffect(() => {
    const error = (event) => notify(event.detail);
    window.addEventListener("app:navigation-error", error);
    return () => window.removeEventListener("app:navigation-error", error);
  }, [notify]);
  useEffect(() => {
    if (!data.chips.length || page !== "chips") return;
    let active = true;
    const fetchStatus = async () => {
      const results = await Promise.allSettled(data.chips.map((chip) => api(`/api/chips/${chip.id}/status`)));
      if (active) setData((previous) => ({ ...previous, chips: previous.chips.map((chip) => {
        const result = results[data.chips.findIndex((item) => item.id === chip.id)];
        return result?.status === 'fulfilled' ? { ...chip, number: result.value.number ?? chip.number, _connected: result.value.connected, _qr: result.value.qr, _error: result.value.error || '' } : chip;
      }) }));
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [data.chips.map((chip) => chip.id).join(','), page]);
  useEffect(() => { load("contacts").catch(() => {}); }, [channel, load]);

  const ctx = {
    replyTarget,
    setReplyTarget,
    current: () => latest.current,
    contactsBlocked,
    access,
    can: (permission) => can(access, permission),
    ...attendance,
    layout,
    page,
    data,
    setData,
    fields,
    setFields,
    files,
    fileKeys,
    setFile: (id, file) => {
      setFiles((previous) => ({ ...previous, [id]: file }));
      if (!file)
        setFileKeys((previous) => ({
          ...previous,
          [id]: (previous[id] || 0) + 1,
        }));
    },
    errors,
    setErrors,
    notice,
    setNotice,
    editor,
    openEditor,
    closeEditor,
    setEditorMode: (mode) => setEditor((previous) => ({ ...previous, mode })),
    resource,
    notify,
    load,
    refresh,
    execute,
    confirm,
    answer,
    confirmation,
    busy,
    selected,
    setSelected,
    filter,
    setFilter,
    canonical,
    selectChannel: (id) => {
      setApiChannel(id); setChannelId(String(id)); setSelected(""); setBulk([]); setBulkMode(false); closeEditor();
      setFields((previous) => ({ ...previous, composerInput: "", newChatInput: "" }));
      setFiles({});
      setData((previous) => ({ ...previous, contacts: [], state: { ...previous.state, chipId: Number(id), conversations: {}, activeTarget: null, channelStatus: { connected: false } } }));
      load("state").catch((error) => notify(error.message));
    },
    navigate,
    openConversation,
    tab,
    setTab,
    alpha,
    setAlpha,
    collapsed,
    setCollapsed,
    theme,
    setTheme,
    chartDays,
    setChartDays,
    setField,
    importResult,
    setImportResult,
    bulk,
    setBulk,
    bulkMode,
    setBulkMode,
    emojiOpen,
    setEmojiOpen,
  };
  latest.current = ctx;
  useEffect(() => {
    if (!access) return;
    const permission = pagePermissions[page];
    if (permission && !can(access, permission)) {
      const target = Object.entries(pagePermissions).find(([, permission]) => !permission || can(access, permission))?.[0] || 'settings';
      location.replace(routes[target]);
    }
    if (!access.owner && selected && !data.state.conversations?.[selected]) setSelected('');
  }, [access, page, data.state.conversations]);
  useEffect(() => {
    if (page !== "settings") return;
    let active = true;
    setProfileLoading(true);
    setErrors((previous) => ({ ...previous, profileError: "" }));
    setFields((previous) => ({ ...previous, profileUsername: "", profileDisplayName: "", profileCurrentPassword: "", profileNewPassword: "", profileConfirmPassword: "" }));
    api("/api/profile")
      .then((profile) => {
        if (!active) return;
        setFields((previous) => ({ ...previous, profileUsername: profile.username, profileDisplayName: profile.displayName }));
      })
      .catch((error) => {
        if (active) setErrors((previous) => ({ ...previous, profileError: error.message }));
      })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [page]);
  const openProfile = () => navigate("settings");
  ctx.actions = {
    sidebarToggle: () => setCollapsed(!collapsed),
    accountAvatarBtn: openProfile,
    profileBtn: openProfile,
    myAccountBtn: openProfile,
    profileSaveBtn: undefined,
    logoutBtn: () =>
      execute("logoutBtn", async () => {
        await api("/api/logout", "POST");
        location.assign("/");
      }),
    settingsLogout: () =>
      execute("settingsLogout", async () => {
        await api("/api/logout", "POST");
        location.assign("/");
      }),
    disconnectBtn: () =>
      execute("disconnectBtn", async () => {
        if (
          await confirm({
            title: "Desconectar WhatsApp?",
            body: "Será necessário escanear o QR Code para reconectar.",
            okText: "Desconectar",
          })
        ) {
          await api("/api/disconnect", "POST");
          await load("state");
        }
      }),
    settingsDisconnect: () => ctx.actions.disconnectBtn(),
    ...pageActions(ctx),
    ...inboxActions(ctx),
    newTeamMemberBtn: () => openEditor('teamMemberModal', {}, null),
  };
  ctx.submits = {
    profileForm: (event) =>
      execute(
        "profileSaveBtn",
        async () => {
          const payload = Object.fromEntries(
            new FormData(event.currentTarget).entries(),
          );
          const profile = await api("/api/profile", "PUT", payload);
          setData((previous) => ({
            ...previous,
            state: { ...previous.state, user: profile },
          }));
          setFields((previous) => ({ ...previous, profileUsername: profile.username, profileDisplayName: profile.displayName, profileCurrentPassword: "", profileNewPassword: "", profileConfirmPassword: "" }));
          notify("Perfil atualizado.", "success");
        },
        "profileError",
      ),
    ...pageSubmits(ctx),
    ...inboxSubmit(ctx),
  };
  // Form validation remains visible inside each React editor, with values preserved.
  for (const [id, submit] of Object.entries(ctx.submits))
    ctx.submits[id] = (event) => {
      const invalid = [...event.currentTarget.elements].find(
        (input) => input.willValidate && !input.validity.valid,
      );
      if (invalid) {
        const errorId = event.currentTarget.querySelector(
          ".profile-error,[role=alert]",
        )?.id;
        if (errorId)
          setErrors((previous) => ({
            ...previous,
            [errorId]: `${invalid.labels?.[0]?.textContent || "Campo"}: ${invalid.validationMessage}`,
          }));
        else notify(invalid.validationMessage);
        invalid.focus();
        return;
      }
      submit(event);
    };
  ctx.attributes = (id, node) => {
    const attributes = {};
    if (id === "profileLoading") attributes.hidden = !profileLoading;
    if (profileLoading && ["profileUsername", "profileDisplayName", "profileCurrentPassword", "profileNewPassword", "profileConfirmPassword", "profileSaveBtn"].includes(id)) {
      attributes.disabled = true;
    }
    if (errors[id] !== undefined || id?.endsWith("Error"))
      attributes.hidden = !errors[id];
    if (id === "sidebarToggle") {
      attributes["aria-expanded"] = !collapsed;
      attributes["aria-label"] = collapsed
        ? "Expandir menu lateral"
        : "Recolher menu lateral";
    }
    if (id === "tabConversations" || id === "tabContacts") {
      const active =
        tab === (id === "tabContacts" ? "contacts" : "conversations");
      attributes.hidden = !active;
      attributes.className = "list-tab-content" + (active ? " is-active" : "");
    }
    if (id === "qrWrap")
      attributes.hidden =
        !data.state.status?.qr || !!data.state.status?.connected;
    if (id === "qrImage") attributes.src = data.state.status?.qr || undefined;
    if (id === "connDot")
      attributes.className =
        "brand-mark" + (data.state.status?.connected ? " is-online" : "");
    if (id === "connText")
      attributes.className =
        "conn-value " +
        (data.state.status?.connected ? "is-online" : "is-offline");
    if (
      id === busy ||
      (node.tag === "button" && node.props.type === "submit" && busy)
    ) {
      attributes.disabled = true;
      attributes["aria-busy"] = true;
    }
    if (node.props["data-page-view"])
      attributes["data-react-component"] = node.props["data-page-view"];
    if (node.props["data-page"]) {
      const active = node.props["data-page"] === page;
      attributes.className = "nav-item" + (active ? " is-active" : "");
      attributes["aria-current"] = active ? "page" : undefined;
      attributes.hidden = !can(access, pagePermissions[node.props['data-page']]);
    }
    if (node.props['data-page-link']) attributes.hidden = !can(access, pagePermissions[node.props['data-page-link']]);
    if (!can(access, actionPermission({ ...node.props, id }))) attributes.hidden = true;
    if (id === 'composer') attributes.hidden = !can(access, 'atendimento.responder');
    if (id && layout.editors[id] && editor?.id === id)
      attributes.hidden = false;
    return {
      ...attributes,
      ...pageAttributes(ctx, id, node),
      ...inboxAttributes(ctx, id, node),
      ...(!can(access, actionPermission({ ...node.props, id })) || (id === 'composer' && !can(access, 'atendimento.responder')) ? { hidden: true } : {}),
    };
  };
  ctx.slot = (id, node) => {
    if (id === 'accountSettingsSlot') return ctx.can('configuracoes.visualizar') ? <AccountSettings key={access?.version} ctx={ctx} /> : null;
    if (id === 'teamTable') return access ? <TeamList ctx={ctx} /> : null;
    if (id === "pageWorkspace") return <Workspace />;
    if (id === "connText" || id === "topbarConnection")
      return data.state.status?.connected ? "Conectado" : "Desconectado";
    if (id === "profileBtn")
      return (
        data.state.user?.displayName ||
        data.state.user?.username ||
        "Minha conta"
      );
    if (id === "accountAvatarBtn")
      return (
        <Avatar
          number="me"
          label={
            data.state.user?.displayName ||
            data.state.user?.username ||
            "Minha conta"
          }
        />
      );
    if (id === "currentPageLabel") return title.split(" — ")[0];
    if (errors[id]) return errors[id];
    const result = pageSlot(ctx, id, node),
      value = result !== undefined ? result : inboxSlot(ctx, id, node);
    if (
      (typeof value === "number" || typeof value === "string") &&
      /^(overview|convoCount|contactsCount|chipsBadge|bulkCount)/.test(id || "")
    )
      return (
        <span className="motion-value" key={value}>
          {value}
        </span>
      );
    return value;
  };
  ctx.replace = (node) => node.props.id === 'teamMemberModal' && editor?.id === 'teamMemberModal' ? <TeamEditor key={editor.item?.id || 'new'} ctx={ctx} /> : undefined;
  ctx.composerKey = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      ctx.actions.sendBtn();
    }
  };
  useEffect(() => {
    if (replyTarget && (replyTarget.number !== selected || String(replyTarget.chipId) !== String(data.state.chipId) || !data.state.conversations?.[selected]?.messages?.some(message => message.id === replyTarget.message.id))) setReplyTarget(null);
  }, [selected, data.state.chipId, data.state.conversations, replyTarget]);
  useEffect(() => {
    if (page !== 'inbox' || !selected || contactsBlocked || !(data.state.channelStatus || data.state.status)?.connected || !can(access, 'atendimento.responder')) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement?.closest('.convo-item,.contact-item')) {
        document.getElementById('composerInput')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page, selected, channel, contactsBlocked, (data.state.channelStatus || data.state.status)?.connected, access]);
  useEffect(() => {
    window.AppCore = {
      refreshTags: () => load("tags"),
      refreshContacts: () => load("contacts"),
      refreshDepartments: () => load("departments"),
      openConversation: (number) => latest.current.openConversation(number),
      showPage: (target) => latest.current.navigate(target),
      getContacts: () => latest.current.data.contacts,
      getConversations: () => latest.current.data.state.conversations,
      ...Object.fromEntries(
        [
          ["CampaignsPage", "campaigns"],
          ["FlowsPage", "flows"],
          ["WebhooksPage", "webhooks"],
          ["KanbanPage", "kanban"],
          ["ChipsPage", "chips"],
          ["TeamPage", "team"],
        ]
          .filter(([, key]) => (pageResources[page] || []).includes(key))
          .map(([name, key]) => [name, { init: () => load(key) }]),
      ),
    };
    return () => {
      delete window.AppCore;
    };
  }, [load, page]);
  useEffect(() => {
    const keyboard = (event) => {
      if (latest.current?.contactsBlocked) return;
      if (event.key === "Escape") {
        latest.current.answer(false);
        latest.current.closeEditor();
        latest.current.setEmojiOpen(false);
        latest.current.setBulk([]);
        latest.current.setBulkMode(false);
      }
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.target.closest("input,textarea,select,[contenteditable=true]")
      ) {
        const search = document.getElementById("conversationSearch");
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);
  return (
    <UI.Provider value={ctx}>
      <div ref={root} className="react-page" inert={contactsBlocked} aria-busy={contactsBlocked}>
        <Template nodes={layout.nodes} />
      </div>
      {contactsBlocked && <div className="contacts-sync-overlay">
        <section className="contacts-sync-dialog" ref={syncDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="contacts-sync-title" aria-describedby="contacts-sync-description">
          {synchronizingChip.contactsSync.stage !== 'error' && <span className="contacts-sync-spinner" aria-hidden="true" />}
          <span className="contacts-sync-connected">WhatsApp conectado</span>
          <h2 id="contacts-sync-title">{synchronizingChip.contactsSync.stage === 'error' ? 'Não foi possível carregar os contatos' : synchronizingChip.contactsSync.stage === 'verifying' ? 'Verificando os contatos' : 'Carregando os contatos'}</h2>
          <p id="contacts-sync-description" role="status">{synchronizingChip.contactsSync.stage === 'error' ? `${synchronizingChip.contactsSync.error || 'Não foi possível concluir a sincronização.'} Tente novamente para liberar o painel.` : 'Aguarde enquanto sincronizamos sua agenda. O painel será liberado ao concluir a carga e a verificação.'}</p>
          {synchronizingChip.name && <small>{synchronizingChip.name}</small>}
          {synchronizingChip.contactsSync.stage === 'error' && <button type="button" className="btn btn-primary" disabled={busy === 'contacts-sync'} onClick={async () => {
            setBusy('contacts-sync');
            try {
              await api(`/api/whatsapp/sync-contacts?chipId=${encodeURIComponent(synchronizingChip.chipId || data.state.chipId || '')}`, 'POST', {});
              await refresh();
            } catch (error) { notify(error.message); } finally { setBusy(''); }
          }}>{busy === 'contacts-sync' ? 'Tentando novamente…' : 'Tentar novamente'}</button>}
        </section>
      </div>}
      <div id="interaction-effects" aria-hidden="true">
        <InteractionEffects />
      </div>
    </UI.Provider>
  );
}
