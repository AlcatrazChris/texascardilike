// Layout is a client preference. It never changes hand ownership or legal moves.
const type=card=>Math.floor(card/4);
const patterns=[];
for(const base of [0,10]){patterns.push({types:[base+1,base+6,base+9],score:14},{types:[base,base+1,base+2],score:14});for(let n=1;n<8;n++)patterns.push({types:[base+n,base+n+1,base+n+2],score:10});}
for(let n=0;n<10;n++)patterns.push({types:[n,n,n+10],score:9},{types:[n,n+10,n+10],score:9});

export function autoArrange(cards){
  const sorted=cards.slice().sort((a,b)=>a-b),counts=Array(20).fill(0),fixed=[];for(const c of sorted)counts[type(c)]++;
  for(let t=0;t<20;t++)if(counts[t]>=3){fixed.push(Array(counts[t]).fill(t));counts[t]=0;}
  const memo=new Map();
  function solve(c){
    const key=c.join('');if(memo.has(key))return memo.get(key);const t=c.findIndex(n=>n);if(t<0)return {score:0,groups:[]};let best=null;
    function use(types,score){const copy=c.slice();for(const v of types)if(--copy[v]<0)return;const tail=solve(copy),value=score+tail.score;if(!best||value>best.score)best={score:value,groups:[types,...tail.groups]};}
    for(const p of patterns)if(p.types.includes(t))use(p.types,p.score);
    if(c[t]>=2)use([t,t],6);
    if(t%10<9&&c[t+1])use([t,t+1],2);
    use([t],-3);memo.set(key,best);return best;
  }
  const available=sorted.slice(),groups=[...fixed,...solve(counts).groups];
  return {columns:groups.map((types,i)=>({id:'c'+i,cards:types.map(t=>available.splice(available.findIndex(c=>type(c)===t),1)[0])})),nextId:groups.length};
}

export function reconcileLayout(layout,cards){
  if(!layout||!Array.isArray(layout.columns))return autoArrange(cards);
  const allowed=new Set(cards),seen=new Set(),ids=new Set(),columns=[];
  for(const column of layout.columns.slice(0,32)){
    if(!column||typeof column.id!=='string'||ids.has(column.id)||!Array.isArray(column.cards))continue;
    ids.add(column.id);const kept=[];for(const c of column.cards){if(allowed.has(c)&&!seen.has(c)&&kept.length<5){kept.push(c);seen.add(c);}}
    columns.push({id:column.id,cards:kept});
  }
  let nextId=Number.isSafeInteger(layout.nextId)?Math.max(0,layout.nextId):0;
  const id=()=>{while(ids.has('c'+nextId))nextId++;const result='c'+nextId++;ids.add(result);return result;};
  // Newly acquired cards get their own column; existing columns, even empty ones,
  // never slide together or absorb a player's arrangement during synchronization.
  for(const c of cards)if(!seen.has(c)){columns.push({id:id(),cards:[c]});seen.add(c);}
  while(ids.has('c'+nextId))nextId++;
  return {columns,nextId};
}

export function moveLayoutCard(layout,card,targetId,index){
  const from=layout.columns.find(c=>c.cards.includes(card)),target=layout.columns.find(c=>c.id===targetId);
  if(!from||targetId!==null&&!target)return {layout,changed:false};
  if(target&&target!==from&&target.cards.length>=5)return {layout,changed:false,full:true};
  const next={columns:layout.columns.map(c=>({id:c.id,cards:c.cards.filter(v=>v!==card)})),nextId:layout.nextId};
  if(targetId===null){const at=Number.isInteger(index)?Math.max(0,Math.min(index,next.columns.length)):next.columns.length;next.columns.splice(at,0,{id:'c'+next.nextId++,cards:[card]});return {layout:next,changed:true};}
  const column=next.columns.find(c=>c.id===targetId),before=from===target?from.cards.indexOf(card):-1;
  let at=Number.isInteger(index)?index:column.cards.length;if(before>=0&&at>before)at--;at=Math.max(0,Math.min(at,column.cards.length));column.cards.splice(at,0,card);
  return {layout:next,changed:JSON.stringify(layout.columns)!==JSON.stringify(next.columns)};
}

export function shouldDiscardGesture({startX,startY,x,y,hand,arena,legal=false,pending=false}){
  return legal&&!pending&&startY-y>=55&&y<hand.top-28&&y>=arena.top+8&&x>=arena.left&&x<=arena.right&&Math.abs(x-startX)<Math.max(200,hand.width*.8);
}

export function actionPause(event,players){
  if(event.type==='hu')return 1800;if(event.type==='settle')return 800;if(event.type==='wake')return 1400;
  const actor=players.find(p=>p.id===event.playerId),ai=actor&&!actor.human;
  if(ai&&['draw','discard','pass','meld'].includes(event.type))return 1050;
  if(event.type==='draw'||event.type==='discard')return 900;
  return event.type==='meld'?650:350;
}
