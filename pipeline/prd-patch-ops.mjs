#!/usr/bin/env node
/**
 * 把「本地重新渲染的 PRD 正文」与「目标端现状」逐段对齐，只为**变化的段落**生成 ops。
 * ------------------------------------------------------------------
 * 为什么不直接 setBodyChildren：整篇覆盖会把别人在文档里的手工订正一起抹掉，
 * 而 PRD 是要给研发看的协作文档，评审期间对方会直接在上面改。整篇覆盖只适合首发。
 *
 * 只比功能点表（两边都只取表格）：需求背景、方案设计里有 Mermaid 与列表，按段替换容易把结构弄坏，
 * 这几段变了由调用方提醒人。
 *
 * 对齐方式是按段落文本做 LCS（配图按 imageId 算进文本，换了图也算这一段变了）：
 *   - 文本相同        → 跳过
 *   - 1:1 变化        → setInline（保留段落 ID、列表归属与评论锚点，只换行内内容）
 *   - 本地多出        → insert，锚在上一段之后，列表属性沿用邻居（新列表 ID 会断号）
 *   - 目标端多出        → delete
 *
 * 给了底稿（上次发布后目标端的段落文本）时，目标端那段对不上底稿的——有人在目标端里改过或加过——
 * 不改也不删，列出来交给人；底稿里有、目标端整篇都没有了的——有人删掉了——也不加回来。
 * 没有底稿就分不清，所有改写与删除都会落到目标端现状上。人改了什么逐条看 `cloudEdits`。
 *
 * 修订稿（redline）：改动先不落成定稿，给人在目标端里过目——要删的段落、改之前的原文加删除线标红留在原位，
 * 新写的段落浅绿底插在后面。人确认后不带 redline 再发一次：标红的段落在底稿里、对不上 FRS，照常删掉；
 * 浅绿底的段落文字已和 FRS 一致，只去掉底色。人在修订稿上改过的段落照常列进 cloudEdits，不替人定稿。
 * 删除线算进段落文本（`~~…~~`）：人在目标端里给一段划了线，也认得出是改过。
 *
 * 用法：
 *   npx builderharness prd-patch-ops <FEATURE_KEY> --cloud <fetch-jsonml 的输出> [--base <底稿>] [--out <ops 文件>]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRD_DIR, REPO_ROOT } from "./lib/paths.mjs";

/** 修订稿的两种标记：删掉的、改之前的原文划线标红；新写的浅绿底 */
export const REDLINE_DELETE = { strike: true, color: "#f5222d" };
export const REDLINE_INSERT = { bg: "#d9f5d6" };

const isText = (n) => Array.isArray(n) && n[0] === "text";
const runsOf = (node) => {
  const out = [];
  (function walk(n) {
    if (!Array.isArray(n)) return;
    if (isText(n)) out.push(n);
    else n.slice(2).forEach(walk);
  })(node);
  return out;
};
const visible = (run) => run.slice(2).some((c) => typeof c === "string" && c.trim());
/** 这一段有字，且字全划了线 */
const allStruck = (node) => runsOf(node).filter(visible).length > 0 && runsOf(node).filter(visible).every((r) => r[1]?.strike === true);
/** 这一段带修订稿的浅绿底 */
const hasInsertMark = (node) => runsOf(node).some((r) => r[1]?.bg === REDLINE_INSERT.bg);
/** 段落内容（setInline / insert 的 content）每段文字加上样式 */
const mark = (content, style) => content.map((c) => (isText(c) ? ["text", { ...(c[1] ?? {}), ...style }, ...c.slice(2)] : c));

/**
 * 一段文字的原文：划了线的部分包成 `~~…~~`，配图写 `[图:imageId]`（detail 再带上宽高）。
 * 比较用的 paraText 在此基础上去掉空白
 */
