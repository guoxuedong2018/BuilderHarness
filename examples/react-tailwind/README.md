# Helix · BuilderHarness React + Tailwind demo

A synthetic product workspace that demonstrates BuilderHarness on a **React 19 +
Tailwind 4.3** prototype in the source checkout. Every project, person and metric
is made up. For a new app, use the [React starter](../../scaffold/README.md#start-a-react-app).

## Run it

From the repository root (the demo resolves Vite and dependencies from the root
`node_modules`):

```bash
npm run demo
# open the printed URL, usually http://localhost:5173/#/overview
```

Production build:

```bash
npm run build:demo
```

The root commands delegate to the example's `dev` and `build` scripts. The demo
runs from `examples/react-tailwind`, so BuilderHarness treats that folder
as the host project (`docs/`, `src/`, `package.json`). Review comments are
written to `examples/react-tailwind/docs/reviews/`.

## Check the example

With Chrome or Chromium installed and port 5173 free, run this from the repository root.

```bash
npm run check:demo
```

It checks syntax and FRS, starts and stops Vite for the two browser acceptance
scenarios, then builds and scans the production artifact. The verification logs
and screenshots are under the example's `.builderharness/verification/EXPERIMENTS/`.
If the example is already running, use `node ../../bin/builderharness.mjs verify EXPERIMENTS`
from the example directory.

## What to try

- **Review** — the BuilderHarness toolbar is mounted above the app. Click 「评论」,
  then click any element (a heading, a metric card, a table row). The comment
  composer shows the injected source coordinate, e.g. `src/App.jsx:83:9`.
- **Drafts** — type a comment, close it, reopen the same element: the draft is
  restored from `localStorage`.
- **Command palette** — `⌘K` / `Ctrl+K`, filter with an IME, `↑`/`↓`, `Enter`.
- **New experiment** — validates the name, keeps input on failure, retries, and
  has a loading/success/error state machine. Type `fail` to exercise the error
  path.
- **Dark mode** — the toggle persists to `localStorage` and re-maps the semantic
  tokens (it is not a filter).
- **Views** — `#/overview`, `#/experiments`, `#/reviews`, `#/ui-spec`.
- **UI spec** — `#/ui-spec` is the living reference page: foundations, live
  component states, patterns, accessibility notes and a searchable token table.

## Stack

- React 19 + Vite 6
- Tailwind CSS 4.3 with [`ui-spec/impl/react/tailwind.config.cjs`](../../ui-spec/impl/react/tailwind.config.cjs)
- Tokens from [`ui-spec/tokens.css`](../../ui-spec/tokens.css)
- Components from [`ui-spec/impl/react`](../../ui-spec/impl/react)
- The BuilderHarness React adapter (`client/adapters/react.jsx`)

The Vite config aliases the in-repo package subpaths:

```js
{ find: /^builderharness\/react$/, replacement: path.join(kitRoot, "client/adapters/react.jsx") }
{ find: /^builderharness\/ui$/, replacement: path.join(kitRoot, "ui-spec/impl/react/index.ts") }
```

A project that installs the published package does not need those aliases; it
imports `builderharness/react` and `builderharness/ui` directly.

## Tailwind notes

- `tailwind.config.cjs` reuses the canonical token config and adds the demo and
  toolkit source paths. Paths are absolute because Vite may run from the repo
  root.
- `postcss.config.cjs` uses `@tailwindcss/postcss`. `src/styles.css` loads the
  example's Tailwind config through `@config`.
- Do not add a second accent color. The only accent is `--accent`; status colors
  are paired with icons or text.
