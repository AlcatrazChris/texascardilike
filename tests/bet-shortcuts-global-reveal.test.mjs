import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {multipleBet,betError} from '../public/betting.js';
import {newGame,act,legal,view} from '../lib/poker.mjs';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';
test('倍数快捷下注使用本轮总额，遵守最低加注、短筹码全下与两种限注',()=>{
  for(const limit of ['no-limit','pot-limit','fixed-limit']){
    const g=newGame({seats:3,limit}),l=legal(g);
    for(const n of [2,3,4]){const amount=multipleBet(n,l,g.currentBet,g.bb);assert.equal(betError(String(amount),l,g.currentBet),'');}
  }
  assert.equal(multipleBet(3,{canRaise:true,min:100,max:10000},50,50),150);
  assert.equal(multipleBet(2,{canRaise:true,min:650,max:10000},300,50),650);
  assert.equal(multipleBet(4,{canRaise:true,min:100,max:75,allIn:75},50,50),75);
  assert.equal(multipleBet(3,{canRaise:true,min:50,max:10000},0,50),150);
  assert.equal(multipleBet(2,{canRaise:false},50,50),null);
  assert.equal(multipleBet(9,{canRaise:true},50,50),null);
});
test('单手超过 200 条动作仍完整保留，历史与公开视图都包含本手开局',()=>{
  const g=newGame({seats:2,buyIn:100000});
  for(let n=0;n<205;n++){const l=legal(g);act(g,g.turn,'raise',l.min);}
  while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}
  assert.ok(g.handLog.length>200);assert.match(g.handLog[0],/第 1 手/);
  assert.deepEqual(view(g).handLog,g.history[0].actions);assert.equal(g.handActionCount,g.handLog.length);
});
test('全下与正常摊牌向每位房间玩家公开争池手牌，轮询和重新连接一致',async()=>{
  for(const allIn of [true,false]){
    const execute=roomService(memoryRoomStore()),a=await execute({command:'create',name:'A',config:{seats:3}});
    const b=await execute({command:'join',name:'B',code:a.room.code}),c=await execute({command:'join',name:'C',code:a.room.code}),users=[a,b,c];
    const rpc=(u,command,extra={})=>execute({command,code:a.room.code,secret:u.secret,requestId:randomUUID(),...extra});
    for(const u of users)await rpc(u,'ready',{ready:true});let s=await rpc(a,'start');
    if(allIn){s=await rpc(a,'action',{version:s.room.version,action:'raise',amount:10000});s=await rpc(b,'action',{version:s.room.version,action:'call'});s=await rpc(c,'action',{version:s.room.version,action:'fold'});
      for(const u of users){const vote=await rpc(u,'poll',{cursor:s.cursor});assert.equal(vote.game.board.length,0);assert.ok(vote.game.players.slice(0,2).every(p=>p.hole.every(c=>c!=='?')));}
      s=await rpc(a,'vote',{runs:2});s=await rpc(b,'vote',{runs:2});
      for(const group of [1,2])for(const street of ['翻牌','转牌','河牌'])assert.ok(s.game.history[0].actions.some(line=>line.includes(`第 ${group} 组 · ${street}`)));
    }else while(s.game.street!=='complete')s=await rpc(users[s.game.turn],'action',{version:s.room.version,action:s.game.legal?.check?'check':(s.game.players[s.game.turn].bet===s.game.currentBet?'check':'call')});
    for(const [viewer,u] of users.entries())for(const command of ['poll','reconnect']){
      const final=await rpc(u,command);assert.equal(final.game.street,'complete');assert.ok(final.game.players.slice(0,allIn?2:3).every(p=>p.hole.every(c=>c!=='?')));
      if(allIn&&viewer!==2)assert.deepEqual(final.game.players[2].hole,['?','?']);
    }
  }
});
