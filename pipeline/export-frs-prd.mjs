#!/usr/bin/env node
/**
 * FRS 件套 → PRD 内容
 * ------------------------------------------------------------------
 * 把 docs/features/<KEY>/ 的 FRS.json 与 FLOW.md 渲染成一篇 PRD：
 *
 *   【PRD】<标题>
 *   ├─ 需求背景        ← FRS.background.problem / .solution
 *   └─ 需求描述
 *      ├─ 原型地址     ← .static-site-deploy.json 的域名 + prototype.entryRoute
 *      ├─ 方案设计     ← FLOW.md（Mermaid 原样带过去）
 *      └─ 功能点规则描述 ← FRS.spec，三列表格「功能点 | 参考图 | 规则描述」
 *
 * 产物走 JsonML 而不是 Markdown：功能点表格的单元格里有嵌套有序列表、黄底权限规则
 * 和多张配图，Markdown 表格全部表达不了；在线文档也不渲染 Markdown 里的 Mermaid 源码。
 *
 * 用法：
 *   npx builderharness export-frs-prd <KEY>
 *   npx builderharness export-frs-prd <KEY> --images docs/prd/<KEY>/images.json
 *   npx builderharness export-frs-prd <KEY> --scope delta
 *
 * `--scope delta` 只出需要研发迭代的功能点（`origin` 为 new / online-page-new / online-hardened），
 * 线上已有且本期不改的字段整条不渲染。这是「精简 PRD」的唯一正当做法——收窄的是
 * 功能范围，章节结构、四类规则与真源都不变；手写一份摘要发出去，下次迭代就对不上了。
 *
 * 产物（默认落在 docs/prd/<KEY>/）：
 *   ops.json      提交给 `word +update-jsonml --ops-file` 的 setBodyChildren 操作
 *   preview.md    本地评审用的降级预览，不用于发布
 *   shots.json    截图配方，交给 scripts/capture-shots.mjs
 *
 * 发布链路见 .agent/skills/prd-publish/SKILL.md，不要手动拼命令。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { FEATURES_DIR, PRD_DIR, REPO_ROOT, WEB_DIR } from "./lib/paths.mjs";

import {
  HEADER_FILL,
  INLINE_SHOT_WIDTH_PT,
  MIN_SHOT_HEIGHT_PT,
  PERM_BG,
  SHOT_WIDTH_PT,
  TABLE_COL_WIDTHS,
  blank,
  codeParagraph,
  heading,
  image,
  listItem,
  markdownToBlocks,
  newListId,
  p,
  pngSize,
  scaleToWidth,
  table,
  tc,
  tr,
} from "./lib/jsonml.mjs";

const DEPLOY_BINDING = path.join(WEB_DIR, ".static-site-deploy.json");

/** 规则四分类的渲染顺序与标签。权限规则单独成类，因为它是研发最容易漏的一条。 */
const RULE_SECTIONS = [
  { field: "display", label: "显示规则：" },
  { field: "interaction", label: "交互规则：" },
  { field: "value", label: "取值规则：" },
  { field: "permission", label: "权限规则：", bg: PERM_BG },
];

/** 研发迭代范围：本期新增（新页面 / 已有页面上）+ 线上已有但本期改过的。`online` 是照搬现状，不进 delta。 */
const DELTA_ORIGINS = new Set(["new", "online-page-new", "online-hardened"]);

/** 图例一个标签一条：长句挤在一段里不好扫，读者在已发布文档里会自己拆成列表 */
const FULL_LEGEND = [
  "功能点标题后的标签含义：",
  "**线上已有**＝线上已有、本期按现状落地；",
  "**线上已有 · 本期加固**＝已有字段，但本期改了交互 / 校验 / 说明；",
  "**已有页面 · 本期新增**＝页面线上已有，这块功能是新加的（新页签、新步骤、新区块）；",
  "**本期新增**＝新页面、新模块，或线上没有的数据与能力。",
];

const DELTA_LEGEND = [
  "本篇只列**本期需要研发迭代**的功能点：",
  "**本期新增**＝新页面、新模块，或线上没有的数据与能力；",
  "**已有页面 · 本期新增**＝页面线上已有，在上面加这块功能；",
  "**线上已有 · 本期加固**＝已有字段，本期改了交互 / 校验 / 说明，按下面的规则实现即可，不要当成全新字段重做。",
  "线上已有且本期不改的字段按现状实现，完整字段清单见 FRS 件套。",
];

