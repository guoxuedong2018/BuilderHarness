import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { DOCS_DIR, FEATURES_DIR, PROJECT_CONFIG, REPO_ROOT } from "./paths.mjs";

/** Parse grouped or flat Markdown decision tables and locate their cited evidence. */
export const GROUP_LABEL = { A: "你拍板", B: "问研发", C: "问业务", D: "评审会" };

/** 列头 → 字段。按顺序试，先中先得 */
const COLUMNS = [
  ["id", /^(#|ID)$/i],
  ["question", /^(要定什么|要问什么|一句话|问题|Question)$/i],
  ["recommend", /^(我的)?建议|^Recommendation$/i],
  ["alternatives", /^备选|^Alternatives?$/i],
  ["conclusion", /^(你的结论|确认结果|结论|Conclusion)$/i],
  ["required", /^(阻断|Blocking)$/i],
  ["why", /^为什么重要|^(Why|Rationale)$/i],
  ["landing", /^落到哪|^(Impact|Where)$/i],
];

const ITEM_ID = /^([A-Za-z0-9_-]+)(?=\s|⛔|$)/;
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const plain = (s) => flat(String(s ?? "").replace(/\*\*|`/g, ""));
const hashOf = (line) => createHash("sha1").update(line.trim()).digest("hex").slice(0, 10);
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l ?? "");
const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l ?? "");

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function columnOf(header) {
  const h = plain(header);
  return COLUMNS.find(([, re]) => re.test(h))?.[0] ?? null;
}

/** 空、「—」都算没填 */
const blank = (s) => !flat(s) || /^[—–-]+$/.test(flat(s));

export function conclusionState(text) {
  if (blank(text)) return "pending";
  if (/待确认|\b(?:provisional|to confirm)\b/i.test(text)) return "provisional";
  return "decided";
}

/** 「我的建议」：第一句加粗的是结论，后面是理由 */
function splitRecommend(text) {
  if (blank(text)) return null;
  const m = text.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
  return m ? { text, head: m[1], rest: m[2] } : { text, head: text, rest: "" };
}

/** 「备选」按 ①②③ 拆；没编号就是一条 */
function splitAlternatives(text) {
  if (blank(text)) return [];
  const parts = text.split(/(?=[①-⑳])/).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    const m = p.match(/^([①-⑳])\s*(.*)$/s);
    const body = (m ? m[2] : p).replace(/[；;，,。\s]+$/, "");
    return { mark: m ? m[1] : "", text: body };
  });
}

/**
 * 找出〈待决清单〉一节，按组解析出条目。没有这一节返回 null。
 * 每条带行号与行指纹（这一行原文的哈希）：PM 提交那一刻记下指纹，Agent 记录前一比就知道这行后来改没改过。
 */
export function parsePendingList(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+(?:待决清单|Pending decisions)/i.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;

  const groups = [];
  const intro = [];
  let group = null;
  let allowFlat = true;
  const ids = new Set();
  for (let i = start + 1; i < end; i += 1) {
    const l = lines[i];
    const h = l.match(/^###\s+([A-D])\s*(?:[·:：–-]\s*)?(.+?)\s*$/);
    if (h) {
      allowFlat = false;
      group = { letter: h[1], label: GROUP_LABEL[h[1]], title: h[2], line: i + 1, items: [] };
      groups.push(group);
      continue;
    }
    if (/^#{3,}\s/.test(l)) {
      allowFlat = false;
      group = null; // 「三条被推翻的规格」这类附表不是待决条目
      continue;
    }
    const table = isRow(l) && isSep(lines[i + 1]);
    if (!table) {
      if (groups.length === 0 && flat(l)) intro.push(l);
      continue;
    }
    const cols = splitRow(l).map((h) => ({ header: plain(h), field: columnOf(h) }));
    if (!cols.some((c) => c.field === "question") || !cols.some((c) => c.field === "id")) continue;
    if (!cols.some((c) => c.field === "conclusion")) throw new Error("Decision table needs a Conclusion column");
    if (!group && allowFlat) {
      group = { letter: "A", label: GROUP_LABEL.A, title: "产品决定", line: i + 1, items: [] };
      groups.push(group);
    }
    if (!group) continue;

    i += 2;
    for (; i < end && isRow(lines[i]); i += 1) {
      const cells = splitRow(lines[i]);
      const idCell = cells[cols.findIndex((c) => c.field === "id")] ?? cells[0] ?? "";
      const m = idCell.match(ITEM_ID);
      if (!m) continue;
      if (ids.has(m[1])) throw new Error(`Duplicate decision ID: ${m[1]}`);
      ids.add(m[1]);
      const item = {
        id: m[1],
        group: group.letter,
        qualifier: flat(idCell.slice(m[1].length).replace(/⛔/g, "")),
        blocking: /⛔/.test(idCell),
        line: i + 1,
        hash: hashOf(lines[i]),
        question: "",
        recommend: null,
        alternatives: [],
        conclusion: "",
        why: "",
        landing: "",
        extra: [],
        headers: {},
      };
      cols.forEach((c, k) => {
        const v = cells[k] ?? "";
        if (c.field === "id") return;
        if (c.field === "required") {
          item.blocking ||= /^(yes|true|是|⛔)$/i.test(v);
          return;
        }
        if (!c.field) {
          if (!blank(v)) item.extra.push({ label: c.header, text: v });
          return;
        }
        item.headers[c.field] = c.header;
        if (c.field === "recommend") item.recommend = splitRecommend(v);
        else if (c.field === "alternatives") item.alternatives = splitAlternatives(v);
        else item[c.field] = blank(v) && c.field !== "conclusion" ? "" : v;
      });
      if (!item.question) throw new Error(`Decision ${item.id} needs a question`);
      item.blocking ||= /^⛔/.test(item.question);
      item.state = conclusionState(item.conclusion);
      group.items.push(item);
    }
    i -= 1;
  }
  return { line: start + 1, intro: intro.join("\n"), groups };
}

// ── README 里可引用的东西：节、事实 ──────────────────────────────────

/** 标题与独占一行的加粗小标（「**已经确认的事实**」）都算节；名字去掉末尾的（…） */
export function sectionsOf(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const marks = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) fence = !fence;
    if (fence) return;
    const h = l.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) marks.push({ name: plain(h[2]), level: h[1].length, line: i });
    const b = l.match(/^\*\*([^*]+)\*\*\s*$/);
    if (b) marks.push({ name: plain(b[1]), level: 7, line: i });
  });
  return marks.map((m, k) => {
    // 标题到下一个同级或更高的标题；加粗小标到下一个小标或任何标题
    const next = marks.slice(k + 1).find((n) => (m.level === 7 ? true : n.level <= m.level));
    return { ...m, key: m.name.replace(/\s*[（(][^）)]*[）)]\s*$/, ""), text: lines.slice(m.line, next ? next.line : lines.length).join("\n").trimEnd() };
  });
}

export function findSection(sections, name) {
  const n = plain(name);
  return sections.find((s) => s.name === n) ?? sections.find((s) => s.key === n) ?? sections.find((s) => s.name.startsWith(n)) ?? null;
}

/** 〈已经确认的事实〉的编号列表：第 N 条 */
export function factsOf(sections) {
  const sec = findSection(sections, "已经确认的事实") ?? findSection(sections, "Confirmed facts");
  if (!sec) return [];
  const out = [];
  for (const l of sec.text.split("\n").slice(1)) {
    const m = l.match(/^\d+\.\s+(.*)$/);
    if (m) out.push(m[1]);
    else if (out.length && /^\s{2,}\S/.test(l)) out[out.length - 1] += `\n${l.trim()}`;
  }
  return out;
}

// ── docs/DECISIONS.md 的条目 ────────────────────────────────────────

export const DECISIONS_FILE = path.join(DOCS_DIR, "DECISIONS.md");
const FACTS_FILE = path.resolve(REPO_ROOT, PROJECT_CONFIG.decisionFacts ?? path.join(DOCS_DIR, "design", "FACTS.md"));

export function decisionsOf(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*·\s*(.+?)\s*$/);
    if (m && m[1] !== "YYYY-MM-DD") heads.push({ date: m[1], title: m[2], line: i });
  });
  return heads.map((h, k) => {
    const stop = lines.findIndex((l, i) => i > h.line && /^#{1,3}\s/.test(l));
    const endAt = k + 1 < heads.length ? Math.min(heads[k + 1].line, stop < 0 ? Infinity : stop) : stop < 0 ? lines.length : stop;
    return { ...h, text: lines.slice(h.line, endAt).join("\n").trimEnd() };
  });
}

/**
 * 「2026-10-22「先查线上用的库」」找的是那天的哪一条：标题或正文里有这几个字的优先，
 * 都没有就按共有的字数挑最像的；那天只有一条就是它
 */
export function findDecision(entries, date, quote) {
  const same = entries.filter((e) => e.date === date);
  if (!same.length) return null;
  if (same.length === 1) return same[0];
  if (!quote) return null;
  const q = plain(quote);
  const hit = same.find((e) => e.title.includes(q)) ?? same.find((e) => e.text.includes(q));
  if (hit) return hit;
  return null; // A fuzzy match can point the reviewer at an unrelated decision.
}

// ── 格子里的引用 ────────────────────────────────────────────────────

/**
 * 认出一格里的引用，返回在原文里的位置。几种固定写法（docs/templates/README.md）：
 *   事实 N                 本 README〈已经确认的事实〉第 N 条（也认「〈已经确认的事实〉第 N 条」）
 *   A3 / B4 / C1           同件套的另一条
 *   〈节名〉               本 README 的那一节；前面写了 LEGACY 的去 LEGACY_PLATFORM_FACTS.md 找
 *   YYYY-MM-DD「…」        docs/DECISIONS.md 那天的条目（也认「YYYY-MM-DD 的决定 / 经验」）
 *   需求 <KEY>             那份件套的 README；后面跟「的 C1」就是那份的 C1
 * 只认得出、找得到的才算引用：A1–A14 这种已经挪走的编号，不链到空处。
 */
export function findRefs(text, ctx, selfId) {
  const s = String(text ?? "");
  const out = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (start, end, ref) => {
    if (!free(start, end)) return;
    taken.push([start, end]);
    out.push({ start, end, label: plain(s.slice(start, end)), ...ref });
  };
  const each = (re, fn) => {
    for (const m of s.matchAll(re)) fn(m, m.index);
  };
  // 同件套另一份的某一条：引用后面紧跟「的 C1」
  const withItem = (end, key) => {
    const m = s.slice(end).match(/^\s*的\s*([A-D]\d{1,3})(?![0-9A-Za-z_])/);
    return m ? { end: end + m[0].length, target: `${key}#${m[1]}`, kind: "feature-item" } : { end, target: key, kind: "feature" };
  };
  const feature = (raw) => ctx.featureOf?.(raw) ?? null;

  each(/\[([^\]]+)\]\(([^)\s]*)\)/g, (m, i) => {
    const key = feature(m[2].match(/(?:^|\/)([A-Za-z0-9_-]+)\/README\.md(?:#.*)?$/i)?.[1] ?? m[2].match(/(\d{8}_[A-Z0-9_]+)/)?.[1]);
    if (!key) return;
    const t = withItem(i + m[0].length, key);
    add(i, t.end, { kind: t.kind, target: t.target });
  });
  each(/需求\s*`?(\d{8}(?:_[A-Z0-9_]+)?)`?/g, (m, i) => {
    const key = feature(m[1]);
    if (!key) return;
    const t = withItem(i + m[0].length, key);
    add(i, t.end, { kind: t.kind, target: t.target });
  });
  each(/`(\d{8}(?:_[A-Z0-9_]+)?)`|(?<![\w/])(\d{8}_[A-Z][A-Z0-9_]*)(?![\w/])/g, (m, i) => {
    const key = feature(m[1] ?? m[2]);
    if (!key || key === ctx.key) return;
    const t = withItem(i + m[0].length, key);
    add(i, t.end, { kind: t.kind, target: t.target });
  });
  each(/〈已经确认的事实〉\s*第\s*(\d+)\s*条/g, (m, i) => {
    if (Number(m[1]) <= (ctx.facts?.length ?? 0)) add(i, i + m[0].length, { kind: "fact", target: m[1] });
  });
  each(/(?:事实|\bFact)\s*(\d+)/gi, (m, i) => {
    if (Number(m[1]) >= 1 && Number(m[1]) <= (ctx.facts?.length ?? 0)) add(i, i + m[0].length, { kind: "fact", target: m[1] });
  });
  each(/(?:`?(LEGACY(?:_PLATFORM_FACTS)?(?:\.md)?)`?\s*)?〈([^〉\n]+)〉/g, (m, i) => {
    const legacy = !!m[1];
    const sec = legacy ? findSection(ctx.legacySections ?? [], m[2]) : findSection(ctx.sections ?? [], m[2]);
    if (sec) add(i, i + m[0].length, { kind: legacy ? "legacy" : "section", target: sec.name });
  });
  const decision = (m, i) => {
    const hit = findDecision(ctx.decisions ?? [], m[1], m[2]);
    if (hit) add(i, i + m[0].length, { kind: "decision", target: `${hit.date}#${hit.title}` });
  };
  each(/DECISIONS(?:\.md)?`?\s*(20\d\d-\d\d-\d\d)(?:\s*「([^」\n]+)」)?/g, decision);
  each(/(20\d\d-\d\d-\d\d)\s*(?:「([^」\n]+)」|(?:的)?(?:决定|决策|经验))/g, decision);
  each(/(?<![A-Za-z0-9_])([A-Za-z][A-Za-z_-]*\d+)(?![0-9A-Za-z_])/g, (m, i) => {
    if (m[1] !== selfId && ctx.ids?.has(m[1])) add(i, i + m[0].length, { kind: "item", target: m[1] });
  });
  return out.sort((a, b) => a.start - b.start);
}

// ── 件套：读、算状态 ────────────────────────────────────────────────

const readText = async (file) => {
  try {
    const real = await fs.realpath(file);
    const relative = path.relative(await fs.realpath(REPO_ROOT), real);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
    return await fs.readFile(real, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const validKey = (key) => typeof key === "string" && /^[A-Za-z0-9_-]+$/.test(key);
export async function listFeatureDirs() {
  const entries = await fs.readdir(FEATURES_DIR, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && validKey(entry.name)).map((entry) => entry.name).sort();
}
function resolveFeature(raw, dirs) {
  if (dirs.includes(raw)) return raw;
  const matches = /^\d{8}$/.test(raw) ? dirs.filter((dir) => dir.startsWith(raw + "_")) : [];
  return matches.length === 1 ? matches[0] : null;
}
const titleOf = (md) => plain(String(md).match(/^#\s+(.+)$/m)?.[1] ?? "");
export const readmeOf = (key) => path.join(FEATURES_DIR, key, "README.md");
export const relPath = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");
export const readFeatureReadme = (key) => validKey(key) ? readText(readmeOf(key)) : null;

export async function loadFeature(key, dirs) {
  const featureDirs = dirs ?? await listFeatureDirs();
  if (!featureDirs.includes(key)) return null;
  const file = readmeOf(key);
  const md = await readFeatureReadme(key);
  const list = md && parsePendingList(md);
  if (!list) return null;

  const sections = sectionsOf(md);
  const ctx = {
    key,
    ids: new Set(list.groups.flatMap((g) => g.items.map((it) => it.id))),
    sections,
    facts: factsOf(sections),
    decisions: decisionsOf((await readText(DECISIONS_FILE)) ?? ""),
    legacySections: sectionsOf((await readText(FACTS_FILE)) ?? ""),
    featureOf: (raw) => resolveFeature(raw, featureDirs),
  };
  const items = list.groups.flatMap((g) => g.items);
  const FIELDS = ["question", "conclusion", "why", "landing"];
  for (const it of items) {
    it.refs = {};
    for (const f of FIELDS) it.refs[f] = findRefs(it[f], ctx, it.id);
    if (it.recommend) it.refs.recommend = findRefs(it.recommend.text, ctx, it.id);
    it.alternatives.forEach((a, k) => (it.refs[`alt${k}`] = findRefs(a.text, ctx, it.id)));
    it.extra.forEach((x, k) => (it.refs[`extra${k}`] = findRefs(x.text, ctx, it.id)));

  }
  // 谁提到了这一条：被提到的那张卡上写「牵动」
  for (const it of items) {
    it.mentionedBy = items.filter((o) => o !== it && Object.values(o.refs).some((rs) => rs.some((r) => r.kind === "item" && r.target === it.id))).map((o) => o.id);
  }
  return { key, title: titleOf(md), file: relPath(file), intro: list.intro, groups: list.groups, ctx, md };
}

/** 一份件套的计数：待定、⛔ 还没定的、暂留待确认、已提交待记录、已定 */
export function countsOf(groups) {
  const items = groups.flatMap((g) => g.items);
  const n = (f) => items.filter(f).length;
  return {
    total: items.length,
    pending: n((it) => it.status === "pending"),
    blocking: n((it) => it.blocking && it.status !== "decided"),
    provisional: n((it) => it.status === "provisional"),
    submitted: n((it) => it.status === "submitted"),
    decided: n((it) => it.status === "decided"),
  };
}

/** 面板标题已经写了节名，正文从标题下一行起 */
const dropHead = (text) => text.split("\n").slice(1).join("\n").trim();

/**
 * 点开一处引用看原文。返回 { title, where, markdown }；item 由页面自己摆，不走这里
 */
export async function resolveRef(feature, kind, target) {
  const { ctx } = feature;
  if (kind === "fact") {
    const n = Number(target);
    const text = ctx.facts[n - 1];
    return text ? { title: `事实 ${n}`, where: `${feature.file}〈已经确认的事实〉第 ${n} 条`, markdown: text } : null;
  }
  if (kind === "section" || kind === "legacy") {
    const sec = findSection(kind === "legacy" ? ctx.legacySections : ctx.sections, target);
    const where = kind === "legacy" ? relPath(FACTS_FILE) : feature.file;
    return sec ? { title: `〈${sec.name}〉`, where: `${where}:${sec.line + 1}`, markdown: dropHead(sec.text) } : null;
  }
  if (kind === "decision") {
    const [date, ...rest] = String(target).split("#");
    const hit = ctx.decisions.find((e) => e.date === date && e.title === rest.join("#")) ?? findDecision(ctx.decisions, date);
    return hit ? { title: `${hit.date} · ${hit.title}`, where: `docs/DECISIONS.md:${hit.line + 1}`, markdown: dropHead(hit.text) } : null;
  }
  if (kind === "feature" || kind === "feature-item") {
    const [key, itemId] = String(target).split("#");
    const md = await readFeatureReadme(key);
    if (!md) return null;
    const file = relPath(readmeOf(key));
    const list = parsePendingList(md);
    if (itemId) {
      const it = list?.groups.flatMap((g) => g.items).find((x) => x.id === itemId);
      if (!it) return null;
      const rows = [
        [it.headers.question ?? "问题", it.question],
        it.recommend && [it.headers.recommend ?? "我的建议", it.recommend.text],
        it.why && [it.headers.why ?? "为什么重要", it.why],
        [it.headers.conclusion ?? "结论", it.conclusion || "（还没有）"],
      ].filter(Boolean);
      return { title: `${titleOf(md)} · ${it.id}`, where: `${file}:${it.line}`, markdown: rows.map(([k, v]) => `**${k}**\n\n${v}`).join("\n\n"), feature: list ? key : null };
    }
    // 整份件套：标题、状态与需求背景，够判断「说的是哪件事」
    const lines = md.split("\n");
    const stop = lines.findIndex((l, i) => i > 0 && /^##\s/.test(l) && !/^##\s+需求背景/.test(l));
    return { title: titleOf(md), where: file, markdown: dropHead(lines.slice(0, stop < 0 ? 60 : stop).join("\n")), feature: list ? key : null };
  }
  return null;
}
