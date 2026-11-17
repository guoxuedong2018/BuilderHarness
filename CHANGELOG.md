# 更新日志 / Changelog

## 0.9.0 — 源码变更，尚未发布 / source changes, not published

- 批注写入按文件串行处理。保存失败时保留输入，共享源码坐标的元素无法区分时显示定位提示，批注写接口拒绝异源请求。\
  Review writes are serialized per file. Failed saves retain the draft, ambiguous source anchors show a hint, and review endpoints reject cross-origin writes.

- React 示例统一从自身脚本启动和构建。`npm run check:demo` 自行启停 Vite，运行浏览器验收并预检构建产物。独立项目使用随包提供的 starter，包测试覆盖其开发态转换和生产构建。\
  The React demo uses its own scripts for startup and builds. `npm run check:demo` manages Vite, runs browser acceptance and scans the build. The packaged starter is the entry point for standalone projects, with package tests for its dev transforms and production build.

- 补齐功能宣贯手册，加入产品介绍片模板、声音合成、纹理截图，以及通过 FFmpeg 生成 GIF 的备用方案。\
  Full feature-promo playbook with product-film templates, sound synthesis, texture capture and FFmpeg GIF fallback.
- 待决问题支持分组、预览依据原文、选择方案和撤回。Cursor 接入会安装原生规则和产品设计评审参考资料。\
  Grouped decisions with source previews, option selection and withdrawal. Cursor installs native rules and product-design review references.
- PRD 支持按组件编写说明。截图流程共用路由配置，验收可按需启动本地服务，并支持合成媒体和 HTTP 故障模拟。\
  Component-level PRD sections, shared capture routing, opt-in local service startup, synthetic media and HTTP fault simulation.
- 加入宿主构建产物检查策略、框架无关的表格与编辑器辅助工具，以及只读的决策和验收 MCP 工具。\
  Host artifact policy, framework-neutral table/editor helpers and read-only decision and verification MCP tools.

- `init --prototype` 注册原生需求工作流技能及配套参考资料。评审工具栏收集决策，关闭前检查结果是否已回写 README 和 FRS。\
  `init --prototype` registers native feature workflow skills with references. The review toolbar collects decisions and checks README/FRS writeback before closure.
- `verify <KEY>` 执行并记录关联验收标准（AC）的场景。`preflight` 纳入 CLI。原型部署计划绑定构建产物与目标，PRD 计划也可将审批绑定到当前内容和版本。\
  `verify <KEY>` runs and records AC-linked scenarios. `preflight` ships in the CLI, prototype deployment binds a plan to an artifact and target, and PRD plans can bind approval to the current content and revision.
- `promo` 按场景时间轴将运行中的原型渲染为 MP4、GIF、海报和缩略图总览，并按场景追踪输入。React 示例提供可运行的草稿创建流程。\
  `promo` renders the live prototype from scene timelines into MP4, GIF, poster and contact sheets, with per-scene input tracking. The React demo includes a runnable draft-creation workflow.

- 默认执行 `init` 会接入现有 Codex 或 Claude Code 项目的指令与评审技能。完整模板通过 `init --scaffold` 安装。\
  Default init connects existing Codex / Claude Code project instructions and review skills; complete templates use init --scaffold.
- 按预算收集任务证据，包括历史决策、适用范围内的指令、源码引用，以及明确列出的遗漏。旧版 MCP 知识库请求保持兼容。\
  Bounded task evidence includes decisions, scoped instructions, source references and explicit omissions; legacy MCP KB requests remain compatible.
- 先审查目标、约束、历史前提和备选方案，再确定流程分级。记录有意义的已确认决策和实际验证边界。\
  Review goals, constraints, historical premises and alternatives before process sizing; record meaningful confirmed decisions and actual verification limits.
- 基础 CLI 无运行时依赖。可选的 `@builderharness/browser` 提供浏览器依赖，现有导入路径继续可用。\
  Base CLI runtime dependencies are empty. Optional @builderharness/browser supplies browser dependencies while existing import paths remain.
- 加入用户改动保护、恢复、包安装和需显式认证的真实宿主验收检查。实际结果见 `docs/migration-0.9.md` 和对应需求的验收记录。\
  Added preservation, recovery, package-install and explicit authenticated host acceptance checks. See docs/migration-0.9.md and the feature acceptance record for actual results.
- **PRD 改动回流。** `prd` 将已发布 PRD 中的每处人工修改写入 `docs/prd/<KEY>/cloud-edits.md`，记录位置、层级、改动前后内容及 FRS 是否已收录。人工修改的段落会保留，人工删除的段落在用户用 `--absorb` 确认前也保持删除。发布底稿通过 `nextBase` 排除人工改动，让保护跨次发布生效。整篇重写时也保留人工删除结果。\
  **PRD round-trip** — `prd` now writes `docs/prd/<KEY>/cloud-edits.md` listing every human edit in the published PRD (where, level, before/after, whether FRS has it); human-edited paragraphs stay untouched and human-deleted ones are not added back until the user confirms with `--absorb`. The saved baseline keeps human edits out (`nextBase`), so the protection lasts across publishes instead of one run, and a rewrite can no longer re-add text a human removed.
- **PRD 修订稿。** `prd --yes --redline` 发布供评审的草稿。待删除的规则和改写前的旧规则原位保留，标为红色删除线。改写后的规则按相似度配对，放在旧规则下方并加浅绿底。重复运行会复用已有修订，下一次常规发布会删除带删除线的段落并清除绿底。删除线文字（`~~…~~`）参与段落比对，去掉删除线表示保留该段。\
  **Redline drafts** — `prd --yes --redline` publishes a review draft: removed and pre-change rules stay in place struck through in red, rewrites are paired by similarity right below them on a light-green background; rerunning adds nothing twice, and the next normal publish deletes struck paragraphs and clears the background. Strikethrough counts as paragraph text (`~~…~~`), so removing a strike reads as "keep".
- PRD 表格结构一致时，补丁逐格对齐。相邻删除会合并，每批最多提交 50 个操作，并先试跑。上传中断留下的临时图片段落会在下次发布时清理。`prd --folder <id>` 将 `folderId` 传给目标端的 `createBlankDoc`。\
  PRD patches align cell by cell when the table shape matches, merge adjacent deletes and submit in batches of at most 50 operations (each dry-run first); temp image paragraphs left by an interrupted upload are found and removed on the next publish. `prd --folder <id>` passes `folderId` to the destination's `createBlankDoc`.
