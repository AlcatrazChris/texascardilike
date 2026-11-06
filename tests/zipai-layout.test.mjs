import test from "node:test";
import assert from "node:assert/strict";
import { computeLayout, overlaps, UI_LIMITS } from "../public/zipai-layout.js";
import { motionPath } from "../public/zipai-motion.js";
const sizes = [
  [320, 568],
  [360, 600],
  [390, 640],
  [390, 844],
  [430, 932],
  [844, 320],
  [844, 390],
  [1024, 768],
  [1366, 768],
  [1715, 1012],
];
for (const [width, height] of sizes)
  test(`统一布局 ${width}×${height} 的固定区域、尺寸与安全区`, () => {
    const input = {
        width,
        height,
        columns: 22,
        publicCounts: [6, 6, 6],
        discardCounts: [18, 18, 18],
        safeArea: { top: 4, bottom: 8, left: 3, right: 3 },
      },
      l = computeLayout(input);
    assert.deepEqual(l, computeLayout(input));
    assert.ok(l.cards.publicSize.width >= UI_LIMITS.publicMin);
    assert.ok(l.cards.handSize.width >= 24);
    assert.ok(l.overflow.hand);
    const regions = [
      ...Object.values(l.seats).flatMap((s) => [s.profile, s.public, s.clock]),
      l.regions.hand,
      l.regions.actionBar,
      l.regions.current,
      l.regions.deck,
    ];
    for (const r of regions) {
      assert.ok(
        r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= width + 1 &&
          r.y + r.height <= height + 1,
        JSON.stringify({ width, height, r }),
      );
      for (const other of regions)
        if (r !== other)
          assert.ok(
            !overlaps(r, other),
            JSON.stringify({ width, height, r, other }),
          );
    }
    const path = motionPath(l, { type: "draw", playerId: 2 }, 0);
    assert.deepEqual(path.from, l.anchors.deck);
    assert.deepEqual(path.to, l.anchors.currentCard);
  });
