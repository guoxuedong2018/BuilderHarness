# 产品价值片 starter

一个 30 秒、无真人、无口播的起手式。它不在同一页面上来回推拉，而是每 4–6 秒换一次构图，并切 2–3 个真实路由：

```text
暗场标题 → 浅色产品窗口 → Review queue 细节
→ Content health 证据 → Experiments 全景 → 品牌结尾
```

## 使用

把整个目录复制到宿主项目的 `docs/promo/<你的 KEY>/`：

```bash
builderharness promo init <你的KEY> --template product-film
```

然后修改：

1. `brand.json`：产品名、价值句、Logo、主色、字体；
2. `film.js` 的 `CONFIG.selectors` 和每个场景的 `route` / `waitFor`；
3. `film.js` 的 `SCENES` 文案和窗口位置；
4. `index.html` 的字体、颜色和结尾卡结构；
5. `sound.config.json` 的音效时间点。

首次使用下载开源字体：

```bash
bash assets/fonts/fetch-fonts.sh
```

渲染画面：

```bash
builderharness promo render docs/promo/<你的 KEY> \
  --base http://localhost:5173
```

加无旁白声音：

```bash
node sound-design.mjs \
  --video out/value-film.mp4 \
  --config sound.config.json \
  --out out/value-film-scored.mp4
```

## 30 秒节拍

| 时间 | 节拍 | 构图 | 路由 |
|---|---|---|---|
| 0–3.5s | Hook | 暗场大字 + 右侧完整产品缩略窗口 | `/overview` |
| 3.5–9.5s | Value | 浅色背景 + 左侧价值句 + 右侧产品窗口 | `/overview` |
| 9.5–15.5s | Proof | 暗场 Review queue 细节 + source 标签 | `/reviews` |
| 15.5–21.5s | Detail | 浅色 Content health + up-to-date 标签 | `/overview` |
| 21.5–26.5s | Brand | Experiments 全景 + 品牌句 | `/experiments` |
| 26.5–30s | Close | 深色结尾卡 + Logo + CTA | 无 |

## 45 秒 cut

需要多一个“机制段”时，见 [examples/45s.md](examples/45s.md)：Hook → Value → Proof → Detail → Mechanism → Brand → Close。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 舞台、窗口卡片、文字、结尾卡 |
| `film.js` | 多路由时间轴、构图、标签、动效 |
| `brand.json` | 品牌名、价值句、Logo、颜色、字体 |
| `assets/logo.svg` | 品牌图形 |
| `assets/fonts/` | Inter + Noto Sans SC（OFL） |
| `sound-design.mjs` | FFmpeg 合成无旁白音轨 |
| `sound.config.json` | 音效时间点 |

## 注意

- 模板默认无声；`sound-design.mjs` 生成低频氛围 + 点击/转场音效，不含第三方采样。
- 后续接 TTS 时，保留画面时长，按 `// VO:` 时间点生成旁白，不改 beat。
- 动效都是 `t` 的纯函数，不要改成 CSS transition。
- 一屏只保留一个主动作；不要把所有元素同时动。
- 产品界面必须来自真实运行中的页面，不要手绘仿真。
- 路由和选择器是示例，换产品必须改 `CONFIG.selectors` 和 `SCENES[].route`。
- 字体/图标/音乐许可证记录到 `out/credits.md`。
