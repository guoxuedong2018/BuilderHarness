import path from "node:path";

import { importBrowserDependency } from "./browser-deps.js";

/**
 * Anchor source locations (L1) · React / JSX plugin
 * ==================================================================
 * React cannot rely on attribute fall-through the way Vue 2 can, so this
 * plugin injects `data-loc` and `data-comp` on intrinsic JSX elements.
 * Components are left untouched: adding unknown props to a component would
 * require every component to forward them, which is not a safe assumption.
 *
 * The review UI degrades gracefully: intrinsic elements get L1 source
 * coordinates; component roots still get L2 semantics from `data-comp` and
 * L3 geometry from the DOM.
 *
 * Babel is imported lazily and only when a JSX/TSX file is transformed.
 * Only active in dev (`apply: "serve"`).
 */

const LOC_ATTR = "data-loc";
const COMP_ATTR = "data-comp";

function componentNameOf(filename) {
  const base = path.basename(filename, path.extname(filename));
  if (base.toLowerCase() !== "index") return base.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
  return path
    .basename(path.dirname(filename))
    .replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

let babelPromise = null;
function loadBabel(root) {
  babelPromise ??= Promise.all([
    importBrowserDependency("@babel/parser", root),
    importBrowserDependency("@babel/traverse", root),
    importBrowserDependency("@babel/generator", root),
    importBrowserDependency("@babel/types", root),
  ])
    .then(([parser, traverse, generator, types]) => ({
      t: types,
      parse: parser.parse,
      // Rollup/CJS interop can nest `default` twice.
      traverse: traverse.default?.default ?? traverse.default ?? traverse,
      generate: generator.default?.default ?? generator.default ?? generator,
    }))
    .catch((error) => {
      babelPromise = null;
      throw new Error(
        "builderharness: React source anchors need @babel/parser, @babel/traverse and @babel/generator. " +
          "Install them or set builderHarness({ anchorLoc: false }).\n" +
          error.message,
      );
    });
  return babelPromise;
}

export function anchorLocReact({ root = process.cwd() } = {}) {
  return {
    name: "builderharness:anchor-loc-react",
    apply: "serve",
    enforce: "pre",
    async transform(code, id) {
      const [file] = id.split("?");
      if (!/\.(?:js|jsx|tsx)$/.test(file) || file.includes("node_modules")) return null;

      const rel = path.relative(root, file).split(path.sep).join("/");
      if (!rel || rel.startsWith("..")) return null;

      const { parse, traverse, generate, t } = await loadBabel(root);
      let ast;
      try {
        ast = parse(code, {
          sourceType: "module",
          sourceFilename: file,
          plugins: ["jsx", ...(file.endsWith(".tsx") ? ["typescript"] : [])],
        });
      } catch {
        return null;
      }

      const comp = componentNameOf(file);
      let changed = false;

      traverse(ast, {
        JSXOpeningElement(nodePath) {
          const { node } = nodePath;
          if (node.name?.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
          if (node.attributes?.some((a) => a.name?.name === LOC_ATTR)) return;

          const line = node.loc?.start.line;
          const column = node.loc?.start.column;
          if (!line || column === undefined) return;

          node.attributes.unshift(
            t.jsxAttribute(t.jsxIdentifier(LOC_ATTR), t.stringLiteral(`${rel}:${line}:${column + 1}`)),
            t.jsxAttribute(t.jsxIdentifier(COMP_ATTR), t.stringLiteral(comp)),
          );
          changed = true;
        },
      });

      if (!changed) return null;

      try {
        const output = generate(ast, { retainLines: true, comments: true }, code);
        return { code: output.code, map: null };
      } catch {
        return null;
      }
    },
  };
}