/** 图例：总起一段，下面一个标签一条 */
function legendBlocks(scope) {
  const [lead, ...items] = scope === "delta" ? DELTA_LEGEND : FULL_LEGEND;
  const listId = newListId();
  return [p(lead), ...items.map((line) => listItem(line, { listId }))];
}

/** 需求背景的一条：字符串，或 `{ text, children }`（下面再分子条） */
function backgroundItems(lines, listId) {
  return (lines ?? []).flatMap((line) =>
    typeof line === "string"
      ? [listItem(line, { listId, level: 1 })]
      : [listItem(line.text, { listId, level: 1 }), ...(line.children ?? []).map((c) => listItem(c, { listId, level: 2 }))],
  );
}

// ---------------------------------------------------------------- 正文构造

/**
 * @param {object} frs
 * @param {string} flowMarkdown
 * @param {{ prototypeUrl: string | null, images: Record<string, object>, warnings?: string[] }} context
 *   warnings 由调用方传入收集，目前只记「参考图会渲染成点不开的纸片」。
 * @returns {Array} 块节点数组，直接作为 setBodyChildren 的 content
 */
/**
 * 追加片段：一个二级标题 + 原型地址 + 方案设计 + 功能点表。
 *
 * 用在「一篇已评审的文档里再加一个需求」的场景：这时不能用 `setBodyChildren`，
 * 那会连别人评审过的正文一起覆盖掉。片段由调用方以 `insert` 挂到文末。
 */
export function buildFragment(frs, flowMarkdown, { prototypeUrl, images, warnings = [], scope = "all" }) {
  const blocks = [heading(2, frs.title)];

  const bgList = newListId();
  const bold = { bold: true };
  blocks.push(listItem("**解决什么问题：**", { listId: bgList, textStyle: bold }));
  blocks.push(...backgroundItems(frs.background?.problem, bgList));
  blocks.push(listItem("**如何解决：**", { listId: bgList, textStyle: bold }));
  blocks.push(...backgroundItems(frs.background?.solution, bgList));

  if (prototypeUrl) blocks.push(p(`原型地址：[${prototypeUrl}](${prototypeUrl})`));

  blocks.push(heading(3, "方案设计"));
  blocks.push(...markdownToBlocks(flowMarkdown));

  blocks.push(heading(3, "功能点规则描述"));
  blocks.push(...legendBlocks(scope));
  blocks.push(buildSpecTable(frs.spec ?? [], frs.shots ?? {}, images, warnings));

  return blocks;
}

export function buildBody(frs, flowMarkdown, { prototypeUrl, images, warnings = [], scope = "all" }) {
  const blocks = [heading(0, `【PRD】${frs.title}`)];

  blocks.push(heading(2, "需求背景"));
  const bgList = newListId();
  const bold = { bold: true };
  blocks.push(listItem("**解决什么问题：**", { listId: bgList, textStyle: bold }));
  blocks.push(...backgroundItems(frs.background?.problem, bgList));
  blocks.push(listItem("**如何解决：**", { listId: bgList, textStyle: bold }));
  blocks.push(...backgroundItems(frs.background?.solution, bgList));

  blocks.push(heading(2, "需求描述"));
  if (prototypeUrl) blocks.push(p(`原型地址：[${prototypeUrl}](${prototypeUrl})`));

  blocks.push(heading(3, "方案设计"));
  blocks.push(...markdownToBlocks(flowMarkdown));

  blocks.push(heading(3, "功能点规则描述"));
  // 每个功能点标题后的括号标签从 FRS.point.origin 来，四种取值见 originLabel()。
  // 研发读 PRD 时要先分清「照搬线上」和「本期改了什么」，否则会把加固当成全新字段重做。
  blocks.push(...legendBlocks(scope));
  blocks.push(buildSpecTable(frs.spec ?? [], frs.shots ?? {}, images, warnings));

  return blocks;
}

