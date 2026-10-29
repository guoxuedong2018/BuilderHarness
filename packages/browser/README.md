# BuilderHarness browser runtime

Install this optional dependency profile alongside `builderharness` to enable the
existing `builderharness/vite`, `/react`, `/vue2` and `/ui` entry points. The base
CLI, project evidence and MCP require none of these runtime dependencies.

```sh
npm install --save-dev builderharness @builderharness/browser less
```

The host supplies Vite and its framework plugin. Browser source and public import
paths remain in `builderharness` for compatibility; this package owns the optional
runtime dependency graph. Vite resolves it from this package's own tree, including
non-hoisted installs. Keep browser imports behind `import.meta.env.DEV` and scan
the resulting production artifact. Next.js/Nuxt browser adapters are not included.
