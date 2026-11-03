#!/usr/bin/env node
/**
 * check-prototype-syntax：「用了却没引入」检查，以及借不到解析器时的明确降级。
 * 夹具是临时的 React 宿主；有解析器的那份把本仓库的 node_modules 链过去，模拟宿主依赖链上现成的 Babel。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = path.join(ROOT, "pipeline", "check-prototype-syntax.mjs");
// 有解析器的夹具借本仓库装好的 Babel；还没 npm install 时这几条跳过并说明，降级那条照跑
const needsParser = await fs.access(path.join(ROOT, "node_modules", "@babel", "parser")).then(() => false, () => "需要先 npm install（借本仓库的 @babel/parser）");

async function host(files, { parser }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bh-syntax-"));
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module" }));
  if (parser) await fs.symlink(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [CHECK, dir], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

const FILES = {
  "src/ExperimentTable.jsx": "export default function ExperimentTable({ rows }) {\n  return <table>{rows.length}</table>;\n}\n",
  "src/format.js": "export const formatScore = (n) => n.toFixed(1);\n",
  "src/App.jsx": [
    "/* global __APP_VERSION__ */",
    "import { useState } from 'react';",
    "export default function App() {",
    "  const [rows] = useState([]);",
    "  const debug = typeof __BUILD_FLAG__ !== 'undefined' && process.env.NODE_ENV !== 'production';",
    "  return (",
    "    <main data-version={__APP_VERSION__}>",
    "      <ExperimentTable rows={rows} />",
    "      <span>{formatScore(rows.length)}</span>",
    "      {debug && <div>debug</div>}",
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n"),
};

test("reports identifiers and JSX components used without an import", { skip: needsParser }, async () => {
  const dir = await host(FILES, { parser: true });
  try {
    const { code, out } = run(dir);
    assert.equal(code, 1, out);
    assert.match(out, /src\/App\.jsx:8:8 {2}ExperimentTable {2}← src\/ExperimentTable\.jsx 导出了它/);
    assert.match(out, /src\/App\.jsx:9:14 {2}formatScore {2}← src\/format\.js 导出了它/);
    assert.match(out, /未声明的标识符 2 处/);
    // 原生标签、typeof 探测、process.env.NODE_ENV、/* global */ 都不算
    assert.doesNotMatch(out, /__BUILD_FLAG__|__APP_VERSION__|\bprocess\b|\bmain\b/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("passes once the imports are in place", { skip: needsParser }, async () => {
  const fixed = {
    ...FILES,
    "src/App.jsx": FILES["src/App.jsx"].replace(
      "import { useState } from 'react';",
      "import { useState } from 'react';\nimport ExperimentTable from './ExperimentTable.jsx';\nimport { formatScore } from './format.js';",
    ),
  };
  const dir = await host(fixed, { parser: true });
  try {
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /3 个脚本，语法 0 处失败，未声明的标识符 0 处/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("degrades loudly when the host has no parser", async () => {
  const dir = await host({ ...FILES, "src/types.ts": "export type Row = { id: string };\n" }, { parser: false });
  try {
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /⚠ 降级：宿主依赖里借不到 @babel\/parser/);
    assert.match(out, /2 个 \.jsx 连语法也没查/);
    assert.match(out, /未声明的标识符 未检查（降级）/);
    assert.match(out, /1 个 TypeScript 文件不在本检查范围/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("JSX syntax errors fail with a file position", { skip: needsParser }, async () => {
  const dir = await host({ "src/Broken.jsx": "export const Broken = () => <div>;\n" }, { parser: true });
  try {
    const { code, out } = run(dir);
    assert.equal(code, 1, out);
    assert.match(out, /src\/Broken\.jsx\n语法错误:1:/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
