import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';
import {newGame,view,act,legal,voteRunout,startHand,borrowChips} from '../lib/poker.mjs';
import {seal,unseal} from '../api/game.js';
const creds=s=>({code:s.room.code,secret:s.secret});
const command=(s,command,extra={})=>({...creds(s),command,requestId:randomUUID(),...(command==='ready'?{ready:true}:{}),...extra});
function fixture(){let time=1000;const store=memoryRoomStore({now:()=>time});return {store,execute:roomService(store,{now:()=>time,decider:()=>async(_g,l)=>[l.check?'check':'call']}),time:n=>time=n};}
test('同一身份超时后从房间号重新加入，保留原席位筹码并且不产生重复玩家',async()=>{
  const f=fixture(),a=await f.execute({command:'create',name:'房主',config:{seats:3},clientKey:'a'.repeat(64)}),b=await f.execute({command:'join',code:a.room.code,name:'Leon',clientKey:'b'.repeat(64)});
  await f.execute(command(a,'ready'));await f.execute(command(b,'ready'));const started=await f.execute(command(a,'start'));f.time(60000);
  const before=await f.store.get(a.room.code),again=await f.execute({...creds(b),command:'join',name:'Leon',clientKey:'b'.repeat(64)});
  assert.equal(again.room.members.length,2);assert.equal(again.room.mySeat,b.room.mySeat);assert.equal(again.secret,b.secret);assert.equal(again.reconnected,true);assert.equal(again.frames.length,0);
  const after=await f.store.get(a.room.code);assert.deepEqual(after.game.players,before.game.players);assert.equal(again.room.turnUntil,started.room.turnUntil);assert.ok(!JSON.stringify(again).includes('clientAuth'));
});
test('加入响应丢失后重试、同时重试，浏览器凭据能恢复同一席位',async()=>{
  const f=fixture(),a=await f.execute({command:'create',config:{seats:4},name:'A'}),join={command:'join',code:a.room.code,name:'Leon',clientKey:'b'.repeat(64)};
  const [one,two]=await Promise.all([f.execute(join),f.execute(join)]);assert.equal(one.room.mySeat,two.room.mySeat);assert.equal(one.secret,two.secret);
  const three=await f.execute(join);assert.equal(three.room.members.length,2);assert.equal(three.room.mySeat,one.room.mySeat);
  await assert.rejects(()=>f.execute({...join,clientKey:'c'.repeat(64)}),/昵称/);await assert.rejects(()=>f.execute({...join,command:'reconnect',clientKey:'c'.repeat(64)}),/身份/);
});
test('每手和重新入座都未准备；旧手的准备请求与隐式准备不能准备下一手',async()=>{
  const f=fixture(),a=await f.execute({command:'create',config:{seats:2},name:'A'}),b=await f.execute({command:'join',code:a.room.code,name:'B'});
  assert.ok(a.room.members.every(m=>!m.ready));await assert.rejects(()=>f.execute({...creds(a),command:'ready',requestId:randomUUID()}),/明确/);
  await f.execute(command(a,'ready',{hand:0}));await f.execute(command(b,'ready',{hand:0}));let state=await f.execute(command(a,'start'));assert.ok(state.room.members.every(m=>!m.ready));
  state=await f.execute(command(a,'action',{version:state.room.version,action:'fold'}));assert.ok(state.room.members.every(m=>!m.ready));
  await assert.rejects(()=>f.execute(command(a,'ready',{hand:0})),/重新准备/);await f.execute(command(a,'ready',{hand:1}));
  state=await f.execute({...creds(a),command:'reconnect'});assert.equal(state.room.members.find(m=>m.seat===0).ready,false);
  await assert.rejects(()=>f.execute(command(a,'next',{version:state.room.version})),/准备/);
});
test('旧版无代次的已准备标志不会默认变为本手已准备，房主可移除离线遗留席位',async()=>{
  const f=fixture(),a=await f.execute({command:'create',config:{seats:3},name:'A'}),b=await f.execute({command:'join',code:a.room.code,name:'Leon'});
  let room=await f.store.get(a.room.code);room.members[1].ready=true;delete room.members[1].readyHand;room.version++;await f.store.compareAndSet(room,room.version-1);
  let state=await f.execute({...creds(a),command:'poll'});assert.equal(state.room.members[1].ready,false);
  await assert.rejects(()=>f.execute(command(a,'remove',{memberId:b.room.members[1].id})),/30 秒/);f.time(40000);state=await f.execute({...creds(a),command:'poll'});
  await assert.rejects(()=>f.execute(command(b,'remove',{memberId:a.room.members[0].id})),/房主/);
  state=await f.execute(command(a,'remove',{memberId:b.room.members[1].id}));assert.equal(state.room.members.length,1);await assert.rejects(()=>f.execute({...creds(b),command:'poll'}),/身份/);
});
test('行动计时过期不会自动过牌或弃牌，重新连接也不重置计时，之后可继续行动',async()=>{
  const f=fixture(),a=await f.execute({command:'create',config:{seats:2},name:'A'}),b=await f.execute({command:'join',code:a.room.code,name:'B'});await f.execute(command(a,'ready'));await f.execute(command(b,'ready'));const initial=await f.execute(command(a,'start'));f.time(120000);
  let state=await f.execute({...creds(b),command:'poll'});assert.equal(state.game.turn,0);assert.equal(state.game.players[0].folded,false);assert.equal(state.room.version,initial.room.version);
  state=await f.execute({...creds(a),command:'reconnect'});assert.equal(state.room.turnUntil,initial.room.turnUntil);assert.ok(state.game.legal);
  state=await f.execute(command(a,'action',{version:state.room.version,action:'call'}));assert.equal(state.game.turn,1);assert.equal(state.room.turnUntil,165000);
});
test('全下下注锁定后先翻出未弃牌玩家，再投票与发牌，弃牌者始终不暴露',()=>{
  const frames=[],g=newGame({seats:3},(g,event)=>frames.push({event,game:structuredClone(view(g,0))}),[{human:true},{human:true},{human:true}]);
  act(g,0,'raise',10000);act(g,1,'call');assert.equal(g.street,'preflop');assert.equal(view(g,0).players[1].hole[0],'?');act(g,2,'fold');
  assert.equal(g.street,'runout-vote');assert.ok(view(g,0).players[1].hole.every(c=>c!=='?'));assert.deepEqual(view(g,0).players[2].hole,['?','?']);
  const reveal=frames.findIndex(f=>f.event.type==='reveal'),vote=frames.findIndex(f=>f.event.type==='vote');assert.ok(reveal>=0&&reveal<vote);assert.equal(frames[reveal].game.board.length,0);
  for(const f of frames.slice(0,reveal))assert.deepEqual(f.game.players[1].hole,['?','?']);
  voteRunout(g,0,2);voteRunout(g,1,2);assert.ok(frames.findIndex(f=>f.event.type==='street')>reveal);assert.deepEqual(view(g,0).players[2].hole,['?','?']);
  for(const p of g.players)if(p.stack===0)borrowChips(g,p.id,10000);startHand(g);assert.deepEqual(g.revealed,[]);assert.deepEqual(view(g,0).players[1].hole,['?','?']);
});
test('正常河牌比牌在结算前亮牌，其他人都弃牌获胜则不强制亮牌',()=>{
  const frames=[],g=newGame({seats:3},(g,e)=>frames.push({event:e,game:structuredClone(view(g))}));
  while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}
  const r=frames.findIndex(f=>f.event.type==='reveal'),s=frames.findIndex(f=>f.event.type==='settle');assert.ok(r>=0&&r<s);assert.equal(frames[r].game.board.length,5);assert.ok(frames[r].game.players.every(p=>p.hole.every(c=>c!=='?')));
  const events=[],h=newGame({seats:2},(_g,e)=>events.push(e));act(h,h.turn,'fold');assert.ok(!events.some(e=>e.type==='reveal'));
});
test('完整保留最近多手行动记录，长积分赛凭证可以继续校验',()=>{
  process.env.SESSION_SECRET='regression-secret-for-test-at-least-32-characters';const g=newGame({seats:9,mode:'points',rounds:100});
  for(let hand=0;hand<100;hand++){while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}if(hand<99)startHand(g);}
  assert.equal(g.history.length,30);assert.ok(g.history.every(h=>h.actions?.length>20));assert.ok(g.history.every(h=>h.actions[0].includes(`第 ${h.hand} 手`)));
  const token=seal(g);assert.ok(token.length<750000);assert.equal(unseal(token).hand,100);
});
