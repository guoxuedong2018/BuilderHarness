/**
 * JsonML 节点构造与 Markdown 子集转换。
 *
 * 节点形状逐一对照线上 PRD 文档 `word +fetch-jsonml` 的读取结果，协议见
 * the docs-cli JsonML reference.
 * 读写同构：这里构造出来的就是读回来的形状。
 */

/** 段落行高，与线上文档一致 */
const LH_BODY = 1.45;
/** 标题行高 */
const LH_HEADING = 1.25;

/** `{$变量}` 占位符的灰色 */
export const VAR_COLOR = "#787b80";
/** `“ⓘ 文案”` 的灰色：界面上 ⓘ 里的说明，和规则正文分开读 */
export const COPY_COLOR = VAR_COLOR;
/** `==重点==` 的飘色。刻意避开链接蓝，否则会被当成可点 */
export const EMPHASIS_COLOR = "#d4380d";
/** 权限规则的黄色底纹 */
export const PERM_BG = "#fffaba";
/** 表头单元格填充色 */
export const HEADER_FILL = "#ebedf0";
/** 超链接文字色 */
export const LINK_COLOR = "#2374d1";

/** 功能点表三列宽度（pt）：功能点 / 参考图 / 规则描述 */
export const TABLE_COL_WIDTHS = [105, 210, 414];
/** 参考图列的图片宽度（pt），略窄于列宽留出内边距 */
export const SHOT_WIDTH_PT = 190;
/** 规则描述列内联图片宽度（pt） */
export const INLINE_SHOT_WIDTH_PT = 339;
/**
 * 参考图的最低渲染高度（pt）。低于这个值在文档里就是一条纸片，点不开也看不清。
 * 按 190pt 列宽算，它等价于「宽高比不得超过约 9.5:1」。
 */
export const MIN_SHOT_HEIGHT_PT = 20;

let listSeq = 0;

/**
 * 生成新列表的 listId。服务端只接受 `vodka.` 前缀，自造前缀会被拒。
 * 每调用一次就是一个新列表，编号从 1 重新开始。
 */
export function newListId() {
  listSeq += 1;
  return `vodka.prd${listSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- 行内

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*)|(==[^=]+==)|(`[^`]+`)|(\[[^\]]*\]\([^)]+\))|(\{\$[^}]+\})|(【[^】]+】)|(「[^」]+」)|(“[^”]+”)/g;

/**
 * 把一行 Markdown 文本切成 text run 数组。
 *
 * 除了 `**粗体**`、`` `行内代码` ``、`[文字](链接)`、`{$变量}`（灰色），
 * 还对 PRD 里高频的两类记号自动加粗，让规则能扫读而不必逐字读：
 *
 * - `【动作】` —— 按钮与文字链
 * - `「元素」` —— 字段、筛选项、页签、状态名
 *
 * 作者要强调整句话时用 `==重点==`，渲染成加粗飘色。
 * 界面上 ⓘ 里的说明文案写在 `“…”` 里，连引号渲染成斜体灰字：读的人一眼分得清哪句是要照抄上界面的文案。
 * 记号内部会递归解析，所以 `【选择全部 {$总数} 条】` 里的变量仍然是灰的。
 *
 * @param {string} raw
 * @param {object} [base] 叠加在每个 run 上的样式，如 `{ bg: PERM_BG }`
 * @returns {Array} text 节点数组
 */
export function inlines(raw, base = {}) {
  const out = [];
  const push = (content, style = {}) => {
    if (content === "") return;
    out.push(["text", { ...base, ...style }, content]);
  };
  /** 记号内部递归解析，保留外层样式并叠加本层样式 */
  const nest = (inner, style) => out.push(...inlines(inner, { ...base, ...style }));

  let cursor = 0;
  for (const match of raw.matchAll(INLINE_PATTERN)) {
    push(raw.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nest(token.slice(2, -2), { bold: true });
    } else if (token.startsWith("==")) {
      nest(token.slice(2, -2), { bold: true, color: EMPHASIS_COLOR });
    } else if (token.startsWith("`")) {
      push(token.slice(1, -1), { code: true });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      push(token.slice(1, split), {
        color: LINK_COLOR,
        link: { url: token.slice(split + 2, -1) },
      });
    } else if (token.startsWith("{$")) {
      push(token, { color: VAR_COLOR });
    } else if (token.startsWith("“")) {
      const copy = { italic: true, color: COPY_COLOR };
      push("“", copy);
      nest(token.slice(1, -1), copy);
      push("”", copy);
    } else {
      // 【动作】与「元素」连括号一起加粗，括号本身也是视觉标记的一部分。
      // 必须先剥掉括号再递归，否则内层会再次匹配到同一对括号、无限递归。
      push(token[0], { bold: true });
      nest(token.slice(1, -1), { bold: true });
      push(token[token.length - 1], { bold: true });
    }
    cursor = match.index + token.length;
  }
  push(raw.slice(cursor));

  return out.length > 0 ? out : [["text", { ...base }, ""]];
}

// ---------------------------------------------------------------- 块级

/** 普通段落 */
export function p(raw, base) {
  return ["p", { lh: LH_BODY }, ...inlines(raw, base)];
}

/** 空段落，用作区块之间的呼吸 */
export function blank() {
  return ["p", { lh: LH_BODY }];
}

/** 标题；level 0 是文档大标题，1~6 对应 h1~h6 */
export function heading(level, raw) {
  const tag = level === 0 ? "title" : `h${level}`;
  const attrs = level === 0 ? {} : { lh: LH_HEADING };
  return [tag, attrs, ...inlines(raw)];
}

/** 引用块 */
export function quote(raw) {
  return ["quote", { lh: LH_BODY }, ...inlines(raw)];
}

