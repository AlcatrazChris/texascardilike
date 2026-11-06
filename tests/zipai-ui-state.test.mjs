import test from "node:test";
import assert from "node:assert/strict";
import { createInputState, INPUT_STATES } from "../public/zipai-input.js";
import { actionModel, tableModel } from "../public/zipai-view.js";
import { computeLayout } from "../public/zipai-layout.js";
import { motionPath } from "../public/zipai-motion.js";
test("输入状态和动作模型不修改规则数据，非法按钮不会被启用", () => {
  const s = createInputState();
  assert.equal(s.phase, "idle");
  for (const p of INPUT_STATES) assert.equal(s.set(p), p);
  assert.throws(() => s.set("unknown"));
  const legal = Object.freeze({
    discard: [4],
    hu: false,
    pass: false,
    options: Object.freeze([]),
  });
  assert.equal(actionModel(legal, null)[0].disabled, true);
  assert.equal(actionModel(legal, 4)[0].disabled, false);
  assert.deepEqual(actionModel(null, 4), []);
});
test("布局锚点只应用一次安全区偏移，发牌/成组轨迹来自同一模型", () => {
  const a = computeLayout({ width: 1024, height: 768 }),
    b = computeLayout({
      width: 1044,
      height: 798,
      safeArea: { left: 10, right: 10, top: 20, bottom: 10 },
    });
  for (const k of ["self", "left", "right", "deck", "currentCard"]) {
    assert.equal(b.anchors[k].x - a.anchors[k].x, 10);
    assert.equal(b.anchors[k].y - a.anchors[k].y, 20);
  }
  assert.deepEqual(
    motionPath(b, { type: "meld", playerId: 2 }, 0).to,
    b.anchors.leftPublic,
  );
});
test("ViewModel 仅保留已脱敏的字段，起手一笼仍不进入公开区", () => {
  const players = Array.from({ length: 3 }, (_, id) => ({
      id,
      name: "P" + id,
      hole: id ? ["?"] : [4],
      melds: [
        { initial: true, cards: ["?"] },
        { concealed: true, cards: ["?"], hu: null },
      ],
      discards: [],
    })),
    game = {
      mySeat: 0,
      players,
      current: { card: "?", concealed: true },
      hand: 1,
      street: "respond",
      legal: null,
    };
  const m = tableModel(game, { code: "123456" });
  assert.deepEqual(m.seats[1].hole, ["?"]);
  assert.equal(m.seats[1].publicMelds.length, 1);
  assert.deepEqual(m.seats[1].publicMelds[0].cards, ["?"]);
  assert.equal(m.current.card, "?");
  assert.equal(m.legal, null);
});
