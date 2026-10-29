import { existsSync } from "node:fs";
import { resolveBrowserDependency } from "./build/browser-deps.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anchorLoc as anchorLocPlugin } from "./build/anchor-loc.js";
import { anchorLocReact } from "./build/anchor-loc-react.js";
import { reviewServer } from "./server/review-server.js";
import { studioServer } from "./server/studio-server.js";

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(KIT_DIR, "client");

/** Runtime dependencies supplied by the optional @builderharness/browser profile. */
const KIT_ALIASES = [
  ["@xyflow/react", "@xyflow/react"],
  ["@xyflow/react/dist/style.css", "@xyflow/react/dist/style.css"],
  ["valtio", "valtio"],
  ["clsx", "clsx"],
  ["tailwind-merge", "tailwind-merge"],
  // Flow chart preview in the studio (Mermaid code blocks in the content).
  ["mermaid", "mermaid/dist/mermaid.core.mjs"],
];

/** Used only when the host has no React of its own (vendored toolkit checkout). */
const REACT_ALIASES = [
  ["react", "react"],
  ["react/jsx-runtime", "react/jsx-runtime"],
  ["react/jsx-dev-runtime", "react/jsx-dev-runtime"],
  ["react-dom", "react-dom"],
  ["react-dom/client", "react-dom/client"],
];

function hostHasReact(root) {
  for (const base of [root, process.cwd()]) {
    let dir = path.resolve(base);
    for (;;) {
      if (existsSync(path.join(dir, "node_modules", "react", "package.json"))) return true;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return false;
}

const KIT_PREBUNDLE = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@xyflow/react", "valtio", "mermaid"];


/**
 * Host wiring virtual module.
 *
 * The toolkit needs two things from the host: the requirement-region registry
 * and host controls on the toolbar. Both are business data and must not be
 * hard-coded here. This plugin generates a virtual module from the options in
 * `vite.config.js`; the toolkit only imports the fixed virtual name.
 *
 * In other words, coupling lives in one integration line.
 */
const HOST_ID = "virtual:builderharness/host";
const HOST_RESOLVED = `\0${HOST_ID}`;

/** Absolute paths outside Vite's root must go through /@fs/ in dev. */
function fsSpec(abs) {
  return `/@fs/${abs.split(path.sep).join("/").replace(/^\//, "")}`;
}

function hostBridge({ root, frsRegistry, barExtras, barLinks, agentPrompt }) {
  return {
    name: "builderharness:host-bridge",
    apply: "serve",
    resolveId(id) {
      if (id === HOST_ID) return HOST_RESOLVED;
      return null;
    },
    load(id) {
      if (id !== HOST_RESOLVED) return null;
      const lines = [];

      // Requirement region registry. Without wiring it stays empty and every
      // review comment is filed under APP_SHELL.
      if (frsRegistry) {
        lines.push(`export { FRS_REGISTRY } from ${JSON.stringify(fsSpec(path.resolve(root, frsRegistry)))};`);
      } else {
        lines.push("export const FRS_REGISTRY = [];");
      }

      // Host controls injected into the review toolbar.
      barExtras.forEach((p, i) => {
        lines.push(`import __extra${i} from ${JSON.stringify(fsSpec(path.resolve(root, p)))};`);
      });
      lines.push(`export const barExtras = [${barExtras.map((_, i) => `__extra${i}`).join(", ")}];`);

      // Host links on the toolbar (e.g. a design-system page).
      lines.push(`export const barLinks = ${JSON.stringify(barLinks)};`);

      // Optional prefix for prompts copied by the studio, e.g. "/content-draft".
      lines.push(`export const AGENT_PROMPT = ${JSON.stringify(agentPrompt)};`);

      return lines.join("\n");
    },
  };
}

/**
 * BuilderHarness — one integration point for the prototype toolkit
 * ==================================================================
 * Add one line to the host's `vite.config.js`:
 *
 *   builderHarness({ root, ... })
 *
 * and the host gets:
 *
 *   build/anchor-loc     dev-time source coordinates (data-loc / data-use / data-comp)
 *   server/review-server dev middleware persisting review comments
 *   server/studio-server dev middleware for the content workspace
 *   client/review        review UI — select elements, leave comments
 *   client/studio        content workspace — what needs review, what to reshoot, publishing
 *
 * Both suites are peers: review collects opinions about the prototype, the
 * studio tracks whether the documentation keeps up with it. The UI is React;
 * a thin host adapter mounts it (`builderharness/vue2` for Vue 2).
 *
 * @param {object}   options
 * @param {string}   [options.root]          host app root (source paths are relative to it)
 * @param {string}   [options.frsRegistry]   requirement-region registry module, relative to root
 * @param {string[]} [options.barExtras]     host components injected into the review toolbar, relative to root
 * @param {{label: string, route: object, title?: string}[]} [options.barLinks]
 *                                           host links on the right side of the toolbar
 * @param {string}   [options.reviewsDir]    comment directory, defaults to `<project>/docs/reviews`
 * @param {boolean|"auto"|"vue"|"react"} [options.anchorLoc]
 *                                           source-anchor injection: auto (both), vue, react, or false
 * @param {string}   [options.agentPrompt]   optional prompt prefix for "copy for Agent" buttons
 */
export function builderHarness({
  root = process.cwd(),
  frsRegistry,
  barExtras = [],
  barLinks = [],
  reviewsDir,
  anchorLoc = "auto",
  agentPrompt = "",
} = {}) {
  return [
    {
      name: "builderharness:config",
      config() {
        return {
          resolve: {
            alias: [
              // The host may import the toolkit by bare specifier.
              { find: /^builderharness$/, replacement: path.join(CLIENT_DIR, "index.js") },
              // Resolve development deps or the optional profile's own tree;
              // do not assume its transitive dependencies were hoisted.
              ...(hostHasReact(root) ? [] : REACT_ALIASES).map(([spec, rel]) => ({
                find: new RegExp(`^${spec.replace(/[/.]/g, "\\$&")}$`),
                replacement: resolveBrowserDependency(rel, root),
              })),
              ...KIT_ALIASES.map(([spec, rel]) => ({
                find: new RegExp(`^${spec.replace(/[/.]/g, "\\$&")}$`),
                replacement: resolveBrowserDependency(rel, root),
              })),
            ],
            // One React for the host and the toolkit. Without this, a local
            // toolkit dependency tree can load a second copy and hooks fail.
            dedupe: ["react", "react-dom"],
          },
          // React is CommonJS and must be pre-bundled.
          optimizeDeps: {
            include: KIT_PREBUNDLE,
            // Toolkit entry points are source files with a virtual host module;
            // pre-bundling them with esbuild would fail to resolve it.
            exclude: ["builderharness", "builderharness/vue2", "builderharness/core"],
          },
          // The toolkit UI is React (.jsx). The host may be Vue and have no .jsx.
          esbuild: { jsx: "automatic", jsxImportSource: "react" },
          server: {
            // The toolkit lives outside the Vite root.
            fs: { allow: [root, KIT_DIR] },
          },
        };
      },
    },
    // Must run before plugin-vue2 / plugin-react to see the original source.
    ...(anchorLoc === false
      ? []
      : anchorLoc === "react"
        ? [anchorLocReact({ root })]
        : anchorLoc === "vue"
          ? [anchorLocPlugin({ root })]
          : [anchorLocPlugin({ root }), anchorLocReact({ root })]),
    hostBridge({ root, frsRegistry, barExtras, barLinks, agentPrompt }),
    reviewServer({ reviewsDir }),
    studioServer(),
  ];
}
