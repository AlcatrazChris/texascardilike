import { randomInt } from 'node:crypto';
import {decisionObservation} from './ai-observation.mjs';

const SUITS='shdc';
export const cardCode=c=>(parseInt(c)-2)*4+SUITS.indexOf(c.at(-1));
function score(category,kickers){let n=category;for(let i=0;i<5;i++)n=n*15+(kickers[i]||0);return n;}
function straight(mask){for(let high=14;high>=6;high--){const needed=31<<(high-4);if((mask&needed)===needed)return high;}return (mask&16444)===16444?5:0;}
// Direct 5–7 card evaluator for simulation. The settlement evaluator remains independent.
export function fastScore(cards){
  const counts=new Uint8Array(15),suits=[[],[],[],[]];let mask=0;
  for(const c of cards){const r=Math.floor(c/4)+2;counts[r]++;suits[c%4].push(r);mask|=1<<r;}
  const ranks=[],pairs=[],trips=[],quads=[];
  for(let r=14;r>=2;r--)if(counts[r]){ranks.push(r);if(counts[r]>=2)pairs.push(r);if(counts[r]>=3)trips.push(r);if(counts[r]===4)quads.push(r);}
  const flush=suits.find(s=>s.length>=5);
  if(flush){const sf=straight(flush.reduce((m,r)=>m|1<<r,0));if(sf)return score(8,[sf]);}
  if(quads.length)return score(7,[quads[0],ranks.find(r=>r!==quads[0])]);
  if(trips.length){const pair=pairs.find(r=>r!==trips[0]);if(pair)return score(6,[trips[0],pair]);}
  if(flush)return score(5,flush.sort((a,b)=>b-a).slice(0,5));
  const st=straight(mask);if(st)return score(4,[st]);
  if(trips.length)return score(3,[trips[0],...ranks.filter(r=>r!==trips[0]).slice(0,2)]);
  if(pairs.length>=2)return score(2,[pairs[0],pairs[1],ranks.find(r=>r!==pairs[0]&&r!==pairs[1])]);
  if(pairs.length)return score(1,[pairs[0],...ranks.filter(r=>r!==pairs[0]).slice(0,3)]);
  return score(0,ranks.slice(0,5));
}
export const DIFFICULTIES={easy:{samples:96,rangeFactor:.35,valueFrequency:.78,margin:.015},normal:{samples:240,rangeFactor:.8,valueFrequency:.91,margin:.035},hard:{samples:480,rangeFactor:1,valueFrequency:.96,margin:.05}};
function rangeWeight(cards,visible,pressure){
  const ranks=cards.map(c=>Math.floor(c/4)+2),pair=ranks[0]===ranks[1],suited=cards[0]%4===cards[1]%4;
  let strength=pair?Math.min(1,.35+ranks[0]/20):Math.max(...ranks)/24+(suited?.09:0)-(Math.abs(ranks[0]-ranks[1])>4?.1:0);
  if(visible.length>=3){const category=Math.floor(fastScore([...cards,...visible])/15**5),boardCategory=visible.length===5?Math.floor(fastScore(visible)/15**5):0;strength=category>boardCategory?[.05,.3,.68,.85,.95,1,1,1,1][category]:.08+(Math.max(...ranks)/14)*.12;const suitCounts=[0,0,0,0];for(const c of [...cards,...visible])suitCounts[c%4]++;if(visible.length<5&&suitCounts.some(n=>n===4))strength=Math.max(strength,.42);}
  return Math.max(.015,(1-pressure)+pressure*strength*strength);
}
export function estimateEquity(hole,board,opponents,{samples=160,rng=randomInt,ranges=[]}={}){
  opponents=Math.max(1,Math.min(8,opponents));
  const known=[...hole,...board].map(cardCode),excluded=new Set(known),remaining=Array.from({length:52},(_,i)=>i).filter(c=>!excluded.has(c));
  const hero=known.slice(0,2),publicCards=known.slice(2),needed=5-board.length+2*opponents;
  let wins=0;
  for(let sample=0;sample<samples;sample++){
    const pool=[...remaining];
    let used=0;const opponentsCards=[];
    for(let opponent=0;opponent<opponents;opponent++){
      let selected;
      for(let attempt=0;attempt<16;attempt++){const first=used+rng(pool.length-used),secondOffset=rng(pool.length-used-1),second=used+secondOffset+(used+secondOffset>=first?1:0);selected=[first,second];const pressure=ranges[opponent]||0;if(!pressure||rng(10000)/10000<rangeWeight([pool[first],pool[second]],publicCards,pressure))break;}
      let [first,second]=selected;const a=pool[first],b=pool[second];[pool[used],pool[first]]=[pool[first],pool[used]];if(second===used)second=first;[pool[used+1],pool[second]]=[pool[second],pool[used+1]];used+=2;opponentsCards.push([a,b]);
    }
    for(let i=0;i<5-board.length;i++){const j=used+i+rng(pool.length-used-i);[pool[used+i],pool[j]]=[pool[j],pool[used+i]];}
    const fullBoard=[...publicCards,...pool.slice(used,used+5-board.length)];
    const own=fastScore([...hero,...fullBoard]);let tied=1,beaten=false;
    for(let opponent=0;opponent<opponents;opponent++){
      const rank=fastScore([...opponentsCards[opponent],...fullBoard]);
      if(rank>own){beaten=true;break;}if(rank===own)tied++;
    }
    if(!beaten)wins+=1/tied;
  }
  return wins/samples;
}
export function decisionContext(g,l,{samples=240,rng=randomInt,rangeFactor=.8}={}){
  g=decisionObservation(g);
  const actor=g.players[g.turn],opponents=g.players.filter(p=>p.id!==actor.id&&!p.out&&!p.folded);
  const pressure=opponents.map(p=>rangeFactor*(/加注|全下/.test(p.action||'')?.98:p.bet>=g.bb*4?.8:p.total>=g.bb*8?.6:p.bet>g.bb?.4:.08));
  const equity=estimateEquity(actor.hole,g.board,opponents.length,{samples,rng,ranges:pressure});
  const eligiblePot=g.players.reduce((sum,p)=>sum+Math.min(p.total,actor.total+l.call),0),price=l.call/(eligiblePot+l.call||1),position=(actor.id-g.dealer+g.players.length)%g.players.length;
  return {street:g.street,hole:[...actor.hole],board:[...g.board],playerId:actor.id,difficulty:actor.difficulty||g.config.aiDifficulty||'normal',stack:actor.stack,bet:actor.bet,bigBlind:g.bb,pot:l.pot,call:l.call,equity,price,position,opponents:opponents.length,initiative:g.lastAggressor===actor.id,actorStreetRaises:actor.streetRaises||0,streetRaises:Math.max(0,(g.raises||0)-(g.street==='preflop'?1:0)),effectiveStack:Math.min(actor.stack,Math.max(0,...opponents.map(p=>p.stack))),limit:g.config.limit,legal:{...l},publicPlayers:g.players.map(p=>({id:p.id,stack:p.stack,bet:p.bet,folded:p.folded,out:p.out})),recent:g.log.slice(-12).filter(line=>!line.startsWith('第 '))};
}
export function holdingQuality(hole){
  const [hi,lo]=hole.map(Number.parseFloat).sort((a,b)=>b-a),suited=hole[0].at(-1)===hole[1].at(-1),gap=hi-lo;
  if(hi===lo)return .42+.55*hi/14;
  return (hi+lo-4)/24*.55+(hi===14?.14:hi===13?.055:0)+(suited?.08:0)+(gap<=1?.07:gap===2?.03:gap>=5?-.06:0);
}
function boardFeatures(c){
  const cards=[...c.hole,...c.board],suits='shdc',ranks=new Set(cards.map(Number.parseFloat));if(ranks.has(14))ranks.add(1);
  const flushDraw=c.board.length<5&&[...suits].some(s=>cards.filter(v=>v.endsWith(s)).length===4&&c.hole.some(v=>v.endsWith(s)));
  let straightDraw=false;
  if(c.board.length<5)for(let high=5;high<=14;high++){const run=Array.from({length:5},(_,i)=>high-i);if(run.filter(r=>ranks.has(r)).length===4&&c.hole.some(v=>run.includes(parseInt(v))||parseInt(v)===14&&run.includes(1)))straightDraw=true;}
  const boardRanks=c.board.map(Number.parseFloat).sort((a,b)=>a-b),connected=boardRanks.some((r,i)=>i>1&&r-boardRanks[i-2]<=4);
  return {draw:flushDraw||straightDraw,dry:![...suits].some(s=>c.board.filter(v=>v.endsWith(s)).length>=2)&&!connected};
}