- **PRD 渲染。** 现有页面新增的功能块可标记为 `online-page-new`。图例按列表呈现，分组名用五级标题进入大纲。规则支持 `{ code, lang }` 代码块和人工插入的 `{ image, width, height }` 图片。用 `“…”` 标记的界面文案显示为灰色斜体，背景条目支持 `children`。\
  PRD rendering: spec points can be tagged `online-page-new` (new block on an existing page); legends render as lists; group names become level-5 headings for the outline; rules accept `{ code, lang }` code blocks and `{ image, width, height }` images inserted by people; `“…”` renders interface copy in grey italics; background items accept `children`.
- **未导入检查。** `check-prototype-syntax` 支持 `.jsx`，会报告使用时既未声明也未导入的标识符（含 JSX 组件），并给出导出它们的文件。解析器从宿主的直接依赖、Vue SFC 编译器或 React 插件的依赖链解析。找不到时输出「⚠ 降级」并列出未检查项。基础 CLI 仍无运行时依赖。\
  **Missing-import check** — `check-prototype-syntax` also reports identifiers (including JSX components) used without a declaration or import, with the file that exports them. It now checks `.jsx`. The parser is borrowed from the host's dependency chain (direct, Vue SFC compiler or the React plugin); without one it says "⚠ 降级" and lists what was not checked instead of passing silently. Base CLI runtime dependencies stay empty.
- **技能。** `prd-author` 和 `prd-publish` 补充规格写法，包括各类规则的范围、省略原型已表达的内容、一条一句、对象加条件加结果、只记录已确认规则、发布前四问，以及修订稿流程。`requirement-review` 增加 M/L 需求的设计依据，配套 `references/design-brief.md` 和 `references/examples.md`。`.agent` 与 `scaffold` 的副本保持一致。\
  Skills: `prd-author` / `prd-publish` gain the spec-writing discipline (what each rule type covers, leave out what the prototype already shows, one rule per sentence, object + condition + result, no unconfirmed rules, four-question pre-publish check, redline workflow); `requirement-review` gains an M/L design-basis section with `references/design-brief.md` and `references/examples.md`. `.agent` and `scaffold` copies are identical.
- 根目录和脚手架的 `AGENTS.md` 加入八条设计原则、协作规则和收到纠正后的对齐方法。`scripts/fixtures/product-design-cases.json` 收录 14 个设计评审回归场景，当时尚未用真实模型运行。\
  `AGENTS.md` (root and scaffold) adds eight design principles, collaboration rules and how to realign after a correction. `scripts/fixtures/product-design-cases.json` holds 14 design-review regression scenarios (not yet run against a model).
- 当源码坐标指向共享组件时，`review open` 会标出批注所在页面和元素。CDP 的按键事件携带键码，读取 `keyCode` 的编辑器也能响应。\
  `review open` names the page and element when a source coordinate lands in a shared component; CDP key presses carry key codes so editors that read `keyCode` receive them.
- 桌面壳锁文件中的包统一从公共 npm registry 解析，版本和完整性哈希保持一致。由于 npm 在子项目中不会读取根目录的 `.npmrc`，桌面壳单独固定了 registry。`check-public-deps` 现在检查所有已提交的锁文件及同目录的 `.npmrc`。\
  The desktop shell's lockfile resolves every package from the public npm registry (same versions and integrity hashes) and pins its own `.npmrc`, since npm does not read the root one from a nested project. `check-public-deps` now covers every committed lockfile and the `.npmrc` beside it.
- 加入 `builderharness eval validate / run / compare / list`，用宿主项目自己的任务重复评测 Agent。支持注入缺陷、隐藏测试、隔离工作区、stream-json 轨迹、过程信号和每轮运行的预算。详见 `docs/evals.md`。\
  Added `builderharness eval validate / run / compare / list`: repeatable agent evals on a host project's own tasks, with injected defects, hidden tests, isolated workspaces, stream-json traces, process signals and per-run budgets. See docs/evals.md.

## 0.8.0 — 2026-10-23

- **BuilderHarness 品牌与定位。** 中英文 README、品牌指南和核心文档以产品构建者的 Agent Harness 为主线，强调以规格约束工作、以原型为事实依据、交付前评审。原来的「原型原生内容生产与发布」定位退役。手册、上线说明和媒体归入下游交付物。\
  **Brand and positioning: BuilderHarness** — the README (EN/ZH), brand guide
  and core docs now lead with the product category: an agent harness for
  Product Builders, **spec-gated · prototype-as-truth · review before ship**.
  The old “prototype-native content production and publishing layer” framing is
  retired; manuals, launch notes and media are documented as downstream
  deliverables.
- **产品入口。** npm 包与 CLI 为 `builderharness`，导入路径为 `builderharness/*`，环境变量用 `BUILDERHARNESS_*`，配置文件用 `builderharness.config.*`，项目设置存于 `.builderharness/`，MCP 工具用 `builderharness_*`，集成包用 `@builderharness/*`。\
  **Product surface** — npm package `builderharness`, imports
  `builderharness/*`, CLI `builderharness`, environment variables
  `BUILDERHARNESS_*`, config files `builderharness.config.*`, project settings
  `.builderharness/`, MCP tools `builderharness_*`, and integration packages
  `@builderharness/*`.
- **集成边界。** 鉴权、可观测性和部署作为集成点。打包和生产就绪仍需宿主分别验证。\
  **Boundaries are explicit** — auth, observability and deploy are documented as
  integration points: *connecting ≠ bundling ≠ production-ready by default*.

## 0.7.6 — 2026-10-20

- **一个画布、一条侧栏、一条工具栏。** 移除 Bee Press 品牌页头和常驻检查面板。原型画布填满面板，46px 的图标侧栏放置六个阶段和评论、帮助、聊天入口。38px 的画布工具栏收纳地址、FRS、评论模式、抽屉、Studio、预览宽度、刷新和在浏览器中打开。\
  **One canvas, one rail, one toolbar** — removed the Bee Press brand header
  and the always-on inspector. The prototype canvas now fills the panel, a
  46px icon rail carries the six stages plus comments/help/chat, and a single
  38px canvas bar holds the address, FRS, comment mode, drawer, studio, preview
  width, refresh and open-in-browser.
