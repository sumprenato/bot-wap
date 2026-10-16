const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const { getQuickJS } = require("quickjs-emscripten");
function publicAddress(ip) {
  if (net.isIP(ip) === 6)
    return (
      /^2[0-9a-f]{3}:/i.test(ip) &&
      !/^2001:(?:db8|0|10|20):/i.test(ip) &&
      !ip.toLowerCase().startsWith("2002:")
    );
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
async function safeRequest(config, secrets = process.env) {
  const url = new URL(config.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.endsWith(".local") ||
    url.hostname === "localhost"
  )
    throw new Error("URL não permitida. Use HTTPS público na porta 443.");
  let dnsTimer;
  const records = await Promise.race([
    dns.lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }),
    new Promise((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new Error("Tempo de resolução DNS excedido.")),
        3000,
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw new Error("Endereço privado ou reservado bloqueado.");
  const headers = {};
  for (const [key, value] of Object.entries(config.headers || {})) {
    if (
      !/^[\w-]+$/.test(key) ||
      /^(host|connection|content-length|transfer-encoding|authorization|cookie|proxy-authorization)$/i.test(
        key,
      ) ||
      /[\r\n]/.test(String(value))
    )
      throw new Error(
        "Header não permitido. Configure credenciais no servidor.",
      );
    headers[key] = String(value);
  }
  if (config.secretName) {
    if (
      !/^FLOW_SECRET_[A-Z0-9_]+$/.test(config.secretName) ||
      !secrets[config.secretName]
    )
      throw new Error("Credencial não encontrada no servidor.");
    headers.Authorization = `Bearer ${secrets[config.secretName]}`;
  }
  const body =
    config.method === "GET" ? null : JSON.stringify(config.body ?? {});
  if (body?.length > 256000) throw new Error("Body excede 256 KB.");
  if (body) headers["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: config.method,
        headers,
        lookup: (_, options, cb) =>
          options.all
            ? cb(null, [records[0]])
            : cb(null, records[0].address, records[0].family),
        signal: AbortSignal.timeout(
          Math.min(15000, Math.max(100, Number(config.timeout) || 10000)),
        ),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024)
            req.destroy(new Error("Resposta excede 1 MB."));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300)
            return reject(
              new Error(
                `HTTP ${res.statusCode}; redirecionamentos não são seguidos.`,
              ),
            );
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("A resposta HTTP deve ser JSON."));
          }
        });
      },
    );
    req.on("error", () =>
      reject(
        Object.assign(
          new Error("Requisição HTTP falhou ou excedeu o timeout."),
          { uncertain: config.method !== "GET" },
        ),
      ),
    );
    if (body) req.write(body);
    req.end();
  });
}
async function script(code, variables, now, timezone, compileOnly = false) {
  if (typeof code !== "string" || code.length > 20000)
    throw new Error("Script inválido (máximo 20 KB).");
  const quick = await getQuickJS(),
    runtime = quick.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  let deadline = Infinity;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(now))
      .replace(" ", "T");
    // UTC getters on this shifted epoch implement flow-local wall clock getters.
    const wrapped = `const variables = JSON.parse(${JSON.stringify(JSON.stringify(variables))});
      const RealDate = Date; const epoch = ${JSON.stringify(now)}; const localEpoch = ${Date.parse(local + "Z")};
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [localEpoch])); } static now() { return epoch; } getHours(){return this.getUTCHours()} getMinutes(){return this.getUTCMinutes()} getDay(){return this.getUTCDay()} getDate(){return this.getUTCDate()} getMonth(){return this.getUTCMonth()} getFullYear(){return this.getUTCFullYear()} };
      JSON.stringify((function(){ "use strict"; ${code}\n})())`;
    deadline = Date.now() + 200;
    const result = vm.evalCode(
      compileOnly ? `(function(){"use strict";${code}\n})` : wrapped,
    );
    if (result.error) {
      const message = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`Script: ${message?.message || "execução interrompida"}`);
    }
    if (compileOnly) {
      result.value.dispose();
      return true;
    }
    const json = vm.dump(result.value);
    result.value.dispose();
    if (typeof json !== "string" || json.length > 64000)
      throw new Error("Script deve retornar um valor JSON de até 64 KB.");
    return JSON.parse(json);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
module.exports = { publicAddress, safeRequest, script };
