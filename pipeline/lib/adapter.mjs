/**
 * 适配器加载
 * ------------------------------------------------------------------
 * 引擎通过这里拿到技术栈相关的三件事，自己不认识任何前端框架。
 * 接口与自定义方式见 `pipeline/adapters/README.md`。
 *
 *   BUILDERHARNESS_ADAPTER=react-router npx builderharness capture-kb-shots
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEnv } from "./env.mjs";
import { PROJECT_CONFIG, REPO_ROOT } from "./paths.mjs";

export const adapterName = () => readEnv("ADAPTER") || process.env.PROTO_ADAPTER || PROJECT_CONFIG.adapter || "vue2-vite";

const ADAPTERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "adapters",
);

let cached = null;

export async function loadAdapter() {
  if (cached) return cached;
  // `PROTO_ADAPTER` is kept for projects migrating from the pre-0.1 API.
  const name = adapterName();
  const file = name.startsWith(".") || path.isAbsolute(name)
    ? path.resolve(REPO_ROOT, name) : path.join(ADAPTERS_DIR, `${name}.mjs`);
  const mod = await import(pathToFileURL(file).href).catch((error) => {
    throw new Error(`Cannot load capture adapter ${name}: ${error.message}`);
  });
  const adapter = mod.default;
  for (const required of ["stateInjector", "fieldSelector", "resolveRoute"]) {
    if (adapter?.[required] === undefined) {
      throw new Error(`适配器 ${name} 缺少 ${required}，接口见 pipeline/adapters/README.md`);
    }
  }
  cached = adapter;
  return adapter;
}
