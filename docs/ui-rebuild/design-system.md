# 视觉系统

源：`public/zipai-tokens.css`，仅作用于字牌牌桌、字牌建房与公开牌对话框，不覆盖德州。

| Token | 值 / 用途 |
|---|---|
| felt / depth / panel | `#194b3d` / `#10392f` / `#215447`；牌毡、信息底、选择项 |
| paper / ink | `#fffbed` / `#183629`；传统纸牌与红黑字面 |
| text / muted | `#f2f3de` / `#c1d2c5`；主要与次要文字 |
| gold / red | `#e4c783` / `#be3438`；行动、推荐、得分与红字、超时 |
| UI / 牌面字体 | 系统中文无衬线 / 楷体、宋体回退，不下载字体 |
| 大小层级 | 操作 22px（紧凑 20px）；结算标题 19px（竖屏 17px）；正文 14px；次要 11–12px |
| 名牌 | 同一网格、同一尺寸、圆头像；按模式 128×64 / 88×50 / 96×48 |
| 按钮 | 主操作最小 44px 高；金色确认、米白次要、红色胡牌；禁用、焦点、hover 分离 |
| 牌张 | 宽高 1:2.85，上下倒字；字面宽度 79%，顶圆角 24% 牌宽；公开组圆角 14% |
| 层级 | 牌桌 → 手牌 10 → 时钟 20 → 记录 25 → 动作 30 → 头部 40 → 结算 50 → 动效 60 → 选择器 80 → 拖牌 1000 |

尺寸等级由布局模块生成：紧凑手牌 24px、竖屏 30/36px、桌面 38–54px；公开牌 20/22/28px，结算 22/24px，醒牌 30px。拥挤时启用局部滚动，不继续降低公开牌宽。大额积分在名牌中使用中文紧凑显示，title 和完整结算保留准确数字。

克制使用金色和阴影；没有新增图片、装饰背景或运行时依赖。减少动态效果设置取消移动插值，保留读牌文字和醒数。按钮、选择器、表单具备可见焦点；通过不同字牌类名隔离旧全局 `positive!important`，没有追加新的 important 覆盖。

按 [Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) 和 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) 检查。使用语义按钮、原生 dialog、可滚动区域、明确标签、表单错误聚焦和动态提示；触控拖动保留点击、按钮及键盘替代路径。
