import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { builderHarness } from "../../vite.mjs";
import { baseUrl } from "./builderharness.config.json";

const root = fileURLToPath(new URL(".", import.meta.url));
const kitRoot = path.resolve(root, "../..");
const { hostname, port } = new URL(baseUrl);

export default defineConfig({
  root,
  server: { host: hostname, port: Number(port) },
  plugins: [
    builderHarness({
      root,
      anchorLoc: "react",
      promo: true,
      frsRegistry: "src/config/frs-map.js",
      barLinks: [{ label: "UI spec", route: { path: "/ui-spec" } }],
      agentPrompt: "/content-draft",
    }),
    react(),
  ],
  resolve: {
    alias: [
      // In-repo demo: resolve package subpaths to the local source. A published
      // consumer would use `builderharness/react` and `builderharness/ui` directly.
      { find: /^builderharness\/react$/, replacement: path.join(kitRoot, "client/adapters/react.jsx") },
      { find: /^builderharness\/ui$/, replacement: path.join(kitRoot, "ui-spec/impl/react/index.ts") },
    ],
  },
  css: {
    preprocessorOptions: {
      less: {
        // The demo has no host token sheet; use the toolkit's Tool UI Spec defaults.
        additionalData: `@import "${path.join(kitRoot, "client/core/theme-defaults.less")}";\n`,
      },
    },
  },
});
