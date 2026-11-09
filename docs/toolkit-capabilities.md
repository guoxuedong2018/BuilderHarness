# Toolkit 能力对照与开源接入

这份清单逐项比对原型工作树的工具套件、Agent Skills、发布和媒体脚本、宿主通用交互工具。
应用数据结构和真实环境取数脚本作为宿主实现，通过配置、适配器、合成夹具及场景复用方法。

| 源能力 | BuilderHarness 对应能力 | 使用入口 |
| --- | --- | --- |
| 原生 Agent 规则、领域映射、交互反例、设计结论回写 | Codex、Claude Code、Cursor 各自加载原生规则与 Skills，提供独立设计复核和参考案例 | `init --prototype --agent all` |
| FRS、验收和浏览器状态 | 保留现有模板和引用检查。支持哈希/历史路由、自动启动本地服务、状态注入、文件上传及证据过期 | `verify KEY --serve` |
| 分组待决清单、备选、来源和确认 | 同一份 README 支持新旧表头，按产品、研发、业务、评审会分组。可看依据原文、复制问题、打回、撤回、复核变更 | 评审工具栏 → 待决清单，`review open` |
| 活原型、元素锚点、批注和内容审阅台 | 沿用 Vue/React 开发挂载、源锚点降级、章节引用、录制操作配方和源快照 | 评审工具栏，`kb`，`record-kb-clips` |
| 产品片、宣贯场景、纹理、动效和声音 | 完整参考手册和双模板。同源逐帧、真输入、外部纹理坐标、海报、GIF、总片、音轨和字体授权记录 | `promo doctor / init / capture / render / sound / status` |
| 功能点与通用组件 PRD、人工改动回流 | 功能点及组件独立表、按范围收集截图、云端修订稿、只写变动段落、人工改动差异报告 | `check-frs`，`export-frs-prd`，`prd` |
| 本机模拟、合成素材、可重复错误与恢复 | 可运行的 HTTP 故障矩阵和轨迹，通用媒体导入/生成、封面和清单 | `simulate`，`fixtures` |
| 宿主 UI 规则和交互方法 | 现有 UI tokens、设计自检、表格/表单组件，加上框架无关的分面、跨页勾选和 JSON 定位 | `builderharness/ui`，`builderharness/ui-data` |
| 预览部署、正式数据与脱敏例外 | 宿主发布适配器、项目目标核对、只传构建快照、宿主私有值和允许值策略、固定版本回读 | `preflight --policy`，`deploy plan / apply` |
| 设计反例和 Harness 验证 | 设计复核技能携带 14 道语义评审素材。复用 BH 已有独立工作区、隐藏测试和轨迹对比 | `eval validate / run / compare` |
| 内容参考、媒体和验收对 Agent 可见 | MCP 读取项目证据、待决状态和 AC 执行结果，CLI 是实际执行入口 | `builderharness-mcp` |

[原型工作流](prototype-workflow.md) · [部署](DEPLOY.md) · [Agent 评测](evals.md)