- **按需显示操作。** 「下一步」以浮动提示呈现，包含下一步操作和未解决批注的面板按需滑入，画布宽度保持原样。帮助、引导和错误都通过浮层呈现。\
  **Complexity on demand** — “next step” is a floating hint; the panel with next
  action and open comments slides in only when asked and leaves the canvas width
  untouched. Help, guide and errors are overlays instead of extra columns.
- **单卡片引导。** 首次运行只显示一张步骤卡片，含步骤切换、一个主要操作和跳过入口，取代三张堆叠卡片。\
  **One-card onboarding** — the first-run guide shows a single step card with a
  step switcher, one primary action and a skip, replacing three stacked cards.
- **统一界面。** 侧栏、工具栏和面板使用同一套灰色外框，网页画布保留白底，突出原型本身。\
  **Unified surfaces** — rail, toolbar and panels share one grey chrome; only
  the web canvas is white, so the prototype reads as the product.
- 嵌入桥接层报告批注数量变化时，操作台自动更新角标和批注列表。\
  The cockpit refreshes its badge and comment list when the embedded bridge
  reports a changed comment count, instead of waiting for a manual refresh.
- **桌面端。** DSH 优先使用固定本地端口，让 `localStorage` 中的阶段、跳过引导状态和上次工作区在重启后仍可恢复。端口被占用时才换用临时端口。\
  Desktop: DSH now prefers a stable local port so localStorage (stage, skipped
  guide, last workspace) survives app restarts, falling back to an ephemeral
  port only when it is taken.

## 0.7.5 — 2026-10-20

- **Bee Press 在自身仓库中使用自己的工具。** 本仓库执行 `beepress init` 后纳入 `AGENTS.md`、`CLAUDE.md`、`.agent/skills`、`docs/kb`、`docs/WORKFLOW.md` 和 `src/config/frs-map.js` 中的路由与 FRS 登记。自身产品需求（`ONBOARDING`、`COCKPIT`、`REVIEW`）用随包提供的 FRS 模板编写，并由 `npm run check` 校验。\
  **Bee Press now hosts itself** — `beepress init` ran in this repository:
  `AGENTS.md`, `CLAUDE.md`, `.agent/skills`, `docs/kb`, `docs/WORKFLOW.md`, and
  the route/FRS registry in `src/config/frs-map.js`. The kit's own product work
  is specified with the same FRS template it ships (`ONBOARDING`, `COCKPIT`,
  `REVIEW`) and `npm run check` now validates those specs.
- **首次运行引导。** 原型暂时跑不起来时，操作台按确认技术栈、写第一份 FRS、启动原型三步引导。每步有一个主要操作，并展示技术栈判断依据、就地错误和按工作区记忆的跳过选项。\
  **First-run guide instead of a dead end** — when the prototype cannot run,
  the cockpit offers three plain-language steps (confirm stack → write the first
  FRS → start the prototype) with one primary action each, evidence for the
  detected stack, inline errors, and a skip that is remembered per workspace.
- **技术栈识别。** `detectStack()` 读取实际应用目录，报告框架、Tailwind、TypeScript、打包工具及判断依据。基线阶段可一键采用结果。\
  **Stack detection** — `detectStack()` reads the real app directory and reports
  framework, Tailwind, TypeScript, bundler and evidence; the baseline stage can
  adopt it in one click.
- **原型启动反馈。** 启动和加载时显示骨架屏及阶段提示，超过 12 秒会提示响应慢。失败时提供可折叠日志，以及重试、安装和切换工作区入口。\
  **Prototype feedback** — startup and load now use skeletons with stage text, a
  12-second slow-response banner, and a failure state with collapsible log,
  retry, install and switch-workspace exits.
- **同主机预览代理。** 开发服务输出 `localhost`，操作台由 `127.0.0.1` 提供，浏览器会拒绝嵌入使用不同回环别名的页面。原型现在通过页面所在主机代理 HTTP 和 HMR WebSocket，也解决了 Vite 仅监听 `::1` 时的嵌入问题。\
  **Same-host preview proxy** — dev servers printed `localhost` while the
  cockpit is served from `127.0.0.1`; browsers refuse to frame a different
  loopback alias. Prototypes are now proxied on the page's host (HTTP + HMR
  WebSocket), which also fixes embedding when Vite binds only `::1`.
- **简化布局。** 顶栏去掉重复的「操作台」入口，检查面板只留「下一步」和未解决批注，阶段行直接显示阶段和结果。加入就地帮助面板，提供术语、快捷键和重开引导，显示可见焦点，并用 `⌘/Ctrl + Enter` 启动或重启。\
  **Quieter layout** — the cockpit top bar drops the redundant “操作台” action,
  the inspector keeps only “下一步” and open comments, and stage rows read as
  “stage · result”. Adds an in-place help panel (glossary, shortcuts, reopen the
  guide), visible focus rings and `⌘/Ctrl + Enter` to start or restart.

## 0.7.4 — 2026-10-20

- **从实际应用目录启动原型。** 操作台会扫描 `web/`、`app/`、`apps/*`、`packages/*` 等候选目录，也会查找一至两层子目录里的 `dev` 脚本，找到后报告实际使用的目录。\
  **Prototype runs from the real app directory** — product repos usually keep
  the dev server in `web/`, `app/`, `apps/*` or `packages/*` instead of the
  repository root. The cockpit now scans named candidates and any one/two-level
  subdirectory with a `dev` script, then reports the resolved directory instead
  of claiming there is no prototype.
- **识别包管理器。** 根据锁文件选择 `npm`、`pnpm`、`yarn` 或 `bun`，缺少 `node_modules` 时给出确切的安装命令。\
  **Package-manager aware** — the detected lockfile decides whether to run
  `npm`, `pnpm`, `yarn` or `bun`, and missing `node_modules` is reported with
  the exact install command.
