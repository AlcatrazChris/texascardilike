import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as z from '../lib/zipai.mjs';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';

function sweepFixture(){
  const g=z.newGame({special:false,rounds:2});
  for(const p of g.players){p.human=true;p.hole=[];p.melds=[];p.discards=[];p.passedHu=[];p.passedPeng=[];p.passedEat=[];p.heavyOwed=0;}
  g.players[0].hole=[4];g.players[1].hole=[20,21,36];g.players[2].hole=[68,69,0];
  Object.assign(g,{street:'discard',turn:0,current:null,queue:[],needsDraw:null,handLog:[],log:[],history:[],privateMessages:{},privacyVersion:1,drawCount:1,discardCount:2,deck:[79,70,22]});return g;
}
test('扫牌在摸牌第一帧、当前牌、扫牌副露和文字记录中均对其他人隐藏',()=>{
  const g=sweepFixture(),frames=[];z.observeGame(g,(state,event)=>frames.push({event:z.publicEvent(state,event,2),game:structuredClone(z.view(state,2))}));
  z.act(g,0,'discard',4);const draw=frames.find(f=>f.event.type==='draw');
  assert.equal(draw.event.card,'?');assert.equal(draw.event.concealed,true);assert.doesNotMatch(draw.event.text,/六/);assert.equal(draw.game.current.card,'?');
  assert.equal(z.view(g,1).current.card,22);assert.equal(z.view(g,2).current.card,'?');assert.equal(z.view(g,2).legal,null);
  z.act(g,1,'sao');const other=z.view(g,2),owner=z.view(g,1);
  assert.deepEqual(other.players[1].melds[0].cards,['?','?','?']);assert.equal(other.players[1].melds[0].hu,null);
  assert.deepEqual(owner.players[1].melds[0].cards,[20,21,22]);assert.equal(owner.current.card,22);
  assert.ok(other.handLog.some(t=>t.includes('扫（暗牌）')));assert.ok(owner.handLog.some(t=>t.includes('扫六')));
  assert.doesNotMatch(other.handLog.join('\n'),/摸出 六|扫六/);assert.doesNotMatch(other.log.join('\n'),/摸出 六|扫六/);
  z.act(g,1,'discard',36);assert.notEqual(g.street,'complete');assert.doesNotMatch(z.view(g,2).handLog.join('\n'),/摸出 六|扫六/);
  for(const f of frames.filter(f=>f.event.type==='draw'||f.event.kind==='sao'))assert.doesNotMatch(f.event.text,/六/);
});

test('房间 API 的响应帧、轮询和重连也不泄露扫牌，不只在 UI 盖牌背',async()=>{
  const store=memoryRoomStore(),execute=roomService(store),a=await execute({command:'create',name:'A',config:{game:'zipai',special:false}}),b=await execute({command:'join',name:'B',code:a.room.code}),c=await execute({command:'join',name:'C',code:a.room.code});
  const room=await store.get(a.room.code),version=room.version;room.game=sweepFixture();room.status='playing';room.events=[];room.eventSeq=0;room.version++;await store.compareAndSet(room,version);
  const rpc=(who,body)=>execute({code:a.room.code,secret:who.secret,requestId:randomUUID(),...body});
  await rpc(a,{command:'action',version:0,action:'discard',amount:4});
  const snapshot=await rpc(c,{command:'poll'}),draw=snapshot.frames.find(f=>f.event.type==='draw');assert.equal(draw.event.card,'?');assert.equal(draw.game.current.card,'?');
  await rpc(b,{command:'action',version:snapshot.room.version,action:'sao'});
  const reconnected=await rpc(c,{command:'reconnect'});assert.equal(reconnected.game.current.card,'?');assert.deepEqual(reconnected.game.players[1].melds[0].cards,['?','?','?']);assert.doesNotMatch(reconnected.game.handLog.join(' '),/摸出 六|扫六/);
  assert.equal((await rpc(b,{command:'poll'})).game.current.card,22);
});

test('普通公开摸牌仍显示牌面，起手挡底和一笼保持暗牌，结算后可全局亮牌',()=>{
  const g=sweepFixture(),draws=[];g.players[1].hole=[28,32];z.observeGame(g,(state,event)=>{if(event.type==='draw')draws.push({event:z.publicEvent(state,event,2),game:structuredClone(z.view(state,2))});});z.act(g,0,'discard',4);
  assert.equal(draws[0].event.card,22);assert.equal(draws[0].game.current.card,22);
  let found;for(let i=0;i<100;i++){const h=z.newGame({special:false});if(h.players.some(p=>p.melds.some(m=>m.initial))){found=h;break;}}
  assert.ok(found,'expected an initial quad among 100 secure deals');const p=found.players.find(p=>p.melds.some(m=>m.initial)),seat=(p.id+1)%3,v=z.view(found,seat);
  assert.equal(v.dangdi,seat===found.dealer?found.dangdi:'?');assert.ok(v.players[p.id].melds.filter(m=>m.initial).every(m=>m.cards.every(c=>c==='?')));
  const actual=found.players.flatMap(p=>[...p.hole,...p.melds.flatMap(m=>m.cards)]);assert.equal(actual.length,61);assert.equal(new Set(actual).size,61);
  found.street='complete';assert.deepEqual(z.view(found,seat).players[p.id].melds,p.melds);
});

test('已有旧房间未写可见性标记的扫牌回放也会被遮蔽',()=>{
  const g=sweepFixture();delete g.privacyVersion;delete g.privateMessages;g.current={card:22,source:1,draw:true,claimed:false};
  const event={type:'draw',text:'AI 2 · 摸出 六',playerId:1,card:22};
  assert.equal(z.publicEvent(g,event,2).card,'?');assert.doesNotMatch(z.publicEvent(g,event,2).text,/六/);assert.equal(z.view(g,2).current.card,'?');
  assert.equal(z.publicEvent(g,event,1).card,22);
});