function buildSpecTable(spec, shotDefs, images, warnings) {
  const rows = [
    tr(
      ["功能点", "参考图", "规则描述"].map((label) =>
        tc([p(`**${label}**`)], { fill: HEADER_FILL }),
      ),
    ),
  ];

  for (const group of spec) {
    rows.push(
      tr([
        // 分组名用五级标题：长文档靠目录跳到某一页
        tc([heading(5, group.group)]),
        // 参考图是截图配方的 key；人在已发布文档参考图格里插的图同步回来写 { image, width, height }，原样放回
        tc((group.shots ?? []).map((key) => (key?.image ? image({ imageId: key.image, width: key.width, height: key.height }) : shotNode(key, shotDefs, images, SHOT_WIDTH_PT, null, warnings)))),
        tc(ruleCell(group.points ?? [], shotDefs, images, warnings)),
      ]),
    );
  }

  return table(rows, TABLE_COL_WIDTHS);
}

/**
 * 没拿到 imageId 时退化成一行占位文字，而不是静默跳过——
 * 少一张配图要在文档里看得见，否则没人会想起来补。
 */
function shotNode(key, shotDefs, images, widthPt, listOpts, warnings) {
  const caption = shotDefs[key]?.caption ?? key;
  const uploaded = images[key];
  if (!uploaded?.imageId) {
    const text = `（待补参考图：${caption}）`;
    return listOpts ? listItem(text, listOpts) : p(text);
  }

  const size = scaleToWidth(uploaded.size, widthPt);
  if (size.height < MIN_SHOT_HEIGHT_PT) {
    const ratio = (size.width / size.height).toFixed(1);
    warnings.push(
      `«${key}» 宽高比 ${ratio}:1，渲染出来只有 ${size.height}pt 高，文档里点不开；` +
        `给它加 "trim": true 或换一个更贴内容的 clip`,
    );
  }

  const node = image({ imageId: uploaded.imageId, ...size, description: caption });
  if (!listOpts) return node;
  const [, attrs, ...children] = node;
  const list = { level: listOpts.level ?? 0, listId: listOpts.listId, type: "ordered" };
  return ["p", { ...attrs, list }, ...children];
}

/**
 * 按 scope 收窄功能点。收窄发生在渲染之前，正文与预览共用同一份结果，
 * 两边不会漂移；分组内一个功能点都不剩时整组丢掉，避免留下空行的表格行。
 *
 * @param {Array} spec
 * @param {"all" | "delta"} scope
 */
export function filterSpecByScope(spec, scope) {
  if (scope !== "delta") return spec;
  return spec
    .map((group) => ({
      ...group,
      points: (group.points ?? []).filter((point) => DELTA_ORIGINS.has(point.origin)),
    }))
    .filter((group) => group.points.length > 0);
}

/** 收窄后仍被引用的截图 key，用来剔掉「只服务于被过滤掉的功能点」的那几张图。 */
function referencedShots(spec) {
  const keys = new Set();
  const walk = (rule) => {
    if (typeof rule === "string") return;
    if (rule.shot) {
      keys.add(rule.shot);
      return;
    }
    for (const child of rule.children ?? []) walk(child);
  };
  for (const group of spec) {
    for (const key of group.shots ?? []) if (typeof key === "string") keys.add(key);
    for (const point of group.points ?? []) {
      for (const section of RULE_SECTIONS) {
        for (const rule of point[section.field] ?? []) walk(rule);
      }
    }
  }
  return keys;
}

function originLabel(origin) {
  if (origin === "online") return "线上已有";
  if (origin === "online-hardened") return "线上已有 · 本期加固";
  if (origin === "online-page-new") return "已有页面 · 本期新增";
  if (origin === "new") return "本期新增";
  return "";
}

function ruleCell(points, shotDefs, images, warnings) {
  const blocks = [];

  points.forEach((point, index) => {
    if (index > 0) blocks.push(blank());
    if (point.name) {
      const tag = originLabel(point.origin);
      blocks.push(p(tag ? `**${point.name}**（${tag}）` : `**${point.name}**`));
    }

    for (const section of RULE_SECTIONS) {
      const rules = point[section.field];
      if (!Array.isArray(rules) || rules.length === 0) continue;

      // 分类标签是普通段落，其下的规则各自起一个列表，编号从 1 重新开始
      blocks.push(p(section.label, section.bg ? { bg: section.bg } : undefined));
      const listId = newListId();
      const textStyle = section.bg ? { bg: section.bg } : undefined;
      for (const rule of rules) {
        blocks.push(...ruleNodes(rule, { listId, level: 0, textStyle }, shotDefs, images, warnings));
      }
    }
  });

  return blocks;
}

