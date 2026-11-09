import { useMemo } from "react";

import { renderMarkdown } from "../studio/md-lite";
import { openRef } from "./store";

/**
 * 待决清单一格的原文 → HTML。Markdown 渲染借审阅台的 md-lite（不另写一份）；
 * 服务认出来的引用（事实 N、A3、〈节名〉、日期「…」、需求 KEY）先换成占位符，渲染后再换成按钮，
 * 点了在右边就地看原文。占位符用私用区字符：转义、加粗、行内代码都不碰它。
 */
const OPEN = "";
const CLOSE = "";
const PIPE = "";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const REF_KIND = {
  fact: "已经确认的事实",
  item: "同一份的另一条",
  section: "本 README 的一节",
  legacy: "项目事实记录",
  decision: "DECISIONS 里的决定",
  feature: "另一份需求",
  "feature-item": "另一份需求的一条",
};

/** 一段 Markdown（引用的原文、README 的一节）。表格里的 \| 是转义竖线，md-lite 不认，先收起来 */
export function renderBlock(md) {
  return renderMarkdown(String(md ?? "").replace(/\\\|/g, PIPE)).replace(new RegExp(PIPE, "g"), "|");
}

/**
 * 长格子排成段落和列表。表格里一格只能写一行，长建议就成了一整段；这里按写法约定拆开，README 原文不动：
 *   开头加粗的一句（结论）后面隔着空格的，单独一段；
 *   其余按句号分段；「理由：一；二；三」这种「短标签：」后面跟着几条的，标签一行、几条成列表；
 *   一句里有 ①②③ 的，按编号成列表；没有标签、分号隔开三条以上的，也成列表。
 * 括号、引号、加粗、行内代码里的标点不算断点。格子里写了 <br> 的，按人写的换行走，不再自动拆
 */
const OPEN_BR = "（(「【“《‘";
const CLOSE_BR = "）)」】”》’";
const CIRCLED = /[\u2460-\u2473]/;

/** 每个位置是不是在最外层：不在括号、引号、加粗、行内代码里 */
function topLevel(s) {
  const top = new Array(s.length).fill(false);
  let depth = 0;
  let bold = false;
  let code = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "`") code = !code;
    else if (code) continue;
    else if (c === "*" && s[i + 1] === "*") {
      bold = !bold;
      i += 1;
    } else if (OPEN_BR.includes(c)) depth += 1;
    else if (CLOSE_BR.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && !bold) top[i] = true;
  }
  return top;
}

const cutAt = (s, idx) => idx.reduce((parts, at, k) => [...parts.slice(0, -1), parts.at(-1).slice(0, at - (idx[k - 1] ?? 0)), s.slice(at)], [s]);
const tidy = (x) => x.trim().replace(/[；;，,。]+$/, "").trim();
const visible = (x) => x.replace(/\*\*|`/g, "").replace(new RegExp(`${OPEN}\\d+${CLOSE}`, "g"), "某").length;

/** 拆成几条：有两个以上 ①②③ 按编号，否则按最外层的分号。返回 { lead, items } */
function itemsOf(s) {
  const top = topLevel(s);
  const marks = s.split("").map((c, i) => (top[i] && CIRCLED.test(c) ? i : -1)).filter((i) => i >= 0);
  if (marks.length >= 2) {
    const parts = cutAt(s, marks);
    return { lead: tidy(parts[0]), items: parts.slice(1).map(tidy).filter(Boolean) };
  }
  const semis = s.split("").map((c, i) => (top[i] && c === "；" ? i + 1 : -1)).filter((i) => i > 0);
  return { lead: "", items: cutAt(s, semis).map(tidy).filter(Boolean) };
}

function sentenceBlock(sent) {
  const top = topLevel(sent);
  const colon = sent.split("").findIndex((c, i) => top[i] && c === "：");
  // 「理由：一；二」：冒号前是个短标签，后面至少两条
  if (colon > 0 && visible(sent.slice(0, colon)) <= 30) {
    const { lead, items } = itemsOf(sent.slice(colon + 1));
    if (items.length >= 2) return [`${sent.slice(0, colon + 1)}${lead ? ` ${lead}` : ""}`, ...items.map((x) => `- ${x}`)].join("\n");
  }
  const { lead, items } = itemsOf(sent);
  const numbered = CIRCLED.test(items[0] ?? "") && items.length >= 2;
  if (numbered || items.length >= 3) return [lead, ...items.map((x) => `- ${x}`)].filter(Boolean).join("\n");
  return sent.trim();
}

export function structure(s) {
  if (s.includes("\n")) return s;
  let rest = s.trim();
  const blocks = [];
  // 开头加粗的结论后面隔着空格接理由：结论单独一段
  const head = /^\*\*[^*]+\*\*(?=\s)/.exec(rest);
  if (head) {
    blocks.push(head[0]);
    rest = rest.slice(head[0].length).trim();
  }
  const top = topLevel(rest);
  const ends = rest.split("").map((c, i) => (top[i] && c === "。" ? i + 1 : -1)).filter((i) => i > 0 && i < rest.length);
  for (const sent of cutAt(rest, ends)) if (sent.trim()) blocks.push(sentenceBlock(sent.trim()));
  return blocks.join("\n\n");
}

/** @param opts.block 长格子：排成段落与列表（见 structure） */
export function renderCell(text, refs = [], { block = false } = {}) {
  let s = "";
  let at = 0;
  refs.forEach((r, i) => {
    s += `${text.slice(at, r.start)}${OPEN}${i}${CLOSE}`;
    at = r.end;
  });
  s += text.slice(at);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  if (block) s = structure(s);
  // 已经带 ①②③ 的列表不再加圆点
  const html = renderBlock(s)
    .trim()
    .replace(/<ul>(?=<li>[\u2460-\u2473])/g, '<ul class="is-numbered">');
  // 只有一段话：去掉外层 <p>，嵌在别的元素里不多出段距
  const body = /^<p>[\s\S]*<\/p>$/.test(html) && html.indexOf("<p>", 1) < 0 ? html.slice(3, -4) : html;
  return body.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_, i) => {
    const r = refs[Number(i)];
    if (!r) return "";
    return `<button type="button" class="dc-ref is-${r.kind}" data-ref="${i}" title="${esc(REF_KIND[r.kind] ?? "")}：点开看原文">${esc(r.label)}</button>`;
  });
}

/** 一格：渲染好的原文，里面的引用能点。block 的长格子排成段落与列表 */
export function Cell({ text, refs, block = false, as: Tag = "div", className, ...rest }) {
  const html = useMemo(() => renderCell(text ?? "", refs ?? [], { block }), [text, refs, block]);
  const onClick = (e) => {
    const b = e.target.closest?.("[data-ref]");
    if (!b) return;
    const r = refs[Number(b.getAttribute("data-ref"))];
    if (r) openRef(r);
  };
  // 点击交给里面的按钮（它们自己可聚焦、回车可按），外层只做事件委托
  return <Tag {...rest} className={[className, block && "dc-rich"].filter(Boolean).join(" ")} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