function flatText(node, detail = false) {
  const out = [];
  (function walk(n) {
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    if (!Array.isArray(n)) return;
    if (n[1]?.imageId) out.push(detail ? `[图:${n[1].imageId} ${n[1].width}×${n[1].height}]` : `[图:${n[1].imageId}]`);
    if (isText(n) && n[1]?.strike === true) {
      const t = n.slice(2).filter((c) => typeof c === "string").join("");
      if (t.trim()) out.push(`~~${t}~~`);
      return;
    }
    n.slice(2).forEach(walk);
  })(node);
  return out.join("").replace(/~~~~/g, "");
}

/** 段落的可比较文本：忽略空白；行内样式只认删除线（划线是改动，颜色、加粗不是）；配图记成它的 imageId */
export function paraText(node) {
  return flatText(node).replace(/\s+/g, "");
}

/** 深度优先收集所有段落节点（表格单元格里的段落也在内；分组名是单元格里的五级标题，进目录，也算一段） */
function collectParagraphs(node, acc) {
  if (!Array.isArray(node)) return acc;
  if (node[0] === "p" || /^h[1-6]$/.test(node[0])) {
    acc.push(node);
    return acc;
  }
  node.slice(2).forEach((child) => collectParagraphs(child, acc));
  return acc;
}

const topBlocks = (body) => (body[0] === "root" ? body.slice(2) : body);

/** 一篇正文里功能点表的全部段落 */
export function tableParagraphs(body) {
  return collectParagraphs(["root", {}, ...topBlocks(body).filter((b) => b[0] === "table")], []);
}

/** 功能点表以外的块（标题之外）：需求背景、原型地址、方案设计。只用来判断这几段有没有变 */
export function proseTexts(body) {
  return topBlocks(body)
    .filter((b) => b[0] !== "table" && b[0] !== "title")
    .map(paraText)
    .filter(Boolean);
}

