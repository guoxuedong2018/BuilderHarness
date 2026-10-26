# 快速开始

[English](./getting-started.md) · [项目介绍](../README.zh-CN.md)

可先在克隆的仓库中执行 `npm run demo` 体验评审界面。以下步骤将套件接入已有 Vite
应用；最小示例假设 `package.json`、`vite.config.js` 和 `src/` 位于同一个项目根目录。

## 环境要求

- 本指南使用 Node.js 22 或更高版本及 npm。包声明目前为 Node.js >=18，但 CDP 媒体
  客户端还使用全局 `WebSocket` API，包声明并不能代表所有可选工具的运行要求。
- 基于 React 或 Vue 2.7 的 Vite 应用，Vite >=5。
- Less，用于编译适配层自带的样式。
- 媒体采集需要 Chrome 或 Chromium，视频/GIF 处理还需要 ffmpeg；仅添加和查看批注时不需要。

## 从源码安装

这种方式让安装包、示例和文档保持在同一版本。在 BuilderHarness 仓库中运行：

```bash
npm ci
npm pack
```

`npm pack` 会输出生成的压缩包名称。在宿主项目中使用它的绝对路径，替换下面的示例路径：

```bash
cd /path/to/your-vite-app
npm install --save-dev /path/to/builderharness-VERSION.tgz less
npx builderharness init --list
npx builderharness init
```

`init` 复制模板、项目指引、技能和初始内容配置；未指定 `--force` 时保留已有文件。
它不会自动修改 Vite 配置或应用入口。请按项目实际情况调整生成的指引和
`src/config/frs-map.js`。

## 配置 Vite

以下示例适用于已使用 `@vitejs/plugin-react` 的 React 宿主：

```js
// vite.config.js
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { builderHarness } from "builderharness/vite";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL(".", import.meta.url));
const kitRoot = path.dirname(require.resolve("builderharness/package.json"));

export default defineConfig({
  plugins: [
    builderHarness({
      root,
      anchorLoc: "react",
      frsRegistry: "src/config/frs-map.js",
    }),
    react(),
  ],
  css: {
    preprocessorOptions: {
      less: {
        additionalData: `@import "${path.join(kitRoot, "client/core/theme-defaults.less")}";`,
      },
    },
  },
});
```

请合并到已有配置，保留项目自己的别名和插件。BuilderHarness 的源码变换必须位于框架
变换之前。如果项目已经提供所需的 Less 变量，可继续使用现有 Token 配置。
详见[样式说明](./styling.md)。

## 挂载 React 适配层

从 `builderharness/react` 导入的内容应全部放在开发条件分支内：

```jsx
// src/main.jsx
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const root = createRoot(document.getElementById("root"));

if (import.meta.env.DEV) {
  import("builderharness/react").then(({ BuilderHarnessRoot, hashRouter }) => {
    root.render(
      <BuilderHarnessRoot router={hashRouter()}>
        <App />
      </BuilderHarnessRoot>,
    );
  });
} else {
  root.render(<App />);
}
```

