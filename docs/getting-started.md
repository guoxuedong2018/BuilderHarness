# Getting started

[中文](./getting-started.zh-CN.md) · [Project overview](../README.md)

Start with `npm run demo` in a cloned repository to explore the review UI.
The steps below add the toolkit to an existing Vite application. The minimal
example assumes `package.json`, `vite.config.js` and `src/` share one project
root.

## Requirements

- Node.js 22 or later and npm for this guide. The manifest currently declares
  Node.js >=18; the CDP media client also uses the global `WebSocket` API, so
  the manifest alone is not the requirement for every optional tool.
- A Vite application (Vite >=5) using React or Vue 2.7.
- Less for the bundled adapter styles.
- Chrome or Chromium for media capture; ffmpeg for video/GIF processing.
  Neither is needed just to add and read comments.

## Install from a source checkout

This path keeps the package, examples and documentation on the same revision.
In the BuilderHarness checkout:

```bash
npm ci
npm pack
```

`npm pack` prints the generated tarball name. Use its absolute path in your
host application, replacing the example path below:

```bash
cd /path/to/your-vite-app
npm install --save-dev /path/to/builderharness-VERSION.tgz less
npx builderharness init --list
npx builderharness init
```

`init` copies templates, project instructions, skills and starter content
configuration. Existing files are preserved unless `--force` is supplied. It
does not wire the Vite plugin or rewrite your application entry point.
Review the generated instructions and `src/config/frs-map.js` for your project.

## Configure Vite

For a React host that already uses `@vitejs/plugin-react`:

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

Merge this configuration with your existing aliases and plugins. The
BuilderHarness source transform must run before the framework transform.
If your project already supplies the required Less variables, keep its token
configuration instead of importing the defaults. See [styling.md](./styling.md).

## Mount the React adapter

Keep **all** imports from `builderharness/react` inside the development branch:

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

`hashRouter()` is for hash-based routing. If your app uses a router library,
provide its `current`, `subscribe`, `href` and `push` bridge instead; the
contract is in [adapters.md](./adapters.md#host-adapter).

Run your application's dev server. The review toolbar should appear; comments
are saved under `docs/reviews/`. Studio provides content status and references
for pages under `docs/kb/`.

## Use the Vue 2 adapter

Keep your existing Vue 2.7 setup and `@vitejs/plugin-vue2`. In the Vite
configuration above, replace the React plugin import with
`import vue from "@vitejs/plugin-vue2";`, replace `react()` with `vue()`, and
use `anchorLoc: "vue"`. Keep the Less configuration.

In a router-enabled root component:

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

The toolkit supplies its React UI dependencies; the Vue application keeps its
existing framework. Additional frameworks need a host adapter.

## Specs, reviews and content

```bash
npx builderharness check-frs
npx builderharness review open
npx builderharness kb-scaffold
npx builderharness kb status
npx builderharness kb check
```

Feature templates live in `docs/templates/`. Populate a feature directory under
`docs/features/`, register its routes in `src/config/frs-map.js`, and check the
result. `check-frs` validates the workspace's feature specs; it does not run
acceptance tests.

Before running `kb-scaffold`, adapt `docs/kb/outline.config.mjs` to the documents
you want. Use `kb context <page-or-route>` to gather content context for an
agent. `review open` lists unresolved comments without failing just because
some are open.

Use `kb ack <page>` only after reviewing the changed claims. It records a
confirmation; a successful command is not evidence that the claims are true.

## Configuration reference

| Setting | Purpose |
| :-- | :-- |
| `root` | Vite application's source root; defaults to `process.cwd()` |
| `frsRegistry` | Module exporting `FRS_REGISTRY`, relative to `root` |
| `anchorLoc` | `"auto"` (default), `"react"`, `"vue"` or `false` |
| `barExtras`, `barLinks` | Host toolbar components and navigation links |
| `reviewsDir` | Override the review-data directory |
| `agentPrompt` | Prefix for prompts copied from Studio |

| Environment variable | Purpose | Default |
| :-- | :-- | :-- |
| `BUILDERHARNESS_ROOT` | Host workspace root for pipeline commands | Detected from the working directory |
| `BUILDERHARNESS_DOCS_DIR` | Documentation directory, relative to the workspace | `docs` |
| `BUILDERHARNESS_WEB_DIR` | Application directory, relative to the workspace | `web` when present, otherwise the workspace root |
| `BUILDERHARNESS_ADAPTER` | Media pipeline adapter | `vue2-vite` |
| `BUILDERHARNESS_PUBLISH_GATEWAY` | Destination adapter path, file URL or package | Unconfigured |
| `BUILDERHARNESS_DOCS_CLI` | Command prefix for the `docs-cli` reference adapter | `docs-cli` |

For a monorepo or an app under `web/`, set `BUILDERHARNESS_ROOT` to the directory
containing `docs/` and `BUILDERHARNESS_WEB_DIR` to the app's relative path.
Pass the app's absolute directory as the Vite plugin's `root`. The workspace
root and the application's source root serve different purposes.

## Check a production build

Run your host application's build. For a standard Vite host with a `build`
script and `dist/` output:

```bash
npm run build
node /path/to/BuilderHarness/scripts/preflight-dist.mjs --dir dist
```

The preflight script is available in the source checkout. At the BuilderHarness
repository root, the equivalent demo check is:

```bash
npm run build:demo
node scripts/preflight-dist.mjs --dir examples/react-tailwind/dist
```

The guarded adapter import should disappear from the production bundle. Your
application's own React dependencies or explicit `builderharness/ui` imports
remain. Preflight scans for known development endpoints, source anchors, local
paths and credential patterns. Inspect its findings and test the host app; this
scan does not replace application or security testing.

## Optional publishing and agent hosts

Publishing requires a destination adapter. Review the
[publishing contract](./publishing.md), configure the destination, then inspect
the plan with `builderharness kb-publish --dry-run` before an outbound action.
The bundled `docs-cli` adapter needs an external CLI and its credentials.

For DSH, Electron or read-only MCP access, use the
[integration guide](../integrations/README.md). These integrations are
experimental and have their own setup requirements.

## Migrate from Bee Press

The BuilderHarness rename changes the public identifiers:

| Previous | Current |
| :-- | :-- |
| Package and imports: `beepress`, `beepress/*` | `builderharness`, `builderharness/*` |
| Vite factory: `beePress()` | `builderHarness()` |
| Root component: `BeePressRoot` | `BuilderHarnessRoot` |
| CLI: `beepress`, `builder-kit`, `bk` | `builderharness` |
| Environment variables: `BEEPRESS_*`, `BUILDER_KIT_*` | `BUILDERHARNESS_*` |
| DSH bundle: `@beepress/dsh-bundle` | `@builderharness/dsh-bundle` |

Update your dependency, imports, scripts and host configuration together. The
current package does not export the previous CLI aliases; do not assume that
changing the display name is sufficient. Review any custom adapter, desktop
profile or automation that refers to the old identifiers.