/** 标准 LCS，回溯出 equal / replace / insert / delete 四种编辑 */
function diff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const script = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      script.push({ type: "equal", i, j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      script.push({ type: "delete", i });
      i += 1;
    } else {
      script.push({ type: "insert", j, after: i - 1 });
      j += 1;
    }
  }
  while (i < n) script.push({ type: "delete", i: i++ });
  while (j < m) script.push({ type: "insert", j: j++, after: n - 1 });

  // 相邻的一删一增合并成 setInline：段落 ID、列表归属、评论锚点都留在原地
  const merged = [];
  for (let k = 0; k < script.length; k += 1) {
    const cur = script[k];
    const next = script[k + 1];
    if (cur.type === "delete" && next?.type === "insert") {
      merged.push({ type: "change", i: cur.i, j: next.j });
      k += 1;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/** 两段文字有多像：字的二元组重合度（Dice），0–1 */
function dice(x, y) {
  const grams = (t) => new Set(Array.from({ length: Math.max(t.length - 1, 1) }, (_, k) => t.slice(k, k + 2)));
  const a = grams(x);
  const b = grams(y);
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return (2 * hit) / (a.size + b.size);
}

/**
 * 修订稿的排法：一串删和一串增之间，按文字相似度把改前、改后配成对（保持两边先后），
 * 每条原文后面紧跟它的改写，方便逐条对照；配不上的分别算删和增。有人改过的段落不参与配对（原样留着），
 * 上一版修订稿里已经整段划线的原文也不参与（改写该配给它后面那段浅绿底的提议，原地换掉，段落上的评论跟着留下）
 */
function interleave(script, cloudText, localText, skip) {
  const out = [];
  let dels = [];
  let ins = [];
  const flush = () => {
    const pair = new Map();
    let after = -1;
    for (const i of dels) {
      if (skip(i)) continue;
      let best = null;
      for (let k = after + 1; k < ins.length; k += 1) {
        const sim = dice(cloudText[i], localText[ins[k]]);
        if (sim >= 0.3 && (best == null || sim > best.sim)) best = { k, sim };
      }
      if (best) {
        pair.set(i, ins[best.k]);
        after = best.k;
      }
    }
    const paired = new Set(pair.values());
    let d = 0;
    let n = 0;
    while (d < dels.length || n < ins.length) {
      const i = dels[d];
      const j = ins[n];
      if (i != null && pair.get(i) === j && j != null) {
        out.push({ type: "change", i, j });
        d += 1;
        n += 1;
      } else if (i != null && !pair.has(i)) {
        out.push({ type: "delete", i });
        d += 1;
      } else if (j != null && !paired.has(j)) {
        out.push({ type: "insert", j });
        n += 1;
      } else {
        // 配对单调，走不到这里；保底按删在前
        out.push({ type: "delete", i });
        d += 1;
      }
    }
    dels = [];
    ins = [];
  };
  for (const step of script) {
    if (step.type === "equal") {
      flush();
      out.push(step);
      continue;
    }
    if (step.type !== "insert") dels.push(step.i);
    if (step.type !== "delete") ins.push(step.j);
  }
  flush();
  return out;
}

/**
 * @param localBody  本地渲染出的正文（setBodyChildren 的 content）
 * @param cloudBody  fetch-jsonml 拿到的 result.body
 * @param base       上次发布后目标端功能点表的段落文本；null 表示没有底稿
 * @param redline    出修订稿：删的、改前的划线标红留在原位，新的浅绿底插在后面（见文件头）
 * @returns { ops, summary, lines, kept }  kept 是有人改过、这次没动的段落；summary.unmark 是去掉浅绿底的段落数
 */
export function patchOps({ localBody, cloudBody, base = null, redline = false }) {
  const show = (t, n) => t.replace(/\[图:[^\]]+\]/g, "[图]").slice(0, n);
  const published = base ? new Set(base) : null;
  const ops = [];
  const lines = [];
  const kept = [];
  const removed = [];
  const summary = { change: 0, insert: 0, delete: 0, unmark: 0 };
  // 有人在目标端里删掉的段落：底稿里有、目标端整张表都找不到（只是挪了位置的还在别处，照常插）
  const cloudAll = new Set(tableParagraphs(cloudBody).map(paraText));
  const deletedInCloud = (t) => published && published.has(t) && !cloudAll.has(t);

  // Align paragraphs within each existing table and cell. New optional component sections
  // append as blocks, so an insertion can never end up in the feature-rule image column.
  const cloudTables = tableGrids(cloudBody);
  const localTables = tableGrids(localBody);
  const cloudComponent = cloudTables.findIndex((grid) => grid[0]?.[0]?.some((node) => paraText(node) === "组件名称"));
  const localComponent = localTables.findIndex((grid) => grid[0]?.[0]?.some((node) => paraText(node) === "组件名称"));
  const appendComponents = localComponent >= 0 && cloudComponent < 0 &&
    cloudTables.length === localTables.length - 1 && !published?.has("组件名称");
  const pairedLocal = appendComponents ? localTables.filter((_, index) => index !== localComponent) : localTables;
  const legacySingleTable = cloudTables.length === 1 && pairedLocal.length === 1 && (localComponent < 0 || appendComponents);
  if (!legacySingleTable && (cloudTables.length !== pairedLocal.length || (cloudComponent !== localComponent && !appendComponents))) {
    throw new Error("目标端和 FRS 的表格结构已分歧，请保留人工编辑并复核组件说明表，再继续增量发布");
  }
  const segments = cloudTables.flatMap((grid, index) => {
    const other = pairedLocal[index];
    const sameShape = grid.length === other.length && grid.every((row, r) => row.length === other[r].length);
    if (sameShape) return grid.flatMap((row, r) => row.map((cell, c) => [cell, other[r][c]]));
    if (legacySingleTable) return [[grid.flat(2), other.flat(2)]];
    throw new Error("表格行列变化需复核，避免将规则写进错误的列");
  });

  for (const [cloudParas, localParas] of segments) {
    const cloudText = cloudParas.map(paraText);
    const localText = localParas.map(paraText);
    // 目标端这一段是不是我们上次发出去的样子：不是就说明有人动过，不替人改
    const touched = (i) => published && !published.has(cloudText[i]);
    // 插入只能锚在**这批操作之后还活着**的段落上：锚到同批里已被删掉的段落会直接报错
    let lastKept = -1;
    /** 插在 anchorPara 前或后；列表属性沿用邻居、只保留本地的层级，否则新段落会自成一列表、编号从 1 重来 */
    const insert = (node, anchorPara, position, style) => {
      const attrs = { ...node[1] };
      if (attrs.list && anchorPara[1]?.list) {
        attrs.list = { ...anchorPara[1].list, level: attrs.list.level ?? 0 };
      }
      const content = style ? mark(node.slice(2), style) : node.slice(2);
      const block = [node[0], attrs, ...content];
      // 连续新增必须并进同一个 insert：分开提交时每条都锚在同一段之后，顺序会整个翻过来
      const last = ops[ops.length - 1];
      if (last?.op === "insert" && last.anchor === anchorPara[1].id && last.position === position) {
        last.content.push(block);
      } else {
        ops.push({ op: "insert", anchor: anchorPara[1].id, position, content: [block] });
      }
    };
    const script = redline
      ? interleave(diff(cloudText, localText), cloudText, localText, (i) => touched(i) || allStruck(cloudParas[i]))
      : diff(cloudText, localText);
    for (let step of script) {
      // 改写要写进去的是人在目标端删掉（或改掉）的那段：不写回去，目标端这段按删除处理。
      // diff 把紧挨着的一删一增都并成改写，不看像不像，不拦的话人删掉的话会借邻居的段落回来
      if (step.type === "change" && deletedInCloud(localText[step.j])) {
        removed.push(show(localText[step.j], 80));
        step = { type: "delete", i: step.i };
      }
      if (step.type === "equal") {
        lastKept = step.i;
        // 修订稿确认后定稿：文字已和 FRS 一致的浅绿底段落，只去掉底色
        if (!redline && hasInsertMark(cloudParas[step.i])) {
          ops.push({ op: "setInline", anchor: cloudParas[step.i][1].id, content: localParas[step.j].slice(2) });
          summary.unmark += 1;
        }
        continue;
      }
      if (step.type === "change" || step.type === "delete") {
        if (touched(step.i)) {
          lastKept = step.i;
          kept.push(show(cloudText[step.i], 80));
          continue;
        }
        const anchor = cloudParas[step.i][1]?.id;
        if (!anchor) throw new Error(`目标端段落缺 id：${cloudText[step.i].slice(0, 30)}`);
        if (redline) {
          lastKept = step.i;
          const para = cloudParas[step.i];
          // 上一版修订稿里新写的（浅绿底）还没定稿，直接换掉或删掉，不再划线
          const proposed = hasInsertMark(para) && !allStruck(para);
          // 只有图、没有字的段落划不了线：留在原位，定稿时再删
          const strikable = runsOf(para).some(visible) && !allStruck(para);
          if (step.type === "change") {
            if (proposed) ops.push({ op: "setInline", anchor, content: mark(localParas[step.j].slice(2), REDLINE_INSERT) });
            else {
              if (strikable) ops.push({ op: "setInline", anchor, content: mark(para.slice(2), REDLINE_DELETE) });
              insert(localParas[step.j], para, "after", REDLINE_INSERT);
            }
            summary.change += 1;
            lines.push(`  ~ ${show(cloudText[step.i], 42)}\n    → ${show(localText[step.j], 42)}`);
          } else if (proposed) {
            ops.push({ op: "delete", anchors: [anchor] });
            summary.delete += 1;
            lines.push(`  - ${show(cloudText[step.i], 48)}`);
          } else if (strikable) {
            ops.push({ op: "setInline", anchor, content: mark(para.slice(2), REDLINE_DELETE) });
            summary.delete += 1;
            lines.push(`  - ${show(cloudText[step.i], 48)}`);
          }
          continue;
        }
        if (step.type === "change") {
          lastKept = step.i;
          ops.push({ op: "setInline", anchor, content: localParas[step.j].slice(2) });
          summary.change += 1;
          lines.push(`  ~ ${show(cloudText[step.i], 42)}\n    → ${show(localText[step.j], 42)}`);
        } else {
          ops.push({ op: "delete", anchors: [anchor] });
          summary.delete += 1;
          lines.push(`  - ${show(cloudText[step.i], 48)}`);
        }
        continue;
      }
      if (deletedInCloud(localText[step.j])) {
        removed.push(show(localText[step.j], 80));
        continue;
      }
      // 前面没有留下的段落（插在一格的最前面）：锚在这一格第一段的前面，它在这批里不会被删（会被删的已并成改写）
      const prev = cloudParas[lastKept];
      const anchorPara = prev ?? cloudParas[0];
      if (!anchorPara) throw new Error("新增段落所在的格子在目标端是空的，没有可用锚点，需人工处理");
      insert(localParas[step.j], anchorPara, prev ? "after" : "before", redline ? REDLINE_INSERT : null);
      summary.insert += 1;
      lines.push(`  + ${show(localText[step.j], 48)}`);
    }
  }
  if (appendComponents) {
    const blocks = topBlocks(localBody);
    const start = blocks.findIndex((block) => block[0] === "heading" && paraText(block) === "通用组件抽象说明");
    const heading = start >= 0 ? start : blocks.findIndex((block) => paraText(block) === "通用组件抽象说明");
    if (heading < 0) throw new Error("组件说明表缺少标题");
    ops.push({ op: "insert", anchor: "@docEnd", position: "after", content: blocks.slice(heading) });
    summary.insert += 1;
    lines.push("  + 通用组件抽象说明");
  }
  const cloudCount = segments.reduce((n, [a]) => n + a.length, 0);
  const localCount = segments.reduce((n, [, b]) => n + b.length, 0);
  return { ops, summary, lines, kept, removed, cloudCount, localCount };
}

/** 段落的原文（保留空白），给人看用；比较用 paraText。配图写出 imageId 与宽高，同步回 FRS 的 `{ image, width, height }` 照抄；划线的部分包成 `~~…~~` */
const rawText = (node) => flatText(node, true).trim();

const SECTION_LABELS = new Set(["显示规则：", "交互规则：", "取值规则：", "权限规则："]);

/** 功能点名那一段：不是列表项、开头一段是加粗的名称（后面跟来源标签） */
const isPointTitle = (n) => n[0] === "p" && !n[1]?.list && n.slice(2).find((c) => Array.isArray(c) && c[0] === "text")?.[1]?.bold === true;

/**
 * diff 只把紧挨着的一删一增并成改写，连着改几段时会错开配对（第一段的原文配上第二段的新文）。
 * 给人看的清单重新配对：一串删和紧跟的一串增里，文字按相似度配（像同一段的才算「改」，
 * 不像的分别算删和增），配图只和配图按先后配（人在一条规则前插了张图，不该把那条的原文配给图）
 */
function pairRuns(script, isImage, similarity) {
  const out = [];
  let dels = [];
  let ins = [];
  const flush = () => {
    const run = [];
    for (const kind of [false, true]) {
      const d = dels.filter((x) => x.image === kind).map((x) => x.k);
      const n = ins.filter((x) => x.image === kind).map((x) => x.k);
      const used = new Set();
      let after = -1;
      for (const i of d) {
        // 保持先后：只在上一对之后找；文字取最像的那段，像到一定程度才算同一段
        const cands = n.filter((j, at) => at > after && !used.has(j));
        const best = kind ? cands[0] : cands.reduce((a, j) => (a == null || similarity(i, j) > similarity(i, a) ? j : a), null);
        if (best != null && (kind || similarity(i, best) >= 0.4)) {
          used.add(best);
          after = n.indexOf(best);
          run.push({ type: "change", i, j: best });
        } else run.push({ type: "delete", i });
      }
      for (const j of n) if (!used.has(j)) run.push({ type: "insert", j });
    }
    // 按目标端的先后排回去（删掉的段落目标端没有位置，排在这一串最前面）
    out.push(...run.sort((a, b) => (a.j ?? -1) - (b.j ?? -1)));
    dels = [];
    ins = [];
  };
  for (const step of script) {
    if (step.type === "equal") {
      flush();
      out.push(step);
    } else {
      if (step.type !== "insert") dels.push({ k: step.i, image: isImage("base", step.i) });
      if (step.type !== "delete") ins.push({ k: step.j, image: isImage("cloud", step.j) });
    }
  }
  flush();
  return out;
}

/**
 * 目标端里人改了什么：目标端功能点表对上次发布的底稿逐段比，一处一条，带所在的「分组 · 功能点 · 规则类别」与列表层级。
 * synced 表示这处改动 FRS 里已经有了（本地渲染出的表里能找到改后的段落；删掉的段落本地也没了）；
 * 没有的可能是还没同步，也可能是 FRS 有意不要，由人判断。
 * 都同步回 FRS（或确定不要）之后，发布时加 --absorb 把底稿换成目标端现状，这些段落才不再被当成「有人改过」而跳过。
 * @returns [{ type: "change" | "insert" | "delete", where, level, before, after, synced }]
 */
export function cloudEdits({ cloudBody, base, localBody }) {
  const nodes = tableParagraphs(cloudBody);
  const texts = nodes.map(paraText);
  const local = new Set(tableParagraphs(localBody).map(paraText));
  const here = [];
  let group = "";
  let point = "";
  let section = "";
  for (const n of nodes) {
    const raw = rawText(n);
    if (/^h[1-6]$/.test(n[0])) [group, point, section] = [raw, "", ""];
    else if (SECTION_LABELS.has(raw.replace(/\s/g, ""))) section = raw.replace(/[：:\s]/g, "");
    else if (isPointTitle(n)) [point, section] = [raw, ""];
    here.push([group, point, section].filter(Boolean).join(" · "));
  }
  const levelOf = (i) => (nodes[i][1]?.list ? (nodes[i][1].list.level ?? 0) + 1 : 0);
  const edits = [];
  let lastCloud = -1;
  const imageOnly = (t) => /^(\[图:[^\]]+\])+$/.test(t);
  // 两段文字有多像：字的二元组重合度（Dice），0–1
  const grams = (t) => new Set(Array.from({ length: Math.max(t.length - 1, 1) }, (_, k) => t.slice(k, k + 2)));
  const similarity = (i, j) => {
    const a = grams(base[i]);
    const b = grams(texts[j]);
    let hit = 0;
    for (const g of a) if (b.has(g)) hit += 1;
    return (2 * hit) / (a.size + b.size);
  };
  const isImage = (side, k) => imageOnly(side === "base" ? base[k] : texts[k]);
  for (const step of pairRuns(diff(base, texts), isImage, similarity)) {
    if (step.type === "equal") {
      lastCloud = step.j;
      continue;
    }
    // 空段落加了删了都不算改动
    if (step.type === "delete" ? !base[step.i] : !texts[step.j] && (step.type === "insert" || !base[step.i])) {
      if (step.type !== "delete") lastCloud = step.j;
      continue;
    }
    if (step.type === "delete") {
      edits.push({ type: "delete", where: here[lastCloud] ?? "", level: 0, before: base[step.i], after: "", synced: !local.has(base[step.i]) });
      continue;
    }
    lastCloud = step.j;
    edits.push({
      type: step.type === "change" ? "change" : "insert",
      where: here[step.j],
      level: levelOf(step.j),
      before: step.type === "change" ? base[step.i] : "",
      after: rawText(nodes[step.j]),
      synced: local.has(texts[step.j]),
    });
  }
  return edits;
}

