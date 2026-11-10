import { readdir } from "node:fs/promises";
import path from "node:path";
import { PROJECT_CONFIG, WEB_DIR } from "../lib/paths.mjs";

export async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

// Conservative default for React SPAs with a shared application shell.
// A host with code-split routes can supply an adapter with a finer dependency map.
export default {
  stateInjector: "",
  fieldSelector: null,
  async resolveRoute(repoRoot) {
    const files = await listSourceFiles(path.resolve(WEB_DIR, PROJECT_CONFIG.sourceDir ?? "src"));
    files.push(...await listSourceFiles(path.join(WEB_DIR, "public")));
    if (!files.length) return [];
    files.push(...["index.html", "package.json", "vite.config.js"].map((file) => path.join(WEB_DIR, file)));
    return files.map((file) => path.relative(repoRoot, file));
  },
};
