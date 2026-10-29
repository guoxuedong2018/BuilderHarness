#!/usr/bin/env node
/**
 * 把 BuilderHarness scaffold 复制进宿主项目。
 *
 *   npx builderharness init
 *   npx builderharness init --list
 *   npx builderharness init --force
 *   npx builderharness init --only docs
 *
 * 已存在的文件默认不覆盖；只有 --force 才覆盖。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { KIT_ROOT, PROJECT_ROOT } from "./lib/paths.mjs";

const SCAFFOLD_DIR = path.join(KIT_ROOT, "scaffold");
const TEMPLATES_DIR = path.join(KIT_ROOT, "docs", "templates");
const ROOTS = ["docs", "src", ".agent", "AGENTS.md", "CLAUDE.md", ".gitignore"];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const listOnly = flag("--list");
const force = flag("--force");
const only = valueOf("--only")?.replace(/^\/+|\/+$/g, "");
const target = path.resolve(valueOf("--target") || PROJECT_ROOT);

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function included(rel) {
  const first = rel.split(path.sep)[0];
  if (!ROOTS.includes(first)) return false;
  if (!only) return true;
  return rel === only || rel.startsWith(`${only}${path.sep}`);
}

const entries = [
  ...(await walk(SCAFFOLD_DIR)).map((rel) => ({
    rel: rel === "gitignore" ? ".gitignore" : rel,
    from: path.join(SCAFFOLD_DIR, rel),
  })),
  ...(await walk(TEMPLATES_DIR, path.join(KIT_ROOT, "docs"))).map((rel) => ({
    rel: path.join("docs", rel),
    from: path.join(KIT_ROOT, "docs", rel),
  })),
];
const seen = new Set();
const files = entries
  .filter(({ rel }) => included(rel))
  .filter(({ rel }) => (seen.has(rel) ? false : seen.add(rel)))
  .sort((a, b) => a.rel.localeCompare(b.rel));
if (files.length === 0) {
  console.error(`没有匹配的 scaffold 文件：${only ? `--only ${only}` : "scaffold 为空"}`);
  process.exit(1);
}

if (listOnly) {
  console.log(`Scaffold → ${target}`);
  for (const { rel } of files) console.log(`  ${rel}`);
  process.exit(0);
}

let copied = 0;
let skipped = 0;
for (const { rel, from } of files) {
  const to = path.join(target, rel);
  try {
    await fs.access(to);
    if (!force) {
      skipped += 1;
      continue;
    }
  } catch {
    // Missing target: copy it.
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  copied += 1;
}

console.log(`BuilderHarness scaffold → ${target}`);
console.log(`  复制 ${copied} 个，跳过已存在 ${skipped} 个${force ? "（--force）" : ""}`);
if (skipped && !force) console.log("  需要覆盖时加 --force，或先手动合并。");
