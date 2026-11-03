---
name: frontend-quality
description: 前端提交前质量检查。适用于用户说「自检」「review 一下页面」「提交前检查」时。覆盖构建、路由、UI 规范、状态覆盖和可访问性。
---

# 前端质量检查

按顺序跑，先失败先修：

```bash
npx builderharness check-prototype-syntax
npx builderharness check-ui      # reference host check
npx builderharness check-routes  # reference host check
npx builderharness check-frs <KEY>   # 有需求件套时
```

`check-prototype-syntax` 除了语法，还查「用了却没声明、也没 import」的标识符（含 JSX 组件名）：只做语法检查时漏一个 import 照样通过，到浏览器里才 ReferenceError、生产构建整页白屏。解析器借宿主依赖链上的 Babel；输出里出现「⚠ 降级」就是这一项没查，汇报时照实写，不当成通过。

## 手工走查

- 主路径能完成，返回/刷新/深链不丢状态。
- 空数据、加载、错误、权限受限、取消都有落点。
- 键盘可达；焦点可见；对比度达标。
- 窄屏不横向溢出；长文本有截断或换行策略。
- 生产构建不包含评审/内容工具；`import.meta.env.DEV` 分支消失。

## 输出

汇报实际跑了什么、结果、没覆盖的部分。不要只写「已检查」。
