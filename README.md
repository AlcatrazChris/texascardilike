# River · 德州扑克练习室

参考提供的 UI 制作：浅绿色侧栏、浅色椭圆牌桌、浮动玩家卡片、底部下注操作。支持桌面与手机，后端为 Vercel Node.js Functions。前后端均无第三方运行依赖。

入口页支持房间号加入、创建联机房间和人机对局；支持真人联机、AI 补位和逐个设置难度。使用步骤、本地 DeepSeek 配置与联网部署见 [联机说明](docs/MULTIPLAYER.md)。手牌与筹码独立展示，随机算法与模型流量控制见 [发牌与 AI 说明](docs/AI-AND-FAIRNESS.md)。

新增规则与完整操作说明见 [筹码、投票与准备](docs/TABLE-PLAY.md)。

## 本地运行

安装 Node.js 22 或更新版本后，在项目目录运行：

```sh
npm run dev
```

访问 **http://localhost:3000**，无需安装第三方依赖。便携运行时不纳入 Git；如果本地已经准备了 `.tools/node.exe`，也可以运行：

```powershell
.\.tools\node.exe server.mjs
# 或
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

开发服务自动读取 `.env.local` 和 `.env`，启动环境变量优先。可以复制 `.env.local.example` 为 `.env.local`，填写固定 `SESSION_SECRET` 与可选的 `DEEPSEEK_API_KEY` 后启动。未配置 SESSION_SECRET 时使用临时密钥，重启会使旧人机牌局凭证失效。本地联机默认使用单进程共享内存，重启会清除房间；局域网内其他设备可通过启动电脑 IP 和端口访问。

## 已实现

界面交互更新：每次下注、跟注、过牌、弃牌、发牌和结算均按服务端动作顺序逐个播放，包含系统提示、操作玩家高亮、筹码飞入 / 退回 / 派发动画；动画随动作类型保留必要停留，切换到后台时暂停播放。人机下注先流式确认，再继续展示 AI 决策。播放完成前禁止重复提交牌桌操作，但可以查看规则、记录与统计。下注支持直接输入整数，不合法时弹窗说明规则并保留输入，不会自动改成其他下注金额。筹码与底池数字已放大加粗，顶部信息栏及侧栏装饰内容已移除。

- 2–9 人标准 52 张德州扑克，支持房间号真人联机与单人人机；所有真人准备后，房主可选择 AI 补齐或按现有人数开局。
- 人机与联机均支持轻松、标准、进阶难度；联机大厅可逐个设置空位 AI 的难度。
- 无限注、底池限注、固定限注三种下注结构；固定限注前两轮单位为大盲，后两轮单位为两倍大盲，每轮四次下注（含初始下注），单挑不限制次数。
- 自定义大小盲、初始筹码、每人前注 / 大盲前注、现金桌抽水比例与上限。
- 现金桌、积分桌、锦标赛；锦标赛按手数翻倍升盲，破产淘汰，其他模式归零后真人手动选择领取金额，最多初始筹码；累计借入以红色负数显示，并计入净积分扣除。积分赛支持 1–100 轮，每轮公布排名与统计。
- 正确的庄家轮换、单挑行动顺序、过牌、跟注、弃牌、合法加注范围、不足额全下与重新开放加注权。
- 四轮下注、烧牌、全下投票选择发一次或两次（两次须全员同意）、九种牌型、最佳五张牌与踢脚比较、A2345 顺子。
- 主池、多个边池、未跟注退款、平局分池、从庄家左边开始分配零头、无翻牌不抽水。
- 最近 30 手历史、当前行动日志、全场积分、CSV 导出、最近 15 场归档、音效、快捷键。
- 服务端密码学随机洗牌；人机使用 AES-256-GCM 认证加密凭证，联机使用独立座位身份与服务端共享状态，所有动作帧按玩家脱敏。
- 人机凭证有效期 7 天；联机房间默认 24 小时活动续期，支持同一身份刷新恢复、45 秒红色超时提示（不自动弃牌）与退出后 AI 接管。

加注输入表示“本轮投入总额”，包含本轮已有的盲注与下注。底池快捷按钮依据跟注后底池计算；超过限注范围时自动截断。积分为筹码净变化，补入计入累计买入。进行中的下注按未结算资产处理，结算后更新净收益。

## 部署到 Vercel

源码仓库：[AlcatrazChris/texascardilike](https://github.com/AlcatrazChris/texascardilike)。对应现有 Vercel 项目为 `river-poker`，生产分支使用 `main`；通过项目的 Git 集成部署，不需要把 Vercel 或 DeepSeek 密钥写入仓库。

已提供 `vercel.json`。部署流程符合 Vercel 的 [Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js) 与 [项目配置](https://vercel.com/docs/project-configuration/vercel-json) 方式。

1. 将项目上传到自己的 Git 仓库，在 Vercel 中导入。
2. Framework Preset 选择 **Other**。Build Command 为 `npm run build`，Output Directory 为 `public`，配置文件已声明这两项。
3. 在 Vercel 项目的 Environment Variables 添加 `SESSION_SECRET`，使用至少 32 字符的随机密钥，并在需要的 Production / Preview 环境中配置。
4. 联机需设置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`，用于共享房间与原子并发更新。需要模型时再配置 DeepSeek 变量。
5. 点击 Deploy。后端入口为 `/api/game` 和 `/api/room`，前端由 `public` 目录提供。

