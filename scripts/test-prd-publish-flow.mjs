#!/usr/bin/env node
/**
 * `builderharness prd` 端到端：首发 → 人在目标端改过 → 出计划写 cloud-edits.md → 修订稿 → 重跑 → 定稿 → --absorb。
 *
 * 目标端是一个落在临时目录里的假适配器（JSON 文件当文档），按 JsonML 的 setBodyChildren / setInline /
 * insert / delete 落补丁，并记下每次提交，好核对「先试跑再提交」。不起原型、不截图（FRS 里没有配图）。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { paraText, tableParagraphs } from "../pipeline/prd-patch-ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "11030900_EXPERIMENT_LIST";

const GATEWAY = `import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const STATE = new URL("./destination.json", import.meta.url);
const LOG = new URL("./destination.log", import.meta.url);
const load = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { docs: {}, seq: 0 }; } };
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
export const destination = { id: "fake", label: "Fake" };
export function setIntent() {}
export function buildPageUrl({ base, viewId, docId }) { return base + "/" + viewId + "/" + docId; }
export async function createDoc() { throw new Error("not used"); }
export async function writeDoc() { throw new Error("not used"); }
export async function createBlankDoc({ title, folderId }) {
  const s = load(); const docId = "doc" + (++s.seq);
  s.docs[docId] = { title, folderId: folderId ?? null, version: 1, body: ["root", {}] };
  save(s); return { docId, url: "https://example.test/" + docId };
}
export async function appendImages() { throw new Error("not used"); }
export async function fetchJsonml(docId) { const d = load().docs[docId]; return { docId, version: d.version, body: d.body }; }
export async function fetchOutline(docId) {
  const out = [];
  (function walk(n) { if (!Array.isArray(n)) return; if (/^(title|h[1-6])$/.test(n[0])) out.push({ id: n[1].id, text: text(n) }); n.slice(2).forEach(walk); })(load().docs[docId].body);
  return out;
}
function text(n) { return typeof n === "string" ? n : Array.isArray(n) ? n.slice(2).map(text).join("") : ""; }
function ids(s, n) {
  if (!Array.isArray(n)) return n;
  if (n[1] && typeof n[1] === "object" && !Array.isArray(n[1]) && n[0] !== "text") n[1] = { ...n[1], id: "b" + (++s.seq) };
  n.slice(2).forEach((c) => ids(s, c));
  return n;
}
function locate(node, id, parent = null) {
  if (!Array.isArray(node)) return null;
  if (node[1]?.id === id && parent) return { parent, at: parent.indexOf(node), node };
  for (const c of node.slice(2)) { const hit = locate(c, id, node); if (hit) return hit; }
  return null;
}
export async function updateJsonml({ docId, opsFile, dryRun = false }) {
  const s = load(); const doc = s.docs[docId];
  const ops = JSON.parse(readFileSync(opsFile, "utf8"));
  appendFileSync(LOG, JSON.stringify({ dryRun, ops: ops.length }) + "\\n");
  const body = structuredClone(doc.body);
  for (const op of ops) {
    if (op.op === "setBodyChildren") { body.splice(2, body.length - 2, ...op.content.map((b) => ids(s, structuredClone(b)))); continue; }
    if (op.op === "delete") { for (const id of op.anchors) { const hit = locate(body, id); if (!hit) throw new Error("no anchor " + id); hit.parent.splice(hit.at, 1); } continue; }
    const hit = locate(body, op.anchor);
    if (!hit) throw new Error("no anchor " + op.anchor);
    if (op.op === "setInline") hit.node.splice(2, hit.node.length - 2, ...structuredClone(op.content));
    else if (op.op === "insert") hit.parent.splice(op.position === "before" ? hit.at : hit.at + 1, 0, ...op.content.map((b) => ids(s, structuredClone(b))));
    else throw new Error("unknown op " + op.op);
  }
  if (dryRun) return { ok: true };
  doc.body = body; doc.version += 1; save(s); return { ok: true };
}
`;

const frsWith = (display) => ({
  key: KEY,
  title: "实验列表",
  status: "confirmed",
  prototype: { entryRoute: "/experiments" },
  background: { problem: ["实验散落在各处，看不出哪些在等评审"], solution: ["一张列表看状态、分数和评审记录"] },
  spec: [
    {
      group: "实验列表-新增状态筛选",
      route: "/experiments",
      points: [{ id: "FP1", name: "状态筛选", origin: "online-page-new", display, ac: ["AC1"] }],
    },
  ],
  acceptance: ["AC1 按状态筛选后列表只剩该状态的实验"],
});

async function project() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bh-prd-flow-"));
  const write = async (file, text) => {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  };
  await write("package.json", JSON.stringify({ name: "fixture", private: true }));
  await write("src/config/frs-map.js", `export const FRS_REGISTRY = [{ key: "EXPERIMENTS", title: "实验", status: "confirmed", routes: ["/experiments"] }];\n`);
  await write("destination.mjs", GATEWAY);
  await write(`docs/features/${KEY}/FLOW.md`, "1. 打开实验列表\n2. 按状态筛选\n");
  return { dir, write };
}

function prd(dir, ...args) {
  const env = { ...process.env, BUILDERHARNESS_ROOT: dir, BUILDERHARNESS_PUBLISH_GATEWAY: "./destination.mjs" };
  delete env.BUILDERHARNESS_DOCS_CLI;
  delete env.BUILDERHARNESS_WEB_DIR;
  const r = spawnSync(process.execPath, [path.join(ROOT, "pipeline", "prd.mjs"), KEY, ...args], { cwd: dir, env, encoding: "utf8" });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, out);
  return out;
}

const state = async (dir) => JSON.parse(await fs.readFile(path.join(dir, "destination.json"), "utf8"));
const docOf = async (dir) => Object.values((await state(dir)).docs)[0];
const NOT_RULES = new Set(["功能点", "参考图", "规则描述", "实验列表-新增状态筛选", "状态筛选", "显示规则：", ""]);
const rules = async (dir) => tableParagraphs((await docOf(dir)).body).map(paraText).filter((t) => !NOT_RULES.has(t) && !t.startsWith("状态筛选"));
const hasMarks = async (dir) => JSON.stringify((await docOf(dir)).body).match(/"strike":true|"bg":"#d9f5d6"/g)?.length ?? 0;

test("prd: publish, human edits, redline, rerun, finalize, absorb", async () => {
  const { dir, write } = await project();
  // 改 FRS 的人只改规则，首发回写的 prdDocId 留着
  const frsFile = path.join(dir, "docs/features", KEY, "FRS.json");
  const writeFrs = async (display) => {
    const prdDocId = await fs.readFile(frsFile, "utf8").then((t) => JSON.parse(t).prdDocId, () => undefined);
    await write(`docs/features/${KEY}/FRS.json`, `${JSON.stringify({ ...frsWith(display), prdDocId }, null, 2)}\n`);
  };
  try {
    // 1. 首发：建在给定目录下，整篇写入，回写 prdDocId
    await writeFrs(["实验列表按状态筛选：运行中、待评审、已通过、失败", "导出按钮在列表为空时置灰", "评审人只能看到分配给自己的实验"]);
    const first = prd(dir, "--yes", "--folder", "team-folder");
    assert.match(first, /已发布/);
    const doc = await docOf(dir);
    assert.equal(doc.folderId, "team-folder");
    const frs = JSON.parse(await fs.readFile(path.join(dir, "docs/features", KEY, "FRS.json"), "utf8"));
    assert.ok(frs.prdDocId);

    // 2. 人在目标端改了第一条
    const s = await state(dir);
    const body = s.docs[frs.prdDocId].body;
    const target = tableParagraphs(body).find((p) => paraText(p).startsWith("实验列表按状态筛选"));
    target.splice(2, target.length - 2, ["text", {}, "实验列表按状态筛选：运行中、待评审、已通过、失败、已取消"]);
    s.docs[frs.prdDocId].version += 1;
    await fs.writeFile(path.join(dir, "destination.json"), JSON.stringify(s));

    // 3. FRS 改了第二条、删了第三条、加了一条
    await writeFrs(["实验列表按状态筛选：运行中、待评审、已通过、失败", "导出按钮在列表为空时隐藏", "实验名称点开进详情页"]);
    const plan = prd(dir);
    assert.match(plan, /这次没有写目标端/);
    assert.match(plan, /目标端里有人改过 1 处/);
    const edits = await fs.readFile(path.join(dir, "docs/prd", KEY, "cloud-edits.md"), "utf8");
    assert.match(edits, /实验列表按状态筛选：运行中、待评审、已通过、失败、已取消/);
    assert.match(edits, /FRS 里没有/);

    // 4. 修订稿：人改过的那条不动；其余划线标红 / 浅绿底
    prd(dir, "--yes", "--redline");
    assert.ok((await hasMarks(dir)) >= 3);
    assert.ok((await rules(dir)).includes("实验列表按状态筛选：运行中、待评审、已通过、失败、已取消"));

    // 5. 原样重跑修订稿：没有要发的
    assert.match(prd(dir, "--yes", "--redline"), /没有要发的/);

    // 6. 定稿：划线的删掉、底色去掉，人改的那条仍保留
    prd(dir, "--yes");
    assert.equal(await hasMarks(dir), 0);
    assert.deepEqual((await rules(dir)).sort(), [
      "实验列表按状态筛选：运行中、待评审、已通过、失败、已取消",
      "导出按钮在列表为空时隐藏",
      "实验名称点开进详情页",
    ].sort());

    // 7. 人决定按 FRS 来：--absorb 后人改的那条换成 FRS 的说法，cloud-edits.md 清掉
    const absorbed = prd(dir, "--yes", "--absorb");
    assert.match(absorbed, /底稿换成目标端第/);
    assert.ok((await rules(dir)).includes("实验列表按状态筛选：运行中、待评审、已通过、失败"));
    await assert.rejects(fs.access(path.join(dir, "docs/prd", KEY, "cloud-edits.md")));

    // 每次补丁都先试跑、再提交
    const log = (await fs.readFile(path.join(dir, "destination.log"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    for (let i = 0; i < log.length; i += 2) {
      assert.equal(log[i].dryRun, true);
      assert.equal(log[i + 1].dryRun, false);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("prd: temp image paragraphs left by an interrupted run are cleaned up", async () => {
  const { dir, write } = await project();
  try {
    await write(`docs/features/${KEY}/FRS.json`, `${JSON.stringify(frsWith(["导出按钮在列表为空时置灰"]), null, 2)}\n`);
    prd(dir, "--yes");
    const frs = JSON.parse(await fs.readFile(path.join(dir, "docs/features", KEY, "FRS.json"), "utf8"));
    // 上一次追图后失败：文末留下一段临时图，pending-images.json 记着它
    const s = await state(dir);
    s.docs[frs.prdDocId].body.push(["p", { id: "stray1" }, ["image", { imageId: `img-${frs.prdDocId}`, width: 10, height: 10 }]]);
    await fs.writeFile(path.join(dir, "destination.json"), JSON.stringify(s));
    await write(`docs/prd/${KEY}/pending-images.json`, JSON.stringify(["stray1"]));

    assert.match(prd(dir), /文末有 1 段上次追图留下的临时图/);
    prd(dir, "--yes");
    assert.doesNotMatch(JSON.stringify((await docOf(dir)).body), /stray1/);
    await assert.rejects(fs.access(path.join(dir, "docs/prd", KEY, "pending-images.json")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
