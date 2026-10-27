import { randomInt } from 'node:crypto';
const SUITS = ['s', 'h', 'd', 'c'];
const HANDS = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export function deck() {
  const d = SUITS.flatMap(s => Array.from({ length: 13 }, (_, i) => `${i + 2}${s}`));
  return shuffle(d);
}
export function shuffle(cards,rng=randomInt){const d=[...cards];for(let i=d.length-1;i>0;i--){const j=rng(i+1);if(!Number.isInteger(j)||j<0||j>i)throw new Error('Invalid shuffle RNG');[d[i],d[j]]=[d[j],d[i]];}return d;}
export function compare(a, b) { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return Math.sign(d); } return 0; }
function five(cards) {
  const ranks = cards.map(c => parseInt(c)).sort((a,b) => b-a);
  const groups = [...new Set(ranks)].map(r => [ranks.filter(x => x === r).length, r]).sort((a,b) => b[0]-a[0] || b[1]-a[1]);
  const flush = cards.every(c => c.at(-1) === cards[0].at(-1));
  const unique = [...new Set(ranks)];
  const straight = unique.length === 5 && unique[0]-unique[4] === 4 ? unique[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0;
  if (flush && straight) return [8, straight];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][0] === 3) return [3, ...groups.map(g=>g[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...groups.map(g=>g[1])];
  if (groups[0][0] === 2) return [1, ...groups.map(g=>g[1])];
  return [0, ...ranks];
}
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error('需要 5–7 张牌');
  let best = [-1], selected = [];
  for (let a=0;a<cards.length-4;a++) for (let b=a+1;b<cards.length-3;b++) for (let c=b+1;c<cards.length-2;c++) for (let d=c+1;d<cards.length-1;d++) for (let e=d+1;e<cards.length;e++) {
    const set = [cards[a],cards[b],cards[c],cards[d],cards[e]], rank = five(set);
    if (compare(rank, best) > 0) { best = rank; selected = set; }
  }
  return { rank: best, name: HANDS[best[0]], cards: selected };
}
