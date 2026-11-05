import test from 'node:test';
import assert from 'node:assert/strict';
import * as z from '../lib/zipai.mjs';

const ids=types=>{const counts=Array(20).fill(0);return types.map(t=>t*4+counts[t]++);};
function game(){
  const g=z.newGame({special:false,minHu:10});
  Object.assign(g,{street:'discard',turn:0,current:null,queue:[],needsDraw:null,drawCount:2,discardCount:3,deck:[76],history:[],handLog:[],log:[],wakes:[],finished:false});
  for(const p of g.players)Object.assign(p,{human:true,hole:[],melds:[],discards:[],passedHu:[],passedPeng:[],passedEat:[],heavyOwed:0});
  return g;
}
test('multiple legal Hu groupings remain selectable instead of silently choosing maximum',()=>{
  const g=game();g.players[0].hole=ids([13,13,13,1,11,11,2,3,4,0,10,10,9,9,19,2,12,12,14,14,14]);
  const choices=z.legal(g,0).huChoices;
  assert.deepEqual(choices.map(c=>c.hu),[27,12]);
  assert.equal(choices[0].recommended,true);
  assert.throws(()=>z.act(g,0,'hu:99'),/组合已更新/);
  const selected=choices[1];z.act(g,0,selected.id);
  assert.equal(g.street,'complete');assert.equal(g.result.hu,12);
  assert.deepEqual(g.result.groups,selected.groups);
});
test('another player’s drawn fourth card offers direct Kai Hu before the Kai confirmation',()=>{
  const g=game(),p=g.players[0];
  p.hole=ids([0,0,0,1,1,1,2,2,2,10,10,10,11,11,11,12,12,12,13,13]);
  g.turn=1;g.players[1].hole=[72];g.deck=[3];
  // Player 1 discards; player 2 draws the fourth small one, which player 0 can Kai-Hu.
  z.act(g,1,'discard',72);
  assert.equal(g.current.card,3);assert.equal(g.current.source,2);assert.equal(g.current.draw,true);
  assert.equal(g.turn,0);const l=z.legal(g,0);
  assert.equal(l.hu,true);assert.equal(l.mandatory,undefined);
  assert.ok(l.huChoices.some(c=>c.method==='开招胡'));
  z.act(g,0,l.huChoices.find(c=>c.method==='开招胡').id);
  assert.equal(g.street,'complete');assert.equal(g.result.winKind,'public-draw');
  assert.ok(p.melds.some(m=>m.kind==='kai'&&m.cards.length===4));
  assert.equal(g.handLog.some(line=>line.includes('· 开招')),false);
});
test('declining direct Kai Hu does not loop back to the same Hu offer',()=>{
  const g=game({allowPassedHu:true});g.config.allowPassedHu=true;
  g.players[0].hole=ids([0,0,0,1,1,1,2,2,2,10,10,10,11,11,11,12,12,12,13,13]);
  g.turn=1;g.players[1].hole=[72];g.deck=[3];z.act(g,1,'discard',72);z.act(g,0,'pass');
  assert.equal(z.legal(g,0).mandatory,true);assert.equal(z.legal(g,0).hu,false);
  assert.equal(z.legal(g,0).options[0].id,'kai');
});
