import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,legal,act} from '../lib/poker.mjs';
import {localDecision} from '../lib/ai.mjs';
import {hybridDecider,memoryGuard} from '../lib/deepseek.mjs';
import {aiStatus} from '../lib/ai-status.mjs';
function seeded(seed){return bound=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%bound;};}
test('六至九人桌：AK 主动开池而非被多人摊牌权益误判，72 面对大注仍弃牌',()=>{
  for(const seats of [6,9]){
    const g=newGame({seats}),actor=g.players[g.turn];actor.hole=['14s','13h'];let raises=0;
    for(let seed=1;seed<=60;seed++)raises+=localDecision(g,legal(g),{samples:96,rng:seeded(seed)}).action[0]==='raise';
    assert.ok(raises>=45,`${seats} seats: ${raises}/60`);
    actor.hole=['7s','2h'];assert.equal(localDecision(g,{...legal(g),call:5000,pot:100,canRaise:false},{rng:seeded(7)}).action[0],'fold');
  }
});
test('持续下注使用公开主动权，干燥单挑翻牌允许无成牌主动下注',()=>{
  const g=newGame({seats:2}),id=g.turn;g.street='flop';g.board=['13d','7h','2c'];g.lastAggressor=id;g.currentBet=0;
  for(const p of g.players){p.bet=0;p.total=150;}g.players[id].hole=['14s','11s'];g.acted=[];g.actedAt={};g.lastRaise=g.bb;
  let raises=0;
  for(let seed=1;seed<=60;seed++)raises+=localDecision(g,legal(g),{samples:160,rng:seeded(seed)}).action[0]==='raise';
  assert.ok(raises>=25,`${raises}/60`);assert.ok(raises<60,'保留过牌');
});
test('加注主动权在换街后保留且下一手重置',()=>{
  const g=newGame({seats:2}),id=g.turn;act(g,id,'raise',150);assert.equal(g.lastAggressor,id);
  act(g,g.turn,'call');assert.equal(g.street,'flop');assert.equal(g.lastAggressor,id);
});
test('默认均衡策略翻牌前实际发出请求；complex 模式仍跳过翻牌前',async()=>{
  let calls=0;
  const local=()=>({action:['check'],context:{street:'preflop',equity:.6,price:0,opponents:5},candidates:[{action:'check',amount:0},{action:'raise',amount:100}]});
  const env={DEEPSEEK_API_KEY:'test-only',DEEPSEEK_LOG:'0'},fetchImpl=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"choice":1}'}}]}));};
  assert.deepEqual(await hybridDecider({env,local,fetchImpl,guard:memoryGuard()})({hand:1},{}),['raise',100]);
  await hybridDecider({env:{...env,DEEPSEEK_POLICY:'complex'},local,fetchImpl,guard:memoryGuard()})({hand:1},{});assert.equal(calls,1);
  const status=aiStatus(env);assert.ok(status.counts.request>=1);assert.ok(status.counts.success>=1);assert.ok(!JSON.stringify(status).includes('test-only'));
});
test('诊断状态区分缺密钥、生产缺共享限流和主动关闭',()=>{
  assert.equal(aiStatus({}).blocker,'missing_key');
  assert.equal(aiStatus({DEEPSEEK_API_KEY:'x',VERCEL:'1'}).blocker,'missing_distributed_guard');
  assert.equal(aiStatus({DEEPSEEK_API_KEY:'x',DEEPSEEK_POLICY:'off'}).blocker,'disabled');
});
