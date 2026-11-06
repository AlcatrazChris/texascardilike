import { computeLayout } from "./zipai-layout.js";
import { patchHTML, position, setCardSize, text } from "./zipai-dom.js";
import { createInputController } from "./zipai-input.js";
import { createMotionDirector } from "./zipai-motion.js";
import { tableModel, actionModel } from "./zipai-view.js";
import {
  words,
  cardName as name,
  escapeHTML as esc,
  tileHTML as tile,
  handColumns,
  resultLabels,
  playerResultRole,
  settlementSummary,
  meldLabels as labels,
} from "./zipai-presentation.js";
import { autoArrange, reconcileLayout } from "./zipai-hand.js";
const $ = (s) => document.querySelector(s);
const compactScore = (n) =>
  Math.abs(n) >= 100000
    ? (n > 0 ? "+" : "") +
      new Intl.NumberFormat("zh-CN", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n)
    : signed(n);
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
export const zipaiSummary = (c) =>
  `${c.minHu} 胡起胡 · ${c.wakeMode === "center" ? "中醒" : c.wakeMode === "all" ? "上中下醒" : "上下醒"} · ${c.allowPassedHu ? "可胡过张" : "过张不可胡"} · ${c.mustHu ? "有胡必胡" : "可选择不胡"} · ${c.rounds} 局`;
