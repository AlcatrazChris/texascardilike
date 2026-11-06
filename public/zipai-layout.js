// Pure UI geometry. No DOM, clocks, cards, rules or network side effects.
export const CARD_RATIO = 2.85;
export const UI_LIMITS = Object.freeze({
  publicMin: 20,
  handMin: 30,
  compactHandMin: 24,
  buttonMin: 44,
  gap: 8,
});
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const rect = (x, y, width, height) => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.max(0, Math.round(width)),
  height: Math.max(0, Math.round(height)),
});
export const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
export const overlaps = (a, b, tolerance = 1) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tolerance &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > tolerance;
export function cardGeometry(width, stepRatio = 0.76) {
  return {
    width,
    height: Math.round(width * CARD_RATIO),
    step: Math.round(width * stepRatio),
    font: Math.round(width * 0.79),
    radius: Math.round(width * 0.24),
  };
}
export function computeLayout({
  width,
  height,
  safeArea = {},
  columns = 7,
  publicCounts = [0, 0, 0],
  discardCounts = [0, 0, 0],
  currentSeat = "self",
  choiceOpen = false,
  actions = 2,
} = {}) {
  const safe = {
    top: Math.max(0, safeArea.top || 0),
    right: Math.max(0, safeArea.right || 0),
    bottom: Math.max(0, safeArea.bottom || 0),
    left: Math.max(0, safeArea.left || 0),
  };
  const W = Math.max(280, width - safe.left - safe.right),
    H = Math.max(240, height - safe.top - safe.bottom),
    compact = W > H && H < 610,
    portrait = W < 680 && !compact,
    mode = compact ? "compact" : portrait ? "portrait" : "desktop",
    g = 8,
    p = portrait ? 8 : 12;
  const headerH = compact ? 28 : portrait ? 38 : 48,
    infoH = compact ? 24 : 30,
    statusH = compact ? 0 : 30,
    top = headerH + infoH + statusH + g;
  const profileW = compact ? 96 : portrait ? 88 : 128,
    profileH = compact ? 48 : portrait ? 50 : 64;
  const handW = compact
      ? 24
      : portrait
        ? H < 690 || W < 380
          ? 30
          : 36
        : clamp(Math.floor(H * 0.055), 38, 54),
    hand = cardGeometry(handW, compact ? 0.69 : portrait ? 0.72 : 0.76),
    handHeading = compact ? 16 : 24,
    handH = hand.height + hand.step * 4 + handHeading + 16;
  const publicSize = cardGeometry(compact ? 20 : portrait ? 22 : 28),
    current = cardGeometry(compact ? 24 : portrait ? 30 : 42),
    result = cardGeometry(portrait ? 22 : 24),
    seat = {};
  let handRect, actionBar, deck, notice;
  const header = rect(p, 0, W - 2 * p, headerH),
    info = rect(p, headerH, W - 2 * p, infoH);
  if (portrait) {
    handRect = rect(p, H - p - handH, W - 2 * p, handH);
    actionBar = rect(p, handRect.y - g - 48, W - 2 * p, 48);
    const selfH = clamp((actionBar.y - top - profileH - 3 * g) * 0.36, 50, 132),
      selfY = actionBar.y - g - selfH,
      publicY = top + profileH + g,
      publicH = Math.max(42, selfY - g - publicY),
      corridor = 56,
      side = (W - 2 * p - corridor - 2 * g) / 2;
    seat.left = {
      profile: rect(p, top, profileW, profileH),
      public: rect(p, publicY, side, publicH),
    };
    seat.right = {
      profile: rect(W - p - profileW, top, profileW, profileH),
      public: rect(W - p - side, publicY, side, publicH),
    };
    seat.self = {
      profile: rect(p, selfY, profileW, profileH),
      public: rect(
        p + profileW + 30 + 2 * g,
        selfY,
        W - 2 * p - profileW - 30 - 2 * g,
        selfH,
      ),
    };
    deck = rect(W / 2 - 24, top, 48, 26);
    notice = rect(W * 0.16, headerH + infoH, W * 0.68, statusH);
  } else if (compact) {
    const leftW = clamp(W * 0.22, 138, 220),
      rightW = clamp(W * 0.17, 116, 170),
      usable = H - top - p,
      publicH = Math.max(36, (usable - profileH * 2 - 4 * g) / 2),
      selfY = H - p - profileH;
    handRect = rect(
      leftW + g,
      H - p - handH,
      W - leftW - rightW - 2 * g - p,
      handH,
    );
    actionBar = rect(W - rightW, H - p - 104, rightW - p, 104);
    seat.left = {
      profile: rect(p, top, profileW, profileH),
      public: rect(p, top + profileH + g, leftW - p, publicH),
    };
    seat.self = {
      profile: rect(p, selfY, profileW, profileH),
      public: rect(p, selfY - g - publicH, leftW - p, publicH),
    };
    seat.right = {
      profile: rect(W - p - profileW, top, profileW, profileH),
      public: rect(
        W - rightW,
        top + profileH + g,
        rightW - p,
        Math.max(32, actionBar.y - g - top - profileH - g),
      ),
    };
    deck = rect(W / 2 - 24, headerH, 48, 24);
    notice = rect(W * 0.31, 0, W * 0.38, headerH);
  } else {
    const sideW = clamp(W * 0.24, 192, 390),
      publicH = clamp((H - top) * 0.28, 110, 190);
    handRect = rect(sideW + g, H - p - handH, W - sideW - 2 * p - g, handH);
    actionBar = rect(handRect.x, handRect.y - g - 52, handRect.width, 52);
    seat.left = {
      profile: rect(p, top, profileW, profileH),
      public: rect(p, top + profileH + g, sideW - p - g, publicH),
    };
    seat.right = {
      profile: rect(W - p - profileW, top, profileW, profileH),
      public: rect(W - sideW + g, top + profileH + g, sideW - p - g, publicH),
    };
    seat.self = {
      profile: rect(p, H - p - profileH, profileW, profileH),
      public: rect(p, H - p - profileH - g - publicH, sideW - p - g, publicH),
    };
    deck = rect(W / 2 - 30, top, 60, 40);
    notice = rect(W * 0.32, headerH + infoH, W * 0.36, statusH);
  }
  // Central corridor keeps the current card separate from all three public trays.
  const currentY = compact
    ? Math.max(headerH, Math.min(top - g, handRect.y - current.height - 16 - g))
    : deck.y + deck.height + 2;
  if (portrait)
    Object.assign(
      current,
      cardGeometry(
        Math.max(
          24,
          Math.min(
            current.width,
            Math.floor((seat.self.profile.y - currentY - 16) / CARD_RATIO),
          ),
        ),
      ),
    );
  const currentRect = rect(
    (compact ? handRect.x + handRect.width * 0.62 : W / 2) - current.width / 2,
    currentY,
    current.width,
    current.height + 16,
  );
  const clock = compact ? 28 : portrait ? 30 : 36;
  for (const [key, s] of Object.entries(seat)) {
    s.clock = rect(
      key === "right"
        ? s.profile.x - clock - g
        : s.profile.x + s.profile.width + g,
      s.profile.y + (s.profile.height - clock) / 2,
      clock,
      clock,
    );
    // Clock lives in the profile row, never over a public tray.
    s.discard = rect(
      s.public.x,
      s.public.y + s.public.height - 26,
      s.public.width,
      26,
    );
    s.anchor = center(s.profile);
    s.publicAnchor = center(s.public);
  }
  const pickerW = Math.min(W - 2 * p, 520),
    pickerH = Math.max(80, Math.min(H * 0.53, 360)),
    overlay = rect(
      (W - pickerW) / 2,
      Math.max(top, Math.min(actionBar.y - pickerH - g, H - pickerH - p)),
      pickerW,
      pickerH,
    );
  const resultHeader = rect(p, 8, W - 2 * p, 40),
    resultFooter = rect(
      p,
      H - p - (portrait ? 72 : 52),
      W - 2 * p,
      portrait ? 72 : 52,
    ),
    resultBody = rect(
      p,
      resultHeader.y + resultHeader.height + g,
      W - 2 * p,
      Math.max(
        80,
        resultFooter.y - g - resultHeader.y - resultHeader.height - g,
      ),
    );
  const sizes = {
    handSize: hand,
    handHeading,
    publicSize,
    currentSize: current,
    resultSize: result,
    columnStep: hand.step,
  };
  const anchors = {
    deck: center(deck),
    currentCard: center(currentRect),
    selfHand: center(handRect),
    leftSeat: seat.left.anchor,
    rightSeat: seat.right.anchor,
    self: seat.self.anchor,
    left: seat.left.anchor,
    right: seat.right.anchor,
    discardTarget: center(currentRect),
    selfPublic: seat.self.publicAnchor,
    leftPublic: seat.left.publicAnchor,
    rightPublic: seat.right.publicAnchor,
  };
  for (const key in anchors) anchors[key] = { ...anchors[key] };
  const regions = {
    header,
    info,
    notice,
    table: rect(0, 0, W, H),
    hand: handRect,
    actionBar,
    overlay,
    deck,
    current: currentRect,
    resultHeader,
    resultBody,
    resultFooter,
  };
  for (const r of Object.values(regions)) {
    r.x += safe.left;
    r.y += safe.top;
  }
  regions.table = rect(0, 0, width, height);
  for (const s of Object.values(seat)) {
    for (const k of ["profile", "public", "clock", "discard"]) {
      s[k].x += safe.left;
      s[k].y += safe.top;
    }
    for (const k of ["anchor", "publicAnchor"]) {
      s[k].x += safe.left;
      s[k].y += safe.top;
    }
  }
  for (const a of Object.values(anchors)) {
    a.x += safe.left;
    a.y += safe.top;
  }
  return {
    mode,
    viewport: { width, height, availableWidth: W, availableHeight: H },
    safeArea: safe,
    regions,
    seats: seat,
    cards: sizes,
    anchors,
    handContentWidth: Math.max(handRect.width, columns * (hand.width + 6) - 6),
    overflow: {
      hand: columns * (hand.width + 6) - 6 > handRect.width,
      public: publicCounts.map(
        (n) =>
          n * (publicSize.width + 4) >
          Math.min(...Object.values(seat).map((s) => s.public.width)),
      ),
      discards: discardCounts.some((n) => n > 6),
    },
    choiceOpen,
    actions,
  };
}
