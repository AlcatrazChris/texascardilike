import { deck, compare, evaluate } from './cards.mjs';
import { localDecision } from './ai.mjs';
export { deck, compare, evaluate } from './cards.mjs';

export const DEFAULTS = { name: '周末牌局', limit: 'no-limit', mode: 'cash', seats: 6, smallBlind: 25, bigBlind: 50, buyIn: 10000, ante: 0, anteMode: 'each', rake: 0, rakeCap: 200, levelHands: 10, rounds:10, aiDifficulty:'normal' };
const NAMES = ['你', 'Alex', 'Mika', 'Oliver', 'Sofia', 'Leo', 'Luna', 'Noah', 'Emma'];
export function config(input = {}) {
  const c = Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,input?.[k]??v]));
  for (const k of ['seats', 'smallBlind', 'bigBlind', 'buyIn', 'ante', 'rakeCap', 'levelHands', 'rounds']) {
    if (!Number.isSafeInteger(c[k])) throw new Error('规则参数必须为整数');
  }
  if (c.seats < 2 || c.seats > 9 || c.smallBlind < 1 || c.bigBlind < c.smallBlind || c.bigBlind > 100000 || c.buyIn < c.bigBlind * 2 || c.buyIn > 10000000 || c.ante < 0 || c.ante > c.bigBlind || c.rakeCap < 0 || c.rakeCap > 1000000 || c.levelHands < 1 || c.levelHands > 1000) throw new Error('规则参数超出范围');
  if (!['no-limit', 'pot-limit', 'fixed-limit'].includes(c.limit) || !['cash', 'tournament', 'points'].includes(c.mode) || !['each', 'big-blind'].includes(c.anteMode)) throw new Error('不支持的规则类型');
  if (!Number.isFinite(c.rake) || c.rake < 0 || c.rake > 10) throw new Error('抽水范围为 0–10%');
  if(!['easy','normal','hard'].includes(c.aiDifficulty))throw new Error('AI 难度无效');
  if(c.rounds<1||c.rounds>100)throw new Error('积分赛轮数为 1–100');
  c.name = String(c.name).trim().slice(0, 24) || DEFAULTS.name;
  if (c.mode !== 'cash') c.rake = 0;
  return c;
}
const next = (g, from, predicate) => { for (let i=1;i<=g.players.length;i++) { const p=(from+i)%g.players.length; if (predicate(g.players[p])) return p; } return -1; };
const alive = p => !p.out && !p.folded;
const canAct = p => alive(p) && p.stack > 0;
const observers = new WeakMap();
export function observeGame(g, observer) { observers.set(g, observer); return ()=>observers.delete(g); }
function emit(g, event) { observers.get(g)?.(g, event); }
function log(g, text) { g.log.push(text); g.log = g.log.slice(-80);g.handActionCount=(g.handActionCount||0)+1;g.handLog=[...(g.handLog||[]),text]; }
function pay(p, amount, street = true) { const n=Math.min(p.stack, Math.max(0, amount)); p.stack-=n; p.total+=n; if(street) p.bet+=n; return n; }
export function newGame(input, observer, participants) {
  const c=config(input);
  const g={ config:c, multiplayer:!!participants, players:Array.from({length:c.seats},(_,id)=>({id,name:participants?.[id]?.name||NAMES[id],human:participants?!!participants[id]?.human:id===0,sittingOut:!!participants?.[id]?.sittingOut,difficulty:participants?.[id]?.difficulty||c.aiDifficulty,stack:c.buyIn,initial:c.buyIn, borrowed:0,rebuy:0,stats:{hands:0,wins:0,invested:0,raises:0,folds:0}})), hand:0, dealer:c.seats-1, log:[], history:[], totalRake:0 };
  if(observer) observeGame(g,observer);
  startHand(g); return g;
}
export function startHand(g) {
  const c=g.config;
  if (g.hand && g.street!=='complete') throw new Error('本手尚未结束');
  if(g.finished)throw new Error('本场比赛已结束');
  if(c.mode!=='tournament'&&g.players.some(p=>p.human&&!p.sittingOut&&p.stack===0))throw new Error('筹码不足，请先领取筹码再开始下一手');
  if(g.players.filter(p=>!p.sittingOut&&(p.stack>0||!p.human&&c.mode!=='tournament')).length<2)throw new Error('至少需要两位有筹码的玩家');
  for(const p of g.players) {
    p.borrowed??=Math.max(0,p.initial-c.buyIn);
    if (p.stack===0 && !p.human && !p.sittingOut && c.mode !== 'tournament') { p.stack=c.buyIn; p.initial+=c.buyIn; p.borrowed=(p.borrowed||0)+c.buyIn;p.rebuy++; }
    p.stats??={hands:0,wins:0,invested:0,raises:0,folds:0};p.handRaises=0;
    p.out=!!p.sittingOut||p.stack===0; p.folded=p.out; p.bet=0; p.total=0; p.hole=[]; p.action=''; p.award=0;
  }
  if (g.players.filter(p=>!p.out).length<2 || !g.multiplayer&&g.players[0].out) { g.finished=true; return; }
  g.handStartStack=g.players[0].stack;
  g.handStartStacks=g.players.map(p=>p.stack);
  g.hand++;g.handLog=[];g.handActionCount=0;g.revealed=[];g.boards=[];g.runoutVote=null; g.dealer=next(g,g.dealer,p=>!p.out); g.deck=deck(); g.board=[]; g.street='preflop'; g.results=[]; g.pots=[]; g.acted=[]; g.actedAt={}; g.raises=1;
  const level=c.mode==='tournament' ? Math.floor((g.hand-1)/c.levelHands) : 0;
  g.sb=c.smallBlind*Math.pow(2,Math.min(level,16)); g.bb=c.bigBlind*Math.pow(2,Math.min(level,16)); g.lastRaise=g.bb;
  const headsUp=g.players.filter(p=>!p.out).length===2;
  g.small=headsUp?g.dealer:next(g,g.dealer,p=>!p.out); g.big=next(g,g.small,p=>!p.out);
  for(let round=0;round<2;round++) for(let i=1;i<=g.players.length;i++) { const p=g.players[(g.dealer+i)%g.players.length]; if(!p.out) p.hole.push(g.deck.pop()); }
  g.currentBet=0; g.turn=-1; g.lastAggressor=-1;
  log(g,`第 ${g.hand} 手 · 盲注 ${g.sb}/${g.bb}`);
  emit(g,{type:'deal',text:`第 ${g.hand} 手开始 · 发放手牌`});
  const forced=(p,amount,action,street)=>{const paid=pay(p,amount,street);if(paid){p.action=action;log(g,`${p.name} · ${action} ${paid}`);emit(g,{type:'bet',playerId:p.id,action,amount:paid,text:`${p.name} · ${action} ${paid}`});}};
  for(const p of g.players) if(!p.out && c.anteMode==='each') forced(p,c.ante,'前注',false);
  if(c.anteMode==='big-blind') forced(g.players[g.big],c.ante,'大盲前注',false);
  forced(g.players[g.small],g.sb,'小盲',true);
  forced(g.players[g.big],g.bb,'大盲',true);
  g.currentBet=g.bb; g.turn=next(g,g.big,canAct);
  advance(g);
}
export function legal(g, id=g.turn) {
  const p=g.players[id];
  if(g.street==='complete' || g.street==='runout-vote' || g.finished || id!==g.turn || !p || !canAct(p)) return null;
  const call=Math.max(0,g.currentBet-p.bet), pot=g.players.reduce((s,p)=>s+p.total,0);
  const unit=g.config.limit==='fixed-limit' && ['turn','river'].includes(g.street)?g.bb*2:g.bb;
  const fixed=g.config.limit==='fixed-limit';
  const min=fixed?(g.currentBet<unit/2?unit:g.currentBet+unit):(g.currentBet===0?unit:g.currentBet+g.lastRaise);
  let max=p.bet+p.stack;
  if(g.config.limit==='pot-limit') max=Math.min(max, g.currentBet+pot+call);
  if(g.config.limit==='fixed-limit') max=Math.min(max,min);
  const others=g.players.some(x=>x.id!==id && canAct(x));
  const reopened=!(id in g.actedAt) || g.currentBet-g.actedAt[id]>=(fixed?unit/2:g.lastRaise);
  const cap=g.config.limit!=='fixed-limit' || g.raises<4 || g.players.filter(alive).length===2;
  return { call:Math.min(call,p.stack), check:call===0, min, max, canRaise:others && reopened && cap && max>g.currentBet, allIn:p.bet+p.stack, pot };
}
export function act(g,id,type,amount) {
  const l=legal(g,id),p=g.players[id]; if(!l) throw new Error('当前不能行动');
  const before=p.stack;
  if(type==='fold') { p.folded=true; p.action='弃牌'; }
  else if(type==='check') { if(!l.check) throw new Error('需要跟注，不能过牌'); p.action='过牌'; }
  else if(type==='call') { const n=pay(p,l.call); p.action=p.stack===0?'全下':`跟注 ${n}`; }
  else if(type==='raise') {
    if(!l.canRaise || !Number.isSafeInteger(amount) || amount>l.max || amount<=g.currentBet || (amount<l.min && amount!==l.allIn)) throw new Error('加注金额不符合当前规则');
    const delta=amount-g.currentBet;
    pay(p,amount-p.bet);
    const fixed=g.config.limit==='fixed-limit', unit=fixed && ['turn','river'].includes(g.street)?g.bb*2:g.bb;
    if(delta>=(fixed?unit/2:g.lastRaise)) { g.lastRaise=fixed?unit:delta; g.acted=[]; g.actedAt={}; g.raises++; }
    g.currentBet=amount; g.lastAggressor=id;p.handRaises=(p.handRaises||0)+1; p.action=p.stack===0?'全下':`加注至 ${amount}`;
  } else throw new Error('未知操作');
  if(!g.acted.includes(id)) g.acted.push(id); g.actedAt[id]=g.currentBet;
  const paid=before-p.stack;
  const message=`${p.name} · ${p.action}${p.action==='全下'?` ${paid}`:''}`;
  log(g,message);
  emit(g,{type:paid>0?'bet':'action',playerId:id,action:p.action,amount:paid,text:message});
  g.turn=next(g,id,canAct); advance(g);
}
function burnAndDeal(g, count) { g.deck.pop(); for(let i=0;i<count;i++) g.board.push(g.deck.pop()); }
function revealHands(g){
  const ids=g.players.filter(alive).map(p=>p.id);if(ids.length<2||ids.every(id=>g.revealed?.includes(id)))return;
  g.revealed=ids;const text=`摊牌 · ${ids.map(id=>g.players[id].name).join('、')} 亮出手牌`;
  log(g,text);emit(g,{type:'reveal',players:ids,text});
}
function advance(g) {
  if(g.players.filter(alive).length===1) { settle(g); return; }
  const active=g.players.filter(canAct);
  const owes=active.some(p=>p.bet<g.currentBet);
  if(active.length<=1 && !owes) {
    revealHands(g);
    if(g.board.length<5&&g.players.some(p=>alive(p)&&p.human)){
      const eligible=g.players.filter(alive).map(p=>p.id),votes=Object.fromEntries(g.players.filter(p=>alive(p)&&!p.human).map(p=>[p.id,2]));
      g.runoutVote={eligible,votes,deadline:Date.now()+20000,resolved:false};g.street='runout-vote';g.turn=-1;
      log(g,'全下投票 · 发两次须全员一致；未达成一致或超时，默认发一次');emit(g,{type:'vote',text:'下注已锁定 · 请选择发一次或两次，全员同意才发两次'});return;
    }
    finishRunout(g,1);return;
  }
  if(active.every(p=>g.acted.includes(p.id) && p.bet>=g.currentBet)) {
    if(g.street==='river') { settle(g); return; }
    g.street={preflop:'flop',flop:'turn',turn:'river'}[g.street];
    burnAndDeal(g,g.street==='flop'?3:1);
    g.players.forEach(p=>{p.bet=0; if(canAct(p))p.action='';}); g.currentBet=0; g.lastRaise=g.bb; g.acted=[]; g.actedAt={}; g.raises=0;
    g.turn=next(g,g.dealer,canAct); log(g,`${{flop:'翻牌',turn:'转牌',river:'河牌'}[g.street]} · ${g.board.join(' ')}`);
    emit(g,{type:'street',text:`${{flop:'翻牌',turn:'转牌',river:'河牌'}[g.street]} · 进入新一轮下注`});
  }
  if(g.turn<0) { settle(g); }
}
export function borrowChips(g,id,amount){
  const p=g.players[id];if(!p||g.street!=='complete'||g.finished||g.config.mode==='tournament'||p.stack!==0||p.sittingOut)throw new Error('仅可在本手结束、筹码归零后领取');
  if(!Number.isSafeInteger(amount)||amount<1||amount>g.config.buyIn)throw new Error(`领取金额为 1–${g.config.buyIn} 的整数`);
  p.borrowed??=Math.max(0,p.initial-g.config.buyIn);p.stack=amount;p.initial+=amount;p.borrowed+=amount;p.rebuy=(p.rebuy||0)+1;p.out=false;
  log(g,`${p.name} · 领取筹码 ${amount}，累计借入 ${p.borrowed}`);emit(g,{type:'loan',playerId:id,amount,text:`${p.name} · 领取 ${amount} 筹码`});
}
export function voteRunout(g,id,runs,now=Date.now()){
  const v=g.runoutVote;if(g.street!=='runout-vote'||!v||v.resolved)throw new Error('当前没有发牌投票');
  if(now>=v.deadline){finishRunout(g,1);return;}
  if(!v.eligible.includes(id)||![1,2].includes(runs))throw new Error('投票无效');
  if(id in v.votes)throw new Error('你已经投票');v.votes[id]=runs;
  log(g,`${g.players[id].name} · 选择发 ${runs} 次`);emit(g,{type:'vote',playerId:id,text:`${g.players[id].name} · 选择发 ${runs} 次`});
  if(runs===1||v.eligible.every(seat=>v.votes[seat]===2))finishRunout(g,runs===1?1:2);
}
export function expireRunout(g,now=Date.now()){
  if(g.street==='runout-vote'&&g.runoutVote&&!g.runoutVote.resolved&&now>=g.runoutVote.deadline){finishRunout(g,1);return true;}return false;
}
function finishRunout(g,runs){
  revealHands(g);
  if(g.runoutVote){g.runoutVote.resolved=true;g.runoutVote.runs=runs;}
  const prefix=[...g.board];g.boards=[];
  for(let run=0;run<runs;run++){
    g.board=[...prefix];
    while(g.board.length<5){burnAndDeal(g,g.board.length===0?3:1);g.street=({3:'flop',4:'turn',5:'river'})[g.board.length];log(g,`${runs===2?`第 ${run+1} 组 · `:''}${{flop:'翻牌',turn:'转牌',river:'河牌'}[g.street]} · ${g.board.join(' ')}`);emit(g,{type:'street',text:`${runs===2?`第 ${run+1} 组 · `:''}${{flop:'翻牌',turn:'转牌',river:'河牌'}[g.street]} · 公共牌已发出`});}
    g.boards.push([...g.board]);
  }
  g.board=g.boards[0];settle(g);
}
export function settle(g) {
  revealHands(g);
  // Return the unmatched top contribution before making pots, including folded chips.
  const sorted=[...g.players].sort((a,b)=>b.total-a.total);
  if(sorted[0].total>sorted[1].total) { const refund=sorted[0].total-sorted[1].total; sorted[0].stack+=refund; sorted[0].total-=refund; sorted[0].bet=Math.max(0,sorted[0].bet-refund);const text=`${sorted[0].name} · 退回未跟注筹码 ${refund}`;log(g,text);emit(g,{type:'refund',playerId:sorted[0].id,amount:refund,text}); }
  const contenders=g.players.filter(alive);
  const boards=g.boards?.length?g.boards:[g.board];
  const ranksByRun=boards.map(board=>Object.fromEntries(contenders.map(p=>[p.id, contenders.length>1?evaluate([...p.hole,...board]):{rank:[0],name:'其他玩家弃牌',cards:[]} ])));
  const ranks=ranksByRun[0];
  const levels=[...new Set(g.players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);
  let previous=0, rakeRemaining=g.board.length>=3?Math.min(g.config.rakeCap, Math.floor(g.players.reduce((s,p)=>s+p.total,0)*g.config.rake/100)):0;
  const rake=rakeRemaining; g.pots=[];
  for(const level of levels) {
    const contributing=g.players.filter(p=>p.total>=level); let amount=(level-previous)*contributing.length; previous=level;
    const eligible=contributing.filter(alive);
    if(!eligible.length) throw new Error('底池没有有效玩家');
    const fee=Math.min(rakeRemaining,amount); amount-=fee; rakeRemaining-=fee;
    for(let run=0;run<boards.length;run++){
      const runRanks=ranksByRun[run],portion=Math.floor(amount/boards.length)+(run<amount%boards.length?1:0);
      let best=[-1];for(const p of eligible)if(compare(runRanks[p.id].rank,best)>0)best=runRanks[p.id].rank;
      const winners=eligible.filter(p=>compare(runRanks[p.id].rank,best)===0).sort((a,b)=>((a.id-g.dealer-1+g.players.length)%g.players.length)-((b.id-g.dealer-1+g.players.length)%g.players.length));
      const share=Math.floor(portion/winners.length);let extra=portion%winners.length;
      for(const p of winners){const n=share+(extra-->0?1:0);p.stack+=n;p.award=(p.award||0)+n;}
      g.pots.push({amount:portion,run:run+1,winners:winners.map(p=>p.id)});
    }
  }
  g.totalRake+=rake; g.street='complete'; g.turn=-1;
  if(g.config.mode==='tournament' && (!g.multiplayer&&g.players[0].stack===0 || g.players.filter(p=>p.stack>0).length<2)) g.finished=true;
  if(g.config.mode==='points'&&g.hand>=(g.config.rounds||10)){g.finished=true;g.finishReason='round_limit';}
  g.results=contenders.map(p=>({id:p.id, name:p.name, hand:ranks[p.id].name,runs:ranksByRun.map(r=>r[p.id].name), cards:ranks[p.id].cards, award:p.award||0}));
  const winners=g.players.filter(p=>p.award>0);
  const summary=winners.map(p=>`${p.name} 赢得 ${p.award}`).join('，'); log(g,summary);
  for(const p of g.players)if(!p.out){p.stats??={hands:0,wins:0,invested:0,raises:0,folds:0};p.stats.hands++;p.stats.wins+=p.award>0?1:0;p.stats.invested+=p.total;p.stats.raises+=p.handRaises||0;p.stats.folds+=p.folded?1:0;}
  const privateHands=Object.fromEntries(g.players.filter(p=>p.hole?.length===2).map(p=>[p.id,boards.map(b=>b.length>=3?evaluate([...p.hole,...b]).name:'翻牌前结束')]));
  g.history.unshift({ hand:g.hand, board:[...g.board],boards:boards.map(b=>[...b]), summary, pot:g.pots.reduce((s,p)=>s+p.amount,0), rake, net:g.players[0].stack-g.handStartStack, netByPlayer:g.players.map((p,i)=>p.stack-(g.handStartStacks?.[i]??g.handStartStack)), results:g.results,privateHands,actions:[...(g.handLog||[])],actionCount:g.handActionCount||g.handLog?.length||0,contributions:g.players.map(p=>({id:p.id,name:p.name,amount:p.total,folded:!!p.folded})) });
  g.history=g.history.slice(0,30);
  g.roundReport={hand:g.hand,finished:!!g.finished,ranking:g.players.filter(p=>!p.sittingOut).map(p=>({id:p.id,name:p.name,stack:p.stack,borrowed:p.borrowed||0,net:p.stack-p.initial,stats:{...p.stats}})).sort((a,b)=>b.net-a.net||b.stack-a.stack)};
  emit(g,{type:'settle',text:summary,winners:winners.map(p=>({id:p.id,amount:p.award}))});
}
export function aiAction(g) { return localDecision(g, legal(g)).action; }
export function playBots(g) {
  let steps=0;
  while(g.street!=='complete' && g.street!=='runout-vote' && !(g.players[g.turn]?.human??g.turn===0) && !g.finished) {
    if(++steps>150) throw new Error('对局状态异常');
    const [action,amount]=aiAction(g); act(g,g.turn,action,amount);
  }
  return g;
}
export async function playBotsAsync(g, decide) {
  let steps=0;
  while(g.street!=='complete' && g.street!=='runout-vote' && !(g.players[g.turn]?.human??g.turn===0) && !g.finished){
    if(++steps>150)throw new Error('对局状态异常');
    const l=legal(g),[action,amount]=await decide(g,l);
    act(g,g.turn,action,amount);
  }
  return g;
}
export function view(g,viewerId=0,{historyLimit=30,includeLogs=true}={}) {
  const show=['complete','runout-vote'].includes(g.street) && g.players.filter(alive).length>1;
  return { config:g.config, mySeat:viewerId, hand:g.hand, dealer:g.dealer, small:g.small, big:g.big, sb:g.sb, bb:g.bb, street:g.street, board:g.board, turn:g.turn, finished:!!g.finished, finishReason:g.finishReason, boards:g.boards||[], runoutVote:g.runoutVote||null, roundReport:g.roundReport||null, revealed:g.revealed||[], handLog:includeLogs?(g.handLog||[]):[],handActionCount:g.handActionCount||0, currentBet:g.currentBet, pot:g.street==='complete'?g.pots.reduce((s,p)=>s+p.amount,0):g.players.reduce((s,p)=>s+p.total,0), legal:legal(g,viewerId), results:g.results, pots:g.pots, history:g.history.slice(0,historyLimit).map(({privateHands,...h})=>({...h,myHands:privateHands?.[viewerId]||[],net:h.netByPlayer?.[viewerId]??h.net})), log:includeLogs?g.log:[], totalRake:g.totalRake, players:g.players.map(p=>({...p,hole:p.id===viewerId || !p.folded&&!p.out&&(show||g.revealed?.includes(p.id))?p.hole:p.hole.map(()=>'?')})) };
}