`hashRouter()` 适用于 hash 路由。使用路由库时，请提供对应的 `current`、`subscribe`、
`href` 和 `push` 桥接，接口见[宿主适配器](./adapters.md#host-adapter)。

启动应用开发服务器后应出现评审工具栏。批注写入 `docs/reviews/`；Studio 用于查看
`docs/kb/` 中的内容状态与引用。

## 使用 Vue 2 适配层

保留已有的 Vue 2.7 与 `@vitejs/plugin-vue2` 配置。在上面的 Vite 示例中，将 React
插件导入替换为 `import vue from "@vitejs/plugin-vue2";`，将 `react()` 替换为
`vue()`，并设置 `anchorLoc: "vue"`，同时保留 Less 配置。

在使用路由的根组件中：

```vue
<script>
export default {
  data: () => ({ harnessRoot: null }),
  mounted() {
    if (import.meta.env.DEV) {
      import("builderharness/vue2").then(({ BuilderHarnessRoot }) => {
        this.harnessRoot = BuilderHarnessRoot;
      });
    }
  },
};
</script>

<template>
  <component :is="harnessRoot" v-if="harnessRoot">
    <router-view />
  </component>
  <router-view v-else />
</template>
```

套件提供自己的 React UI 依赖，Vue 应用继续使用原有框架。接入其他框架需要宿主适配器。

## 规格、批注与内容

```bash
npx builderharness check-frs
npx builderharness review open
npx builderharness kb-scaffold
npx builderharness kb status
npx builderharness kb check
```

规格模板位于 `docs/templates/`。在 `docs/features/` 下填写功能规格，在
`src/config/frs-map.js` 中登记路由后执行检查。`check-frs` 检查工作区中的功能规格，
并不运行应用的验收测试。

运行 `kb-scaffold` 前先调整 `docs/kb/outline.config.mjs`，声明需要维护的篇目。
`kb context <页面或路由>` 提供供 Agent 使用的内容上下文；`review open` 列出待处理
批注，不会仅因为存在未解决批注而退出失败。

复核变更中的断言之后再运行 `kb ack <页面>`。该命令记录确认操作，执行成功并不能证明
断言本身正确。

## 配置速查

| 参数 | 用途 |
| :-- | :-- |
| `root` | Vite 应用源码根，默认 `process.cwd()` |
| `frsRegistry` | 导出 `FRS_REGISTRY` 的模块，相对 `root` |
| `anchorLoc` | `"auto"`（默认）、`"react"`、`"vue"` 或 `false` |
| `barExtras`、`barLinks` | 宿主工具栏组件与导航链接 |
| `reviewsDir` | 覆盖批注数据目录 |
| `agentPrompt` | Studio 复制给 Agent 的指令前缀 |

| 环境变量 | 用途 | 默认值 |
| :-- | :-- | :-- |
| `BUILDERHARNESS_ROOT` | 管线命令使用的宿主工作区根目录 | 从工作目录探测 |
| `BUILDERHARNESS_DOCS_DIR` | 文档目录，相对工作区根目录 | `docs` |
| `BUILDERHARNESS_WEB_DIR` | 应用目录，相对工作区根目录 | 存在 `web` 时使用它，否则为工作区根目录 |
| `BUILDERHARNESS_ADAPTER` | 媒体管线适配器 | `vue2-vite` |
| `BUILDERHARNESS_PUBLISH_GATEWAY` | 目的地适配器路径、文件 URL 或包名 | 未配置 |
| `BUILDERHARNESS_DOCS_CLI` | `docs-cli` 参考适配器的命令前缀 | `docs-cli` |

对于 monorepo 或位于 `web/` 的应用，将 `BUILDERHARNESS_ROOT` 设置为包含 `docs/`
的目录，将 `BUILDERHARNESS_WEB_DIR` 设置为应用的相对路径；Vite 插件的 `root`
则使用应用的绝对目录。工作区根目录与应用源码根目录用途不同。

## 检查生产构建

执行宿主应用的生产构建。对于包含 `build` 脚本、输出为 `dist/` 的标准 Vite 项目：

```bash
npm run build
node /path/to/BuilderHarness/scripts/preflight-dist.mjs --dir dist
```

preflight 脚本位于源码仓库。在 BuilderHarness 仓库根目录检查演示产物时，使用：

```bash
npm run build:demo
node scripts/preflight-dist.mjs --dir examples/react-tailwind/dist
```

开发分支中的适配层导入应从生产产物中消失；应用自身的 React 依赖或显式导入的
`builderharness/ui` 组件仍会保留。preflight 扫描已知的开发接口、源码坐标、本机路径
和凭据模式。请处理扫描结果并测试应用；该扫描不替代应用测试或安全测试。

## 可选发布与 Agent 宿主

发布需要目的地适配器。请先阅读[发布接口](./publishing.zh-CN.md)、配置目的地，再通过
`builderharness kb-publish --dry-run` 核对计划。内置 `docs-cli` 参考适配器依赖外部 CLI
及其凭据。

DSH、Electron 和只读 MCP 的使用方式见[集成指南](../integrations/README.md)。这些集成
目前是实验性的，需要单独配置。

## 从 Bee Press 迁移

BuilderHarness 更名涉及以下公开标识：

| 旧标识 | 当前标识 |
| :-- | :-- |
| 包与导入：`beepress`、`beepress/*` | `builderharness`、`builderharness/*` |
| Vite 工厂：`beePress()` | `builderHarness()` |
| 根组件：`BeePressRoot` | `BuilderHarnessRoot` |
| CLI：`beepress`、`builder-kit`、`bk` | `builderharness` |
| 环境变量：`BEEPRESS_*`、`BUILDER_KIT_*` | `BUILDERHARNESS_*` |
| DSH 包：`@beepress/dsh-bundle` | `@builderharness/dsh-bundle` |

请一起更新依赖、导入、脚本和宿主配置。当前包不再导出旧 CLI 别名，仅修改展示名称
并不足以完成迁移。还应检查引用旧标识的自定义适配器、桌面配置和自动化脚本。