/**
 * 发布之后的下一份底稿：目标端功能点表里**我们留下的样子**，人改过、人删掉的不算进来。
 * 直接拿发布后的目标端当底稿，人改的段落下次就成了「我们发的」，会被 FRS 覆盖——保护只撑一轮，--absorb 也就没了意义。
 * 所以按旧底稿 → 发布后逐段对齐：
 *   - 这次写上去的（setInline / insert 的内容）、和 FRS 一致的、原样没动的 → 记发布后的文字；
 *   - 人改过、这次没动的 → 记旧底稿里的原文（下次照样认得出是人改的，清单里也还有「原」）；
 *   - 人加的 → 不记；人删掉的 → 旧底稿里的原文留着（下次照样不加回）；这次删掉的 → 不记。
 * @param base        这次发布用的底稿；null 时只能拿发布后的现状
 * @param beforeBody  这次提交补丁前的目标端正文（认 delete 的锚点删的是哪段）
 * @param afterBody   发布后回读的目标端正文
 * @param ops         这次提交的全部补丁
 * @param localBody   本地按 FRS 渲染的正文
 */
export function nextBase({ base, beforeBody, afterBody, ops, localBody }) {
  const after = tableParagraphs(afterBody).map(paraText);
  if (!base) return after;
  const written = new Set();
  const dropped = new Set();
  const byId = new Map(tableParagraphs(beforeBody).map((n) => [n[1]?.id, paraText(n)]));
  for (const op of ops) {
    if (op.op === "setInline") written.add(paraText(["p", {}, ...op.content]));
    else if (op.op === "insert") for (const block of op.content) written.add(paraText(block));
    else if (op.op === "delete") for (const id of op.anchors) if (byId.has(id)) dropped.add(byId.get(id));
  }
  const local = new Set(tableParagraphs(localBody).map(paraText));
  const ours = (t) => written.has(t) || local.has(t);
  const imageOnly = (t) => /^(\[图:[^\]]+\])+$/.test(t);
  const grams = (t) => new Set(Array.from({ length: Math.max(t.length - 1, 1) }, (_, k) => t.slice(k, k + 2)));
  const similarity = (i, j) => {
    const a = grams(base[i]);
    const b = grams(after[j]);
    let hit = 0;
    for (const g of a) if (b.has(g)) hit += 1;
    return (2 * hit) / (a.size + b.size);
  };
  const out = [];
  for (const step of pairRuns(diff(base, after), (side, k) => imageOnly(side === "base" ? base[k] : after[k]), similarity)) {
    if (step.type === "equal") out.push(after[step.j]);
    else if (step.type === "change") out.push(ours(after[step.j]) ? after[step.j] : base[step.i]);
    else if (step.type === "insert") {
      if (ours(after[step.j])) out.push(after[step.j]);
    } else if (!dropped.has(base[step.i])) out.push(base[step.i]);
  }
  return out;
}

