const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { recentMessages, messageTime, HISTORY_WINDOW_MS } = require('../whatsapp-history');

function message(id, at, { number = '5511988880001', fromMe = false, text = id, content } = {}) {
  return { key: { id, remoteJid: `${number}@s.whatsapp.net`, fromMe }, messageTimestamp: at / 1000, message: content || { conversation: text } };
}

test('history selects the exact seven-day window, sorts chronologically and ignores non-chat records', () => {
  const anchor = 1800000000000;
  const first = message('boundary', anchor - HISTORY_WINDOW_MS);
  const latest = message('latest', anchor);
  latest.messageTimestamp = { toString: () => String(anchor / 1000) };
  const records = [latest, message('old', anchor - HISTORY_WINDOW_MS - 1000), first,
    message('future', anchor + 1000), message('invalid', NaN),
    { ...message('group', anchor), key: { id: 'group', remoteJid: '123@g.us' } },
    { ...message('broadcast', anchor), key: { id: 'broadcast', remoteJid: 'status@broadcast' } },
    { ...message('no-id', anchor), key: { remoteJid: '5511988880001@s.whatsapp.net' } },
    { ...message('empty', anchor), message: null }];
  assert.deepEqual(recentMessages(records, anchor).map(m => m.key.id), ['boundary', 'latest']);
  assert.equal(messageTime(latest), anchor);
});

test('later reconnects retain the initial boundary and accept subsequent messages without a rolling expiration', () => {
  const anchor=1800000000000, later=anchor+30*86400000;
  const records=[message('before-initial-window',anchor-HISTORY_WINDOW_MS-1000), message('initial',anchor-86400000), message('after-linking',anchor+86400000), message('latest',later)];
  assert.deepEqual(recentMessages(records,anchor,later).map(m=>m.key.id),['initial','after-linking','latest']);
});

