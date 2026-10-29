import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const local = createRequire(import.meta.url);

/** Optional runtime profile; resolve from its own dependency tree (also under pnpm). */
export function resolveBrowserDependency(spec, root = process.cwd()) {
  try { return local.resolve(spec); } catch { /* Source checkout dev dependencies, or optional profile. */ }
  // The host fallback also supports a vendored/file-linked toolkit outside its node_modules.
  for (const resolver of [local, createRequire(path.join(path.resolve(root), "package.json"))]) {
    try {
      const profile = createRequire(resolver.resolve("@builderharness/browser/package.json"));
      return profile.resolve(spec);
    } catch { /* Try the next supported location. */ }
    try { return resolver.resolve(spec); } catch { /* Host-provided peers, e.g. Vue. */ }
  }
  throw new Error(`BuilderHarness browser dependency ${spec} is missing. Install @builderharness/browser alongside builderharness; the base CLI does not need it.`);
}

export function importBrowserDependency(spec, root) {
  return import(pathToFileURL(resolveBrowserDependency(spec, root)).href);
}
