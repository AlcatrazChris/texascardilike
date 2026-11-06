# 测试矩阵与复现

## 实际环境

2026-11-07，Windows、Node 22、Playwright 1.65.0、已安装的 Microsoft Edge 156.0.4314.58。没有下载浏览器。测试服务器在本机 3005 端口运行，使用内存房间存储，关闭 DeepSeek；不访问生产 Redis 或生产房间。

最终结果：184 项单元／规则测试通过，构建检查通过，18 项浏览器测试通过。33 张基线截图使用零像素差异门槛，最终验证没有更新基线。

## 视口

| 视口 | 模式 | 固定截图 |
| --- | --- | --- |
| 320 × 568 | 竖屏 | opening / dense / result |
| 360 × 600 | 竖屏 | opening / dense / result |
| 390 × 640 | 竖屏 | opening / dense / result |
| 390 × 844 | 竖屏 | opening / dense / result |
| 430 × 932 | 竖屏 | opening / dense / result |
| 844 × 320 | 紧凑横屏 | opening / dense / result |
| 844 × 390 | 紧凑横屏 | opening / dense / result |
| 1024 × 768 | 桌面 | opening / dense / result |
| 1366 × 768 | 桌面 | opening / dense / result |
| 1715 × 1012 | 桌面 | opening / dense / result |

基线目录：`tests/visual/baselines/chromium-win32/`，文件名为 `状态-宽x高.png`。另外三张是 `chi-picker.png`、`hu-picker.png`、`motion-midpoint.png`。固定日期消除时钟漂移；动画截图把实际 WAAPI 动画暂停在 190ms，而不是靠随机等待截图。

## 浏览器覆盖

| 文件 | 用例数 | 验证内容 |
| --- | ---: | --- |
| layout.spec.mjs | 11 | 十视口开局、密集亮牌与结算；真实命中测试；三家资料卡一致；吃／胡多选与单选直达 |
| input-motion.spec.mjs | 2 | 实际触摸拖动至五张一笔、旋转取消、22 列局部滚动、60 次轮询节点稳定；动画中点、隐私牌背、合法操作中断播放、重复醒事件 |
| lifecycle.spec.mjs | 1 | 12 次创建／销毁后的 DOM 和监听器数量检查；隐藏／旋转取消；换房相同事件编号仍可播放 |
| clock.spec.mjs | 1 | 十视口圆形计时器、+99 至 +999999 不溢出、模拟安全边距 |
| room-flow.spec.mjs | 3 | 真实创建与 AI 补位、三个独立浏览器上下文联机、刷新重连、结束／准备／下一局、德州开局烟测 |

几何断言之外，还通过 `elementFromPoint` 检查按钮实际接收点击。结算三家的牌在独立滚动体内均可到达，准备栏保留。重连沿用服务器原来的“重新准备”行为，未修改房间规则。

罕见牌型和多选使用固定 UI 夹具，实际房间测试使用合法 API 行动推进；没有依赖随机发到某种牌才能通过测试。夹具由 Playwright 路由提供，生产服务器没有增加测试入口。

## 验证截图检测器

临时启用测试专用标题改色探针，390 × 844 开局截图正确失败，检测到 464 个差异像素。关闭探针后完整 18 项重新通过。

- [预期图](evidence/canary/opening-390x844-expected.png)
- [故意改色的实际图](evidence/canary/opening-390x844-actual.png)
- [差异图](evidence/canary/opening-390x844-diff.png)

这三个文件是检测器的故障注入证据，不是未修复的界面差异。

## 运行方法

```sh
npm ci
npm test
npm run build
npm run test:ui
```

Windows 默认使用系统 Edge。其他系统需自行安装 Playwright Chromium，并为对应系统审阅截图基线。可选的 `PW_WEBKIT=1` 需要另行安装 WebKit；本次没有运行该项目，CDP 专属触摸／生命周期检查也不能直接视作 WebKit 验证。

只有确认设计变化后才运行 `npm run test:ui:update`，逐张审阅新基线，不用更新基线掩盖失败。测试机制参考 [Playwright 官方截图比较文档](https://playwright.dev/docs/test-snapshots)。

失败报告保存在忽略入库的 `playwright-report/`、`test-results/`，包含截图和失败 trace。真实 iOS Safari、Android 浏览器、软键盘和长期 GPU／帧率表现仍需真机验收；本机浏览器模拟安全区不等于硬件验证。
