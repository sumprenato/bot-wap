const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");

test(
  "a published flow replies through the real WhatsApp worker and server inbox",
  { timeout: 60000 },
  async (t) => {
    const folder = fs.mkdtempSync(
      path.join(os.tmpdir(), "convelya-flow-whatsapp-"),
    );
    process.env.STORAGE_DIR = folder;
    process.env.ADMIN_USERNAME = "whatsapp-flow-owner";
    process.env.ADMIN_PASSWORD = "fixture-password";
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_PRIVATE_URL;
    // Only replace the external WhatsApp transport. Keep the worker, IPC, durable
    // outbox/inbox, publisher permissions and live send adapter in production code.
    const fixture = path.join(folder, "transport.cjs");
    fs.writeFileSync(
      fixture,
      `
const Module = require('node:module');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === './whatsapp-directory') return { WhatsAppDirectory: class {
    constructor({emit}) {
      this.syncState = {verified:false,syncing:true,stage:'loading',error:''};
      process.on('message', message => {
        if(!['fixture-contacts-ready','fixture-contacts-pending'].includes(message.type)) return;
        const ready = message.type === 'fixture-contacts-ready';
        this.syncState = {verified:ready,syncing:!ready,stage:ready?'ready':'loading',error:''};
        emit('contacts:sync',this.syncState);
      });
    }
    async sync() {}
  } };
  if (name === '@whiskeysockets/baileys') return {
    generateMessageIDV2: () => require('node:crypto').randomUUID(),
    useMultiFileAuthState: async () => ({state:{creds:{},keys:{get:async()=>({}),set:async()=>{}}},saveCreds:async()=>{}}),
    default: config => {
      const handlers = {};
      const emit = async (event, payload) => { for (const fn of handlers[event] || []) await fn(payload); };
      process.on('message', message => {
        if (message.type === 'fixture-whatsapp') emit('messages.upsert', {type:'notify',messages:[message.message]}).catch(error=>{throw error});
      });
      setImmediate(() => emit('connection.update', {connection:'open'}));
      return {user:{id:'5511999991111:4@s.whatsapp.net'},
        ev:{on:(event,fn)=>{(handlers[event] ||= []).push(fn)}},
        sendMessage:async(jid,content,options)=>{
          const message = content.text ? {conversation:content.text} : {imageMessage:{caption:content.caption,mediaKey:Buffer.from([1,2,3])}};
          await config.patchMessageBeforeSending(message);
          const recovered = await config.getMessage({remoteJid:jid,id:options.messageId});
          require('node:assert/strict').deepEqual(recovered,message,'retry content must exist before the transport returns');
          process.send({type:'fixture-sent',jid,content});
          return {key:{id:options.messageId,remoteJid:jid,fromMe:true},message,status:2};
        },end(){},ws:{close(){}}};
    }
  };
  return load.call(this,name,...args);
};
`,
    );
    const previousOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS =
      `${previousOptions || ""} --require "${fixture.replace(/\\/g, "/")}"`.trim();
    const { bot, db, io, flowService } = require("../server");
    await db.ready;
    t.after(async () => {
      await flowService.stop();
      await bot.stopAll();
      await new Promise((resolve) => io.close(resolve));
      await db.close();
      if (previousOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousOptions;
      assert.equal(path.dirname(folder), os.tmpdir());
      fs.rmSync(folder, { recursive: true, force: true });
    });
    const schema = require("../flows/schema"),
      flows = require("../flows/store");
    const draft = await flows.create({ name: "Novo fluxo padrão" });
    assert.ok(
      draft.definition.triggers.some((t) => t.type === "message" && t.enabled),
    );
    await flows.remove(draft.id);
    const definition = schema.empty();
    definition.nodes.push(
      {
        id: "question",
        position: { x: 400, y: 0 },
        data: {
          kind: "question",
          config: {
            ...schema.defaults("question"),
            text: "Qual seu nome?",
            variable: "nome",
          },
        },
      },
      {
        id: "answer",
        position: { x: 700, y: 0 },
        data: {
          kind: "text",
          config: { ...schema.defaults("text"), text: "Olá, {{fluxo.nome}}!" },
        },
      },
      {
        id: "end",
        position: { x: 1000, y: 0 },
        data: { kind: "stop", config: schema.defaults("stop") },
      },
    );
    definition.edges = [
      ["start", "next", "question"],
      ["question", "next", "answer"],
      ["question", "timeout", "end"],
      ["answer", "next", "end"],
    ].map(([source, sourceHandle, target], i) => ({
      id: String(i),
      source,
      sourceHandle,
      target,
    }));
    const flow = await flows.create({
      name: "Atendimento automático",
      definition,
    });
    await flows.publish(flow.id, flow.revision);
    const chipId = (
      await db.run(
        "INSERT INTO chips(name,number,user_id,identity_verified,created_at) VALUES (?,?,1,1,?)",
        ["Fixture", "5511999991111", new Date().toISOString()],
      )
    ).lastID;
    const chip = await db.get("SELECT * FROM chips WHERE id=?", [chipId]);
    const sent = [],
      entry = bot.ensureWorker(chip);
    entry.child.on("message", (message) => {
      if (message.type === "fixture-sent") sent.push(message);
    });
    const until = async (check, description) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await pause(30);
      }
      t.diagnostic(
        JSON.stringify({
          inbox: await db.all("SELECT status,error FROM flow_inbox"),
          runs: (await db.all("SELECT status,state FROM flow_runs")).map(
            (r) => ({ status: r.status, error: JSON.parse(r.state).error }),
          ),
          worker: await bot
            .request(chip, "state", {}, 1000)
            .catch((e) => ({ error: e.message })),
        }),
      );
      assert.fail(description);
    };
    await until(
      () => entry.status?.connected,
      "the fixture worker should connect",
    );
    const incoming = (id, text, number = "5511988880001") =>
      entry.child.send({
        type: "fixture-whatsapp",
        message: {
          key: { id, remoteJid: `${number}@s.whatsapp.net`, fromMe: false },
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: text },
        },
      });
    incoming("first", "oi");
    await until(
      async () =>
        !!(await db.get("SELECT id FROM flow_runs WHERE mode='live'")),
      "the WhatsApp event should create a live run",
    );
    await until(
      async () =>
        (await db.get("SELECT status FROM flow_runs WHERE mode='live'"))
          ?.status !== "running",
      "the first attempt should finish",
    );
    assert.equal(
      (await db.get("SELECT status FROM flow_runs WHERE mode='live'")).status,
      "ready",
      "contact synchronization must defer delivery, without suspending an unsent flow",
    );
    assert.equal(
      sent.length,
      0,
      "no message is sent before contact verification",
    );
    entry.child.send({ type: "fixture-contacts-ready" });
    await until(
      () => sent.length === 1,
      "an ordinary incoming greeting should start the active flow",
    );
    assert.equal(
      sent[0].content.text,
      "Qual seu nome?",
      "automatic messages must not include an attendant signature",
    );
    await until(
      async () =>
        (await db.get("SELECT status FROM flow_runs WHERE mode='live'"))
          .status === "waiting",
      "the question should persist its wait state",
    );
    const run = await db.get("SELECT * FROM flow_runs WHERE mode='live'");
    assert.equal(run.status, "waiting");
    incoming("reply", "Renato");
    await until(
      () => sent.length === 2,
      "the next WhatsApp message should resume the question",
    );
    assert.equal(sent[1].content.text, "Olá, Renato!");
    await until(
      async () =>
        (await db.get("SELECT status FROM flow_runs WHERE id=?", [run.id]))
          .status === "stopped",
      "the flow should finish",
    );
    incoming("reply", "Renato");
    await pause(1200);
    assert.equal(
      sent.length,
      2,
      "duplicate WhatsApp delivery must not restart the flow",
    );
    incoming("after-stop", "Quero falar mais");
    await until(
      async () =>
        (
          await db.get(
            "SELECT status FROM flow_inbox WHERE id LIKE '%:after-stop'",
          )
        )?.status === "done",
      "messages after Interromper should be consumed without restarting",
    );
    assert.equal(sent.length, 2);
    assert.equal(
      (await bot.request(chip, "flow-context", { number: "5511988880001" }))
        .conversation.flowStopped,
      true,
    );
    // The channel can become unready after preflight, before IPC dispatches send.
    // Only an explicit pre-transport refusal is safe to retry.
    const request = bot.request.bind(bot),
      raceContact = "5511988880003";
    let interrupt = true;
    bot.request = (channel, action, payload, ...args) => {
      if (
        action === "flow-send" &&
        payload.number === raceContact &&
        interrupt
      ) {
        interrupt = false;
        entry.child.send({ type: "fixture-contacts-pending" });
      }
      return request(channel, action, payload, ...args);
    };
    incoming("race", "oi", raceContact);
    await until(
      () => !interrupt,
      "the race fixture should interrupt before send",
    );
    await until(
      async () =>
        (
          await db.get("SELECT status FROM flow_runs WHERE contact=?", [
            raceContact,
          ])
        )?.status === "ready",
      "pre-transport refusal must keep the run retryable",
    );
    assert.equal(
      (
        await db.get(
          "SELECT COUNT(*) AS n FROM flow_effects e JOIN flow_runs r ON r.id=e.run_id WHERE r.contact=? AND e.status IN ('pending','uncertain')",
          [raceContact],
        )
      ).n,
      0,
    );
    assert.equal(sent.length, 2);
    entry.child.send({ type: "fixture-contacts-ready" });
    await until(
      () => sent.length === 3,
      "the refused send should retry exactly once after verification",
    );
    incoming("race-answer", "Ana", raceContact);
    await until(
      () => sent.length === 4,
      "the recovered execution should still accept answers",
    );
    assert.equal(sent[3].content.text, "Olá, Ana!");
    const pausedContact = "5511988880004";
    incoming("waiting-pause-start", "oi", pausedContact);
    await until(
      () => sent.length === 5,
      "a new contact should reach the question before pause",
    );
    const current = await flows.get(flow.id);
    await flows.update(flow.id, { revision: current.revision, active: false });
    incoming("waiting-pause-answer", "Maria", pausedContact);
    await until(
      async () =>
        (
          await db.get(
            "SELECT status FROM flow_inbox WHERE id LIKE '%:waiting-pause-answer'",
          )
        )?.status === "done",
      "paused waiting answers must be consumed",
    );
    assert.equal(
      (
        await db.get("SELECT status FROM flow_runs WHERE contact=?", [
          pausedContact,
        ])
      ).status,
      "stopped",
    );
    incoming("paused", "oi", "5511988880002");
    await until(
      async () =>
        (await db.get("SELECT status FROM flow_inbox WHERE id LIKE '%:paused'"))
          ?.status === "done",
      "paused events should be consumed",
    );
    assert.equal(sent.length, 5, "paused flows must not send anything");
    let enabled = await flows.get(flow.id);
    await flows.update(flow.id, { revision: enabled.revision, active: true });
    const assignedContact = "5511988880005";
    await bot.request(chip, "assign-conversation", {
      number: assignedContact,
      userId: 1,
    });
    incoming("assigned-start", "oi", assignedContact);
    await until(
      async () =>
        (
          await db.get(
            "SELECT status FROM flow_inbox WHERE id LIKE '%:assigned-start'",
          )
        )?.status === "done",
      "assigned conversation should ignore an automatic trigger",
    );
    assert.equal(
      await db.get("SELECT id FROM flow_runs WHERE contact=?", [
        assignedContact,
      ]),
      undefined,
    );
    const humanContact = "5511988880006";
    incoming("human-start", "oi", humanContact);
    await until(
      () => sent.length === 6,
      "the unassigned conversation should begin",
    );
    await bot.request(chip, "assign-conversation", {
      number: humanContact,
      userId: 1,
    });
    incoming("human-answer", "João", humanContact);
    await until(
      async () =>
        (
          await db.get(
            "SELECT status FROM flow_inbox WHERE id LIKE '%:human-answer'",
          )
        )?.status === "done",
      "human handoff must cancel the waiting flow",
    );
    assert.equal(sent.length, 6, "no automatic answer may follow assignment");
    assert.equal(
      (
        await db.get("SELECT status FROM flow_runs WHERE contact=?", [
          humanContact,
        ])
      ).status,
      "stopped",
    );
    enabled = await flows.get(flow.id);
    await flows.update(flow.id, {
      revision: enabled.revision,
      triggers_enabled: false,
    });
    const media = {
      type: "image",
      caption: "Catálogo automático",
      mimeType: "image/png",
      fileName: "catalogo.png",
      buffer: Buffer.from("fixture-image").toString("base64"),
    };
    await bot.request(chip, "reopen-conversation", { number: raceContact });
    const assetId = require("node:crypto").randomUUID();
    const assetFolder = path.join(folder, "flow-assets", "1");
    fs.mkdirSync(assetFolder, { recursive: true });
    fs.writeFileSync(
      path.join(assetFolder, assetId),
      Buffer.from("fixture-image"),
    );
    await db.run(
      "INSERT INTO flow_assets(id,account_id,kind,file_name,mime_type,size,created_by,created_at) VALUES (?,1,'image','catalogo.png','image/png',13,1,?)",
      [assetId, new Date().toISOString()],
    );
    const mediaDefinition = schema.empty();
    mediaDefinition.nodes.push(
      {
        id: "image",
        position: { x: 400, y: 0 },
        data: {
          kind: "image",
          config: {
            ...schema.defaults("image"),
            assetId,
            caption: media.caption,
          },
        },
      },
      {
        id: "end",
        position: { x: 700, y: 0 },
        data: { kind: "stop", config: {} },
      },
    );
    mediaDefinition.edges = [
      { id: "image", source: "start", target: "image", sourceHandle: "next" },
      { id: "end", source: "image", target: "end", sourceHandle: "next" },
    ];
    const mediaFlow = await flows.create({
      name: "Mídia autorizada",
      definition: mediaDefinition,
    });
    await flows.publish(mediaFlow.id, mediaFlow.revision);
    const mediaRun = await flowService.createRun({
      accountId: 1,
      flowId: mediaFlow.id,
      version: mediaFlow.revision,
      definition: mediaDefinition,
      chipId,
      contact: raceContact,
      actorId: 1,
      context: {},
    });
    assert.equal(
      (await db.get("SELECT status FROM flow_runs WHERE id=?", [mediaRun]))
        .status,
      "stopped",
    );
    const automaticMedia = {
      conversation: await bot.request(chip, "get-conversation", {
        number: raceContact,
      }),
    };
    assert.equal(
      sent.at(-1).content.caption,
      "Catálogo automático",
      "automatic media captions must not include a signature",
    );
    assert.equal(
      automaticMedia.conversation.messages.at(-1).caption,
      "Catálogo automático",
    );
    await bot.request(chip, "reply", {
      number: raceContact,
      text: "Resposta manual",
      displayName: "Renato",
    });
    assert.equal(sent.at(-1).content.text, "*Renato*: Resposta manual");
    await bot.request(chip, "reply-media", {
      number: raceContact,
      media: { ...media, caption: "Catálogo manual" },
      displayName: "Renato",
    });
    assert.equal(sent.at(-1).content.caption, "*Renato*: Catálogo manual");
  },
);
