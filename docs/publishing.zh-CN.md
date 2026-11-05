# 内容发布目的地接入

## 先分清门禁与下游交付

BuilderHarness 的核心环是 **规格 ↔ 同源可跑原型 ↔ 评审**。发布位于这个门禁之后，不是产品品类：

| 能力 | 解决的问题 | 产物 |
| :-- | :-- | :-- |
| **Review** | 在运行中的原型上圈选、批注、定位源码 | 评审意见、批注锚点、回审状态 |
| **Studio** | 把同一事实源生产成下游交付物 | 操作手册、上线通知、消息卡片、宣传图文、截图/录屏/GIF/视频 |

Studio **不是文档编辑器，也不是 CMS**。它是一条内容生产管线：

```text
原型源码 / 路由 / DOM / FRS
        ↓  Agent 读取、核对、生成
Markdown 叙述 + 事实引用 + 媒体配方
        ↓  Chrome/CDP 截图、ffmpeg 录屏/GIF/合成
内容 Bundle（正文 + 资产 + 事实 + 元数据）
        ↓  人检查、确认
统一发布网关（计划 / 确认 / 状态 / 幂等）
        ↓
外部载体：飞书文档 / 腾讯文档 / 内部内容平台 / IM 卡片 ...
```

**发布目的地不是“内容从哪里来”，而是“内容最终投递到哪个载体”。** 载体负责租户、权限、文档空间、卡片渲染、消息投递；BuilderHarness 负责内容真源、生产、校验、评审和发布流程。

## 发布的不只是长文

同一份内容 Bundle 可以产出不同形态：

| 资源形态 | 例子 | 典型目的地 |
| :-- | :-- | :-- |
| 长文 | 操作手册、功能说明、PRD、上线公告 | 飞书文档、腾讯文档、内部 Wiki |
| 短通知 | 上线通知、版本变更、风险提醒 | 飞书/企微消息、邮件 |
| 消息卡片 | 带按钮、字段、跳转的结构化卡片 | 飞书机器人、企微应用、内部 IM |
| 视觉物料 | 截图、GIF、录屏、封面图、宣传图 | 文档附件、内容平台、CDN |
| Bundle | 长文 + 图 + 视频 + 事实引用 + 版本 | 任意支持组合内容的载体 |

内容 Bundle 至少应包含：

```ts
interface ContentBundle {
  id: string;
  kind: "document" | "notification" | "message-card" | "campaign";
  title: string;
  blocks?: unknown;        // 长文/结构化正文，由渲染器或载体决定
  card?: unknown;          // 消息卡片的结构化 payload
  assets?: Array<{
    kind: "image" | "gif" | "video";
    path: string;
    caption?: string;
  }>;
  facts?: Array<{ basis: string; value: string }>;
  metadata?: {
    audience?: string;
    channel?: string;
    version?: string;
    sourcePage?: string;
  };
}
```

当前仓库内置的 `docs-cli` 适配器只覆盖**长文文档**这一种资源形态，它是参考实现，不是发布模型的全部。消息卡片、短通知、视频物料应由目的地适配器按自己的能力实现，不能硬塞成 Markdown 页面。

## 统一接入层

`pipeline/lib/publish-gateway.mjs` 负责加载宿主配置的目的地适配器。核心发布流程只依赖稳定动作：

1. **plan**：这次要发布哪些资源、哪些内容变了、哪些会跳过；
2. **confirm**：用户确认外发；
3. **publish/update**：新建或更新目的地资源；
4. **state**：记录外部 id、URL、内容指纹和锚点，支持断点续跑；
5. **preview**：在真实发布前展示目标端计划。

目的地适配器负责：

- 认证、租户/空间选择、权限校验；
- 把 Bundle 渲染成目标平台的格式；
- 文档、卡片、图片/视频等资源的创建与更新；
- 返回外部 id、URL 和可再次更新的引用；
- 把平台错误翻译成可操作的信息。

适配器运行在 Vite dev server 的 Node 进程里，不进入浏览器产物，也不进入生产构建。

## 怎么接入

### 1. 选择接入方式

