import { randomInt } from 'node:crypto';

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
  const actor=g.players[g.turn],opponents=g.players.filter(p=>p.id!==actor.id&&!p.out&&!p.folded);
  const pressure=opponents.map(p=>rangeFactor*(/加注|全下/.test(p.action||'')?.98:p.bet>=g.bb*4?.8:p.total>=g.bb*8?.6:p.bet>g.bb?.4:.08));
  const equity=estimateEquity(actor.hole,g.board,opponents.length,{samples,rng,ranges:pressure});
  const eligiblePot=g.players.reduce((sum,p)=>sum+Math.min(p.total,actor.total+l.call),0),price=l.call/(eligiblePot+l.call||1),position=(actor.id-g.dealer+g.players.length)%g.players.length;
  return {street:g.street,hole:[...actor.hole],board:[...g.board],playerId:actor.id,difficulty:actor.difficulty||g.config.aiDifficulty||'normal',stack:actor.stack,bet:actor.bet,bigBlind:g.bb,pot:l.pot,call:l.call,equity,price,position,opponents:opponents.length,initiative:g.lastAggressor===actor.id,limit:g.config.limit,legal:{...l},publicPlayers:g.players.map(p=>({id:p.id,stack:p.stack,bet:p.bet,folded:p.folded,out:p.out})),recent:g.log.slice(-12).filter(line=>!line.startsWith('第 '))};
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
export function candidateActions(context){
  const l=context.legal,options=[{action:l.check?'check':'call',amount:0}];
  if(!l.check)options.unshift({action:'fold',amount:0});
  if(l.canRaise){
    const targets=[l.min,...[.33,.65,1].map(f=>context.bet+l.call+Math.floor((l.pot+l.call)*f))];
    if(context.street==='preflop'){
      const current=context.bet+l.call,limpers=context.publicPlayers.filter(p=>p.id!==context.playerId&&!p.folded&&!p.out&&p.bet===context.bigBlind).length;
      targets.push(Math.round(current<=context.bigBlind?context.bigBlind*(2.5+Math.max(0,limpers-1)):current*3));
    }
    if(l.allIn<=l.max && (context.stack<=context.pot*1.5 || context.street==='river'&&context.equity>.96))targets.push(l.allIn);
    for(const raw of targets){const amount=Math.min(l.max,Math.max(Math.min(l.min,l.max),raw));if(amount>context.bet+l.call&&(amount>=l.min||amount===l.allIn)&&!options.some(o=>o.amount===amount&&o.action==='raise'))options.push({action:'raise',amount});}
  }
  return options;
}
export function localDecision(g,l,options={}){
  const level=DIFFICULTIES[g.players[g.turn]?.difficulty||g.config.aiDifficulty]||DIFFICULTIES.normal;
  const rng=options.rng||randomInt,c=decisionContext(g,l,{...level,...options,rng}),choices=candidateActions(c),roll=rng(10000)/10000;
  // Bounded personality variation; never consults anyone else's hole cards or the actual deck.
  const style=(c.playerId%3-1)*.015,edge=c.equity-c.price,base=1/(c.opponents+1),cost=l.call/Math.max(g.bb,c.stack+l.call),large=l.call>g.bb*5||cost>.22,uncertainty=Math.sqrt(c.equity*(1-c.equity)/(options.samples||level.samples));
  let action=l.check?['check']:['call'];
  if(!l.check && (edge<(large?level.margin+uncertainty:0)-style || cost>.4&&c.equity<Math.max(.57,c.price+.1)))action=['fold'];
  else{
    const value=c.equity>Math.max(.31,base+.055)-style;
    const late=c.position===0 || c.position>=g.players.length-2;
    const texture=boardFeatures(c),frequency=c.difficulty==='hard'?.58:c.difficulty==='easy'?.26:.42;
    const semiBluff=texture.draw&&c.opponents<=3&&cost<.08&&l.call<=c.pot*.4&&roll<frequency;
    const continuation=l.check&&c.initiative&&c.street==='flop'&&c.opponents<=2&&texture.dry&&c.equity>.22&&roll<frequency+.17;
    const bluff=l.check&&c.opponents<=2&&late&&c.stack>c.pot*2&&roll<.08;
    const valueFrequency=c.equity>.78?Math.min(.98,level.valueFrequency+.04):level.valueFrequency;
    if(l.canRaise && (value&&roll<valueFrequency+style||bluff||semiBluff||continuation)){
      const raises=choices.filter(o=>o.action==='raise');
      if(raises.length){const target=raises[Math.min(raises.length-1,c.equity>.78?raises.length-1:c.equity>.6?Math.floor(raises.length*.6):0)];action=['raise',target.amount];}
    }else if(!l.check&&edge<level.margin&&l.call>g.bb*3&&roll>.25)action=['fold'];
  }
  if(c.street==='preflop'){
    const quality=holdingQuality(c.hole),late=c.position===0||c.position>=g.players.length-2,n=g.players.length;
    const threshold=n<=3?.29:late?.35:c.position<=2?.43:.59;
    const unopened=g.currentBet<=g.bb,raiseSize=g.currentBet/g.bb;
    const playable=unopened?quality>=threshold:quality>=Math.min(.91,.54+Math.log2(Math.max(2,raiseSize))*.065);
    action=l.check?['check']:['fold'];
    const raises=choices.filter(o=>o.action==='raise');
    // Position ranges open strong hands without requiring heads-up equity in a multiway pot.
    if(playable&&(unopened||quality>.89||cost<.12&&edge>-.04)){
      action=l.check?['check']:['call'];
      if(raises.length&&roll<(quality>.89?.97:unopened?.9:quality>.79?.72:.18)){
        const desired=unopened?g.bb*(2.5+Math.max(0,c.publicPlayers.filter(p=>p.id!==c.playerId&&!p.folded&&!p.out&&p.bet===g.bb).length-1)):g.currentBet*3;
        const target=raises.reduce((best,r)=>Math.abs(r.amount-desired)<Math.abs(best.amount-desired)?r:best);
        action=['raise',target.amount];
      }
    }else if(!l.check&&cost<.035&&edge>.03&&quality>=threshold-.09)action=['call'];
    if(!l.check&&cost>.22&&quality<.89&&(edge<level.margin+uncertainty||quality<.76))action=['fold'];
  }
  return {action,context:c,candidates:choices};
}