可在本地生成密钥，复制结果到 Vercel 环境变量；不要提交密钥：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

也可在安装 Vercel CLI 并登录后从项目根目录执行 `vercel` / `vercel --prod`。当前正式地址：https://river-poker-drab.vercel.app ，发布记录见 `docs/DEPLOYMENT.md`。

## 验证

```sh
npm test
npm run build
node scripts/check-publish.mjs
```

测试包括牌型与踢脚、低顺子、边池、退款、平局零头、抽水、单挑顺序、非法操作、不足额全下、锦标赛、加密凭证、AI API 流程，以及多种下注结构和人数的连续对局筹码守恒。

发布检查会根据 `.gitignore` 枚举待提交文件，并检查真实本地密钥、常见凭证和意外二进制文件；只输出问题路径，不输出密钥值。`.env.example` 与 `.env.local.example` 为可提交模板，真实 `.env*`、`.tools/`、`.vercel/`、依赖、缓存和授权文件均排除。

浏览器已实际验证桌面 / 手机布局、跟注、规则提交、统计展示和刷新恢复。浏览器 QA 工具位于当前工作区的 `.tools` 中，未纳入源码发布，截图与测试浏览器缓存可随时清理。

## 空间与延迟

应用没有运行时 npm 依赖，本机可直接运行 `start.ps1`。`.tools/node.exe` 是在没有系统 Node.js 时使用的运行时，保留它即可继续启动。测试缓存清理与压缩基准：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/clean-cache.ps1
.tools/node.exe scripts/benchmark.mjs
```

清理命令只删除列明的测试浏览器配置、下载缓存、生成截图和临时测试数据，保留源码、环境变量、Vercel 登录状态、项目关联和本地 Node.js。加上 `-DryRun` 仅预览；加上 `-IncludeDeploymentTools` 还会移除可重新安装的 Vercel CLI。本地服务与正式网站均不依赖此 CLI。需要重新安装发布工具时执行：

```powershell
.tools/node.exe .tools/npm/package/bin/npm-cli.js install --prefix .tools/vc --cache "$env:TEMP/river-poker-npm-cache" vercel@65.2.0
```

人机对局以 NDJSON 流式返回动作，玩家下注先显示，AI 计算与动画并行；服务器确认最终结果后才更新加密凭证。联机使用压缩房间数据和无变化轻量轮询，玩家操作可以优先于正在等待的轮询。会话采用压缩后认证加密，兼容旧凭证；完整行动记录仍保留。对比数据、验证范围与注意事项见 `docs/PERFORMANCE.md`。

## 适用范围

当前版本支持 **真人房间与 AI 对局**。AI 使用公开行动范围加权的蒙特卡洛权益估计与启发式策略，可选 DeepSeek 辅助，并非 GTO 求解器。未实现跨设备账户、长期竞技排行榜、真实货币、短牌、奥马哈、Straddle、现场赛事全部裁判例外或地区房规。

人机模式的无状态凭证允许回放旧有效凭证，仅用于练习。联机独立使用服务端共享状态、座位身份、版本与重复请求校验，不接受客户端上传任意牌局状态。联机积分随房间保存，但不是永久竞技排行榜。Vercel 联机必须配置共享 Redis。

## 目录

```text
public/          前端页面、样式与交互
lib/poker.mjs    服务端牌局引擎
api/game.js      Vercel API 与加密凭证
api/room.js      联机房间 API
lib/rooms.mjs    房间、座位身份、动作同步与超时
server.mjs       本地开发服务器
tests/          引擎与接口测试
scripts/        部署前语法与资源检查
vercel.json     Vercel 部署与安全响应头
```
