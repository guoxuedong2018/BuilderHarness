---
name: review-local
description: 读取、回复或解决原型批注。适用于用户说「看下批注」「处理评审意见」「把这条评论解决了」时。批注带源码坐标；按坐标定位，不靠文本搜索猜。
---

# 本地批注

批注落在 `docs/reviews/<REGION>.json`，由 dev 中间件写入；不要让 Agent 手改运行时状态。

## 读

```bash
npx builderharness review open
```

每条批注关注：

- `anchor.loc`：`file:line:column`，第一定位依据；
- `frs` / `route`：归档区域和页面；
- `status`：`open` / `resolved`；
- `replies`：已有讨论。

## 处理

1. 先按 `anchor.loc` 打开源码，确认元素仍在。
2. 坐标失效时按组件语义、几何位置降级，并说明置信度；不要静默改到别处。
3. 修改后回复并解决：

```bash
npx builderharness review reply <id> "已调整按钮层级"
npx builderharness review resolve <id> --note "已修复"
```

4. 需求级意见归并到 `docs/features/<KEY>/`，不要只留在批注里。

## 边界

- 不删除未解决的批注。
- 不把批注当需求真源；需要改变行为时回到 FRS / 用户确认。

## 待决清单

`builderharness review open` 也列出已提交待记录的产品决策。先读原问题和提交版本。
确认或补充答复后，在 README 的「待决清单」记录结论、确认人和提交 ID，并同步 FRS / AC。
用 `FRS.decisionRefs` 关联提交和实际受影响的 AC，再运行
`builderharness review resolve-decision <KEY> <submission-id>`。
打回的条目先修订问题，保留待决状态。涉及实现的批注在浏览器复查后再关闭。