test('QR-verified history is persistent, deduplicated, preserves dates and newer previews, and never replays actions', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-wap-history-'));
  process.env.STORAGE_DIR = folder;
  process.env.CHIP_ID = 'history-test';
  process.env.ADMIN_NUMBER = '';
  delete process.env.EXPECTED_ACCOUNT_NUMBER;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  const db = require('../db'), store = require('../store');
  await db.ready;
  const sockets = [], sends = [];
  const load = Module._load;
  Module._load = function(name, ...args) {
    if(name === '@whiskeysockets/baileys') return {
      generateMessageIDV2: () => require('node:crypto').randomUUID(),
      useMultiFileAuthState: async () => ({ state: { creds: {}, keys: { get: async()=>({}), set: async()=>{} } }, saveCreds: async()=>{} }),
      downloadMediaMessage: async()=>{ throw new Error('Historical attachment expired'); },
      default: config => {
        const handlers = {};
        const socket = { config, user: { id: '5511999991111:4@s.whatsapp.net' }, handlers,
          ev: { on: (event, callback) => { (handlers[event] ||= []).push(callback); } },
          emit: async (event, payload) => Promise.all((handlers[event] || []).map(fn=>fn(payload))),
          sendMessage: async(...args)=>{ sends.push(args); return {}; },
          end() {}, ws: {close() {}}, logout: async()=>assert.fail('History must not revoke a session') };
        sockets.push(socket); return socket;
      },
    };
    if(name === './whatsapp-directory') return { WhatsAppDirectory: class { async sync() {} } };
    return load.call(this, name, ...args);
  };
  let bot;
  try { bot = require('../bot'); } finally { Module._load = load; }
  let closed = false;
  t.after(async()=>{
    await bot.stopBot();
    if(!closed) await db.close();
    assert.equal(path.dirname(folder), os.tmpdir());
    assert.ok(path.basename(folder).startsWith('bot-wap-history-'));
    fs.rmSync(folder,{recursive:true,force:true});
  });
  const statuses=[];
  const emitter = new (require('node:events').EventEmitter)();
  emitter.on('status',value=>statuses.push(structuredClone(value)));
  await bot.startBot(emitter);
  const socket=sockets[0], now=Math.floor(Date.now()/1000)*1000;
  const beforeVerification = socket.emit('messaging-history.set',{ messages:[message('before-identity',now-86400000)] });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n,0);
  await socket.emit('connection.update',{connection:'open'});
  await beforeVerification;
  assert.ok(Number.isFinite(Date.parse(JSON.parse(fs.readFileSync(path.join(folder,'session-state.json'),'utf8')).historyStartedAt)));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n,1);

  await socket.emit('messages.upsert',{ type:'notify', messages:[message('live',now,{text:'Mensagem nova'})] });
  const flowOutbox = await db.all('SELECT * FROM flow_outbox');
  assert.equal(flowOutbox.length,1,'only a new live incoming message creates an automation event');
  assert.equal(JSON.parse(flowOutbox[0].payload).id,'live');
  assert.equal(JSON.parse(flowOutbox[0].payload).newContact,false,'historically known contacts must not be reported as new');
  await socket.emit('messages.upsert',{ type:'notify', messages:[message('live',now,{text:'Mensagem nova'})] });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM flow_outbox')).n,1,'duplicate messages cannot duplicate durable events');
  const history=[
    message('old',now-HISTORY_WINDOW_MS-86400000),
    { ...message('historical-send',now-3600000,{fromMe:true,text:'!assumir 5511888880000'}), status: 2 },
    message('historical-in',now-2*86400000),
    message('media',now-1800000,{content:{imageMessage:{caption:'Foto antiga',mimetype:'image/jpeg'}}}),
    message('protocol',now-1800000,{number:'5511988880002',content:{protocolMessage:{type:0}}}),
  ];
  await socket.emit('messaging-history.set',{messages:history,progress:50});
  await socket.emit('messaging-history.set',{messages:history,progress:100});
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n,5);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM messages WHERE whatsapp_msg_id IN ('old','protocol')")).n,0);
  const imported=await db.get("SELECT * FROM messages WHERE whatsapp_msg_id='historical-send'");
  assert.equal(imported.at,new Date(now-3600000).toISOString());
  assert.equal(imported.from_role,'admin');
  assert.equal((await store.getConversation('5511988880001')).messages.find(item => item.whatsappId === 'historical-send').deliveryStatus, 2);
  const readHistory = { ...history[1], status: 4 };
  await socket.emit('messaging-history.set', { messages: [readHistory] });
  await socket.emit('messaging-history.set', { messages: [history[1]] });
  assert.equal((await store.getConversation('5511988880001')).messages.find(item => item.whatsappId === 'historical-send').deliveryStatus, 4, 'duplicate history updates read receipts without regressing or duplicating messages');
  const preview=await store.getConversation('5511988880001');
  assert.equal(preview.lastMessage,'Mensagem nova');
  assert.equal(preview.messages[0].whatsappId,'historical-in');
  const media=await db.get("SELECT * FROM messages WHERE whatsapp_msg_id='media'");
  assert.equal(media.type,'image');
  assert.equal(media.text,'Foto antiga');
  assert.ok(media.whatsapp_payload);
  assert.equal(sends.length,0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM flow_outbox')).n,1,'history imports never trigger automations');
  assert.equal(bot.getActiveTarget(),null);

  await socket.emit('messages.upsert',{type:'append',messages:[message('offline-in',now-120000),message('offline-send',now-60000,{fromMe:true})]});
  assert.equal((await db.get("SELECT at FROM messages WHERE whatsapp_msg_id='offline-in'")).at,new Date(now-120000).toISOString());

  const bulk=Array.from({length:230},(_,i)=>message('bulk-'+i,now-7200000-i*1000));
  await socket.emit('messaging-history.set',{messages:bulk});
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n,237,'history must not be truncated at 200 messages');
  assert.equal(bot.getStatus().historySync.imported,236);
  assert.ok(statuses.some(s=>s.historySync?.importing));
  assert.equal(bot.getStatus().historySync.importing,false);
  await Promise.all(Array.from({length:5},()=>store.addMessage('5511988880001','client','Concurrent echo','',{},'same-concurrent-id',undefined,{deferConversation:true})));
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM messages WHERE whatsapp_msg_id='same-concurrent-id'")).n,1);
  await bot.stopBot();
  await socket.emit('messaging-history.set',{messages:[message('stale-socket',now-1000)]});
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM messages WHERE whatsapp_msg_id='stale-socket'")).n,0);
  await db.close(); closed=true;
  const script=`const sqlite=require('sqlite3');const db=new sqlite.Database(process.argv[1],sqlite.OPEN_READONLY);db.get('SELECT COUNT(*) AS n FROM messages',(e,row)=>{if(e)process.exitCode=1;else console.log(row.n);db.close()});`;
  const count=execFileSync(process.execPath,['-e',script,path.join(folder,'database.sqlite')],{encoding:'utf8',timeout:10000});
  assert.equal(Number(count.trim()),238,'all records survive closing the worker database and opening it in a new process');
});
