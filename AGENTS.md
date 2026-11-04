# BuilderHarness · Agent 工作指南

> 本仓库既是 BuilderHarness 工具本身，也是它的第一个宿主项目（dogfooding）。
> 不要把内部平台名、域名、账号或密钥写进仓库。

## 这个仓库是什么

需求规格、原型、评审和内容在同一个仓库里协作：

- 需求：`docs/features/<KEY>/`，模板在 `docs/templates/`；自身需求见 `docs/features/`（ONBOARDING / COCKPIT / REVIEW）
- 评审 UI：`client/`（React，构建产物进 `build/`）
- 原型参考实现：`examples/react-tailwind/`（可运行，`npm run dev`）
- DSH 插件与操作台：`integrations/host/`（`lib/client.js` 是主面板与右侧栏）
- 桌面壳：`integrations/desktop/`
- 批注：`docs/reviews/`
- 内容：`docs/kb/`
- 发布状态：`docs/kb/_published.json`

## 工作流索引

按需读取，不要一次全塞进上下文：

| 场景 | 读什么 |
|---|---|
| 新需求评审（M/L 含设计依据） | `.agent/skills/requirement-review/SKILL.md` |
| 写 FRS / 需求件套 | `.agent/skills/prd-author/SKILL.md` + `docs/templates/` |
| 写 / 更新知识库 | `.agent/skills/content-draft/SKILL.md` + `docs/kb/CONTRIBUTING.md` |
| 处理批注 | `.agent/skills/review-local/SKILL.md` |
| 原型实现 | `.agent/skills/ui-prototype/SKILL.md` |
| Vue 2 宿主 | `.agent/skills/vue-best-practices/SKILL.md` |
| 提交前质量检查 | `.agent/skills/frontend-quality/SKILL.md` |
| 发布 | `.agent/skills/prd-publish/SKILL.md` + `docs/WORKFLOW.md` |
| 产品定位 / 对外文案 | `docs/brand.md` |
| 部署原型 | `.agent/skills/deploy-prototype/SKILL.md` + `docs/DEPLOY.md` |

## 角色边界

- 人：确认需求状态、内容锁、发布目标和外发范围。
- Agent：读源码、写文件、跑检查、生成媒体、提出方案；不替人做确认。
- 工具：负责落盘、校验和可复现产物；不隐藏失败。

## 设计哲学

原型、需求规格、PRD、知识库和工具本身都适用。它们靠判断而不是检查——拿不准时用每条末尾那句问自己；具体案例记在 `docs/DECISIONS.md` 与各需求的决策表里。

1. **克制，默认不加。** 一句说明、一列、一个开关、一层确认、一个新概念，都要先证明自己有用；同一件事在一屏里只说一次。*删掉它，用户失去什么？*
2. **信息长在它说的那个东西上，按需要的时机分层。** 原因写在被影响的那一行、那个字段旁，不在页头另起一句，也不在底栏汇总；用户是来看内容的，登记信息收起，出问题时再查。*这句话离它说的东西有多远？用户此刻需要它吗？*
3. **跟着用户心智走，保留已有习惯。** 结构、命名、入口按用户以为自己在做什么来定，不按数据结构或系统模块：从文件导入是「新建」的第二种来源，不是另一件事；同一个动作全产品一个名字；有常规做法就不发明；线上正常工作的形状不顺手改。*没读过说明的人第一眼会怎么理解？用户要重新学什么？*
4. **阅读顺序就是依赖顺序。** 视线从左到右、从上到下，决定别人的控件放在被决定者的上方或左边，依赖只朝下流；控件一消失，值回到默认，不留「开着却被禁用」这类说不清的状态。*有没有哪一处要先看下面、再回头改上面？*
5. **提醒而不阻断，不替用户做决定。** 只有路真走不通才禁用或拦截，「可能选错」只提醒；校验放在提交时，不打断填写。数据去留、覆盖用户改过的东西，要用户明确选过：不给默认、不隐式发生、不先改后告知。*这是走不通，还是可能选错？这个决定该由谁来做？*
6. **禁止之前先找缺的界面，复杂之时先理清问题。** 「只好禁止同时做 A 和 B」往往是缺一块显示合并结果的界面。交互复杂时先画实体关系与主流程：用户要学的概念应当等于问题本身的名词，多出来的多半是被暴露成功能的实现机制。通用交互模式先调研业内成熟做法再定。*缺的是一条禁令，还是一块界面？*
7. **事实先于推测。** 每条规则都说得出来源：线上实测、产品确认或需求规格。示例文件只说明格式，DOM 里有不等于上线了，mock 只是占位，字段名不等于语义；推出来的标成推测、进 `openQuestions`。推测出来的规则总是比实际更严、更多。*这条是有人点过，还是我推的？*
8. **文案短、准、有温度，说用户的话。** 不暴露内部视角（系统新旧、实现术语、英文 key），不复述标签，不写只对一种情况成立的定义；按钮用具体动作词，越短越好。这条管界面文案；需求规格写成规则体，见 `.agent/skills/prd-author/SKILL.md`。*用户自己会这么说吗？*