- **一键安装。** 新增 `POST /beepress/api/prototype/install` 和「安装依赖并启动」操作，装好依赖后启动开发服务。\
  **One-click install** — a new `POST /beepress/api/prototype/install` route and
  an “安装依赖并启动” action install dependencies and then start the dev server.
- **操作台跟随可见会话。** 工作区取自 DSH 的 `retainedBy.mainView` 会话，找不到时回退到上次打开的项目。\
  **Cockpit follows the visible session** — the workspace shown in the cockpit
  comes from DSH's `retainedBy.mainView` session, falls back to the last opened
  project, and no longer follows whichever session changed most recently.
- **卸载时停止开发服务。** 插件卸载时清理开发服务子进程，避免重启后旧 Vite 实例占用端口并导致嵌入原型的 HMR 失效。\
  **Dev servers stop with the harness** — the plugin disposes its dev server
  children on unload, so restarts no longer leave a stale Vite instance holding
  the port and breaking HMR in the embedded prototype.
- **无依赖应用可直接启动。** 有 `dev` 脚本且无依赖时视为就绪，即使 npm 没有创建 `node_modules`，小型测试项目也能启动。\
  **Zero-dependency apps start without an install** — a `dev` script with no
  dependencies is treated as ready, so tiny fixtures are not blocked on a
  `node_modules` folder that npm never creates.
- **支持带 ANSI 颜色的 URL。** 开发服务输出包含颜色转义字符时仍可提取地址，包括 `vite` 用转义字符分隔端口的情况。\
  **ANSI-safe URL detection** — dev servers that colorize output (`vite` splits
  the port with escape codes) are parsed correctly.
- **桌面端随包提供并同步 DSH 插件。** 应用包内包含 `beepress/host`，启动时安装缺失的配置，并重新同步插件，让配置目录用到新增文件。\
  **Desktop ships and syncs its DSH bundle** — the app bundle now contains
  `beepress/host`, installs the profile on launch when it is missing, and
  re-syncs the bundle so new files reach the profile instead of silently running
  an old copy.

## 0.7.3 — 2026-10-20

- **收拢桌面端职责。** 桌面应用选完项目就直接进入 DSH。移除平行维护的 Bee Press 工作台、右侧栏、文件树、浏览器、终端和「打开 Agent 工作区」中间层。\
  **Corrected product boundary** — the desktop app is now a thin project
  picker that enters DSH directly. The parallel Bee Press workbench, right
  sidebar, file tree, browser, terminal and “打开 Agent 工作区” layer are gone.
- **Bee Press 集成到 DSH。** 通过 `ctx.sidebarRightTabs` 注册基线、需求、原型、评审、内容和发布六类标签页，每类都有正文、标题插槽和引导入口。\
  **Bee Press lives in DSH** — six domain tab types are registered through
  `ctx.sidebarRightTabs`: baseline, requirements, prototype, review, content and
  publish. Each has a body/title slot and a guide entry.
- **复用 DSH 界面。** 原型和评审打开 DSH 的浏览器标签页，文件和终端直接使用 DSH 内置标签页。\
  **Reuse DSH surfaces** — prototype/review open DSH's browser tab; files and
  terminal are DSH's built-in tabs, not Bee Press copies.
- **工作流路由。** 宿主 HTTP 路由提供基线读写、需求创建与检查、原型启动、内容采集和发布试跑。\
  **Workflow routes** — host HTTP routes for baseline read/write, feature
  creation/check, prototype start, content capture and publish dry-run.

## 0.7.2 — 2026-10-20

- **可调宽度的三栏工作台。** 工作区、检查面板和浏览器共用参考 DeepSeek Harness 客户端的可拖拽网格。侧栏宽 264–420px，中间最小 400px，右栏可在 300px 到 70% 之间调整，检查面板和浏览器的分隔线也可拖动。宽度按设备保存。\
  **Resizable three-pane workbench** — workspace, inspector and browser share a
  draggable grid modeled on the DeepSeek Harness client layout: 264–420px
  sidebar, 400px minimum center, 300–70% right pane and a draggable inspector /
  browser split. Widths persist per machine.
- **嵌入式浏览器。** 原型和评审在工作区旁的 Electron `<webview>` 中打开，提供前进、后退、刷新、地址栏和在系统浏览器中打开。Webview 仅允许 HTTP(S)。\
  **Embedded browser** — prototype and review actions open in an Electron
  `<webview>` beside the workspace, with back/forward/reload, address bar and
  “open in system browser”; webviews are restricted to HTTP(S).
- **分阶段历史。** 需求、原型、评审、内容和发布各在 `.beepress/desktop.json` 保留最近 20 次运行。切换阶段会恢复该阶段的最新输出和历史。\
  **Per-stage history** — requirements, prototype, review, content and publish
  each keep their last 20 runs in `.beepress/desktop.json`; switching stages
  restores that stage's latest output and history.
- **原生应用菜单。** 文件、编辑、视图、窗口和帮助菜单提供导入、新建、命令面板、面板切换及标准 macOS 菜单角色。\
  **Native application menu** — File, Edit, View, Window and Help menus with
  import/new, command palette, pane toggles and standard macOS roles.
- **复用 DSH 布局交互。** 沿用 DSH `ui-layout` 的列宽计算，以及用指针捕获和 `requestAnimationFrame` 实现的拖拽手柄。\
  **Layout behavior from dsh** — adapted the DSH `ui-layout` column solver and
  pointer-capture/rAF drag handles instead of inventing a new splitter.

## 0.7.1 — 2026-10-20

- **原生桌面外壳。** 用常驻工作区侧栏、内嵌原生标题栏、状态栏和命令面板（`⌘K`）取代宣传式入口页。\
  **Desktop-native shell** — replaced the marketing-style entry page with a
  persistent workspace sidebar, native inset title bar, status bar and a
  command palette (`⌘K`).
- **项目工作区。** 最近项目列在侧栏，需求、原型、评审、内容和发布作为工作流导航。\
  **Project workspace** — recent projects live in the sidebar; requirements,
  prototype, review, content and publish are workflow navigation, not cards.
- **运行检查面板。** 阶段操作在专用面板输出结果，显示运行中、成功和失败状态，并提供清晰的操作入口。\
  **Run inspector** — stage actions now write into a dedicated output panel with
  running/success/failure state and a clear action.
