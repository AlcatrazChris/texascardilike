import { test, expect } from "@playwright/test";
import { botAction } from "../../lib/zipai.mjs";
async function create(page) {
  await page.goto("/");
  await page.locator("#player-name").fill("回归房主");
  await page.locator("#try-zipai").click();
  await page.locator('input[name=minHu][value="10"]').check();
  await page.locator("#zp-form [type=submit]").click();
  await expect(page.locator("#lobby-code")).toBeVisible();
  return page.locator("#lobby-code").textContent();
}
async function creds(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("river-room")));
}
async function rpc(page, user, command, extra = {}) {
  const r = await page.request.post("/api/room", {
      data: {
        code: user.code,
        secret: user.secret,
        command,
        requestId: crypto.randomUUID(),
        ...extra,
      },
    }),
    d = await r.json();
  expect(r.ok(), d.error).toBeTruthy();
  return d;
}
for (const multiplayer of [false, true])
  test(
    multiplayer
      ? "真实三人联机、统计、刷新恢复和下一局"
      : "真实建房、AI补位和动作期间可出牌",
    async ({ page, browser }) => {
      test.setTimeout(90000);
      const extraContexts = [],
        pages = [page],
        users = [];
      await page.setViewportSize({ width: 390, height: 844 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const code = await create(page);
      try {
        if (multiplayer)
          for (let i = 1; i < 3; i++) {
            const context = await browser.newContext({
              baseURL: "http://localhost:3005",
              viewport: { width: 390, height: 844 },
              reducedMotion: "reduce",
            });
            extraContexts.push(context);
            const p = await context.newPage();
            pages.push(p);
            await p.goto("/");
            await p.locator("#player-name").fill("好友" + i);
            await p.locator("#room-code").fill(code);
            await p.locator("#join-form").evaluate((e) => e.requestSubmit());
            await expect(p.locator("#lobby-code")).toHaveText(code);
          }
        for (const p of pages) {
          await p.locator("#ready-room").click();
          users.push(await creds(p));
        }
        await page.locator("#start-room").click();
        await expect(page.locator("#zipai-screen")).toBeVisible();
        await expect(page.locator("[data-zp-card]").first()).toBeVisible();
        // Select a server-legal card and submit through the actual UI, including any queued deal.
        let state = await rpc(page, users[0], "poll");
        if (state.game.legal?.discard.length) {
          const card = state.game.legal.discard[0];
          await page
            .locator(`[data-zp-card="${card}"]`)
            .scrollIntoViewIfNeeded();
          await page.locator(`[data-zp-card="${card}"]`).click();
          await expect(page.locator("[data-zp-control=discard]")).toBeEnabled();
          const after = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/room") &&
              r.request().postDataJSON()?.command === "action",
          );
          await page.locator("[data-zp-control=discard]").click();
          expect((await after).ok()).toBeTruthy();
        }
        await page.locator("#zp-stats").click();
        await expect(page.locator("#zipai-result-board")).toBeVisible();
        expect(
          await page.locator(".zp-result-player:not(.self) .zp-back").count(),
        ).toBeGreaterThan(0);
        await page.locator("#zp-result-close").click();
        await page.reload();
        await page.locator("#resume-room").click();
        await expect(page.locator("#zipai-screen")).toBeVisible();
        state = await rpc(page, users[0], "poll");
        for (let n = 0; state.game.street !== "complete"; n++) {
          expect(n).toBeLessThan(200);
          const views = await Promise.all(
              users.map((u) => rpc(page, u, "poll")),
            ),
            actor = views.findIndex(
              (v) => v.game.legal && !v.game.legal.queued,
            );
          if (actor < 0) {
            state = await rpc(page, users[0], "poll");
            continue;
          }
          const v = views[actor],
            [action, amount] = botAction(v.game);
          state = await rpc(page, users[actor], "action", {
            version: v.room.version,
            action,
            amount,
          });
        }
        await expect(page.locator("#zipai-result-board")).toBeVisible({
          timeout: 65000,
        });
        await expect(page.locator(".zp-result-player")).toHaveCount(3);
        expect(await page.locator(".zp-result-player .zp-back").count()).toBe(
          0,
        );
        for (const u of users) await rpc(page, u, "ready", { ready: true });
        await page.reload();
        await page.locator("#resume-room").click();
        await expect(
          page.locator("#zp-result-footer [data-zp-control=next]"),
        ).toBeDisabled();
        await page.locator("#zp-result-footer [data-zp-control=ready]").click();
        await expect(
          page.locator("#zp-result-footer [data-zp-control=next]"),
        ).toBeEnabled();
        await page.locator("#zp-result-footer [data-zp-control=next]").click();
        await expect(page.locator("#zp-hand")).toHaveText("第 002 局");
        expect(errors).toEqual([]);
      } finally {
        for (const u of users) await rpc(page, u, "leave").catch(() => {});
        for (const c of extraContexts) await c.close();
      }
    },
  );
test("德州入口和原有对局未受字牌样式影响", async ({ page }) => {
  await page.goto("/");
  await page.locator("#solo-game").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page.locator("#settings-dialog [type=submit]").click();
  await expect(page.locator("#zipai-screen")).toBeHidden();
  await expect(page.locator(".poker-table")).toBeVisible();
});
