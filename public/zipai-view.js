// Only receives a server-redacted view. This module never imports the game engine.
export const seatPosition = (id, self) =>
  id === self ? "self" : id === (self + 2) % 3 ? "left" : "right";
export function tableModel(game, room) {
  const self = game.mySeat;
  return {
    hand: game.hand,
    phase: game.street,
    self,
    roomCode: room.code,
    seats: ["self", "left", "right"].map((position, i) => {
      const p = game.players[[self, (self + 2) % 3, (self + 1) % 3][i]];
      return { ...p, position, publicMelds: p.melds.filter((m) => !m.initial) };
    }),
    legal: game.legal ?? null,
    current: game.current,
    remaining: game.remaining,
  };
}
export function actionModel(legal, selected) {
  if (!legal) return [];
  const actions = [];
  const chi = legal.options.filter((o) => o.kind === "chi");
  if (chi.length)
    actions.push({ id: "choose-chi", label: "吃", primary: true });
  for (const o of legal.options.filter((o) => o.kind !== "chi"))
    actions.push({
      id: o.id,
      label:
        { peng: "碰", sao: "扫", guosao: "过扫", chuan: "扫穿", kai: "开招" }[
          o.kind
        ] || "确认",
      option: true,
      primary: true,
    });
  if (legal.hu) actions.push({ id: "hu", label: "胡", primary: true });
  if (legal.pass) actions.push({ id: "pass", label: "过" });
  if (legal.discard.length)
    actions.push({
      id: "discard",
      label: "出牌",
      primary: true,
      disabled: !legal.discard.includes(selected),
    });
  return actions;
}