- **设置式基线。** 技术栈和 UI 规范采用设置页布局，常驻确认操作，并显示当前项目上下文。\
  **Settings-style baseline** — stack and UI-spec selection use a settings layout
  with a sticky confirm action and visible project context.
- **键盘操作。** 主要桌面入口支持 `⌘K`、`⌘O`、`⌘N`、`⌘⇧F` 和 `Esc`。\
  **Keyboard flow** — `⌘K`, `⌘O`, `⌘N`, `⌘⇧F` and `Esc` cover the main desktop
  entry points.

## 0.7.0 — 2026-10-20

- **桌面入口。** 首页采用「从氛围编程玩具到生产应用」的定位，提供拖拽导入、经 Agent 授权的项目扫描及新建项目入口。\
  **Consumer entry** — the desktop app opens with the “vibecoding toy → production
  application” positioning, a drag/drop project importer, an Agent-authorized
  project scan and a new-project path.
- **生产基线。** 用户可确认预设技术栈和 UI 规范，查看识别到的技术栈，或输入在线 URL 分析框架、配色和字体。\
  **Production baseline** — users confirm the preset stack and UI spec, inspect
  the detected stack, or analyze a live URL for frameworks, colors and fonts.
- **工具入口。** 需求、原型、评审、内容和发布各有独立卡片，DSH 工作区作为可选入口。\
  **Explicit tool hub** — requirements, prototype, review, content and publish
  are first-class cards; the DSH workspace is an optional entry, not the product.
- **项目模板。** 新项目内置 React、Tailwind 和 Vite 启动模板。\
  **Starter** — new projects include the React + Tailwind Vite starter.

## 0.6.8 — 2026-10-20

- **录制操作视频。** 内容阶段可通过 `record-kb-clips`，基于运行中的原型重新生成 MP4 或 GIF。\
  **Clip recording action** — the content stage can rebuild MP4/GIF clips with
  `record-kb-clips` against the running prototype.

## 0.6.7 — 2026-10-20

- **FRS 校验入口。** 创建需求文件夹后，可在项目工作台直接运行 `check-frs`。\
  **FRS check action** — the project workbench can run `check-frs` directly
  after creating a feature folder.

## 0.6.6 — 2026-10-20

- **阶段操作。** 项目工作台可用 FRS 模板新建需求文件夹、安装依赖、启动原型开发服务、打开评审浮层、查看待处理批注、读取内容确认记录，以及重拍过期截图。\
  **Stage actions** — the project workbench can create a feature folder from the
  FRS templates, install dependencies, launch the prototype dev server, open
  the review overlay, inspect pending comments, read the content lock and
  rebuild stale screenshots.
- **发布目标。** 可按项目保存 `BEEPRESS_PUBLISH_GATEWAY`，并在工作台运行 `kb-publish --dry-run`。\
  **Publish target** — save a per-project `BEEPRESS_PUBLISH_GATEWAY` and run a
  `kb-publish --dry-run` from the workbench.
- **React 启动模板。** 新项目包含 Vite、React 和 Tailwind 模板，可用 `npm run dev` 启动。\
  **React starter** — new projects now include a Vite + React + Tailwind
  starter with `npm run dev`, instead of only docs.
- **分发。** 加入 Electron Builder、macOS 权限配置、未签名 DMG 和 ZIP 产物，以及签名和公证所需参数的说明。\
  **Distribution** — added Electron Builder, macOS entitlements, unsigned
  DMG/ZIP output and documented signing/notarization inputs.

## 0.6.5 — 2026-10-20

- **项目工作台。** 选择项目后先看到项目级工作流，集中展示需求、原型、评审、内容和发布状态，以及「进入项目工作区」入口。\
  **Project workbench** — after choosing a project, the launcher shows a
  project-level workflow view instead of immediately opening a chat:
  requirements, prototype, review, content and publish status, plus a single
  “enter project workspace” action.
- **项目检查。** 启动 DSH 前，启动器从本地读取 FRS 数量、知识库页面、未解决批注、开发脚本和发布配置。\
  **Project inspection** — the launcher reads FRS count, knowledge-base pages,
  open reviews, dev script and publish configuration locally before starting
  dsh.
- **新建项目流程。** 创建项目后停在工作台，让用户查看脚手架后再进入工作区。\
  **New project flow** — creating a project now stops at the workbench so the
  user can review the scaffold before entering the workspace.

## 0.6.4 — 2026-10-20

- **桌面资源随包分发。** 打包后的应用从 `Resources/beepress` 解析 `beepress` CLI 和脚手架。electron-builder 会复制 `bin`、`pipeline`、`scaffold`、`docs/templates` 及包清单。\
  **Packaged desktop resources** — the packaged app resolves its `beepress`
  CLI/scaffold from `Resources/beepress`, and electron-builder copies `bin`,
  `pipeline`, `scaffold`, `docs/templates` and the package manifest there.
- **开发路径。** 未打包运行时继续使用仓库根目录或 `BEEPRESS_KIT_ROOT`。\
  **Development path unchanged** — unpackaged runs keep using the repository
  root or `BEEPRESS_KIT_ROOT`.

## 0.6.3 — 2026-10-20

- **Bee Press 桌面引导。** 桌面应用打开 Bee Press 启动器，可导入现有项目、用脚手架新建项目或重新打开最近项目。\
  **Branded desktop onboarding** — the desktop app now opens a Bee Press
  launcher instead of the chat surface: import an existing project, create a
  scaffolded project, or reopen a recent one.
- **从所选项目启动。** 所选目录成为 DSH 工作区并打开会话，直接使用客户端包的 `uiWorkspace` 和 `workspaces`，省去再次选目录。\
  **Project-aware launch** — the selected path becomes the dsh workspace and
  opens a session; `uiWorkspace` + `workspaces` are used from the client
  bundle instead of asking the user to pick the folder again.
- **侧栏品牌。** 通过 `sidebar.brand.*` 插槽将 DSH 侧栏图标和名称换为 Bee Press。\
  **Sidebar branding** — the dsh sidebar brand mark/name are replaced with
  Bee Press through `sidebar.brand.*` slots.
- **项目创建。** CLI 子进程通过 Electron 的 Node 模式执行，避免将 Electron 可执行文件当作脚本调用。\
  **Safer project creation** — CLI subprocesses run through Electron's Node
  mode; the launcher never invokes the Electron binary as a script.
