const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const { Client } = require("pg");

async function main() {
  const binaries =
    process.env.POSTGRES_BIN ||
    (process.platform === "win32"
      ? "C:/Program Files/PostgreSQL/18/bin"
      : "/usr/lib/postgresql/18/bin");
  const binary = (name) =>
    path.join(binaries, name + (process.platform === "win32" ? ".exe" : ""));
  if (!fs.existsSync(binary("initdb")))
    throw new Error(
      "Defina POSTGRES_BIN para uma instalação local de PostgreSQL.",
    );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "convelya-flow-pg-"));
  const data = path.join(directory, "data");
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let started = false;
  const run = async (file, args) =>
    execute(file, args, {
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
    });
  try {
    await run(binary("initdb"), [
      "-D",
      data,
      "-U",
      "flow_audit",
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    await run(binary("pg_ctl"), [
      "-D",
      data,
      "-l",
      path.join(directory, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -F`,
      "-w",
      "start",
    ]);
    started = true;
    const admin = new Client({
      host: "127.0.0.1",
      port,
      user: "flow_audit",
      database: "postgres",
      ssl: false,
    });
    await admin.connect();
    try {
      for (const testFile of [
        "test/flows.test.js",
        "test/flow-service-audit.test.js",
      ]) {
        if (!fs.existsSync(testFile)) continue;
        const name =
          "convelya_flow_audit_" +
          path.basename(testFile).replace(/[^a-z]/g, "");
        await admin.query(`CREATE DATABASE "${name}"`);
        const env = {
          ...process.env,
          FLOW_TEST_DATABASE_URL: `postgresql://flow_audit@127.0.0.1:${port}/${name}?sslmode=disable`,
        };
        delete env.DATABASE_PRIVATE_URL;
        console.log("PostgreSQL local:", testFile);
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["--test", testFile], {
            env,
            stdio: "inherit",
            windowsHide: true,
          });
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Tempo de teste PostgreSQL excedido."));
          }, 180000);
          child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on("exit", (code) => {
            clearTimeout(timer);
            code === 0
              ? resolve()
              : reject(
                  new Error(`Falha no PostgreSQL: ${testFile} (${code}).`),
                );
          });
        });
      }
    } finally {
      await admin.end();
    }
  } finally {
    if (started)
      await run(binary("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) === os.tmpdir() &&
      path.basename(resolved).startsWith("convelya-flow-pg-")
    )
      fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
