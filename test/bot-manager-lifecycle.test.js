const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const os = require('node:os');

function managerHarness(t) {
  const children = [], fork = childProcess.fork;
  childProcess.fork = () => {
    const child = new EventEmitter();
    Object.assign(child, { connected: true, exitCode: null, killed: false, sent: [],
      send(message, callback) { this.sent.push(message); callback?.(); },
      kill() { this.killed = true; this.exitCode = 0; this.connected = false; queueMicrotask(() => this.emit('exit', 0)); },
      exit(code = 0) { this.exitCode = code; this.connected = false; this.emit('exit', code); },
    });
    children.push(child); return child;
  };
  delete require.cache[require.resolve('../bot-manager')];
  let Manager;
  try { Manager = require('../bot-manager'); } finally { childProcess.fork = fork; }
  const manager = new Manager({ storageDir: os.tmpdir() });
  t.after(async () => { const stopping = manager.stopAll(); for (const child of children) if (child.exitCode === null) child.exit(); await stopping; });
  return { manager, children };
}

test('dashboard polling cannot bypass worker crash backoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { manager, children } = managerHarness(t), chip = { id: 1, user_id: 1 };
  manager.ensureWorker(chip); children[0].exit(1);
  for (let request = 0; request < 20; request++) assert.throws(() => manager.ensureWorker(chip), { code: 'WORKER_RESTARTING' });
  assert.equal(children.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(children.length, 2);
});

test('restart waits for the old worker to flush and exit before creating the next one', async t => {
  const { manager, children } = managerHarness(t), chip = { id: 1, user_id: 1 };
  manager.ensureWorker(chip);
  const restart = manager.restart(chip);
  assert.deepEqual(children[0].sent, [{ type: 'shutdown' }]);
  assert.equal(children.length, 1);
  assert.throws(() => manager.ensureWorker(chip), { code: 'WORKER_RESTARTING' });
  children[0].exit();
  const next = await restart;
  assert.equal(children.length, 2);
  assert.equal(next.child, children[1]);
  assert.equal(children[0].killed, false, 'normal restart requests graceful IPC shutdown');
});

test('stopping one channel leaves another live worker connected', async t => {
  const { manager, children } = managerHarness(t);
  manager.ensureWorker({ id: 1, user_id: 1 });
  const healthy = manager.ensureWorker({ id: 2, user_id: 1 });
  const stopping = manager.stopChip(1);
  assert.equal(manager.ensureWorker({ id: 2, user_id: 1 }), healthy);
  assert.equal(healthy.child.connected, true);
  children[0].exit(); await stopping;
  assert.equal(manager.workers.size, 1);
});

test('identity rejection codes survive IPC while transient verification errors stay transient', async t => {
  const { manager, children } = managerHarness(t);
  manager.ensureWorker({ id: 1, user_id: 1 });
  manager.verifyIdentity = async () => { throw Object.assign(new Error('Temporarily unavailable'), { code: 'ETIMEDOUT' }); };
  children[0].emit('message', { type: 'identity', id: 'transient', number: '5511999991111' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children[0].sent[0].code, 'ETIMEDOUT');
  manager.verifyIdentity = async () => { throw Object.assign(new Error('Wrong account'), { code: 'WHATSAPP_IDENTITY_REJECTED' }); };
  children[0].emit('message', { type: 'identity', id: 'permanent', number: '5511999991111' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children[0].sent[1].code, 'WHATSAPP_IDENTITY_REJECTED');
});
