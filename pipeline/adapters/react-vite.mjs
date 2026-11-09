import { readdir } from "node:fs/promises";
import path from "node:path";
import { PROJECT_CONFIG, WEB_DIR } from "../lib/paths.mjs";

// Conservative default for React SPAs with a shared application shell.
// A host with code-split routes can supply an adapter with a finer dependency map.
export default {
  stateInjector: "",
  fieldSelector: null,
  async resolveRoute(repoRoot) {
    const files = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) files.push(path.relative(repoRoot, file));
      }
    }
    await walk(path.resolve(WEB_DIR, PROJECT_CONFIG.sourceDir ?? "src"));
    await walk(path.join(WEB_DIR, "public"));
    if (!files.length) return [];
    return files.concat(["index.html", "package.json", "vite.config.js"].map((file) => path.relative(repoRoot, path.join(WEB_DIR, file))));
  },
};
