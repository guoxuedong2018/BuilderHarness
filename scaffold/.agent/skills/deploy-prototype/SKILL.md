---
name: deploy-prototype
description: 构建、预检并发布静态原型。为目标、访问范围与本次构建产物生成可核对的部署计划。
---

# 原型部署

1. 运行宿主的构建命令，再运行 `builderharness preflight --dir dist`。解决预检发现的开发接口、源码坐标、凭据和宿主禁发数据。
2. 通过宿主的 `BUILDERHARNESS_DEPLOY_GATEWAY` 适配器运行 `builderharness deploy plan --dir dist --project <ID> --feature <KEY>`。没有关联需求时省略 `--feature`。
3. 让用户核对目标、访问范围和本次产物。授权明确且计划对应时，运行 `builderharness deploy apply --plan <ID>`。
4. 核对返回的固定版本 URL 与回读结果。回读暂时失败时，用同一计划重试核对。产物、绑定或访问范围变更时重出计划。