- **工作流状态。** Bee Press 面板显示需求、原型、评审、内容和发布各阶段。\
  **Workflow status** — the Bee Press panel now shows requirement, prototype,
  review, content and publish stages.
- **桌面资源与打包。** 新增 Bee Press 图标、macOS 程序坞图标和 `electron-builder` 的 macOS 构建目标配置。签名和公证留待发布时处理。\
  **Desktop assets/packaging** — added the Bee Press icon, macOS dock icon and
  an `electron-builder` macOS target configuration; signing and notarization
  remain release work.

## 0.6.2 — 2026-10-20

- **桌面启动器。** 依次从 `BEEPRESS_DSH_BIN`、常见的 npm 全局安装路径和 Homebrew 路径、PATH 查找 `dsh`。记录配置和加载的 URL，启动超时或应用退出时终止子进程。\
  **Desktop launcher** — resolves `dsh` from `BEEPRESS_DSH_BIN`, the common
  npm-global/Homebrew paths, then PATH; logs the profile and loaded URL; kills
  the child process when startup times out or the app quits.
- **桌面文档。** 补充完整本地测试步骤、Electron 安装后脚本的恢复方法，以及无需开窗的验证路径。\
  **Desktop docs** — added the exact local test loop, Electron postinstall
  recovery and a windowless verification path.

## 0.6.1 — 2026-10-20

- **恢复项目脚手架。** 新增 `scaffold/`，包含 FRS 模板（`docs/templates/`）、工作流、知识库写作指南、知识库和媒体配置模板、`src/config/frs-map.js`、项目指南及核心 `.agent/skills/`。\
  **Project scaffold restored** — added `scaffold/` with the FRS templates
  (`docs/templates/`), workflow, kb writing guide, kb/media config starters,
  `src/config/frs-map.js`, project guides and core `.agent/skills/`.
- **`beepress init`。** 将脚手架复制到宿主项目并保留已有文件，支持 `--list`、`--only`、`--force` 和 `--target`。\
  **`beepress init`** — copies the scaffold into a host project without
  overwriting existing files; supports `--list`, `--only`, `--force` and
  `--target`.
- **新项目可运行 `check-frs`。** 脚手架包含校验所需的零依赖 `frs-map.js`。\
  **`check-frs` unblocked on new projects** — the scaffold includes the
  zero-dependency `frs-map.js` that the check imports.

## 0.6.0 — 2026-10-20

- **包名迁移。** npm 包名改为 `beepress`，导入路径为 `beepress`、`beepress/react`、`beepress/vue2` 和 `beepress/vite`。CLI 保留 `beepress`、`builder-kit` 和 `bk` 三个别名。\
  **Package rename** — the npm package is now `beepress`; imports are
  `beepress`, `beepress/react`, `beepress/vue2` and `beepress/vite`. The CLI
  keeps `beepress`, `builder-kit` and `bk` aliases.
- **兼容包。** `compat/builder-kit` 重新导出 `beepress`，兼容已有的 `builder-kit/*` 导入及 `builder-kit` CLI。仍接受旧环境变量 `BUILDER_KIT_*` 和虚拟模块 `virtual:builder-kit/host`，新代码使用 `BEEPRESS_*` 和 `virtual:beepress/host`。\
  **Compatibility package** — `compat/builder-kit` re-exports `beepress` for
  existing `builder-kit/*` imports and the `builder-kit` CLI. The legacy
  `BUILDER_KIT_*` environment variables and `virtual:builder-kit/host` module
  remain accepted; new code should use `BEEPRESS_*` and
  `virtual:beepress/host`.
- **`ctx.beepress` 服务。** DSH 插件注册 Cordis 服务，统一处理工具调用和 HTTP 请求。\
  **`ctx.beepress` service** — the dsh bundle registers a Cordis service and
  routes both tools and HTTP handlers through it.
- **内容确认工具。** `beepress_content_status` 通过 `beepress kb status --json` 读取 `docs/kb/_lock.json`，`beepress_content_confirm` 通过 `beepress kb ack` 记录已确认的引用。\
  **Content confirmation tools** — `beepress_content_status` reads
  `docs/kb/_lock.json` via `beepress kb status --json`;
  `beepress_content_confirm` records reviewed refs via `beepress kb ack`.
- **发布计划。** `beepress_publish_plan` 对比本地页面和 `docs/kb/_published.json`，报告配置的发布目标，并在右侧栏展示计划。\
  **Publish plan** — `beepress_publish_plan` compares local pages with
  `docs/kb/_published.json`, reports the configured destination and exposes the
  plan in the right-sidebar panel.
- **媒体采集工具。** `beepress_capture_media` 复用 `capture-kb-shots` 和 `record-kb-clips` 配方，按可复现的流程重拍截图或重录视频。\
  **Media capture tool** — `beepress_capture_media` rebuilds screenshots or
  clips with the existing reproducible `capture-kb-shots` /
  `record-kb-clips` recipe runner instead of ad-hoc screenshots.
- **面板。** 新增内容确认和发布计划区块，以及由 `/beepress/api/content` 提供的内容检查操作。\
  **Panel** — added content-lock and publish-plan sections, plus a content
  check action backed by `/beepress/api/content`.
- **轻量桌面壳。** 新增 `integrations/desktop`，通过 Electron 启动上游 DSH 配置并加载 Web 界面，另提供 `install-profile` 辅助安装预置 Bee Press 插件。\
  **Thin desktop shell** — added `integrations/desktop`, an Electron wrapper
  that boots an upstream dsh profile and loads its Web UI, plus an
  `install-profile` helper for the preinstalled Bee Press bundle.

## 0.5.0 — 2026-10-19

