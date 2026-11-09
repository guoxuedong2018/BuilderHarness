# 品牌资产：让片子像这个产品，而不是像模板

“高级感”不是加特效，而是**每个细节都来自同一个品牌系统**：字体、颜色、圆角、间距、Logo、图标、语气。

## 1. 最小品牌包

产品价值片只需要这些：

```text
brand.json
assets/
├── logo.svg
├── logo-mark.svg        # 可选，纯图形
└── fonts/
    ├── Inter-Variable.ttf
    ├── NotoSansSC-Variable.ttf
    └── OFL-*.txt
```

`brand.json` 示例：

```json
{
  "name": "BuilderHarness",
  "tagline": "让每一次产品迭代，都有据可依。",
  "meta": "需求 · 页面 · 源码 · 复核",
  "logo": "assets/logo.svg",
  "colors": {
    "ink": "#171717",
    "paper": "#f2efe8",
    "dark": "#101010",
    "accent": "#e86a33",
    "muted": "#6b6b6b"
  },
  "fonts": {
    "display": "Inter",
    "text": "Noto Sans SC"
  }
}
```

模板会把它写进 CSS 变量，标题、强调色、结尾卡都从这一份取值。

## 2. 从哪里取

| 资产 | 来源 | 注意 |
|---|---|---|
| Logo | 产品仓库的 SVG，不要截图 | 保留安全边距；不要拉伸、描边、加阴影 |
| 主色 | `tokens.css` / Tailwind config / 设计系统 | 只取 1 个强调色；不要从截图上吸色 |
| 字体 | 产品实际字体；没有就用 Inter + Noto Sans SC | 记录 OFL/商业授权 |
| 圆角 | 产品卡片/按钮圆角 | 窗口、卡片、标签统一一套 |
| 图标 | 产品图标库；没有就用 Lucide/Phosphor | 线宽、尺寸一致 |
| 语气 | 产品 UI 里的真实用词 | 不用“赋能/颠覆/革命” |

## 3. 字体系统

推荐组合：

- **Inter**：拉丁字母、数字、界面标签、代码；
- **Noto Sans SC**：中文标题和正文；
- 都是 SIL Open Font License，可商用。

排版规则：

- 1080p 下标题 54–72px，正文 20–24px，标签 12–14px；
- 标题 `letter-spacing: -0.03em ~ -0.05em`；
- 正文 `line-height: 1.5`；
- 数字 `font-variant-numeric: tabular-nums`；
- 中文不要用全部大写/超宽字距；
- 一屏最多两种字重（如 600 + 400）。

不要：

- 用系统默认宋体/黑体混排；
- 用三种以上字体；
- 把标题拉宽/压扁；
- 用描边、渐变字、阴影字。

## 4. 颜色系统

- 背景：off-white / charcoal，不要大面积纯白或纯黑；
- 文字：ink / muted 两级足够；
- 强调：只给“变化/结果/风险”，一屏一个；
- 红色只给问题，不给装饰；
- 对比度至少 4.5:1（正文）/ 3:1（大字）。

## 5. Logo 与图标

- Logo 用 SVG，不用 PNG 放大；
- 结尾卡 Logo 高度 48–64px；
- 图标用线性、统一线宽（1.5–2px）；
- 图标不抢标题；能不用就不用。

## 6. 开源资产

- **字体**：Inter、Noto Sans SC、Source Han Sans（OFL）；
- **图标**：Lucide（ISC）、Phosphor（MIT）；
- **设计系统**：Penpot（MPL-2.0）维护 tokens/组件；
- **Lottie**：AE 导出的矢量动效，适合 Logo/图标，不适合长视频；
- **Satori**：HTML/CSS → SVG，生成标题卡/OG 图。

许可证记录到 `out/credits.md`，不要只放在聊天里。

## 7. 自检

- [ ] Logo 是 SVG，没有拉伸/描边/阴影？
- [ ] 标题/正文/标签只有一套字阶？
- [ ] 强调色只有一个，且来自产品？
- [ ] 圆角、边框、阴影是否统一？
- [ ] 中文没有奇怪的断行/孤字？
- [ ] 数字对齐、单位统一？
- [ ] 字体/图标/音乐许可证已记录？
