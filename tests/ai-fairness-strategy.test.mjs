import test from 'node:test';import assert from 'node:assert/strict';
import {newGame,legal,act,playBotsAsync,startHand} from '../lib/poker.mjs';
import {localDecision} from '../lib/ai.mjs';import {decisionObservation} from '../lib/ai-observation.mjs';import {hybridDecider,memoryGuard} from '../lib/deepseek.mjs';
function seeded(seed){return max=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%max;};}
function flop({seats=4,board=['13s','12d','2h'],hole=['8s','8d'],pot=1200}={}){const g=newGame({seats});g.street='flop';g.board=board;g.currentBet=0;g.lastRaise=g.bb;g.raises=0;g.acted=[];g.actedAt={};g.lastAggressor=-1;for(const p of g.players){p.bet=0;p.total=pot/seats;p.streetRaises=0;}g.players[g.turn].hole=hole;return g;}
test('AI 决策入口不读取真实牌堆、任何对手底牌、未来牌面或私有历史',()=>{
  const g=flop(),id=g.turn;for(const key of ['deck','boards','history'])Object.defineProperty(g,key,{get(){throw Error('Private '+key+' accessed');}});for(const p of g.players)if(p.id!==id)Object.defineProperty(p,'hole',{get(){throw Error('Opponent hole accessed');}});
  const d=localDecision(g,legal(g),{samples:120,rng:seeded(1)});assert.ok(d.action);const v=decisionObservation(g);assert.equal(v.deck,undefined);assert.equal(v.history,undefined);assert.ok(v.players.filter(p=>p.id!==id).every(p=>p.hole.length===0));assert.ok(Object.isFrozen(v));assert.ok(Object.isFrozen(v.board));assert.throws(()=>v.board.push('14s'));assert.throws(()=>v.players[0].stack=100000);
});
test('切换全部隐藏牌和真实未来牌堆，同样可见信息和决策随机数产生完全相同策略',()=>{
  const g=flop(),l=legal(g),before=localDecision(g,l,{samples:240,rng:seeded(91)}),h=structuredClone(g);h.deck.reverse();h.boards=[['14s','14h','14d','14c','13c']];h.history=[{privateHands:{secret:true}}];for(const p of h.players)if(p.id!==h.turn)p.hole=['14s','14h'];const after=localDecision(h,l,{samples:240,rng:seeded(91)});assert.deepEqual(after,before);
});
test('即使自定义异步 AI 试图修改观察对象，也不能触及发牌状态',async()=>{
  const g=newGame({seats:2}),before=[...g.deck];g.players[0].human=false;g.players[1].human=true;let called=false;
  await playBotsAsync(g,async(v,l)=>{called=true;assert.equal(v.deck,undefined);assert.equal(v.players[1].hole.length,0);assert.throws(()=>v.players[0].hole[0]='14h');v.aiBudget.calls=1;return [l.check?'check':'call'];});assert.equal(called,true);assert.deepEqual(g.deck,before);assert.equal(g.aiBudget.calls,1);
});
test('同一预洗牌下，过牌路线与加注跟注路线消耗同样的公共牌和烧牌',()=>{
  const original=newGame({seats:3}),boards=[];
  for(const raises of [false,true]){const g=structuredClone(original);let n=0;while(g.street!=='complete'){assert.ok(++n<100);const l=legal(g);act(g,g.turn,raises&&g.currentBet===0&&l.canRaise?'raise':l.check?'check':'call',g.bb);}boards.push(g.board);}
  assert.deepEqual(boards[0],boards[1]);assert.equal(boards[0].length,5);
});
test('多人弱小口袋对不会因估计权益超过 31% 就持续重注或全下',()=>{
  const g=flop({board:['11s','7d','2h'],hole:['4s','4d']});g.players[g.turn].stack=700;
  for(let seed=1;seed<=180;seed++){const d=localDecision(g,legal(g),{samples:96,rng:seeded(seed)});assert.notEqual(d.action[0],'raise');assert.ok(d.candidates.every(c=>c.action!=='raise'));}
});
test('弱对已经下注后面对反加注，不再自动二次加注到全下',()=>{
  const g=flop({seats:3,board:['10s','7d','2h'],hole:['8s','8d'],pot:6000}),p=g.players[g.turn];p.bet=500;p.streetRaises=1;g.currentBet=2000;g.lastRaise=1500;g.raises=2;
  for(let seed=1;seed<=160;seed++){const d=localDecision(g,legal(g),{samples:100,rng:seeded(seed)});assert.notEqual(d.action[0],'raise');assert.ok(d.candidates.every(c=>c.action!=='raise'));}
});
test('668 翻牌上的 88 是葫芦，仍可主动价值下注，并保留少量慢打',()=>{
  const g=flop({board:['6h','6c','8h'],hole:['8s','8d']}),actions=[];
  for(let seed=1;seed<=200;seed++)actions.push(localDecision(g,legal(g),{samples:100,rng:seeded(seed)}));
  assert.ok(actions.every(d=>d.context.strategy.madeCategory===6));assert.ok(actions.filter(d=>d.action[0]==='raise').length>=160);assert.ok(actions.some(d=>d.action[0]==='check'));
});
test('诈唬概率非零但较低，普通空气牌诈唬不会直接全下',()=>{
  const g=flop({seats:2,board:['13s','7d','2h'],hole:['9c','4c']}),decisions=[];
  for(let seed=1;seed<=500;seed++)decisions.push(localDecision(g,legal(g),{samples:96,rng:seeded(seed)}));
  const bluffs=decisions.filter(d=>d.context.strategy.intent==='bluff');assert.ok(bluffs.length>0);assert.ok(bluffs.length<70);assert.ok(bluffs.every(d=>d.candidates.every(o=>o.amount!==d.context.legal.allIn)));assert.ok(decisions.some(d=>d.action[0]==='check'));
});
test('DeepSeek 仅收到隔离观察和候选动作，无法选择菜单之外的大注',async()=>{
  const g=flop();g.currentBet=g.bb;const id=g.turn,l=legal(g),v=decisionObservation(g);let asked=false;
  const choose=hybridDecider({env:{DEEPSEEK_API_KEY:'fake',DEEPSEEK_LOG:'0'},guard:memoryGuard(),shouldAsk:()=>true,fetchImpl:async(_url,init)=>{asked=true;const p=JSON.parse(init.body),u=JSON.parse(p.messages[1].content);assert.equal(u.situation.deck,undefined);assert.ok(!('boards' in u.situation));assert.ok(u.situation.publicPlayers.every(p=>!('hole' in p)));assert.equal(u.situation.playerId,id);return Response.json({choices:[{message:{content:'{"choice":999}'}}]});}});
  const result=await choose(v,l);assert.equal(asked,true);assert.notEqual(result[0],'raise');
});
test('三种下注规则长期全 AI 对局仍合法，重新领取后的总筹码保持守恒',async()=>{
  for(const limit of ['no-limit','pot-limit','fixed-limit']){
    const g=newGame({seats:6,limit},null,Array.from({length:6},()=>({human:false}))),rng=seeded(120);
    for(let hand=0;hand<40;hand++){
      if(hand)startHand(g);await playBotsAsync(g,async(v,l)=>localDecision(v,l,{samples:48,rng}).action);assert.equal(g.street,'complete');assert.equal(g.players.reduce((n,p)=>n+p.stack,0),g.players.reduce((n,p)=>n+p.initial,0));assert.ok(g.players.every(p=>p.stack>=0));
    }
  }
});
