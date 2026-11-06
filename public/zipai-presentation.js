export const words=[...'一二三四五六七八九十',...'壹贰叁肆伍陆柒捌玖拾'];
export const typeOf=card=>card>=100&&card<120?card-100:Math.floor(card/4);
export const cardName=card=>card===80?'飞飞':words[typeOf(card)]||'';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const meldLabels={chi:'吃',peng:'碰',sao:'扫',guosao:'过扫',kan:'坎',kai:'开招',chuan:'扫穿',pair:'对',single:'散牌'};

export function scoreFormula(h,base=1){
  if(!h||h.draw)return h?.drawPenalty?`黄庄：庄家向两位闲家各付 ${h.drawPenalty} 分`:'本局黄庄，不计分';
  const wake=h.wakeUnits-(h.sea?2:0),parts=`基础 ${h.baseUnits}${h.special?' + '+h.special+' 1':''} + 醒 ${wake}${h.sea?' + 海底 2':''}`;
  if(h.scoringVersion>=2)return `${h.selfDraw?'（':''}${parts}${h.selfDraw?'）× 自摸 2':''} = ${h.units} 子 × 底分 ${base}${h.discardMultiplier===2?' × 点炮 2':''}`;
  return `基础 ${h.baseUnits}${h.selfDraw?' + 自摸 1':''}${h.special?' + '+h.special+' 1':''} + 醒 ${wake}${h.sea?' + 海底 2':''} = ${h.units} 子 × 底分 ${base}`;
}

export function settlementSummary(h,players=[],base=1){
  const number=new Intl.NumberFormat('zh-CN'),fmt=n=>number.format(n||0),signed=n=>(n>=0?'+':'−')+fmt(Math.abs(n));
  const points=players.map(p=>({name:p.name,delta:p.delta??h?.delta?.[p.id]??0}));
  if(h.draw)return {headline:'黄庄 | 庄家连庄',formula:h.drawPenalty?`庄家向闲家各付 ${fmt(h.drawPenalty)} 分`:'本局不计分',points};
  const winner=players.find(p=>p.id===h.winner),source=h.selfDraw?'自摸胡牌':Number.isInteger(h.discarder)?`${players.find(p=>p.id===h.discarder)?.name||'玩家'}点炮`:'公牌胡牌';
  const terms=`胡子${fmt(h.baseUnits)} + 翻醒${fmt(h.wakeUnits-(h.sea?2:0))}${h.special?' + '+h.special+'1':''}${h.sea?' + 海底2':''}`,unit=h.scoringVersion>=2?(h.selfDraw?`（${terms}）× 自摸2`:terms):`${terms}${h.selfDraw?' + 自摸1':''}`;
  return {winnerName:winner?.name||'玩家',sourceName:Number.isInteger(h.discarder)?players.find(p=>p.id===h.discarder)?.name||'玩家':null,sourceLabel:h.selfDraw?'自摸胡牌':Number.isInteger(h.discarder)?'点炮':'公牌胡牌',counts:`${fmt(h.hu)}胡${fmt(h.wakeUnits)}醒`,headline:`${winner?.name||'玩家'}胡牌［${source}］ | ${fmt(h.hu)}胡${fmt(h.wakeUnits)}醒`,formula:`${unit} = ${fmt(h.units)}子　底分${fmt(base)}${h.discardMultiplier===2?' × 点炮2':''}　总${fmt(h.delta?.[h.winner]??winner?.delta)}分`,points:points.map(p=>({...p,text:`${p.name} ${signed(p.delta)}分`,value:signed(p.delta)+'分'}))};
}

export function tileHTML(card,{winning=false}={}){
  if(card===80)return `<span class="zp-tile zp-flower zp-red" role="img" aria-label="飞飞，万能牌"><svg viewBox="0 0 50 90" aria-hidden="true"><path fill="currentColor" d="M30 12q-12-12-13 1l-7 5 9 3q-7 10-3 23L5 63l16-7-3 20h4l5-17 5 18h4l-3-24q20-12 9-32l-3 18-9-13 1-7 9-2-8-3z"/><circle cx="24" cy="16" r="1.5" fill="white"/></svg><small>飞飞</small></span>`;
  const back=card==='?',t=typeOf(card),text=back?'字':cardName(card),red=!back&&[1,6,9].includes(t%10);
  const wild=card>=100&&card<120;
  return `<span class="zp-tile${back?' zp-back':''}${red?' zp-red':''}${winning?' zp-winning-card':''}" role="img" aria-label="${back?'隐藏字牌':(wild?'飞飞作':'')+(t>=10?'大字':'小字')+text}${winning?'，胡牌张':''}"><span class="zp-face">${text}</span><span class="zp-face-reverse" aria-hidden="true">${text}</span>${wild?'<span class="zp-wild-tag" aria-hidden="true">飞</span>':''}${winning?'<span class="zp-win-tag" aria-hidden="true">胡</span>':''}</span>`;
}

export function handColumns(cards){
  const groups=[];for(const card of cards){const last=groups.at(-1);if(last&&typeOf(last[0])===typeOf(card))last.push(card);else groups.push([card]);}
  const columns=[];for(const group of groups){const last=columns.at(-1);if(last&&last.length+group.length<=3)last.push(...group);else columns.push(group.slice());}return columns;
}

export function resultLabels(result){
  if(!result||result.draw)return {title:'黄庄',subtitle:'无人胡牌 · 庄家继续坐庄',kind:'draw'};
  if(result.selfDraw||result.winKind==='self-draw')return {title:'自摸',subtitle:result.special||'胡牌 · 两家支付',kind:'self-draw'};
  if(result.winKind==='discard'||Number.isInteger(result.discarder))return {title:'胡牌',subtitle:result.special||'点炮胡 · 点炮者支付',kind:'discard'};
  return {title:result.special||'胡牌',subtitle:result.winKind==='opening'?'起手胡牌 · 两家支付':result.winKind==='public-draw'?'公开摸牌胡 · 两家支付':'本局胡牌',kind:'public-draw'};
}

export function playerResultRole(record,id){
  if(record?.draw)return 'draw';if(record?.winner===id)return 'winner';return record?.discarder===id?'discarder':'other';
}
