import {
  tileHTML,
  escapeHTML,
  meldLabels,
  resultLabels,
} from "./zipai-presentation.js";
import { seatPosition } from "./zipai-view.js";
export const MOTION = Object.freeze({
  travel: 380,
  dealGap: 45,
  read: 1000,
  wake: 1100,
  win: 1100,
  easing: "cubic-bezier(.2,.75,.25,1)",
  maxQueue: 48,
});
export function motionPath(layout, event, self) {
  const seat = seatPosition(event.playerId ?? self, self),
    a = layout.anchors;
  return {
    from:
      event.type === "discard"
        ? seat === "self"
          ? (a.handCards?.[event.card] ?? a.selfHand)
          : a[seat]
        : event.type === "meld"
          ? a.currentCard
          : a.deck,
    to:
      event.type === "meld"
        ? a[seat + "Public"]
        : event.type === "deal"
          ? a[seat]
          : a.currentCard,
  };
}
// Queue acknowledges network receipt immediately. Playback is cancellable presentation only.
export function createMotionDirector({
  layer,
  getLayout,
  getSelf,
  onFrame = () => {},
  onRest = () => {},
}) {
  let queue = [],
    playing = false,
    generation = 0,
    animations = [],
    timer = null,
    wakeWait = null,
    idle = [],
    seen = new Set(),
    paused = false;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finish = () => {
    if (!playing && !queue.length) {
      onRest();
      for (const done of idle.splice(0)) done();
    }
  };
  function cancel() {
    generation++;
    queue = [];
    for (const a of animations) a.cancel();
    animations = [];
    clearTimeout(timer);
    wakeWait?.();
    wakeWait = null;
    layer.replaceChildren();
    playing = false;
    finish();
  }
  function wait(ms) {
    return new Promise((resolve) => {
      wakeWait = resolve;
      timer = setTimeout(() => {
        wakeWait = null;
        resolve();
      }, ms);
    });
  }
  function fly(card, from, to, delay = 0) {
    const node = document.createElement("span");
    node.className = "zp-motion-card";
    node.innerHTML = tileHTML(card);
    layer.append(node);
    const layout = getLayout(),
      size = layout.cards.currentSize;
    node.style.setProperty("--card-width", size.width + "px");
    node.style.setProperty("--card-height", size.height + "px");
    const transform = (p) =>
      `translate3d(${p.x - size.width / 2}px,${p.y - size.height / 2}px,0)`;
    node.style.transform = transform(to);
    node.dataset.from = JSON.stringify(from);
    node.dataset.to = JSON.stringify(to);
    if (!reduced()) {
      const a = node.animate(
        [
          { transform: transform(from), opacity: 0.3 },
          { transform: transform(to), opacity: 1 },
        ],
        { duration: MOTION.travel, delay, easing: MOTION.easing, fill: "both" },
      );
      animations.push(a);
    }
    return node;
  }
  function draw(frame) {
    const event = frame.event,
      game = frame.game,
      layout = getLayout();
    if (!layout) return 0;
    const path = motionPath(layout, event, getSelf()),
      caption = document.createElement("div");
    caption.className = "zp-motion-caption";
    const position = seatPosition(event.playerId ?? getSelf(), getSelf());
    layer.dataset.effect = event.type;
    if (event.type === "deal") {
      for (let i = 0; i < 12; i++) {
        const seat = ["self", "left", "right"][i % 3];
        fly("?", layout.anchors.deck, layout.anchors[seat], i * MOTION.dealGap);
      }
      return reduced() ? 0 : MOTION.travel + 11 * MOTION.dealGap;
    }
    if (["draw", "discard", "meld"].includes(event.type)) {
      fly(event.card ?? game.current?.card ?? "?", path.from, path.to);
      caption.textContent =
        event.type === "meld"
          ? meldLabels[event.kind] || "成组"
          : game.players[event.playerId]?.name +
            (event.type === "draw" ? " · 摸牌" : " · 出牌");
      caption.style.left = path.to.x + "px";
      caption.style.top =
        Math.max(12, path.to.y - layout.cards.currentSize.height / 2 - 26) +
        "px";
      layer.append(caption);
      return MOTION.read;
    }
    if (event.type === "wake" || event.type === "flower") {
      caption.className = "zp-motion-reveal";
      caption.innerHTML =
        tileHTML(event.card ?? 80) +
        "<strong>" +
        (event.type === "flower"
          ? "飞飞"
          : game.wakes.reduce(
              (s, w) => s + w.hits.reduce((n, h) => n + h.count, 0),
              0,
            ) + " 醒") +
        "</strong>";
      layer.append(caption);
      return MOTION.wake;
    }
    if (["hu", "settle"].includes(event.type)) {
      const result = game.result || game.wake;
      if (!result) return 0;
      const label = resultLabels(result);
      layer.dataset.effect = label.kind;
      caption.className = "zp-motion-win";
      caption.innerHTML =
        "<strong>" +
        escapeHTML(label.title) +
        "</strong><span>" +
        escapeHTML(
          result.draw
            ? "庄家继续坐庄"
            : game.players[result.winner]?.name || "",
        ) +
        "</span>";
      layer.append(caption);
      if (result.winCard !== null && result.winCard !== undefined)
        fly(
          result.winCard,
          layout.anchors.currentCard,
          layout.anchors[seatPosition(result.winner, getSelf())],
        );
      return MOTION.win;
    }
    return 0;
  }
  async function drain() {
    if (playing || paused) return;
    playing = true;
    const token = generation;
    try {
      while (queue.length && token === generation) {
        const frame = queue.shift();
        onFrame(frame);
        layer.replaceChildren();
        animations = [];
        const duration = draw(frame);
        await wait(duration);
        for (const a of animations) a.cancel();
        animations = [];
      }
    } catch (error) {
      console.warn("字牌动效已恢复到最新状态", error);
      cancel();
    } finally {
      if (token === generation) {
        playing = false;
        layer.replaceChildren();
        finish();
      }
    }
  }
  return {
    enqueue(frames) {
      for (const frame of frames) {
        if (
          frame.event.silent ||
          frame.event.type === "pass" ||
          seen.has(frame.id)
        )
          continue;
        seen.add(frame.id);
        queue.push(frame);
      }
      if (seen.size > 512) seen = new Set([...seen].slice(-256));
      if (queue.length > MOTION.maxQueue) {
        cancel();
        return;
      }
      drain();
    },
    cancel,
    reset() {
      cancel();
      seen.clear();
    },
    resize() {
      cancel();
    },
    setHidden(hidden) {
      paused = hidden;
      if (hidden) cancel();
      else drain();
    },
    get busy() {
      return playing || queue.length > 0;
    },
    whenIdle() {
      return !playing && !queue.length
        ? Promise.resolve()
        : new Promise((resolve) => idle.push(resolve));
    },
    dispose() {
      cancel();
      seen.clear();
    },
  };
}
