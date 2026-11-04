import { createRequire } from "node:module";

/**
 * 找出脚本里「用了却没有声明、也没有 import」的标识符
 * ==================================================================
 * 只做语法检查时，`tasksUsing(...)` 漏了 import 照样通过；到浏览器里，
 * 开发环境报 ReferenceError，生产构建里整页静默白屏。这里按 ES 模块的作用域
 * 规则把每个引用往外层逐级找声明，找不到、又不是运行环境自带的全局，就报出来。
 *
 * 解析器借宿主依赖链上现成的 @babel/parser 与 @babel/types，套件自己不装（基础命令行零运行依赖）：
 * 宿主直接装了的先用；Vue 宿主沿 vue → @vue/compiler-sfc 找，React 宿主沿 @vitejs/plugin-react → @babel/core 找。
 * 都找不到时 `createUndeclaredFinder` 抛 `ParserUnavailable`，调用方要明确降级、告诉人这一项没查，不能当成通过。
 * 不执行任何产品代码。
 *
 * JSX 里的组件名（`<ExperimentTable />`、`<motion.div>` 的 motion）也算引用：React 宿主漏 import 一个组件，
 * 开发环境同样报 ReferenceError。小写开头的是原生标签，不算。
 *
 * 不算问题的：
 * - `typeof X`——对未声明的名字取 typeof 不会抛错，常用来探测构建期常量；
 * - `process.env.NODE_ENV`——Vite 与 webpack 都在编译时把这一整串换成字面量，浏览器里不剩 process；
 * - 文件里写了 `/* global X *\/`（与 ESLint 同一写法）——构建期 define 注入的常量就这么声明；
 * - 下面两份清单里的全局。
 */

// ECMAScript 内建，加上浏览器与 Node 都有的计时器、console 与 Web 平台接口
const SHARED_GLOBALS = `
  globalThis undefined NaN Infinity eval isFinite isNaN parseFloat parseInt
  decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape
  Object Function Array Number Boolean String Symbol BigInt Date RegExp JSON Math Intl
  Promise Proxy Reflect Map Set WeakMap WeakSet WeakRef FinalizationRegistry
  Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError
  ArrayBuffer SharedArrayBuffer DataView Atomics
  Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
  Float32Array Float64Array BigInt64Array BigUint64Array
  console setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone
  atob btoa fetch Request Response Headers URL URLSearchParams FormData Blob File
  TextEncoder TextDecoder AbortController AbortSignal Event EventTarget CustomEvent
  performance crypto WebAssembly MessageChannel MessagePort BroadcastChannel
  ReadableStream WritableStream TransformStream CompressionStream DecompressionStream
`;

// 只有浏览器有的。刻意不收 name / status / top / parent / event / length / origin / open /
// close 这类太像普通变量的窗口属性：漏 import 一个叫 status 的变量，不该被当成 window.status 放过
const BROWSER_GLOBALS = `
  window document navigator location history screen localStorage sessionStorage indexedDB
  requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  getComputedStyle matchMedia getSelection alert confirm devicePixelRatio
  innerWidth innerHeight scrollX scrollY visualViewport customElements caches
  Node Element HTMLElement SVGElement Text Comment DocumentFragment NodeList Range Selection
  HTMLInputElement HTMLTextAreaElement HTMLAnchorElement HTMLImageElement HTMLVideoElement
  HTMLAudioElement HTMLMediaElement HTMLCanvasElement Image Audio Option
  DOMParser XMLSerializer XMLHttpRequest FileReader FileList DataTransfer ClipboardItem
  ResizeObserver IntersectionObserver MutationObserver
  UIEvent MouseEvent PointerEvent KeyboardEvent WheelEvent FocusEvent InputEvent DragEvent
  ClipboardEvent TouchEvent ErrorEvent PromiseRejectionEvent
  DOMRect CSS CSSStyleSheet ImageData ImageBitmap createImageBitmap OffscreenCanvas Path2D
  MediaSource MediaRecorder MediaStream AudioContext
  Worker SharedWorker WebSocket EventSource Notification FontFace
`;

export const BROWSER = new Set(`${SHARED_GLOBALS} ${BROWSER_GLOBALS}`.split(/\s+/).filter(Boolean));

/** 去哪儿借解析器：宿主自己、Vue 2.7 的 SFC 编译器、React 插件背后的 Babel */
const CHAINS = [[], ["vue", "@vue/compiler-sfc"], ["@vitejs/plugin-react", "@babel/core"]];

/** 宿主依赖链上找不到 @babel/parser：调用方降级并提示，不静默跳过 */
export class ParserUnavailable extends Error {
  constructor() {
    super("宿主依赖里找不到 @babel/parser（也没有 vue / @vitejs/plugin-react 可借）");
    this.name = "ParserUnavailable";
  }
}

/** 沿依赖链取解析器：每一层都从上一层所在位置解析，不依赖 npm 把它们提到顶层 */
function loadBabel(hostRequire) {
  for (const chain of CHAINS) {
    try {
      let req = hostRequire;
      for (const pkg of chain) req = createRequire(req.resolve(`${pkg}/package.json`));
      const parser = req("@babel/parser");
      let types;
      try {
        types = req("@babel/types");
      } catch {
        types = createRequire(req.resolve("@babel/parser"))("@babel/types");
      }
      return { parser, types, via: chain.length ? chain.join(" → ") : "宿主依赖" };
    } catch {
      // 这条链上没有，换下一条
    }
  }
  throw new ParserUnavailable();
}

