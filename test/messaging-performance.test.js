const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeConversation, mergeConversationMap, mergeState } = require('../conversation-update');

test('late snapshots and partial receipts preserve read status and respect removals and channel isolation', () => {
  const message = { id: 1, from: 'admin', text: 'sent', deliveryStatus: 4 };
  const conversation = { number: '123', messages: [message] };
  const stale = { number: '123', messages: [{ ...message, deliveryStatus: 2 }] };
  assert.equal(mergeConversation(conversation, stale).messages[0].deliveryStatus, 4);
  assert.equal(mergeConversation(conversation, { ...stale, partialMessages: true }).messages[0].deliveryStatus, 4);
  const missing = { ...message }; delete missing.deliveryStatus;
  assert.equal(mergeConversation(conversation, { ...stale, messages: [missing] }).messages[0].deliveryStatus, 4);
  const state = { chipId: 1, conversations: { '123': conversation } };
  const snapshot = { chipId: 1, conversations: { '123': stale } };
  assert.equal(mergeState(state, snapshot).conversations['123'].messages[0].deliveryStatus, 4);
  assert.equal(mergeState(state, { ...snapshot, chipId: 2 }).conversations['123'].messages[0].deliveryStatus, 2);
  assert.deepEqual(mergeState(state, { chipId: 1, conversations: {} }).conversations, {});
  assert.deepEqual(mergeConversation(conversation, { number: '123', messages: [] }).messages, []);
  assert.equal(mergeConversation({ ...conversation, messages: [{ ...message, deliveryStatus: 0 }] }, { ...conversation, messages: [{ ...message, deliveryStatus: 1 }] }).messages[0].deliveryStatus, 0, 'a stale pending snapshot cannot hide a send failure');
});

test('a receipt updates just its message without truncating history or duplicating records', () => {
  const previous = { number: '123', messages: Array.from({length:5000},(_,id)=>({id,at:new Date(id*1000).toISOString(),text:'message '+id})) };
  const partial = { number:'123', partialMessages:true, messages:[{...previous.messages[34],deliveryStatus:4}] };
  const next=mergeConversation(previous,partial);
  assert.equal(next.messages.length,5000);
  assert.equal(next.messages[34].deliveryStatus,4);
  assert.equal(next.messages[4999],previous.messages[4999]);
  assert.equal(mergeConversation(next,partial).messages.length,5000);
  assert.equal(mergeConversation(next,{number:'123',mutation:'delete',messages:[]}).messages.length,0);
  const aliases=mergeConversationMap({ lid: {number:'lid',messages:[{id:1,at:'2026-01-01',text:'Existing'}]} },{number:'phone',aliases:['lid'],partialMessages:true,messages:[{id:2,at:'2026-01-02',text:'New'}]});
  assert.equal(aliases.lid,undefined);
  assert.equal(aliases.phone.messages.length,2,'phone/LID merges preserve loaded history without a complete reload');
});

test('history queries omit encrypted payloads, batch conversations, and delivery receipts stay small', async t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bot-wap-performance-'));
  process.env.STORAGE_DIR=folder;
  delete process.env.DATABASE_URL; delete process.env.DATABASE_PRIVATE_URL;
  const db=require('../db'), store=require('../store');
  await db.ready;
  t.after(async()=>{
    await db.close();
    assert.equal(path.dirname(folder),os.tmpdir());
    assert.ok(path.basename(folder).startsWith('bot-wap-performance-'));
    fs.rmSync(folder,{recursive:true,force:true});
  });
  const now=new Date().toISOString(), raw='x'.repeat(16384);
  await db.transaction(async()=>{
    for(let c=0;c<30;c++) {
      const number='55119999'+String(c).padStart(5,'0');
      await db.run('INSERT INTO conversations(number,name,blocked,tags) VALUES (?,?,0,?)',[number,'','[]']);
      for(let i=0;i<40;i++) await db.run('INSERT INTO messages(number,from_role,text,at,whatsapp_msg_id,whatsapp_payload,message_context) VALUES (?,?,?,?,?,?,?)',[number,'admin','Test '+i,now,`${c}-${i}`,raw,'{}']);
    }
  });
  const original=db.all, queries=[];
  db.all=async(sql,args)=>{
    queries.push(sql);
    assert.doesNotMatch(sql,/SELECT messages\.\*/,'display reads must not load raw cryptographic data');
    return original(sql,args);
  };
  const all=await store.getAll();
  assert.equal(Object.keys(all).length,30);
  assert.ok(queries.length<=12,`expected batched reads, received ${queries.length}`);
  const number=Object.keys(all)[0];
  assert.equal(all[number].messages.length,40);
  const receipt=await store.updateMessageStatus('0-4',3);
  assert.equal(receipt.partialMessages,true);
  assert.equal(receipt.messages.length,1);
  assert.equal(receipt.messages[0].deliveryStatus,3);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt))<2000);
  assert.equal(await store.updateMessageStatus('0-4',3),null,'repeated acknowledgements do not resend history');
  assert.equal(await store.updateMessageStatus('0-4',2),null,'older acknowledgements do not regress status');
  assert.equal((await store.updateMessageStatus('0-4',4)).messages[0].deliveryStatus,4);
  await store.updateMessageStatus('0-6', 1);
  assert.equal((await store.updateMessageStatus('0-6', 0)).messages[0].deliveryStatus, 0);
  assert.equal(await store.updateMessageStatus('0-6', 1), null, 'a late pending echo does not erase the server rejection');
  assert.equal((await store.updateMessageStatus('0-6', 2)).messages[0].deliveryStatus, 2, 'an actual server ack can recover a rejected retry');
  const echoed = await store.addMessage(number, 'admin', 'Duplicate echo', '', {}, '0-5', 4, { delta: true });
  assert.equal(echoed.messages[0].deliveryStatus, 4, 'history echoes update receipts even when the message already exists');
  assert.equal((await store.addMessage(number, 'admin', 'Older echo', '', {}, '0-5', 2, { delta: true })).messages[0].deliveryStatus, 4);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n,1200);
  assert.equal((await db.get("SELECT LENGTH(whatsapp_payload) AS n FROM messages LIMIT 1")).n,raw.length,'raw payload remains stored for replies and retries');
  const sent=await store.addMessage(number,'admin','Fast reply','',{},'new-fast-reply',1,{delta:true});
  assert.equal(sent.partialMessages,true);
  assert.equal(sent.messages.length,1,'sending returns only the added message');
  assert.equal(mergeConversation(all[number],sent).messages.length,41);
  const metadata=await store.getAll({metadataOnly:true});
  assert.equal(Object.keys(metadata).length,30);
  assert.equal(metadata[number].messages.length,0,'scope checks do not read message history');
  assert.equal((await store.getConversation(number,false,{metadataOnly:true})).messages.length,0);
  db.all=original;
});