function ruleNodes(rule, opts, shotDefs, images, warnings) {
  if (typeof rule === "string") return [listItem(rule, opts)];

  if (rule.shot) {
    return [shotNode(rule.shot, shotDefs, images, INLINE_SHOT_WIDTH_PT, opts, warnings)];
  }
  // 结构化的示例（请求体、证据格式）用代码块，比在一句话里列字段好读；不编号，跟在它说明的那条下面
  if (rule.code) return [codeParagraph(rule.code, rule.lang)];
  // 人在已发布文档里插的图：同步回 FRS 时记它的 imageId 与尺寸，照原样放回，不换成截图
  if (rule.image) return [image({ imageId: rule.image, width: rule.width, height: rule.height })];

  const nodes = [listItem(rule.text ?? "", opts)];
  for (const child of rule.children ?? []) {
    const deeper = { ...opts, level: (opts.level ?? 0) + 1 };
    nodes.push(...ruleNodes(child, deeper, shotDefs, images, warnings));
  }
  return nodes;
}

// ---------------------------------------------------------------- 协议自检

/**
 * 提交前把协议硬约束过一遍。JsonML 更新是原子的——任一节点违规整批回滚，
 * 报回来只有一个操作下标，比在这里指出是哪张图、哪个列表难查得多。
 *
 * @param {Array} blocks setBodyChildren 的 content
 * @returns {string[]} 违规说明，空数组表示通过
 */
export function validateBody(blocks) {
  const problems = [];

  if (blocks[0]?.[0] === "root") problems.push("content 不能用 root 包装");
  if (blocks[0]?.[0] === "table") problems.push("首块是 table，服务端会在前面补一个空段，回读会对不上");

  (function walk(node, path) {
    if (!Array.isArray(node)) return;
    const [tag, attrs = {}, ...children] = node;

    if (tag === "p") {
      const blockEntities = children.filter((c) => Array.isArray(c) && c[0] === "mermaid");
      if (blockEntities.length > 0 && children.length > 1) {
        problems.push(`${path}: mermaid 必须独占段落，当前同段还有 ${children.length - 1} 个兄弟节点`);
      }
    }

    if (attrs.list && !String(attrs.list.listId).startsWith("vodka.")) {
      problems.push(`${path}: listId «${attrs.list.listId}» 缺 vodka. 前缀，服务端会拒`);
    }

    if (tag === "image") {
      if (!attrs.imageId) problems.push(`${path}: image 缺 imageId`);
      if (!(attrs.width > 0) || !(attrs.height > 0)) {
        problems.push(`${path}: image 缺尺寸，CLI 会按原始像素折算 pt 把版面撑破`);
      }
    }

    if (tag === "table") {
      const rows = children.filter((c) => Array.isArray(c) && c[0] === "tr");
      if (attrs.rows !== rows.length) problems.push(`${path}: table.rows=${attrs.rows} 与实际 ${rows.length} 行不符`);
      for (const [index, row] of rows.entries()) {
        const cells = row.slice(2).filter((c) => Array.isArray(c) && c[0] === "tc");
        if (cells.length !== attrs.cols) {
          problems.push(`${path}/tr[${index}]: ${cells.length} 格，表格声明 ${attrs.cols} 列`);
        }
      }
    }

    children.forEach((child, index) => walk(child, `${path}/${tag}[${index}]`));
  })(["root", {}, ...blocks], "");

  return problems;
}

// ---------------------------------------------------------------- 降级预览

