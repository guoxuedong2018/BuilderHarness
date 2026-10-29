# 需求 → FRS → 原型 → 评审放行 → 交付物 → 发布

> 这是一份可裁剪的工作流模板。它把「需求规格、原型、评审、交付物、发布」放在同一个仓库里，
> 让 Agent 和人看到同一份事实。产品名、目录名和发布目标都可以按宿主项目替换。
>
> 主链路是**规格 ↔ 同源原型 ↔ 评审**；内容与发布属于门禁之后的下游交付物，不需要时整段裁掉。

## 1. 一条主链路

```text
需求评审 → FRS 件套 → 高保真原型 → 页面批注 → 评审放行 → 交付物 → 发布
             │              │           │                      │
             └── docs/features/<KEY>/   └── docs/reviews/      └── docs/kb/
```

- **FRS** 是需求的机器可读事实源，`README.md` 是人读入口。
- **原型** 是已有界面的 Delta，不是从零重画；原型代码归业务，工具只挂载开发期 UI。
- **批注** 必须带源码坐标，能被 Agent 定位，源码改动后要能显式降级。
- **评审放行** 是门禁：规格与同源原型一致，才算这一步完成。
- **交付物** 是门禁之后的下游产物，以 Markdown 为唯一真源；截图、录屏由配方生成，事实引用上游 FRS / 源码。
- **发布** 是外发动作，必须有人确认；目标由宿主提供适配器。

## 已有 Agent 与需求判断

已有项目先运行 `builderharness init` 接入 Codex / Claude Code，沿用原有 harness。完整模板使用 `init --scaffold`；浏览器集成另行按需安装。

产品行为变更先运行 `builderharness context "<任务>" --json` 查找依据，再判断目标、当前约束、历史前提、替代方案与反例。结论可以是推进、方案冲突、建议替代或证据不足。旧决定的前提也需要核查；目标改变时允许重评。小改动不必进入全套 FRS，非 UI 任务不要求页面原型。

只保存重要且已确认的设计取舍；测试通过、失败、跳过、未运行、零测试分别报告。具体流程见需求评审技能。

## 2. 需求分级

| 级别 | 判据 | 产出 |
|---|---|---|
| S | 文案、样式、单页面小改 | 不建整套；把验收条件记到既有需求或改动说明 |
| M | 单个功能模块 / 单页面新增 | `FRS.json` + `README.md` + 原型页面，`FLOW.md` / `STATE.md` 按需 |
| L | 多模块联动、新核心概念、影响面广 | 全套 FRS 件套，先定边界，再画原型 |

分级只决定流程重量，不决定文档质量。M / L 在首次产品代码编辑前完成设计依据。

## 3. 需求件套

每个需求一个目录：

```text
docs/features/<MMDDHHMM>_<MODULE>_<NAME>/
├── FRS.json        必填 · 结构化规格
├── README.md       必填 · 背景、待决清单、验收标准、文件导航
├── FLOW.md         必填 · 用户旅程（Mermaid flowchart）
├── STATE.md        条件 · 复杂状态流转时才有
└── ACCEPTANCE.md   验收记录；先建空模板，验收时逐轮填写
```

从 `docs/templates/` 复制，不要手写一个空壳。命名用创建时刻的 `MMDDHHMM`
（如 `01231430`）加 `UPPER_SNAKE_CASE` 模块名，避免多人协作撞号。

### 状态

`README.md` 头部是人读状态，`FRS.json` 的 `status` 是机器镜像：

| README | FRS.json |
|---|---|
| 📝 草案 | `draft` |
| ✅ 已确认 | `confirmed` |
| 🚀 开发中 | `in_dev` |
| 🔍 验收中 | `accepting` |
| 📦 已归档 | `archived` |

改状态时两处同步。

## 4. 原型

原型遵循 **现有界面 + Delta**：

1. 先对齐宿主已有的页面骨架、设计 token 和组件语言。
2. 只精修本次 Delta；周边区域复用现状，未实现区域用占位。
3. 覆盖成功态之外的空态、加载、错误、权限受限和取消。
4. 用 React + Tailwind 时优先复用 `builderharness/ui`；其他框架通过适配层挂载同一套工具。

在 `vite.config.js` 中挂一次：

```js
import { builderHarness } from "builderharness/vite";

export default {
  plugins: [builderHarness({ root, frsRegistry: "src/config/frs-map.js" })],
};
```

生产构建不包含工具代码；只在 `import.meta.env.DEV` 下挂载宿主适配层。

## 5. 评审

原型跑起来后，按住 `⌘` / `Ctrl` 或点工具栏的评论按钮，选择元素写意见。
批注落到 `docs/reviews/<REGION>.json`，并携带 `file:line:column`。

Agent 处理批注时按坐标定位；坐标失效时按组件语义、几何位置降级，并在批注上标出置信度，
不要靠文本搜索猜测。

常用命令：

```bash
npx builderharness review open
npx builderharness review resolve <id> --note "已修复"
```

## 6. 内容

`docs/kb/` 的结构与写作约定见 [`kb/CONTRIBUTING.md`](./kb/CONTRIBUTING.md)。
先由 `outline.config.mjs` 定大纲，再生成页面骨架：

```bash
npx builderharness kb-scaffold
npx builderharness kb status
npx builderharness kb context <页|路由>
npx builderharness kb ack <页>
```

内容页引用事实时使用 `frs:` / `code:` 标记；截图和录屏写进
`shots.config.mjs` / `clips.config.mjs`，由 CDP 配方重建，不手工上传。

## 7. 发布

发布由宿主提供 destination adapter：

```bash
export BUILDERHARNESS_PUBLISH_GATEWAY=./tools/publish-gateway.mjs
npx builderharness kb-publish --dry-run --root <id> --doc-base <url>
```

没有配置目标时，评审、内容状态、截图和录屏仍然可用；发布按钮保持「未配置」。
外发前确认密级、分享范围和目标页面。

## 8. Agent 边界

- Agent 可以读源码、跑检查、写 Markdown、重建媒体、提出发布计划。
- **人确认**需求状态、内容锁、发布目标和外发范围。
- 任何命令都先在仓库内产出差异；不要用一次性脚本改运行时状态。
