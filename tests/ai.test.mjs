import test from 'node:test';
import assert from 'node:assert/strict';
import {deck,evaluate,shuffle} from '../lib/cards.mjs';
import {cardCode,fastScore,estimateEquity,localDecision} from '../lib/ai.mjs';
import {newGame,legal,act,voteRunout} from '../lib/poker.mjs';
import {hybridDecider,memoryGuard,redisGuard} from '../lib/deepseek.mjs';
import {processGameAsync} from '../api/game.js';
process.env.SESSION_SECRET='test-secret-for-river-at-least-32-characters';
const encode=rank=>{let n=rank[0];for(let i=1;i<=5;i++)n=n*15+(rank[i]||0);return n;};
function seeded(seed){return bound=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%bound;};}
test('Fisher–Yates 在三张牌上穷举全部分支，每种排列出现一次',()=>{const outcomes=[];for(let a=0;a<3;a++)for(let b=0;b<2;b++){const draws=[a,b];outcomes.push(shuffle([1,2,3],()=>draws.shift()).join(''));}assert.equal(new Set(outcomes).size,6);assert.throws(()=>shuffle([1,2],()=>2));});
test('模拟快速评估器与独立结算评估器对比，覆盖 1500 副五至七张牌',()=>{for(let i=0;i<1500;i++){const cards=deck().slice(0,5+i%3);assert.equal(fastScore(cards.map(cardCode)),encode(evaluate(cards).rank),cards.join(' '));}});
test('已成皇家同花顺胜率为 1，公共牌皇家同花顺按平分权益计算',()=>{assert.equal(estimateEquity(['14s','13s'],['12s','11s','10s','2h','3d'],3,{samples:50,rng:seeded(1)}),1);assert.equal(estimateEquity(['2h','3d'],['10s','11s','12s','13s','14s'],3,{samples:50,rng:seeded(2)}),.25);});
test('同样未知牌模拟：AA 权益高于 72，AI 对明显不划算的大注可弃牌',()=>{const aa=estimateEquity(['14s','14h'],[],3,{samples:1200,rng:seeded(5)}),seven=estimateEquity(['7s','2h'],[],3,{samples:1200,rng:seeded(5)});assert.ok(aa>seven+.25);const g=newGame({seats:6});g.players[g.turn].hole=['7s','2h'];const l={...legal(g),call:5000,pot:100,canRaise:false};assert.equal(localDecision(g,l,{samples:300,rng:seeded(4)}).action[0],'fold');});
test('本地 AI 不偷看其他玩家底牌或真实牌堆',()=>{const g=newGame({seats:6}),id=g.turn,l=legal(g);const before=localDecision(g,l,{rng:seeded(42)});for(const p of g.players)if(p.id!==id)p.hole=['14s','14h'];g.deck=['14s'];const after=localDecision(g,l,{rng:seeded(42)});assert.deepEqual(after,before);assert.ok(!JSON.stringify(before.context).includes('deck'));});
test('新版 AI 连续做出合法决策并保持筹码守恒',()=>{for(const limit of ['no-limit','pot-limit','fixed-limit']){const g=newGame({seats:9,limit});let steps=0;while(g.street!=='complete'){if(g.street==='runout-vote'){voteRunout(g,0,1);continue;}assert.ok(++steps<150);const [action,amount]=localDecision(g,legal(g),{samples:60}).action;act(g,g.turn,action,amount);}assert.equal(g.players.reduce((s,p)=>s+p.stack,0),90000);}});
const context={street:'turn',hole:['14s','13s'],board:['2h','3h','4h','5c'],equity:.4,price:.3,opponents:2};
const local=()=>({action:['call'],context,candidates:[{action:'fold',amount:0},{action:'call',amount:0},{action:'raise',amount:200}]});
const env={DEEPSEEK_API_KEY:'test-not-a-real-key',DEEPSEEK_TIMEOUT_MS:100,DEEPSEEK_MAX_PER_HAND:2,DEEPSEEK_LOG:'0'};
const game=()=>({hand:1});
const ok=choice=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({choice})}}]}),{status:200});
test('DeepSeek 只返回候选动作；每个请求最多一次，每手最多两次',async()=>{
  let calls=0;const fetchImpl=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.response_format.type,'json_object');assert.ok(!init.body.includes('test-not-a-real-key'));return ok(2);};
  const guard=memoryGuard(),g=game(),decide=hybridDecider({env,local,guard,fetchImpl,shouldAsk:()=>true});assert.deepEqual(await decide(g,{}),['raise',200]);assert.deepEqual(await decide(g,{}),['call']);assert.equal(calls,1);assert.equal(g.aiBudget.calls,1);
  g.aiBudget.calls=2;assert.deepEqual(await hybridDecider({env,local,guard,fetchImpl,shouldAsk:()=>true})(g,{}),['call']);assert.equal(calls,1);
});
test('DeepSeek 缓存命中不重复调用，限流满后直接回退',async()=>{
  let calls=0;const guard=memoryGuard({limit:1}),options={env,local,guard,fetchImpl:async()=>{calls++;return ok(1);},shouldAsk:()=>true};
  await hybridDecider(options)(game(),{});await hybridDecider(options)(game(),{});assert.equal(calls,1);
  const noisy=()=>({...local(),context:{...context,equity:.41}});assert.deepEqual(await hybridDecider({...options,local:noisy})(game(),{}),['call',0]);assert.equal(calls,1);
  const other=()=>({...local(),context:{...context,board:['2h','3h','4h','6c']}});assert.deepEqual(await hybridDecider({...options,local:other})(game(),{}),['call']);assert.equal(calls,1);
});
test('429 熔断、非法模型输出、网络挂起都回退，超时不拖住牌局',async()=>{
  let calls=0,time=0;const guard=memoryGuard({now:()=>time});const options={env,local,guard,fetchImpl:async()=>{calls++;return new Response('{}',{status:429});},shouldAsk:()=>true};
  await hybridDecider(options)(game(),{});time=11000;await hybridDecider(options)(game(),{});assert.equal(calls,1);time=61000;await hybridDecider(options)(game(),{});assert.equal(calls,2);
  assert.deepEqual(await hybridDecider({env,local,guard:memoryGuard(),fetchImpl:async()=>ok(999),shouldAsk:()=>true})(game(),{}),['call']);
  const start=performance.now();assert.deepEqual(await hybridDecider({env,local,guard:memoryGuard(),fetchImpl:()=>new Promise(()=>{}),shouldAsk:()=>true})(game(),{}),['call']);assert.ok(performance.now()-start<1000);
});
test('Vercel 缺少分布式限流或 Redis 不可用时，不发送模型请求',async()=>{let calls=0;const fetchImpl=async()=>{calls++;throw new Error('offline');};await hybridDecider({env:{...env,VERCEL:'1'},fetchImpl,local,shouldAsk:()=>true})(game(),{});assert.equal(calls,0);const guard={get:async()=>{throw new Error('Redis down');},fail:async()=>{}};await hybridDecider({env,guard,fetchImpl,local,shouldAsk:()=>true})(game(),{});assert.equal(calls,0);});
test('Redis 使用共享原子预算，缓存与租约命令正确',async()=>{const commands=[],guard=redisGuard({...env,UPSTASH_REDIS_REST_URL:'https://test.invalid',UPSTASH_REDIS_REST_TOKEN:'fake'},{fetchImpl:async(_url,init)=>{const cmd=JSON.parse(init.body);commands.push(cmd);return new Response(JSON.stringify({result:cmd[0]==='EVAL'?1:null}));}});assert.equal(await guard.get('x'),null);const lease=await guard.acquire();assert.ok(lease);await guard.release(lease);assert.deepEqual(commands.map(c=>c[0]),['GET','EVAL','ZREM']);assert.equal(commands[1][2],3);});
test('未配置模型的异步 API 可以完成开局并保留动作帧',async()=>{const result=await processGameAsync({command:'start',config:{seats:6}},{env:{}});assert.equal(result.game.turn,0);assert.ok(result.frames.length>=3);});