/** `process.env.NODE_ENV` 里的 process：打包器整串替换，不是运行时引用 */
function isNodeEnv(node, parent, grand) {
  return node.name === "process"
    && parent.type === "MemberExpression" && parent.object === node && !parent.computed && parent.property.name === "env"
    && grand?.type === "MemberExpression" && grand.object === parent && !grand.computed && grand.property.name === "NODE_ENV";
}

const FUNCTIONS = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);
const BLOCKS = new Set([
  "BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement",
  "SwitchStatement", "CatchClause", "ClassExpression", "StaticBlock",
]);

/**
 * @param hostRequire 宿主工程的 require（createRequire(<宿主>/package.json)）
 * @returns analyze(source, { jsx }) → { undeclared: [{ name, line, column }]，exported: [名字] }
 *          行列以传入的 source 为准，行从 1、列从 0 起算（同 Babel）；语法错误照常抛（带 loc）。
 *          analyze.via 说明解析器借自哪条依赖链
 * @throws ParserUnavailable 宿主依赖链上没有解析器
 */
export function createUndeclaredFinder(hostRequire, globals = BROWSER) {
  const { parser, types: t, via } = loadBabel(hostRequire);

  function analyze(source, { jsx = false } = {}) {
    const ast = parser.parse(source, { sourceType: "module", plugins: jsx ? ["jsx"] : [] });
    const fileGlobals = new Set();
    for (const c of ast.comments || []) {
      const m = c.type === "CommentBlock" && /^\s*globals?\s+([\s\S]*)$/.exec(c.value);
      if (m) for (const item of m[1].split(/[\s,]+/)) if (item) fileGlobals.add(item.split(":")[0]);
    }

    const program = { parent: null, names: new Set(), fn: true };
    const refs = new Map(); // Identifier 节点 → 它所在的作用域
    const exported = new Set();
    const bindings = (pattern) => Object.entries(t.getBindingIdentifiers(pattern, true));
    const declare = (scope, pattern) => { for (const [name] of bindings(pattern)) scope.names.add(name); };
    const fnScope = (scope) => { while (!scope.fn) scope = scope.parent; return scope; };
    // 赋值目标在 isReferenced 里算「非引用」，但给未声明的名字赋值在严格模式下同样抛错
    const writes = (pattern, scope) => {
      for (const [, nodes] of bindings(pattern)) for (const n of nodes) refs.set(n, scope);
    };

    function visit(node, parent, grand, scope) {
      if (!node || typeof node.type !== "string") return;

      switch (node.type) {
        case "ImportDeclaration":
          for (const s of node.specifiers) program.names.add(s.local.name);
          break;
        case "VariableDeclaration":
          for (const d of node.declarations) declare(node.kind === "var" ? fnScope(scope) : scope, d.id);
          break;
        case "FunctionDeclaration":
        case "ClassDeclaration":
          if (node.id) scope.names.add(node.id.name);
          break;
        case "AssignmentExpression":
          writes(node.left, scope);
          break;
        case "ForInStatement":
        case "ForOfStatement":
          if (node.left.type !== "VariableDeclaration") writes(node.left, scope);
          break;
        case "ExportNamedDeclaration":
          if (node.declaration) for (const name of Object.keys(t.getBindingIdentifiers(node.declaration, false, true))) exported.add(name);
          for (const s of node.specifiers) if (s.exported?.name) exported.add(s.exported.name);
          break;
        case "Identifier":
          if (parent && t.isReferenced(node, parent, grand)
            && !(parent.type === "UnaryExpression" && parent.operator === "typeof")
            && !isNodeEnv(node, parent, grand)) refs.set(node, scope);
          return;
        case "JSXIdentifier":
          // <Foo />：大写开头是组件；<foo.Bar />：最左边的 foo 是变量。闭合标签与属性名不算
          if ((parent.type === "JSXOpeningElement" && parent.name === node && /^[A-Z]/.test(node.name))
            || (parent.type === "JSXMemberExpression" && parent.object === node && grand?.type !== "JSXClosingElement")) refs.set(node, scope);
          return;
      }

      let inner = scope;
      if (FUNCTIONS.has(node.type)) {
        inner = { parent: scope, names: new Set(), fn: true };
        if (node.type !== "ArrowFunctionExpression") inner.names.add("arguments");
        if (node.type === "FunctionExpression" && node.id) inner.names.add(node.id.name);
        for (const p of node.params) declare(inner, p);
      } else if (BLOCKS.has(node.type)) {
        inner = { parent: scope, names: new Set(), fn: node.type === "StaticBlock" };
        if (node.type === "ClassExpression" && node.id) inner.names.add(node.id.name);
        if (node.type === "CatchClause" && node.param) declare(inner, node.param);
      }

      for (const key of t.VISITOR_KEYS[node.type] || []) {
        const child = node[key];
        if (Array.isArray(child)) for (const c of child) visit(c, node, parent, inner);
        else visit(child, node, parent, inner);
      }
    }

    visit(ast.program, null, null, program);

    const undeclared = [];
    for (const [node, scope] of refs) {
      const { name } = node;
      if (globals.has(name) || fileGlobals.has(name)) continue;
      let s = scope;
      while (s && !s.names.has(name)) s = s.parent;
      if (!s) undeclared.push({ name, line: node.loc.start.line, column: node.loc.start.column });
    }
    undeclared.sort((a, b) => a.line - b.line || a.column - b.column);
    return { undeclared, exported: [...exported] };
  }
  analyze.via = via;
  return analyze;
}
