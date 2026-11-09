---
name: ui-prototype
description: 在宿主原型工程内新增或迭代高保真页面。适用于用户说「做一个页面」「改这个界面」「补原型」时。原型 = 现有界面 + Delta；先对齐设计 token 和组件，再实现本次变化。
---

# UI 原型

## 技术栈

- 默认 React + Tailwind；组件优先用 `builderharness/ui`。
- Vue 2 宿主可用 `builderharness/vue2` 适配层。
- 工具 UI 只在 `import.meta.env.DEV` 挂载，生产构建不包含。

## 三原则

1. **原型 = 现有界面 + Delta。** 先看宿主已有骨架、导航、间距、色彩和组件；只精修本次变化。
2. **Delta 高保真，非 Delta 复用现状。** 周边区域复用现有组件；未实现区域用占位，不重复精修。
3. **生产工具气质。** 克制用色、充分留白；空态、加载、错误、权限受限、取消都要有，不只做成功态。

## 流程

1. 读现有页面、路由、`src/config/frs-map.js` 和设计 token。
2. 在 `docs/features/<KEY>/FRS.json` 确认本次范围和规则。
3. 实现页面；新路由同步登记导航、路由、FRS 区域。
4. 跑 `npx builderharness check-ui` 和 `npx builderharness check-routes`（参考宿主检查；
   宿主没有对应 token / 路由登记时，按 `docs/adapters.md` 适配或跳过）。
5. 在浏览器里走主路径和反例；需要时补 `shots.config.mjs` 配方。

## 边界

- 不重画整个产品；不把示例数据当真实业务规则。
- 不把工具 UI 带进生产 bundle。
- 不为了视觉还原牺牲可访问性：焦点、对比度、键盘操作要可用。

M/L 实现以 README 的有效决定和 FRS 的 AC 为输入。用宿主的合成状态分别走通主路径和一个
会推翻方案的反例，检查保存、刷新和下游状态。在 `builderharness verify <KEY>` 中保留可重跑的证据。
