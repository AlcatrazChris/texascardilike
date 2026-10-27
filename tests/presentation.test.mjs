import test from 'node:test';
import assert from 'node:assert/strict';
import {processGame,unseal} from '../api/game.js';
import {betError} from '../public/betting.js';
process.env.SESSION_SECRET='test-secret-for-river-at-least-32-characters';

test('开局逐个返回发牌、前注、盲注与 AI 动作，快照互不覆盖且不泄露牌堆',()=>{
  const result=processGame({command:'start',config:{seats:6,ante:5}}),frames=result.frames;
  assert.equal(frames[0].event.type,'deal');assert.equal(frames[0].game.pot,0);
  assert.equal(frames.filter(f=>f.event.action==='前注').length,6);
  assert.equal(frames.filter(f=>f.event.action==='小盲').length,1);assert.equal(frames.filter(f=>f.event.action==='大盲').length,1);
  let previous=frames[0].game;
  for(const {event,game}of frames){
    assert.ok(!('deck' in game));assert.ok(!('history' in game));
    for(const p of game.players)if(p.id!==0 && game.street!=='complete')assert.ok(p.hole.every(c=>c==='?'));
    if(event.type==='bet'){const p=game.players[event.playerId],before=previous.players[p.id];assert.equal(before.stack-p.stack,event.amount);assert.ok(event.text.includes(p.name));}
    previous=game;
  }
  assert.equal(result.game.turn,0);assert.ok(!('frames' in unseal(result.token)));
  assert.deepEqual(processGame({command:'resume',token:result.token}).frames,[]);
});
test('玩家操作是首个动作，跟随的 AI 动作不会被最终状态覆盖',()=>{
  const initial=processGame({command:'start',config:{seats:6}});
  const result=processGame({command:'action',token:initial.token,action:'fold'});
  assert.equal(result.frames[0].event.playerId,0);assert.equal(result.frames[0].event.action,'弃牌');
  assert.ok(result.frames.at(-1).event.type==='settle');
  assert.equal(result.game.street,'complete');
});
test('手动下注拒绝空值、小数、负数、超额和不足额，同时允许合法全下',()=>{
  const l={canRaise:true,min:100,max:1000,allIn:1000};
  for(const value of ['',' ','abc','1.5','-10','0','50','99','1001','1e3','0x100'])assert.ok(betError(value,l,50),value);
  assert.equal(betError('100',l,50),'');assert.equal(betError('377',l,50),'');assert.equal(betError('1000',l,50),'');
  assert.equal(betError('75',{...l,max:75,allIn:75},50),'');
  assert.ok(betError('200',{...l,max:175},50).includes('限注'));assert.ok(betError('100',{...l,canRaise:false},50));
});
