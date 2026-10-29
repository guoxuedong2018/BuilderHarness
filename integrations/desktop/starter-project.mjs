import fs from "node:fs/promises";
import path from "node:path";

/** Configure only a newly created desktop starter, before its first install. */
export async function configureStarterProject({ root, kitRoot, name }) {
  const pkg = JSON.parse(await fs.readFile(path.join(kitRoot, "scaffold/starter/package.json"), "utf8"));
  pkg.name = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "builderharness-project";
  pkg.dependencies = {
    ...pkg.dependencies,
    builderharness: `file:${kitRoot}`,
    "@builderharness/browser": `file:${path.join(kitRoot, "packages/browser")}`,
  };
  // npm otherwise symlinks these external directories without installing their
  // dependencies. Packing local file dependencies also keeps the toolkit tree immutable.
  await fs.writeFile(path.join(root, ".npmrc"), "install-links=true\n", { flag: "wx" });
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}
