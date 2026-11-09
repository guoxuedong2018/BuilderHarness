# 原型部署

先用宿主命令构建，再从项目根目录运行。

```bash
builderharness preflight --dir dist
export BUILDERHARNESS_DEPLOY_GATEWAY=./tools/deploy.mjs
builderharness deploy plan --project your-project --dir dist --feature FEATURE_KEY
builderharness deploy apply --plan <确认后的计划 ID>
```

`--feature` 可省略。关联需求时，明确标记为阻断的待决问题和验收用例必须处理完成。预检默认扫描开发接口、源码定位、密钥和源映射。可重复用 `--deny REGEX` 补宿主的禁发数据模式。只传构建目录。

宿主适配器通过默认导出提供三个异步方法：

| 方法 | 约定 |
| --- | --- |
| `describe()` | 从实际部署绑定取得 `{ project, target, access }`。不要把用户传来的项目名原样返回。 |
| `upload({ dir, binding, artifactHash, idempotencyKey })` | 上传经过校验的临时快照。相同幂等键复用同次部署，返回 `{ version, fixedUrl }`。 |
| `readVersion({ binding, version, fixedUrl })` | 从固定版本或托管端回读 `{ version, artifactHash }`。回读值必须来自已部署产物或托管回执。 |

部署计划会绑定适配器、目标、访问范围和产物指纹。配置或产物变化后重出计划并确认。上传成功而回读失败时，用同一计划重试核对。最终回执在 `.builderharness/deploy/`，只用于当前项目。回滚由托管平台执行。

访问范围和目标由用户确认。发布工具的鉴权由宿主负责，凭据从本机环境或凭据存储读取。