export function createZipai({ command, create, exit, info, toast }) {
  let latest = null,
    geometry = null,
    input = null,
    motion = null,
    layoutFrame = 0,
    disposed = false;
  const lifecycle = new AbortController();
  const sendCommand = command;
  command = async (kind, extra = {}) => {
    if (pending || (kind === "action" && !latest?.legal)) return false;
    motion?.cancel();
    return input.submit(async () => {
      pending = true;
      renderControls();
      try {
        return await sendCommand(kind, extra);
      } catch (error) {
        toast(error.message);
        return false;
      } finally {
        pending = false;
        renderControls();
      }
    });
  };
  let g = null,
    room = null,
    pending = false,
    selected = null,
    layout = null,
    orderHand = "",
    lastReport = "",
    resultHand = null,
    handSignature = "",
    chiOpen = false,
    huOpen = false,
    choiceKey = "",
    lastSavedLayout = "";
  const root = document.createElement("section");
  root.id = "zipai-screen";
  root.setAttribute("aria-label", "桂林字牌牌桌");
  root.innerHTML = `<header class="zp-heading"><div><span class="eyebrow">RIVER · 桂林字牌</span><h1 id="zp-name">桂林字牌</h1></div><div class="zp-tools"><button class="button secondary" id="zp-rules">本桌规则</button><button class="button secondary" id="zp-exit">退出房间</button></div></header><div class="zp-toolbar"><span id="zp-room"></span><button id="zp-copy" class="text-button">复制房间号</button><div><strong id="zp-hand"></strong><button id="zp-stats" class="text-button">对局统计 ↗</button></div></div><details class="zp-announcement" id="zp-records"><summary><span id="zp-notice" role="status" aria-live="polite">正在准备字牌</span><span>⌄</span></summary><ol id="zp-record-list" tabindex="0"></ol></details>
    <div class="zp-arena"><div class="zp-stage" aria-label="三人字牌牌桌"><div class="zp-felt"><span>桂林字牌</span><small>老 K 字牌</small></div></div><div id="zp-opponents"></div><div class="zp-center"><div class="zp-deck"><span class="zp-back zp-tile"><span class="zp-face">K</span><span class="zp-face-reverse">K</span></span><div><small>余牌</small><strong id="zp-remaining"></strong></div></div></div><div class="zp-current" id="zp-current"></div><div class="zp-self-summary" id="zp-self-summary"></div><div class="zp-self-melds" id="zp-self-melds"></div><section class="zp-hand-area" aria-label="你的手牌"><div class="zp-hand-heading"><div><span id="zp-selected"></span><button id="zp-sort" class="text-button">理牌 ↺</button></div></div><div id="zp-hand-cards" class="zp-hand-cards"></div></section><section class="zp-controls"><p id="zp-turn" role="status"></p><div id="zp-options" class="zp-options"></div><div id="zp-actions" class="zp-actions"></div></section><div id="zp-effects" class="zp-effects" aria-live="polite" aria-atomic="true"></div></div>`;
  document.body.append(root);
  root.querySelector(".zp-arena").prepend($("#zp-records"));
  const stage = root.querySelector(".zp-stage");
  const discardCue = document.createElement("div");
  discardCue.className = "zp-discard-cue";
  discardCue.textContent = "松手出牌";
  root.querySelector(".zp-arena").append(discardCue);
  const safeProbe = document.createElement("div");
  safeProbe.className = "zp-safe-probe";
  root.append(safeProbe);
  function fitViewport() {
    if (disposed || document.body.dataset.screen !== "zipai" || !g) return;
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      applyLayout();
    });
  }
  function applyLayout() {
    const viewport = window.visualViewport,
      style = getComputedStyle(safeProbe),
      safeArea = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
    const handScroll = $("#zp-hand-cards").scrollLeft,
      model = tableModel(g, room);
    geometry = computeLayout({
      width: Math.round(viewport?.width || innerWidth),
      height: Math.round(viewport?.height || innerHeight),
      safeArea,
      columns:
        layout?.columns.filter((c) => c.cards.length || input?.dragging)
          .length || 1,
      publicCounts: model.seats.map((p) => p.publicMelds.length),
      discardCounts: model.seats.map((p) => p.discards.length),
      currentSeat: positionOf(g.current?.source ?? g.mySeat),
      choiceOpen: chiOpen || huOpen,
      actions: actionModel(g.legal, selected).length,
    });
    root.dataset.layout = geometry.mode;
    root.style.height = geometry.viewport.height + "px";
    text($("#zp-copy"), geometry.mode === "desktop" ? "复制房间号" : "复制");
    $("#zp-copy").setAttribute("aria-label", "复制房间号");
    const r = geometry.regions;
    position(root.querySelector(".zp-heading"), r.header);
    position(root.querySelector(".zp-toolbar"), r.info);
    position($("#zp-records"), r.notice);
    position(root.querySelector(".zp-hand-area"), r.hand);
    position(root.querySelector(".zp-controls"), r.actionBar);
    position(root.querySelector(".zp-center"), r.deck);
    position($("#zp-current"), r.current);
    position($("#zp-options"), r.overlay);
    for (const p of model.seats) {
      const owner =
        p.position === "self"
          ? $("#zp-self-summary")
          : root.querySelector('[data-zp-seat="' + p.id + '"]');
      position(
        owner.querySelector(".zp-player"),
        geometry.seats[p.position].profile,
      );
      const pub =
        p.position === "self"
          ? $("#zp-self-melds")
          : owner.querySelector(".zp-public");
      position(pub, geometry.seats[p.position].public);
      const clock = owner.querySelector("[data-clock-seat]"),
        clockRect = geometry.seats[p.position].clock,
        profile = geometry.seats[p.position].profile;
      position(clock, {
        ...clockRect,
        x: clockRect.x - profile.x,
        y: clockRect.y - profile.y,
      });
    }
    root.style.setProperty("--hand-heading", geometry.cards.handHeading + "px");
    setCardSize(root.querySelector(".zp-hand-area"), geometry.cards.handSize);
    setCardSize($("#zp-current"), geometry.cards.currentSize);
    root.style.setProperty(
      "--public-card-width",
      geometry.cards.publicSize.width + "px",
    );
    root.style.setProperty(
      "--clock-size",
      geometry.seats.self.clock.width + "px",
    );
    setCardSize(resultBoard, geometry.cards.resultSize);
    const track = $("#zp-hand-cards .zp-hand-track");
    if (track) {
      track.style.width = geometry.handContentWidth + "px";
      const visible = [...track.querySelectorAll("[data-zp-column]")],
        pitch = geometry.cards.handSize.width + 6,
        offset = Math.max(
          0,
          (geometry.regions.hand.width - visible.length * pitch + 6) / 2,
        );
      for (const [i, col] of visible.entries()) {
        col.style.left = Math.round(offset + i * pitch) + "px";
        col.style.width = geometry.cards.handSize.width + "px";
      }
      geometry.anchors.handCards = {};
      for (const [i, col] of layout.columns
        .filter((c) => c.cards.length || input?.dragging)
        .entries())
        for (const [j, card] of col.cards.entries())
          geometry.anchors.handCards[card] = {
            x:
              geometry.regions.hand.x +
              offset +
              i * pitch -
              handScroll +
              geometry.cards.handSize.width / 2,
            y:
              geometry.regions.hand.y +
              geometry.regions.hand.height -
              8 -
              geometry.cards.handSize.height / 2 -
              (col.cards.length - 1 - j) * geometry.cards.handSize.step,
          };
    }
    position($("#zipai-result-board .zp-result-header"), r.resultHeader);
    position($("#zipai-result-board .zp-result-scroll"), r.resultBody);
    position($("#zp-result-footer"), r.resultFooter);
    root.style.setProperty(
      "--result-columns",
      geometry.mode === "portrait" ? "1" : "3",
    );
    updateClocks();
  }
  const onResize = () => {
    input?.cancel();
    motion?.resize();
    fitViewport();
  };
  window.visualViewport?.addEventListener("resize", onResize, {
    signal: lifecycle.signal,
  });
  window.addEventListener("resize", onResize, { signal: lifecycle.signal });
  const dialog = document.createElement("dialog");
  dialog.id = "zipai-settings";
  dialog.className = "modal zp-settings";
  dialog.innerHTML = `<div class="modal-header"><div><div class="eyebrow">TRY SOMETHING NEW</div><h2>创建桂林字牌房间</h2></div><button type="button" class="icon-button" id="zp-close-settings" aria-label="关闭">×</button></div><p class="modal-intro">老 K 玩法 · 三人字牌 · 分享房间号即可加入</p><form id="zp-form"><label class="zp-setting-name">房间名称<input name="name" value="桂林字牌" autocomplete="off" maxlength="24" required></label><div class="zp-settings-grid"><fieldset class="zp-setting-group"><legend>起胡</legend><div class="zp-setting-buttons"><label><input type="radio" name="minHu" value="10" ><span>10 胡</span></label><label><input type="radio" name="minHu" value="15" checked><span>15 胡</span></label><label><input type="radio" name="minHu" value="20" ><span>20 胡</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>翻醒</legend><div class="zp-setting-buttons"><label><input type="radio" name="wakeMode" value="neighbors" checked><span>上下</span></label><label><input type="radio" name="wakeMode" value="center" ><span>中醒</span></label><label><input type="radio" name="wakeMode" value="all" ><span>上中下</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>飞飞万能牌</legend><div class="zp-setting-buttons"><label><input type="radio" name="flower" value="false"><span>不加入</span></label><label><input type="radio" name="flower" value="true" checked><span>加入一张</span></label></div></fieldset><fieldset class="zp-setting-group"><legend>AI 难度</legend><div class="zp-setting-buttons"><label><input type="radio" name="aiDifficulty" value="easy" ><span>轻松</span></label><label><input type="radio" name="aiDifficulty" value="normal" checked><span>标准</span></label><label><input type="radio" name="aiDifficulty" value="hard" ><span>进阶</span></label></div></fieldset><label>底分<input name="base" type="number" inputmode="numeric" autocomplete="off" min="1" max="1000" value="1" required></label><label>对局局数<input name="rounds" type="number" inputmode="numeric" autocomplete="off" min="1" max="100" value="10" required></label><label class="zp-draw-penalty">黄庄每家获赔<input name="drawPenalty" type="number" inputmode="numeric" autocomplete="off" min="0" max="100" value="1" required><small>庄家支付，0 为不赔</small></label></div><details class="zp-advanced"><summary>更多规则</summary><div class="zp-rule-toggles"><label><input name="allowDiscardHu" type="checkbox" checked> 允许点炮胡（点炮者双倍）</label><label><input name="allowPassedHu" type="checkbox"> 允许过张后胡牌</label><label><input name="mustHu" type="checkbox"> 有胡必胡</label><label><input name="special" type="checkbox" checked> 特殊胡型加分</label><label><input name="repeatWake" type="checkbox"> 翻重醒</label></div></details><p id="zp-settings-summary" class="zp-rule-summary"></p><p id="zp-settings-error" class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button secondary" id="zp-cancel-settings">取消</button><button class="button primary" type="submit">创建房间 →</button></div></form>`;
  document.body.append(dialog);
  const form = $("#zp-form");
  const settings = () => {
    const c = Object.fromEntries(new FormData(form));
    for (const k of ["minHu", "base", "rounds", "drawPenalty"])
      c[k] = Number(c[k]);
    for (const k of [
      "allowDiscardHu",
      "allowPassedHu",
      "mustHu",
      "special",
      "repeatWake",
    ])
      c[k] = form.elements[k].checked;
    c.flower = c.flower === "true";
    return { ...c, game: "zipai" };
  };
  form.addEventListener(
    "input",
    () => ($("#zp-settings-summary").textContent = zipaiSummary(settings())),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    $("#zp-settings-error").textContent = "";
    try {
      await create(settings());
      dialog.close();
    } catch (error) {
      $("#zp-settings-error").textContent = error.message;
      $("#zp-settings-error").tabIndex = -1;
      $("#zp-settings-error").focus();
    } finally {
      button.disabled = false;
    }
  };
  $("#zp-close-settings").onclick = $("#zp-cancel-settings").onclick = () =>
    dialog.close();
  $("#zp-exit").onclick = () => {
    input?.cancel();
    motion?.cancel();
    exit();
  };
  $("#zp-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast("房间号已复制");
    } catch {
      toast("房间号：" + room.code);
    }
  };
  $("#zp-rules").onclick = showRules;
  $("#zp-stats").onclick = () => showStats();
  $("#zp-sort").onclick = () => {
    layout = autoArrange(ownCards());
    selected = null;
    saveLayout();
    renderHand();
  };
  let resultsOpen = false;
  const resultBoard = document.createElement("section");
  resultBoard.id = "zipai-result-board";
  resultBoard.className = "zp-result-board hidden";
  resultBoard.setAttribute("aria-label", "三家结算");
  function closeResults() {
    resultsOpen = false;
    resultBoard.classList.add("hidden");
    root.classList.remove("zp-show-results");
  }
  function openResults() {
    resultsOpen = true;
    resultBoard.classList.remove("hidden");
    root.classList.add("zp-show-results");
  }
  resultBoard.innerHTML = `<header class="zp-result-header"><div><span class="eyebrow">GUILIN ZIPAI · 本局结算</span><h2 id="zp-result-title">三家亮牌</h2></div><label><select id="zp-result-round" aria-label="选择结算牌局"></select></label><button class="zp-result-close" id="zp-result-close" aria-label="关闭结算">×</button></header><div class="zp-result-scroll"><div id="zp-result-summary" class="zp-result-summary"></div><div id="zp-result-players" class="zp-result-players"></div><div id="zp-result-bottom" class="zp-result-bottom"></div><details class="zp-result-history"><summary>整局行动记录 <span id="zp-result-action-count"></span></summary><ol id="zp-result-log" class="zp-stats-log" tabindex="0"></ol></details></div><footer id="zp-result-footer" class="zp-result-footer"></footer>`;
  resultBoard.setAttribute("aria-labelledby", "zp-result-title");
  root.querySelector(".zp-arena").append(resultBoard);
  $("#zp-result-close").onclick = () => closeResults();
  $("#zp-result-round").onchange = (e) => {
    resultHand = Number(e.target.value);
    renderStats();
  };

  function showRules() {
    if (!room) return;
    const c = room.config;
    info(
      "桂林字牌 · 本桌规则",
      "YOUR TABLE, YOUR RULES",
      `<div class="guide-block"><h3>${esc(zipaiSummary(c))}</h3><p>三人，${c.flower ? 81 : 80} 张牌；庄家 21 张，闲家各 20 张。普通摸牌公开响应，不能直接收入手牌；扫、过扫、扫穿的摸牌只对本人显示。起手一笼留在手牌，不能拆出。成坎不能拆，吃牌须同时完成下比。自摸先检查能否胡牌，再确认扫／扫穿；其余依次胡、开招／碰、吃；${c.allowDiscardHu ? "允许点炮胡" : "仅允许摸出的牌胡牌"}，${c.allowPassedHu ? "允许胡过张" : "放弃吃、碰、胡或打出同字后，不可胡他人该字牌；本人再次自摸不受此限"}。胡家坐庄，黄庄连庄。</p></div><div class="guide-block"><h3>胡数 · 小字 / 大字</h3><p>一二三、二七十：3 / 6；碰：1 / 3；坎、扫、过扫：3 / 6；开招：6 / 9；扫穿、起手四张：9 / 12；普通顺子、大小搭不计胡。</p><p>10–14 胡 2 子，15–19 胡 3 子，之后每 5 胡加 1 子。自摸按（基础子数 + 特殊加分 + 翻醒子数）× 2；${c.special ? "天胡、地胡、三笼或五坎加 1 子；海底胡加 2 醒子" : "本桌关闭特殊加分"}。胡牌后自动逐张翻醒，命中重醒自动继续；醒数和剩余底牌直接展示在牌桌。每张命中醒牌加 1 子；${c.repeatWake ? "醒命中四张可继续翻醒" : "不翻重醒"}。</p><p>每家支付 = 总子数 × 底分 ${c.base}。自摸或胡公开摸牌由另两家分别支付，点炮仅出牌者支付双倍。黄庄庄家给每位闲家 ${c.drawPenalty ?? 1} 分（不乘底分）。${c.flower ? "飞飞一局一张，始终留在手中，不可打出或参与吃碰扫开招；仅胡牌结算时匹配最大合法胡数，同字不超过四张。摸到飞飞公开展示后收入手牌并出一张。" : "本桌不加入飞飞。"}共 ${c.rounds} 局，每局结束后手动准备。</p></div><div class="guide-block"><h3>操作与 AI</h3><p>发牌后自动理牌，每笔可手动放五张；整理分组不改变吃碰规则。拖到空白处新建一笔，刷新和同步保留手动布局，主动点击「理牌」才重新整理。点选手牌后点击「出牌」，或向上滑出合法手牌直接出牌。只有一种吃法时点击「吃」直接生效；多种吃法才展开组合选择。扫、过扫、扫穿、开招按规则必须执行，但真人需点击对应按钮确认；扫胡、开招胡直接点击「胡」；多种合法胡法可以选择组合。公开行动位倒计时 30 秒，超时变红正计时。第三家的碰／开招响应超时后失效，不会显示第三家计时器。下一家可继续选择吃牌；真人出牌不会被自动代打。字牌 AI 使用本地组牌策略，只能看到自己的手牌及公开信息。</p></div>`,
    );
  }
  function cardColumnsHTML(columns, winningCard = null, showHu = false) {
    return columns
      .map((column) => {
        const cards = Array.isArray(column) ? column : column.cards;
        return `<div class="zp-card-column">${cards.map((c) => tile(c, { winning: c === winningCard })).join("")}${showHu ? `<small class="zp-column-hu">${column.hu || 0}</small>` : ""}</div>`;
      })
      .join("");
  }
  function meldsHTML(p) {
    return p.melds
      .filter((m) => !m.initial)
      .map(
        (m) =>
          `<div class="zp-meld" title="${labels[m.kind]}${m.hu === null ? "" : " · " + m.hu + " 胡"}">${m.cards.map((c) => tile(c)).join("")}<small>${labels[m.kind]}${m.hu === null ? "" : " " + m.hu}</small></div>`,
      )
      .join("");
  }
  function discardsHTML(p) {
    return `<div class="zp-discards" aria-label="${esc(p.name)}的弃牌">${p.discards.map((c) => tile(c)).join("")}</div>`;
  }
  function profileHTML(p) {
    return `<div class="zp-player"><span class="zp-avatar">${esc(p.name[0])}</span><strong title="${esc(p.name)}">${esc(p.name)} ${p.id === g.dealer ? "<em>庄</em>" : ""}</strong><b class="${String(p.score).length > 4 ? "zp-long-score" : ""}" title="${signed(p.score)} 积分">${compactScore(p.score)}<small>积分</small></b><span class="zp-seat-clock" data-clock-seat="${p.id}" role="timer" aria-live="off" hidden></span></div>`;
  }
  function publicHTML(p, expanded = false) {
    const melds = p.melds.filter((m) => !m.initial),
      hu = melds.reduce((n, m) => n + (m.hu || 0), 0);
    if (!melds.length && !p.discards.length)
      return '<div class="zp-public zp-public-empty" aria-hidden="true"></div>';
    return (
      '<div class="zp-public" aria-label="' +
      esc(p.name) +
      '的公开牌"><header><strong>' +
      (melds.length ? hu + " 胡" : "公开牌") +
      '</strong><button type="button" data-zp-public="' +
      p.id +
      '" ' +
      (expanded ? "hidden" : "") +
      ' aria-label="展开' +
      esc(p.name) +
      '的公开牌">查看 ' +
      melds.length +
      ' 组</button></header><div class="zp-public-scroll" tabindex="0"><div class="zp-melds">' +
      meldsHTML({ ...p, melds }) +
      "</div>" +
      discardsHTML(p) +
      "</div></div>"
    );
  }
  function positionOf(id) {
    return id === g.mySeat
      ? "self"
      : id === (g.mySeat + 2) % 3
        ? "left"
        : "right";
  }
  function render() {
    if (disposed || !g) return;
    root.classList.toggle("zp-complete", g.street === "complete");
    input?.sync(
      [
        g.hand,
        g.turn,
        g.current?.card,
        ownCards().join(","),
        JSON.stringify(g.legal),
      ].join(":"),
    );
    const me = g.players[g.mySeat],
      others = [g.players[(g.mySeat + 2) % 3], g.players[(g.mySeat + 1) % 3]];
    text($("#zp-name"), g.config.name);
    text($("#zp-room"), `房间 ${room.code}`);
    text($("#zp-hand"), `第 ${String(g.hand).padStart(3, "0")} 局`);
    text($("#zp-remaining"), g.remaining);
    text($("#zp-notice"), g.handLog?.at(-1) || "牌局已连接");
    const current = g.current,
      card = current?.card ?? g.dangdi,
      key = [
        g.hand,
        card,
        current?.source,
        current?.draw,
        current?.claimed,
        current?.concealed,
      ].join(":");
    $("#zp-current").dataset.position = positionOf(current?.source ?? g.dealer);
    const shown = !!current && !current.claimed && g.street !== "complete";
    $("#zp-current").classList.toggle("hidden", !shown);
    if ($("#zp-current").dataset.key !== key) {
      $("#zp-current").dataset.key = key;
      $("#zp-current").innerHTML = shown
        ? `<small>${(positionOf(current.source) === "left" ? "← " : positionOf(current.source) === "right" ? "→ " : "你 ") + (current.concealed ? "暗摸" : current.draw ? "摸牌" : "出牌")}</small>${tile(card)}`
        : "";
      $("#zp-current").setAttribute(
        "aria-label",
        current
          ? g.players[current.source].name + (current.draw ? "摸牌" : "出牌")
          : "当前出牌",
      );
    }
    for (const [i, p] of others.entries()) {
      let owner = root.querySelector('[data-zp-seat="' + p.id + '"]');
      if (!owner) {
        owner = document.createElement("article");
        owner.dataset.zpSeat = p.id;
        owner.innerHTML =
          '<div class="zp-profile-slot"></div><div class="zp-public-slot"></div>';
        $("#zp-opponents").append(owner);
      }
      owner.className =
        "zp-opponent " +
        (i ? "right" : "left") +
        (g.turn === p.id ? " active" : "");
      patchHTML(owner.querySelector(".zp-profile-slot"), profileHTML(p));
      patchHTML(owner.querySelector(".zp-public-slot"), publicHTML(p));
    }
    patchHTML($("#zp-self-summary"), profileHTML(me));
    $("#zp-self-summary").dataset.zpSeat = me.id;
    $("#zp-self-summary").classList.toggle(
      "active",
      g.turn === me.id && g.street !== "complete",
    );
    patchHTML($("#zp-self-melds"), publicHTML(me));
    const records = $("#zp-record-list"),
      follow =
        records.scrollHeight - records.scrollTop - records.clientHeight < 40;
    patchHTML(
      records,
      (g.handLog || []).map((s) => `<li>${esc(s)}</li>`).join(""),
    );
    if (follow) records.scrollTop = records.scrollHeight;
    renderWake();
    renderHand();
    renderControls();
    fitViewport();
  }
  function renderWake() {
    root.classList.toggle("zp-waking", g.street === "wake");
  }
  function ownCards() {
    const p = g.players[g.mySeat];
    return [
      ...p.hole,
      ...p.melds.filter((m) => m.initial).flatMap((m) => m.cards),
    ];
  }
  function saveLayout() {
    const signature = orderHand + ":" + JSON.stringify(layout);
    if (lastSavedLayout === signature) return;
    lastSavedLayout = signature;
    try {
      let saved = JSON.parse(
        localStorage.getItem("river-zipai-layouts") || "{}",
      );
      saved = { ...saved, [orderHand]: layout };
      const keys = Object.keys(saved);
      for (const key of keys.slice(0, Math.max(0, keys.length - 12)))
        delete saved[key];
      localStorage.setItem("river-zipai-layouts", JSON.stringify(saved));
    } catch {}
  }
  function sizeHand() {
    fitViewport();
  }
  function fitResultCards() {
    fitViewport();
  }
  function renderHand() {
    if (!g) return;
    const me = { ...g.players[g.mySeat], hole: ownCards() },
      key =
        room.code +
        ":" +
        g.mySeat +
        ":" +
        (g.dealId || g.hand + ":" + g.dangdi);
    if (orderHand !== key) {
      cancelDrag();
      orderHand = key;
      selected = null;
      try {
        layout = JSON.parse(
          localStorage.getItem("river-zipai-layouts") || "{}",
        )[key];
      } catch {
        layout = null;
      }
      layout = layout ? reconcileLayout(layout, me.hole) : autoArrange(me.hole);
      handSignature = "";
    }
    layout = reconcileLayout(layout, me.hole);
    if (!me.hole.includes(selected)) selected = null;
    $("#zp-selected").textContent =
      selected === null ? "" : `已选 ${name(selected)}`;
    saveLayout();
    if (input?.dragging) return;
    const signature = JSON.stringify([layout, selected, g.legal?.discard]);
    if (signature === handSignature) {
      sizeHand();
      return;
    }
    handSignature = signature;
    const scroll = $("#zp-hand-cards");
    patchHTML(
      scroll,
      '<div class="zp-hand-track">' +
        layout.columns
          .filter((col) => col.cards.length || input?.dragging)
          .map(
            (col) =>
              `<div class="zp-hand-column ${col.cards.length ? "" : "zp-empty-column"}" data-zp-column="${esc(col.id)}">${col.cards.map((card, index) => `<button class="zp-hand-card ${selected === card ? "selected" : ""} ${g.legal?.discard.includes(card) ? "playable" : ""}" data-zp-card="${card}" data-zp-index="${index}" aria-label="${name(card)}${g.legal?.discard.includes(card) ? "，可出牌" : ""}" aria-pressed="${selected === card}">${tile(card)}</button>`).join("")}<span class="zp-column-space" aria-hidden="true">${col.cards.length ? "" : "＋"}</span></div>`,
          )
          .join("") +
        "</div>",
    );
    scroll.scrollLeft = 0;
    sizeHand();
  }
  const handArea = $("#zp-hand-cards");
  const bounds = (r) => ({
    ...r,
    left: r.x,
    top: r.y,
    right: r.x + r.width,
    bottom: r.y + r.height,
  });
  input = createInputController({
    root,
    hand: handArea,
    getState: () => ({
      layout,
      selected,
      legal: latest ? latest.legal : g?.legal,
      pending,
      geometry,
      handRect: bounds(geometry.regions.hand),
      arenaRect: bounds(geometry.regions.table),
    }),
    onSelect(card) {
      selected = card;
      renderHand();
      renderControls();
    },
    onMove(value, card) {
      layout = value;
      selected = card;
      saveLayout();
      handSignature = "";
      renderHand();
      renderControls();
    },
    onSubmit: (action, extra) => command("action", { action, ...extra }),
    toast,
  });
  function cancelDrag() {
    input?.cancel();
  }
  function preparationHTML() {
    const me = room.members.find((m) => m.seat === room.mySeat);
    if (g.finished)
      return '<button class="button primary" data-zp-control="stats">查看本场排行榜</button>';
    return `<span class="zp-ready-members">${room.members.map((m) => `${esc(m.name)} · ${m.ready ? "已准备" : "未准备"}`).join("　")}</span><button class="button ${me?.ready ? "secondary" : "primary"}" data-zp-control="ready">${me?.ready ? "取消准备" : "准备"}</button>${room.host ? `<button class="button secondary" data-zp-control="next" ${room.members.every((m) => m.ready) ? "" : "disabled"}>发下一局 →</button>` : ""}`;
  }
  function wireActions(container) {
    for (const b of container.querySelectorAll(
      "[data-zp-control],[data-zp-option]",
    ))
      b.disabled =
        (pending &&
          !["stats", "close-result", "cancel-hu", "cancel-chi"].includes(
            b.dataset.zpControl,
          )) ||
        b.dataset.invalid === "true" ||
        (b.dataset.zpControl === "next" && !room.members.every((m) => m.ready));
  }
  root.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest(
        "[data-zp-control],[data-zp-option],[data-zp-public]",
      );
      if (!b || b.disabled) return;
      if (b.dataset.zpPublic !== undefined) {
        openPublic(Number(b.dataset.zpPublic));
        return;
      }
      if (b.dataset.zpOption) {
        command("action", { action: b.dataset.zpOption });
        return;
      }
      const k = b.dataset.zpControl;
      if (k === "stats") return showStats();
      if (k === "choose-chi") {
        const choices = g.legal.options.filter((o) => o.kind === "chi");
        if (choices.length === 1)
          return command("action", { action: choices[0].id });
        chiOpen = true;
        huOpen = false;
        renderControls();
        fitViewport();
        $("#zp-options button")?.focus();
        return;
      }
      if (k === "hu" && g.legal.huChoices?.length > 1) {
        huOpen = true;
        chiOpen = false;
        renderControls();
        fitViewport();
        $("#zp-options button")?.focus();
        return;
      }
      if (k === "cancel-hu" || k === "cancel-chi") {
        chiOpen = huOpen = false;
        renderControls();
        return;
      }
      if (k === "close-result") return closeResults();
      if (k === "ready")
        return command("ready", {
          ready: !room.members.find((m) => m.seat === room.mySeat)?.ready,
        });
      if (k === "next") {
        closeResults();
        return command("next");
      }
      command("action", {
        action: k,
        ...(k === "discard" ? { amount: selected } : {}),
      });
    },
    { signal: lifecycle.signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (document.body.dataset.screen !== "zipai") return;
      if (e.key === "Escape" && (chiOpen || huOpen)) {
        e.preventDefault();
        chiOpen = huOpen = false;
        renderControls();
        root
          .querySelector("[data-zp-control=choose-chi],[data-zp-control=hu]")
          ?.focus();
      }
      if ((chiOpen || huOpen) && e.key === "Tab") {
        const buttons = [...$("#zp-options").querySelectorAll("button")];
        if (!buttons.length) return;
        const at = buttons.indexOf(document.activeElement);
        if (e.shiftKey && at <= 0) {
          e.preventDefault();
          buttons.at(-1).focus();
        } else if (!e.shiftKey && at === buttons.length - 1) {
          e.preventDefault();
          buttons[0].focus();
        }
      }
    },
    { signal: lifecycle.signal },
  );
  const publicDialog = document.createElement("dialog");
  publicDialog.className = "zp-public-dialog";
  document.body.append(publicDialog);
  publicDialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-public]")) publicDialog.close();
  });
  function openPublic(id) {
    input.cancel();
    chiOpen = huOpen = false;
    renderControls();
    const p = g.players[id];
    publicDialog.innerHTML =
      "<header><h2>" +
      esc(p.name) +
      '的公开牌</h2><button data-close-public aria-label="关闭公开牌">×</button></header>' +
      publicHTML(p, true);
    publicDialog.showModal();
  }
  function renderControls() {
    if (disposed || !g || !room) return;
    const l = latest?.legal,
      key = [
        g.hand,
        g.turn,
        g.street,
        g.current?.card,
        (g.handLog || []).length,
      ].join(":"),
      sameChoices = key === choiceKey,
      pickerScroll = $("#zp-options").scrollTop,
      focusedChoice = $("#zp-options").contains(document.activeElement)
        ? document.activeElement.dataset.zpOption
        : null;
    if (!sameChoices) {
      chiOpen = false;
      huOpen = false;
      choiceKey = key;
    }
    const done = g.street === "complete",
      waking = g.street === "wake",
      actions = $("#zp-actions");
    root.dataset.phase = waking
      ? "wake"
      : done
        ? "complete"
        : g.turn === g.mySeat
          ? "acting"
          : "waiting";
    $("#zp-turn").textContent = done
      ? g.finished
        ? "本场结束"
        : "本局结束 · 准备后继续"
      : waking
        ? "自动翻醒"
        : g.responseQueued
          ? "已选吃牌 · 等待响应结束"
          : "";
    updateClocks();
    if (!l) chiOpen = huOpen = false;
    const options = $("#zp-options");
    options.classList.toggle("zp-choice-open", chiOpen || huOpen);
    if (done) {
      patchHTML(actions, preparationHTML());
      patchHTML(options, "");
    } else if (waking) {
      patchHTML(actions, "");
      patchHTML(options, "");
    } else if (l) {
      const chi = l.options.filter((o) => o.kind === "chi");
      let buttons = actionModel(l, selected).filter(
        (o) =>
          !(
            (o.id === "hu" && huOpen) ||
            (o.id === "choose-chi" && (chiOpen || huOpen))
          ),
      );
      if (chiOpen || huOpen)
        buttons.unshift({
          id: huOpen ? "cancel-hu" : "cancel-chi",
          label: "返回",
        });
      patchHTML(
        actions,
        buttons
          .map(
            (o) =>
              '<button class="button ' +
              (o.primary ? "primary" : "secondary") +
              (o.id === "hu" ? " zp-hu" : "") +
              '" ' +
              (o.option ? "data-zp-option" : "data-zp-control") +
              '="' +
              o.id +
              '" data-invalid="' +
              !!o.disabled +
              '" ' +
              (o.disabled ? "disabled" : "") +
              ">" +
              esc(o.label) +
              "</button>",
          )
          .join(""),
      );
      if (huOpen)
        patchHTML(
          options,
          '<p class="zp-choice-title">选择胡牌组合</p>' +
            l.huChoices
              .map(
                (o) =>
                  '<button class="zp-hu-choice ' +
                  (o.recommended ? "zp-recommended" : "") +
                  '" data-zp-option="' +
                  o.id +
                  '"><strong>' +
                  esc(o.method) +
                  " · " +
                  o.hu +
                  "胡" +
                  (o.recommended ? " · 推荐" : "") +
                  '</strong><span class="zp-hu-combo">' +
                  cardColumnsHTML(o.groups, null, true) +
                  "</span></button>",
              )
              .join(""),
        );
      else if (chiOpen)
        patchHTML(
          options,
          '<p class="zp-choice-title">选择吃牌组合</p>' +
            chi
              .map(
                (o) =>
                  '<button class="zp-option ' +
                  (o.recommended ? "zp-recommended" : "") +
                  '" data-zp-option="' +
                  o.id +
                  '"><strong>' +
                  (o.recommended ? "推荐" : "吃") +
                  "</strong>" +
                  o.groups
                    .map(
                      (cards) =>
                        '<span class="zp-option-group">' +
                        cards.map((c) => tile(c)).join("") +
                        "</span>",
                    )
                    .join("") +
                  "</button>",
              )
              .join(""),
        );
      else patchHTML(options, "");
    } else {
      patchHTML(actions, "");
      patchHTML(options, "");
    }
    if (chiOpen || huOpen) {
      if (sameChoices) {
        options.scrollTop = pickerScroll;
        if (focusedChoice)
          options
            .querySelector('[data-zp-option="' + focusedChoice + '"]')
            ?.focus({ preventScroll: true });
      }
      options.setAttribute("role", "dialog");
      options.setAttribute(
        "aria-label",
        huOpen ? "选择胡牌组合" : "选择吃牌组合",
      );
    } else options.removeAttribute("role");
    fitViewport();
    wireActions(root);
    if (resultsOpen) renderStats();
  }
  function playerResultHTML(p, h, position) {
    const role = playerResultRole(h, p.id),
      isWinner = role === "winner",
      melds = (p.melds || []).filter((m) => !m.initial),
      initial = (p.melds || []).filter((m) => m.initial),
      meldIds = new Set(melds.flatMap((m) => m.cards)),
      hasCards = Array.isArray(p.hole),
      winningCard = isWinner ? h.winCard : null,
      handGroups =
        isWinner && h.groups?.length
          ? h.groups.filter((m) => m.cards.every((c) => !meldIds.has(c)))
          : null;
    const hand = handGroups
      ? cardColumnsHTML(handGroups, winningCard, true)
      : hasCards
        ? cardColumnsHTML(
            handColumns(
              [...p.hole, ...initial.flatMap((m) => m.cards)].sort(
                (a, b) => a - b,
              ),
            ),
            winningCard,
          )
        : '<span class="zp-old-record">旧记录未保存手牌</span>';
    return `<article class="zp-result-player ${position} ${role}" data-result-seat="${p.id}"><div class="zp-result-profile"><span class="zp-avatar">${esc(p.name[0])}</span><strong>${esc(p.name)}${p.id === g.mySeat ? " · 你" : ""}</strong><span class="zp-role-tag">${isWinner ? (h.selfDraw ? "自摸胡" : "胡牌") : role === "discarder" ? "点炮" : h.active ? "进行中" : h.draw ? "黄庄" : "未胡"}</span><b class="${p.delta > 0 ? "zp-positive" : p.delta < 0 ? "zp-negative" : ""}">${signed(p.delta || 0)}</b><small>累计 ${signed(p.score || 0)} 分</small></div><div class="zp-result-card-zone"><div class="zp-result-zone"><span class="zp-zone-label">${hasCards ? "手牌" : "已知胡牌组合"}${handGroups ? ` · ${handGroups.reduce((s, m) => s + (m.hu || 0), 0)} 胡` : ""}</span><div class="zp-result-card-columns">${hand}</div></div><div class="zp-result-zone zp-result-table-zone"><span class="zp-zone-label">桌牌 · ${Array.isArray(p.melds) ? melds.reduce((s, m) => s + (m.hu || 0), 0) + " 胡" : "旧记录未保存"}</span><div class="zp-result-card-columns">${cardColumnsHTML(melds, winningCard, true) || (Array.isArray(p.melds) ? '<span class="zp-old-record">无副露</span>' : '<span class="zp-old-record">旧记录未保存副露</span>')}</div></div></div></article>`;
  }
  function renderStats() {
    if (!g) return;
    const history = g.history || [],
      h = history.find((h) => h.hand === resultHand) || history[0] || null,
      select = $("#zp-result-round"),
      signature =
        room.code + ":" + history.map((h) => h.hand + ":" + h.draw).join(",");
    if (select.dataset.rounds !== signature) {
      select.dataset.rounds = signature;
      select.innerHTML = history.length
        ? history
            .map(
              (h) =>
                `<option value="${h.hand}">第 ${h.hand} 局${h.draw ? " · 黄庄" : ""}</option>`,
            )
            .join("")
        : "<option>当前对局</option>";
    }
    if (h) {
      resultHand = h.hand;
      select.value = String(h.hand);
    }
    const key = JSON.stringify([
      room.code,
      h?.hand ?? g.hand,
      h?.actions?.length ?? g.handLog?.length,
      !!h,
    ]);
    if (resultBoard.dataset.contentKey === key) {
      renderStatsFooter();
      return;
    }
    resultBoard.dataset.contentKey = key;
    const display = resultLabels(h),
      players = h?.players || g.players.map((p) => ({ ...p, delta: 0 })),
      bySeat = (id) => players.find((p) => p.id === id),
      order = [g.mySeat, (g.mySeat + 2) % 3, (g.mySeat + 1) % 3];
    $("#zp-result-title").textContent = h ? `第 ${h.hand} 局` : "本局进行中";
    const summary = h ? settlementSummary(h, players, g.config.base) : null;
    $("#zp-result-summary").innerHTML = summary
      ? '<div class="zp-summary-main"><h3 aria-label="' +
        esc(summary.headline) +
        '">' +
        (summary.winnerName
          ? esc(summary.winnerName) + ' 胡牌<span class="zp-summary-source-tag">' +
            esc((summary.sourceName || "") + summary.sourceLabel) + '</span>'
          : esc(summary.headline)) +
        '</h3>' +
        (summary.winnerName ? '<div class="zp-summary-counts"><span>' +
          esc(h.hu || 0) + '<small> 胡</small></span><span>' +
          esc(h.wakeUnits || 0) + '<small> 醒</small></span></div>' : '') +
        '</div><p class="zp-score-equation">' +
        esc(summary.formula) +
        '</p><p class="zp-score-ledger">' +
        summary.points
          .map(
            (p) =>
              '<span class="' +
              (p.delta > 0 ? "zp-positive" : p.delta < 0 ? "zp-negative" : "") +
              '" aria-label="' +
              esc(p.text || p.name + " " + signed(p.delta) + "分") +
              '" title="' +
              esc(p.name) +
              '"><span class="zp-ledger-name">' +
              esc(p.name) +
              "</span><b>" +
              esc(p.value || signed(p.delta) + "分") +
              "</b></span>",
          )
          .join("") +
        "</p>"
      : "<p>当前仅显示本人手牌与公开副露</p>";
    patchHTML(
      $("#zp-result-players"),
      order
        .map((id, i) =>
          playerResultHTML(
            bySeat(id),
            h || { active: true },
            ["self", "left", "right"][i],
          ),
        )
        .join(""),
    );
    const outcome = h?.draw
      ? `<div class="zp-wake-display zp-final-outcome"><strong>黄庄</strong><span>${h.drawPenalty ? "庄家各付 " + h.drawPenalty + " 分" : "庄家连庄"}</span></div>`
      : h
        ? `<div class="zp-wake-display"><span class="zp-zone-label">自动翻醒</span>${h.wakes?.map((w) => `<div>${tile(w.card)}<small>${w.hits.map((hit) => `${esc(words[hit.type])} × ${hit.count}`).join(" · ")}</small></div>`).join("") || ""}<strong>${h.wakeUnits || 0}<em>醒</em></strong></div>`
        : "";
    const bottomCards = h?.remainingCards?.length
      ? `<section class="zp-remaining-cards"><h3>底牌</h3><div>${h.remainingCards.map((c) => tile(c)).join("")}</div></section>`
      : "";
    patchHTML($("#zp-result-bottom"), outcome + bottomCards);
    const actions = h?.actions || g.handLog || [];
    patchHTML(
      $("#zp-result-log"),
      actions.map((s) => `<li>${esc(s)}</li>`).join(""),
    );
    $("#zp-result-action-count").textContent = `${actions.length} 条`;
    renderStatsFooter();
    fitResultCards();
  }
  function renderStatsFooter() {
    const ranked = g.players.slice().sort((a, b) => b.score - a.score);
    patchHTML(
      $("#zp-result-footer"),
      g.finished
        ? `<span class="zp-final-ranking">${ranked.map((p, i) => `${i + 1}. ${esc(p.name)} ${signed(p.score)} 分`).join("　")}</span><button class="button primary" data-zp-control="close-result">返回牌桌</button>`
        : g.street === "complete"
          ? preparationHTML()
          : '<span>对局进行中，查看统计不会代替玩家行动。</span><button class="button secondary" data-zp-control="close-result">返回牌桌</button>',
    );
    wireActions(resultBoard);
  }
  function showStats() {
    if (!g) return;
    input.cancel();
    chiOpen = huOpen = false;
    renderControls();
    resultHand = g.history?.[0]?.hand ?? null;
    renderStats();
    if (!resultsOpen) openResults();
    fitResultCards();
  }
  let receiving = false;
  motion = createMotionDirector({
    layer: $("#zp-effects"),
    getLayout: () => geometry,
    getSelf: () => latest?.mySeat ?? g?.mySeat ?? 0,
    onFrame(frame) {
      if (!latest?.legal) {
        g = frame.game;
        render();
        text($("#zp-notice"), frame.event.text);
      }
    },
    onRest() {
      if (disposed || receiving || !latest) return;
      g = latest;
      render();
      if (g.street === "complete" && lastReport !== room.code + ":" + g.hand) {
        lastReport = room.code + ":" + g.hand;
        showStats();
      }
    },
  });
  document.addEventListener(
    "visibilitychange",
    () => motion.setHidden(document.hidden),
    { signal: lifecycle.signal },
  );
  async function consume(data, ack) {
    receiving = true;
    if (data.rulesUpdated) toast("飞飞规则已更新，已恢复到手牌");
    if (data.actionExpired) toast("响应时间已结束，已同步当前牌桌");
    const previous = room?.code;
    room = data.room;
    latest = data.game ?? latest;
    document.body.dataset.screen = "zipai";
    if (previous !== room.code || data.reset) {
      motion.reset();
      lastReport = "";
      if (resultsOpen) closeResults();
    }
    if (!latest) {
      receiving = false;
      return;
    }
    const frames = (data.frames || []).filter(
      (f) => !f.event.silent && f.event.type !== "pass",
    );
    for (const frame of data.frames || []) ack?.(frame.id);
    if (latest.legal || (!frames.length && !motion.busy)) {
      g = latest;
      render();
    } else if (!g) {
      g = frames[0]?.game ?? latest;
      render();
    }
    if (layoutFrame) {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
    }
    applyLayout();
    if (frames.length) motion.enqueue(frames);
    receiving = false;
    if (!motion.busy) {
      g = latest;
      render();
      if (g.street === "complete" && lastReport !== room.code + ":" + g.hand) {
        lastReport = room.code + ":" + g.hand;
        showStats();
      }
    }
  }
  function updateClocks() {
    const active =
        latest &&
        room &&
        room.turnUntil &&
        !["complete", "wake"].includes(latest.street),
      offset = Number.isFinite(room?.receivedAt)
        ? room.serverTime - room.receivedAt
        : 0,
      diff = Date.now() + offset - (room?.turnUntil || 0);
    for (const clock of root.querySelectorAll("[data-clock-seat]")) {
      const shown = active && Number(clock.dataset.clockSeat) === latest.turn;
      clock.hidden = !shown;
      if (!shown) continue;
      const over = diff >= 0;
      clock.classList.toggle("overdue", over);
      const label = String(
        over
          ? "+" + Math.floor(diff / 1000)
          : Math.min(30, Math.ceil(-diff / 1000)),
      );
      clock.classList.toggle("long", label.length > 3);
      text(clock, label);
      const size = geometry?.seats.self.clock.width || 30;
      clock.style.fontSize =
        Math.min(size * 0.44, (size - 9) / (label.length * 0.68)) + "px";
      clock.setAttribute(
        "aria-label",
        over
          ? "超时 " + Math.floor(diff / 1000) + " 秒"
          : "剩余 " + Math.ceil(-diff / 1000) + " 秒",
      );
    }
  }
  const clockTimer = setInterval(() => {
    if (document.body.dataset.screen === "zipai") updateClocks();
  }, 250);
  return {
    consume,
    whenIdle: () => motion.whenIdle(),
    inspectLayout: () => geometry,
    dispose() {
      disposed = true;
      clearInterval(clockTimer);
      cancelAnimationFrame(layoutFrame);
      lifecycle.abort();
      input.dispose();
      motion.dispose();
      publicDialog.remove();
      dialog.remove();
      root.remove();
    },
    setPending(value) {
      pending = value;
      if (document.body.dataset.screen === "zipai") renderControls();
    },
    openSettings() {
      form.reset();
      $("#zp-settings-error").textContent = "";
      $("#zp-settings-summary").textContent = zipaiSummary(settings());
      dialog.showModal();
    },
    showRules,
  };
}