与人协作同样克制：

- 有专业判断就给推荐和理由，要求不合理就直说；不要只罗列选项让人挑。
- 评审说「看不懂」，先定位受阻的用户判断，再区分概念、流程、位置或文案问题；给推荐与理由后继续已授权的修改，避免只加说明或换标签。改一处之前先看全产品有没有同类。
- 范围内一步到位，不留半成品；范围外按兵不动，需求来了再改。
- 人改过的东西（原型文案、已发布文档的正文、PRD）不整篇覆盖；改完先在页面上看一眼，再说改好了。
- 汇报先一句话给结论，用对方的语言和词，不用自己起的代号。

## 从反馈持续对齐

- 方案设计前按本轮任务检索 `docs/DECISIONS.md`，读完整条及后续修订，确认当前结论和适用边界；只在设计依据里简述实际影响本轮方案的经验，不全量加载日志。
- 遇到实质纠正、方案被推翻或同类问题重现，先说明「上一版优化了什么 → 用户关心什么 → 哪个假设要修正 → 方案怎么变」，再继续已授权的工作。不能只道歉或改措辞；证据不足就标明判断待核实。
- 结束时只沉淀有新增信息的结论：局部规则回到需求件套，跨需求经验按 `docs/DECISIONS.md` 的模板记录来源、状态和边界。模型推断是候选，用户没反对不等于确认；不把个案改成全局偏好。具体做法见 `.agent/skills/requirement-review/SKILL.md`。

## 硬性规则

1. **先看源码和现状，再改。** 不要按旧文档或示例数据推断产品事实。
2. **批注按源码坐标定位。** 坐标失效时报告降级原因，不要静默漂移。
3. **内容以 Markdown 为唯一真源。** 不另建一份内容 JSON 副本。
4. **事实要可追溯。** 抄自 FRS 或源码的句子用 `frs:` / `code:` 标记。
5. **发布是外发动作。** 先 dry-run，确认目标、密级和分享范围。
6. **不提交密钥、真实用户数据或内部域名。**
7. **开发期 UI 不得进入生产构建。** 只通过 `import.meta.env.DEV` 挂载。

> `check-ui` / `check-routes` are reference host checks. They expect a
> design-token setup and a three-place route registry; adapt them to the host
> or leave them out if the host uses a different convention.

## 必须由人确认

- 需求从草案进入已确认；
- 内容引用从「待审」进入「确认」；
- 发布目标、发布范围和密级；
- 任何会改变产品语义的取舍。

## 常用命令

```bash
npx builderharness kb status
npx builderharness kb context <页|路由>
npx builderharness kb ack <页>
npx builderharness check-frs <KEY>
npx builderharness check-ui          # reference host check; see caveat below
npx builderharness check-routes
npx builderharness prd <KEY> --dry-run
```

## Harness

- Cursor / Claude Code / Codex：把本文件作为入口，按表格按需读取 Skill。
- DeepSeek Harness：安装 `@builderharness/dsh-bundle`，使用右侧栏面板和 `builderharness_*` 工具。
- 其他 Agent：只要能读文件、跑命令，就能使用同一套工作流。