- **DeepSeek Harness 和 MCP 集成。** 在 `integrations/` 新增 `@beepress/dsh-bundle`、DSH 插件、Bee Press 右侧栏和 `beepress-mcp` 标准输入输出入口，共用一套工作区读取逻辑。DSH 提供 `beepress_status`、`beepress_context`、`beepress_review_open`、`beepress_review_add` 和 `beepress_review_resolve`。面板读取当前会话的工作区并可解决批注。MCP 保持只读，媒体采集和发布尚未接入。\
  **DeepSeek Harness + MCP integration** — added `integrations/` with
  `@beepress/dsh-bundle`, a dsh plugin, a right-sidebar Bee Press panel and a
  `beepress-mcp` stdio entrypoint over one shared workspace reader. The dsh
  host exposes `beepress_status`, `beepress_context`, `beepress_review_open`,
  `beepress_review_add` and `beepress_review_resolve`; the panel reads the
  current session workspace and can resolve reviews. MCP remains read-only.
  Media capture and publishing are not included yet.
- **DSH 会话目录。** 工具通过 `ctx.workingDirectory.ensure()` 解析当前会话的工作目录，选择项目工作区后会读取对应的 `docs/`。\
  **dsh session directory** — the dsh tools now resolve the active session
  working directory through `ctx.workingDirectory.ensure()` instead of the
  Harness process cwd, so selecting a project workspace gives the correct
  `docs/` tree.

## 0.4.0

- **Bee Press 品牌。** 产品更名为 **Bee Press**，定位为「一群 Agent，共用一个事实来源」。专门分工的 Agent 通过共享的事实引用、评审确认记录、媒体台账和发布状态协作。\
  **Bee Press brand** — the product is now **Bee Press**, with the positioning
  “a hive of agents. One source of truth.” The name reflects the operating
  model: specialised agents coordinate through shared artifacts (fact refs,
  review locks, media ledgers, publish state), not a human-in-the-loop chat.
- **CLI 别名兼容。** 在 `builder-kit` 和 `bk` 之外新增 `beepress`。npm 包名、导入路径和 `BUILDER_KIT_*` 环境变量维持该版本的原有约定。\
  **Compatible CLI aliases** — `beepress` was added alongside `builder-kit` and
  `bk`. The npm package name, import paths and `BUILDER_KIT_*` environment
  variables are unchanged.
- **品牌指南。** 新增 `docs/brand.md`，涵盖命名、标语、表达风格和视觉方向。\
  **Brand guide** — added `docs/brand.md` covering naming, taglines, voice and
  visual direction.
- **文档和示例。** README、架构、适配器、发布和 UI 规范文档统一使用 Bee Press 名称，React 示例的标题和文案同步更新。\
  **Documentation and demo** — README, architecture, adapter, publishing and UI
  spec docs now use the Bee Press name; the React demo title and copy follow.

## 0.3.0

- **迁移到 Tailwind 4。** 示例、标准组件和文档通过 `@tailwindcss/postcss` 使用 Tailwind 4.3。由 token 生成的旧式配置通过 `@config` 加载，容器查询使用 Tailwind 内置支持。\
  **Tailwind 4 migration** — the demo, canonical components and docs now target
  Tailwind 4.3 via `@tailwindcss/postcss`. The token-derived legacy config is
  loaded with `@config`; container queries use Tailwind's built-in support.
- **可插拔发布目标。** Studio 保留发布计划、状态和确认流程，通过 `BUILDER_KIT_PUBLISH_GATEWAY` 加载实际目标。`pipeline/destinations/docs-cli.mjs` 作为参考适配器。详见 `docs/publishing.md`。\
  **Pluggable publish destinations** — the studio keeps the plan/state/confirm
  workflow and loads the actual destination through
  `BUILDER_KIT_PUBLISH_GATEWAY`; `pipeline/destinations/docs-cli.mjs` is now a
  reference adapter, not core coupling. See `docs/publishing.md`.
- **内容发布指南。** 将发布范围扩展到文档页之外的内容载体。新增中文分步指南 `docs/publishing.zh-CN.md`，涵盖内容包、卡片与素材、适配器结构、环境配置、认证、验证和故障排查。\
  **Content destination guide** — reframed publishing as content carriers, not
  just document pages. Added a Chinese, step-by-step `docs/publishing.zh-CN.md`
  covering content bundles, cards/assets, adapter layout, environment setup,
  authentication, validation and troubleshooting.
- **内容检查体验。** Studio 默认显示有引导的审阅队列及页面进度，「待确认」卡片附带需求上下文，AI 和源码编辑操作收进高级开关。配置发布目标后才可发布。\
  **Content-check UX** — the studio opens with a guided review queue and
  page progress, shows requirement context on "needs confirmation" cards,
  hides AI/source-editing actions behind an advanced toggle, and disables
  publishing until a destination is configured.
- **依赖以 React 为主。** Vue 2 作为可选 peer 依赖，开发环境无需安装，构建与审计也无需依赖它。需要 Vue 的宿主仍可接入适配器。\
  **React-first dependencies** — Vue 2 is an optional peer only. It is no longer
  installed for development or allowed to gate the build/audit; the Vue adapter
  remains available for hosts that opt in.
- **依赖更新。** 更新至 Vite 6.4、Mermaid 12.2、tailwind-merge 3.7，并覆盖为已修补的 `postcss-selector-parser`。当时 `npm audit` 报告 **0 个漏洞**。\
  **Dependency refresh** — Vite 6.4, Mermaid 12.2, tailwind-merge 3.7 and a
  patched `postcss-selector-parser` override. `npm audit` now reports
  **0 vulnerabilities**.

## 0.2.0

- **React 适配器。** `beepress/react` 将工具套件挂载到 React 原型，`hashRouter()` 提供无需路由库的桥接。\
  **React adapter** — `beepress/react` mounts the toolkit in React prototypes;
  `hashRouter()` provides a router-library-free bridge.
- **React 源码锚点。** `anchorLoc` 支持 `"auto"`、`"react"`、`"vue"` 和 `false`。JSX 插件在开发态为原生元素注入 `data-loc` 和 `data-comp`。\
  **React source anchors** — `anchorLoc: "auto" | "react" | "vue" | false`;
  the JSX plugin injects `data-loc` / `data-comp` on intrinsic elements in dev.
- **React 与 Tailwind 示例。** `examples/react-tailwind` 提供使用合成数据的产品工作区，包含评审批注、命令面板、异步弹窗状态、深色模式和内容 Studio。\
  **React + Tailwind demo** — `examples/react-tailwind`, a synthetic product
  workspace with review comments, a command palette, async dialog states, dark
  mode and the content studio.
