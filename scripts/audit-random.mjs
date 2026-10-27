import {deck} from '../lib/cards.mjs';
const trials=20000,counts=new Map(deck().map(c=>[c,0]));let pairs=0;
const start=performance.now();
for(let i=0;i<trials;i++){const cards=deck();if(new Set(cards).size!==52)throw new Error('Repeated card');const first=cards.at(-1);counts.set(first,counts.get(first)+1);if(parseInt(first)===parseInt(cards.at(-2)))pairs++;}
const expected=trials/52,chiSquare=[...counts.values()].reduce((n,count)=>n+(count-expected)**2/expected,0);
console.log(JSON.stringify({trials,firstCardExpected:expected,firstCardMin:Math.min(...counts.values()),firstCardMax:Math.max(...counts.values()),chiSquare,chiSquareDegreesOfFreedom:51,pocketPairObserved:pairs/trials,pocketPairExpected:3/51,milliseconds:Math.round(performance.now()-start),note:'Descriptive sampling only; neither a randomness certificate nor evidence that a server cannot alter a deck.'},null,2));