| 方式 | 适合场景 | 配置 |
| :-- | :-- | :-- |
| 内置 `docs-cli` 参考适配器 | 已有兼容的文档 CLI | `BUILDERHARNESS_PUBLISH_GATEWAY=docs-cli` |
| 宿主项目内的适配器文件 | 内部 Wiki、CMS、业务 API、IM 机器人 | `BUILDERHARNESS_PUBLISH_GATEWAY=./tools/publish-gateway.mjs` |
| 独立 npm 包 | 多个原型共享同一套发布能力 | `BUILDERHARNESS_PUBLISH_GATEWAY=@acme/builderharness-publish` |

### 2. 在宿主项目里创建适配器

建议放在：

```text
my-prototype/
├── tools/
│   └── publish-gateway.mjs
├── docs/
│   └── kb/
└── package.json
```

不要把适配器放进 `docs/kb`，也不要让浏览器代码 import 它。Token 只从服务端环境变量或本机密钥工具读取。

### 3. 实现核心方法

当前长文发布链路需要这 5 个方法：

| 方法 | 做什么 | 关键约束 |
| :-- | :-- | :-- |
| `createDoc` | 第一次发布，新建一页 | **不要自动重试**；超时不代表没创建 |
| `writeDoc` | 更新已发布页面 | 覆盖是用户确认过的动作 |
| `fetchOutline` | 返回标题/大纲 `[{ id, text }]` | `id` 用于页内锚点 |
| `updateJsonml` | 应用核心生成的结构化操作 | `dryRun: true` 只校验、不落盘 |
| `buildPageUrl` | 把不透明 id 转成页面 URL | 返回的 URL 会写进 `_published.json` 并用于跨页链接 |

可选方法：

- `destination`：给内容检查台显示目的地名称、能力和说明；
- `setIntent`：告知适配器“用户已确认这次外发”；
- PRD 管线还需要 `createBlankDoc`、`appendImages`、`fetchJsonml`；不需要 PRD 时可以不实现。`createBlankDoc` 可能收到 `folderId`（来自 `prd --folder`），没有目录概念的目标端可以忽略；已发布 PRD 的补丁按每批最多 50 个操作提交（相邻删除先合并），每批先 `dryRun`；
- 未来消息卡片/视觉物料可以在适配器里增加 `publishResource({ resource, target })`，返回外部引用；核心只依赖统一动作，不依赖某个平台的字段。

完整 TypeScript 接口见 [publishing.md](./publishing.md)。

### 4. 处理内容源

核心会把长文页面打包成 `Source` 交给适配器：

```ts
type Source =
  | { kind: "file"; path: string }  // 无图页面：渲染后的 Markdown 临时文件
  | { kind: "zip"; path: string };  // 有图页面：Markdown + 相对图片，保留目录层级
```

适配器负责把 `file` 读成文本，或把 `zip` 上传给目标服务。**不要**在核心流程里拼 CLI 参数、加签名或处理登录。

视觉物料由 Agent/管线先落成普通文件；适配器可以把它们作为文档附件上传，也可以发布到目标平台的素材库或 CDN。

### 5. 配置并重启 dev server

环境变量必须设置在启动 Vite 的进程上：

```bash
BUILDERHARNESS_PUBLISH_GATEWAY=./tools/publish-gateway.mjs npm run dev
```

配置后需要重启 dev server；修改适配器文件本身通常由 Node 重新加载，但环境变量不会自动更新。

### 6. 验证

```bash
# 1. 看目的地是否被识别
curl http://localhost:5173/__builder_studio/publish-config

# 2. 只算发布计划，不写目标端（首次需要根节点和地址前缀）
npx builderharness kb-publish --root <目标根 id> --doc-base https://your-destination.example --dry-run

# 3. 在内容检查台打开「发布」，先看计划，再确认
```

第一次真实发布后，`docs/kb/_published.json` 会记录根节点、页面 id、URL 和内容指纹；之后不再需要每次传 `--root` / `--doc-base`。

## 一个 HTTP API 适配器示例