- **Tool UI Spec。** `ui-spec/` 提供设计 token、Tailwind 配置和标准 React 组件。新增 `beepress/ui` 和 `beepress/tokens.css` 导出。\
  **Tool UI Spec** — `ui-spec/` now ships tokens, Tailwind config and canonical
  React components. Export `beepress/ui` and `beepress/tokens.css`.
- **UI 规范检查。** `scripts/check-ui-spec.mjs` 检查硬编码颜色、过渡、视口断点、间距、圆角、焦点补偿及图标按钮标签。\
  **UI conformance gate** — `scripts/check-ui-spec.mjs` checks raw colors,
  transitions, viewport breakpoints, spacing, radii, focus compensation and
  icon-button labels.
- **UI 审查。** 评审和 Studio 界面的排版、间距、圆角、焦点环和动效统一使用 token，并补充输入法组合输入保护、草稿持久化和等宽数字。\
  **UI audit** — tokenized typography, spacing, radii, focus rings and motion in
  the review/studio UI; IME guards; draft persistence; tabular numerals.
- **部署前预检。** `scripts/preflight-dist.mjs` 扫描构建产物中的开发接口、源码锚点、本地路径、source map 和常见密钥。\
  **Pre-deploy preflight** — `scripts/preflight-dist.mjs` scans artifacts for dev
  endpoints, source anchors, local paths, source maps and common secrets.
- **部署技能评审。** `docs/deploy-skill-review.md` 记录新环境检测和用户引导。\
  **Deploy skill review** — `docs/deploy-skill-review.md` covers new-environment
  detection and user guidance.
- **隔离的部署技能端到端测试。** `scripts/test-deploy-skill-e2e.mjs` 用模拟 CLI、registry、`fetch` 和 `HOME` 运行真实 Harness 技能，复现新机器、绑定不匹配、离线、产物泄漏和验收过期等情形。\
  **Isolated deploy-skill E2E** — `scripts/test-deploy-skill-e2e.mjs` runs the real
  Harness skill against a fake CLI, registry, `fetch` and `HOME`, reproducing new
  machine, binding mismatch, offline, leaky artifact and stale-verification states.
- **公开依赖检查。** `.npmrc` 固定使用 `registry.npmjs.org`，`scripts/check-public-deps.mjs` 拒绝私有 registry、本地依赖声明及指向其他站点的锁文件 URL。\
  **Public dependency guard** — `.npmrc` pins `registry.npmjs.org` and
  `scripts/check-public-deps.mjs` rejects private registries, local specs and
  non-npmjs lockfile URLs.
- **清理公开文档。** 部署评审中的私有 CLI 名称改为通用描述，并从导出脚本注释中移除内部主机名。\
  **Public docs cleanup** — genericized private deploy CLI names in the deploy
  review and removed an internal host name from an export comment.
- 修复内容菜单触发器，标题、计数和箭头现在在 30px 高的控件中垂直居中。\
  Fixed the content-menu trigger so its title, count and caret are vertically
  centered instead of sitting against the top of the 30px control.
- **完整 UI 规范页。** 示例的 `#/ui-spec` 展示设计基础、可交互组件状态、使用模式、无障碍说明及可搜索的 token 表。\
  **Full UI spec page** — the demo `#/ui-spec` route now documents foundations,
  live component states, patterns, accessibility and a searchable token table.
- **字号合并修复。** `cn` 向 `tailwind-merge` 注册自定义字号角色，使 `text-body` 或 `text-prose` 与 `text-primary` 合并时仍保留。\
  **Type-scale merge fix** — `cn` registers the custom font-size roles with
  `tailwind-merge`, so `text-body` / `text-prose` survive merging with
  `text-primary`.
- **弹窗焦点。** 破坏性操作的弹窗默认聚焦显式标记了 `data-autofocus` 的取消按钮。\
  **Dialog focus** — destructive dialogs now focus an explicit
  `data-autofocus` target (Cancel) instead of the last focusable button.
- **安全加固。** 为文档 CLI 参数做 shell 转义，阻止发布时越出 `docs/kb` 路径，拒绝覆盖损坏的批注文件，并在发布时要求同源确认令牌。\
  **Security hardening** — shell-quoted document CLI arguments, blocked
  `docs/kb` path traversal in publishing, refused to overwrite corrupt review
  files, and required a same-origin confirmation token for publishing.
- **兼容性和健壮性。** 处理 CRLF front matter、缺少 `replies` 的旧批注、`.js` 中的 JSX、`<MessageActions>` 悬停、批注输入框标签、FFmpeg 或 Chrome 缺失时的进程启动错误，以及发布弹窗焦点。\
  **Compatibility and robustness** — CRLF front-matter, legacy comments without
  `replies`, JSX in `.js` files, `<MessageActions>` hover, composer labelling,
  missing ffmpeg/Chrome spawn errors, and publish modal focus handling.
- **UI token 整理。** 危险操作按钮、代码块悬停和聚焦状态、表头、分段控件轨道改用对应的语义 token。\
  **UI token cleanup** — danger buttons, code-block hover/focus, table headers
  and segmented tracks now use their semantic roles.
- 修复 Vite 处理 Less 的边界情况，避免注释里的 `@import` 触发 URL 路径重写。\
  Fixed a Vite Less edge case where an `@import` in a comment triggered URL
  rebasing.

## 0.1.0

首次开源发布。\
Initial open-source release.

- **评审工具。** 支持点选批注、源码锚点三级定位（L1/L2/L3）及批注持久化。\
  Review suite: select-and-comment UI, source-coordinate anchors (L1/L2/L3), comment persistence.
- **Studio 工具。** 提供审阅队列、内容状态、前后对比、结构视图和演示录制。\
  Studio suite: review queue, content status, before/after comparison, structure view, demo recorder.
- **Vite 集成。** 提供宿主桥接和 Vue 2 适配器。\
  Vite integration with a host bridge and a Vue 2 adapter.
- **流水线 CLI。** 支持评审记录、需求规格、PRD、截图、视频片段和内容状态。\
  Pipeline CLI for review notes, feature specs, PRDs, screenshots, clips and content status.
- **外部文档发布。** 提供可选的可插拔发布能力。\
  Optional, pluggable external document publishing.
