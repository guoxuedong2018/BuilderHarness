#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "builderharness.mjs");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "builderharness-scaffold-"));

function init(args) {
  const result = spawnSync(process.execPath, [BIN, "init", "--scaffold", "--target", tmp, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const list = init(["--list"]);
  assert.match(list, /docs\/templates\/FRS\.json/);
  assert.match(list, /\.agent\/skills\/prd-author\/SKILL\.md/);
  assert.doesNotMatch(list, /scaffold\/README\.md/);

  const first = init([]);
  assert.match(first, /复制 27 个/);
  const frs = await fs.readFile(path.join(tmp, "docs", "templates", "FRS.json"), "utf8");
  assert.equal(JSON.parse(frs).key, "MMDDHHMM_MODULE_NAME");
  assert.ok(await fs.stat(path.join(tmp, "AGENTS.md")));
  assert.ok(await fs.stat(path.join(tmp, "src", "config", "frs-map.js")));
  assert.ok(await fs.stat(path.join(tmp, ".gitignore")));

  await fs.writeFile(path.join(tmp, "docs", "templates", "FRS.json"), "keep me");
  const second = init([]);
  assert.match(second, /跳过已存在 27 个/);
  assert.equal(await fs.readFile(path.join(tmp, "docs", "templates", "FRS.json"), "utf8"), "keep me");

  init(["--force", "--only", "docs/templates"]);
  assert.equal(JSON.parse(await fs.readFile(path.join(tmp, "docs", "templates", "FRS.json"), "utf8")).key, "MMDDHHMM_MODULE_NAME");

  console.log("✓ scaffold checks passed");
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