/** 本地评审用。刻意保持朴素：它只用来 diff 和通读，不参与发布。 */
function buildPreview(frs, flowMarkdown, { prototypeUrl, scope = "all" }) {
  const out = [`# 【PRD】${frs.title}`, "", "## 需求背景", ""];

  out.push("1. **解决什么问题：**");
  const bgLines = (lines) => (lines ?? []).flatMap((l) => (typeof l === "string" ? [`    1. ${l}`] : [`    1. ${l.text}`, ...(l.children ?? []).map((c) => `        1. ${c}`)]));
  out.push(...bgLines(frs.background?.problem));
  out.push("2. **如何解决：**");
  out.push(...bgLines(frs.background?.solution));

  out.push("", "## 需求描述", "");
  if (prototypeUrl) out.push(`原型地址：${prototypeUrl}`, "");
  out.push("### 方案设计", "", flowMarkdown.trim(), "", "### 功能点规则描述", "");
  const [legendLead, ...legendItems] = scope === "delta" ? DELTA_LEGEND : FULL_LEGEND;
  out.push(legendLead, "", ...legendItems.map((l) => `1. ${l}`), "");

  for (const group of frs.spec ?? []) {
    out.push(`#### ${group.group}　\`${group.route}\``, "");
    const shots = (group.shots ?? []).map((key) => (typeof key === "string" ? key : "[图]")).join("、");
    if (shots) out.push(`> 参考图：${shots}`, "");
    for (const point of group.points ?? []) {
      if (point.name) {
        const tag = originLabel(point.origin);
        out.push(tag ? `**${point.name}**（${tag}）` : `**${point.name}**`, "");
      }
      for (const section of RULE_SECTIONS) {
        const rules = point[section.field];
        if (!Array.isArray(rules) || rules.length === 0) continue;
        out.push(section.label);
        rules.forEach((rule, i) => out.push(...previewRule(rule, i + 1, "")));
        out.push("");
      }
      if (point.ac?.length) out.push(`验收：${point.ac.join("、")}`, "");
    }
  }

  return out.join("\n");
}

function previewRule(rule, index, indent) {
  if (typeof rule === "string") return [`${indent}${index}. ${rule}`];
  if (rule.shot) return [`${indent}${index}. （参考图：${rule.shot}）`];
  if (rule.image) return [`${indent}（已发布文档里插的图）`];
  if (rule.code) return [`${indent}\`\`\`${rule.lang ?? ""}`, ...rule.code.split("\n").map((l) => `${indent}${l}`), `${indent}\`\`\``];
  const lines = [`${indent}${index}. ${rule.text ?? ""}`];
  (rule.children ?? []).forEach((child, i) =>
    lines.push(...previewRule(child, i + 1, `${indent}    `)),
  );
  return lines;
}

// ---------------------------------------------------------------- 输入

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readPrototypeUrl(frs) {
  const route = frs.prototype?.entryRoute;
  if (!route) return null;
  try {
    const { domain } = await readJson(DEPLOY_BINDING);
    if (!domain) return null;
    const origin = domain.startsWith("http") ? domain : `https://${domain}`;
    // 路由是 hash 模式，链接必须带 #，否则深层链接在静态托管上 404
    return `${origin.replace(/\/$/, "")}/#${route}`;
  } catch {
    return null;
  }
}

/**
 * 读取截图上传结果。`word +append-image` 只回 imageId，图片尺寸得自己从 PNG 头里量，
 * 因为 CLI 按原始像素直接折算 pt，不给尺寸会把大图写到撑破版面。
 */
async function readImages(mapFile, shotsDir) {
  if (!mapFile) return {};
  const raw = await readJson(path.resolve(REPO_ROOT, mapFile));
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const imageId = typeof value === "string" ? value : value.imageId;
    if (!imageId) continue;
    let size = null;
    try {
      size = pngSize(await fs.readFile(path.join(shotsDir, `${key}.png`)));
    } catch {
      size = null;
    }
    out[key] = { imageId, size };
  }
  return out;
}

