# 从需求到原型交付

```bash
builderharness init --prototype --dry-run
builderharness init --prototype
```

可选 `init --scaffold` 提供仓库模板。最小安装保留项目现有 Agent 与规则。
原型配置读取项目根目录的 `builderharness.config.json`，例如
`{"adapter":"react-vite","routeMode":"hash","baseUrl":"http://localhost:5173"}`。
可按项目设置 `webDir`、`docsDir`、`sourceDir`。Vue 2 继续用 `vue2-vite`。
`adapter` 也可指向宿主实现的相对路径。环境变量覆盖配置。Vite 浏览器工具通过现有
`builderHarness()` 入口挂载，发布构建继续使用仅在开发态的动态导入。

## 决策和验收

需求 README 使用 `## 待决清单` 或 `## Pending decisions`，表头用
`ID | 问题 | 阻断 | 结论`，也支持 `Question | Blocking | Conclusion`。
阻断列填写 `是` 或 `yes`。从评审工具栏提交。Agent 通过 `review open` 查收，
在结论里写实际决定、确认人和提交 ID（可用 Markdown 注释保留 ID）。行为变化回写 FRS 的
规则和 AC。再在 `FRS.decisionRefs` 记录关联，例如
`{"D1":{"submission":"<提交 ID>","acceptance":["AC1"]}}`。无行为影响时用空数组。
最后执行 `builderharness review resolve-decision <KEY> <提交 ID>`。打回时先修订问题再关掉该次提交。
当前问题版本在提交后变化时，由人对新问题重新确认。

FRS 的验收场景可直接声明：

```json
{
  "verification": [
    {
      "id": "save",
      "ac": ["AC1"],
      "required": true,
      "route": "/drafts",
      "steps": [
        { "click": "text=Save" },
        { "expect": "text=Saved" },
        { "reload": true },
        { "expect": "text=Draft name" }
      ]
    },
    {
      "id": "unit",
      "ac": ["AC1"],
      "command": ["npm", "run", "test"],
      "inputs": ["src/model.js", "test/model.test.js"]
    },
    { "id": "visual", "ac": ["AC2"], "manual": "Check the keyboard focus after closing." }
  ]
}
```

浏览器场景支持 `click`、`fill: { selector, text }`、`press`、`reload`、
`expect` 和 `absent`。每条场景使用新浏览器配置，测试失败时保留可用的截图。
命令场景在宿主应用目录执行，`inputs` 填影响结果的项目相对文件。旧的字符串验证说明仍可保留。
`builderharness verify KEY` 执行场景，`--status --json` 回看证据。人工检查用
`--record ID --result passed|failed|skipped --evidence "实际结果和证据位置"`。
FRS 或输入改动会使通过结果变成待重验。记录保存在被忽略的 `.builderharness/verification/`。

## 发布

PRD 使用现有 `builderharness prd KEY` 生成计划。复制核对后的 ID 到
`builderharness prd KEY --yes --plan ID`。项目可设置 `requirePrdPlan: true`
来要求绑定后的确认。旧项目的 `--yes` 继续兼容。原型托管见 [部署说明](DEPLOY.md)。

## 功能宣贯

知识库操作视频使用 `record-kb-clips`。需要 MP4 和短循环 GIF 的功能宣贯使用
`builderHarness({ promo: true })` 与 `docs/promo/KEY/scenes.js`。
使用合成数据。宿主在 `promo=1` 时禁用真实数据源与远端写入。
浏览器舞台依赖 Chrome，视频编码依赖 FFmpeg，GIF 依赖 gifski。

```bash
builderharness promo render docs/promo/KEY --only stills --stills 0,2
builderharness promo render docs/promo/KEY
builderharness promo status --json
```

可用 `--scene ID` 重跑一个场景。每段单独记录配方、关联 FRS、素材、源码和编码参数。
当所有场景的输入与记录一致时才拼接总片。生成物保存在 `out/`。
自定义舞台可提供 `index.html` 并通过 `/__promo/kit/kit.js` 接入时间轴。
浏览器舞台与虚拟时钟只在开发服务器上启用。

## 走通样例

在 BuilderHarness 源码根目录安装依赖，运行 `npm run demo`。另开终端进入
`examples/react-tailwind`，运行 `node ../../bin/builderharness.mjs verify EXPERIMENTS`，
再渲染 `docs/promo/EXPERIMENTS`。在原型顶部的「待决清单」查看样例问题。
生产构建在源码根运行 `npm run build:demo`，然后用
`node bin/builderharness.mjs preflight --dir examples/react-tailwind/dist` 检查。
