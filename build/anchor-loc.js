import path from "node:path";
import { importBrowserDependency } from "./browser-deps.js";

/**
 * Anchor source locations (L1) · Vue SFC plugin
 * ==================================================================
 * Injects source coordinates into every element of a Vue single-file
 * component at dev transform time, so review comments carry
 * `file:line:column` without manual `data-*` annotations. Design notes:
 * docs/anchors.md.
 *
 * Three attributes distinguish the definition from the usage site:
 *
 *   data-loc   native element (<div>, <button>, …) → its own location
 *   data-use   component element (<PageHeader>, <Menu>, …) → usage location
 *   data-comp  component name owning the element (L2 semantic anchor)
 *
 * `vue/compiler-sfc` is imported lazily so the toolkit can be used with
 * non-Vue prototypes; disable this plugin with `anchorLoc: false`.
 *
 * Only active in dev (`apply: "serve"`). Production builds stay clean.
 */

const LOC_ATTR = "data-loc";
const USE_ATTR = "data-use";
const COMP_ATTR = "data-comp";

/** 这些标签不产生真实 DOM 元素，注入属性没有意义甚至会被 Vue 警告。 */
const SKIP_TAGS = new Set([
  "template",
  "slot",
  "transition",
  "transition-group",
  "keep-alive",
  "component",
  "router-view",
]);

/** 组件标签：首字母大写，或含连字符（<router-link>、<my-widget>）。 */
function isComponentTag(tag) {
  return /^[A-Z]/.test(tag) || tag.includes("-");
}

/** 从 script 块里取 name 字段；取不到则退回文件名。 */
function componentNameOf(scriptContent, filename) {
  const m = scriptContent && scriptContent.match(/\bname\s*:\s*["'`]([\w$-]+)["'`]/);
  if (m) return m[1];
  const base = path.basename(filename, ".vue");
  if (base !== "index") return base;
  // pages/eval-task/index.vue → EvalTask
  const dir = path.basename(path.dirname(filename));
  return dir.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

/** 由绝对偏移算出 1-based 行列。 */
function lineColAt(source, offset) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lastBreak = i;
    }
  }
  return { line, col: offset - lastBreak };
}

function collectElements(node, out) {
  if (!node || node.type !== 1) return;
  if (typeof node.start === "number" && !SKIP_TAGS.has(node.tag)) out.push(node);
  (node.children || []).forEach((child) => collectElements(child, out));
  // v-if / v-else-if / v-else 的分支挂在 ifConditions 上，不在 children 里
  (node.ifConditions || []).forEach((c) => {
    if (c.block && c.block !== node) collectElements(c.block, out);
  });
}

let compilerPromise = null;

function loadCompiler(root) {
  compilerPromise ??= importBrowserDependency("vue/compiler-sfc", root).catch((error) => {
    compilerPromise = null;
    throw new Error(
      "builderharness: source anchor injection needs `vue` >= 2.7 (vue/compiler-sfc). " +
        "Install Vue 2.7 or call builderHarness({ anchorLoc: false }) for non-Vue prototypes.\n" +
        error.message,
    );
  });
  return compilerPromise;
}

export function anchorLoc({ root = process.cwd() } = {}) {
  return {
    name: "builderharness:anchor-loc",
    apply: "serve",
    enforce: "pre",
    async transform(code, id) {
      const [file] = id.split("?");
      if (!file.endsWith(".vue") || file.includes("node_modules")) return null;

      const rel = path.relative(root, file).split(path.sep).join("/");
      if (!rel || rel.startsWith("..")) return null;

      const { parseComponent, compileTemplate } = await loadCompiler(root);

      let sfc;
      try {
        // deindent 默认开启，会剥掉模板的公共缩进，导致 AST 偏移与原文件不再线性对应
        sfc = parseComponent(code, { deindent: false });
      } catch {
        return null;
      }
      // src 引用的外部模板不在本文件里，无法注入
      if (!sfc.template || sfc.template.src || typeof sfc.template.start !== "number") return null;

      let ast;
      try {
        ast = compileTemplate({
          source: sfc.template.content,
          filename: file,
          compilerOptions: { outputSourceRange: true },
        }).ast;
      } catch {
        return null;
      }
      if (!ast) return null;

      const elements = [];
      collectElements(ast, elements);
      if (elements.length === 0) return null;

      const comp = componentNameOf(sfc.script && sfc.script.content, file);
      // compileTemplate 会先 trim 源码，AST 偏移相对 trim 后的文本，这里补回前导空白
      const raw = sfc.template.content;
      const base = sfc.template.start + (raw.length - raw.trimStart().length);
      const edits = [];

      for (const node of elements) {
        const abs = base + node.start;
        // 从 "<" 之后取出标签名，得到属性插入点
        const m = /^<([A-Za-z][-A-Za-z0-9_.:]*)/.exec(code.slice(abs, abs + 80));
        if (!m) continue;
        const tag = m[1];
        if (SKIP_TAGS.has(tag)) continue;

        const insertAt = abs + m[0].length;
        const { line, col } = lineColAt(code, abs);
        const value = `${rel}:${line}:${col}`;

        const attrs = isComponentTag(tag)
          ? ` ${USE_ATTR}="${value}"`
          : ` ${LOC_ATTR}="${value}" ${COMP_ATTR}="${comp}"`;

        edits.push({ at: insertAt, text: attrs });
      }

      if (edits.length === 0) return null;

      // 从后往前插入，前面的偏移才不会失效
      edits.sort((a, b) => b.at - a.at);
      let out = code;
      for (const e of edits) {
        out = out.slice(0, e.at) + e.text + out.slice(e.at);
      }
      // 只插入属性、不新增换行，行号不变，无需重建 sourcemap
      return { code: out, map: null };
    },
  };
}
