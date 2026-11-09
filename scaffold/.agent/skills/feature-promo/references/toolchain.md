# 开源工具链：哪些该吸收，哪些不该

目标不是“把所有工具都装进来”，而是用成熟工具补我们缺的那一层。当前 `feature-promo` 的强项是**真实产品界面 + 确定性逐帧渲染**；外部工具主要补：复杂矢量动效、标题卡/海报、品牌设计资产、声音和录制。

## 选型结论

| 工具 | 许可证 | 最适合补什么 | 建议 |
|---|---|---|---|
| **Motion Canvas** | MIT | TypeScript 生成器写矢量动效、与旁白同步 | **推荐作为高级动效层** |
| **Revideo** | MIT | 代码生成视频、无头渲染、音视频合成、批量生产 | **推荐用于自动化/批量** |
| **Lottie-web** | Apache-2.0 | AE 导出的 JSON 矢量动效、Logo/图标动画 | **推荐作为品牌动效资产格式** |
| **Theatre.js** | core Apache-2.0；studio AGPL-3.0 | 可视化关键帧、复杂时间轴 | 可评估，注意 studio 只用于开发期 |
| **Satori** | MPL-2.0 | HTML/CSS → SVG，生成标题卡、海报、OG 图 | **推荐做静态卡片** |
| **Penpot** | MPL-2.0 | 品牌 Design Tokens、组件、设计系统 | **推荐做品牌资产源** |
| **OBS Studio** | GPL-2.0 | 桌面/窗口录制、直播 | 只在需要真实录屏时用；输出可商用 |
| **Screenity** | GPL-3.0 | Chrome 内 UI 录制、标注、聚光、打码 | 可做手动录屏；商业闭源集成先看许可 |
| **FFmpeg** | LGPL/GPL（取决于构建） | 编码、拼接、混音、响度、抽帧 | 已在用，继续作为底座 |
| **Remotion** | Remotion License（源码可见，非 OSI 开源） | React 组件化视频、数据驱动模板 | **团队 ≤3 人可免费商用；≥4 人需付费** |
| **Rive** | runtime 开源；编辑器商业 | 交互式 2D 角色/图标动效 | 适合交互 Demo，不是长视频主力 |

## 推荐组合

### A. 当前主力：确定性 UI 片

```text
feature-promo
+ 真实产品页面
+ scenes.js / 自定义 film.js
+ ffmpeg
+ Inter / Noto Sans SC
```

适合：30–60 秒产品价值片、功能宣贯、官网首屏、群聊动图。
优点：可复现、改页面即可重渲、无需引入新框架。

### B. 高级动效：Motion Canvas 或 Revideo

当出现以下需求时再引入：

- 复杂矢量图形/数据可视化动画；
- 需要与旁白逐句同步；
- 批量生成几十支视频；
- 需要 3D/粒子/复杂合成（Motion Canvas 2D 更稳，3D 另接 Three.js）。

选择：

- **偏“手写时间线、矢量动效”** → Motion Canvas。
- **偏“无头渲染、批量、音视频合成”** → Revideo。
- 两者都是 MIT，适合作为独立动效工程，输出透明/绿幕素材或成片，再交给 `feature-promo`/ffmpeg 合成。

### C. 品牌资产：Penpot + Lottie/Satori

```text
Penpot 维护 Design Tokens / 组件
→ 导出 SVG / Lottie JSON
→ feature-promo 读取 brand.json
→ Satori 生成标题卡/海报
```

- 品牌色、字体、圆角、间距只维护一份；
- Logo/图标优先 SVG；
- 需要 AE 级动效时用 Lottie JSON，不把视频当 Logo；
- 标题卡、OG 图用 Satori 生成，保证排版一致。

### D. 声音：FFmpeg + CC0 素材

当前 `sound-design.mjs` 用 FFmpeg 合成低频氛围和点击/转场音效，不含第三方采样。需要更完整的音乐时：

- **FreePD**：CC0，可商用、无需署名；
- **Freesound**：逐条看 CC0 / CC BY，CC BY 需要署名；
- **Openverse**：聚合 CC 搜索，下载前核对许可证；
- **Free Music Archive**：逐条看许可证，不要默认全部可商用。

规则：

- 音乐不承载信息；静音看也懂；
- 旁白频段（1–4kHz）留给口播，音乐做低切/侧链；
- 输出无音轨母版 + 配音版两份；
- 记录素材来源和许可证，放进 `out/credits.md`。

## 不建议现在引入的

- **Remotion 作为默认底座**：它不是 OSI 开源；团队 ≥4 人需要付费。若团队 ≤3 人或已有预算，可以作为 React 动效层，但不要让整个制作流程依赖它。
- **Theatre.js Studio 进生产**：studio 是 AGPL-3.0；只在开发期用，最终包只带 core。
- **Rive 做长视频**：它擅长交互式 2D，不是 6 分钟 keynote 的剪辑器。
- **OBS/Screenity 替代确定性渲染**：手动录屏会有掉帧、光标抖动、数据污染；只有在必须拍真实桌面/第三方页面时用。

## 许可证提醒

- “源码可见”不等于 OSI 开源；Remotion 是典型例子。
- GPL（OBS/Screenity）不约束**输出视频**，但修改并分发软件本身有开源义务。
- CC0 最省事；CC BY 必须署名；CC BY-NC 不能商用。
- 字体用 OFL（Inter、Noto Sans SC），不要把字体文件本身当商品售卖。
- 商用前把工具、字体、音乐、图标的许可证记录到项目 `credits.md`。

## 参考资料

- Motion Canvas: https://github.com/motion-canvas/motion-canvas
- Revideo: https://github.com/redotvideo/revideo
- Lottie-web: https://github.com/airbnb/lottie-web
- Theatre.js: https://github.com/theatre-js/theatre
- Satori: https://github.com/vercel/satori
- Penpot: https://github.com/penpot/penpot
- OBS: https://github.com/obsproject/obs-studio
- Screenity: https://github.com/alyssaxuu/screenity
- Remotion license: https://www.remotion.dev/docs/license/pricing
- FreePD: https://freepd.com/
- Freesound: https://freesound.org/
- Openverse: https://openverse.org/
