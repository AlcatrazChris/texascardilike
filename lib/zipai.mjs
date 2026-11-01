import {randomInt,randomUUID} from 'node:crypto';

// All cards have a physical ID. Strategy receives a redacted view, never this deck.
export const typeOf=card=>Math.floor(card/4);
export const glyph=type=>[...'一二三四五六七八九十',...'壹贰叁肆伍陆柒捌玖拾'][type];
const observers=new WeakMap();
const kinds={chi:'吃',peng:'碰',sao:'扫',guosao:'过扫',kan:'坎',kai:'开舵',chuan:'扫穿',pair:'对'};
const next=seat=>(seat+1)%3;
const countTypes=cards=>{const counts=Array(20).fill(0);for(const c of cards)counts[typeOf(c)]++;return counts;};
const same=(cards,t)=>cards.filter(c=>typeOf(c)===t);
const patterns=[];
for(let base=0;base<=10;base+=10){for(let n=0;n<8;n++)patterns.push([base+n,base+n+1,base+n+2]);patterns.push([base+1,base+6,base+9]);}
for(let n=0;n<10;n++)patterns.push([n,n,n+10],[n,n+10,n+10]);
export function config(input={}){
  const integer=(key,value,min,max)=>{const n=Number(input[key]??value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${key} 设置无效`);return n;};
  const bool=(key,value)=>{if(input[key]===undefined)return value;if(typeof input[key]!=='boolean')throw new Error(`${key} 设置无效`);return input[key];};
  const minHu=integer('minHu',15,10,30);if(minHu%5)throw new Error('起胡数请选择 10、15、20、25 或 30');
  const wakeMode=input.wakeMode??'neighbors';if(!['center','neighbors','all'].includes(wakeMode))throw new Error('翻醒方式无效');
  return {game:'zipai',name:String(input.name||'桂林字牌').replace(/[\u0000-\u001f]/g,'').trim().slice(0,24)||'桂林字牌',seats:3,mode:'points',buyIn:1,minHu,wakeMode,base:integer('base',1,1,1000),rounds:integer('rounds',10,1,100),allowDiscardHu:bool('allowDiscardHu',true),allowPassedHu:bool('allowPassedHu',false),mustHu:bool('mustHu',false),special:bool('special',true),repeatWake:bool('repeatWake',true),aiDifficulty:['easy','normal','hard'].includes(input.aiDifficulty)?input.aiDifficulty:'normal'};
}
export function shuffledDeck(){const cards=Array.from({length:80},(_,i)=>i);for(let i=79;i>0;i--){const j=randomInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
export function meldHu(kind,types){
  const big=types[0]>=10;
  if(kind==='chuan')return big?12:9;
  if(kind==='kai')return big?9:6;
  if(['kan','sao','guosao'].includes(kind))return big?6:3;
  if(kind==='peng')return big?3:1;
  if(kind==='chi'){const s=types.slice().sort((a,b)=>a-b);if(s.every(t=>(t>=10)===big)&&(['0,1,2','1,6,9'].includes(s.map(t=>t%10).join(','))))return big?6:3;}
  return 0;
}
const scoreGroup=(kind,cards)=>({kind,cards,hu:meldHu(kind,cards.map(typeOf))});
function emit(g,type,text,extra={}){g.handLog.push(text);g.log.push(text);g.log=g.log.slice(-100);observers.get(g)?.(g,{type,text,...extra});}
export function observeGame(g,observer){if(observer)observers.set(g,observer);}

// Exact maximum-hu decomposition. Original triples are locked; a pair is required
// after a four-card meld. Memoization is local to this evaluation (no private cache).
export function decompose(cards,melds=[],{incoming=null}={}){
  const counts=countTypes(cards),fixed=[],incomingType=incoming===null?-1:typeOf(incoming);
  for(let t=0;t<20;t++)if(counts[t]>=3&&!(t===incomingType&&counts[t]===3)){
    if(counts[t]!==3)return null;
    counts[t]-=3;fixed.push({kind:'kan',types:[t,t,t],hu:meldHu('kan',[t])});
  }
  const needPair=melds.some(m=>m.cards.length===4),remaining=7-melds.length-fixed.length;
  const memo=new Map();
  function solve(c,pair,slots){
    const key=c.join('')+':'+Number(pair)+':'+slots;if(memo.has(key))return memo.get(key);
    const t=c.findIndex(n=>n>0);if(t<0)return slots===0&&!pair?{hu:0,groups:[]}:null;
    if(slots<=0)return null;
    let best=null;
    const use=(types,kind,afterPair)=>{const copy=c.slice();for(const v of types)if(--copy[v]<0)return;const tail=solve(copy,afterPair,slots-1);if(!tail)return;const hu=meldHu(kind,types)+tail.hu;if(!best||hu>best.hu)best={hu,groups:[{kind,types,hu:meldHu(kind,types)},...tail.groups]};};
    if(c[t]>=3)use([t,t,t],'kan',pair);
    if(pair&&c[t]>=2)use([t,t],'pair',false);
    for(const p of patterns)if(p.includes(t))use(p,'chi',pair);
    memo.set(key,best);return best;
  }
  const found=solve(counts,needPair,remaining);if(!found)return null;
  const available=cards.slice(),groups=[...fixed,...found.groups].map(m=>({...m,cards:m.types.map(t=>available.splice(available.findIndex(c=>typeOf(c)===t),1)[0])}));
  return {hu:groups.reduce((s,m)=>s+m.hu,0)+melds.reduce((s,m)=>s+m.hu,0),groups:[...melds,...groups]};
}
function winning(g,seat,card=null){
  const p=g.players[seat],t=card===null?(g.current?.claimant===seat?typeOf(g.current.card):-1):typeOf(card);
  if(t>=0&&!g.config.allowPassedHu&&(p.passedHu.includes(t)||p.passedPeng.includes(t)||p.passedEat.includes(t)))return null;
  const cards=card===null?p.hole:[...p.hole,card],result=decompose(cards,p.melds,{incoming:card});
  return result&&result.hu>=g.config.minHu?result:null;
}
function take(p,cards){for(const card of cards){const at=p.hole.indexOf(card);if(at<0)throw new Error('手牌已更新');p.hole.splice(at,1);}}
function chiOptions(p,card){
  const target=typeOf(card),counts=countTypes(p.hole),options=[],seen=new Set();if(counts[target]>=3||p.passedEat.includes(target))return [];
  function materialize(groups){const pool=p.hole.slice(),chosen=[];for(const types of groups)chosen.push(types.map(t=>pool.splice(pool.findIndex(c=>typeOf(c)===t),1)[0]));return chosen;}
  function bi(c,groups){
    if(options.length>=96)return;
    if(!c[target]){const signature=groups.map(p=>p.join(',')).join('/');if(!seen.has(signature)){seen.add(signature);options.push(materialize(groups));}return;}
    for(const pattern of patterns){if(!pattern.includes(target))continue;const copy=c.slice();let valid=true;for(const t of pattern)if(c[t]>=3||--copy[t]<0){valid=false;break;}if(valid)bi(copy,[...groups,pattern]);}
  }
  for(const pattern of patterns){
    if(!pattern.includes(target))continue;const needed=pattern.slice();needed.splice(needed.indexOf(target),1);const copy=counts.slice();let valid=true;
    for(const t of needed)if(counts[t]>=3||--copy[t]<0){valid=false;break;}
    if(!valid)continue;const before=options.length;bi(copy,[needed]);
    for(let i=before;i<options.length;i++)options[i][0]=[card,...options[i][0]];
  }
  return options;
}
function pushMeld(p,kind,cards){const m=scoreGroup(kind,cards);m.concealed=['sao','guosao','chuan'].includes(kind);p.melds.push(m);return m;}
function heavyListening(g,p,cards=p.hole,melds=p.melds){
  if(!p.heavyOwed)return false;
  const quads=melds.filter(m=>m.cards.length===4).length,owned=[...cards,...melds.flatMap(m=>m.cards)],missing=21+Math.max(0,quads-1)-owned.length;
  if(missing<1||missing>p.heavyOwed)return false;
  const counts=countTypes(owned);
  function search(hand,left,from=0){if(!left){const result=decompose(hand,melds);return !!result&&result.hu>=g.config.minHu;}
    for(let t=from;t<20;t++){if(counts[t]>=4)continue;const card=Array.from({length:4},(_,i)=>t*4+i).find(c=>!owned.includes(c)&&!hand.includes(c));if(card===undefined)continue;counts[t]++;const found=search([...hand,card],left-1,t);counts[t]--;if(found)return true;}return false;
  }
  return search(cards,missing);
}
function canClaim(g,seat,kind,groups){
  const p=g.players[seat],used=groups.flat(),rest=p.hole.filter(c=>!used.includes(c)),counts=countTypes(rest);
  if(rest.some(c=>counts[typeOf(c)]<3))return true;
  const melds=[...p.melds,...groups.map(cards=>scoreGroup(kind,cards))],result=decompose(rest,melds);
  return !!(result&&result.hu>=g.config.minHu)||heavyListening(g,p,rest,melds);
}
const availableChi=(g,seat,card)=>chiOptions(g.players[seat],card).filter(groups=>canClaim(g,seat,'chi',groups));
function claimed(g,seat,kind,groups){
  const p=g.players[seat],card=g.current.card;
  for(const cards of groups){take(p,cards.filter(c=>c!==card));pushMeld(p,kind,cards);}
  g.current.claimed=true;g.current.claimant=seat;g.queue=[];g.turn=seat;p.action=kinds[kind];g.street='discard';
  emit(g,'meld',`${p.name} · ${kinds[kind]}${glyph(typeOf(card))}`,{playerId:seat,kind});
  if(['chuan','kai'].includes(kind)&&p.melds.filter(m=>m.cards.length===4).length>=2){g.needsDraw=next(seat);g.street='drawing';}
  else if(heavyListening(g,p)){p.heavyOwed--;g.needsDraw=next(seat);g.street='drawing';emit(g,'meld',`${p.name} · 重舵听牌，本次不出牌`,{playerId:seat});}
  const result=winning(g,seat);if(result&&g.config.mustHu)settle(g,seat,result,huDetails(g,seat));
  if(!result&&!p.hole.some(c=>same(p.hole,typeOf(c)).length<3)){g.needsDraw=next(seat);g.street='drawing';}
}
function forced(g,seat,kind,index=-1){
  const p=g.players[seat],card=g.current.card,t=typeOf(card);
  if(index>=0){const old=p.melds.splice(index,1)[0];p.hole.push(...old.cards);}
  claimed(g,seat,kind,[[...same(p.hole,t),card]]);
}
function resultSpecial(g){
  if(!g.config.special)return [];
  const offers=[];
  for(let n=0;n<3;n++){const seat=(g.dealer+n)%3,p=g.players[seat],c=countTypes(p.hole),quads=p.melds.filter(m=>m.cards.length===4).length,triples=c.filter(v=>v===3).length;
    if(quads>=3||triples+quads>=5){const groups=[...p.melds];for(let t=0;t<20;t++){const cards=same(p.hole,t);if(cards.length===3)groups.push(scoreGroup('kan',cards));else groups.push(...cards.map(card=>scoreGroup('single',[card])));}offers.push({seat,special:quads>=3?'三笼':'五坎',hu:groups.reduce((s,m)=>s+m.hu,0),groups});}
  }return offers;
}
export function newGame(input={},observer,participants=[]){
  const c=config(input),g={kind:'zipai',config:c,hand:0,dealer:0,street:'complete',turn:0,players:Array.from({length:3},(_,id)=>({id,name:participants[id]?.name||`AI ${id+1}`,human:!!participants[id]?.human,difficulty:participants[id]?.difficulty||c.aiDifficulty,score:0,stack:1,stats:{hands:0,wins:0,hu:0}})),history:[],log:[],handLog:[],finished:false};observeGame(g,observer);startHand(g);return g;
}
export function startHand(g){
  if(g.finished)throw new Error('本场已结束');if(g.hand&&g.street!=='complete')throw new Error('本局尚未结束');
  if(g.hand)g.dealer=g.result.winner??g.dealer;
  g.hand++;g.dealId=randomUUID();g.street='discard';g.turn=g.dealer;g.deck=shuffledDeck();g.queue=[];g.opening=[];g.current=null;g.needsDraw=null;g.wakes=[];g.wake=null;g.pendingWin=null;g.handLog=[];g.roundReport=null;g.result=null;g.drawCount=0;g.discardCount=0;
  for(const p of g.players){p.hole=[];p.melds=[];p.discards=[];p.passedHu=[];p.passedEat=[];p.passedPeng=[];p.heavyOwed=0;p.action='';p.stats.hands++;}
  for(let n=0;n<20;n++)for(let k=0;k<3;k++)g.players[(g.dealer+k)%3].hole.push(g.deck.pop());
  const last=g.deck.pop();g.players[g.dealer].hole.push(last);g.dangdi=last;
  for(const p of g.players){p.hole.sort((a,b)=>a-b);for(let t=0;t<20;t++)if(same(p.hole,t).length===4){const cards=same(p.hole,t);take(p,cards);pushMeld(p,'chuan',cards);}}
  for(const p of g.players)p.heavyOwed=Math.max(0,p.melds.length-1);
  emit(g,'deal',`第 ${g.hand} 局 · ${g.players[g.dealer].name} 坐庄 · 挡底 ${glyph(typeOf(last))}`);
  g.opening=resultSpecial(g);if(g.opening.length){const special=g.opening[0];g.turn=special.seat;g.street='opening';if(g.config.mustHu)settle(g,special.seat,special,{special:special.special,selfDraw:special.seat===g.dealer});return;}
  const sky=winning(g,g.dealer);if(sky&&g.config.mustHu)settle(g,g.dealer,sky,{special:g.config.special?'天胡':null,selfDraw:true});
}
function prepare(g,card,source,draw){
  g.current={card,source,draw,claimed:false};g.queue=[];const t=typeOf(card),p=g.players[source];
  emit(g,draw?'draw':'discard',`${p.name} · ${draw?'摸出':'打出'} ${glyph(t)}`,{playerId:source,card});
  if(draw){const cards=same(p.hole,t),at=p.melds.findIndex(m=>typeOf(m.cards[0])===t&&['sao','guosao','peng'].includes(m.kind));
    if(cards.length===2||cards.length===3){forced(g,source,cards.length===3?'chuan':p.passedPeng.includes(t)?'guosao':'sao');return;}
    if(at>=0&&p.melds[at].kind!=='peng'){forced(g,source,'chuan',at);return;}
  }
  const order=Array.from({length:3},(_,i)=>(source+(draw?0:1)+i)%3);
  for(const seat of order){if(!draw&&seat===source)continue;if((draw||g.config.allowDiscardHu)&&winning(g,seat,card))g.queue.push({seat,kind:'hu'});}
  if(draw)for(const seat of order){const player=g.players[seat],at=player.melds.findIndex(m=>typeOf(m.cards[0])===t&&['peng','sao','guosao'].includes(m.kind));
    if(at>=0){g.queue.push({seat,kind:'forced',meldKind:'kai',index:at});break;}
    if(same(player.hole,t).length===3){g.queue.push({seat,kind:'forced',meldKind:'kai',index:-1});break;}
  }
  else for(const seat of order)if(seat!==source&&same(g.players[seat].hole,t).length===3){g.queue.push({seat,kind:'forced',meldKind:'kai',index:-1});break;}
  for(const seat of order)if(seat!==source&&same(g.players[seat].hole,t).length===2&&!g.players[seat].passedPeng.includes(t)&&canClaim(g,seat,'peng',[[...same(g.players[seat].hole,t),card]]))g.queue.push({seat,kind:'peng'});
  for(const seat of draw?[source,next(source)]:[next(source)])if(availableChi(g,seat,card).length)g.queue.push({seat,kind:'chi'});
  g.street='respond';
}
function advance(g){
  for(let step=0;step<100&&g.street!=='complete';step++){
    if(g.needsDraw!==null){const seat=g.needsDraw;g.needsDraw=null;if(!g.deck.length){settle(g,null,null);return;}g.drawCount++;prepare(g,g.deck.pop(),seat,true);if(g.street==='discard'||g.street==='complete')return;continue;}
    if(g.street!=='respond')return;
    const offer=g.queue[0];if(offer){g.turn=offer.seat;if(offer.kind==='forced'){forced(g,offer.seat,offer.meldKind,offer.index);if(g.street==='discard')return;continue;}
      if(offer.kind==='hu'&&g.config.mustHu){settle(g,offer.seat,winning(g,offer.seat,g.current.card),huDetails(g,offer.seat));return;}
      return;
    }
    const {card,source}=g.current;g.players[source].discards.push(card);g.current.resolved=true;g.needsDraw=next(source);
  }
}
function huDetails(g,seat){const sky=g.discardCount===0&&g.drawCount===0&&seat===g.dealer,earth=g.discardCount===1&&g.drawCount===0;return {selfDraw:sky||!!(g.current?.draw&&g.current.source===seat),special:g.config.special?(sky?'天胡':earth?'地胡':null):null};}
export function legal(g,seat=g.turn){
  if(g.street==='wake')return g.players[seat]?.human?{discard:[],hu:false,pass:false,options:[],wake:true}:null;
  if(g.street==='complete'||g.finished||seat!==g.turn)return null;
  const p=g.players[seat];
  if(g.street==='opening')return {discard:[],hu:true,pass:!g.config.mustHu,options:[]};
  if(g.street==='discard'){
    const c=countTypes(p.hole),hu=winning(g,seat),discard=p.hole.filter(card=>c[typeOf(card)]<3);return {discard,hu:!!hu,pass:!!hu&&!discard.length&&!g.config.mustHu,options:[]};
  }
  if(g.street!=='respond'||!g.queue[0])return null;
  const offer=g.queue[0],card=g.current.card;
  return {discard:[],hu:offer.kind==='hu',pass:!(offer.kind==='hu'&&g.config.mustHu),options:offer.kind==='peng'?[{id:'peng',kind:'peng',groups:[[...same(p.hole,typeOf(card)),card]]}]:offer.kind==='chi'?availableChi(g,seat,card).map((groups,i)=>({id:`chi:${i}`,kind:'chi',groups})):[]};
}
export function act(g,seat,action,amount){
  if(action==='wake'){flipWake(g,seat);return;}
  const l=legal(g,seat);if(!l)throw new Error('尚未轮到你行动');const p=g.players[seat];
  if(g.street==='opening'){
    if(action==='hu'){const offer=g.opening[0];settle(g,seat,offer,{special:offer.special,selfDraw:seat===g.dealer});return;}
    if(action==='pass'&&l.pass){g.opening.shift();g.turn=g.opening[0]?.seat??g.dealer;g.street=g.opening.length?'opening':'discard';emit(g,'pass',`${p.name} · 放弃起手胡牌`,{playerId:seat});return;}
    throw new Error('请选择胡牌或过');
  }
  if(action==='hu'&&l.hu){settle(g,seat,winning(g,seat,g.street==='respond'?g.current.card:null),huDetails(g,seat));return;}
  if(action==='discard'&&g.street==='discard'){
    if(!Number.isInteger(amount)||!l.discard.includes(amount))throw new Error('请选择可打出的手牌，成坎不能拆开');
    take(p,[amount]);p.passedEat.push(typeOf(amount));p.action=`打 ${glyph(typeOf(amount))}`;g.discardCount++;prepare(g,amount,seat,false);advance(g);return;
  }
  const option=l.options.find(o=>o.id===action);if(option){claimed(g,seat,option.kind,option.groups);advance(g);return;}
  if(action==='pass'&&l.pass&&g.street==='discard'){if(g.current)p.passedHu.push(typeOf(g.current.card));g.needsDraw=next(seat);g.street='drawing';emit(g,'pass',`${p.name} · 放弃胡牌`,{playerId:seat});advance(g);return;}
  if(action==='pass'&&l.pass){const t=typeOf(g.current.card),offer=g.queue.shift();if(offer.kind==='hu')p.passedHu.push(t);if(offer.kind==='peng')p.passedPeng.push(t);if(offer.kind==='chi')p.passedEat.push(t);p.action='过';emit(g,'pass',`${p.name} · 过`,{playerId:seat});advance(g);return;}
  throw new Error('当前不能执行此动作，请按牌桌提示操作');
}
function settle(g,seat,evaluation,details={}){
  g.queue=[];g.needsDraw=null;
  if(seat===null){finish(g,{hand:g.hand,winner:null,draw:true,hu:0,baseUnits:0,selfDraw:false,special:null,wakeUnits:0,units:0,groups:[],wakes:[],delta:[0,0,0],winKind:'draw',winCard:null,discarder:null});return;}
  const p=g.players[seat];if(!evaluation)throw new Error('未满足胡牌条件');
  if(g.street==='respond'){p.hole.push(g.current.card);g.current.claimed=true;}
  const discarder=g.current&&!g.current.draw?g.current.source:null,special=details.special||null,sea=!!(g.config.special&&g.drawCount>0&&!g.deck.length);
  g.pendingWin={hand:g.hand,winner:seat,draw:false,hu:evaluation.hu,baseUnits:Math.max(1,Math.floor(evaluation.hu/5)-1),selfDraw:!!details.selfDraw,special,sea,wakeUnits:sea?2:0,units:0,groups:evaluation.groups,wakes:g.wakes,delta:[0,0,0],discarder,winKind:details.selfDraw?'self-draw':discarder!==null?'discard':g.current?'public-draw':'opening',winCard:g.current?.card??(seat===g.dealer?g.dangdi:null)};
  g.wake={...g.pendingWin,repeat:false};g.street='wake';g.turn=p.human?seat:g.players.find(p=>p.human)?.id??seat;
  emit(g,'hu',`${p.name} · ${details.selfDraw?'自摸':'胡牌'} ${evaluation.hu} 胡${g.deck.length?' · 请点击翻醒':' · 无剩余牌，直接结算'}`,{winner:seat});
  if(!g.deck.length)finishWin(g);
}
// One accepted room action consumes exactly one previously shuffled card. No next
// wake card is ever included in a client view before this action is committed.
export function flipWake(g,seat,{automatic=false}={}){
  if(g.street!=='wake'||!g.pendingWin)throw new Error('当前不在翻醒阶段');
  if(!g.players[seat]||!g.players[seat].human&&!(automatic&&!g.players.some(p=>p.human)))throw new Error('请由房间内的真人玩家翻醒');
  if(!g.deck.length){finishWin(g);return;}
  const p=g.players[g.pendingWin.winner],counts=countTypes([...p.hole,...p.melds.flatMap(m=>m.cards)]),card=g.deck.pop(),t=typeOf(card),base=t>=10?10:0,n=t%10;
  const targets=g.config.wakeMode==='center'?[t]:g.config.wakeMode==='all'?[base+(n+9)%10,t,base+(n+1)%10]:[base+(n+9)%10,base+(n+1)%10],hits=targets.map(type=>({type,count:counts[type]}));
  const units=hits.reduce((s,h)=>s+h.count,0);g.wakes.push({card,hits});g.pendingWin.wakeUnits+=units;
  const repeat=!!(g.config.repeatWake&&hits.some(h=>h.count===4)&&g.deck.length);g.wake={...g.pendingWin,repeat};
  emit(g,'wake',`${g.players[seat].name} · 翻醒 ${glyph(t)} · +${units} 子${repeat?' · 重醒，请继续翻醒':''}`,{playerId:seat,card,units,repeat});
  if(!repeat)finishWin(g);
}
function finishWin(g){
  const result={...g.pendingWin,delta:[0,0,0],wakes:g.wakes.slice()},seat=result.winner;
  result.units=result.baseUnits+(result.selfDraw?1:0)+(result.special?1:0)+result.wakeUnits;
  const pay=result.units*g.config.base,payers=result.discarder!==null?[result.discarder]:[0,1,2].filter(id=>id!==seat);
  for(const id of payers){result.delta[id]-=pay;result.delta[seat]+=pay;}
  g.players[seat].stats.wins++;g.players[seat].stats.hu+=result.hu;g.pendingWin=null;g.wake=null;finish(g,result);
}
function finish(g,result){
  const {winner:seat,delta}=result;
  g.street='complete';g.result=result;g.finished=g.hand>=g.config.rounds;
  for(const p of g.players)p.score+=delta[p.id];
  const record={...result,remainingCards:g.deck.slice(),actions:g.handLog.slice(),players:g.players.map(p=>({id:p.id,name:p.name,dealer:p.id===g.dealer,score:p.score,delta:delta[p.id],hole:p.hole.slice(),melds:p.melds.map(m=>({...m,cards:m.cards.slice()})),discards:p.discards.slice()}))};g.history.unshift(record);g.history=g.history.slice(0,30);g.roundReport=record;
  emit(g,'settle',seat===null?'荒庄 · 庄家继续坐庄':`${g.players[seat].name} · 胡 ${result.hu} 胡 · ${result.units} 子 · +${delta[seat]} 分`,{winner:seat});record.actions=g.handLog.slice();
}
export function view(g,mySeat){
  const revealed=id=>g.street==='complete'||g.street==='wake'&&g.wake?.winner===id;
  return {kind:'zipai',dealId:g.dealId,config:g.config,hand:g.hand,dealer:g.dealer,street:g.street,turn:g.turn,mySeat,remaining:g.deck?.length??g.remaining,dangdi:g.dangdi,current:g.current,wake:g.wake,wakes:g.wakes,finished:g.finished,result:g.result,history:g.history,roundReport:g.roundReport,handLog:g.handLog,log:g.log,legal:legal(g,mySeat),players:g.players.map(p=>({id:p.id,name:p.name,human:p.human,difficulty:p.difficulty,score:p.score,stats:p.stats,action:p.action,hole:p.id===mySeat||revealed(p.id)?p.hole:p.hole.map(()=>'?'),melds:p.melds.map(m=>m.concealed&&p.id!==mySeat&&!revealed(p.id)?{...m,cards:m.cards.map(()=>'?'),hu:null}:m),discards:p.discards}))};
}
function quality(cards){const counts=countTypes(cards);let score=0;for(let t=0;t<20;t++){const n=counts[t];score+=n>=3?9:n===2?4:0;if(n&&t%10<8)score+=Math.min(n,counts[t+1],counts[t+2])*3;}
  for(const base of [0,10])score+=Math.min(counts[base+1],counts[base+6],counts[base+9])*5;
  for(let t=0;t<10;t++)score+=Math.min(counts[t],counts[t+10])*1.6;return score;
}
// Deliberately only accepts the same redacted information a human client sees.
export function botAction(observation,{rng=randomInt}={}){
  const l=observation.legal,p=observation.players[observation.mySeat];if(l.wake)return ['wake'];if(l.hu)return ['hu'];
  if(l.discard.length){const ranked=l.discard.map(card=>({card,score:quality(p.hole.filter(c=>c!==card))+(p.difficulty==='easy'?rng(100)/35:rng(100)/250)})).sort((a,b)=>b.score-a.score);return ['discard',ranked[0].card];}
  if(l.options.length){const candidates=l.options.map(o=>{const consumed=o.groups.flat().filter(c=>p.hole.includes(c)),rest=p.hole.filter(c=>!consumed.includes(c));const value=quality(rest)+o.groups.reduce((s,cards)=>s+meldHu(o.kind,cards.map(typeOf))+3,0);return {o,value};}).sort((a,b)=>b.value-a.value);if(candidates[0].value>=quality(p.hole)-(p.difficulty==='hard'?0:2)||rng(100)<8)return [candidates[0].o.id];}
  return ['pass'];
}
export async function playBotsAsync(g){
  advance(g);
  for(let steps=0;g.street!=='complete';steps++){
    if(g.street==='wake'){if(g.players.some(p=>p.human))return;flipWake(g,g.turn,{automatic:true});continue;}
    if(g.players[g.turn].human)return;
    if(steps>200)throw new Error('字牌动作超出安全范围');const observation=view(g,g.turn),[action,amount]=botAction(observation);act(g,g.turn,action,amount);
  }
}
