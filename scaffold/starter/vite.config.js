import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { builderHarness } from "builderharness/vite";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL(".", import.meta.url));
const kitRoot = path.dirname(require.resolve("builderharness/package.json"));
const frsRegistry = "src/config/frs-map.js";

export default defineConfig({
  plugins: [
    builderHarness({
      root,
      anchorLoc: "react",
      frsRegistry: existsSync(path.join(root, frsRegistry)) ? frsRegistry : undefined,
    }),
    react(),
  ],
  css: {
    preprocessorOptions: {
      less: { additionalData: `@import "${path.join(kitRoot, "client/core/theme-defaults.less")}";\n` },
    },
  },
});
