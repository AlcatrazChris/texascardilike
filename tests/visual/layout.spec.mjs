import { test, expect } from "@playwright/test";
import { fixture, mount, feed, viewports } from "./fixtures.mjs";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(1794000000000));
});
for (const [width, height] of viewports)
  test(`布局与截图 ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mount(page);
    const screen = page.locator("#zipai-screen");
    await expect(screen).toBeVisible();
    for (const kind of ["opening", "dense"]) {
      await feed(page, fixture(kind));
      await page.clock.runFor(30);
      if (process.env.ZIPAI_VISUAL_CANARY)
        await page
          .locator("#zp-name")
          .evaluate((e) => (e.style.color = "#ff00ff"));
      await expect(page.locator("#zp-room")).toHaveText("房间 123456");
      await expect(page.locator("#zp-notice")).toHaveText(
        "固定牌局 · 等待行动",
      );
      await expect(page.locator(".zp-actions .button").first()).toHaveCSS(
        "font-size",
        width > height && height < 610 ? "20px" : "22px",
      );
      const m = await page.evaluate(() => {
        const r = (e) => {
            const a = e.getBoundingClientRect();
            return {
              x: a.x,
              y: a.y,
              width: a.width,
              height: a.height,
              right: a.right,
              bottom: a.bottom,
            };
          },
          q = (s) => document.querySelector(s),
          profiles = [...q("#zipai-screen").querySelectorAll(".zp-player")];
        return {
          profiles: profiles.map(r),
          regions: [
            ...profiles,
            ...q("#zipai-screen").querySelectorAll(
              ".zp-opponent .zp-public,.zp-self-melds,.zp-hand-area,.zp-controls",
            ),
          ].map(r),
          tileWidths: [
            ...q("#zipai-screen").querySelectorAll(".zp-meld .zp-tile"),
          ].map((e) => r(e).width),
          overflow: document.documentElement.scrollWidth > innerWidth,
          hand:
            q("#zp-hand-cards").scrollWidth > q("#zp-hand-cards").clientWidth,
        };
      });
      expect(m.overflow).toBeFalsy();
      expect(
        new Set(m.profiles.map((p) => p.width + ":" + p.height)).size,
      ).toBe(1);
      expect(m.tileWidths.every((w) => w >= 20)).toBeTruthy();
      expect(await page.evaluate(() => {
        const meld = document.querySelector('.zp-meld .zp-tile');
        const discarded = document.querySelector('.zp-discards .zp-tile');
        if (!meld || !discarded) return true;
        const a = meld.getBoundingClientRect(), b = discarded.getBoundingClientRect();
        return Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1;
      }), '亮牌与过张使用相同尺寸').toBeTruthy();
      for (const selector of ["#zp-stats", "#zp-rules", "#zp-exit", "#zp-copy"])
        expect(
          await page.locator(selector).evaluate((b) => {
            const r = b.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth + 1 &&
              document
                .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
                ?.closest("button") === b
            );
          }),
          selector + " is intercepted",
        ).toBeTruthy();
      for (const a of m.regions) {
        expect(a.x).toBeGreaterThanOrEqual(-1);
        expect(a.right).toBeLessThanOrEqual(width + 1);
        expect(a.bottom).toBeLessThanOrEqual(height + 1);
        for (const b of m.regions)
          if (a !== b)
            expect(
              Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
              JSON.stringify({ width, height, a, b }),
            ).toBeFalsy();
      }
      await expect(screen).toHaveScreenshot(`${kind}-${width}x${height}.png`);
    }
    // Public disclosure remains readable without revealing more than the supplied view.
    await page.locator('[data-zp-public="0"]').first().click();
    await expect(page.locator(".zp-public-dialog")).toBeVisible();
    await expect(page.locator(".zp-public-dialog .zp-tile").first()).toHaveCSS(
      "width",
      "30px",
    );
    await page.locator("[data-close-public]").click();
    await feed(page, fixture("result"));
    await expect(page.locator("#zipai-result-board")).toBeVisible();
    expect(await page.locator(".zp-result-player").count()).toBe(3);
    expect(await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.zp-result-player,.zp-result-summary,.zp-result-bottom')];
      const boxes = nodes.map(n=>n.getBoundingClientRect());
      return boxes.every((a,i)=>boxes.every((b,j)=>i===j ||
        Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1 ||
        Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1));
    }), '结算三家、摘要与翻醒底牌互不重叠').toBeTruthy();
    await expect(screen).toHaveScreenshot(`result-${width}x${height}.png`);
    for (const seat of [0, 1, 2]) {
      await page
        .locator(`[data-result-seat="${seat}"]`)
        .scrollIntoViewIfNeeded();
      await expect(page.locator(`[data-result-seat="${seat}"]`)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
test("选择器、稳定节点、单次提交和手牌输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, "chi");
  await page.locator("[data-zp-control=choose-chi]").click();
  await expect(page.locator('[data-zp-option^="chi:"]')).toHaveCount(2);
  await expect(page.locator("#zipai-screen")).toHaveScreenshot(
    "chi-picker.png",
  );
  await page.evaluate(() => {
    document.querySelector("#zp-options").scrollTop = 40;
    window.oldProfile = document.querySelector(".zp-player");
  });
  await feed(page, fixture("chi"));
  expect(
    await page.evaluate(
      () => window.oldProfile === document.querySelector(".zp-player"),
    ),
  ).toBeTruthy();
  await page.locator('[data-zp-option^="chi:"]').first().click();
  expect(await page.evaluate(() => commands.length)).toBe(1);
  await feed(page, fixture("hu"));
  await page.locator("[data-zp-control=hu]").click();
  await expect(page.locator(".zp-hu-choice")).toHaveCount(2);
  await expect(page.locator("#zipai-screen")).toHaveScreenshot("hu-picker.png");
  await page.keyboard.press("Escape");
  await expect(page.locator("#zp-options")).toBeHidden();
  await feed(page, fixture());
  const card = page.locator('[data-zp-card="4"]');
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(card).toBeFocused();
  await page.evaluate(() => {
    window.before = [...document.querySelectorAll("[data-zp-column]")].map(
      (c) => c.textContent,
    );
  });
  await feed(page, fixture());
  expect(
    await page.evaluate(
      () =>
        JSON.stringify(before) ===
        JSON.stringify(
          [...document.querySelectorAll("[data-zp-column]")].map(
            (c) => c.textContent,
          ),
        ),
    ),
  ).toBeTruthy();
  await page.locator('[data-zp-card="8"]').click();
  await page.evaluate(() => {
    commands = [];
    const b = document.querySelector("[data-zp-control=discard]");
    b.click();
    b.click();
  });
  expect(await page.evaluate(() => commands.length)).toBe(1);
  const single = fixture("single-chi");
  expect(single.game.legal.options).toHaveLength(1);
  await feed(page, single);
  await page.evaluate(() => (commands = []));
  await page.locator("[data-zp-control=choose-chi]").click();
  expect(await page.evaluate(() => commands.length)).toBe(1);
  await expect(page.locator("#zp-options")).toBeHidden();
});
