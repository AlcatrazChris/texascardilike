import { test, expect } from "@playwright/test";
import { mount, feed, fixture, viewports } from "./fixtures.mjs";
test("超时数字边界、圆形比例和可视安全区", async ({ page }) => {
  await page.clock.setFixedTime(new Date(1794000000000));
  await mount(page);
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const seconds of [99, 999, 9999, 999999]) {
      const d = fixture();
      d.room.turnUntil = 1794000000000 - seconds * 1000;
      await feed(page, d);
      const a = await page
        .locator(".zp-seat-clock:not([hidden])")
        .evaluate((e) => {
          const r = e.getBoundingClientRect(),
            range = document.createRange();
          range.selectNodeContents(e);
          const t = range.getBoundingClientRect();
          return {
            circle: r.width === r.height,
            inside:
              t.x >= r.x + 1 &&
              t.right <= r.right - 1 &&
              t.y >= r.y &&
              t.bottom <= r.bottom,
            red: e.classList.contains("overdue"),
          };
        });
      expect(a).toEqual({ circle: true, inside: true, red: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({
    content: ".zp-safe-probe{padding:20px 8px 24px 8px}",
  });
  await feed(page, fixture());
  const l = await page.evaluate(() => ui.inspectLayout());
  expect(l.safeArea).toEqual({ top: 20, right: 8, bottom: 24, left: 8 });
  expect(l.regions.hand.y + l.regions.hand.height).toBeLessThanOrEqual(
    844 - 24,
  );
});
