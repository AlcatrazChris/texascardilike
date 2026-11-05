import {words,typeOf as type,cardName as name,escapeHTML as esc,tileHTML as tile,handColumns,resultLabels,playerResultRole,scoreFormula,settlementSummary,meldLabels as labels} from './zipai-presentation.js';
import {autoArrange,reconcileLayout,moveLayoutCard,shouldDiscardGesture,actionPause,handGeometry,handSpread} from './zipai-hand.js';
const $=s=>document.querySelector(s);
const signed=n=>`${n>0?'+':''}${n}`;
export const zipaiSummary=c=>`${c.minHu} 胡起胡 · ${c.wakeMode==='center'?'中醒':c.wakeMode==='all'?'上中下醒':'上下醒'} · ${c.allowPassedHu?'可胡过张':'过张不可胡'} · ${c.mustHu?'有胡必胡':'可选择不胡'} · ${c.rounds} 局`;
async function visibleDelay(duration){let remaining=duration;while(remaining>0){if(document.hidden){await new Promise(resolve=>{const change=()=>{if(!document.hidden){document.removeEventListener('visibilitychange',change);resolve();}};document.addEventListener('visibilitychange',change);});continue;}const start=performance.now();await new Promise(r=>setTimeout(r,Math.min(70,remaining)));if(!document.hidden)remaining-=performance.now()-start;}}

