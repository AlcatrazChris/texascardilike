import { betError, multipleBet } from './betting.js';
import { RoomClient } from './rooms-client.js';
import {consumeGameResponse} from './game-client.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const ICONS={table:'M3 7h18v10H3z M7 7v10 M17 7v10 M3 12h18',history:'M3 11a9 9 0 1 1 2.5 7 M3 4v7h7 M12 7v5l3 2',chart:'M4 20V4 M4 20h17 M8 16v-4 M13 16V8 M18 16V5',sliders:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',plus:'M12 5v14 M5 12h14',book:'M12 5v15 M12 5C8 2 4 3 3 4v15c3-2 6-2 9 1 3-3 6-3 9-1V4c-3-2-6-2-9 1',menu:'M4 6h16 M4 12h16 M4 18h16','volume-off':'M10 4 5 8H2v8h3l5 4z M16 9l6 6 M22 9l-6 6',volume:'M10 4 5 8H2v8h3l5 4z M15 8a6 6 0 0 1 0 8 M18 4a11 11 0 0 1 0 16','arrow-up':'M12 19V5 M6 11l6-6 6 6','arrow-right':'M4 12h16 M14 6l6 6-6 6',wallet:'M4 6V4h14v4 M3 8h18v12H3z M16 12h5v4h-5z',trend:'M3 17l6-6 4 3 8-10 M15 4h6v6',layers:'m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',x:'M6 6l12 12 M18 6 6 18',info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]||ICONS.info}"/></svg>`;
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
icons();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('zh-CN');
const csvCell=value=>{let text=String(value);if(typeof value==='string'&&/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
const signed=n=>`${n>0?'+':''}${fmt(n)}`;
const netOf=(p,g=game)=>p.stack+(g.street==='complete'?0:p.total)-p.initial;
const LIMITS={'no-limit':'无限注','pot-limit':'底池限注','fixed-limit':'固定限注'};
const MODES={cash:'现金桌',tournament:'锦标赛',points:'积分桌'};
const STREETS={preflop:'翻牌前',flop:'翻牌圈',turn:'转牌圈',river:'河牌圈','runout-vote':'全下投票',complete:'本手结束'};
let game=null,token=null,busy=false,bet=0,sound=false,toastTimer,archives=[];
let mode='solo',roomInfo=null,roomClient,displayedRoom='',displayedVersion=-1,settingsPurpose='solo',lobbySignature='',lastReportKey='',soloPollPending=false,reportTimer;
const mySeat=()=>game?.mySeat??0;
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{toast('浏览器存储不可用，本次牌局仍可继续');}}};
try{archives=JSON.parse(storage.get('river-archives')||'[]');if(!Array.isArray(archives))archives=[];}catch{archives=[];}
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function playSound(){if(!sound)return;try{const C=window.AudioContext||window.webkitAudioContext;const c=new C(),o=c.createOscillator(),v=c.createGain();o.connect(v);v.connect(c.destination);o.frequency.setValueAtTime(540,c.currentTime);o.frequency.exponentialRampToValueAtTime(320,c.currentTime+.12);v.gain.setValueAtTime(.035,c.currentTime);v.gain.exponentialRampToValueAtTime(.001,c.currentTime+.15);o.start();o.stop(c.currentTime+.16);o.onended=()=>c.close();}catch{}}
function card(c,placeholder=false){
  if(placeholder)return '<div class="card placeholder" aria-label="尚未发出的公共牌">♠</div>';
  if(c==='?')return '<div class="card back" aria-label="隐藏手牌"><span>♠</span></div>';
  const rank=parseInt(c),suit=c.at(-1),s={s:'♠',h:'♥',d:'♦',c:'♣'}[suit],r=({11:'J',12:'Q',13:'K',14:'A'})[rank]||rank;
  return `<div class="card ${'hd'.includes(suit)?'red':''}" aria-label="${r}${s}"><span class="card-rank">${r}</span><span class="card-suit">${s}</span><span class="card-suit-big">${s}</span></div>`;
}
$('#board').innerHTML=Array.from({length:5},()=>card('',true)).join('');
function showBetError(message){$('#bet-error-message').textContent=message;$('#bet-input').setAttribute('aria-invalid','true');if(!$('#bet-error-dialog').open)$('#bet-error-dialog').showModal();}
// Count only visible time so switching tabs never silently skips a table action.
async function visibleDelay(duration){let remaining=duration;while(remaining>0){if(document.hidden){await new Promise(resolve=>{const changed=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',changed);resolve();}};document.addEventListener('visibilitychange',changed);});continue;}const start=performance.now();await new Promise(resolve=>setTimeout(resolve,Math.min(80,remaining)));if(!document.hidden)remaining-=performance.now()-start;}}
function renderActionHistory(){
  if(!game)return;
  const record={actions:game.handLog||[],actionCount:game.handActionCount||0},list=$('#action-history-list'),scroll=$('.action-history-scroll');
  const key=JSON.stringify([game.hand,record.actions]);if(list.dataset.key===key)return;
  const follow=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<35;
  list.dataset.key=key;list.innerHTML=recordsList(record);
  $('#action-history-title').textContent='HAND #'+String(game.hand).padStart(3,'0')+' · '+(game.street==='complete'?'本手已结束':'本手行动记录');
  $('#action-history-count').textContent=record.actions.length+' 条';
  if(follow&&$('#action-history').open)scroll.scrollTop=scroll.scrollHeight;
}
$('#action-history').addEventListener('toggle',()=>{if($('#action-history').open)renderActionHistory();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#action-history'))$('#action-history').open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#action-history').open){$('#action-history').open=false;$('#action-history summary').focus({preventScroll:true});}});
function announce(event){const banner=$('#table-announcement');banner.textContent=event.text;banner.dataset.type=event.type;banner.classList.remove('notice-pop');void banner.offsetWidth;banner.classList.add('notice-pop');}
async function flyChips(playerId,amount,reverse=false){
  const seat=$(`[data-player-id="${playerId}"] .player-pill`),pot=$('.pot-pill'),stage=$('.table-stage');if(!seat||!pot)return;
  const bounds=stage.getBoundingClientRect(),s=seat.getBoundingClientRect(),p=pot.getBoundingClientRect();
  const from=reverse?p:s,to=reverse?s:p;
  const fromX=from.left+from.width/2-bounds.left,fromY=from.top+from.height/2-bounds.top,toX=to.left+to.width/2-bounds.left,toY=to.top+to.height/2-bounds.top;
  const flight=document.createElement('div');flight.className='chip-flight';flight.setAttribute('aria-hidden','true');flight.innerHTML=`<span class="flying-chips"><i></i><i></i><i></i></span><strong>${reverse?'+':''}${fmt(amount)}</strong>`;flight.style.left=`${fromX}px`;flight.style.top=`${fromY}px`;stage.append(flight);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation=flight.animate(reduced?[{opacity:0},{opacity:1},{opacity:0}]:[{transform:'translate(-50%,-50%) scale(.8)',opacity:0},{offset:.16,opacity:1},{offset:.8,opacity:1},{transform:`translate(calc(-50% + ${toX-fromX}px),calc(-50% + ${toY-fromY}px)) scale(.85)`,opacity:0}],{duration:380,easing:'ease-in-out',fill:'forwards'});
  const visibility=()=>document.hidden?animation.pause():animation.play();document.addEventListener('visibilitychange',visibility);visibility();
  try{await animation.finished;}finally{document.removeEventListener('visibilitychange',visibility);flight.remove();}
  pot.classList.remove('pot-bump');void pot.offsetWidth;pot.classList.add('pot-bump');
}
async function playback(frames,onFrame,{append=false}={}){
  if(!append)$('#action-feed').replaceChildren();
  for(const frame of frames){
    await visibleDelay(1);
    const previousHand=game?.hand,previousActions=game?.handLog||[];const {history,log,...snapshot}=frame.game;game={history:history?.length?[...history,...(game?.history||[]).filter(h=>h.hand!==history[0].hand)]:game?.history||[],log:game?.log||log||[],...snapshot};game.log=[...game.log,frame.event.text].slice(-80);game.handLog=[...(previousHand===snapshot.hand?previousActions:[]),frame.event.text];render();
    const event=frame.event;announce(event);
    const row=document.createElement('li');row.textContent=event.text;$('#action-feed').append(row);while($('#action-feed').children.length>3)$('#action-feed').firstChild.remove();
    const actor=event.playerId!==undefined?$(`[data-player-id="${event.playerId}"]`):null;actor?.classList.add('performing');
    if(event.type==='reveal')for(const id of event.players||[])$(`[data-player-id="${id}"]`)?.classList.add('revealing');
    playSound();
    const tasks=[visibleDelay(event.type==='bet'?480:event.type==='settle'?850:event.type==='reveal'?1100:event.type==='street'?500:320)];
    if(event.type==='bet'||event.type==='refund')tasks.push(flyChips(event.playerId,event.amount,event.type==='refund'));
    if(event.type==='settle')for(const winner of event.winners||[])tasks.push(flyChips(winner.id,winner.amount,true));
    await Promise.all(tasks);if(onFrame&&frame.id)onFrame(frame.id);
  }
}
async function request(command,extra={}){
  if(mode==='room')return roomCommand(command,extra);
  if(busy)return false;
  closeSidebar();
  const previousGame=game;let verifiedGame;busy=true;renderActions();$('#action-feed').replaceChildren();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({command,token,...extra}),signal:controller.signal});
    const data=await consumeGameResponse(response,{onFrame:frame=>playback([frame],undefined,{append:true}),onResult:data=>{clearTimeout(timeout);verifiedGame=data.game;token=data.token;storage.set('river-token',token);}});
    game=data.game;render();maybeRoundReport();
    if(!data.frameCount)announce({type:'ready',text:game.street==='complete'?'本手已结束':game.street==='runout-vote'?'等待全下发牌投票':'牌局已恢复 · 轮到你行动'});
    return true;
  }catch(error){game=verifiedGame||previousGame;if(game)render();const message=error.name==='AbortError'?'请求超时，请重试':error.message;if(command==='action')showBetError(message);else toast(message);if($('#settings-dialog').open)$('#form-error').textContent=message;return false;}
  finally{clearTimeout(timeout);busy=false;renderActions();}
}
const AVATARS=[['#dbe4bd','#708f67'],['#dce5e8','#7d9c9b'],['#e7d5c3','#b69c81'],['#d8d9e9','#8e8dad'],['#e6cfce','#b99293'],['#d7e0c8','#8c9e73'],['#d7e3eb','#7a9ba7'],['#ddd8cc','#a49b83'],['#e6d8e7','#a48ba5']];
function render(){
  if(!game)return;
  const g=game,c=g.config;
  $('#room-name').innerHTML=`${escape(c.name)} <span class="heading-suit">♠</span>`;
  $('#room-subtitle').innerHTML=`${LIMITS[c.limit]}德州扑克 <span>·</span> 盲注 ${fmt(g.sb)} / ${fmt(g.bb)} <span>·</span> ${g.players.filter(p=>!p.sittingOut).length} 人桌${c.mode==='points'?` · 第 ${g.hand}/${c.rounds||10} 轮`:''}`;
  $('#mode-badge').textContent=MODES[c.mode];
  $('#hand-number').textContent=`HAND #${String(g.hand).padStart(3,'0')}`;$('#street-label').textContent=STREETS[g.street];$('#pot').textContent=fmt(g.pot);
  if($('#board').dataset.cards!==g.board.join(',')){$('#board').innerHTML=Array.from({length:5},(_,i)=>card(g.board[i],!g.board[i])).join('');$('#board').dataset.cards=g.board.join(',');}
  const me=g.players[mySeat()], net=netOf(me,g);

  const winner=g.results?.filter(r=>r.award>0);
  $('#board-caption').textContent=g.street==='complete'?(winner?.map(r=>`${r.name} · ${r.hand}`).join(' / ')||'本手结束'):`${STREETS[g.street]}${c.ante?` · 前注 ${fmt(c.ante)}`:' · 读懂局势，打好每一手'}`;
  const seated=g.players.filter(p=>!p.sittingOut),seatCount=seated.length,myIndex=Math.max(0,seated.findIndex(p=>p.id===mySeat()));$('.table-stage').dataset.seats=seatCount;
  $('#seats').innerHTML=seated.map((p,i)=>{
    const relative=(i-myIndex+seatCount)%seatCount,theta=Math.PI/2+relative*2*Math.PI/seatCount,x=50+43*Math.cos(theta),y=relative===0?94:48+36*Math.sin(theta),self=p.id===mySeat(),active=p.id===g.turn;
    const [a,b]=AVATARS[i], isWinner=p.award>0;
    let action=g.street==='complete'&&isWinner?`+${fmt(p.award)} · 赢得底池`:p.out?'已淘汰':self&&active?'':p.action|| (active?'正在思考':'');
    const forced=['小盲','大盲','前注','大盲前注'].includes(action);if(forced&&p.bet>0)action+=` ${fmt(p.bet)}`;
    return `<div data-player-id="${p.id}" data-side="${Math.abs(x-50)<1?'center':x<50?'left':'right'}" data-middle="${!self&&y>=44&&y<62}" data-upper="${!self&&y<20}" class="seat ${self?'self':''} ${active?'active':''} ${p.folded?'folded':''} ${p.out?'out':''} ${isWinner?'winner':''} ${seatCount>6?'dense':''}" style="left:var(--seat-x,clamp(var(--seat-safe,0px),${x}%,calc(100% - var(--seat-safe,0px))));top:var(--seat-y,${y}%)"><div class="hole-cards">${p.hole.map(v=>card(v)).join('')}</div><div class="player-pill"><span class="avatar" style="background:linear-gradient(140deg,${a},${b});color:white">${self?'Y':p.name[0]}</span><div><div class="player-name"><span class="player-nickname" title="${escape(p.name)}">${escape(p.name)}</span>${self?'<span class="player-you">YOU</span>':p.human?'<span class="human-badge">玩家</span>':'<span class="ai-badge">AI</span>'}</div><div class="player-stack">${fmt(p.stack)}<span>筹码</span></div>${p.borrowed?`<div class="borrowed" aria-label="累计借入 ${p.borrowed} 筹码">−${fmt(p.borrowed)}</div>`:''}</div>${p.id===g.dealer?'<span class="dealer-badge" title="庄家">D</span>':''}${p.id===g.small?'<span class="blind-badge" title="小盲">SB</span>':p.id===g.big?'<span class="blind-badge" title="大盲">BB</span>':''}</div>${action?`<div class="seat-action">${escape(action)}</div>`:''}</div>`;
  }).join('');
  const second=$('#board-second');second.classList.toggle('hidden',g.boards?.length!==2);if(g.boards?.length===2)second.innerHTML=g.boards[1].map(v=>card(v)).join('');$('.board-area').classList.toggle('double-board',g.boards?.length===2);
  if(g.legal){$('#bet-input').removeAttribute('aria-invalid');const l=g.legal;bet=Math.min(l.max,Math.max(Math.min(l.min,l.max),g.currentBet+Math.floor(l.pot*.75)));syncBet();}
  renderActionHistory();renderActions();
}
function renderActions(){
  const l=game?.legal,done=game?.street==='complete',voting=game?.street==='runout-vote',finished=game?.finished,me=game?.players[mySeat()];
  $('#fold').disabled=busy||!l;$('#call').disabled=busy||!l;$('#raise').disabled=busy||!l?.canRaise;
  const controls=$('#bet-controls'),available=!!l?.canRaise&&!done&&!voting;controls.classList.remove('hidden');controls.dataset.available=String(available);controls.inert=!available;$('.action-section').dataset.phase=voting?'vote':done?(mode==='room'?'ready':'done'):'bet';
  for(const id of ['fold','call','raise'])$('#'+id).classList.toggle('hidden',!!done||!!voting);
  $('#next-hand').classList.toggle('hidden',!done||mode==='room'||!finished&&me?.stack===0&&game?.config.mode!=='tournament');
  $('#next-hand').disabled=busy||mode==='room'&&!allReady();
  for(const control of $$('#bet-controls input,#bet-controls button,#create-room,#back-to-entry'))control.disabled=busy||control.closest('#bet-controls')&&!available||mode==='room'&&['settings','create-room'].includes(control.id);
  $('#next-hand').innerHTML=(finished?'重新开桌':mode==='room'?'发下一手':'下一手')+icon('arrow-right');
  if(l){$('#call').innerHTML=l.check?'过牌 <kbd>C</kbd>':`跟注 ${fmt(l.call)} <kbd>C</kbd>`;$('#raise-label').textContent=!Number.isSafeInteger(bet)||bet<=0?'输入下注金额':bet===l.allIn?`全下 ${fmt(bet)}`:`${game.currentBet?'加注至':'下注'} ${fmt(bet)}`;}
  renderPhase();
  if(busy){$('#turn-status').innerHTML='<span class="thinking-dots"><i></i><i></i><i></i></span>牌桌行动进行中 · 可查看规则与统计';return;}
  if(!game){$('#turn-status').textContent='牌桌尚未连接';return;}
  if(voting)$('#turn-status').textContent='下注已锁定 · 全下发牌投票';
  else if(finished)$('#turn-status').textContent=game.config.mode==='points'?'积分赛已完成 · 查看最终排名':me.stack===0?'你已被淘汰 · 可继续观战':'比赛结束';
  else if(done)$('#turn-status').textContent=me.stack===0&&game.config.mode!=='tournament'?'筹码已用完 · 领取后继续':mode==='room'?'本手结束 · 准备后由房主发牌':'本手结束 · 下一手，新的可能';
  else if(mode==='room'&&!l)$('#turn-status').textContent=me.out?'你已淘汰，可继续观战':`等待 ${game.players[game.turn]?.name||'其他玩家'} 行动`;
  else $('#turn-status').innerHTML='<span class="thinking-dots"><i></i><i></i><i></i></span>轮到你了，慢慢思考';
  $('#action-hint').textContent=done?(game.config.mode==='points'?`已完成 ${game.hand}/${game.config.rounds} 轮 · 借入筹码不计收益`:'领取上限为本局初始筹码，借入会计入净积分。'):voting?'全员同意才发两次；有人选择一次或超时则默认一次。':l?.canRaise?`${LIMITS[game.config.limit]} · 最低 ${fmt(l.min)} · 最高 ${fmt(l.max)}`:'F 弃牌 · C 跟注 / 过牌 · R 加注';
}
function allReady(){return !!roomInfo&&roomInfo.members.filter(m=>!game||game.config.mode!=='tournament'||game.players[m.seat]?.stack>0).every(m=>m.ready);}
function renderPhase(){
  const panel=$('#phase-controls'),g=game;if(!g){panel.classList.add('hidden');return;}
  let html='';
  if(g.street==='runout-vote'){
    const v=g.runoutVote,voted=v.votes[mySeat()],eligible=v.eligible.includes(mySeat());
    html=`<div class="runout-panel"><div class="vote-top"><strong>全下发牌 <span id="vote-countdown"></span></strong><button id="vote-details" class="text-button">已投 ${Object.keys(v.votes).length}/${v.eligible.length} · 查看投票</button></div><p>发两次须全员同意；有人选一次或超时，默认发一次。</p>${eligible&&!voted?`<div class="vote-buttons"><button data-runs="1" class="button secondary" ${busy?'disabled':''}>发一次</button><button data-runs="2" class="button primary" ${busy?'disabled':''}>发两次</button></div>`:`<small>${voted?'你选择发 '+voted+' 次，等待其他玩家':'本手已弃牌，等待投票结果'}</small>`}</div>`;
  }else if(g.street==='complete'){
    const me=g.players[mySeat()];
    if(mode==='solo'&&!g.finished&&me.stack===0&&g.config.mode!=='tournament')html+='<button class="button primary" id="claim-chips" '+(busy?'disabled':'')+'>领取筹码</button>';
    if(mode==='room'&&!g.finished){
      const mine=roomInfo.members.find(m=>m.seat===mySeat());
      html+=`<div class="ready-panel"><div class="ready-members">${roomInfo.members.map(m=>`<span class="${m.ready?'is-ready':''}">${escape(m.name)} · ${g.config.mode==='tournament'&&g.players[m.seat].stack===0?'已淘汰':m.ready?'已准备':m.online?'未准备':'离线'}${roomInfo.host&&m.removable&&m.seat!==mySeat()?`<button data-remove-member="${escape(m.id)}" title="移除离线席位" aria-label="移除 ${escape(m.name)} 的离线席位" ${busy?'disabled':''}>×</button>`:''}</span>`).join('')}</div><div class="prepare-actions"><button id="${me.stack===0&&g.config.mode!=='tournament'?'claim-chips':'ready-hand'}" class="button ${mine?.ready?'primary':'secondary'}" ${busy||me.stack===0&&g.config.mode==='tournament'?'disabled':''}>${me.stack===0&&g.config.mode!=='tournament'?'领取筹码':mine?.ready?'取消准备':'准备下一手'}</button>${roomInfo.host?`<label>空位安排<select id="fill-policy" ${busy?'disabled':''}><option value="ai" ${roomInfo.fillAI?'selected':''}>AI 补位</option><option value="humans" ${!roomInfo.fillAI?'selected':''}>按现有人数</option></select></label><button id="phase-next" class="button primary" ${busy||!allReady()?'disabled':''}>发下一手</button>`:`<small>${roomInfo.fillAI?'空位由 AI 补齐':'按现有人数发牌'}</small>`}</div></div>`;
    }
    if(g.config.mode==='points')html+=`<button class="text-button" id="round-report">第 ${g.hand} 轮${g.finished?'最终':''}排行榜与统计 →</button>`;
  }
  panel.classList.toggle('hidden',!html);if(panel.signature!==html){panel.signature=html;panel.innerHTML=html;}
}
function syncBet(){const l=game?.legal;if(!l)return;$('#bet-slider').min=Math.min(l.min,l.max);$('#bet-slider').max=l.max;$('#bet-slider').step=1;$('#bet-slider').value=bet;$('#bet-input').min=Math.min(l.min,l.max);$('#bet-input').max=l.max;$('#bet-input').value=bet;renderActions();}
function setBet(value){const l=game?.legal;if(busy||!l||!l.canRaise)return;bet=Math.round(Math.max(Math.min(l.min,l.max),Math.min(l.max,Number(value)||l.min)));$('#bet-input').removeAttribute('aria-invalid');syncBet();}
$('#bet-slider').addEventListener('input',e=>setBet(e.target.value));
$('#bet-input').addEventListener('input',e=>{bet=Number(e.target.value);e.target.removeAttribute('aria-invalid');if(!betError(e.target.value,game?.legal,game?.currentBet))$('#bet-slider').value=bet;renderActions();});
$('#bet-input').addEventListener('change',e=>{if(busy)return;const error=betError(e.target.value,game?.legal,game?.currentBet);if(error)showBetError(error);});
$('#bet-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitBet();}});
function submitBet(){if(busy)return;const value=$('#bet-input').value,error=betError(value,game?.legal,game?.currentBet);if(error)return showBetError(error);bet=Number(value);request('action',{action:'raise',amount:bet});}
$$('[data-pot]').forEach(b=>b.addEventListener('click',()=>{const l=game?.legal;if(!l)return;$$('[data-pot],[data-multiple]').forEach(v=>v.classList.remove('selected'));b.classList.add('selected');setBet(b.dataset.pot==='all'?l.max:game.currentBet+Math.floor((l.pot+l.call)*Number(b.dataset.pot)));if(b.dataset.pot==='all'&&l.max<l.allIn)toast('当前限注规则只允许加注至 '+fmt(l.max));}));
$$('[data-multiple]').forEach(button=>button.addEventListener('click',()=>{
  const amount=multipleBet(button.dataset.multiple,game?.legal,game?.currentBet,game?.bb);if(amount===null||busy)return;
  $$('[data-pot],[data-multiple]').forEach(v=>v.classList.remove('selected'));button.classList.add('selected');setBet(amount);
  const requested=Math.max(game.currentBet,game.bb)*Number(button.dataset.multiple);
  if(requested!==amount)toast('已按当前规则调整为 '+fmt(amount));
}));
$('#fold').onclick=()=>request('action',{action:'fold'});$('#call').onclick=()=>request('action',{action:game?.legal?.check?'check':'call'});$('#raise').onclick=submitBet;
$('#next-hand').onclick=()=>game?.finished?openSettings():request('next');
document.addEventListener('keydown',e=>{if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName))return;const id=({f:'fold',c:'call',r:'raise'})[e.key.toLowerCase()];if(id&&!$('#'+id).disabled)$('#'+id).click();});
function closeSidebar(){$('#sidebar').classList.remove('open');$('#scrim').classList.remove('visible');}
$('#menu').onclick=()=>{$('#sidebar').classList.add('open');$('#scrim').classList.add('visible');};$('#scrim').onclick=closeSidebar;
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
function openSettings(){if(mode==='room'&&document.body.dataset.screen==='table')return toast('联机规则在房间创建时确定，请先退出房间再创建新牌局');if(mode==='solo'&&document.body.dataset.screen==='table')settingsPurpose='solo';$('#settings').textContent='本桌规则';$('#settings-title').textContent=settingsPurpose==='room'?'创建联机房间':'设置人机对局';if(busy)return toast('请等待当前牌桌动作播放完成');closeSidebar();const defaults={name:'周末牌局',limit:'no-limit',mode:'cash',seats:6,smallBlind:25,bigBlind:50,buyIn:10000,ante:0,anteMode:'each',rake:0,rakeCap:200,levelHands:10,rounds:10,aiDifficulty:'normal'};const c=game?.config||defaults;for(const [k,v]of Object.entries(c)){const input=$('#settings-form').elements.namedItem(k);if(input)input.value=v;}$('#rounds-field').classList.toggle('hidden',$('#settings-form').elements.mode.value!=='points');$('#form-error').textContent='';$('#settings-dialog').showModal();}
$('#settings').onclick=showRules;$('#create-room').onclick=openSettings;
$('#settings-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  const c=Object.fromEntries(new FormData(e.target));
  for(const k of ['seats','smallBlind','bigBlind','buyIn','ante','rake','rakeCap','levelHands','rounds'])c[k]=Number(c[k]);
  if(c.bigBlind<c.smallBlind||c.buyIn<2*c.bigBlind||c.ante>c.bigBlind){$('#form-error').textContent='请确保大盲 ≥ 小盲、买入 ≥ 2 倍大盲，且前注 ≤ 大盲。';return;}
  const previous=game,submit=e.target.querySelector('[type=submit]');submit.disabled=true;$('#settings-dialog').close();
  try{
    if(settingsPurpose==='room'){
      const name=$('#player-name').value.trim()||'房主';storage.set('river-name',name);await roomClient.open('create',{config:c,name});
    }else{
      mode='solo';roomInfo=null;roomClient.stop();document.body.dataset.screen='table';$('#online-table-info').classList.add('hidden');$('#exit-label').textContent='返回入口';
      if((lastReportKey='',await request('start',{config:c}))){
        if(previous?.hand){archives.unshift({at:new Date().toISOString(),name:previous.config.name,net:netOf(previous.players[previous.mySeat??0],previous),hands:previous.hand-(previous.street==='complete'?0:1),history:previous.history});archives=archives.slice(0,15);storage.set('river-archives',JSON.stringify(archives));}
      }else{$('#form-error').textContent='创建失败，请检查参数后重试。';$('#settings-dialog').showModal();}
    }
  }catch(error){$('#form-error').textContent=error.message;$('#settings-dialog').showModal();}
  finally{submit.disabled=false;}
});
function openInfo(title,eyebrow,html){closeSidebar();const dialog=$('#info-dialog');dialog.dataset.view='';$('#info-title').textContent=title;$('#info-eyebrow').textContent=eyebrow;$('#info-content').innerHTML=html;icons($('#info-content'));if(!dialog.open)dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.close-dialog').focus({preventScroll:true});}
function showHistory(){
  if(!game)return toast('请先创建牌局');
  const history=game.history||[];
  let html=`<h3>本手行动</h3><div class="history-log">${game.log.map(line=>`<div>${escape(line)}</div>`).join('')}</div><h3>已结束的牌局</h3>`;
  html+=history.length?history.map(h=>`<article class="history-item"><div class="history-row"><strong>第 ${h.hand} 手 <small>· 底池 ${fmt(h.pot)}</small></strong><span class="${h.net>=0?'positive':'negative'}">${signed(h.net)}</span></div><p>${escape(h.summary)}${h.rake?` · 抽水 ${fmt(h.rake)}`:''}</p><div class="history-board">${h.board.map(c=>card(c)).join('')||'<small>翻牌前结束</small>'}</div></article>`).join(''):'<div class="empty-state"><div class="empty-symbol">♣</div><strong>你的故事，才刚开始</strong><p>完成第一手后，记录会出现在这里。</p></div>';
  if(archives.length)html+=`<h3>已归档牌局</h3>${archives.map(a=>`<div class="history-item history-row"><strong>${escape(a.name)}<p>${new Date(a.at).toLocaleDateString('zh-CN')} · ${a.hands} 手</p></strong><span class="${a.net>=0?'positive':'negative'}">${signed(a.net)}</span></div>`).join('')}`;
  openInfo('牌局记录','EVERY HAND TELLS A STORY',html);
}
function showStats(){
  if(!game)return toast('请先创建牌局');
  if(game.street==='complete')lastReportKey=`${mode==='room'?roomInfo.code:game.config.name}:${game.hand}`;
  const completed=game.hand-(game.street==='complete'?0:1),me=game.players[mySeat()],net=netOf(me),history=game.history||[],wins=history.filter(h=>h.net>0).length;
  openInfo('对局统计','SMALL DECISIONS. LONG GAME.',`<div class="stats-summary"><div><small>本场净收益</small><strong class="${net>=0?'positive':'negative'}">${signed(net)}</strong></div><div><small>已完成</small><strong>${completed}<small>手</small></strong></div><div><small>近 ${history.length} 手胜率</small><strong>${history.length?Math.round(wins/history.length*100):0}%</strong></div></div><details class="stats-players"><summary>玩家积分榜 · ${game.players.filter(p=>!p.sittingOut).length} 人</summary><div class="table-scroll"><table class="score-table"><thead><tr><th>玩家</th><th>累计买入</th><th>当前筹码</th><th>净积分</th></tr></thead><tbody>${game.players.filter(p=>!p.sittingOut).sort((a,b)=>netOf(b)-netOf(a)).map(p=>`<tr><td>${escape(p.name)}${p.id===mySeat()?' · YOU':''}</td><td>${fmt(p.initial)}</td><td>${fmt(p.stack)}</td><td class="${netOf(p)>=0?'positive':'negative'}">${signed(netOf(p))}</td></tr>`).join('')}</tbody></table></div><p class="stats-note">1 筹码 = 1 积分。局内投入计入未结算筹码，结算后更新净收益。累计抽水 ${fmt(game.totalRake)}。历史展示最近 30 手，累计收益覆盖本场全部手数。</p></details>${game.config.mode==='points'&&game.roundReport?'<button class="button secondary" id="stats-round-report">本轮排行榜</button>':''}${handRecordsHTML(game)}${lastHandHTML(game)}<button class="button secondary export-button" id="export"><span data-icon="download"></span>导出本场积分 CSV</button>`);
  $('#info-dialog').dataset.view='stats';
  if($('#stats-round-report'))$('#stats-round-report').onclick=showRoundReport;
  $('#export').onclick=()=>{const rows=[['玩家','累计买入','当前筹码','净积分'],...game.players.filter(p=>!p.sittingOut).map(p=>[p.name,p.initial,p.stack,netOf(p)])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='river-scores.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('积分表已导出');};
}
function lastHandHTML(g){
  const h=g.history?.[0];if(!h)return '<p class="stats-note">完成一手后，这里会显示上一手牌型和完整下注记录。</p>';
  return `<section class="last-hand"><h3>上一局 · HAND #${String(h.hand).padStart(3,'0')}</h3><p>你的牌型：${escape(h.myHands?.join(' / ')||h.results?.find(r=>r.id===mySeat())?.hand||'未摊牌')} · 净积分 <strong class="${h.net>=0?'positive':'negative'}">${signed(h.net)}</strong></p>${(h.boards||[h.board]).map((board,i)=>`<div class="history-board">${h.boards?.length===2?`<small>第 ${i+1} 组</small>`:''}${board.map(c=>card(c)).join('')}</div>`).join('')}<div class="last-hand-contributions">${(h.contributions||[]).map(p=>`<span>${escape(p.name)} · 投入 ${fmt(p.amount)}${p.folded?' · 弃牌':''}</span>`).join('')}</div></section>`;
}
function recordsFor(g,hand){
  if(hand==='current')return {actions:g.handLog||[],actionCount:g.handActionCount||g.handLog?.length||0};
  return (g.history||[]).find(h=>h.hand===Number(hand))||{actions:[]};
}
function recordsList(record){
  const lines=record.actions||[];
  return lines.length?`${record.actionCount>lines.length?`<li class="record-note">本手共 ${record.actionCount} 条，仅展示最近 ${lines.length} 条</li>`:''}${lines.map((line,i)=>`<li class="${/加注|全下/.test(line)?'raise-record':''}"><span class="record-index">${String(i+1).padStart(2,'0')}</span><span>${escape(line)}</span></li>`).join('')}`:'<li class="record-note">暂无详细行动记录；旧版已归档的摘要可能不包含明细。</li>';
}
function handRecordsHTML(g){
  const options=[...(g.street!=='complete'?[{key:'current',label:`第 ${g.hand} 手 · 进行中`}]:[]),...(g.history||[]).map(h=>({key:h.hand,label:`第 ${h.hand} 手 · 已结束`}))];
  if(!options.length)return '<section class="hand-records"><h3>每手行动记录</h3><p>完成下注后，可在这里查看当前手和最近 30 手的记录。</p></section>';
  return `<section class="hand-records"><div class="records-heading"><h3>每手行动记录</h3><label for="records-hand">选择手数<select id="records-hand">${options.map(o=>`<option value="${o.key}">${o.label}</option>`).join('')}</select></label></div><div class="records-scroll" tabindex="0" role="region" aria-label="本手行动记录，可上下滚动或拖动"><ol id="records-list">${recordsList(recordsFor(g,String(options[0].key)))}</ol></div></section>`;
}
$('#info-content').addEventListener('change',e=>{if(e.target.id==='records-hand')$('#records-list').innerHTML=recordsList(recordsFor(game,e.target.value));});
let recordDrag=null;
$('#info-content').addEventListener('pointerdown',e=>{const region=e.target.closest('.records-scroll');if(!region||e.pointerType!=='mouse'||e.button!==0)return;recordDrag={region,y:e.clientY,top:region.scrollTop,id:e.pointerId};region.setPointerCapture(e.pointerId);region.classList.add('dragging');region.focus({preventScroll:true});e.preventDefault();});
$('#info-content').addEventListener('pointermove',e=>{if(recordDrag?.id===e.pointerId){recordDrag.region.scrollTop=recordDrag.top+recordDrag.y-e.clientY;e.preventDefault();}});
function endRecordDrag(e){if(recordDrag?.id!==e.pointerId)return;recordDrag.region.classList.remove('dragging');if(recordDrag.region.hasPointerCapture(e.pointerId))recordDrag.region.releasePointerCapture(e.pointerId);recordDrag=null;}
$('#info-content').addEventListener('pointerup',endRecordDrag);$('#info-content').addEventListener('pointercancel',endRecordDrag);
$('#info-dialog').addEventListener('close',()=>{recordDrag=null;});
function showRules(){
  if(!game)return showGuide();const c=game.config;
  openInfo('本桌规则','TABLE RULES',`<div class="guide-block"><h3>${escape(c.name)}</h3><p>${LIMITS[c.limit]} · ${MODES[c.mode]} · 初始筹码 ${fmt(c.buyIn)} · 盲注 ${fmt(game.sb)} / ${fmt(game.bb)}${c.mode==='points'?` · 共 ${c.rounds} 轮`:''}</p><h3>领取与计分</h3><p>现金 / 积分桌在本手结束且筹码归零后，可领取 1–${fmt(c.buyIn)} 筹码。累计借入显示为红色负数；净积分 = 当前筹码与局内投入 − 初始筹码 − 累计借入。锦标赛不支持补领。</p><h3>全下发牌</h3><p>下注锁定且公共牌未发完时进行 20 秒投票。发两次须所有仍争夺底池的玩家同意；有人选一次或超时，默认发一次。AI 自动同意两次。发两次共用已公开的牌，从同一副剩余牌堆独立发出后续牌；每个主池、边池平分给两组牌面，单数筹码优先给第一组。</p><h3>联机准备</h3><p>每手结束后所有仍参赛真人重新准备，房主再发牌。退出玩家本手由 AI 临时接管；下一手房主可选择 AI 补位或只保留在座真人。积分赛每手为一轮，每轮结束公布排名和统计。</p></div>`);
}
function showRoundReport(){
  const report=game?.roundReport;if(!report)return showStats();
  if(game.street==='complete')lastReportKey=`${mode==='room'?roomInfo.code:game.config.name}:${game.hand}`;
  openInfo(report.finished?'积分赛最终排名':`第 ${report.hand} 轮排行榜`,'ROUND REPORT',`<p>已完成 ${report.hand} / ${game.config.rounds} 轮 · 按累计净积分排序，补领筹码不会增加净积分。</p><div class="table-scroll"><table class="score-table round-ranking"><thead><tr><th>排名 / 玩家</th><th>净积分</th><th>筹码 / 借入</th><th>参赛 / 胜局</th><th>投入 / 加注</th></tr></thead><tbody>${report.ranking.map((p,i)=>`<tr class="${p.id===mySeat()?'my-ranking':''}"><td><strong>${i+1}</strong> ${escape(p.name)}${p.id===mySeat()?' · 你':''}</td><td class="${p.net>=0?'positive':'negative'}">${signed(p.net)}</td><td>${fmt(p.stack)}${p.borrowed?`<small class="borrowed">−${fmt(p.borrowed)}</small>`:''}</td><td>${p.stats.hands} / ${p.stats.wins}</td><td>${fmt(p.stats.invested)} / ${p.stats.raises}</td></tr>`).join('')}</tbody></table></div>${lastHandHTML(game)}${handRecordsHTML(game)}<p class="stats-note">${report.finished?'本场积分赛结束，可由房主创建新房间。':'关闭统计后准备下一轮。'}</p>`);
}
function maybeRoundReport(){
  if(game?.street!=='complete'||document.body.dataset.screen!=='table')return;
  const key=`${mode==='room'?roomInfo.code:game.config.name}:${game.hand}`;
  if(lastReportKey===key)return;
  if($('#info-dialog').open&&$('#info-dialog').dataset.view==='stats'){lastReportKey=key;showStats();return;}
  if(document.querySelector('dialog[open]'))return; // Queue until the player's current dialog closes.
  clearTimeout(reportTimer);reportTimer=setTimeout(()=>{
    if(game?.street!=='complete'||document.body.dataset.screen!=='table'||document.querySelector('dialog[open]'))return;
    const current=`${mode==='room'?roomInfo.code:game.config.name}:${game.hand}`;
    if(current!==key||lastReportKey===key)return;lastReportKey=key;
    if(game.config.mode==='points'&&game.roundReport)showRoundReport();else showStats();
  },1800);
}
$$('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{if(!busy)maybeRoundReport();}));
function openLoan(){
  if(busy||game?.street!=='complete')return;const max=game.config.buyIn;
  $('#loan-presets').innerHTML=[...new Set([2000,5000,10000,max].filter(n=>n<=max))].sort((a,b)=>a-b).map(n=>`<button type="button" class="button secondary" data-loan="${n}">${fmt(n)}</button>`).join('');
  $('#loan-amount').max=max;$('#loan-amount').value=Math.min(2000,max);$('#loan-note').textContent=`本次最多 ${fmt(max)}；累计借入 ${fmt(game.players[mySeat()].borrowed||0)}`;$('#loan-error').textContent='';$('#loan-dialog').showModal();
}
$('#loan-presets').onclick=e=>{const button=e.target.closest('[data-loan]');if(button)$('#loan-amount').value=button.dataset.loan;};
$('#loan-form').onsubmit=async e=>{
  e.preventDefault();const amount=Number($('#loan-amount').value),max=game.config.buyIn;
  if(!Number.isSafeInteger(amount)||amount<1||amount>max){$('#loan-error').textContent=`请输入 1–${fmt(max)} 的整数`;return;}
  const submit=e.target.querySelector('[type=submit]');submit.disabled=true;try{if(await request('loan',{amount}))$('#loan-dialog').close();}finally{submit.disabled=false;}
};
$('#phase-controls').onclick=e=>{
  const remove=e.target.closest('[data-remove-member]');if(remove)roomCommand('remove',{memberId:remove.dataset.removeMember});
  if(e.target.closest('#claim-chips'))openLoan();
  if(e.target.closest('#phase-next'))request('next');
  if(e.target.closest('#vote-details')){const v=game.runoutVote;openInfo('全下投票','RUN IT TWICE',`<p>发两次须全员一致同意。有人选择一次或投票超时，默认发一次；AI 自动同意两次。</p><div class="history-log">${v.eligible.map(id=>`<div>${escape(game.players[id].name)} · ${v.votes[id]?'发 '+v.votes[id]+' 次':'等待投票'}</div>`).join('')}</div>`);}
  const vote=e.target.closest('[data-runs]');if(vote)request('vote',{runs:Number(vote.dataset.runs)});
  if(e.target.closest('#ready-hand'))roomCommand('ready',{ready:!roomInfo.members.find(m=>m.seat===mySeat())?.ready});
  if(e.target.closest('#round-report'))showRoundReport();
};
$('#phase-controls').onchange=e=>{if(e.target.id==='fill-policy')roomCommand('options',{fillAI:e.target.value==='ai'});};
$('#ready-room').onclick=()=>roomCommand('ready',{ready:!roomInfo.members.find(m=>m.seat===roomInfo.mySeat)?.ready});
$('#fill-ai-lobby').onchange=e=>roomCommand('options',{fillAI:e.target.checked});
function showGuide(){openInfo('玩法指南','KNOW THE GAME. FIND YOUR EDGE.',`<div class="guide-block"><h3>两张手牌，五张公共牌</h3><p>从你的 2 张手牌与 5 张公共牌中，选出最强的 5 张牌。经过翻牌前、翻牌、转牌和河牌四轮下注，最后仍在局内的玩家比牌；也可以通过让其他玩家弃牌直接赢得底池。</p></div><div class="guide-block"><h3>牌型大小 · 从强到弱</h3><div class="hand-ranking">${['同花顺（含皇家同花顺）','四条','葫芦','同花','顺子','三条','两对','一对','高牌'].map((v,i)=>`<span>${String(i+1).padStart(2,'0')} &nbsp; ${v}</span>`).join('')}</div><p>A 可作为顺子的最大牌或 A2345 的最小牌。牌型相同则依次比较踢脚牌，花色不分大小。完全相同则平分，零头从庄家左手边第一位赢家开始分配。</p></div><div class="guide-block"><h3>三种下注结构</h3><p>无限注：可下注至全部筹码。底池限注：最高加注额按照跟注后的底池计算。固定限注：前两轮以大盲为单位，转牌与河牌以两倍大盲为单位，每轮最多四次下注（含初始下注）；单挑不设次数上限。不足额全下不一定重新开放加注权。</p></div><div class="guide-block"><h3>全下、边池与计分</h3><p>全下玩家只能赢得自己参与的底池，多出的筹码组成边池。未被跟注的部分退回。现金桌与积分桌在筹码归零后手动领取（最多初始筹码），累计借入显示为红色负数，并从净积分中扣除；锦标赛按配置的手数升盲，筹码用尽则淘汰。抽水仅对见到翻牌的现金桌生效。</p></div><div class="guide-block"><h3>关于这张牌桌</h3><p>这是与 AI 对手进行的标准德州扑克练习室，支持 2–9 人座位配置。所有筹码均为虚拟筹码。支持房间号联机与单人人机练习，不涉及真实货币、短牌或奥马哈。联机空位可由不同难度 AI 补齐，真人行动超时后显示红色计时并继续等待，不会自动过牌或弃牌，退出后由 AI 接管。联机房间凭证保存在当前浏览器。</p></div><div class="guide-block"><h3>操作快捷键</h3><p>F 弃牌 · C 跟注 / 过牌 · R 按当前金额加注。加注金额始终表示本轮投入总额，包含已支付的盲注或下注。</p></div>`);}
$$('[data-nav]').forEach(b=>b.onclick=()=>{closeSidebar();({table:()=>window.scrollTo({top:0,behavior:'smooth'}),history:showHistory,stats:showStats,rules:showRules})[b.dataset.nav]();});
$('#history-button').onclick=showHistory;$('#stats-button').onclick=showStats;$('#help').onclick=showGuide;
$('#ai-status').onclick=async()=>{
  try{
    const response=await fetch('/api/ai-status',{cache:'no-store'});if(!response.ok)throw new Error();const s=await response.json();
    const reasons={missing_key:'未配置 DEEPSEEK_API_KEY',missing_distributed_guard:'Vercel 未配置共享限流存储',disabled:'调用策略已关闭',request_budget:'本次操作已尝试一次模型',hand_budget:'达到每手调用上限',simple_position:'当前局面由本地策略处理',no_choice:'无可选决策',rate_concurrency_or_circuit:'限流、并发已满或熔断冷却',guard_unavailable:'限流服务不可用',timeout_network_or_invalid_json:'超时、网络失败或无效 JSON',invalid_choice:'模型返回非法候选动作',provider:'DeepSeek 请求',hit:'复用缓存'};
    Object.assign(reasons,{decision_deadline:'决策预算已用完',http_400:'请求参数被模型服务拒绝',http_401:'API 密钥无效或已失效',http_402:'模型账户余额不足',http_403:'模型服务拒绝访问',http_404:'模型名称或接口不存在',http_429:'模型服务限流，已冷却回退',http_500:'模型服务暂时故障',http_503:'模型服务暂时不可用',telemetry_unavailable:'共享统计读取失败'});
    const lastResolved=s.recent.slice().reverse().find(r=>['success','failure'].includes(r.event));
    const title=!s.ready?'当前使用本地策略':s.telemetry?.available===false?'DeepSeek 已配置 · 共享统计暂不可用':lastResolved?.event==='failure'?'最近调用失败 · 已回退本地策略':s.counts.success?'DeepSeek 已参与对局决策':'DeepSeek 已配置 · 等待实际调用验证';
    openInfo('AI 运行状态','DEEPSEEK',`<div class="guide-block"><h3>${escape(title)}</h3><p>${escape(reasons[s.blocker]||'配置有效；仅在策略与预算允许时发送请求')}。模型：${escape(s.model)}；策略：${escape(s.policy)}。</p><p>已发送 ${s.counts.request||0} 次 · 成功 ${s.counts.success||0} 次 · 失败 ${s.counts.failure||0} 次 · 缓存 ${s.counts.cache||0} 次 · 本地处理 ${s.counts.skip||0} 次</p><p>${escape(s.scope)}。失败与跳过时使用本地策略，不会阻塞牌局。</p><p>AI 看不到对手底牌或未发出的牌；诈唬也可能失败，最终按牌型结算。</p></div><div class="guide-block"><h3>最近决策记录</h3>${s.recent.length?s.recent.slice().reverse().map(r=>`<p>${escape(new Date(r.time).toLocaleTimeString())} · ${escape(r.event==='success'?'DeepSeek 调用成功'+(r.durationMs?' · '+r.durationMs+' ms':''):r.event==='failure'?'回退本地：'+(reasons[r.reason]||r.reason):reasons[r.reason]||r.reason)}</p>`).join(''):'<p>暂无记录，开始对局后查看。</p>'}</div>`);
  }catch{toast('无法读取 AI 状态，请确认服务已更新并重启');}
};
$('#sound').onclick=()=>{sound=!sound;$('#sound').innerHTML=icon(sound?'volume':'volume-off')+'<span>'+(sound?'音效开启':'音效关闭')+'</span>';$('#sound').setAttribute('aria-label',sound?'关闭音效':'开启音效');toast(sound?'音效已开启':'音效已关闭');if(sound)playSound();};
$('#bet-error-dialog').addEventListener('close',()=>{$('#bet-input').focus({preventScroll:true});$('#bet-input').select();});
const LEVEL_NAMES={easy:'轻松',normal:'标准',hard:'进阶'};
function showEntry(){lastReportKey='';roomClient?.stop();mode='solo';roomInfo=null;displayedRoom='';displayedVersion=-1;document.body.dataset.screen='entry';closeSidebar();$('#entry-error').textContent='';const saved=RoomClient.saved();$('#resume-room').classList.toggle('hidden',!saved);if(saved)$('#resume-room').textContent=`返回房间 ${saved.code}`;$('#resume-solo').classList.toggle('hidden',!storage.get('river-token'));}
function roomFailure(message,fatal=false){if(fatal){roomClient.stop();try{localStorage.removeItem('river-room');}catch{}showEntry();$('#entry-error').textContent=message;}else if(roomClient.failures<=1)toast(message);}
function renderLobby(){
  if(!roomInfo)return;const r=roomInfo;$('#lobby-code').textContent=r.code;$('#lobby-title').textContent=r.config.name;
  $('#lobby-hint').textContent=r.host?`已入座 ${r.members.length} / ${r.config.seats} 人。所有真人先准备，再由房主发牌；可选择 AI 补位或按现有人数开始。`:'等待房主开始。你可以把房间号分享给更多朋友。';
  const signature=JSON.stringify({code:r.code,members:r.members,levels:r.botLevels,host:r.host,fillAI:r.fillAI});
  if(signature!==lobbySignature){lobbySignature=signature;$('#lobby-members').innerHTML=Array.from({length:r.config.seats},(_,seat)=>{const member=r.members.find(m=>m.seat===seat);return member?`<div class="lobby-seat ${seat===r.mySeat?'me':''}"><span class="avatar">${escape(member.name[0])}</span><span><strong>${escape(member.name)}${seat===r.mySeat?' · 你':''}</strong><small>${member.host?'房主 · ':''}${member.ready?'已准备':member.online?'未准备':'暂时离线'}</small></span>${r.host&&member.removable&&member.seat!==r.mySeat?`<button data-remove-member="${escape(member.id)}" class="remove-seat">移除离线席位</button>`:''}</div>`:`<div class="lobby-seat"><span class="avatar">♣</span><span><strong>等待玩家</strong><small>空位 ${seat+1} · ${r.fillAI?'开始时补入 AI':'暂不入座'}</small></span><select data-bot-seat="${seat}" aria-label="座位 ${seat+1} 的 AI 难度" ${r.host?'':'disabled'}>${Object.entries(LEVEL_NAMES).map(([level,label])=>`<option value="${level}" ${r.botLevels[seat]===level?'selected':''}>${label} AI</option>`).join('')}</select></div>`;}).join('');
    $$('#lobby-members [data-remove-member]').forEach(button=>button.onclick=()=>roomCommand('remove',{memberId:button.dataset.removeMember}));
    $$('[data-bot-seat]').forEach(select=>select.onchange=()=>roomCommand('bots',{seat:Number(select.dataset.botSeat),difficulty:select.value}));
  }
  $('#start-room').classList.toggle('hidden',!r.host);$('#start-room').disabled=busy||!r.host||!r.members.every(m=>m.ready);$('#start-room').textContent=r.fillAI?'开始对局 · AI 补位':'开始对局 · 按现有人数';$('#fill-ai-lobby').checked=r.fillAI;$('#fill-ai-lobby').disabled=busy||!r.host;$('#ready-room').textContent=r.members.find(m=>m.seat===r.mySeat)?.ready?'取消准备':'准备';$('#ready-room').disabled=busy;$$('[data-bot-seat]').forEach(el=>el.disabled=busy||!r.host);
}
async function consumeRoom(data,ack){
  roomInfo=data.room;mode='room';$('#exit-label').textContent='退出房间';
  if(data.room.status==='waiting'){document.body.dataset.screen='lobby';renderLobby();return;}
  document.body.dataset.screen='table';$('#online-table-info').classList.remove('hidden');$('#online-room-label').textContent=`房间 ${roomInfo.code} · ${roomInfo.members.length} 位真人`;
  const changed=displayedRoom!==roomInfo.code||displayedVersion!==roomInfo.version||!game||data.frames.length||data.reset;
  if(!changed){renderActions();return;}
  busy=true;renderActions();
  try{await playback(data.frames||[],ack);game=data.game;displayedRoom=roomInfo.code;displayedVersion=roomInfo.version;render();maybeRoundReport();if(data.reset)announce({type:'ready',text:'离线期间牌局已有进展，已同步到最新状态'});else if(!data.frames.length)announce({type:'ready',text:game.legal?'房间已连接 · 轮到你行动':`等待 ${game.players[game.turn]?.name||'房主'} 行动`});}
  finally{busy=false;renderActions();}
}
roomClient=new RoomClient({onState:consumeRoom,onError:roomFailure,onPending:pending=>{busy=pending;renderActions();for(const input of $$('#entry-screen button,#entry-screen input'))input.disabled=pending;$('#leave-lobby').disabled=pending;if(roomInfo?.status==='waiting')renderLobby();}});
async function roomCommand(command,extra={}){
  if(busy)return false;busy=true;renderActions();
  try{await roomClient.command(command,extra);return true;}
  catch(error){if(command==='action')toast(error.message);else{$('#lobby-error').textContent=error.message;toast(error.message);}return false;}
  finally{busy=false;renderActions();}
}
async function exitGame(){
  if(busy)return toast('请等待当前动作播放完成');
  if(mode==='room'){try{await roomClient.command('leave');}catch(error){return toast(error.message);}}
  showEntry();
}
$('#back-to-entry').onclick=exitGame;$('#leave-lobby').onclick=exitGame;
$('#join-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const name=$('#player-name').value.trim(),code=$('#room-code').value.trim();storage.set('river-name',name);$('#entry-error').textContent='';try{await roomClient.open('join',{code,name});}catch(error){$('#entry-error').textContent=error.message;}});
$('#new-online-room').onclick=()=>{settingsPurpose='room';openSettings();};$('#solo-game').onclick=()=>{settingsPurpose='solo';openSettings();};
$('#resume-room').onclick=async()=>{try{await roomClient.restore();}catch(error){roomFailure(error.message,/不存在|已关闭|身份无效|已退出/.test(error.message));$('#entry-error').textContent=error.message;}};
$('#resume-solo').onclick=async()=>{mode='solo';token=storage.get('river-token');document.body.dataset.screen='table';$('#online-table-info').classList.add('hidden');$('#exit-label').textContent='返回入口';if(!await request('resume'))showEntry();};
$('#start-room').onclick=()=>roomCommand('start');
async function copyRoom(){const code=roomInfo?.code;if(!code)return;try{await navigator.clipboard.writeText(code);toast(`房间号 ${code} 已复制`);}catch{toast(`房间号：${code}`);}}
$('#copy-room').onclick=copyRoom;$('#copy-online-room').onclick=copyRoom;
function updateClocks(){const v=game?.runoutVote;if(game?.street==='runout-vote'){const clock=$('#vote-countdown'),offset=mode==='room'&&roomInfo?roomInfo.serverTime-roomInfo.receivedAt:0;if(clock)clock.textContent=Math.max(0,Math.ceil((v.deadline-Date.now()-offset)/1000))+' 秒';if(mode==='solo'&&!busy&&!soloPollPending&&Date.now()>=v.deadline){soloPollPending=true;request('poll').finally(()=>soloPollPending=false);}}if(mode!=='room'||!roomInfo||!game)return;const clock=$('#turn-countdown');const elapsed=roomInfo.turnUntil?Math.floor((Date.now()+roomInfo.serverTime-roomInfo.receivedAt-roomInfo.turnUntil)/1000):0;const overdue=!!roomInfo.turnUntil&&elapsed>=0&&!busy;clock.classList.toggle('overdue',overdue);for(const seat of $$('.seat'))seat.classList.toggle('turn-overdue',overdue&&Number(seat.dataset.playerId)===game.turn);if(busy){clock.textContent='正在播放牌桌动作';return;}clock.textContent=roomInfo.turnUntil?overdue?`超时 +${elapsed} 秒 · 等待 ${game.players[game.turn]?.name||'玩家'} 行动`:`${game.players[game.turn]?.name||'玩家'} 行动 · ${Math.max(0,-elapsed)} 秒`:game.street==='complete'?'等待玩家准备，再由房主发牌':'';}setInterval(updateClocks,500);
// Record receipt time without changing the server clock value.
const applyRoom=roomClient.onState;roomClient.onState=(data,ack)=>{data.room.receivedAt=Date.now();return applyRoom(data,ack);};
function init(){const updateMode=()=>$('#rounds-field').classList.toggle('hidden',$('#settings-form').elements.mode.value!=='points');$('#settings-form').elements.mode.addEventListener('change',updateMode);updateMode();showEntry();$('#player-name').value=storage.get('river-name')||'';const invite=new URLSearchParams(location.search).get('room');if(/^\d{6}$/.test(invite||''))$('#room-code').value=invite;}
init();
