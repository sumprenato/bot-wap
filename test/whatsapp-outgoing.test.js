const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOutgoingSender } = require("../whatsapp-outgoing");
const { createMessageRetryStore } = require("../whatsapp-message-retry");

test("outgoing retry payload survives a restart before the history insert, with original protocol bytes", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "convelya-send-retry-"));
  process.env.STORAGE_DIR = folder;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  const db = require("../db"),
    store = require("../store");
  await db.ready;
  t.after(async () => {
    await db.close();
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const jid = "123456789012345@lid",
    phone = "5511988880011";
  await store.registerConversationAliases("123456789012345", phone);
  const retry = createMessageRetryStore({ db, store });
  const original = {
    imageMessage: {
      caption: "Catálogo automático",
      directPath: "/original",
      mediaKey: Buffer.from([1, 2, 3]),
    },
    messageContextInfo: { messageSecret: Buffer.from([4, 5, 6]) },
  };
  let sender;
  sender = createOutgoingSender({
    retryStore: retry,
    generateId: () => "automatic-original",
    isCurrent: () => true,
    send: async (target, content, options) => {
      const key = { remoteJid: target, id: options.messageId, fromMe: true };
      await sender.patchMessageBeforeSending({
        deviceSentMessage: { destinationJid: target, message: original },
      });
      await sender.patchMessageBeforeSending(original);
      // Simulate losing memory before sendMessage returns and before a chat row exists.
      retry.clear();
      const restarted = createMessageRetryStore({ db, store });
      assert.deepEqual(await restarted.getMessage(key), original);
      assert.deepEqual(
        await restarted.getMessage({
          ...key,
          remoteJid: `${phone}:3@s.whatsapp.net`,
        }),
        original,
      );
      assert.equal(
        await restarted.getMessage({
          ...key,
          remoteJid: "5511988880022@s.whatsapp.net",
        }),
        undefined,
        "another chat must not retrieve the same message ID",
      );
      assert.equal((await db.get("SELECT COUNT(*) AS n FROM messages")).n, 0);
      return { key, message: original };
    },
  });
  await sender.sendMessage(
    jid,
    { image: Buffer.from("fixture") },
    { quoted: { key: { id: "quote" } } },
  );
  const restored = await createMessageRetryStore({ db, store }).getMessage({
    remoteJid: jid,
    id: "automatic-original",
  });
  const { proto } = require("@whiskeysockets/baileys");
  const decoded = proto.Message.decode(proto.Message.encode(restored).finish());
  assert.deepEqual(
    Buffer.from(decoded.imageMessage.mediaKey),
    original.imageMessage.mediaKey,
  );
  assert.deepEqual(
    Buffer.from(decoded.messageContextInfo.messageSecret),
    original.messageContextInfo.messageSecret,
  );
  retry.remember({
    key: { remoteJid: jid, id: "automatic-original" },
    message: {},
  });
  assert.deepEqual(
    await retry.getMessage({ remoteJid: jid, id: "automatic-original" }),
    original,
    "an empty echo cannot replace the retry payload",
  );
  await retry.forget({
    remoteJid: `${phone}@s.whatsapp.net`,
    id: "automatic-original",
  });
  assert.equal(
    await retry.getMessage({ remoteJid: jid, id: "automatic-original" }),
    undefined,
    "revoked messages must not be re-delivered from the retry store",
  );
});

test("one socket serializes concurrent sends, preserves options and never blindly retries a failed delivery", async () => {
  let inFlight = 0,
    maximum = 0,
    id = 0;
  const calls = [],
    persisted = [];
  const retryStore = {
    remember() {},
    persist: async (msg) => persisted.push(msg),
  };
  const sender = createOutgoingSender({
    retryStore,
    generateId: () => String(++id),
    isCurrent: () => true,
    send: async (jid, content, options) => {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      calls.push({ jid, content, options });
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      if (content.text === "fail") throw new Error("transport failure");
      return {
        key: { remoteJid: jid, id: options.messageId },
        message: { conversation: content.text },
      };
    },
  });
  const results = await Promise.allSettled([
    sender.sendMessage(
      "111@s.whatsapp.net",
      { text: "first" },
      { quoted: { key: { id: "quoted" } } },
    ),
    sender.sendMessage("222@s.whatsapp.net", { text: "fail" }),
    sender.sendMessage(
      "333@s.whatsapp.net",
      { text: "last" },
      { messageId: "preserved-id" },
    ),
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.quoted.key.id, "quoted");
  assert.equal(calls[2].options.messageId, "preserved-id");
  assert.equal(persisted.length, 2);
});

test("queued messages are refused before transport when their socket was replaced", async () => {
  let current = true,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const sender = createOutgoingSender({
    retryStore: { remember() {}, persist: async () => {} },
    generateId: () => "id",
    isCurrent: () => current,
    send: async () => {
      calls++;
      await gate;
      return {};
    },
  });
  const first = sender.sendMessage("111@s.whatsapp.net", { text: "first" });
  const queued = sender.sendMessage("222@s.whatsapp.net", { text: "queued" });
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  release();
  await first;
  await assert.rejects(
    queued,
    (error) =>
      error.code === "WHATSAPP_NOT_READY" && error.deliveryAttempted === false,
  );
  assert.equal(calls, 1);
});

test("a queued automatic send rechecks control after waiting and leaves manual sends available", async () => {
  let release,
    allowed = true;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    calls = [];
  const sender = createOutgoingSender({
    isCurrent: () => true,
    generateId: () => "id",
    retryStore: { remember() {}, persist: async () => {} },
    send: async (jid, message) => {
      calls.push(message.text);
      if (message.text === "manual first") await gate;
      return {};
    },
  });
  const first = sender.sendMessage("1@s.whatsapp.net", {
    text: "manual first",
  });
  const queued = sender.sendMessage(
    "2@s.whatsapp.net",
    { text: "automatic" },
    {},
    async () => {
      if (!allowed)
        throw Object.assign(new Error("Atendimento assumido"), {
          code: "FLOW_STOPPED",
          deliveryAttempted: false,
        });
    },
  );
  const last = sender.sendMessage("3@s.whatsapp.net", { text: "manual last" });
  await new Promise((resolve) => setImmediate(resolve));
  allowed = false;
  release();
  await first;
  await assert.rejects(queued, { code: "FLOW_STOPPED" });
  await last;
  assert.deepEqual(calls, ["manual first", "manual last"]);
});
