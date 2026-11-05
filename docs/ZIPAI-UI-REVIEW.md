# 桂林字牌 UI 检查

按 [Vercel Web Design Guidelines 技能](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) 与其引用的 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) 检查本次字牌改动。

已修复：

- `public/zipai.js:71` — 时钟按座位定位在头像外，测量集中读取后写入位置，不参与头像排版。
- `public/zipai.js:135` — 拖动理牌增加 Alt + 方向键替代操作，并保持键盘焦点。
- `public/zipai.js:161` — 结算保留三行摘要；长昵称截断并保留完整可访问名称，分数独立显示。
- `public/zipai.js:189` — 旧版过牌回放也静默处理，不展示身份提示。
- `public/zipai-presentation.js:14` — 统一胡牌来源、计分公式、三人分数，数字使用本地化格式。
- `public/zipai.css:100` — 时钟宽高一致，短暂震动，减少动态效果设置下关闭震动。
- `public/zipai.css:105` — 按钮、选择器和展开按钮有明确键盘焦点，增加悬停反馈。
- `public/zipai.css:108` — 滚动面板限制滚动串联，长记录使用可见性优化，适配安全区。
- `public/zipai.css:113` — 结算字体放大、增加深色衬底与文字对比度，三家牌型继续原桌展示。

验证覆盖手机竖屏、横屏及桌面共七种视口，包含完整手牌、三家结算、长昵称、21 个时钟位置，以及直接自摸胡牌按钮。无新增 UI 依赖。
