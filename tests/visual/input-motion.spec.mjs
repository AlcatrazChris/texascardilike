import { test, expect } from "@playwright/test";
import { fixture, mount, feed } from "./fixtures.mjs";
test("五张一笔、触控拖拽、取消、22列和轮询节点复用", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "触控 CDP 检查仅适用于 Chromium");
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  const cdp = await page.context().newCDPSession(page);
  const columns = await page
      .locator("[data-zp-column]")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          id: n.dataset.zpColumn,
          cards: [...n.querySelectorAll("[data-zp-card]")].map((b) =>
            Number(b.dataset.zpCard),
          ),
        })),
      ),
    target = columns.find((c) => c.cards.length >= 2 && c.cards.length <= 3);
  for (let i = target.cards.length; i < 5; i++) {
    const source = page
      .locator(
        `[data-zp-column]:not([data-zp-column="${target.id}"]) [data-zp-card]`,
      )
      .first();
    await source.scrollIntoViewIfNeeded();
    const r = await source.boundingBox();
    await page
      .locator(`[data-zp-column="${target.id}"]`)
      .scrollIntoViewIfNeeded();
    const end = await page
      .locator(`[data-zp-column="${target.id}"] [data-zp-card]`)
      .last()
      .boundingBox();
    const a = { x: r.x + r.width / 2, y: r.y + 8 },
      b = { x: end.x + end.width / 2, y: end.y + end.height - 8 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...a, id: 0 }],
    });
    for (let n = 1; n <= 5; n++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: a.x + ((b.x - a.x) * n) / 5,
            y: a.y + ((b.y - a.y) * n) / 5,
            id: 0,
          },
        ],
      });
    await expect(page.locator(".zp-drag-ghost")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await expect(
    page.locator(`[data-zp-column="${target.id}"] [data-zp-card]`),
  ).toHaveCount(5);
  expect(await page.evaluate(() => commands.length)).toBe(0);
  const card = page.locator("[data-zp-card]").first(),
    r = await card.boundingBox();
  await page.mouse.move(r.x + 10, r.y + 8);
  await page.mouse.down();
  await page.mouse.move(r.x + 60, r.y - 20);
  await expect(page.locator(".zp-drag-ghost")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".zp-drag-ghost")).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => commands.length)).toBe(0);
  await page.evaluate(() => {
    window.profile = document.querySelector(".zp-player");
    window.handNode = document.querySelector("[data-zp-card]");
  });
  for (let i = 0; i < 60; i++)
    await page.evaluate(() => ui.consume({ ...lastData, unchanged: true }));
  expect(
    await page.evaluate(
      () =>
        profile === document.querySelector(".zp-player") &&
        handNode === document.querySelector("[data-zp-card]"),
    ),
  ).toBeTruthy();
  // 21 singleton columns plus an empty slot: 22 retained layout columns, no tiny fan.
  await page.evaluate(() => {
    const d = lastData,
      key = d.room.code + ":0:" + d.game.dealId;
    localStorage.setItem(
      "river-zipai-layouts",
      JSON.stringify({
        [key]: {
          columns: [
            ...d.game.players[0].hole.map((card, i) => ({
              id: "c" + i,
              cards: [card],
            })),
            { id: "empty", cards: [] },
          ],
          nextId: 30,
        },
      }),
    );
    ui.dispose();
  });
  await mount(page);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page
      .locator(".zp-hand-card .zp-tile")
      .first()
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(30);
  expect(
    await page
      .locator("#zp-hand-cards")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  ).toBeTruthy();
  await page.locator("[data-zp-card]").last().scrollIntoViewIfNeeded();
  await expect(page.locator("[data-zp-card]").last()).toBeInViewport();
});
test("真实锚点、动画取消、顺序翻醒、读牌与合法动作解耦", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(1794000000000) });
  await mount(page);
  await page.clock.pauseAt(new Date(1794000005000));
  const d = fixture(),
    frame = {
      id: 101,
      event: {
        type: "draw",
        playerId: 2,
        card: "?",
        text: "桂花 · 摸牌（暗牌）",
      },
      game: d.game,
    };
  await page.evaluate(
    (d) =>
      ui.consume({
        ...d,
        frames: [
          {
            id: 101,
            event: {
              type: "draw",
              playerId: 2,
              card: "?",
              text: "桂花 · 摸牌（暗牌）",
            },
            game: d.game,
          },
        ],
      }),
    d,
  );
  await expect(page.locator(".zp-motion-card")).toHaveCount(1);
  const path = await page
      .locator(".zp-motion-card")
      .evaluate((e) => ({
        from: JSON.parse(e.dataset.from),
        to: JSON.parse(e.dataset.to),
      })),
    layout = await page.evaluate(() => ui.inspectLayout());
  expect(path.from).toEqual(layout.anchors.deck);
  expect(path.to).toEqual(layout.anchors.currentCard);
  await expect(page.locator(".zp-motion-card .zp-tile")).toHaveAttribute(
    "aria-label",
    "隐藏字牌",
  );
  await page.locator(".zp-motion-card").evaluate((e) => {
    for (const a of e.getAnimations()) {
      a.pause();
      a.currentTime = 190;
    }
  });
  await expect(page.locator("#zipai-screen")).toHaveScreenshot(
    "motion-midpoint.png",
    { animations: "allow" },
  );
  // A legal command interrupts cosmetics and is sent once; it does not wait for the read timer.
  await page.locator('[data-zp-card="4"]').click();
  await page.locator("[data-zp-control=discard]").click();
  await expect(page.locator(".zp-motion-card")).toHaveCount(0);
  expect(await page.evaluate(() => commands.length)).toBe(1);
  const result = fixture("repeat");
  await page.evaluate(
    (result) => ui.consume({ ...result, frames: result.recordedFrames }),
    result,
  );
  await expect(page.locator("#zipai-result-board")).toBeHidden();
  await page.clock.runFor(1150);
  await expect(page.locator("#zp-effects")).toHaveAttribute(
    "data-effect",
    "wake",
  );
  expect(await page.locator(".zp-motion-reveal .zp-tile").count()).toBe(1);
  for (let n = 0; n < result.recordedFrames.length + 2; n++)
    await page.clock.runFor(1150);
  await page.evaluate(() => ui.whenIdle());
  await expect(page.locator("#zipai-result-board")).toBeVisible();
  expect(await page.locator(".zp-wake-display .zp-tile").count()).toBe(
    result.game.wakes.length,
  );
});