/** cloudEdits 的结果写成一份给人和 Agent 看的清单（Markdown），按所在位置分节 */
export function cloudEditsReport(edits, { version }) {
  const count = (t) => edits.filter((e) => e.type === t).length;
  const open = edits.filter((e) => !e.synced).length;
  const out = [
    "# 目标端里的改动",
    "",
    `目标端第 ${version} 版对上次发布的底稿：改 ${count("change")} · 加 ${count("insert")} · 删 ${count("delete")}；FRS 里没有的 ${open} 处。`,
    "",
    "要留的改回 FRS.json（人插的图写 `{ \"image\": imageId, \"width\": 宽, \"height\": 高 }`，照下面 [图:imageId 宽×高] 抄）；不要的不用管。",
    "处理完，发布时加 `--absorb`：底稿换成目标端现状，这些段落按 FRS 改写或删掉。",
    "",
  ];
  const level = (e) => (e.level ? `（第 ${e.level} 级）` : "");
  let where = null;
  for (const e of edits) {
    if (e.where !== where) {
      where = e.where;
      out.push(`## ${where || "（表头）"}`, "");
    }
    const mark = e.synced ? "FRS 已同步" : "FRS 里没有";
    if (e.type === "change") out.push(`- 改${level(e)} · ${mark}`, `  - 原：${e.before}`, `  - 现：${e.after}`);
    else if (e.type === "insert") out.push(`- 加${level(e)} · ${mark}：${e.after}`);
    else out.push(`- 删 · ${e.synced ? "FRS 里也删了" : "FRS 里还在"}：${e.before}`);
  }
  return `${out.join("\n")}\n`;
}

