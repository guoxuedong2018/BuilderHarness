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

## 分组决定与引用

决策工作台支持本地原型已有的分组式 README，也支持简单表格。分组用 `### A · 产品`、
`### B · 研发`、`### C · 业务`、`### D · 评审会`。可使用建议、备选、依据和影响列。
阻断状态既接受 `Blocking` 列，也接受编号后的 ⛔。保留意见可标「待确认」。
点「事实 1」、其他条目或需求链接可在侧边查看原文。提交可撤回，问题或建议变化会要求复核。
MCP 的 `builderharness_decisions`、`builderharness_verification` 读取同一份状态。

## 更多媒体配方

```bash
builderharness promo doctor
builderharness promo init DRAFT_FILM --template product-film
builderharness promo render docs/promo/DRAFT_FILM
builderharness promo sound docs/promo/DRAFT_FILM
```

价值片脚手架包含多构图时间轴、可替换品牌、字幕/配文提示、音效配方和授权记录。
开源字体可通过模板中的 `assets/fonts/fetch-fonts.sh` 获取，默认使用本机回退字体。
功能讲解用 `--template scene`。GIF 优先用 gifski，未安装时使用 FFmpeg 调色板编码，
也可指定 `--gif-encoder ffmpeg`。

在素材目录写 `promo.config.mjs`，用 `textures` 声明一个或多个截图：

```js
export default {
  textures: {
    overview: {
      route: "/overview",
      waitFor: "h1",
      marks: { heading: "h1" }
    }
  }
};
```

`builderharness promo capture docs/promo/DRAFT_FILM` 生成截图和元素坐标
`textures/layout.json`。用 `loadLayout()` 把坐标引用到自定义舞台。
显式 HTTP(S) 页面来自不同源时，需要 `--allow-external`，Chrome 使用独立配置。
生成的纹理与配方、品牌素材、FRS、源码一起参与过期判断。

## 模拟服务与素材

`builderharness fixtures generate` 生成可播放的合成视频、图片和音频。
`builderharness fixtures import-media <目录>` 为本机素材转码、抽封面、写清单。
默认产物在忽略的 `.builderharness/fixtures/`。导入的素材即使移除元数据仍可能含私有画面，
需要按宿主的数据规则使用。默认用通用 ID，`--keep-names` 显式保留原文件名。

`builderharness simulate fixtures/job-simulation.mjs` 运行示例 HTTP 场景矩阵。
每种 `variant` 与每条 `case` 单独启动回环服务，记录断言和请求轨迹。
故障支持 `before`（没发出）和 `after`（服务收到、响应丢失），适合验证重试和幂等。
配方的 `start({ variant, caseId })` 返回 `{ url, close }`，用例的
`run({ request, variant, assert })` 走真实 HTTP。轨迹留在本机且仅使用合成载荷。

`verify KEY --serve` 可按项目配置的 `verificationService.command` 启动并清理本地原型，
`verificationService.url` 用于回环探活。验收动作另支持 `state` 和项目内的 `upload`
夹具。上传输入会自动参与过期判断。

## 可复用组件

`FRS.components` 可提供一个设计规范路由和若干组件说明。每项支持 `name`、站内
`route`、`shots` 和结构化 `notes`。PRD 可以追加新组件说明表，之后逐格增量更新。
表格行列变化时会暂停增量写入以复核人工编辑。已发布原型地址可由
`BUILDERHARNESS_PROTOTYPE_URL` 提供。

原型可从 `builderharness/ui-data` 复用跨页勾选、分面条件和计数、未写完 JSON 的
光标定位。逻辑层独立于 React 或 Vue，Vue 2 / iView 可使用 `vue2CrossPageSelection`。