/**
 * 列表项。列表项在协议里就是带 `list` 属性的段落，不是独立标签。
 *
 * @param {string} raw 文本
 * @param {{ listId: string, level?: number, ordered?: boolean, textStyle?: object }} opts
 */
export function listItem(raw, { listId, level = 0, ordered = true, textStyle }) {
  const list = { level, listId, type: ordered ? "ordered" : "bullet" };
  if (textStyle) list.textStyle = textStyle;
  const base = textStyle?.bg ? { bg: textStyle.bg } : undefined;
  return ["p", { lh: LH_BODY, list }, ...inlines(raw, base)];
}

/** Mermaid 必须独占段落，不能与文字混排 */
export function mermaid(code) {
  return ["p", { lh: LH_BODY }, ["mermaid", { code, theme: "default", viewMode: "all" }]];
}

/** 代码块 */
export function codeBlock(code, language) {
  return ["codeBlock", language ? { language } : {}, ["text", {}, code]];
}

/** 段落里的代码块：表格单元格里的代码块要独占一个段落（同 Mermaid） */
export function codeParagraph(code, language) {
  return ["p", { lh: LH_BODY }, codeBlock(code, language)];
}

/** 图片独占段落 */
export function image({ imageId, width, height, description }) {
  const attrs = { imageId, width, height, link: "" };
  if (description) {
    attrs.description = description;
    attrs.descVisible = true;
  }
  return ["p", { lh: LH_BODY }, ["image", attrs]];
}

/** 表格单元格；`blocks` 是块节点数组 */
export function tc(blocks, { fill } = {}) {
  const attrs = fill ? { cellStyle: { fill } } : {};
  const children = blocks.length > 0 ? blocks : [["p", {}]];
  return ["tc", attrs, ...children];
}

/** 表格行 */
export function tr(cells) {
  return ["tr", {}, ...cells];
}

/** 表格；`colWidths` 单位 pt */
export function table(rows, colWidths) {
  const attrs = { cols: colWidths.length, rows: rows.length };
  attrs.tableStyle = {
    cols: colWidths.map((widthVal) => ({ widthType: "points", widthVal })),
  };
  return ["table", attrs, ...rows];
}

// ---------------------------------------------------------------- Markdown 子集

/**
 * 把 FLOW.md 这类文档转成 JsonML 块数组。
 *
 * 支持：标题、段落、有序/无序列表（含缩进嵌套）、围栏代码块（mermaid 走原生
 * mermaid 实体）、引用块、管道表格、分隔线。PRD 里「方案设计」一节整段由它产出。
 *
 * @param {string} markdown
 * @param {{ headingLevel?: number | null }} [opts]
 *   headingLevel 为 null 时把所有 Markdown 标题降级成加粗段落——PRD 里
 *   「方案设计」已经是 h3，再套 h1/h2 会把文档大纲搅乱。
 * @returns {Array} 块节点数组
 */
export function markdownToBlocks(markdown, { headingLevel = null } = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let quoteBuffer = [];
  /** @type {{ listId: string, ordered: boolean } | null} */
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(p(paragraph.join(" ")));
    paragraph = [];
  };
  const flushQuote = () => {
    if (quoteBuffer.length === 0) return;
    blocks.push(quote(quoteBuffer.join(" ")));
    quoteBuffer = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
  };
  const endList = () => {
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushAll();
      endList();
      const language = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const code = dedent(body).join("\n");
      blocks.push(language === "mermaid" ? mermaid(code) : codeBlock(code, language));
      continue;
    }

    // 管道表格
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      flushAll();
      endList();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      if (rows.length > 0) {
        const width = Math.round(660 / rows[0].length);
        blocks.push(
          table(
            rows.map((cells, index) =>
              tr(
                cells.map((cell) =>
                  tc([p(index === 0 ? `**${cell}**` : cell)], {
                    fill: index === 0 ? HEADER_FILL : undefined,
                  }),
                ),
              ),
            ),
            rows[0].map(() => width),
          ),
        );
      }
      continue;
    }

    // 标题
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushAll();
      endList();
      const depth = head[1].length;
      blocks.push(
        headingLevel === null
          ? p(`**${head[2].trim()}**`)
          : heading(Math.min(6, headingLevel + depth - 1), head[2].trim()),
      );
      continue;
    }

    // 引用
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      endList();
      if (quoted[1].trim() === "") flushQuote();
      else quoteBuffer.push(quoted[1].trim());
      continue;
    }
    flushQuote();

    // 列表项
    const item = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (item) {
      flushParagraph();
      const ordered = !/^[-*+]$/.test(item[2]);
      if (!list || list.ordered !== ordered) list = { listId: newListId(), ordered };
      blocks.push(
        listItem(item[3].trim(), {
          listId: list.listId,
          level: Math.min(8, Math.floor(item[1].length / 2)),
          ordered,
        }),
      );
      continue;
    }

    // 分隔线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushAll();
      endList();
      blocks.push(["hr", {}]);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      endList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function dedent(lines) {
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => l.match(/^\s*/)[0].length);
  const shift = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(shift));
}

// ---------------------------------------------------------------- PNG 尺寸

/**
 * 从 PNG 头部读出像素尺寸。只为按原图宽高比算 pt，不引第三方依赖。
 * `word +append-image` 按原始像素直接折算 pt，大图会撑破版面，所以插入时必须显式给尺寸。
 *
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number } | null}
 */
export function pngSize(buffer) {
  const isPng =
    buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a;
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 按目标宽度等比缩放，返回 pt 尺寸 */
export function scaleToWidth(size, widthPt) {
  if (!size || size.width === 0) return { width: widthPt, height: widthPt };
  return { width: widthPt, height: round2((widthPt * size.height) / size.width) };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