```js
// tools/publish-gateway.mjs
import { readFile } from "node:fs/promises";

export const destination = {
  id: "internal-wiki",
  label: "内部内容平台",
  description: "通过内部 API 发布长文和附件。",
  capabilities: ["document", "image", "video"],
};

const base = process.env.CONTENT_API_BASE;
const token = process.env.CONTENT_API_TOKEN;

async function request(pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Content API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function createDoc({ title, source, parentViewId }) {
  // 这里只演示 file；zip 请按目标 API 要求上传压缩包或解压后上传图片。
  const content = await readFile(source.path, "utf8");
  const page = await request("/pages", { title, parentId: parentViewId, content });
  return { docId: page.id, viewId: page.id, url: page.url };
}

export async function writeDoc({ docId, source }) {
  const content = await readFile(source.path, "utf8");
  await request(`/pages/${docId}/content`, { content });
}

export async function fetchOutline(docId) {
  const page = await request(`/pages/${docId}/outline`, {});
  return page.items;
}

export async function updateJsonml({ docId, opsFile, dryRun }) {
  const ops = JSON.parse(await readFile(opsFile, "utf8"));
  return request(`/pages/${docId}/ops`, { ops, dryRun: !!dryRun });
}

export function buildPageUrl({ base, viewId, docId }) {
  return `${base.replace(/\/+$/, "")}/${viewId}/${docId}`;
}
```

消息卡片适配器不应该把卡片伪装成长文。它可以直接实现：

```js
export async function publishResource({ resource, target }) {
  if (resource.kind === "message-card") {
    const card = await request("/im/cards", { ...resource.card, target });
    return { externalId: card.id, url: card.url };
  }
  throw new Error(`Unsupported resource kind: ${resource.kind}`);
}
```

核心未来只需要统一调用 `publishResource`，不需要知道飞书、腾讯文档或内部平台的字段差异。

## 核心优势与定位

下游交付物的生产不是“让模型凭空写一篇文章”，而是把 Agent 放进**可验证的原型环境**：

1. **Agent 读源码和页面，而不是猜界面。** 路由、组件、文案、交互都能从源码和 DOM 得到；操作步骤可以对照真实页面。
2. **媒体是构建产物，不是截图附件。** Chrome/CDP 负责截图和录屏，ffmpeg 负责 GIF/视频/合成；配方可复现，画面变化可以比较。
3. **事实有出处，内容会过期提醒。** 正文里的 `frs:` / `code:` 引用会在上游变化时进入待确认队列；不是发出去就结束。
4. **人只做判断，不做搬运。** 评审者看到变更、依据和影响，确认“仍然成立”或让 Agent 修改；系统负责状态、重试和发布。
5. **同一份内容可以多渠道投递。** 长文、上线通知、消息卡片、宣传图文共用内容真源和事实层，目的地适配器只负责载体差异。
6. **内容是可版本化的源文件。** Markdown、媒体配方、引用和评审锁都在仓库里，能 diff、能回滚、能被 Agent 继续编辑。

一句话定位：

> **BuilderHarness 是 Product Builder 的 Agent Harness：规格门禁 + 同源原型真相源 + 回审放行。** 评审放行之后，同一事实源上的手册、上线通知与素材通过统一接入层投递到任意内容载体。

它替代的不是通用文档编辑器，而是“人工从原型里抄步骤、截图、拼长文、再复制到各个平台”的整条低效链路。

## 故障排查

| 现象 | 检查 |
| :-- | :-- |
| UI 显示「发布（未配置）」 | 是否设置了 `BUILDERHARNESS_PUBLISH_GATEWAY`，是否重启了 dev server |
| `加载发布目标失败` | 相对路径是否相对宿主项目根；包名是否安装在宿主 `node_modules` |
| `缺少 createDoc、writeDoc…` | 对照接口补齐核心方法 |
| `发布计划没算出来` | 先看适配器抛出的错误，再用 `kb-publish --dry-run` 复现 |
| `发布确认已过期` | 重新打开发布面板，重新算一次计划 |
| 首次提示没有根节点/地址前缀 | 第一次带 `--root` 和 `--doc-base`，之后从 `_published.json` 读取 |
| 重复创建页面 | 检查 `createDoc` 是否在超时后被自动重试；核心不会替你重试创建 |
| 跨页链接打不开 | 检查 `buildPageUrl` 返回的路径和 `anchors` 的 id 是否与目标端一致 |
| 卡片/视频无法发布 | 当前内置适配器只覆盖长文；为对应资源实现适配器方法，不要把卡片塞进 Markdown |

## 参考适配器

只使用内置 `docs-cli` 参考实现时：

```bash
BUILDERHARNESS_PUBLISH_GATEWAY=docs-cli \
BUILDERHARNESS_DOCS_CLI="docs-cli" \
npm run dev
```

只设置 `BUILDERHARNESS_DOCS_CLI=...` 也会自动选用内置适配器；新接入建议显式设置 `BUILDERHARNESS_PUBLISH_GATEWAY`。
