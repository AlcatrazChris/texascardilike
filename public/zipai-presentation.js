export const words=[...'一二三四五六七八九十',...'壹贰叁肆伍陆柒捌玖拾'];
export const typeOf=card=>Math.floor(card/4);
export const cardName=card=>words[typeOf(card)]||'';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const meldLabels={chi:'吃',peng:'碰',sao:'扫',guosao:'过扫',kan:'坎',kai:'开舵',chuan:'扫穿',pair:'对',single:'散牌'};

export function tileHTML(card,{winning=false}={}){
  const back=card==='?',t=typeOf(card),text=back?'字':cardName(card),red=!back&&[1,6,9].includes(t%10);
  return `<span class="zp-tile${back?' zp-back':''}${red?' zp-red':''}${winning?' zp-winning-card':''}" role="img" aria-label="${back?'隐藏字牌':(t>=10?'大字':'小字')+text}${winning?'，胡牌张':''}"><span class="zp-face">${text}</span><span class="zp-face-reverse" aria-hidden="true">${text}</span>${winning?'<span class="zp-win-tag" aria-hidden="true">胡</span>':''}</span>`;
}

export function handColumns(cards){
  const groups=[];for(const card of cards){const last=groups.at(-1);if(last&&typeOf(last[0])===typeOf(card))last.push(card);else groups.push([card]);}
  const columns=[];for(const group of groups){const last=columns.at(-1);if(last&&last.length+group.length<=3)last.push(...group);else columns.push(group.slice());}return columns;
}

export function resultLabels(result){
  if(!result||result.draw)return {title:'荒庄',subtitle:'无人胡牌 · 庄家继续坐庄',kind:'draw'};
  if(result.selfDraw||result.winKind==='self-draw')return {title:'自摸',subtitle:result.special||'胡牌 · 两家支付',kind:'self-draw'};
  if(result.winKind==='discard'||Number.isInteger(result.discarder))return {title:'胡牌',subtitle:result.special||'点炮胡 · 点炮者支付',kind:'discard'};
  return {title:result.special||'胡牌',subtitle:result.winKind==='opening'?'起手胡牌 · 两家支付':result.winKind==='public-draw'?'公开摸牌胡 · 两家支付':'本局胡牌',kind:'public-draw'};
}

export function playerResultRole(record,id){
  if(record?.draw)return 'draw';if(record?.winner===id)return 'winner';return record?.discarder===id?'discarder':'other';
}
