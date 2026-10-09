export const routes = {
  inbox: "/atendimento",
  overview: "/dashboard",
  kanban: "/funis",
  campaigns: "/campanhas",
  flows: "/fluxos",
  contacts: "/contatos",
  webhooks: "/webhooks",
  departments: "/departamentos",
  tags: "/tags",
  chips: "/chips",
  settings: "/configuracoes",
  team: "/equipe",
};
export const cleanNumber = (value) => String(value || "").replace(/\D/g, "");
export function phone(value) {
  const number = cleanNumber(value);
  if (/^55\d{10,11}$/.test(number))
    return `+55 (${number.slice(2, 4)}) ${number.slice(4, -4)}-${number.slice(-4)}`;
  return number ? "+" + number : "";
}
export const internalId = (number, contact = {}) =>
  contact.jid?.endsWith("@lid") ||
  (!contact.jid?.endsWith("@s.whatsapp.net") &&
    /^\d{14,}$/.test(number || contact.number || ""));
export function contactPhone(number, contact = {}) {
  const candidates = [contact.phoneNumber, number, ...(contact.aliases || [])];
  return candidates.map(cleanNumber).find((value) => /^[1-9]\d{6,12}$/.test(value)) || '';
}
export function relative(value) {
  if (!value) return "Sem atividade";
  const date = new Date(value),
    minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return date.toLocaleDateString("pt-BR");
}
export function loginDestination(access, fallback = routes.inbox) {
  const requested = new URLSearchParams(location.search).get("redirect");
  if (requested?.startsWith("/") && !requested.startsWith("//")) {
    const url = new URL(requested, location.origin);
    const page = Object.entries(routes).find(([, route]) => route === url.pathname.replace(/\/$/, ''))?.[0];
    const permission = { inbox: 'atendimento.visualizar', overview: 'relatorios.visualizar', kanban: 'funis.visualizar', campaigns: 'campanhas.visualizar', flows: 'fluxos.visualizar', contacts: 'contatos.visualizar', team: 'equipe.visualizar', chips: 'chips.visualizar', tags: 'tags.visualizar', departments: 'departamentos.visualizar', webhooks: 'webhooks.visualizar' }[page];
    if (url.origin === location.origin && page && (!access || access.owner || !permission || access.permissions?.includes(permission)))
      return url.pathname + url.search + url.hash;
  }
  return fallback;
}
let redirectingToLogin = false;
export function requireLogin() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  location.replace(
    "/?redirect=" +
      encodeURIComponent(location.pathname + location.search + location.hash),
  );
}
let channelId = "";
try { channelId = String(JSON.parse(sessionStorage.getItem('bwap-workspace-state') || '{}').selectedChipId || ''); } catch {}
export const getApiChannel = () => channelId;
export const setApiChannel = (id) => { channelId = String(id || ''); };
export async function api(path, method = "GET", payload) {
  const scoped = /^\/api\/(state|contacts(?:\/.*)?|whatsapp\/profile\/.*|reply(?:-media)?|assumir|disconnect|conversations?(?:\/.*)?)(?:\?|$)/.test(path);
  const requestPath = scoped && channelId && !/[?&]chipId=/.test(path) && !payload?.chipId
    ? path + (path.includes('?') ? '&' : '?') + 'chipId=' + encodeURIComponent(channelId) : path;
  const body =
    payload instanceof FormData
      ? payload
      : payload === undefined
        ? undefined
        : JSON.stringify(payload);
  let response;
  try {
    response = await fetch((window.BACKEND_URL || "") + requestPath, {
      method,
      credentials: "include",
      cache: "no-store",
      ...(body && !(body instanceof FormData)
        ? { headers: { "Content-Type": "application/json" } }
        : {}),
      body,
    });
  } catch {
    throw new Error("Falha de conexão. Verifique sua rede e tente novamente.");
  }
  const data = await response.json().catch(() => ({}));
  const incorrectProfilePassword = path === "/api/profile" && method === "PUT" && data.error === "Senha atual incorreta.";
  if (response.status === 401 && path !== "/api/login" && !incorrectProfilePassword) requireLogin();
  if (!response.ok) {
    const error = new Error(
      data.error || "Não foi possível concluir a operação. Tente novamente.",
    );
    error.data = data;
    throw error;
  }
  return data;
}
export function downloadCsv(rows, filename = "contatos-bot-wap.csv") {
  const cell = (value) => {
    let text = String(value || "");
    if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
