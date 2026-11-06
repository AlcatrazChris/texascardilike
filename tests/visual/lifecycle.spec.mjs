import { test, expect } from "@playwright/test";
import { fixture, mount, feed } from "./fixtures.mjs";
test("取消与恢复：隐藏、旋转、新房间事件ID不丢失、销毁无监听器积累", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "DOM 计数需要 Chromium CDP");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mount(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Memory.getDOMCounters");
  for (let n = 0; n < 12; n++)
    await page.evaluate(async (d) => {
      ui.dispose();
      const { createZipai } = await import("/zipai.js");
      window.ui = createZipai({
        command: async () => {},
        create: async () => {},
        exit: () => {},
        info: () => {},
        toast: () => {},
      });
      await ui.consume(d);
    }, fixture());
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Memory.getDOMCounters");
  expect(after.jsEventListeners - before.jsEventListeners).toBeLessThan(20);
  expect(after.nodes - before.nodes).toBeLessThan(250);
  expect(await page.locator("#zipai-screen").count()).toBe(1);
  expect(await page.locator(".zp-public-dialog").count()).toBe(1);
  const d = fixture(),
    frames = [
      { id: 50, event: { type: "deal", text: "开始发牌" }, game: d.game },
    ];
  await feed(page, { ...d, frames });
  await expect(page.locator(".zp-motion-card")).toHaveCount(12);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".zp-motion-card")).toHaveCount(0);
  await feed(page, { ...d, room: { ...d.room, code: "654321" }, frames });
  await expect(page.locator(".zp-motion-card")).toHaveCount(12);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".zp-motion-card")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => ui.whenIdle());
  await expect(page.locator("[data-zp-control=discard]")).toBeVisible();
});
