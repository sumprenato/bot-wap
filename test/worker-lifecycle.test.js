const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWorkerLifecycle } = require('../worker-lifecycle');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

function worker(connected = true) {
  const instance = new EventEmitter();
  instance.connected = connected;
  instance.exits = [];
  instance.exit = code => instance.exits.push(code);
  return instance;
}

test('parent IPC loss closes transport and waits for persistence before exiting', async () => {
  const child = worker(), calls = [];
  let release;
  const saved = new Promise(resolve => { release = resolve; });
  const lifecycle = installWorkerLifecycle({ worker: child, stop: async () => { calls.push('stop_without_logout'); await saved; calls.push('saved'); }, close: async () => calls.push('db_closed') });
  child.emit('disconnect');
  assert.equal(lifecycle.stopping, true);
  assert.deepEqual(child.exits, []);
  assert.deepEqual(calls, ['stop_without_logout']);
  release(); await lifecycle.shutdown();
  assert.deepEqual(calls, ['stop_without_logout', 'saved', 'db_closed']);
  assert.deepEqual(child.exits, [0]);
});

test('deployment signals and IPC close run shutdown exactly once', async () => {
  const child = worker(); let stops = 0, closes = 0;
  const lifecycle = installWorkerLifecycle({ worker: child, stop: async () => { stops++; }, close: async () => { closes++; } });
  child.emit('SIGTERM'); child.emit('disconnect'); child.emit('SIGINT');
  await lifecycle.shutdown();
  assert.equal(stops, 1); assert.equal(closes, 1);
  assert.deepEqual(child.exits, [0]);
});

test('a worker whose parent already died is stopping before database startup can connect', async () => {
  const child = worker(false);
  const lifecycle = installWorkerLifecycle({ worker: child, stop: async () => {}, close: async () => {} });
  assert.equal(lifecycle.stopping, true);
  await lifecycle.shutdown();
  assert.deepEqual(child.exits, [0]);
});

test('shutdown has a deadline and cannot leave an orphan reconnecting forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = worker(); let release;
  const lifecycle = installWorkerLifecycle({ worker: child, stop: () => new Promise(resolve => { release = resolve; }), close: async () => {} });
  child.emit('disconnect'); t.mock.timers.tick(5000);
  assert.deepEqual(child.exits, [1]);
  release(); await lifecycle.shutdown();
  assert.deepEqual(child.exits, [1], 'late cleanup cannot exit twice');
});

for (const mode of ['parent IPC closes', 'manager sends shutdown']) {
  test(`real bot-worker exits after persistence when ${mode}`, { timeout: 7000 }, async t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-worker-exit-'));
    const bootstrap = path.join(folder, 'bootstrap.cjs'), journal = path.join(folder, 'events.log');
    fs.writeFileSync(bootstrap, `
      const Module = require('node:module'), fs = require('node:fs');
      const load = Module._load;
      const record = value => fs.appendFileSync(process.argv[2], value + '\\n');
      let keepAlive;
      const bot = {
        setIdentityVerifier() {},
        startBotWithRetry() { keepAlive = setInterval(() => {}, 1000); process.send({ type: 'fixture.ready' }); },
        async stopBot() { clearInterval(keepAlive); record('transport_closed'); await new Promise(resolve => setTimeout(resolve, 15)); record('credentials_saved'); },
      };
      Module._load = function(name, ...args) {
        if (name === './bot') return bot;
        if (name === './store') return {};
        if (name === './db') return { ready: Promise.resolve(), close: async () => record('database_closed') };
        return load.call(this, name, ...args);
      };
      require(process.argv[3]);
    `);
    const child = fork(bootstrap, [journal, path.resolve(__dirname, '../bot-worker.js')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    t.after(async () => {
      if (child.exitCode === null && !child.killed) { child.kill('SIGKILL'); await once(child, 'exit'); }
      assert.equal(path.dirname(folder), os.tmpdir());
      assert.ok(path.basename(folder).startsWith('bot-wap-worker-exit-'));
      fs.rmSync(folder, { recursive: true, force: true });
    });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker fixture did not become ready.')), 5000);
      child.on('message', message => { if (message.type === 'fixture.ready') { clearTimeout(timeout); resolve(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    await ready;
    const exited = once(child, 'exit');
    if (mode === 'parent IPC closes') child.disconnect();
    else child.send({ type: 'shutdown' });
    const [code, signal] = await exited;
    assert.equal(code, 0); assert.equal(signal, null);
    assert.deepEqual(fs.readFileSync(journal, 'utf8').trim().split('\n'), ['transport_closed', 'credentials_saved', 'database_closed']);
  });
}
