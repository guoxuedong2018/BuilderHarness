#!/usr/bin/env node
/**
 * Fail if a dependency or lockfile entry stops resolving from public npm.
 *
 * This is intentionally offline: it checks the manifests and the lockfiles, not
 * the network. It keeps a corporate mirror or a local `link:` dependency from
 * slipping into the published package or a committed lockfile. The in-repo
 * demo's `file:../..` link is intentionally out of scope; it only exists to
 * exercise the local source.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_HOST = "registry.npmjs.org";
const PUBLIC_REGISTRY = `https://${PUBLIC_HOST}`;
const NON_PUBLIC_SPEC = /^(?:file:|link:|portal:|workspace:|git\+|git:|https?:)/;
// Every folder with a committed lockfile. npm reads the project .npmrc only
// from the nearest folder with a package.json, so each one pins its own.
const PROJECTS = ["", "integrations/desktop"];

let failures = 0;
let checked = 0;

function fail(message) {
  failures += 1;
  console.error(`✗ ${message}`);
}

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

for (const dir of PROJECTS) {
  const at = (file) => (dir ? `${dir}/${file}` : file);
  const manifest = JSON.parse(await readFile(path.join(ROOT, at("package.json")), "utf8"));
  const lock = JSON.parse(await readFile(path.join(ROOT, at("package-lock.json")), "utf8"));

  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      checked += 1;
      if (NON_PUBLIC_SPEC.test(spec)) fail(`${at("package.json")} ${field}.${name} uses non-registry spec "${spec}"`);
    }
  }

  for (const [key, info] of Object.entries(lock.packages ?? {})) {
    if (!key) continue;
    if (!info.resolved) {
      if (info.link) fail(`${at("package-lock.json")} ${key} is a link dependency`);
      continue;
    }
    checked += 1;
    try {
      const url = new URL(info.resolved);
      if (url.protocol !== "https:" || url.hostname !== PUBLIC_HOST) {
        fail(`${at("package-lock.json")} ${key} resolves from ${info.resolved}`);
      }
    } catch {
      fail(`${at("package-lock.json")} ${key} has an invalid resolved URL: ${info.resolved}`);
    }
  }

  const npmrc = await readFile(path.join(ROOT, at(".npmrc")), "utf8").catch(() => "");
  const registries = [...npmrc.matchAll(/^\s*(?:@[^:]+:)?registry\s*=\s*(\S+)/gm)].map((m) => m[1].replace(/\/$/, ""));
  checked += 1;
  if (!registries.length) {
    fail(`${at(".npmrc")} must pin registry=${PUBLIC_REGISTRY}`);
  } else {
    for (const registry of registries) {
      if (registry !== PUBLIC_REGISTRY) fail(`${at(".npmrc")} points at ${registry}`);
    }
  }
}

checked += 1;
if (pkg.publishConfig?.registry !== PUBLIC_REGISTRY) {
  fail(`publishConfig.registry must be ${PUBLIC_REGISTRY}`);
}

// Keep the optional runtime profile subject to the same publication rules.
const browser = JSON.parse(await readFile(path.join(ROOT, "packages/browser/package.json"), "utf8"));
for (const [name, spec] of Object.entries(browser.dependencies ?? {})) {
  checked += 1;
  if (NON_PUBLIC_SPEC.test(spec)) fail(`browser.dependencies.${name} uses non-registry spec "${spec}"`);
}
checked += 3;
if (browser.publishConfig?.registry !== PUBLIC_REGISTRY) fail(`browser publishConfig.registry must be ${PUBLIC_REGISTRY}`);
if (browser.version !== pkg.version) fail("browser and base versions must match");
if (Object.keys(pkg.dependencies ?? {}).length) fail("base runtime must have zero dependencies; use an optional capability profile");

if (failures) {
  console.error(`\n${failures} public dependency check(s) failed (${checked} checked).`);
  process.exit(1);
}
console.log(`✓ ${checked} public dependency checks passed.`);
