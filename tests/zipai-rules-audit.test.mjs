import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from '../lib/zipai.mjs';
const ids=types=>{const n=Array(20).fill(0);return types.map(t=>t*4+n[t]++);};
const meld=(kind,types)=>({kind,cards:ids(types),hu:z.meldHu(kind,types),concealed:['sao','guosao','chuan'].includes(kind)});
function fixture(){const g=z.newGame({special:false,flower:false,minHu:10});Object.assign(g,{street:'discard',turn:1,current:null,queue:[],needsDraw:null,drawCount:1,discardCount:2,deck:[79],history:[],handLog:[],wakes:[]});for(const p of g.players)Object.assign(p,{human:true,hole:[],melds:[],discards:[],passedHu:[],passedEat:[],passedPeng:[],heavyOwed:0});return g;}
test('两对剩余不能借开招胡，合法大小搭不能误判为两对',()=>{
 const g=fixture(),p=g.players[0];p.hole=ids([0,0,2,2,5]);p.melds=[meld('sao',[10,10,10]),meld('kan',[11,11,11]),meld('kan',[12,12,12]),meld('chi',[3,4,5])];g.players[1].hole=[43];z.act(g,1,'discard',43);
 assert.equal(z.legal(g,0).hu,false);assert.equal(z.legal(g,0).options[0].id,'kai');
 z.act(g,0,'kai');assert.equal(g.street,'discard');assert.equal(z.legal(g,0).hu,false);assert.throws(()=>z.act(g,0,'hu'));
 const twoPairs=ids([0,0,1,1,3,4,5,6,7,8,10,11,12,14,15,16]);
 assert.equal(z.decompose(twoPairs,[meld('kai',[19,19,19,19])]),null);
 const mixed=ids([0,0,10,1,11,11,2,12,12,3,4,5,6,7,8,13,14,15,16,17,18]);
 const good=z.decompose(mixed);assert.ok(good);assert.equal(good.groups.filter(m=>m.kind==='pair').length,0);
});
test('扫、过扫可接别人的手打牌开招；碰不能接手打牌升级',()=>{
 for(const kind of ['sao','guosao','peng']){
  const g=fixture();g.players[0].melds=[meld(kind,[10,10,10])];g.players[0].hole=[0,4,8,12];g.players[1].hole=[43];z.act(g,1,'discard',43);
  const offered=z.legal(g,0)?.options.some(o=>o.id==='kai');assert.equal(!!offered,kind!=='peng');
  if(offered){z.act(g,0,'kai');assert.equal(g.players[0].melds[0].kind,'kai');assert.equal(g.players[0].melds[0].cards.length,4);assert.equal(g.players[0].melds[0].concealed,false);}
 }
});
test('扫后接手打第四张，成组合法才直接开招胡，并由点炮者双倍支付',()=>{
 const g=fixture(),p=g.players[0];p.melds=[meld('sao',[10,10,10])];p.hole=ids([0,0,0,1,1,1,2,2,2,11,11,11,12,12,12,13,13]);g.players[1].hole=[43];z.act(g,1,'discard',43);
 assert.equal(z.legal(g,0).hu,true);const choice=z.legal(g,0).huChoices.find(c=>c.method==='开招胡');assert.ok(choice);z.act(g,0,choice.id);assert.equal(g.result.winKind,'discard');assert.equal(g.result.discarder,1);assert.equal(g.result.discardMultiplier,2);assert.equal(g.result.delta[2],0);assert.equal(g.result.delta[0],-g.result.delta[1]);assert.equal(z.validHu(p.hole,p.melds,g.result),true);
});
test('普通胡独立校验拒绝漏牌、重复牌、两对、非法组和虚报胡数',()=>{
 const cards=ids([0,0,0,1,1,1,2,2,2,10,10,10,11,11,11,12,12,12,13,13,13]),good=z.decompose(cards);
 assert.equal(z.validHu(cards,[],good),true);
 assert.equal(z.validHu([...cards,76],[],good),false);
 assert.equal(z.decompose([...cards.slice(0,-1),cards[0]]),null);
 const changed=structuredClone(good);changed.groups[0].cards[0]=76;assert.equal(z.validHu(cards,[],changed),false);
 assert.equal(z.validHu(cards,[],{...good,hu:good.hu+1}),false);
 for(let n=0;n<200;n++){const all=z.shuffledDeck(false),hand=all.slice(0,21),result=z.decompose(hand);if(result)assert.equal(z.validHu(hand,[],result),true);for(const choice of z.decompositions(hand))assert.equal(z.validHu(hand,[],choice),true);}
});
test('含飞飞的完整对局：普通胡全部通过独立校验，81张牌守恒且积分零和',async()=>{
 for(let i=0;i<200;i++){const g=z.newGame({flower:true,rounds:1,minHu:[10,15,20][i%3],repeatWake:i%2===0});await z.playBotsAsync(g);assert.equal(g.street,'complete');const r=g.result;
  if(r.winner!==null&&!['三笼','五坎'].includes(r.special)){const p=g.players[r.winner];assert.equal(z.validHu(p.hole,p.melds,r),true);}
  const all=[...g.deck,...g.wakes.map(w=>w.card),...g.players.flatMap(p=>[...p.hole,...p.melds.flatMap(m=>m.cards),...p.discards])];assert.equal(all.length,81);assert.equal(new Set(all).size,81);assert.equal(g.players.reduce((s,p)=>s+p.score,0),0);
 }
});
test('新建默认一张飞飞、仅三档起胡、默认不重醒；基础子数从10胡2子起',()=>{
 const c=z.config();assert.equal(c.flower,true);assert.equal(c.repeatWake,false);assert.equal(c.minHu,15);for(const minHu of [10,15,20])assert.equal(z.config({minHu}).minHu,minHu);for(const minHu of [25,30,12])assert.throws(()=>z.config({minHu}));
 for(const [hu,units]of [[10,2],[14,2],[15,3],[19,3],[20,4],[24,4],[25,5],[33,6]])assert.equal(z.baseUnitsForHu(hu),units);
 for(const [types,expected]of [[
  [13,13,13,1,11,11,2,3,4,0,10,10,9,9,19,2,12,12,14,14,14],2
 ]]){const g=fixture();g.turn=0;g.players[0].hole=ids(types);const choice=z.legal(g,0).huChoices.find(c=>c.hu===12);z.act(g,0,choice.id);assert.equal(g.result.baseUnits,expected);assert.equal(g.result.scoringVersion,3);assert.equal(g.result.units,expected+g.result.wakeUnits);}
});