function parseArgs(argv) {
  const args = { key: null, images: null, outDir: null, scope: "all", appendAfter: null };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => inline ?? argv[++i];
    if (flag === "--images") args.images = take();
    else if (flag === "--out-dir") args.outDir = take();
    else if (flag === "--scope") args.scope = take();
    else if (flag === "--append-after") args.appendAfter = take();
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (!flag.startsWith("-")) args.key = flag;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.key) {
    console.log(
      [
        "用法: npx builderharness export-frs-prd <FEATURE_KEY> [选项]",
        "",
        "  --images <路径>   截图上传结果 {shotKey: imageId}，缺省则参考图列留占位",
        "  --out-dir <路径>  产物目录，默认 docs/prd/<FEATURE_KEY>/",
        "  --scope <范围>    all（默认，全部功能点）| delta（只出本期要研发迭代的）",
        "  --append-after <锚点>  片段模式：生成 insert 操作追加到已有文档的该锚点之后，",
        "                         正文不整篇覆盖（用于往一篇已评审的 PRD 里加一个需求）。",
        "                         文末追加用 @docEnd——insert 只接受段落类锚点，",
        "                         末块是表格时给表 id 会报 NOT_SUPPORTED",
      ].join("\n"),
    );
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  if (args.scope !== "all" && args.scope !== "delta") {
    console.error(`--scope 只接受 all 或 delta，收到 «${args.scope}»`);
    process.exitCode = 1;
    return;
  }

  const featureDir = path.join(FEATURES_DIR, args.key);
  const source = await readJson(path.join(featureDir, "FRS.json"));
  if (!Array.isArray(source.spec) || source.spec.length === 0) {
    console.error(`${args.key}/FRS.json 没有 spec 字段，先按 docs/templates/FRS.json 补齐功能点规则。`);
    process.exitCode = 1;
    return;
  }

  const spec = filterSpecByScope(source.spec, args.scope);
  if (spec.length === 0) {
    console.error(
      `--scope ${args.scope} 过滤后一个功能点都不剩：${args.key} 的功能点 origin 全是 online，没有本期要研发迭代的范围。`,
    );
    process.exitCode = 1;
    return;
  }
  const frs = { ...source, spec };

  const flowMarkdown = await fs.readFile(path.join(featureDir, "FLOW.md"), "utf8").catch(() => "");
  const prototypeUrl = await readPrototypeUrl(frs);
  const images = await readImages(args.images, path.join(featureDir, "shots"));

  const warnings = [];
  // `--append-after` 走片段模式：往一篇**已有正文**的文末追加，别人评审过的内容不动
  const appending = Boolean(args.appendAfter);
  const build = appending ? buildFragment : buildBody;
  const body = build(frs, flowMarkdown, { prototypeUrl, images, warnings, scope: args.scope });

  const problems = validateBody(body);
  if (problems.length > 0) {
    console.error("JsonML 协议自检未通过，不生成产物：");
    for (const line of problems) console.error(`  ✗ ${line}`);
    process.exitCode = 1;
    return;
  }

  const outDir = args.outDir ? path.resolve(REPO_ROOT, args.outDir) : path.join(PRD_DIR, args.key);
  await fs.mkdir(outDir, { recursive: true });

  const op = appending
    ? { op: "insert", anchor: args.appendAfter, position: "after", content: body }
    : { op: "setBodyChildren", content: body };
  await fs.writeFile(path.join(outDir, "ops.json"), `${JSON.stringify([op], null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(outDir, "preview.md"),
    `${buildPreview(frs, flowMarkdown, { prototypeUrl, scope: args.scope })}\n`,
    "utf8",
  );
  // order 固定截图顺序：`word +append-image` 按 --image 出现顺序回 imageId，
  // 两边必须用同一个序列对齐，否则图会错位到别的功能点上。
  // delta 下只留仍被引用的图，否则会去抓一批正文里根本不出现的截图。
  const kept = args.scope === "delta" ? referencedShots(spec) : null;
  const order = Object.keys(frs.shots ?? {}).filter((key) => !kept || kept.has(key));
  await fs.writeFile(
    path.join(outDir, "shots.json"),
    `${JSON.stringify(
      {
        key: args.key,
        order,
        files: order.map((k) => path.join(featureDir, "shots", `${k}.png`)),
        shots: frs.shots ?? {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const points = spec.reduce((n, g) => n + (g.points?.length ?? 0), 0);
  const allPoints = source.spec.reduce((n, g) => n + (g.points?.length ?? 0), 0);
  const missing = order.filter((k) => !images[k]);
  const rel = path.relative(REPO_ROOT, outDir);

  console.log(
    `已生成 ${rel}/：${spec.length} 个分组、${points} 个功能点` +
      (args.scope === "delta" ? `（--scope delta，全量 ${allPoints} 个里的研发迭代范围）` : ""),
  );
  if (!prototypeUrl) console.log("原型地址为空：FRS.prototype.entryRoute 或 原型工程的 .static-site-deploy.json 缺失");
  if (missing.length > 0) console.log(`参考图待补 ${missing.length} 张：${missing.join("、")}`);
  for (const line of warnings) console.log(`  提醒 ${line}`);
  console.log("");
  console.log("下一步走 builderharness prd：截图 → 建文档 → 追图拿 imageId → 重新导出 → setBodyChildren → 回读校验");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
