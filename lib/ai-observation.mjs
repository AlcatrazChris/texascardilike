// An allowlist boundary, not a masked copy of the engine. Never read the deck,
// opponents' hole cards, previous private hands, room credentials or future boards.
const observations=new WeakSet();
export function decisionObservation(g){
  if(observations.has(g))return g;
  const players=g.players.map(p=>Object.freeze({id:p.id,name:p.name,human:p.human,out:p.out,folded:p.folded,sittingOut:p.sittingOut,stack:p.stack,bet:p.bet,total:p.total,action:p.action,difficulty:p.difficulty,handRaises:p.handRaises||0,streetRaises:p.streetRaises||0,hole:Object.freeze(p.id===g.turn?[...p.hole]:[])}));
  const budget={hand:g.hand,calls:g.aiBudget?.hand===g.hand?g.aiBudget.calls:0};
  const snapshot=Object.freeze({hand:g.hand,turn:g.turn,street:g.street,board:Object.freeze([...g.board]),players:Object.freeze(players),config:Object.freeze({...g.config}),bb:g.bb,sb:g.sb,dealer:g.dealer,currentBet:g.currentBet,lastRaise:g.lastRaise,lastAggressor:g.lastAggressor,raises:g.raises,log:Object.freeze([...(g.log||[])]),aiBudget:budget});
  observations.add(snapshot);return snapshot;
}
export function keepAIBudget(g,observation){
  const value=observation.aiBudget?.calls,previous=g.aiBudget?.hand===g.hand?g.aiBudget.calls:0;
  g.aiBudget={hand:g.hand,calls:Math.max(previous,Number.isSafeInteger(value)?Math.min(12,Math.max(0,value)):previous)};
}
