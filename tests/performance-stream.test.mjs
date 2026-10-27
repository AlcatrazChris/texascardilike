import test from 'node:test';import assert from 'node:assert/strict';import {createHash,createCipheriv,randomBytes,randomUUID} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {encodeState,decodeState,packRoom,unpackRoom} from '../lib/state-codec.mjs';
import {newGame,act,legal,startHand,view} from '../lib/poker.mjs';import {seal,unseal,processGameAsync} from '../api/game.js';
import {consumeGameResponse} from '../public/game-client.js';import {roomService} from '../lib/rooms.mjs';import {memoryRoomStore,redisRoomStore} from '../lib/room-store.mjs';
import {RoomClient} from '../public/rooms-client.js';import {hybridDecider,redisGuard} from '../lib/deepseek.mjs';
process.env.SESSION_SECRET='test-performance-secret-at-least-32-characters';
test('压缩凭证保持完整状态、兼容旧凭证，拒绝篡改与膨胀超限数据',()=>{
  const g=newGame({seats:9});for(let n=0;n<5;n++){while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}if(n<4)startHand(g);}
  assert.deepEqual(unseal(seal(g)),g);assert.ok(seal(g).length<JSON.stringify(g).length/3);
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(process.env.SESSION_SECRET).digest(),iv),body=Buffer.concat([cipher.update(JSON.stringify({game:g,expires:Date.now()+50000})),cipher.final()]);const legacy=Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');assert.deepEqual(unseal(legacy),g);
  const bad=Buffer.from(seal(g),'base64url');bad[40]^=1;assert.throws(()=>unseal(bad.toString('base64url')),/凭证/);
  assert.throws(()=>decodeState(Buffer.concat([Buffer.from('RP2\0'),deflateRawSync(Buffer.alloc(9*1024*1024,32))])));
});
test('压缩房间保持 CAS 版本与旧 JSON 兼容，每次读取相互隔离',async()=>{
  const room={code:'123456',version:1,members:[],events:Array(100).fill({text:'重复的数据'.repeat(100)})};assert.deepEqual(unpackRoom(JSON.stringify(room)),room);assert.deepEqual(unpackRoom(packRoom(room)),room);assert.equal(JSON.parse(packRoom(room)).version,1);assert.ok(packRoom(room).length<JSON.stringify(room).length/10);
  const store=memoryRoomStore();await store.create(room);const first=await store.get(room.code);first.members.push('changed');assert.equal((await store.get(room.code)).members.length,0);assert.equal(await store.compareAndSet({...room,version:2},0),false);assert.equal(await store.compareAndSet({...room,version:2},1),true);
  let stored=JSON.stringify(room);const commands=[];const redis=redisRoomStore({KV_REST_API_URL:'https://test.invalid',KV_REST_API_TOKEN:'fake'},{fetchImpl:async(_u,i)=>{const c=JSON.parse(i.body);commands.push(c);if(c[0]==='GET')return Response.json({result:stored});if(c[0]==='EVAL'){stored=c[5];return Response.json({result:1});}return Response.json({result:'OK'});}});
  assert.deepEqual(await redis.get(room.code),room);await redis.compareAndSet({...room,version:2},1);assert.equal(JSON.parse(stored).codec,'deflate-v1');assert.equal((await redis.get(room.code)).version,2);
});
test('无变化的轻量轮询不重复发送历史，新动作和版本不匹配仍返回完整状态',async()=>{
  const execute=roomService(memoryRoomStore()),a=await execute({command:'create',config:{seats:2}}),b=await execute({command:'join',code:a.room.code,name:'B'});const rpc=(u,command,extra={})=>execute({command,code:a.room.code,secret:u.secret,requestId:randomUUID(),...extra});for(const u of [a,b])await rpc(u,'ready',{ready:true});const s=await rpc(a,'start');
  const quiet=await rpc(b,'poll',{afterEvent:s.room.eventSeq,version:s.room.version,compact:true});assert.equal(quiet.unchanged,true);assert.equal(quiet.game,null);assert.deepEqual(quiet.frames,[]);assert.ok(JSON.stringify(quiet).length<1500);
  assert.ok((await rpc(b,'poll',{afterEvent:s.room.eventSeq,version:-1,compact:true})).game);
  const moved=await rpc(a,'action',{action:'call',version:s.room.version});const update=await rpc(b,'poll',{afterEvent:s.room.eventSeq,version:s.room.version,compact:true});assert.equal(update.unchanged,false);assert.ok(update.game);assert.ok(update.frames.length);assert.equal(update.room.version,moved.room.version);
});
test('玩家动作在等待慢 AI 前就已发送，最终凭证和手牌隐私仍由服务端确定',async()=>{
  const g=newGame({seats:2}),frames=[];let release,called;const entered=new Promise(r=>called=r),blocked=new Promise(r=>release=r);
  const task=processGameAsync({command:'action',token:seal(g),action:'call'},{env:{DEEPSEEK_API_KEY:'fake',DEEPSEEK_POLICY:'always'},guard:{get:async()=>null,acquire:async()=>{called();await blocked;return 'lease';},set:async()=>{},release:async()=>{},fail:async()=>{}},local:(_g,l)=>({action:[l.check?'check':'call'],context:{},candidates:[{action:l.check?'check':'call'},{action:'fold'}]}),fetchImpl:async()=>Response.json({choices:[{message:{content:'{"choice":0}'}}]})},f=>frames.push(f));
  await entered;assert.equal(frames[0].event.playerId,0);assert.equal(frames[0].event.action,'跟注 25');assert.deepEqual(frames[0].game.players[1].hole,['?','?']);release();const result=await task;assert.equal(result.frames.length,0);assert.equal(unseal(result.token).players[0].stack,g.players[0].stack-25);
});
test('流式读取跨中文字符分块，网络接收不等动画，结果凭证只在完整确认后提交',async()=>{
  const encoder=new TextEncoder(),rows=[{type:'frame',frame:{event:{text:'你 · 加注 100'}}},{type:'result',game:{hand:1},token:'verified',frames:[]}],bytes=encoder.encode(rows.map(r=>JSON.stringify(r)+'\n').join(''));let releaseAnimation,seen=false,committed=false;const animation=new Promise(r=>releaseAnimation=r);
  const stream=new ReadableStream({start(c){for(let n=0;n<bytes.length;n+=7)c.enqueue(bytes.slice(n,n+7));c.close();}}),task=consumeGameResponse(new Response(stream,{headers:{'content-type':'application/x-ndjson'}}),{onFrame:async f=>{assert.equal(f.event.text,'你 · 加注 100');seen=true;await animation;},onResult:()=>committed=true});
  await new Promise(r=>setTimeout(r,10));assert.equal(seen,true);assert.equal(committed,true);releaseAnimation();assert.equal((await task).frameCount,1);
  await assert.rejects(()=>consumeGameResponse(new Response('{"type":"frame","frame":{}}\n',{headers:{'content-type':'application/x-ndjson'}})),/中断/);
  await assert.rejects(()=>consumeGameResponse(new Response('{"type":"error","error":"非法下注"}\n',{headers:{'content-type':'application/x-ndjson'}})),/非法下注/);
});
test('联机下注优先于正在等待的轮询，不弹连接错误，也不等待轮询超时',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage={getItem:()=>null,setItem:()=>{}};let aborted=false;const errors=[];
  const c=new RoomClient({onState:async()=>{},onPending:()=>{},onError:e=>errors.push(e)});c.schedule=()=>{};c.stopped=false;c.code='123456';c.secret='a'.repeat(64);c.info={version:1,hand:1};
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);if(body.command==='poll')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Abort','AbortError'));}));return Response.json({room:{code:'123456',version:2,eventSeq:1,hand:1},frames:[],game:{}});};
  try{const p=c.poll();await new Promise(r=>setTimeout(r,5));const start=performance.now();await c.command('action',{action:'call'});await p;assert.equal(aborted,true);assert.ok(performance.now()-start<250);assert.deepEqual(errors,[]);}finally{c.stop();globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});
