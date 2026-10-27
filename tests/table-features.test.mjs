import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newGame,legal,act,startHand,borrowChips,voteRunout,expireRunout,view,settle} from '../lib/poker.mjs';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';
const callDown=g=>{for(let i=0;g.street!=='complete';i++){assert.ok(i<150);if(g.street==='runout-vote'){for(const p of g.players)if(g.street==='runout-vote'&&p.human&&g.runoutVote.eligible.includes(p.id)&&!(p.id in g.runoutVote.votes))voteRunout(g,p.id,1);}else{const l=legal(g);act(g,g.turn,l.check?'check':'call');}}};
test('真人归零不自动补发，领取金额校验并累计借入，积分排除借款',()=>{
  const g=newGame({seats:2});callDown(g);g.players[0].stack=0;
  assert.throws(()=>startHand(g),/领取/);assert.equal(g.players[0].stack,0);
  for(const n of [0,-1,10001,1.5,NaN])assert.throws(()=>borrowChips(g,0,n));
  borrowChips(g,0,2000);assert.equal(g.players[0].stack,2000);assert.equal(g.players[0].borrowed,2000);assert.equal(g.players[0].initial,12000);
  assert.throws(()=>borrowChips(g,0,5000));startHand(g);assert.equal(g.players[0].initial,12000);
});
function locked(seats=3){const g=newGame({seats},null,Array.from({length:seats},(_,id)=>({name:'P'+id,human:true})));for(let i=0;i<seats;i++){const l=legal(g);act(g,g.turn,l.canRaise?'raise':'call',l.canRaise?l.allIn:undefined);}assert.equal(g.street,'runout-vote');return g;}
test('全下发两次要求全员一致，主池/边池分组结算且无重复牌',()=>{
  const g=locked();assert.equal(legal(g,0),null);assert.throws(()=>voteRunout(g,7,2));
  voteRunout(g,0,2);voteRunout(g,1,2);assert.equal(g.street,'runout-vote');assert.throws(()=>voteRunout(g,0,1));voteRunout(g,2,2);
  assert.equal(g.street,'complete');assert.equal(g.boards.length,2);assert.equal(new Set([...g.players.flatMap(p=>p.hole),...g.boards.flat()]).size,16);
  assert.equal(g.pots.reduce((s,p)=>s+p.amount,0),30000);assert.equal(g.players.reduce((s,p)=>s+p.stack,0),30000);assert.deepEqual(g.pots.map(p=>p.amount),[15000,15000]);
});
test('有反对或投票超时默认发一次，重复请求无法再次结算',()=>{
  const g=locked(2);voteRunout(g,0,1);assert.equal(g.boards.length,1);const stacks=g.players.map(p=>p.stack);assert.throws(()=>voteRunout(g,1,2));assert.deepEqual(g.players.map(p=>p.stack),stacks);
  const h=locked(2);voteRunout(h,0,2);assert.equal(expireRunout(h,h.runoutVote.deadline+1),true);assert.equal(h.boards.length,1);assert.equal(expireRunout(h),false);
});
test('已有翻牌共用前缀，两组后续从同一牌堆发出；边池和奇数筹码守恒',()=>{
  const g=newGame({seats:3},null,[{human:true},{human:true},{human:true}]);
  while(g.street==='preflop'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}
  const prefix=[...g.board];g.players[0].stack=101;g.players[1].stack=202;g.players[2].stack=303;
  while(g.street!=='runout-vote'){const l=legal(g);act(g,g.turn,l.canRaise?'raise':'call',l.canRaise?l.allIn:undefined);}
  for(let id=0;id<3;id++)voteRunout(g,id,2);
  assert.deepEqual(g.boards[0].slice(0,3),prefix);assert.deepEqual(g.boards[1].slice(0,3),prefix);
  assert.equal(new Set([...g.players.flatMap(p=>p.hole),...prefix,...g.boards.flatMap(b=>b.slice(3))]).size,13);
  assert.equal(g.players.reduce((s,p)=>s+p.stack,0),756);assert.equal(g.pots.length,4);
});
test('两次牌面独立评估赢家，抽水只计算一次，单数先分第一组',()=>{
  const g=newGame({seats:3,rake:5,rakeCap:7});g.board=['2s','3h','7c','8d','9s'];g.boards=[g.board,['13c','13d','2h','4h','6s']];
  g.players.forEach((p,id)=>{p.total=101;p.bet=101;p.stack=0;p.folded=id===2;p.hole=id===0?['14s','14h']:id===1?['13s','13h']:['5c','5d'];});
  settle(g);assert.equal(g.totalRake,7);assert.equal(g.players.reduce((s,p)=>s+p.stack,0),296);assert.deepEqual(g.pots.map(p=>p.winners),[[0],[1]]);
  assert.deepEqual(g.pots.map(p=>p.amount),[148,148]);
});
test('积分赛按轮结束，所有玩家取得排行榜、牌型与行动记录，隐藏信息不泄露',()=>{
  const g=newGame({seats:3,mode:'points',rounds:2});callDown(g);assert.equal(g.finished,undefined);assert.equal(g.roundReport.hand,1);startHand(g);callDown(g);
  assert.equal(g.finished,true);assert.throws(()=>startHand(g),/结束/);assert.equal(g.roundReport.ranking.length,3);assert.equal(g.players[0].stats.hands,2);
  for(let id=0;id<3;id++){const v=view(g,id);assert.ok(v.history[0].actions.length>5);assert.ok(v.history[0].myHands.length);assert.ok(!('privateHands' in v.history[0]));assert.ok(v.roundReport.ranking.every(p=>p.stats.hands===2));}
});
const credentials=s=>({code:s.room.code,secret:s.secret});
const cmd=(s,command,extra={})=>({...credentials(s),command,requestId:randomUUID(),...(command==='ready'?{ready:true}:{}),...extra});
function roomFixture(options={}){const store=memoryRoomStore(),execute=roomService(store,{decider:()=>async(_g,l)=>[l.check?'check':'call'],...options});return {store,execute};}
test('每手重新准备，未准备不能开局；房主可按现有人数发牌',async()=>{
  const {execute}=roomFixture(),a=await execute({command:'create',name:'A',config:{seats:6}}),b=await execute({command:'join',code:a.room.code,name:'B'});
  await assert.rejects(()=>execute(cmd(a,'start')),/准备/);await execute(cmd(a,'ready',{ready:true}));await assert.rejects(()=>execute(cmd(a,'start')),/准备/);await execute(cmd(b,'ready',{ready:true}));
  let state=await execute(cmd(a,'start'));
  while(state.game.street!=='complete'){const person=state.game.turn===0?a:b,v=await execute({...credentials(person),command:'poll'});state=await execute(cmd(person,'action',{version:v.room.version,action:v.game.legal.check?'check':'call'}));}
  assert.equal(state.room.status,'between');assert.ok(state.room.members.every(m=>!m.ready));await assert.rejects(()=>execute(cmd(a,'next',{version:state.room.version})),/准备/);
  await execute(cmd(a,'options',{fillAI:false}));await execute(cmd(a,'ready',{ready:true}));await execute(cmd(b,'ready',{ready:true}));state=await execute(cmd(a,'next',{version:state.room.version}));
  assert.equal(state.game.players.filter(p=>!p.sittingOut).length,2);assert.equal(state.game.players.filter(p=>p.human).length,2);assert.equal(state.game.hand,2);
});
test('同时投票 CAS 安全、重复领取只入账一次',async()=>{
  let time=1000;const {execute,store}=roomFixture({now:()=>time}),a=await execute({command:'create',name:'A',config:{seats:2}}),b=await execute({command:'join',code:a.room.code,name:'B'});
  await execute(cmd(a,'ready'));await execute(cmd(b,'ready'));let state=await execute(cmd(a,'start'));
  state=await execute(cmd(a,'action',{version:state.room.version,action:'raise',amount:10000}));state=await execute(cmd(b,'action',{version:state.room.version,action:'call'}));
  assert.equal(state.game.street,'runout-vote');
  await Promise.all([execute(cmd(a,'vote',{runs:2})),execute(cmd(b,'vote',{runs:2}))]);state=await execute({...credentials(a),command:'poll'});assert.equal(state.game.boards.length,2);assert.equal(state.game.players.reduce((s,p)=>s+p.stack,0),20000);
  const settlement=state.frames.find(f=>f.event.type==='settle');assert.ok(settlement.game.history[0].actions.length);assert.ok(!('privateHands' in settlement.game.history[0]));
  const saved=await store.get(a.room.code);saved.game.players[0].stack=0;await store.compareAndSet({...saved,version:saved.version+1},saved.version);
  const request=cmd(a,'loan',{amount:2000});await execute(request);await execute(request);const after=await store.get(a.room.code);assert.equal(after.game.players[0].borrowed,2000);assert.equal(after.game.players[0].stack,2000);
  assert.ok(!after.members.find(m=>m.seat===0).ready);
});
test('房间投票无人达成一致时由服务端轮询超时结算一次',async()=>{
  let time=1000;const {execute}=roomFixture({now:()=>time}),a=await execute({command:'create',name:'A',config:{seats:2}}),b=await execute({command:'join',code:a.room.code,name:'B'});
  await execute(cmd(a,'ready'));await execute(cmd(b,'ready'));let state=await execute(cmd(a,'start'));
  state=await execute(cmd(a,'action',{version:state.room.version,action:'raise',amount:10000}));state=await execute(cmd(b,'action',{version:state.room.version,action:'call'}));
  await execute(cmd(a,'vote',{runs:2}));time=22000;state=await execute({...credentials(b),command:'poll'});
  assert.equal(state.game.street,'complete');assert.equal(state.game.boards.length,1);assert.ok(state.room.members.every(m=>!m.ready));
  const sum=state.game.players.reduce((s,p)=>s+p.stack,0);state=await execute({...credentials(a),command:'poll'});assert.equal(state.game.players.reduce((s,p)=>s+p.stack,0),sum);
});
test('玩家中途退出本手由 AI 接管，下手可排除该座位，也可重新补位',async()=>{
  const {execute,store}=roomFixture(),a=await execute({command:'create',name:'A',config:{seats:3}}),b=await execute({command:'join',code:a.room.code,name:'B'}),c=await execute({command:'join',code:a.room.code,name:'C'});
  for(const s of [a,b,c])await execute(cmd(s,'ready'));let state=await execute(cmd(a,'start'));
  await execute(cmd(c,'leave'));state=await execute({...credentials(a),command:'poll'});assert.equal(state.game.players[2].human,false);
  while(state.game.street!=='complete'){const person=state.game.turn===0?a:b,v=await execute({...credentials(person),command:'poll'});state=await execute(cmd(person,'action',{version:v.room.version,action:v.game.legal.check?'check':'call'}));}
  await execute(cmd(a,'options',{fillAI:false}));await execute(cmd(a,'ready'));await execute(cmd(b,'ready'));state=await execute(cmd(a,'next',{version:state.room.version}));assert.equal(state.game.players.filter(p=>!p.sittingOut).length,2);
  const saved=await store.get(a.room.code);assert.equal(saved.game.players[2].sittingOut,true);
});
test('新玩家仅能在两手之间加入，不继承原座位的隐藏牌和历史身份，且必须准备',async()=>{
  const {execute}=roomFixture(),a=await execute({command:'create',name:'A',config:{seats:3}}),b=await execute({command:'join',code:a.room.code,name:'B'});
  await execute(cmd(a,'ready'));await execute(cmd(b,'ready'));let state=await execute(cmd(a,'start'));
  while(state.game.street!=='complete'){const person=state.game.turn===0?a:b,v=await execute({...credentials(person),command:'poll'});state=await execute(cmd(person,'action',{version:v.room.version,action:v.game.legal.check?'check':'call'}));}
  await execute(cmd(a,'ready'));await execute(cmd(b,'ready'));const c=await execute({command:'join',code:a.room.code,name:'C'});
  assert.equal(c.game.history.length,0);assert.equal(c.frames.length,0);assert.equal(c.game.players[2].hole.length,0);assert.equal(c.game.players[2].award,0);assert.equal(c.game.roundReport,null);
  const fresh=await execute({...credentials(a),command:'poll'});await assert.rejects(()=>execute(cmd(a,'next',{version:fresh.room.version})),/准备/);await execute(cmd(c,'ready'));state=await execute(cmd(a,'next',{version:fresh.room.version}));assert.equal(state.game.players.filter(p=>p.human).length,3);
});
