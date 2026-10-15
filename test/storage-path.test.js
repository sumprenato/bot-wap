const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { storageConfiguration, resolveStorageDir, reportStorage } = require('../storage-path');

test('uses the Railway volume automatically when STORAGE_DIR is absent', () => {
  assert.equal(resolveStorageDir({ RAILWAY_VOLUME_MOUNT_PATH: '/persistent' }), path.resolve('/persistent'));
  assert.equal(storageConfiguration({ RAILWAY_VOLUME_MOUNT_PATH: '/persistent' }).problem, null);
});

test('detects the production mismatch between /var/data and the mounted volume', () => {
  const config = storageConfiguration({ STORAGE_DIR: '/var/data', RAILWAY_VOLUME_MOUNT_PATH: '/var/lib/postgresql/data' });
  assert.equal(config.problem, 'outside_volume');
  assert.equal(config.directory, path.resolve('/var/data'), 'never silently abandon existing sessions');
  const messages = [];
  reportStorage(config, message => messages.push(message));
  assert.match(messages.join(''), /fora do volume/);
});

test('preserves per-chip isolation within the volume', () => {
  const volume = path.resolve('/persistent');
  const first = storageConfiguration({ STORAGE_DIR: path.join(volume, 'chips', '1'), RAILWAY_VOLUME_MOUNT_PATH: volume });
  const second = storageConfiguration({ STORAGE_DIR: path.join(volume, 'chips', '2'), RAILWAY_VOLUME_MOUNT_PATH: volume });
  assert.equal(first.insideVolume, true);
  assert.equal(second.insideVolume, true);
  assert.notEqual(first.directory, second.directory);
});

test('rejects sibling paths and directory traversal as persistent paths', () => {
  for (const directory of ['/persistent-other', '/persistent/../outside']) {
    assert.equal(storageConfiguration({ STORAGE_DIR: directory, RAILWAY_VOLUME_MOUNT_PATH: '/persistent' }).problem, 'outside_volume');
  }
});

test('identifies a Railway service with no volume, even when PostgreSQL is configured', () => {
  assert.equal(storageConfiguration({ RAILWAY_ENVIRONMENT_ID: 'production', DATABASE_URL: 'postgres://unused' }).problem, 'missing_volume');
});

test('keeps the existing local default and explicit local storage', () => {
  const fallback = path.resolve('/local-project');
  assert.equal(resolveStorageDir({}, fallback), fallback);
  const config = storageConfiguration({ STORAGE_DIR: '/local-data' }, fallback);
  assert.equal(config.directory, path.resolve('/local-data'));
  assert.equal(config.problem, null);
});

test('real Baileys credentials and keys survive fresh process starts on the selected volume', t => {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-storage-'));
  t.after(() => {
    assert.equal(path.dirname(volume), os.tmpdir());
    assert.ok(path.basename(volume).startsWith('bot-wap-storage-'));
    fs.rmSync(volume, { recursive: true, force: true });
  });
  const script = `
    const path = require('node:path');
    const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
    const { resolveStorageDir } = require('./storage-path');
    (async () => {
      const { state, saveCreds } = await useMultiFileAuthState(path.join(resolveStorageDir(), 'chips', '17', 'auth_info'));
      if (process.argv[1] === 'write') {
        state.creds.registered = true;
        await saveCreds();
        await state.keys.set({ 'session': { 'test-device': Buffer.from('persisted-key') } });
      }
      const keys = await state.keys.get('session', ['test-device']);
      console.log(JSON.stringify({ registered: state.creds.registered, key: keys['test-device']?.toString() }));
    })().catch(() => process.exit(1));
  `;
  const env = { ...process.env, STORAGE_DIR: '', RAILWAY_VOLUME_MOUNT_PATH: volume };
  for (const mode of ['write', 'read', 'read']) {
    const result = execFileSync(process.execPath, ['-e', script, mode], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 15000 });
    assert.deepEqual(JSON.parse(result), { registered: true, key: 'persisted-key' });
  }
});
