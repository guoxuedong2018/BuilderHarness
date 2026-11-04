#!/usr/bin/env node
/**
 * PRD 增量补丁的回流链路：修订稿 → 重跑 → 定稿，人改过的不覆盖、删掉的不加回。
 *
 * 不连任何目标端：用一个最小的 JsonML 应用器把补丁落到内存里的正文上，
 * 每一步都按 prd.mjs 的做法重新取底稿（发布后目标端功能点表的段落文本）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REDLINE_DELETE,
  REDLINE_INSERT,
  batchOps,
  cloudEdits,
  cloudEditsReport,
  nextBase,
  paraText,
  patchOps,
  tableParagraphs,
} from "../pipeline/prd-patch-ops.mjs";

let seq = 0;
const P = (text, attrs = {}, id = `p${++seq}`) => ["p", { id }, ["text", attrs, text]];
const cell = (...paras) => ["tc", {}, ...paras];
const row = (...cells) => ["tr", {}, ...cells];
const doc = (...rows) => ["root", {}, ["table", {}, ...rows]];
const oneCell = (...paras) => doc(row(cell(...paras)));
const texts = (body) => tableParagraphs(body).map(paraText);
const baseOf = (body) => texts(body);
const runs = (body) => tableParagraphs(body).flatMap((p) => p.slice(2).filter((c) => c[0] === "text"));

/** 把补丁落到正文上（目标端的最小替身）：setInline 换行内内容，insert 插到锚点前后，delete 删段落 */
function apply(body, ops) {
  const next = structuredClone(body);
  const locate = (id, node = next, parent = null) => {
    if (!Array.isArray(node)) return null;
    if (node[1]?.id === id && parent) return { parent, at: parent.indexOf(node), node };
    for (const child of node.slice(2)) {
      const hit = locate(id, child, node);
      if (hit) return hit;
    }
    return null;
  };
  for (const op of ops) {
    if (op.op === "setInline") {
      const { node } = locate(op.anchor);
      node.splice(2, node.length - 2, ...structuredClone(op.content));
    } else if (op.op === "insert") {
      const { parent, at } = locate(op.anchor);
      const blocks = op.content.map((b) => [b[0], { ...b[1], id: `n${++seq}` }, ...structuredClone(b.slice(2))]);
      parent.splice(op.position === "before" ? at : at + 1, 0, ...blocks);
    } else if (op.op === "delete") {
      for (const id of op.anchors) {
        const { parent, at } = locate(id);
        parent.splice(at, 1);
      }
    } else throw new Error(`unknown op ${op.op}`);
  }
  return next;
}

// 示例原型（react-tailwind）里实验列表的几条规则：上一版发出去的，和 FRS 改过之后的
const published = () =>
  oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败"),
    P("导出按钮在列表为空时置灰"),
    P("评审人只能看到分配给自己的实验"),
    P("列表每 30 秒自动刷新"),
  );
const revised = () =>
  oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败"),
    P("导出按钮在列表为空时隐藏"),
    P("列表每 30 秒自动刷新"),
    P("新建实验后跳到该实验的详情页"),
  );

test("paraText counts strikethrough as text and merges adjacent struck runs", () => {
  const node = ["p", { id: "x" }, ["text", { strike: true }, "旧的"], ["text", { strike: true, bold: true }, "说法"], ["text", {}, " 新的 说法"]];
  assert.equal(paraText(node), "~~旧的说法~~新的说法");
  assert.equal(paraText(["p", {}, ["text", { color: "#000", bold: true }, "颜色 加粗不算"]]), "颜色加粗不算");
});

