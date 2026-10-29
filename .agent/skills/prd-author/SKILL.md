---
name: prd-author
description: 产出 FRS 需求件套。需求评审为 M/L 级后，在 docs/features/<KEY>/ 下产出 FRS.json、README.md、FLOW.md、STATE.md（按需）和 ACCEPTANCE.md。当用户说「写 PRD」「出 FRS」「产出需求文档」「建需求卡」「写需求件套」时触发。
---

# PRD / FRS 产出

在 `docs/features/<MMDDHHMM>_<MODULE>_<NAME>/` 下产出需求件套。模板在
`docs/templates/`，方法论在 `docs/WORKFLOW.md`。

## 核心原则：件套自洽

新人拿到这个目录，不翻别的文档，就能理解：

- 要做什么；
- 边界在哪；
- 怎么算做完；
- 还有哪些问题没定。

达不到就是没写完，不进入下一步。

## 范围

PM / Agent 产出：`FRS.json`、`README.md`、`FLOW.md`、`STATE.md`（按需）、
`ACCEPTANCE.md` 空模板。原型代码归业务工程；本 Skill 不直接改业务实现。

## 步骤

1. **先形成设计依据。** 先用 `builderharness context "<任务>" --json` 找相关来源，再读现状源码、已有需求和用户最近确认的决定；UI 任务按需要读路由。
   核查历史前提与反例，允许新目标修订旧决定。建议和未决假设不写成已确认规则；非 UI 项目不虚构页面或路由。
   完成「意图 → 现状 → 目标 → 用户任务 → 位置/数据对应 → 反例走查」。
2. **FRS.json。** 从 `docs/templates/FRS.json` 复制，填：
   - `goal` / `background` / `scope.include` / `scope.exclude`
   - `spec`：按页面 → 功能点 → 显示/交互/取值/权限
   - `shots`：截图配方
   - `acceptance`：可测试、逐条编号
   - `verification` / `openQuestions` / `dependencies`
3. **README.md。** 从模板复制，填需求背景、待决清单、验收标准、文件导航。
   待决清单按「谁来定」分组，空着 = 还没定。
4. **FLOW.md。** 画核心用户旅程；异常分支（无权限、空数据、超时、取消）也要画。
5. **STATE.md。** 只有多状态流转才保留；简单 CRUD 删除。
6. **ACCEPTANCE.md。** 先建空模板，验收阶段逐轮填写。

## 校验

```bash
npx builderharness check-frs <KEY>
```

硬失败必须修：AC 引用不存在、功能点没有 AC、四类规则全空、路由不在
`src/config/frs-map.js`、截图 key 未定义。提醒项（未被覆盖的 AC、未引用的截图）
要在 README 里处理或说明。

## 边界

- `FRS.json` 是 PRD 的真源；PRD 是它的渲染视图，不手写第二份正文。
- 不把未确认的技术方案写成需求规则。
- 原型截图只作为参考图；知识库步骤图走 `docs/kb/shots.config.mjs`。
- 状态改动同步 README 头部和 `FRS.json.status`。