/** 一批最多提交几个操作（目标端常有上限，参考适配器上 306 个被拒过；50 留足余量） */
export const OPS_PER_BATCH = 50;
/** 一个删除操作最多带几个锚点 */
export const ANCHORS_PER_DELETE = 50;

/** 相邻的删除并成一个：删的段落多时，操作数能少一大截 */
export function mergeDeletes(ops) {
  const out = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (op.op === "delete" && last?.op === "delete" && last.anchors.length + op.anchors.length <= ANCHORS_PER_DELETE) {
      last.anchors.push(...op.anchors);
    } else {
      out.push(op.op === "delete" ? { ...op, anchors: [...op.anchors] } : op);
    }
  }
  return out;
}

/** 按个数切批：每批锚点都是这批之后还在的段落，批与批之间互不依赖 */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 补丁按批提交：相邻删除先合并，再按 OPS_PER_BATCH 切批 */
export const batchOps = (ops) => chunk(mergeDeletes(ops), OPS_PER_BATCH);

/** 每张表按行、格取段落：[[[格里的段落…]…]…]，一张表一项；没有表格时是空数组 */
function tableGrids(body) {
  return topBlocks(body)
    .filter((b) => b[0] === "table")
    .map((table) =>
      table
        .slice(2)
        .filter((tr) => Array.isArray(tr) && tr[0] === "tr")
        .map((tr) => tr.slice(2).filter((tc) => Array.isArray(tc) && tc[0] === "tc").map((tc) => collectParagraphs(tc, []))),
    );
}