test("redline → rerun → finalize round trip", () => {
  const v1 = published();
  const local = revised();

  // 1. 修订稿：原文划线标红留原位，改写紧跟其后、浅绿底；删掉的划线；新增的浅绿底
  const draft = patchOps({ localBody: local, cloudBody: v1, base: baseOf(v1), redline: true });
  assert.deepEqual(draft.summary, { change: 1, insert: 1, delete: 1, unmark: 0 });
  const v2 = apply(v1, draft.ops);
  assert.deepEqual(texts(v2), [
    "实验列表按状态筛选：运行中、待评审、已通过、失败",
    "~~导出按钮在列表为空时置灰~~",
    "导出按钮在列表为空时隐藏",
    "~~评审人只能看到分配给自己的实验~~",
    "列表每30秒自动刷新",
    "新建实验后跳到该实验的详情页",
  ]);
  const struck = runs(v2).filter((r) => r[1].strike);
  assert.ok(struck.every((r) => r[1].color === REDLINE_DELETE.color));
  assert.equal(runs(v2).filter((r) => r[1].bg === REDLINE_INSERT.bg).length, 2);

  // 2. 原样重跑修订稿：不重复划线、不重复插入
  const again = patchOps({ localBody: local, cloudBody: v2, base: baseOf(v2), redline: true });
  assert.deepEqual(again.ops, []);

  // 3. 修订稿里还没定稿的新段落，FRS 又改了：直接换掉浅绿底那段，不再划线
  const local2 = oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败"),
    P("导出按钮在列表为空时隐藏，并提示先新建实验"),
    P("列表每 30 秒自动刷新"),
    P("新建实验后跳到该实验的详情页"),
  );
  const retouch = patchOps({ localBody: local2, cloudBody: v2, base: baseOf(v2), redline: true });
  assert.equal(retouch.ops.length, 1);
  assert.equal(retouch.ops[0].op, "setInline");
  assert.equal(retouch.ops[0].content[0][1].bg, REDLINE_INSERT.bg);

  // 4. 人确认后不带 redline 再发：划线的删掉、浅绿底去掉
  const final = patchOps({ localBody: local, cloudBody: v2, base: baseOf(v2) });
  assert.equal(final.summary.delete, 2);
  assert.equal(final.summary.unmark, 2);
  const v3 = apply(v2, final.ops);
  assert.deepEqual(texts(v3), texts(local));
  assert.ok(runs(v3).every((r) => !r[1].strike && !r[1].bg));

  // 5. 定稿之后再跑一次：没有要发的
  assert.deepEqual(patchOps({ localBody: local, cloudBody: v3, base: baseOf(v3) }).ops, []);
});

test("removing the strikethrough in the redline keeps that paragraph", () => {
  const v1 = published();
  const local = revised();
  const v2 = apply(v1, patchOps({ localBody: local, cloudBody: v1, base: baseOf(v1), redline: true }).ops);
  const base2 = baseOf(v2);

  // 人在目标端里把「评审人……」的删除线去掉：这条要留
  const kept = structuredClone(v2);
  const para = tableParagraphs(kept).find((p) => paraText(p) === "~~评审人只能看到分配给自己的实验~~");
  para[2] = ["text", {}, "评审人只能看到分配给自己的实验"];

  const final = patchOps({ localBody: local, cloudBody: kept, base: base2 });
  assert.deepEqual(final.kept, ["评审人只能看到分配给自己的实验"]);
  const v3 = apply(kept, final.ops);
  assert.ok(texts(v3).includes("评审人只能看到分配给自己的实验"));
  assert.ok(!texts(v3).some((t) => t.includes("~~")));

  // 改动逐条列进 cloud-edits：FRS 里没有这条，等人决定同步回去还是不要
  const edits = cloudEdits({ cloudBody: kept, base: base2, localBody: local });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].type, "change");
  assert.equal(edits[0].before, "~~评审人只能看到分配给自己的实验~~");
  assert.equal(edits[0].after, "评审人只能看到分配给自己的实验");
  assert.equal(edits[0].synced, false);
  const report = cloudEditsReport(edits, { version: 7 });
  assert.match(report, /目标端第 7 版/);
  assert.match(report, /FRS 里没有/);
  assert.match(report, /--absorb/);
});

test("human edits are kept and human deletions are not added back", () => {
  const v1 = published();
  const base = baseOf(v1);
  // 人在目标端改了第一条、删了最后一条
  const edited = oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败、已取消"),
    P("导出按钮在列表为空时置灰"),
    P("评审人只能看到分配给自己的实验"),
  );
  // FRS 把第一条改成别的说法、最后一条还在
  const local = oneCell(
    P("实验列表按状态筛选，默认看运行中"),
    P("导出按钮在列表为空时置灰"),
    P("评审人只能看到分配给自己的实验"),
    P("列表每 30 秒自动刷新"),
  );
  const r = patchOps({ localBody: local, cloudBody: edited, base });
  assert.deepEqual(r.ops, []);
  assert.equal(r.kept.length, 1);
  assert.deepEqual(r.removed, ["列表每30秒自动刷新"].map((t) => t.replace(/\s/g, "")));

  const edits = cloudEdits({ cloudBody: edited, base, localBody: local });
  assert.deepEqual(edits.map((e) => e.type).sort(), ["change", "delete"]);
  assert.equal(edits.find((e) => e.type === "delete").synced, false);

  // --absorb：底稿换成目标端现状，按 FRS 改写、把删掉的那条补回来
  const absorbed = patchOps({ localBody: local, cloudBody: edited, base: baseOf(edited) });
  assert.equal(absorbed.summary.change, 1);
  assert.equal(absorbed.summary.insert, 1);
});

