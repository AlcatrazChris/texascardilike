import * as z from "../../lib/zipai.mjs";
export const viewports = [
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
const ids = (types) => {
  const n = Array(20).fill(0);
  return types.map((t) => t * 4 + n[t]++);
};
export function fixture(kind = "opening") {
  const g = z.newGame(
    { flower: true, special: false, rounds: 2, minHu: 10 },
    undefined,
    [
      { name: "林间牌友", human: true },
      { name: "青竹", human: false },
      { name: "桂花", human: false },
    ],
  );
  Object.assign(g, {
    dealId: "fixed-" + kind,
    street: "discard",
    turn: 0,
    current: null,
    queue: [],
    needsDraw: null,
    history: [],
    handLog: ["固定牌局 · 等待行动"],
    log: [],
    wakes: [],
    drawCount: 2,
    discardCount: 4,
    finished: false,
    privateMessages: {},
    privacyVersion: 1,
  });
  for (const p of g.players)
    Object.assign(p, {
      hole: [],
      melds: [],
      discards: [],
      passedHu: [],
      passedEat: [],
      passedPeng: [],
      heavyOwed: 0,
      action: "",
    });
  g.players[0].hole = [
    0, 1, 2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68,
    80,
  ];
  if (kind === "dense") {
    for (const [seat, count, start] of [
      [0, 5, 0],
      [1, 4, 5],
      [2, 3, 9],
    ])
      for (let t = start; t < start + count; t++)
        g.players[seat].melds.push({
          kind: "peng",
          cards: [t * 4, t * 4 + 1, t * 4 + 2],
          hu: t >= 10 ? 3 : 1,
        });
    g.players[0].hole = [];
  }
  if (kind === "chi") {
    g.players[0].hole = [25, 4, 36, 28, 32];
    for (const t of [0, 2, 3, 4, 5])
      g.players[0].melds.push({
        kind: "kan",
        cards: [t * 4, t * 4 + 1, t * 4 + 2],
        hu: 3,
      });
    g.current = { card: 24, source: 2, draw: false, claimed: false };
    g.street = "respond";
    g.queue = [{ seat: 0, kind: "chi" }];
  }
  if (kind === "hu") {
    g.players[0].hole = ids([
      13, 13, 13, 1, 11, 11, 2, 3, 4, 0, 10, 10, 9, 9, 19, 2, 12, 12, 14, 14,
      14,
    ]);
  }
  if (kind === "single-chi") {
    g.players[0].hole = [4, 8, 64, 65, 48];
    for (const t of [3, 4, 5, 6, 7])
      g.players[0].melds.push({
        kind: "kan",
        cards: [t * 4, t * 4 + 1, t * 4 + 2],
        hu: 3,
      });
    g.current = { card: 0, source: 2, draw: false, claimed: false };
    g.street = "respond";
    g.queue = [{ seat: 0, kind: "chi" }];
  }
  if (kind === "result" || kind === "repeat") {
    g.players[0].hole = ids([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 10, 10, 10, 11, 11, 11, 12, 12, 12, 13, 13, 13,
    ]);
    if (kind === "repeat") {
      g.config.repeatWake = true;
      g.players[0].melds = [
        { kind: "chuan", cards: [0, 1, 2, 3], hu: 9, concealed: true },
      ];
      g.players[0].hole = ids([
        1, 1, 1, 2, 2, 2, 10, 10, 10, 11, 11, 11, 12, 12, 12, 13, 13,
      ]);
    }
  }
  const used = new Set([
      ...g.players.flatMap((p) => [
        ...p.hole,
        ...p.melds.flatMap((m) => m.cards),
      ]),
      ...(g.current ? [g.current.card] : []),
    ]),
    pool = Array.from({ length: 81 }, (_, i) => i).filter((c) => !used.has(c));
  for (const p of g.players) {
    const target = p.id === 0 ? 21 : 20;
    if (!p.hole.length)
      p.hole = pool.splice(
        0,
        Math.max(0, target - p.melds.flatMap((m) => m.cards).length),
      );
  }
  if (kind === "dense") {
    for (const [seat, n] of [
      [0, 8],
      [1, 5],
      [2, 3],
    ])
      g.players[seat].discards = pool.splice(0, n);
    g.players.forEach((p, i) => {
      p.name = ["林间很长的玩家昵称", "青竹好友名字很长", "桂花昵称也比较长"][
        i
      ];
      p.score = [123456, -56789, -66667][i];
    });
    g.current = { card: pool.pop(), source: 1, draw: true, claimed: false };
  }
  g.deck = pool;
  const frames = [];
  if (kind === "result" || kind === "repeat") {
    if (kind === "repeat") {
      const wake = [16, 36, 7];
      const allPlayers = g.players.flatMap((p) => p.hole);
      for (const p of g.players)
        if (p.id !== 0) p.hole = p.hole.filter((c) => !wake.includes(c));
      g.deck = [...g.deck.filter((c) => !wake.includes(c)), ...wake];
    }
    g.current = { card: 54, source: 0, draw: true, claimed: true };
    z.observeGame(g, (state, event) =>
      frames.push({
        id: frames.length + 1,
        event: z.publicEvent(state, event, 0),
        game: structuredClone(z.view(state, 0)),
      }),
    );
    z.act(g, 0, "hu");
  }
  const room = {
    code: "123456",
    config: g.config,
    status: g.street === "complete" ? "between" : "playing",
    host: true,
    mySeat: 0,
    hand: 1,
    members: [{ id: "test", seat: 0, name: g.players[0].name, ready: false }],
    version: 1,
    eventSeq: frames.length,
    serverTime: 1794000000000,
    receivedAt: 1794000000000,
    turnUntil: 1794000030000,
  };
  return { game: z.view(g, 0), room, frames: [], recordedFrames: frames };
}
export async function mount(page, kind = "opening") {
  await page.route("**/__zipai_fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
        [
          "styles",
          "refinements",
          "lobby",
          "table-updates",
          "table-layout",
          "zipai",
          "zipai-interactions",
        ]
          .map((n) => '<link rel="stylesheet" href="/' + n + '.css">')
          .join("") +
        "<body></body>",
    }),
  );
  await page.goto("/__zipai_fixture");
  await page.evaluate(async () => {
    const { createZipai } = await import("/zipai.js");
    window.commands = [];
    window.ui = createZipai({
      command: async (c, e) => {
        window.commands.push({ command: c, ...e });
      },
      create: async () => {},
      exit: () => {},
      info: () => {},
      toast: () => {},
    });
  });
  await feed(page, fixture(kind));
}
export async function feed(page, data) {
  await page.evaluate(async (data) => {
    window.lastData = data;
    await window.ui.consume(data);
  }, data);
  await page.waitForFunction(() => window.ui.inspectLayout?.());
  if (page.zipaiClock) await page.clock.runFor(34);
  else
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
}
