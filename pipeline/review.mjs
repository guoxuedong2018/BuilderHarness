#!/usr/bin/env node
/**
 * 原型批注：列出没解决的、标已解决、回复
 * ------------------------------------------------------------------
 * 「看评论」原来每次都是 Agent 现写一段脚本读 docs/reviews/*.json：先猜文件是数组还是
 * `{ comments }`，再过滤、分组、改 status、写回——同一件事前后写了约 100 遍，回复的字段名
 * 还写出过两种（`at` / `createdAt`），界面上就显示不出时间。读写收在这里，Agent 只管改代码。
 *
 *   npx builderharness review open [--route /eval-set]     没解决的，按页面分组，每条一行带源码坐标
 *   npx builderharness review resolve <id…> [--note "…"]   标已解决；带 --note 顺手回复一句改了什么
 *   npx builderharness review reply <id> "…"               只回复，不改状态
 *
 * 写回的形状与评审层（client/review/store.js）一致；dev 服务开着也能用，界面刷新即见。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { listDecisions, readDecisions, resolveDecision } from "./lib/decisions.mjs";
import { REPO_ROOT, REVIEWS_DIR, WEB_DIR } from "./lib/paths.mjs";

const AUTHOR = "Agent";
const WEB_REL = path.relative(REPO_ROOT, WEB_DIR).split(path.sep).join("/");
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const looksLikeTest = (body) => /^(1+|test|测试|asdf)$/i.test(flat(body));

async function load() {
  const files = (await fs.readdir(REVIEWS_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    const parsed = JSON.parse(await fs.readFile(path.join(REVIEWS_DIR, f), "utf8"));
    out.push({ file: f, comments: Array.isArray(parsed) ? parsed : (parsed.comments ?? []) });
  }
  return out;
}

const save = (store) => fs.writeFile(path.join(REVIEWS_DIR, store.file), `${JSON.stringify(store.comments, null, 2)}\n`, "utf8");

/**
 * 坐标是相对原型源码根；补上工程相对路径，Agent 直接能打开。
 * 坐标落在共用组件里（components/ 下的表格一格、卡片标题……）时只看坐标不知道是哪一页的哪一格，
 * 后面带上所在页面组件与元素名（「ExperimentsPage › columnheader · 状态」），免得再去翻 JSON
 */
function where(anchor = {}) {
  const s = anchor.src;
  if (!s?.file) return `（没有源码坐标）${anchor.label ?? anchor.selector ?? ""}`;
  const at = `${WEB_REL ? `${WEB_REL}/` : ""}${s.file}:${s.line}:${s.col}`;
  if (!/(^|\/)components\//.test(s.file)) return at;
  const page = (anchor.componentPath ?? []).filter((n) => !/^App$|Layout$/.test(n))[0];
  const what = flat(anchor.label).slice(0, 40);
  return `${at}（${[page, what].filter(Boolean).join(" › ")}）`;
}

async function open(route) {
  const all = (await load()).flatMap((s) => s.comments).filter((c) => c.status !== "resolved" && (!route || c.route === route));
  if (!all.length) return console.log(route ? `${route} 没有未解决的批注` : "没有未解决的批注");

  const byRoute = new Map();
  for (const c of all) (byRoute.get(c.route) ?? byRoute.set(c.route, []).get(c.route)).push(c);
  console.log(`未解决 ${all.length} 条（${byRoute.size} 个页面）`);
  for (const [r, list] of [...byRoute].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    console.log(`\n${r}`);
    for (const c of list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
      console.log(`  ${c.id}  ${where(c.anchor)}  ${c.author ?? "-"}：${flat(c.body)}${looksLikeTest(c.body) ? "（疑似测试）" : ""}`);
      for (const rep of c.replies ?? []) console.log(`      ↳ ${rep.author}：${flat(rep.body)}`);
    }
  }
}

/** 先全部找到再写：有一个 id 不对就一条都不改，免得改了一半 */
async function find(ids) {
  const stores = await load();
  const hits = [];
  const missing = [];
  for (const id of ids) {
    const store = stores.find((s) => s.comments.some((c) => c.id === id));
    if (store) hits.push({ store, comment: store.comments.find((c) => c.id === id) });
    else missing.push(id);
  }
  if (missing.length) throw new Error(`找不到这些批注：${missing.join("、")}（先跑 builderharness review open 看 id）`);
  return hits;
}

async function resolve(ids, note) {
  if (!ids.length) throw new Error("要给批注 id：builderharness review resolve <id…> [--note \"改了什么\"]");
  const hits = await find(ids);
  const at = new Date().toISOString();
  for (const { comment } of hits) {
    comment.status = "resolved";
    if (note) (comment.replies ??= []).push({ author: AUTHOR, body: note, at });
  }
  for (const store of new Set(hits.map((h) => h.store))) await save(store);
  console.log(`已解决 ${hits.length} 条：${ids.join("、")}`);
}

async function reply(id, body) {
  if (!id || !flat(body)) throw new Error("用法：builderharness review reply <id> \"回复内容\"");
  const [{ store, comment }] = await find([id]);
  (comment.replies ??= []).push({ author: AUTHOR, body: body.trim(), at: new Date().toISOString() });
  await save(store);
  console.log(`已回复 ${id}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : null);
  const positional = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
  if (cmd === "open") {
    await open(opt("--route"));
    if (!opt("--route")) {
      for (const { key, items } of await listDecisions()) {
        for (const row of items.filter((item) => item.submission && !item.submission.closedAt)) {
          const item = row.submission;
          console.log(`  ${key}/${row.id} [${row.status}] ${item.id} ${item.action} — ${item.author}: ${flat(item.body)}${item.note ? " · " + flat(item.note) : ""}${item.source ? " · " + flat(item.source) : ""}`);
        }
      }
    }
    return;
  }
  if (cmd === "decisions") {
    const key = positional[0];
    const features = key ? [{ key, items: await readDecisions(key) }] : await listDecisions();
    return console.log(JSON.stringify(features, null, 2));
  }
  if (cmd === "resolve-decision") {
    if (positional.length !== 2) throw new Error("builderharness review resolve-decision <KEY> <submission-id>");
    const item = await resolveDecision(...positional);
    return console.log(`✓ Decision ${item.item} recorded`);
  }
  if (cmd === "resolve") return resolve(positional, opt("--note"));
  if (cmd === "reply") return reply(positional[0], positional.slice(1).join(" "));
  console.log("用法：builderharness review open [--route <路由>] | resolve <id…> [--note \"…\"] | decisions [KEY] | resolve-decision <KEY> <submission-id> | reply <id> \"…\"");
  if (cmd && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
}

main().catch((e) => {
  console.log(`✗ ${e.message}`);
  process.exitCode = 1;
});