test('Redis 一次往返查询缓存与申请预算；AI 时限包含缓存和预算等待',async()=>{
  const commands=[],env={DEEPSEEK_API_KEY:'fake',KV_REST_API_URL:'https://test.invalid',KV_REST_API_TOKEN:'fake'};let cached=true;
  const guard=redisGuard(env,{fetchImpl:async(_url,init)=>{commands.push(JSON.parse(init.body));return Response.json({result:cached?[2,'1']:1});}});
  assert.deepEqual(await guard.lookup('position'),{choice:1});assert.equal(commands.length,1);assert.equal(commands[0][2],4);cached=false;assert.ok((await guard.lookup('position')).lease);
  let attempted=false,released=false;const choose=hybridDecider({env:{DEEPSEEK_API_KEY:'fake',DEEPSEEK_POLICY:'always',DEEPSEEK_TIMEOUT_MS:'100'},local:()=>({action:['check'],context:{},candidates:[{action:'check'},{action:'fold'}]}),guard:{lookup:async()=>{await new Promise(r=>setTimeout(r,110));return {lease:'l'};},release:async()=>{released=true;},fail:async()=>{}},fetchImpl:async()=>{attempted=true;throw Error('should not request after deadline');}});
  assert.deepEqual(await choose({hand:1},{}),['check']);assert.equal(attempted,false);assert.equal(released,true);
});