export function createZipai({command,create,exit,info,toast}){
  let g=null,room=null,pending=false,selected=null,layout=null,orderHand='',lastReport='',resultHand=null,lastEffect='',ignoreClickUntil=0,gesture=null,ghost=null,ghostFrame=0,handSignature='',chiOpen=false,huOpen=false,choiceKey='';
  const root=document.createElement('section');root.id='zipai-screen';root.setAttribute('aria-label','桂林字牌牌桌');
  root.innerHTML=`<header class="zp-heading"><div><span class="eyebrow">RIVER · 桂林字牌</span><h1 id="zp-name">桂林字牌</h1></div><div class="zp-tools"><button class="button secondary" id="zp-rules">本桌规则</button><button class="button secondary" id="zp-exit">退出房间</button></div></header><div class="zp-toolbar"><span id="zp-room"></span><button id="zp-copy" class="text-button">复制房间号</button><div><strong id="zp-hand"></strong><button id="zp-stats" class="text-button">对局统计 ↗</button></div></div><details class="zp-announcement" id="zp-records"><summary><span id="zp-notice" role="status" aria-live="polite">正在准备字牌</span><span>⌄</span></summary><ol id="zp-record-list" tabindex="0"></ol></details>
    <div class="zp-arena"><div class="zp-stage" aria-label="三人字牌牌桌"><div class="zp-felt"><span>桂林字牌</span><small>老 K 字牌</small></div></div><div id="zp-opponents"></div><div class="zp-center"><div class="zp-deck"><span class="zp-back zp-tile"><span class="zp-face">K</span><span class="zp-face-reverse">K</span></span><div><small>余牌</small><strong id="zp-remaining"></strong></div></div></div><div class="zp-current" id="zp-current"></div><div class="zp-self-summary" id="zp-self-summary"></div><div class="zp-self-melds" id="zp-self-melds"></div><section class="zp-hand-area" aria-label="你的手牌"><div class="zp-hand-heading"><div><span id="zp-selected"></span><button id="zp-sort" class="text-button">理牌 ↺</button></div></div><div id="zp-hand-cards" class="zp-hand-cards"></div></section><section class="zp-controls"><p id="zp-turn" role="status"></p><div id="zp-options" class="zp-options"></div><div id="zp-actions" class="zp-actions"></div></section><div id="zp-effects" class="zp-effects" aria-live="polite" aria-atomic="true"></div></div>`;
  document.body.append(root);
  root.querySelector('.zp-arena').prepend($('#zp-records'));
  const stage=root.querySelector('.zp-stage');
  const discardCue=document.createElement('div');discardCue.className='zp-discard-cue';discardCue.textContent='松手出牌';root.querySelector('.zp-arena').append(discardCue);
  function fitViewport(){if(document.body.dataset.screen!=='zipai')return;root.style.height=Math.round(window.visualViewport?.height||innerHeight)+'px';sizeHand();placeCurrent();placeClocks();if(chiOpen||huOpen)renderControls();if(resultsOpen)fitResultCards();}
  window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);
  const dialog=document.createElement('dialog');dialog.id='zipai-settings';dialog.className='modal zp-settings';
  dialog.innerHTML=`<div class="modal-header"><div><div class="eyebrow">TRY SOMETHING NEW</div><h2>创建桂林字牌房间</h2></div><button type="button" class="icon-button" id="zp-close-settings" aria-label="关闭">×</button></div><p class="modal-intro">老 K 玩法 · 三人字牌 · 分享房间号即可加入</p><form id="zp-form"><label class="zp-setting-name">房间名称<input name="name" value="桂林字牌" autocomplete="off" maxlength="24" required></label><div class="zp-settings-grid"><fieldset class="zp-setting-group"><legend>起胡</legend><div class="zp-setting-buttons"><label><input type="radio" name="minHu" value="10" ><span>10 胡</span></label><label><input type="radio" name="minHu" value="15" checked><span>15 胡</span></label><label><input type="radio" name="minHu" value="20" ><span>20 胡</span></label><label><input type="radio" name="minHu" value="25" ><span>25 胡</span></label><label><input type="radio" name="minHu" value="30" ><span>30 胡</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>翻醒</legend><div class="zp-setting-buttons"><label><input type="radio" name="wakeMode" value="neighbors" checked><span>上下</span></label><label><input type="radio" name="wakeMode" value="center" ><span>中醒</span></label><label><input type="radio" name="wakeMode" value="all" ><span>上中下</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>飞飞万能牌</legend><div class="zp-setting-buttons"><label><input type="radio" name="flower" value="false" checked><span>不加入</span></label><label><input type="radio" name="flower" value="true" ><span>加入一张</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>AI 难度</legend><div class="zp-setting-buttons"><label><input type="radio" name="aiDifficulty" value="easy" ><span>轻松</span></label><label><input type="radio" name="aiDifficulty" value="normal" checked><span>标准</span></label><label><input type="radio" name="aiDifficulty" value="hard" ><span>进阶</span></label></div></fieldset><label>底分<input name="base" type="number" inputmode="numeric" autocomplete="off" min="1" max="1000" value="1" required></label><label>对局局数<input name="rounds" type="number" inputmode="numeric" autocomplete="off" min="1" max="100" value="10" required></label><label class="zp-draw-penalty">黄庄每家获赔<input name="drawPenalty" type="number" inputmode="numeric" autocomplete="off" min="0" max="100" value="1" required><small>庄家支付，0 为不赔</small></label></div><details class="zp-advanced"><summary>更多规则</summary><div class="zp-rule-toggles"><label><input name="allowDiscardHu" type="checkbox" checked> 允许点炮胡（点炮者双倍）</label><label><input name="allowPassedHu" type="checkbox"> 允许过张后胡牌</label><label><input name="mustHu" type="checkbox"> 有胡必胡</label><label><input name="special" type="checkbox" checked> 特殊胡型加分</label><label><input name="repeatWake" type="checkbox" checked> 翻重醒</label></div></details><p id="zp-settings-summary" class="zp-rule-summary"></p><p id="zp-settings-error" class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button secondary" id="zp-cancel-settings">取消</button><button class="button primary" type="submit">创建房间 →</button></div></form>`;
  document.body.append(dialog);
  const form=$('#zp-form');
  const settings=()=>{const c=Object.fromEntries(new FormData(form));for(const k of ['minHu','base','rounds','drawPenalty'])c[k]=Number(c[k]);for(const k of ['allowDiscardHu','allowPassedHu','mustHu','special','repeatWake'])c[k]=form.elements[k].checked;c.flower=c.flower==='true';return {...c,game:'zipai'};};
  form.addEventListener('input',()=>$('#zp-settings-summary').textContent=zipaiSummary(settings()));
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;$('#zp-settings-error').textContent='';try{await create(settings());dialog.close();}catch(error){$('#zp-settings-error').textContent=error.message;$('#zp-settings-error').tabIndex=-1;$('#zp-settings-error').focus();}finally{button.disabled=false;}};
  $('#zp-close-settings').onclick=$('#zp-cancel-settings').onclick=()=>dialog.close();$('#zp-exit').onclick=exit;
  $('#zp-copy').onclick=async()=>{try{await navigator.clipboard.writeText(room.code);toast('房间号已复制');}catch{toast('房间号：'+room.code);}};
  $('#zp-rules').onclick=showRules;$('#zp-stats').onclick=()=>showStats();$('#zp-sort').onclick=()=>{layout=autoArrange(ownCards());selected=null;saveLayout();renderHand();};
  let resultsOpen=false;const resultBoard=document.createElement('section');resultBoard.id='zipai-result-board';resultBoard.className='zp-result-board hidden';resultBoard.setAttribute('aria-label','三家结算');
  function closeResults(){resultsOpen=false;resultBoard.classList.add('hidden');root.classList.remove('zp-show-results');}
  function openResults(){resultsOpen=true;resultBoard.classList.remove('hidden');root.classList.add('zp-show-results');}
  resultBoard.innerHTML=`<header class="zp-result-header"><div><span class="eyebrow">GUILIN ZIPAI · 本局结算</span><h2 id="zp-result-title">三家亮牌</h2></div><label><select id="zp-result-round" aria-label="选择结算牌局"></select></label><button class="zp-result-close" id="zp-result-close" aria-label="关闭结算">×</button></header><div class="zp-result-scroll"><div id="zp-result-summary" class="zp-result-summary"></div><div id="zp-result-players" class="zp-result-players"></div><div id="zp-result-bottom" class="zp-result-bottom"></div><details class="zp-result-history"><summary>整局行动记录 <span id="zp-result-action-count"></span></summary><ol id="zp-result-log" class="zp-stats-log" tabindex="0"></ol></details></div><footer id="zp-result-footer" class="zp-result-footer"></footer>`;
  resultBoard.setAttribute('aria-labelledby','zp-result-title');root.querySelector('.zp-arena').append(resultBoard);$('#zp-result-close').onclick=()=>closeResults();$('#zp-result-round').onchange=e=>{resultHand=Number(e.target.value);renderStats();};
  document.addEventListener('visibilitychange',()=>root.classList.toggle('zp-paused',document.hidden));

  function showRules(){if(!room)return;const c=room.config;info('桂林字牌 · 本桌规则','YOUR TABLE, YOUR RULES',`<div class="guide-block"><h3>${esc(zipaiSummary(c))}</h3><p>三人，${c.flower?81:80} 张牌；庄家 21 张，闲家各 20 张。普通摸牌公开响应，不能直接收入手牌；扫、过扫、扫穿的摸牌只对本人显示。起手一笼留在手牌，不能拆出。成坎不能拆，吃牌须同时完成下比。自摸先检查能否胡牌，再确认扫／扫穿；其余依次胡、开招／碰、吃；${c.allowDiscardHu?'允许点炮胡':'仅允许摸出的牌胡牌'}，${c.allowPassedHu?'允许胡过张':'放弃吃、碰、胡或打出同字后，不可胡他人该字牌；本人再次自摸不受此限'}。胡家坐庄，黄庄连庄。</p></div><div class="guide-block"><h3>胡数 · 小字 / 大字</h3><p>一二三、二七十：3 / 6；碰：1 / 3；坎、扫、过扫：3 / 6；开招：6 / 9；扫穿、起手四张：9 / 12；普通顺子、大小搭不计胡。</p><p>10–14 胡 1 子，15–19 胡 2 子，之后每 5 胡加 1 子。自摸按（基础子数 + 特殊加分 + 翻醒子数）× 2；${c.special?'天胡、地胡、三笼或五坎加 1 子；海底胡加 2 醒子':'本桌关闭特殊加分'}。胡牌后自动逐张翻醒，命中重醒自动继续；醒数和剩余底牌直接展示在牌桌。每张命中醒牌加 1 子；${c.repeatWake?'醒命中四张可继续翻醒':'不翻重醒'}。</p><p>每家支付 = 总子数 × 底分 ${c.base}。自摸或胡公开摸牌由另两家分别支付，点炮仅出牌者支付双倍。黄庄庄家给每位闲家 ${c.drawPenalty??1} 分（不乘底分）。${c.flower?'飞飞一局一张，始终留在手中，不可打出或参与吃碰扫开招；仅胡牌结算时匹配最大合法胡数，同字不超过四张。摸到飞飞公开展示后收入手牌并出一张。':'本桌不加入飞飞。'}共 ${c.rounds} 局，每局结束后手动准备。</p></div><div class="guide-block"><h3>操作与 AI</h3><p>发牌后自动理牌，每笔可手动放五张；整理分组不改变吃碰规则。拖到空白处新建一笔，刷新和同步保留手动布局，主动点击「理牌」才重新整理。点选手牌后点击「出牌」，或向上滑出合法手牌直接出牌。只有一种吃法时点击「吃」直接生效；多种吃法才展开组合选择。扫、过扫、扫穿、开招按规则必须执行，但真人需点击对应按钮确认；扫胡、开招胡直接点击「胡」；多种合法胡法可以选择组合。公开行动位倒计时 30 秒，超时变红正计时。第三家的碰／开招响应超时后失效，不会显示第三家计时器。下一家可继续选择吃牌；真人出牌不会被自动代打。字牌 AI 使用本地组牌策略，只能看到自己的手牌及公开信息。</p></div>`);}
  function cardColumnsHTML(columns,winningCard=null,showHu=false){return columns.map(column=>{const cards=Array.isArray(column)?column:column.cards;return `<div class="zp-card-column">${cards.map(c=>tile(c,{winning:c===winningCard})).join('')}${showHu?`<small class="zp-column-hu">${column.hu||0}</small>`:''}</div>`;}).join('');}
  function meldsHTML(p){return p.melds.filter(m=>!m.initial).map(m=>`<div class="zp-meld" title="${labels[m.kind]}${m.hu===null?'':' · '+m.hu+' 胡'}">${m.cards.map(c=>tile(c)).join('')}<small>${labels[m.kind]}${m.hu===null?'':' '+m.hu}</small></div>`).join('');}
  function discardsHTML(p){return `<div class="zp-discards" aria-label="${esc(p.name)}的弃牌">${p.discards.map(c=>tile(c)).join('')}</div>`;}
  function profileHTML(p){return `<div class="zp-player"><span class="zp-avatar">${esc(p.name[0])}</span><strong title="${esc(p.name)}">${esc(p.name)} ${p.id===g.dealer?'<em>庄</em>':''}</strong><b class="${String(p.score).length>4?'zp-long-score':''}" title="${signed(p.score)} 积分">${signed(p.score)}<small>积分</small></b><span class="zp-seat-clock" data-clock-seat="${p.id}" role="timer" aria-live="off" hidden></span></div>`;}
  function publicHTML(p){p={...p,melds:p.melds.filter(m=>!m.initial)};if(!p.melds.length&&!p.discards.length)return '';return `<div class="zp-public">${p.melds.length?`<div class="zp-melds">${meldsHTML(p)}</div><div class="zp-hu-line"><span>${p.melds.reduce((s,m)=>s+(m.hu||0),0)} 胡</span></div>`:''}${p.discards.length?discardsHTML(p):''}</div>`;}
  function positionOf(id){return id===g.mySeat?'self':id===(g.mySeat+2)%3?'left':'right';}
  function render(){
    if(!g)return;root.classList.toggle('zp-complete',g.street==='complete');if(gesture&&['wake','complete'].includes(g.street))cancelDrag();const me=g.players[g.mySeat],others=[g.players[(g.mySeat+2)%3],g.players[(g.mySeat+1)%3]];
    $('#zp-name').textContent=g.config.name;$('#zp-room').textContent=`房间 ${room.code} · ${room.members.length} 位真人`;$('#zp-hand').textContent=`第 ${String(g.hand).padStart(3,'0')} 局`;$('#zp-remaining').textContent=g.remaining;
    const current=g.current,card=current?.card??g.dangdi,key=[g.hand,card,current?.source,current?.draw,current?.claimed,current?.concealed].join(':');$('#zp-current').dataset.position=positionOf(current?.source??g.dealer);
    const shown=!!current&&!current.claimed&&g.street!=='complete';$('#zp-current').classList.toggle('hidden',!shown);
    if($('#zp-current').dataset.key!==key){$('#zp-current').dataset.key=key;$('#zp-current').innerHTML=shown?`<small>${current.concealed?'摸暗牌':current.draw?'摸牌':'出牌'}</small>${tile(card)}`:'';$('#zp-current').setAttribute('aria-label',current?g.players[current.source].name+(current.draw?'摸牌':'出牌'):'当前出牌');}
    $('#zp-opponents').innerHTML=others.map((p,i)=>`<article class="zp-opponent ${i?'right':'left'} ${g.turn===p.id&&!['complete','wake'].includes(g.street)?'active':''}" data-zp-seat="${p.id}">${profileHTML(p)}${publicHTML(p)}</article>`).join('');
    $('#zp-self-summary').innerHTML=profileHTML(me);$('#zp-self-summary').dataset.zpSeat=me.id;$('#zp-self-summary').classList.toggle('active',g.turn===me.id&&g.street!=='complete');$('#zp-self-melds').innerHTML=publicHTML(me);
    const records=$('#zp-record-list'),follow=records.scrollHeight-records.scrollTop-records.clientHeight<40;records.innerHTML=(g.handLog||[]).map(s=>`<li>${esc(s)}</li>`).join('');if(follow)records.scrollTop=records.scrollHeight;
    renderWake();renderHand();renderControls();fitViewport();if(resultsOpen)fitResultCards();
  }
  function renderWake(){
    root.classList.toggle('zp-waking',g.street==='wake');
  }
  function ownCards(){const p=g.players[g.mySeat];return [...p.hole,...p.melds.filter(m=>m.initial).flatMap(m=>m.cards)];}
  function saveLayout(){try{let saved=JSON.parse(localStorage.getItem('river-zipai-layouts')||'{}');saved={...saved,[orderHand]:layout};const keys=Object.keys(saved);for(const key of keys.slice(0,Math.max(0,keys.length-12)))delete saved[key];localStorage.setItem('river-zipai-layouts',JSON.stringify(saved));}catch{}}
  function sizeHand(){
    if(gesture?.moving)return;const s=handGeometry(root.clientWidth,root.clientHeight);
    root.style.setProperty('--card-width',s.width+'px');root.style.setProperty('--card-height',s.height+'px');root.style.setProperty('--card-step',s.step+'px');root.style.setProperty('--hand-height',s.reserved+'px');
    const columns=[...root.querySelectorAll('.zp-hand-column')],area=$('#zp-hand-cards'),positions=handSpread(area.clientWidth,s.width,columns.length);
    const publicWidth=Math.min($('#zp-self-melds').getBoundingClientRect().width,...[...root.querySelectorAll('.zp-opponent .zp-public')].map(e=>e.getBoundingClientRect().width));root.style.setProperty('--public-card-width',Math.max(7,Math.min(24,Math.floor((publicWidth-14)/6)-2))+'px');
    for(const [i,col] of columns.entries()){col.style.left=positions[i]+'px';col.style.zIndex=String(i+1);col.style.setProperty('--deal-i',i);}
    area.scrollLeft=0;
  }
  function placeCurrent(){
    const card=$('#zp-current');if(!g?.current||card.classList.contains('hidden'))return;
    const source=g.current.source,profile=source===g.mySeat?$('#zp-self-summary .zp-player'):root.querySelector(`[data-zp-seat="${source}"] .zp-player`);if(!profile)return;
    const table=root.querySelector('.zp-arena').getBoundingClientRect(),r=profile.getBoundingClientRect();
    const portrait=innerWidth<=600&&innerHeight>innerWidth,x=portrait&&positionOf(source)==='right'?r.left-table.left-card.offsetWidth-12:r.right-table.left+(portrait?12:8),y=portrait&&source!==g.mySeat?r.bottom-table.top+2:r.top-table.top;
    card.style.left=Math.round(Math.max(0,Math.min(x,table.width-card.offsetWidth)))+'px';card.style.top=Math.round(Math.max(0,Math.min(y,table.height-card.offsetHeight-4)))+'px';card.style.right='auto';card.style.bottom='auto';
  }
  function placeClocks(){
    const portrait=innerWidth<=600&&innerHeight>innerWidth,table=root.querySelector('.zp-arena').getBoundingClientRect(),size=parseFloat(getComputedStyle(root).getPropertyValue('--clock-size'));
    const positions=[...root.querySelectorAll('[data-clock-seat]')].map(clock=>{const player=clock.closest('.zp-player'),r=player.getBoundingClientRect(),id=Number(clock.dataset.clockSeat);let x=r.left+(r.width-size)/2,y=id===g.mySeat?r.top-size-7:r.bottom+7;
      if(portrait){x=id===g.mySeat?r.right+parseFloat(getComputedStyle(root).getPropertyValue('--current-width'))+24:positionOf(id)==='left'?r.right+4:r.left-size-4;y=r.top+12;}
      return {clock,x:Math.round(x-r.left),y:Math.round(Math.max(table.top,Math.min(y,table.bottom-size))-r.top)};});
    for(const {clock,x,y} of positions){clock.style.left=x+'px';clock.style.top=y+'px';}
  }
  function fitResultCards(){
    const summary=$('#zp-result-summary'),arenaRect=resultBoard.getBoundingClientRect(),panelTop=Math.round(summary.getBoundingClientRect().bottom-arenaRect.top+22);
    resultBoard.style.setProperty('--result-panel-top',panelTop+'px');
    for(const panel of resultBoard.querySelectorAll('.zp-result-player')){
      const zones=panel.querySelector('.zp-result-card-zone'),count=panel.querySelectorAll('.zp-card-column').length,empty=[...panel.querySelectorAll('.zp-result-zone')].filter(z=>!z.querySelector('.zp-card-column')).length;
      const cap=innerHeight<=480?10:innerWidth<=600?(innerHeight<680?14:18):innerHeight<850?20:26,w=Math.min(cap,Math.max(7,Math.floor((zones.clientWidth-40-empty*30)/Math.max(1,count))-2));
      panel.style.setProperty('--card-width',w+'px');panel.style.setProperty('--card-height',Math.round(w*2.85)+'px');panel.style.setProperty('--card-step',Math.round(w*.8)+'px');
    }
    const wake=resultBoard.querySelector('.zp-wake-display'),bottom=resultBoard.querySelector('.zp-remaining-cards');if(!wake)return;
    if(innerHeight<=600&&innerWidth>innerHeight){const top=summary.getBoundingClientRect().bottom-arenaRect.top+4;wake.style.top=top+'px';wake.style.setProperty('--card-width','9px');wake.style.setProperty('--card-height','26px');wake.querySelector('strong').style.fontSize='25px';if(bottom){const end=Math.max(...[...resultBoard.querySelectorAll('.zp-result-player:not(.self)')].map(p=>p.getBoundingClientRect().bottom));bottom.style.top=Math.min(arenaRect.height-bottom.offsetHeight-2,end-arenaRect.top+4)+'px';}return;}
    const table=resultBoard.getBoundingClientRect(),opponents=[...resultBoard.querySelectorAll('.zp-result-player:not(.self)')],end=Math.max(...opponents.map(p=>p.getBoundingClientRect().bottom)),self=resultBoard.querySelector('.zp-result-player.self').getBoundingClientRect(),gap=self.top-end,deckHeight=bottom?.getBoundingClientRect().height||0;
    if(wake.classList.contains('zp-final-outcome')){wake.querySelector('strong').style.fontSize=Math.max(25,Math.min(innerWidth<=600?43:63,gap-36))+'px';wake.style.top=Math.round(end-table.top+(gap-wake.getBoundingClientRect().height)/2)+'px';return;}
    const n=Math.max(1,wake.querySelectorAll('.zp-tile').length),maxFace=Math.max(6,Math.min(innerWidth<=600?23:43,(gap-deckHeight-20)/2.85,(wake.clientWidth-90)/n-8));
    wake.style.setProperty('--card-width',Math.floor(maxFace)+'px');wake.style.setProperty('--card-height',Math.round(maxFace*2.85)+'px');wake.querySelector('strong').style.fontSize=Math.max(22,Math.min(innerWidth<=600?43:63,gap-deckHeight-12))+'px';wake.style.top=Math.round(end-table.top+5)+'px';
    if(bottom)bottom.style.top=Math.round(end-table.top+5+wake.getBoundingClientRect().height+5)+'px';
  }
  function renderHand(){
    if(!g)return;const me={...g.players[g.mySeat],hole:ownCards()},key=room.code+':'+g.mySeat+':'+(g.dealId||g.hand+':'+g.dangdi);
    if(orderHand!==key){cancelDrag();orderHand=key;selected=null;try{layout=JSON.parse(localStorage.getItem('river-zipai-layouts')||'{}')[key];}catch{layout=null;}layout=layout?reconcileLayout(layout,me.hole):autoArrange(me.hole);handSignature='';}
    layout=reconcileLayout(layout,me.hole);if(!me.hole.includes(selected))selected=null;
    $('#zp-selected').textContent=selected===null?'':`已选 ${name(selected)}`;saveLayout();
    if(gesture?.moving){if(!me.hole.includes(gesture.card))cancelDrag();else return;}
    const signature=JSON.stringify([layout,selected,g.legal?.discard]);if(signature===handSignature){sizeHand();return;}handSignature=signature;
    const scroll=$('#zp-hand-cards');
    scroll.innerHTML=layout.columns.filter(col=>col.cards.length||gesture?.moving).map(col=>`<div class="zp-hand-column ${col.cards.length?'':'zp-empty-column'}" data-zp-column="${esc(col.id)}">${col.cards.map((card,index)=>`<button class="zp-hand-card ${selected===card?'selected':''} ${g.legal?.discard.includes(card)?'playable':''}" data-zp-card="${card}" data-zp-index="${index}" aria-label="${name(card)}${g.legal?.discard.includes(card)?'，可出牌':''}" aria-pressed="${selected===card}">${tile(card)}</button>`).join('')}<span class="zp-column-space" aria-hidden="true">${col.cards.length?'':'＋'}</span></div>`).join('');
    scroll.scrollLeft=0;sizeHand();
  }
  const handArea=$('#zp-hand-cards');
  handArea.addEventListener('pointerdown',e=>{
    const button=e.target.closest('[data-zp-card]');if(!button||e.button>0)return;
    gesture={card:Number(button.dataset.zpCard),pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moving:false,source:button};handArea.setPointerCapture(e.pointerId);e.preventDefault();
  });
  handArea.addEventListener('pointermove',e=>{
    if(!gesture||gesture.pointerId!==e.pointerId)return;gesture.x=e.clientX;gesture.y=e.clientY;
    if(!gesture.moving&&Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<8)return;
    if(!gesture.moving){gesture.moving=true;gesture.source.classList.add('zp-dragging');ghost=document.createElement('div');ghost.className='zp-drag-ghost';const r=gesture.source.querySelector('.zp-tile').getBoundingClientRect();ghost.style.setProperty('--card-width',r.width+'px');ghost.style.setProperty('--card-height',r.height+'px');ghost.innerHTML=tile(gesture.card);document.body.append(ghost);}
    if(!ghostFrame)ghostFrame=requestAnimationFrame(()=>{ghostFrame=0;if(gesture&&ghost)ghost.style.transform=`translate3d(${gesture.x-20}px,${gesture.y-25}px,0)`;});
    for(const col of handArea.querySelectorAll('.zp-drop-target'))col.classList.remove('zp-drop-target');
    document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-zp-column],[data-zp-new-column]')?.classList.add('zp-drop-target');
    const mayDiscard=shouldDiscardGesture({...gesture,x:e.clientX,y:e.clientY,hand:$('.zp-hand-area').getBoundingClientRect(),arena:stage.getBoundingClientRect(),legal:!!g.legal?.discard.includes(gesture.card),pending});discardCue.classList.toggle('active',mayDiscard);
    const r=handArea.getBoundingClientRect();if(e.clientX<r.left+24)handArea.scrollLeft-=9;else if(e.clientX>r.right-24)handArea.scrollLeft+=9;e.preventDefault();
  });
  handArea.addEventListener('pointerup',e=>{
    if(!gesture||gesture.pointerId!==e.pointerId)return;const moving=gesture.moving,card=gesture.card;
    const discard=moving&&shouldDiscardGesture({...gesture,x:e.clientX,y:e.clientY,hand:$('.zp-hand-area').getBoundingClientRect(),arena:stage.getBoundingClientRect(),legal:!!g.legal?.discard.includes(card),pending});
    const target=document.elementFromPoint(e.clientX,e.clientY),column=target?.closest('[data-zp-column]'),newColumn=target?.closest('[data-zp-new-column]')||target===handArea,targetCard=target?.closest('[data-zp-card]');
    let index;if(targetCard){const r=targetCard.getBoundingClientRect();index=Number(targetCard.dataset.zpIndex)+(e.clientY>r.top+Math.min(r.height/2,18)?1:0);}
    else if(target===handArea){const columns=[...handArea.querySelectorAll('[data-zp-column]')];const at=columns.findIndex(c=>{const r=c.getBoundingClientRect();return e.clientX<r.left+r.width/2;});index=at<0?columns.length:at;}
    cancelDrag();ignoreClickUntil=Date.now()+400;
    if(discard){selected=card;renderHand();command('action',{action:'discard',amount:card});return;}
    if(moving&&(column||newColumn)&&ownCards().includes(card)){const result=moveLayoutCard(layout,card,column?.dataset.zpColumn??null,index);if(result.full)toast('一笔最多 5 张牌，可拖到空白处新建一笔');if(result.changed){layout=result.layout;saveLayout();}}
    else if(!moving)selected=card;
    handSignature='';renderHand();renderControls();
  });
  handArea.addEventListener('pointercancel',()=>{cancelDrag();handSignature='';renderHand();});
  handArea.addEventListener('click',e=>{if(Date.now()<ignoreClickUntil)return;const b=e.target.closest('[data-zp-card]');if(b){selected=Number(b.dataset.zpCard);renderHand();renderControls();}});
  handArea.setAttribute('aria-description','选牌后可点击出牌；按住 Alt 加方向键可整理分组');
  handArea.addEventListener('keydown',e=>{
    const button=e.target.closest('[data-zp-card]');if(!button||!e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
    const card=Number(button.dataset.zpCard),column=layout.columns.find(c=>c.cards.includes(card)),index=layout.columns.indexOf(column),at=column.cards.indexOf(card),horizontal=e.key==='ArrowLeft'||e.key==='ArrowRight',to=index+(e.key==='ArrowLeft'?-1:1);
    const moved=horizontal?moveLayoutCard(layout,card,layout.columns[to]?.id??null,to<0?0:undefined):moveLayoutCard(layout,card,column.id,e.key==='ArrowUp'?Math.max(0,at-1):at+2);
    if(moved.full){toast('每笔最多五张，请选择其他位置');return;}if(!moved.changed)return;layout=moved.layout;selected=card;saveLayout();handSignature='';renderHand();renderControls();handArea.querySelector(`[data-zp-card="${card}"]`)?.focus({preventScroll:true});
  });
  function cancelDrag(){if(gesture){gesture.source?.classList.remove('zp-dragging');try{handArea?.releasePointerCapture(gesture.pointerId);}catch{}}gesture=null;ghost?.remove();ghost=null;if(ghostFrame)cancelAnimationFrame(ghostFrame);ghostFrame=0;discardCue.classList.remove('active');for(const c of root.querySelectorAll('.zp-drop-target'))c.classList.remove('zp-drop-target');}
  function preparationHTML(){const me=room.members.find(m=>m.seat===room.mySeat);if(g.finished)return '<button class="button primary" data-zp-control="stats">查看本场排行榜</button>';return `<span class="zp-ready-members">${room.members.map(m=>`${esc(m.name)} · ${m.ready?'已准备':'未准备'}`).join('　')}</span><button class="button ${me?.ready?'secondary':'primary'}" data-zp-control="ready">${me?.ready?'取消准备':'准备'}</button>${room.host?`<button class="button secondary" data-zp-control="next" ${room.members.every(m=>m.ready)?'':'disabled'}>发下一局 →</button>`:''}`;}
  function wireActions(container){for(const b of container.querySelectorAll('[data-zp-control]'))b.onclick=()=>{const k=b.dataset.zpControl;if(k==='stats')return showStats();if(k==='choose-chi'){const choices=g.legal.options.filter(o=>o.kind==='chi');if(choices.length===1)return command('action',{action:choices[0].id});chiOpen=true;huOpen=false;renderControls();return;}if(k==='hu'&&g.legal.huChoices?.length>1){huOpen=true;chiOpen=false;renderControls();return;}if(k==='cancel-hu'){huOpen=false;renderControls();return;}if(k==='cancel-chi'){chiOpen=false;renderControls();return;}if(k==='close-result')return closeResults();if(k==='ready')return command('ready',{ready:!room.members.find(m=>m.seat===room.mySeat)?.ready});if(k==='next'){closeResults();return command('next');}command('action',{action:k,...(k==='discard'?{amount:selected}:{})});};for(const b of container.querySelectorAll('[data-zp-option]'))b.onclick=()=>command('action',{action:b.dataset.zpOption});if(pending)for(const b of container.querySelectorAll('[data-zp-control]:not([data-zp-control=stats]):not([data-zp-control=close-result]),[data-zp-option]'))b.disabled=true;}
  function renderControls(){
    if(!g||!room)return;const l=g.legal,key=[g.hand,g.turn,g.street,g.current?.card,(g.handLog||[]).length].join(':');if(key!==choiceKey){chiOpen=false;huOpen=false;choiceKey=key;}const done=g.street==='complete',waking=g.street==='wake',actions=$('#zp-actions');$('#zp-options').innerHTML='';root.dataset.phase=waking?'wake':done?'complete':g.turn===g.mySeat?'acting':'waiting';
    $('#zp-turn').textContent=done?(g.finished?'本场结束':'本局结束 · 准备后继续'):waking?'自动翻醒':g.responseQueued?'已选吃牌 · 等待响应结束':'';
    updateClocks();
    const options=$('#zp-options');options.classList.toggle('zp-choice-open',chiOpen||huOpen);
    if(done)actions.innerHTML=preparationHTML();
    else if(waking)actions.innerHTML='';
    else if(l){
      const chi=l.options.filter(o=>o.kind==='chi');
      actions.innerHTML=(l.pass?'<button class="button secondary" data-zp-control="pass">过</button>':'')+(l.hu&&!huOpen?'<button class="button primary zp-hu" data-zp-control="hu">胡</button>':'')+(l.discard.length?'<button class="button primary" data-zp-control="discard" '+(l.discard.includes(selected)?'':'disabled')+'>出牌'+(selected===null?'':' · '+name(selected))+'</button>':'');
      if(chi.length&&!chiOpen&&!huOpen)actions.innerHTML='<button class="button primary" data-zp-control="choose-chi">吃</button>'+actions.innerHTML;
      if(chiOpen||huOpen)actions.innerHTML='<button class="button secondary" data-zp-control="'+(huOpen?'cancel-hu':'cancel-chi')+'">返回</button>'+actions.innerHTML;
      for(const o of l.options.filter(o=>o.kind!=='chi'))actions.innerHTML='<button class="button primary" data-zp-option="'+o.id+'">'+esc(labels[o.kind])+'</button>'+actions.innerHTML;
      if(huOpen)options.innerHTML='<p class="zp-choice-title">选择胡牌组合</p>'+l.huChoices.map(o=>'<button class="zp-hu-choice '+(o.recommended?'zp-recommended':'')+'" data-zp-option="'+o.id+'"><strong>'+esc(o.method)+' · '+o.hu+'胡'+(o.recommended?' · 推荐':'')+'</strong><span class="zp-hu-combo">'+cardColumnsHTML(o.groups,null,true)+'</span></button>').join('');
      else if(chiOpen)options.innerHTML='<p class="zp-choice-title">选择吃牌组合</p>'+chi.map(o=>'<button class="zp-option '+(o.recommended?'zp-recommended':'')+'" data-zp-option="'+o.id+'"><strong>'+(o.recommended?'推荐':'吃')+'</strong>'+o.groups.map(cards=>'<span class="zp-option-group">'+cards.map(c=>tile(c)).join('')+'</span>').join('')+'</button>').join('');
    }else actions.innerHTML='';
    if(chiOpen||huOpen){const arena=root.querySelector('.zp-arena').getBoundingClientRect(),controls=root.querySelector('.zp-controls').getBoundingClientRect();options.style.maxHeight=Math.max(60,Math.min(310,controls.top-arena.top-60))+'px';}else options.style.removeProperty('max-height');
    wireActions(root);if(resultsOpen)renderStats();
  }
  function playerResultHTML(p,h,position){
    const role=playerResultRole(h,p.id),isWinner=role==='winner',melds=(p.melds||[]).filter(m=>!m.initial),initial=(p.melds||[]).filter(m=>m.initial),meldIds=new Set(melds.flatMap(m=>m.cards)),hasCards=Array.isArray(p.hole),winningCard=isWinner?h.winCard:null,handGroups=isWinner&&h.groups?.length?h.groups.filter(m=>m.cards.every(c=>!meldIds.has(c))):null;
    const hand=handGroups?cardColumnsHTML(handGroups,winningCard,true):hasCards?cardColumnsHTML(handColumns([...p.hole,...initial.flatMap(m=>m.cards)].sort((a,b)=>a-b)),winningCard):'<span class="zp-old-record">旧记录未保存手牌</span>';
    return `<article class="zp-result-player ${position} ${role}" data-result-seat="${p.id}"><div class="zp-result-profile"><span class="zp-avatar">${esc(p.name[0])}</span><strong>${esc(p.name)}${p.id===g.mySeat?' · 你':''}</strong><span class="zp-role-tag">${isWinner?(h.selfDraw?'自摸胡':'胡牌'):role==='discarder'?'点炮':h.active?'进行中':h.draw?'黄庄':'未胡'}</span><b class="${p.delta>0?'positive':p.delta<0?'negative':''}">${signed(p.delta||0)}</b><small>累计 ${signed(p.score||0)} 分</small></div><div class="zp-result-card-zone"><div class="zp-result-zone"><span class="zp-zone-label">${hasCards?'手牌':'已知胡牌组合'}${handGroups?` · ${handGroups.reduce((s,m)=>s+(m.hu||0),0)} 胡`:''}</span><div class="zp-result-card-columns">${hand}</div></div><div class="zp-result-zone zp-result-table-zone"><span class="zp-zone-label">桌牌 · ${Array.isArray(p.melds)?melds.reduce((s,m)=>s+(m.hu||0),0)+' 胡':'旧记录未保存'}</span><div class="zp-result-card-columns">${cardColumnsHTML(melds,winningCard,true)||(Array.isArray(p.melds)?'<span class="zp-old-record">无副露</span>':'<span class="zp-old-record">旧记录未保存副露</span>')}</div></div></div></article>`;
  }
  function renderStats(){
    if(!g)return;const history=g.history||[],h=history.find(h=>h.hand===resultHand)||history[0]||null,select=$('#zp-result-round'),signature=room.code+':'+history.map(h=>h.hand+':'+h.draw).join(',');
    if(select.dataset.rounds!==signature){select.dataset.rounds=signature;select.innerHTML=history.length?history.map(h=>`<option value="${h.hand}">第 ${h.hand} 局${h.draw?' · 黄庄':''}</option>`).join(''):'<option>当前对局</option>';}if(h){resultHand=h.hand;select.value=String(h.hand);}
    const key=JSON.stringify([room.code,h?.hand??g.hand,h?.actions?.length??g.handLog?.length,!!h]);if(resultBoard.dataset.contentKey===key){renderStatsFooter();return;}resultBoard.dataset.contentKey=key;
    const display=resultLabels(h),players=h?.players||g.players.map(p=>({...p,delta:0})),bySeat=id=>players.find(p=>p.id===id),order=[g.mySeat,(g.mySeat+2)%3,(g.mySeat+1)%3];$('#zp-result-title').textContent=h?`第 ${h.hand} 局`:'本局进行中';
    const summary=h?settlementSummary(h,players,g.config.base):null;
    const headline=summary?.winnerName?'<span class="zp-summary-name" title="'+esc(summary.winnerName)+'">'+esc(summary.winnerName)+'</span>胡牌［'+(summary.sourceName?'<span class="zp-summary-source" title="'+esc(summary.sourceName)+'">'+esc(summary.sourceName)+'</span>':'')+esc(summary.sourceLabel)+'］ | '+esc(summary.counts):esc(summary?.headline);
    $('#zp-result-summary').innerHTML=summary?'<h3 aria-label="'+esc(summary.headline)+'">'+headline+'</h3><p class="zp-score-equation">'+esc(summary.formula)+'</p><p class="zp-score-ledger">'+summary.points.map(p=>'<span class="'+(p.delta>0?'positive':p.delta<0?'negative':'')+'" aria-label="'+esc(p.text||p.name+' '+signed(p.delta)+'分')+'" title="'+esc(p.name)+'"><span class="zp-ledger-name">'+esc(p.name)+'</span><b>'+esc(p.value||signed(p.delta)+'分')+'</b></span>').join('<i aria-hidden="true">|</i>')+'</p>':'<p>当前仅显示本人手牌与公开副露</p>';
    $('#zp-result-players').innerHTML=order.map((id,i)=>playerResultHTML(bySeat(id),h||{active:true},['self','left','right'][i])).join('');
    const outcome=h?.draw?`<div class="zp-wake-display zp-final-outcome"><strong>黄庄</strong><span>${h.drawPenalty?'庄家各付 '+h.drawPenalty+' 分':'庄家连庄'}</span></div>`:h?`<div class="zp-wake-display"><span class="zp-zone-label">自动翻醒</span>${h.wakes?.map(w=>`<div>${tile(w.card)}<small>${w.hits.map(hit=>`${esc(words[hit.type])} × ${hit.count}`).join(' · ')}</small></div>`).join('')||''}<strong>${h.wakeUnits||0}<em>醒</em></strong></div>`:'';
    const bottomCards=h?.remainingCards?.length?`<section class="zp-remaining-cards"><h3>底牌</h3><div>${h.remainingCards.map(c=>tile(c)).join('')}</div></section>`:'';
    $('#zp-result-bottom').innerHTML=outcome+bottomCards;
    const actions=h?.actions||g.handLog||[];$('#zp-result-log').innerHTML=actions.map(s=>`<li>${esc(s)}</li>`).join('');$('#zp-result-action-count').textContent=`${actions.length} 条`;
    renderStatsFooter();fitResultCards();
  }
  function renderStatsFooter(){const ranked=g.players.slice().sort((a,b)=>b.score-a.score);$('#zp-result-footer').innerHTML=g.finished?`<span class="zp-final-ranking">${ranked.map((p,i)=>`${i+1}. ${esc(p.name)} ${signed(p.score)} 分`).join('　')}</span><button class="button primary" data-zp-control="close-result">返回牌桌</button>`:g.street==='complete'?preparationHTML():'<span>对局进行中，查看统计不会代替玩家行动。</span><button class="button secondary" data-zp-control="close-result">返回牌桌</button>';wireActions(resultBoard);}
  function showStats(){if(!g)return;resultHand=g.history?.[0]?.hand??null;renderStats();if(!resultsOpen)openResults();fitResultCards();}
  function showEffect(event){
    const effects=$('#zp-effects'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(event.type==='deal'){root.classList.add('zp-dealing');effects.dataset.effect='deal';effects.innerHTML='<div class="zp-deal-motion" aria-hidden="true">'+Array.from({length:12},(_,i)=>'<i class="zp-tile zp-back" style="--i:'+i+';--seat:'+i%3+'"><span class="zp-face">K</span></i>').join('')+'</div>';return reduced?300:1500;}
    if(event.type==='flower'){effects.innerHTML='<div class="zp-wake-reveal zp-flower-effect">'+tile(80)+'<strong>飞飞</strong></div>';effects.dataset.effect='flower';return 1500;}
    if(event.type==='draw'||event.type==='discard'){effects.dataset.effect=event.type;$('#zp-current').classList.remove('zp-card-enter');void $('#zp-current').offsetWidth;$('#zp-current').classList.add('zp-card-enter');if(event.type==='draw')effects.innerHTML='<div class="zp-draw-motion '+positionOf(event.playerId)+'" aria-hidden="true">'+tile('?')+'</div>';return 600;}
    if(event.type==='meld'){effects.innerHTML=`<div class="zp-seat-callout ${positionOf(event.playerId)}">${esc(labels[event.kind]||'成组')}</div>`;effects.dataset.effect='meld';return 540;}
    if(event.type==='pass'||event.silent)return 0;
    if(event.type==='wake'){effects.innerHTML=`<div class="zp-wake-reveal"><small>自动翻醒 · 本张 ${event.units} 醒</small>${tile(event.card)}<strong>${g.wakes.reduce((s,w)=>s+w.hits.reduce((n,h)=>n+h.count,0),0)}<em>醒</em></strong></div>`;effects.dataset.effect='wake';return 1400;}
    if(event.type!=='settle'&&event.type!=='hu')return 220;const h=g.result||g.wake,key=room.code+':'+g.hand;if(lastEffect===key)return 200;lastEffect=key;const display=resultLabels(h);effects.dataset.effect=display.kind;
    effects.innerHTML=h.draw?'<div class="zp-win-effect draw"><strong>黄庄</strong><small>庄家继续坐庄</small></div>':`<div class="zp-win-halo" aria-hidden="true"></div><div class="zp-win-effect ${display.kind}"><span class="zp-effect-kicker">${esc(g.players[h.winner].name)}</span><strong>${display.title}</strong><span class="zp-effect-seal">胡</span><small>${h.hu} 胡 · ${g.street==='wake'?'自动翻醒':h.units+' 子'}</small></div>${Number.isInteger(h.discarder)?`<div class="zp-seat-callout zp-discard-callout ${positionOf(h.discarder)}"><strong>点炮</strong><small>${esc(g.players[h.discarder].name)}</small></div>`:''}${h.winCard!==null&&h.winCard!==undefined?`<div class="zp-effect-card">${tile(h.winCard,{winning:true})}</div>`:''}<div class="zp-sparks" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i style="--angle:${i*30}deg;--delay:${i%3*70}ms"></i>`).join('')}</div>`;return reduced?550:1900;
  }
  async function consume(data,ack){
    if(data.rulesUpdated)toast('飞飞规则已更新，已恢复到手牌');
    if(data.actionExpired)toast('响应时间已结束，已同步当前牌桌');
    const previousRoom=room?.code;room=data.room;document.body.dataset.screen='zipai';if(previousRoom!==room.code){lastReport='';lastEffect='';resultHand=null;$('#zp-effects').replaceChildren();if(resultsOpen)closeResults();}if(data.unchanged){renderControls();return;}
    let actions=g?.handLog||[],hand=g?.hand;
    for(const frame of data.frames||[]){if(frame.event.silent||frame.event.type==='pass'){ack?.(frame.id);continue;}if(hand!==frame.game.hand){hand=frame.game.hand;actions=[];if(resultsOpen)closeResults();}actions=[...actions,frame.event.text];g={...frame.game,handLog:actions};render();$('#zp-notice').textContent=frame.event.text;const duration=Math.max(showEffect(frame.event),actionPause(frame.event,g.players));await visibleDelay(duration);root.classList.remove('zp-dealing');$('#zp-effects').replaceChildren();ack?.(frame.id);}
    if(data.game)g=data.game;render();$('#zp-notice').textContent=g.handLog?.at(-1)||'牌局已连接';const key=room.code+':'+g.hand;if(g.street==='complete'&&lastReport!==key){lastReport=key;showStats();}
  }
  function updateClocks(){
    const active=g&&room&&room.turnUntil&&!['complete','wake'].includes(g.street),offset=Number.isFinite(room?.receivedAt)?room.serverTime-room.receivedAt:0,diff=Date.now()+offset-(room?.turnUntil||0);
    for(const clock of root.querySelectorAll('[data-clock-seat]')){const shown=active&&Number(clock.dataset.clockSeat)===g.turn;clock.hidden=!shown;if(!shown)continue;const over=diff>=0;clock.classList.toggle('overdue',over);clock.classList.toggle('long',over&&diff>=1000000);clock.textContent=(over?'+'+Math.floor(diff/1000):Math.min(30,Math.ceil(-diff/1000)));clock.setAttribute('aria-label',over?'超时 '+Math.floor(diff/1000)+' 秒':'剩余 '+Math.ceil(-diff/1000)+' 秒');}
  }
  setInterval(()=>{if(document.body.dataset.screen==='zipai')updateClocks();},250);
  return {consume,setPending(value){pending=value;if(document.body.dataset.screen==='zipai')renderControls();},openSettings(){form.reset();$('#zp-settings-error').textContent='';$('#zp-settings-summary').textContent=zipaiSummary(settings());dialog.showModal();},showRules};
}