export function holdingFeatures(c){
  const texture=boardFeatures(c),ranks=c.board.map(Number.parseFloat),own=c.hole.map(Number.parseFloat),counts=new Map();for(const r of ranks)counts.set(r,(counts.get(r)||0)+1);
  const groups=[...counts.values()].sort((a,b)=>b-a),boardCategory=c.board.length===5?Math.floor(fastScore(c.board.map(cardCode))/15**5):groups[0]===3?3:groups[0]===2?1:0;
  const category=c.board.length>=3?Math.floor(fastScore([...c.hole,...c.board].map(cardCode))/15**5):0,pocket=own[0]===own[1],top=Math.max(0,...ranks),improves=category>boardCategory;
  return {...texture,category,boardCategory,improves,strongMade:improves&&category>=3,overpair:pocket&&own[0]>top,underpair:pocket&&own[0]<top,topPair:own.includes(top)&&category>=1,blocker:own.includes(14)||own.includes(13)};
}
function planPostflop(c,l,level,roll){
  const f=holdingFeatures(c),pot=Math.max(c.bigBlind,l.pot+l.call),pressure=l.call/pot,cost=l.call/Math.max(1,c.stack),ownRaises=c.actorStreetRaises||0;
  const strong=f.strongMade&&c.equity>.52,monster=strong&&c.equity>.85,goodPair=(f.overpair||f.topPair||f.category===2&&f.improves)&&c.equity>(c.opponents===1?.6:c.opponents===2?.66:.72);
  const stackOff=monster||strong&&c.equity>.72&&(c.effectiveStack||c.stack)<=pot*1.5||c.opponents===1&&f.overpair&&c.equity>.73&&c.stack<=pot;
  const large=pressure>.23||cost>.18,uncertainty=Math.sqrt(c.equity*(1-c.equity)/level.samples),margin=level.margin+uncertainty*.5+(large?.025:0)+(ownRaises>0&&large&&!strong?.06:0)+(f.underpair&&large?.06:0);
  let passive=l.check?'check':c.equity-c.price>=margin?'call':'fold';
  if(!l.check&&cost>.4&&!stackOff&&c.equity<Math.max(.65,c.price+.12))passive='fold';
  let intent='none',fraction=0;
  if(strong){intent='value';fraction=monster?.9:.7;}
  else if(goodPair&&(!ownRaises||!large)&&c.streetRaises<3){intent='thin-value';fraction=.45;}
  else if(f.draw&&c.opponents<=2&&c.equity>.24&&pressure<.18&&cost<.12&&ownRaises===0&&roll<(c.difficulty==='hard'?.45:c.difficulty==='easy'?.2:.33)){intent='semi-bluff';fraction=.5;}
  else if(l.check&&ownRaises===0&&c.initiative&&c.street==='flop'&&c.opponents<=2&&f.dry&&c.equity>.2&&roll<(c.difficulty==='hard'?.65:c.difficulty==='easy'?.35:.58)*(c.opponents===2?.65:1)){intent='continuation';fraction=.33;}
  else if(l.check&&ownRaises===0&&c.opponents===1&&c.stack>pot*2&&(f.dry||f.blocker)&&roll<(c.difficulty==='hard'?.07:c.difficulty==='easy'?.025:.045)){intent='bluff';fraction=.4;}
  // A prior bet is not a reason to keep raising: a new raise requires fresh value.
  if(ownRaises>0&&!strong&&l.call>0){intent='none';fraction=0;}
  const maxRaise=intent==='none'?0:Math.floor(c.bet+l.call+pot*fraction),desired=maxRaise;
  return {intent,passive,maxRaise,desired,stackOff,strongMade:f.strongMade,madeCategory:f.category,draw:f.draw,pressure:+pressure.toFixed(3),actorStreetRaises:ownRaises};
}
export function candidateActions(c){
  const l=c.legal,plan=c.strategy,options=[{action:l.check?'check':'call',amount:0}];if(!l.check)options.unshift({action:'fold',amount:0});
  if(!l.canRaise||plan?.maxRaise===0)return options;
  const pot=l.pot+l.call,targets=[l.min,...[.33,.5,.75,1].map(f=>c.bet+l.call+Math.floor(pot*f))];
  if(c.street==='preflop'){
    const current=c.bet+l.call,limpers=c.publicPlayers.filter(p=>p.id!==c.playerId&&!p.folded&&!p.out&&p.bet===c.bigBlind).length;targets.push(Math.round(current<=c.bigBlind?c.bigBlind*(2.5+Math.max(0,limpers-1)):current*3));
  }
  if(plan?.stackOff&&l.allIn<=l.max&&(c.stack<=pot*1.5||c.equity>.96))targets.push(l.allIn);
  for(const raw of targets){
    const amount=Math.min(l.max,Math.max(Math.min(l.min,l.max),raw));
    if(plan&&amount>plan.maxRaise&&!(plan.stackOff&&(amount===l.allIn||plan.strongMade&&amount===l.min)))continue;
    if(plan&&!plan.stackOff&&amount===l.allIn)continue;
    if(amount>c.bet+l.call&&(amount>=l.min||amount===l.allIn)&&!options.some(o=>o.action==='raise'&&o.amount===amount))options.push({action:'raise',amount});
  }
  return options;
}
export function localDecision(g,l,options={}){
  g=decisionObservation(g);
  const level=DIFFICULTIES[g.players[g.turn]?.difficulty||g.config.aiDifficulty]||DIFFICULTIES.normal,rng=options.rng||randomInt,c=decisionContext(g,l,{...level,...options,rng}),roll=rng(10000)/10000;
  let action;
  if(c.street==='preflop'){
    const quality=holdingQuality(c.hole),late=c.position===0||c.position>=g.players.length-2,n=g.players.length,threshold=n<=3?.29:late?.35:c.position<=2?.43:.59;
    const unopened=g.currentBet<=g.bb,raiseSize=g.currentBet/g.bb,edge=c.equity-c.price,cost=l.call/Math.max(g.bb,c.stack+l.call),playable=unopened?quality>=threshold:quality>=Math.min(.94,.54+Math.log2(Math.max(2,raiseSize))*.065);
    const limpers=c.publicPlayers.filter(p=>p.id!==c.playerId&&!p.folded&&!p.out&&p.bet===g.bb).length,desired=Math.round(unopened?g.bb*(2.5+Math.max(0,limpers-1)):g.currentBet*3);
    const premium=quality>.94,reraising=playable&&(unopened||quality>.89||cost<.12&&edge>-.04)&&(c.streetRaises<3||premium);
    c.strategy={intent:reraising?'preflop-value':'none',maxRaise:reraising?desired:0,desired,stackOff:premium,passive:l.check?'check':'fold'};
    action=l.check?['check']:['fold'];
    if(playable&&(unopened||quality>.89||cost<.12&&edge>-.04)){
      action=l.check?['check']:['call'];c.strategy.passive=action[0];
      if(reraising&&roll<(quality>.89?.96:unopened?.9:quality>.79?.65:.15))c.strategy.wantsRaise=true;
    }else if(!l.check&&cost<.035&&edge>.03&&quality>=threshold-.09){action=['call'];c.strategy.passive='call';}
    const uncertainty=Math.sqrt(c.equity*(1-c.equity)/(options.samples||level.samples));
    if(!l.check&&cost>.22&&quality<.89&&(edge<level.margin+uncertainty||quality<.76)){action=['fold'];c.strategy.wantsRaise=false;c.strategy.maxRaise=0;}
    if(!l.check&&c.streetRaises>=3&&!premium&&cost>.2){action=['fold'];c.strategy.wantsRaise=false;c.strategy.maxRaise=0;}
  }else{
    c.strategy=planPostflop(c,l,{...level,samples:options.samples||level.samples},roll);action=[c.strategy.passive];
    const frequency=c.strategy.intent==='value'?(c.equity>.85?.95:level.valueFrequency):c.strategy.intent==='thin-value'?.72:1;
    c.strategy.wantsRaise=c.strategy.intent!=='none'&&roll<frequency;
  }
  const choices=candidateActions(c),raises=choices.filter(o=>o.action==='raise');
  if(c.strategy.wantsRaise&&raises.length){const target=raises.reduce((best,r)=>Math.abs(r.amount-c.strategy.desired)<Math.abs(best.amount-c.strategy.desired)?r:best);action=['raise',target.amount];}
  return {action,context:c,candidates:choices};
}
