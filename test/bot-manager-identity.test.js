const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const childProcess = require('node:child_process');
const os = require('node:os');

test('workers start without a typed phone and acknowledge identity only after verification', async (t) => {
  const fork = childProcess.fork;
  const children = [], environments = [];
  childProcess.fork = (_, __, options) => {
    environments.push(options.env);
    const child = new EventEmitter();
    Object.assign(child, { exitCode: null, killed: false, connected: true, sent: [],
      send(message, callback) { this.sent.push(message); callback?.(); if (message.type === 'shutdown') this.kill(); },
      kill() { this.killed = true; this.connected = false; this.exitCode = 0; queueMicrotask(() => this.emit('exit', 0)); } });
    children.push(child);
    return child;
  };
  let BotManager;
  try { BotManager = require('../bot-manager'); } finally { childProcess.fork = fork; }
  const manager = new BotManager({ storageDir: os.tmpdir() });
  t.after(() => manager.stopAll());
  const chip = { id: 1, name: 'Canal', number: null, user_id: 1, is_primary: 1 };
  manager.ensureWorker(chip);
  assert.equal(environments[0].ADMIN_NUMBER, '');
  assert.equal(environments[0].EXPECTED_ACCOUNT_NUMBER, '');
  let approve;
  manager.verifyIdentity = () => new Promise((resolve) => { approve = resolve; });
  children[0].emit('message', { type: 'identity', id: 'bind', number: '5511999992222' });
  assert.equal(children[0].sent.length, 0);
  approve(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(children[0].sent[0], { type: 'identity-result', id: 'bind', number: '5511999992222' });
  assert.equal(chip.identity_verified, 1);
  const events = [];
  manager.on('event', (event) => events.push(event));
  children[0].emit('message', { type: 'event', event: 'status', payload: { connected: true, number: chip.number } });
  assert.equal(events[0].chipNumber, '5511999992222');
  await manager.stopChip(1);
  manager.ensureWorker(chip);
  assert.equal(environments[1].EXPECTED_ACCOUNT_NUMBER, '5511999992222');
  children[0].emit('message', { type: 'event', event: 'message', payload: 'stale' });
  assert.equal(events.length, 1, 'stopped workers cannot publish account data');
  manager.verifyIdentity = async () => { throw new Error('Conta já vinculada.'); };
  children[1].emit('message', { type: 'identity', id: 'reject', number: '5511999993333' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(children[1].sent[0].error, /já vinculada/);
  assert.equal(chip.number, '5511999992222');
  const other = { id: 2, name: 'Outro canal', number: null, user_id: 1, is_primary: 0 };
  const otherWorker = manager.ensureWorker(other);
  assert.notEqual(environments[2].STORAGE_DIR, environments[1].STORAGE_DIR, 'each chip has its own credentials, database and media directory');
  const healthy = manager.workers.get(1);
  await manager.stopChip(2);
  assert.equal(otherWorker.child.killed, true);
  assert.equal(manager.workers.get(1), healthy);
  assert.equal(healthy.child.connected, true);
});
