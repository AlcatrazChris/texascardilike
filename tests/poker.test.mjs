import test from 'node:test';
import assert from 'node:assert/strict';
import { deck, evaluate, compare, newGame, act, legal, startHand, borrowChips,voteRunout,settle, playBots, view, config } from '../lib/poker.mjs';
import { seal, unseal, processGame } from '../api/game.js';
process.env.SESSION_SECRET='test-secret-for-river-at-least-32-characters';

test('52 张洗牌，无重复',()=>{const d=deck();assert.equal(d.length,52);assert.equal(new Set(d).size,52);});
test('九种牌型与 A2345 低顺子',()=>{
  const cases=[['14s','13s','12s','11s','10s'],['14s','14h','14d','14c','2s'],['14s','14h','14d','2c','2s'],['14s','11s','8s','5s','2s'],['14s','2h','3d','4c','5s'],['14s','14h','14d','5c','2s'],['14s','14h','5d','5c','2s'],['14s','14h','8d','5c','2s'],['14s','12h','8d','5c','2s']];
  cases.forEach((cards,i)=>assert.equal(evaluate(cards).rank[0],8-i));
  assert.deepEqual(evaluate(cases[4]).rank,[4,5]);
  assert.equal(compare(evaluate(['2s','3h','4c','5s','6d']).rank,evaluate(cases[4]).rank),1);
});
test('从七张选最佳五张、比较踢脚与公共牌平局',()=>{
  const royal=['10s','11s','12s','13s','14s'];assert.deepEqual(evaluate([...royal,'14d','14h']).rank,[8,14]);
  assert.equal(compare(evaluate([...royal,'2d','3h']).rank,evaluate([...royal,'4d','5h']).rank),0);
  assert.equal(compare(evaluate(['14s','14h','13d','12c','9s']).rank,evaluate(['14d','14c','13s','12h','8s']).rank),1);
});
function fixture(players,board=['2s','3h','7c','8d','9s']){return {players:players.map((p,id)=>({id,name:String(id),stack:0,bet:p.total,award:0,...p})),board,config:{rake:0,rakeCap:100},dealer:0,hand:1,handStartStack:100,log:[],history:[],totalRake:0};}
test('三人不同全下额：主池、边池、未跟注退款',()=>{
  const g=fixture([{hole:['14s','14h'],total:100},{hole:['13s','13h'],total:200},{hole:['12s','12h'],total:300}]);settle(g);
  assert.deepEqual(g.players.map(p=>p.stack),[300,200,100]);assert.deepEqual(g.pots.map(p=>p.amount),[300,200]);
});
test('弃牌筹码入池，平局零头从庄家左侧分配',()=>{
  const g=fixture([{hole:['2h','3h'],total:5},{hole:['4h','5h'],total:5},{hole:['6h','7h'],total:5,folded:true}],['10s','11s','12s','13s','14s']);settle(g);assert.deepEqual(g.players.map(p=>p.stack),[7,8,0]);
});
test('抽水遵循比例与上限，无翻牌无抽水',()=>{
  const g=fixture([{hole:['14h','14d'],total:100},{hole:['13h','13d'],total:100}]);g.config.rake=10;g.config.rakeCap=7;settle(g);assert.equal(g.totalRake,7);assert.equal(g.players.reduce((s,p)=>s+p.stack,0),193);
  const f=fixture([{hole:['14h','14d'],total:100},{hole:['13h','13d'],total:100,folded:true}],[]);f.config.rake=10;settle(f);assert.equal(f.totalRake,0);assert.equal(f.players[0].stack,200);
});
test('单挑：庄家小盲翻牌前先行动，翻牌后大盲先行动',()=>{
  const g=newGame({seats:2});assert.equal(g.small,g.dealer);assert.equal(g.turn,g.small);act(g,g.turn,'call');act(g,g.turn,'check');assert.equal(g.street,'flop');assert.equal(g.turn,g.big);
});
test('非法操作拒绝，底池限注上限正确',()=>{
  const g=newGame({seats:6,limit:'pot-limit'});const l=legal(g);assert.equal(l.max,175);assert.throws(()=>act(g,g.turn,'check'));assert.throws(()=>act(g,g.turn,'raise',176));assert.throws(()=>act(g,(g.turn+1)%6,'fold'));assert.throws(()=>config({seats:10}));
});
test('不足额全下不开放已行动玩家加注权',()=>{
  const g=newGame({seats:4});g.street='flop';g.players.forEach(p=>{p.bet=0;p.total=0;p.stack=1000;});g.currentBet=0;g.lastRaise=50;g.acted=[];g.actedAt={};g.turn=0;
  act(g,0,'raise',100);assert.equal(g.turn,1);g.players[1].stack=150;act(g,1,'raise',150);act(g,2,'call');act(g,3,'call');assert.equal(g.turn,0);assert.equal(legal(g).canRaise,false);
});
test('累计不足额全下达到足额时重新开放加注',()=>{
  const g=newGame({seats:4});g.street='flop';g.players.forEach(p=>{p.bet=0;p.total=0;p.stack=1000;});g.currentBet=0;g.lastRaise=50;g.acted=[];g.actedAt={};g.turn=0;
  act(g,0,'raise',100);g.players[1].stack=150;act(g,1,'raise',150);g.players[2].stack=200;act(g,2,'raise',200);act(g,3,'call');assert.equal(g.turn,0);assert.equal(legal(g).canRaise,true);assert.equal(legal(g).min,300);
});
test('无限注不足额开注不允许补齐，固定限注遵循半注重开',()=>{
  const g=newGame({seats:4});g.street='flop';g.players.forEach(p=>{p.bet=0;p.total=0;p.stack=1000;});g.currentBet=0;g.lastRaise=50;g.acted=[];g.actedAt={};g.turn=0;
  g.players[0].stack=20;act(g,0,'raise',20);assert.equal(legal(g).min,70);
  const f=newGame({seats:4,limit:'fixed-limit'});f.street='turn';f.players.forEach(p=>{p.bet=0;p.total=0;p.stack=1000;});f.currentBet=0;f.lastRaise=50;f.acted=[];f.actedAt={};f.turn=0;f.raises=0;
  assert.equal(legal(f).min,100);act(f,0,'raise',100);f.players[1].stack=150;act(f,1,'raise',150);act(f,2,'call');act(f,3,'call');assert.equal(f.turn,0);assert.equal(legal(f).canRaise,true);assert.equal(legal(f).min,250);
});
test('3 种下注结构、2–9 人桌连续运行，所有筹码守恒且不泄露隐藏牌',()=>{
  for(const limit of ['no-limit','pot-limit','fixed-limit'])for(const seats of [2,3,6,9]){
    const g=newGame({limit,seats,ante:5,buyIn:500});
    for(let hand=0;hand<12;hand++){
      let steps=0;
      while(g.street!=='complete'){if(g.street==='runout-vote'){voteRunout(g,0,1);continue;}
        assert.ok(++steps<200);const id=g.turn,l=legal(g);assert.ok(l);
        const snapshot=view(g);for(const p of snapshot.players)if(p.id!==0)assert.ok(p.hole.every(c=>c==='?'));
        if(l.canRaise && steps%7===0)act(g,id,'raise',l.max);else act(g,id,l.check?'check':'call');
        assert.equal(g.players.reduce((s,p)=>s+p.stack+(g.street==='complete'?0:p.total),0),g.players.reduce((s,p)=>s+p.initial,0));
      }
      assert.equal(g.players.reduce((s,p)=>s+p.stack,0)+g.totalRake,g.players.reduce((s,p)=>s+p.initial,0));
      assert.ok(Number.isFinite(g.history[0].net));if(hand<11){if(g.players[0].stack===0)borrowChips(g,0,g.config.buyIn);startHand(g);}
    }
  }
});
test('锦标赛升盲，不补入；现金桌补入记入累计买入',()=>{
  const g=newGame({seats:2,mode:'tournament',levelHands:1});while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}startHand(g);assert.equal(g.bb,100);
  const h=newGame({seats:2});h.street='complete';h.players[0].stack=0;assert.throws(()=>startHand(h),/领取/);borrowChips(h,0,10000);startHand(h);assert.equal(h.players[0].initial,20000);assert.equal(h.players[0].rebuy,1);
});
test('服务端加密凭证、篡改拒绝、AI 完整 API 流程',()=>{
  const state=processGame({command:'start',config:{seats:6}});assert.ok(state.token);assert.equal(state.game.turn,0);assert.ok(!state.token.includes('hole'));
  const g=unseal(state.token);assert.equal(g.players.length,6);const encrypted=seal(g);assert.throws(()=>unseal(encrypted.slice(0,-8)+'INVALID!'));
  const response=processGame({command:'action',token:state.token,action:state.game.legal.check?'check':'call'});assert.ok(response.game.turn===0||response.game.street==='complete');
  for(let i=0;i<40&&g.street!=='complete';i++){playBots(g);if(g.street==='runout-vote'){voteRunout(g,0,1);continue;}if(g.street!=='complete'){const l=legal(g);act(g,0,l.check?'check':'call');}}assert.equal(g.street,'complete');
});
