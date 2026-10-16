const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Two independent Node processes open the same persistent database.
const program = `
const db=require('./db'),schema=require('./flows/schema'),flows=require('./flows/store');
const {FlowService}=require('./flows/service');
const sent=[];
const service=new FlowService({requestChip:async(chip,action,payload)=>{
  if(action==='flow-context')return {connected:true,tags:[],conversation:{number:payload.number}};
  if(action==='flow-send')sent.push(payload.text);
  return {ok:true};
}});
function graph(kind,config){const d=schema.empty();d.nodes.push({id:'node',position:{x:400,y:0},data:{kind,label:kind,config:{...schema.defaults(kind),...config}}},{id:'text',position:{x:700,y:0},data:{kind:'text',label:'Texto',config:{...schema.defaults('text'),text:'Olá, {{fluxo.nome}}!'}}},{id:'end',position:{x:1000,y:0},data:{kind:'stop',config:{reason:'Fim'}}});d.edges=[{id:'a',source:'start',target:'node',sourceHandle:'next'},{id:'b',source:'node',target:'text',sourceHandle:'next'},{id:'c',source:'text',target:'end',sourceHandle:'next'}];return d;}
(async()=>{await db.ready;
if(process.env.FLOW_PHASE==='prepare'){
 await db.run('INSERT INTO chips(name,number,user_id,created_at) VALUES (?,?,1,?)',['Fixture','5511999999999',new Date().toISOString()]);
 for(const [contact,kind,config] of [['5511000000091','question',{text:'Nome?',variable:'nome'}],['5511000000092','delay',{duration:10,unit:'seconds'}]]){
  const definition=graph(kind,config),flow=await flows.create({name:kind,definition});
  if(kind==='question')definition.edges.push({id:'timeout',source:'node',target:'end',sourceHandle:'timeout'});
  await flows.update(flow.id,{revision:flow.revision,definition});
  await flows.publish(flow.id,flow.revision+1);
  const id=await service.createRun({accountId:1,flowId:flow.id,version:1,definition,chipId:1,contact,actorId:1,context:{}});
  const row=await db.get('SELECT * FROM flow_runs WHERE id=?',[id]);
  if(kind==='delay'){const state=JSON.parse(row.state);state.wakeAt=Date.now()-1;await service.persist(row,state);}
 }
 console.log('RESULT:'+JSON.stringify({statuses:(await db.all('SELECT status FROM flow_runs ORDER BY contact')).map(r=>r.status),sent}));
}else{
 const row=await db.get('SELECT * FROM flow_runs WHERE contact=?',['5511000000091']);
 await service.run(row.id,{text:'Ana'});await service.tick();
 console.log('RESULT:'+JSON.stringify({statuses:(await db.all('SELECT status FROM flow_runs ORDER BY contact')).map(r=>r.status),sent,logs:(await db.get('SELECT COUNT(*) AS n FROM flow_logs')).n}));
}
await service.stop();await db.close();})().catch(e=>{console.error(e);process.exitCode=1;});
`;
test("waiting answers and backend timers survive complete Node process termination and restart", () => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "convelya-flow-restart-"),
  );
  try {
    const run = (phase) => {
      const env = {
        ...process.env,
        STORAGE_DIR: folder,
        ADMIN_USERNAME: "restart-owner",
        ADMIN_PASSWORD: "fixture-password",
        FLOW_PHASE: phase,
      };
      delete env.DATABASE_URL;
      delete env.DATABASE_PRIVATE_URL;
      const result = spawnSync(process.execPath, ["-e", program], {
        cwd: path.resolve(__dirname, ".."),
        env,
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const line = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("RESULT:"));
      assert.ok(line, result.stdout);
      return JSON.parse(line.slice(7));
    };
    const first = run("prepare");
    assert.deepEqual(first.statuses, ["waiting", "sleeping"]);
    assert.deepEqual(first.sent, ["Nome?"]);
    const second = run("resume");
    assert.deepEqual(second.statuses, ["stopped", "stopped"]);
    assert.ok(second.sent.includes("Olá, Ana!"));
    assert.ok(!second.sent.includes("Nome?"));
    assert.equal(second.sent.length, 2);
    assert.ok(second.logs >= 8);
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