function parseArgs(argv) {
  const args = { key: null, cloud: null, base: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => inline ?? argv[++i];
    if (flag === "--cloud") args.cloud = take();
    else if (flag === "--base") args.base = take();
    else if (flag === "--out") args.out = take();
    else if (!flag.startsWith("-")) args.key = flag;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key || !args.cloud) {
    console.error("用法: npx builderharness prd-patch-ops <FEATURE_KEY> --cloud <fetch-jsonml 的输出> [--base <底稿>] [--out <文件>]");
    process.exitCode = 1;
    return;
  }

  const localOps = JSON.parse(await fs.readFile(path.join(PRD_DIR, args.key, "ops.json"), "utf8"));
  const cloudRaw = JSON.parse(await fs.readFile(args.cloud, "utf8"));
  const cloudBody = (cloudRaw.data?.result ?? cloudRaw.result ?? cloudRaw).body;
  const base = args.base ? JSON.parse(await fs.readFile(args.base, "utf8")) : null;
  const r = patchOps({ localBody: localOps[0].content, cloudBody, base });

  const outFile = args.out ? path.resolve(REPO_ROOT, args.out) : path.join(PRD_DIR, args.key, "patch-ops.json");
  await fs.writeFile(outFile, `${JSON.stringify(r.ops, null, 2)}\n`, "utf8");

  console.log(`目标端 ${r.cloudCount} 段 / 本地 ${r.localCount} 段 → 改写 ${r.summary.change}、新增 ${r.summary.insert}、删除 ${r.summary.delete}`);
  if (r.kept.length) console.log(`目标端有人改过、没动 ${r.kept.length} 段`);
  console.log(`补丁写入 ${path.relative(REPO_ROOT, outFile)}`);
  for (const line of r.lines) console.log(line);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