test("human edits stay protected across publishes until --absorb (nextBase)", () => {
  const v1 = published();
  const base1 = baseOf(v1);
  // 人改了第一条
  const edited = structuredClone(v1);
  tableParagraphs(edited)[0][2] = ["text", {}, "实验列表按状态筛选：运行中、待评审、已通过、失败、已取消"];
  // 第一次补丁：人改的不动，其余照 FRS
  const local = revised();
  const p1 = patchOps({ localBody: local, cloudBody: edited, base: base1 });
  const v2 = apply(edited, p1.ops);
  const base2 = nextBase({ base: base1, beforeBody: edited, afterBody: v2, ops: p1.ops, localBody: local });
  // 底稿里记的是原文，不是人改后的样子
  assert.ok(base2.includes("实验列表按状态筛选：运行中、待评审、已通过、失败"));
  assert.ok(!base2.includes("实验列表按状态筛选：运行中、待评审、已通过、失败、已取消"));
  // 第二次：仍认得出是人改的，不覆盖，也不在别处补一条 FRS 的说法
  const p2 = patchOps({ localBody: local, cloudBody: v2, base: base2 });
  assert.deepEqual(p2.ops, []);
  assert.equal(cloudEdits({ cloudBody: v2, base: base2, localBody: local }).length, 1);
});

test("a rewrite never brings back a paragraph a human deleted", () => {
  const v1 = published();
  const base = baseOf(v1);
  // 人删了「导出……」；FRS 留着它，同时把「评审人……」改了说法
  const edited = oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败"),
    P("评审人只能看到分配给自己的实验"),
    P("列表每 30 秒自动刷新"),
  );
  const local = oneCell(
    P("实验列表按状态筛选：运行中、待评审、已通过、失败"),
    P("导出按钮在列表为空时置灰"),
    P("评审人能看到所有实验，只能评审分配给自己的"),
    P("列表每 30 秒自动刷新"),
  );
  const v2 = apply(edited, patchOps({ localBody: local, cloudBody: edited, base }).ops);
  assert.ok(!texts(v2).includes("导出按钮在列表为空时置灰"));
  assert.ok(texts(v2).includes("评审人能看到所有实验，只能评审分配给自己的"));
});

test("same-shape tables align cell by cell, so new rules never land in the image cell", () => {
  const image = ["p", { id: "img1" }, ["image", { imageId: "i-1", width: 800, height: 450 }]];
  const cloud = doc(
    row(cell(P("功能点", {}, "h1")), cell(P("参考图", {}, "h2"))),
    row(cell(P("导出按钮在列表为空时置灰", {}, "r1")), cell(image)),
  );
  const local = doc(
    row(cell(P("功能点")), cell(P("参考图"))),
    row(cell(P("新建实验弹窗打开时聚焦名称输入框"), P("导出按钮在列表为空时置灰")), cell(structuredClone(image))),
  );
  const r = patchOps({ localBody: local, cloudBody: cloud, base: baseOf(cloud) });
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].op, "insert");
  assert.equal(r.ops[0].anchor, "r1");
  assert.equal(r.ops[0].position, "before");
});

test("batchOps merges adjacent deletes and splits into batches of 50", () => {
  const deletes = Array.from({ length: 120 }, (_, i) => ({ op: "delete", anchors: [`d${i}`] }));
  const merged = batchOps(deletes);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].map((op) => op.anchors.length), [50, 50, 20]);

  const edits = Array.from({ length: 60 }, (_, i) => ({ op: "setInline", anchor: `s${i}`, content: [] }));
  assert.deepEqual(batchOps(edits).map((b) => b.length), [50, 10]);
  // 不改动传进来的删除操作
  assert.deepEqual(deletes[0].anchors, ["d0"]);
});
