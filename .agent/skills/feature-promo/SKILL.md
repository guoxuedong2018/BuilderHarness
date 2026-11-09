---
name: feature-promo
description: 为已能运行的原型生成功能宣贯视频、短循环 GIF 和海报，从 FRS 场景和源码定位取证，用同源舞台和时间轴逐帧重建。
---

# 功能宣贯

1. 从已验收的 FRS / AC 选一个值得展示的变化。列起点、用户动作、可观察结果和标注来源，使用合成夹具。
2. 在 `docs/promo/<KEY>/scenes.js` 写场景。尽量用元素选择器锚定动作和标注。已有截图状态用 `frs` 与场景的 `from` 复用。
3. 开启 Vite 的 `builderHarness({ promo: true })`，使用宿主配置的路由和状态适配器。在浏览器打开 `/__promo/<KEY>/`。
4. 先用 `builderharness promo render docs/promo/<KEY> --only stills --stills 0,2` 检查首帧、构图、可读性和结果，再渲染 MP4、GIF、海报、评审拼图和总片。短循环出 GIF，完整讲解用 MP4。
5. 检查 `builderharness promo status --json`。配方入库，`out/` 留本地。失效选择器、编码失败和超出 GIF 体积上限都应处理后再交付。

知识库操作示范继续走 `record-kb-clips`。功能宣贯的配方和已验收原型同源，避免把真实用户数据、私有链接或会触发正式写入的动作带进舞台。分享由用户确认。
