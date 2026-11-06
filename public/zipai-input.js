import { moveLayoutCard, shouldDiscardGesture } from "./zipai-hand.js";
import { tileHTML } from "./zipai-presentation.js";
export const INPUT_STATES = [
  "idle",
  "selecting",
  "dragging",
  "drop-preview",
  "submitting",
  "waiting-server",
  "resolved",
  "cancelled",
];
export function createInputState() {
  let phase = "idle";
  return {
    get phase() {
      return phase;
    },
    set(next) {
      if (!INPUT_STATES.includes(next)) throw Error("Unknown input phase");
      phase = next;
      return phase;
    },
  };
}
export function createInputController({
  root,
  hand,
  getState,
  onSelect,
  onMove,
  onSubmit,
  onChange = () => {},
  toast = () => {},
}) {
  const state = createInputState(),
    abort = new AbortController(),
    options = { signal: abort.signal };
  let gesture,
    ghost,
    raf = 0,
    ignoreUntil = 0,
    signature = "";
  const phase = (next) => {
    state.set(next);
    root.dataset.input = next;
    onChange(next);
  };
  const marker = document.createElement("span");
  marker.className = "zp-insert-marker";
  marker.hidden = true;
  root.append(marker);
  function cancel(reason = "cancelled") {
    if (gesture) {
      gesture.source.classList.remove("zp-dragging");
      try {
        hand.releasePointerCapture(gesture.id);
      } catch {}
    }
    gesture = null;
    ghost?.remove();
    ghost = null;
    cancelAnimationFrame(raf);
    raf = 0;
    marker.hidden = true;
    for (const c of hand.querySelectorAll(".zp-drop-target"))
      c.classList.remove("zp-drop-target");
    root.classList.remove("zp-discard-preview");
    if (!["submitting", "waiting-server"].includes(state.phase)) phase(reason);
  }
  function targetAt(x, y) {
    const node = document.elementFromPoint(x, y),
      column = node?.closest("[data-zp-column]"),
      button = node?.closest("[data-zp-card]");
    let index;
    if (column) {
      index = column.querySelectorAll("[data-zp-card]").length;
      if (button) {
        const r = button.getBoundingClientRect();
        index =
          Number(button.dataset.zpIndex) +
          (y > r.top + Math.min(r.height / 2, 18) ? 1 : 0);
      }
      return { column, id: column.dataset.zpColumn, index };
    }
    if (node === hand || node?.classList.contains("zp-hand-track")) {
      const cols = [...hand.querySelectorAll("[data-zp-column]")],
        i = cols.findIndex(
          (c) => x < c.getBoundingClientRect().x + c.offsetWidth / 2,
        );
      return { id: null, index: i < 0 ? cols.length : i };
    }
    return null;
  }
  function tick() {
    raf = 0;
    if (!gesture || !ghost) return;
    const s = getState(),
      r = hand.getBoundingClientRect(),
      x = gesture.x,
      y = gesture.y;
    ghost.style.transform = `translate3d(${x - gesture.offsetX}px,${y - gesture.offsetY}px,0)`;
    for (const c of hand.querySelectorAll(".zp-drop-target"))
      c.classList.remove("zp-drop-target");
    const target = targetAt(x, y),
      full =
        target?.id &&
        s.layout.columns.find((c) => c.id === target.id)?.cards.length >= 5 &&
        !target.column.contains(gesture.source);
    marker.hidden = true;
    if (target && !full) {
      target.column?.classList.add("zp-drop-target");
      if (target.column) {
        const cr = target.column.getBoundingClientRect(),
          step = s.geometry.cards.handSize.step;
        Object.assign(marker.style, {
          left: cr.x + "px",
          top: cr.y + Math.min(target.index, 4) * step + "px",
          width: cr.width + "px",
        });
        marker.hidden = false;
      }
      phase("drop-preview");
    } else phase("dragging");
    const discard = shouldDiscardGesture({
      ...gesture,
      startX: gesture.startX,
      startY: gesture.startY,
      x,
      y,
      hand: s.handRect,
      arena: s.arenaRect,
      legal: !!s.legal?.discard.includes(gesture.card),
      pending: s.pending,
    });
    root.classList.toggle("zp-discard-preview", discard);
    if (x < r.left + 24) hand.scrollLeft -= 10;
    else if (x > r.right - 24) hand.scrollLeft += 10;
  }
  hand.addEventListener(
    "pointerdown",
    (e) => {
      const button = e.target.closest("[data-zp-card]");
      if (!button || e.button > 0) return;
      const r = button.getBoundingClientRect();
      gesture = {
        id: e.pointerId,
        card: Number(button.dataset.zpCard),
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        offsetX: e.clientX - r.x,
        offsetY: Math.min(e.clientY - r.y, 24),
        moving: false,
        source: button,
      };
      hand.setPointerCapture(e.pointerId);
      e.preventDefault();
      phase("selecting");
    },
    options,
  );
  hand.addEventListener(
    "pointermove",
    (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      if (
        !gesture.moving &&
        Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 8
      )
        return;
      if (!gesture.moving) {
        gesture.moving = true;
        gesture.source.classList.add("zp-dragging");
        const size = getState().geometry.cards.handSize;
        ghost = document.createElement("div");
        ghost.className = "zp-drag-ghost";
        ghost.style.setProperty("--card-width", size.width + "px");
        ghost.style.setProperty("--card-height", size.height + "px");
        ghost.innerHTML = tileHTML(gesture.card);
        document.body.append(ghost);
        phase("dragging");
      }
      if (!raf) raf = requestAnimationFrame(tick);
      e.preventDefault();
    },
    options,
  );
  hand.addEventListener(
    "pointerup",
    (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const s = getState(),
        old = gesture,
        target = targetAt(e.clientX, e.clientY),
        inside =
          e.clientX >= s.arenaRect.left &&
          e.clientX <= s.arenaRect.right &&
          e.clientY >= s.arenaRect.top &&
          e.clientY <= s.arenaRect.bottom,
        discard =
          old.moving &&
          shouldDiscardGesture({
            ...old,
            x: e.clientX,
            y: e.clientY,
            hand: s.handRect,
            arena: s.arenaRect,
            legal: !!s.legal?.discard.includes(old.card),
            pending: s.pending,
          });
      cancel();
      ignoreUntil = Date.now() + 400;
      if (!inside) return;
      if (discard) {
        onSelect(old.card);
        onSubmit("discard", { amount: old.card });
        return;
      }
      if (old.moving && target) {
        const result = moveLayoutCard(
          s.layout,
          old.card,
          target.id,
          target.index,
        );
        if (result.full) toast("一笔最多五张，请拖到其他笔或空白处");
        if (result.changed) onMove(result.layout, old.card);
      } else if (!old.moving)
        onSelect(s.selected === old.card ? null : old.card);
      phase("resolved");
    },
    options,
  );
  hand.addEventListener("pointercancel", () => cancel(), options);
  hand.addEventListener(
    "lostpointercapture",
    () => {
      if (gesture) cancel();
    },
    options,
  );
  hand.addEventListener(
    "click",
    (e) => {
      if (Date.now() < ignoreUntil) return;
      const b = e.target.closest("[data-zp-card]");
      if (b) {
        const card = Number(b.dataset.zpCard);
        onSelect(getState().selected === card ? null : card);
        phase("selecting");
      }
    },
    options,
  );
  hand.addEventListener(
    "keydown",
    (e) => {
      const b = e.target.closest("[data-zp-card]");
      if (!b) return;
      const card = Number(b.dataset.zpCard),
        s = getState(),
        column = s.layout.columns.find((c) => c.cards.includes(card));
      if (!column) return;
      if (e.key === "Escape") {
        cancel();
        onSelect(null);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
        return;
      e.preventDefault();
      const i = s.layout.columns.indexOf(column),
        at = column.cards.indexOf(card),
        horizontal = ["ArrowLeft", "ArrowRight"].includes(e.key),
        to = i + (e.key === "ArrowLeft" ? -1 : 1);
      if (!e.altKey) {
        const buttons = [...hand.querySelectorAll("[data-zp-card]")],
          next =
            buttons[
              (buttons.indexOf(b) +
                (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) +
                buttons.length) %
                buttons.length
            ];
        next.focus();
        return;
      }
      const moved = horizontal
        ? moveLayoutCard(
            s.layout,
            card,
            s.layout.columns[to]?.id ?? null,
            to < 0 ? 0 : undefined,
          )
        : moveLayoutCard(
            s.layout,
            card,
            column.id,
            e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 2,
          );
      if (moved.full) toast("一笔最多五张");
      if (moved.changed) {
        onMove(moved.layout, card);
        hand
          .querySelector(`[data-zp-card="${card}"]`)
          ?.focus({ preventScroll: true });
      }
    },
    options,
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancel();
    },
    options,
  );
  return {
    get phase() {
      return state.phase;
    },
    get dragging() {
      return !!gesture?.moving;
    },
    cancel,
    sync(key) {
      if (signature !== key) {
        signature = key;
        cancel();
      }
    },
    async submit(run) {
      if (["submitting", "waiting-server"].includes(state.phase)) return false;
      cancel();
      phase("submitting");
      try {
        const promise = run();
        phase("waiting-server");
        return await promise;
      } finally {
        phase("resolved");
      }
    },
    dispose() {
      cancel();
      abort.abort();
      marker.remove();
    },
  };
}
