// Multiples are total street contributions, never an extra amount on top of a call.
export function multipleBet(multiplier, legal, currentBet, bigBlind) {
  if(!legal?.canRaise || ![2,3,4].includes(Number(multiplier))) return null;
  const target=Math.max(currentBet,bigBlind)*Number(multiplier);
  return Math.min(legal.max,Math.max(Math.min(legal.min,legal.max),target));
}
export function betError(value, legal, currentBet) {
  if(!legal?.canRaise) return '当前不能加注，请选择跟注、过牌或弃牌。';
  const amount=Number(value);
  if(!/^\d+$/.test(String(value).trim()) || !Number.isSafeInteger(amount) || amount<=0) return '请输入大于 0 的整数筹码数量。';
  if(amount>legal.max) return legal.max<legal.allIn?`当前限注规则最多允许加注至 ${legal.max.toLocaleString('zh-CN')}。`:`筹码不足，最多可加注至 ${legal.max.toLocaleString('zh-CN')}。`;
  if(amount<=currentBet) return `加注后的本轮总投入必须大于 ${currentBet.toLocaleString('zh-CN')}；如需跟注，请使用「跟注」按钮。`;
  if(amount<legal.min && amount!==legal.allIn) return `最低需要加注至 ${legal.min.toLocaleString('zh-CN')}，只有投入全部剩余筹码时才允许不足额全下。`;
  return '';
}
