# P0 实际审计（2026-11-07）

基线：Git `3400180`，原生 HTML/JS/CSS，Node 22 + Vercel Functions；本地 `PORT=3005 node server.mjs`，内存房间，不连接生产 Redis。已用 Playwright + 本机 Edge 完成首页建房、AI 补位、准备、开局、选牌、理牌、统计、刷新恢复、完整对局、下一局。运行元数据见 `evidence/audit/run.json`。十种指定视口均保存截图。没有测试真实手机硬件或 Safari。

| ID / 级别 | 阶段与复现 | 视口 / 证据 | 源码与验证根因 | 系统性处理 |
|---|---|---|---|---|
| A01 / P1 | 开局缩为短横屏，手牌与操作区字体显著变小；空白仍充裕 | 844×320；`evidence/audit/live-844x320.png` | `zipai-hand.js:handGeometry` 按高度独立选尺寸；CSS 又独立分配空间，未共享最低可读阈值 | 统一求解空间，手牌局部滚动，禁止压缩公开牌到 7px |
| A02 / P1 | 服务端已结束后，页面仍播放历史动作；等待结算超过 30s，刷新恢复可立即见结算 | 390×844；基线 Playwright 等待超时，恢复后 `evidence/audit/settlement.png` | `zipai.js:consume` 每帧 await 读牌停留，`RoomClient.apply` 等待 onState，网络 pending 与动画混为一体 | 有界 Motion Director；网络接收不等待动画，合法动作能中断回放，重连直接还原 |
| A03 / P1 | 对同一状态重复轮询，三家头像/公开区节点被替换 | 所有；源码 + DOM 更新检查 | `render` 对 `#zp-opponents`、自己名牌和公开区无条件 innerHTML | 稳定座位容器，按组件签名更新，保留滚动与焦点 |
| A04 / P1 | 发牌、摸牌动画端点不能随真实座位布局变化 | 横竖屏；动画样式审查，真实开局截图 | `zipai-interactions.css` 使用固定 `--dx:-33vw`、`--dy:48vh` | 以统一布局锚点生成运行时 transform 轨迹，旋转取消并重投影 |
| A05 / P1 | 手牌 22 列时 pitch 可小于可辨识牌头宽，正常开局不必然发生 | 固定密集夹具；源码 `handSpread` | 无最小可点击宽度，仅保证整体不越界 | 手牌保持尺寸，拥挤时仅手牌带水平滚动 |
| A06 / P2 | 结算尺寸通过多轮读写 DOM 才稳定，三种算法处理手牌、副露和醒牌 | `evidence/audit/statistics.png`、`settlement.png` | `fitResultCards` while 中读写布局，`sizeHand` 与 CSS 独立计算 | 牌张几何 tokens + 一次纯布局计算；结算内容区可滚动，保留清晰牌面 |
| A07 / P1 | 拖动时旋转或隐藏页面，没有完整取消手势；再次点击同牌未取消选中 | 所有；输入源码确认 | 监听器直接共享 gesture、selected，多处取消条件不一致 | 独立输入状态机，统一取消、单次提交、防误触与插入预览 |
| A08 / P2 | 快捷选择虽保留 scroll，轮询仍重建其 DOM，需恢复焦点 | 吃/胡选择器 | `renderControls` 全部拼接按钮、覆盖 onclick | 一个委托监听器，共享选择器基座，签名不变则不重绘 |

未把假设当作已复现问题：基线普通开局的十种视口没有发现实际头像重叠。高密度公开牌、长昵称、五张一笔与重复轮询作为固定回归场景继续验证。审计截图是开发证据，不作为生产资源。

P0 完成后才开始修改布局。基线恢复点为 `3400180`；核心规则、服务端协议、身份权限与德州模块在本轮冻结。
