import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {newGame,act,legal,startHand} from '../lib/poker.mjs';
import {seal} from '../api/game.js';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';
import {packRoom} from '../lib/state-codec.mjs';
process.env.SESSION_SECRET='benchmark-only-session-secret-no-real-player-data';
const size=value=>Buffer.byteLength(JSON.stringify(value));
const g=newGame({seats:9});for(let hand=0;hand<12;hand++){while(g.street!=='complete'){const l=legal(g);act(g,g.turn,l.check?'check':'call');}if(hand<11)startHand(g);}
const timings=[];let token;for(let n=0;n<20;n++){const start=performance.now();token=seal(g);timings.push(performance.now()-start);}
const store=memoryRoomStore(),execute=roomService(store,{decider:()=>async(_g,l)=>[l.check?'check':'call']});
const a=await execute({command:'create',config:{seats:9},name:'Benchmark A'}),b=await execute({command:'join',code:a.room.code,name:'Benchmark B'}),users=[a,b];
const rpc=(u,command,extra={})=>execute({command,code:a.room.code,secret:u.secret,requestId:randomUUID(),...extra});
let state;const started=performance.now();
for(let hand=0;hand<12;hand++){
  for(const u of users)await rpc(u,'ready',{ready:true});state=await rpc(a,hand?'next':'start',{version:state?.room.version});
  while(state.game.street!=='complete'){const seat=state.game.turn;state=await rpc(users[seat],'action',{version:state.room.version,action:state.game.currentBet===state.game.players[seat].bet?'check':'call'});}
}
const room=await store.get(a.room.code),poll=await rpc(b,'poll',{afterEvent:room.eventSeq,compact:true,version:state.room.version});
console.log(JSON.stringify({hands:12,seats:9,soloStateBytes:size(g),soloTokenBytes:token.length,sealMeanMs:+(timings.reduce((a,b)=>a+b)/timings.length).toFixed(3),roomBytes:size(room),packedRoomBytes:Buffer.byteLength(packRoom(room)),eventBytes:size(room.events),unchangedPollBytes:size(poll),roomSimulationMs:+(performance.now()-started).toFixed(1),events:room.events.length},null,2));
