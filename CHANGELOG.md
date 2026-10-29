# Changelog

## 0.9.0 — source changes, not published

- Default init connects existing Codex / Claude Code project instructions and review skills; complete templates use init --scaffold.
- Bounded task evidence includes decisions, scoped instructions, source references and explicit omissions; legacy MCP KB requests remain compatible.
- Review goals, constraints, historical premises and alternatives before process sizing; record meaningful confirmed decisions and actual verification limits.
- Base CLI runtime dependencies are empty. Optional @builderharness/browser supplies browser dependencies while existing import paths remain.
- Added preservation, recovery, package-install and explicit authenticated host acceptance checks. See docs/migration-0.9.md and the feature acceptance record for actual results.

## 0.8.0 — 2026-10-23

- **Brand and positioning: BuilderHarness** — the README (EN/ZH), brand guide
  and core docs now lead with the product category: an agent harness for
  Product Builders, **spec-gated · prototype-as-truth · review before ship**.
  The old “prototype-native content production and publishing layer” framing is
  retired; manuals, launch notes and media are documented as downstream
  deliverables.
- **Product surface** — npm package `builderharness`, imports
  `builderharness/*`, CLI `builderharness`, environment variables
  `BUILDERHARNESS_*`, config files `builderharness.config.*`, project settings
  `.builderharness/`, MCP tools `builderharness_*`, and integration packages
  `@builderharness/*`.
- **Boundaries are explicit** — auth, observability and deploy are documented as
  integration points: *connecting ≠ bundling ≠ production-ready by default*.

## 0.7.6 — 2026-10-20

- **One canvas, one rail, one toolbar** — removed the Bee Press brand header
  and the always-on inspector. The prototype canvas now fills the panel, a
  46px icon rail carries the six stages plus comments/help/chat, and a single
  38px canvas bar holds the address, FRS, comment mode, drawer, studio, preview
  width, refresh and open-in-browser.
- **Complexity on demand** — “next step” is a floating hint; the panel with next
  action and open comments slides in only when asked and leaves the canvas width
  untouched. Help, guide and errors are overlays instead of extra columns.
- **One-card onboarding** — the first-run guide shows a single step card with a
  step switcher, one primary action and a skip, replacing three stacked cards.
- **Unified surfaces** — rail, toolbar and panels share one grey chrome; only
  the web canvas is white, so the prototype reads as the product.
- The cockpit refreshes its badge and comment list when the embedded bridge
  reports a changed comment count, instead of waiting for a manual refresh.
- Desktop: DSH now prefers a stable local port so localStorage (stage, skipped
  guide, last workspace) survives app restarts, falling back to an ephemeral
  port only when it is taken.

## 0.7.5 — 2026-10-20

- **Bee Press now hosts itself** — `beepress init` ran in this repository:
  `AGENTS.md`, `CLAUDE.md`, `.agent/skills`, `docs/kb`, `docs/WORKFLOW.md`, and
  the route/FRS registry in `src/config/frs-map.js`. The kit's own product work
  is specified with the same FRS template it ships (`ONBOARDING`, `COCKPIT`,
  `REVIEW`) and `npm run check` now validates those specs.
- **First-run guide instead of a dead end** — when the prototype cannot run,
  the cockpit offers three plain-language steps (confirm stack → write the first
  FRS → start the prototype) with one primary action each, evidence for the
  detected stack, inline errors, and a skip that is remembered per workspace.
- **Stack detection** — `detectStack()` reads the real app directory and reports
  framework, Tailwind, TypeScript, bundler and evidence; the baseline stage can
  adopt it in one click.
- **Prototype feedback** — startup and load now use skeletons with stage text, a
  12-second slow-response banner, and a failure state with collapsible log,
  retry, install and switch-workspace exits.
- **Same-host preview proxy** — dev servers printed `localhost` while the
  cockpit is served from `127.0.0.1`; browsers refuse to frame a different
  loopback alias. Prototypes are now proxied on the page's host (HTTP + HMR
  WebSocket), which also fixes embedding when Vite binds only `::1`.
- **Quieter layout** — the cockpit top bar drops the redundant “操作台” action,
  the inspector keeps only “下一步” and open comments, and stage rows read as
  “stage · result”. Adds an in-place help panel (glossary, shortcuts, reopen the
  guide), visible focus rings and `⌘/Ctrl + Enter` to start or restart.

## 0.7.4 — 2026-10-20

- **Prototype runs from the real app directory** — product repos usually keep
  the dev server in `web/`, `app/`, `apps/*` or `packages/*` instead of the
  repository root. The cockpit now scans named candidates and any one/two-level
  subdirectory with a `dev` script, then reports the resolved directory instead
  of claiming there is no prototype.
- **Package-manager aware** — the detected lockfile decides whether to run
  `npm`, `pnpm`, `yarn` or `bun`, and missing `node_modules` is reported with
  the exact install command.
- **One-click install** — a new `POST /beepress/api/prototype/install` route and
  an “安装依赖并启动” action install dependencies and then start the dev server.
- **Cockpit follows the visible session** — the workspace shown in the cockpit
  comes from DSH's `retainedBy.mainView` session, falls back to the last opened
  project, and no longer follows whichever session changed most recently.
- **Dev servers stop with the harness** — the plugin disposes its dev server
  children on unload, so restarts no longer leave a stale Vite instance holding
  the port and breaking HMR in the embedded prototype.
- **Zero-dependency apps start without an install** — a `dev` script with no
  dependencies is treated as ready, so tiny fixtures are not blocked on a
  `node_modules` folder that npm never creates.
- **ANSI-safe URL detection** — dev servers that colorize output (`vite` splits
  the port with escape codes) are parsed correctly.
- **Desktop ships and syncs its DSH bundle** — the app bundle now contains
  `beepress/host`, installs the profile on launch when it is missing, and
  re-syncs the bundle so new files reach the profile instead of silently running
  an old copy.

## 0.7.3 — 2026-10-20

- **Corrected product boundary** — the desktop app is now a thin project
  picker that enters DSH directly. The parallel Bee Press workbench, right
  sidebar, file tree, browser, terminal and “打开 Agent 工作区” layer are gone.
- **Bee Press lives in DSH** — six domain tab types are registered through
  `ctx.sidebarRightTabs`: baseline, requirements, prototype, review, content and
  publish. Each has a body/title slot and a guide entry.
- **Reuse DSH surfaces** — prototype/review open DSH's browser tab; files and
  terminal are DSH's built-in tabs, not Bee Press copies.
- **Workflow routes** — host HTTP routes for baseline read/write, feature
  creation/check, prototype start, content capture and publish dry-run.

## 0.7.2 — 2026-10-20

- **Resizable three-pane workbench** — workspace, inspector and browser share a
  draggable grid modeled on the DeepSeek Harness client layout: 264–420px
  sidebar, 400px minimum center, 300–70% right pane and a draggable inspector /
  browser split. Widths persist per machine.
- **Embedded browser** — prototype and review actions open in an Electron
  `<webview>` beside the workspace, with back/forward/reload, address bar and
  “open in system browser”; webviews are restricted to HTTP(S).
- **Per-stage history** — requirements, prototype, review, content and publish
  each keep their last 20 runs in `.beepress/desktop.json`; switching stages
  restores that stage's latest output and history.
- **Native application menu** — File, Edit, View, Window and Help menus with
  import/new, command palette, pane toggles and standard macOS roles.
- **Layout behavior from dsh** — adapted the DSH `ui-layout` column solver and
  pointer-capture/rAF drag handles instead of inventing a new splitter.

## 0.7.1 — 2026-10-20

- **Desktop-native shell** — replaced the marketing-style entry page with a
  persistent workspace sidebar, native inset title bar, status bar and a
  command palette (`⌘K`).
- **Project workspace** — recent projects live in the sidebar; requirements,
  prototype, review, content and publish are workflow navigation, not cards.
- **Run inspector** — stage actions now write into a dedicated output panel with
  running/success/failure state and a clear action.
- **Settings-style baseline** — stack and UI-spec selection use a settings layout
  with a sticky confirm action and visible project context.
- **Keyboard flow** — `⌘K`, `⌘O`, `⌘N`, `⌘⇧F` and `Esc` cover the main desktop
  entry points.

## 0.7.0 — 2026-10-20

- **Consumer entry** — the desktop app opens with the “vibecoding toy → production
  application” positioning, a drag/drop project importer, an Agent-authorized
  project scan and a new-project path.
- **Production baseline** — users confirm the preset stack and UI spec, inspect
  the detected stack, or analyze a live URL for frameworks, colors and fonts.
- **Explicit tool hub** — requirements, prototype, review, content and publish
  are first-class cards; the DSH workspace is an optional entry, not the product.
- **Starter** — new projects include the React + Tailwind Vite starter.

## 0.6.8 — 2026-10-20

- **Clip recording action** — the content stage can rebuild MP4/GIF clips with
  `record-kb-clips` against the running prototype.

## 0.6.7 — 2026-10-20

- **FRS check action** — the project workbench can run `check-frs` directly
  after creating a feature folder.

## 0.6.6 — 2026-10-20

- **Stage actions** — the project workbench can create a feature folder from the
  FRS templates, install dependencies, launch the prototype dev server, open
  the review overlay, inspect pending comments, read the content lock and
  rebuild stale screenshots.
- **Publish target** — save a per-project `BEEPRESS_PUBLISH_GATEWAY` and run a
  `kb-publish --dry-run` from the workbench.
- **React starter** — new projects now include a Vite + React + Tailwind
  starter with `npm run dev`, instead of only docs.
- **Distribution** — added Electron Builder, macOS entitlements, unsigned
  DMG/ZIP output and documented signing/notarization inputs.

## 0.6.5 — 2026-10-20

- **Project workbench** — after choosing a project, the launcher shows a
  project-level workflow view instead of immediately opening a chat:
  requirements, prototype, review, content and publish status, plus a single
  “enter project workspace” action.
- **Project inspection** — the launcher reads FRS count, knowledge-base pages,
  open reviews, dev script and publish configuration locally before starting
  dsh.
- **New project flow** — creating a project now stops at the workbench so the
  user can review the scaffold before entering the workspace.

## 0.6.4 — 2026-10-20

- **Packaged desktop resources** — the packaged app resolves its `beepress`
  CLI/scaffold from `Resources/beepress`, and electron-builder copies `bin`,
  `pipeline`, `scaffold`, `docs/templates` and the package manifest there.
- **Development path unchanged** — unpackaged runs keep using the repository
  root or `BEEPRESS_KIT_ROOT`.

## 0.6.3 — 2026-10-20

- **Branded desktop onboarding** — the desktop app now opens a Bee Press
  launcher instead of the chat surface: import an existing project, create a
  scaffolded project, or reopen a recent one.
- **Project-aware launch** — the selected path becomes the dsh workspace and
  opens a session; `uiWorkspace` + `workspaces` are used from the client
  bundle instead of asking the user to pick the folder again.
- **Sidebar branding** — the dsh sidebar brand mark/name are replaced with
  Bee Press through `sidebar.brand.*` slots.
- **Safer project creation** — CLI subprocesses run through Electron's Node
  mode; the launcher never invokes the Electron binary as a script.
- **Workflow status** — the Bee Press panel now shows requirement, prototype,
  review, content and publish stages.
- **Desktop assets/packaging** — added the Bee Press icon, macOS dock icon and
  an `electron-builder` macOS target configuration; signing and notarization
  remain release work.

## 0.6.2 — 2026-10-20

- **Desktop launcher** — resolves `dsh` from `BEEPRESS_DSH_BIN`, the common
  npm-global/Homebrew paths, then PATH; logs the profile and loaded URL; kills
  the child process when startup times out or the app quits.
- **Desktop docs** — added the exact local test loop, Electron postinstall
  recovery and a windowless verification path.

## 0.6.1 — 2026-10-20

- **Project scaffold restored** — added `scaffold/` with the FRS templates
  (`docs/templates/`), workflow, kb writing guide, kb/media config starters,
  `src/config/frs-map.js`, project guides and core `.agent/skills/`.
- **`beepress init`** — copies the scaffold into a host project without
  overwriting existing files; supports `--list`, `--only`, `--force` and
  `--target`.
- **`check-frs` unblocked on new projects** — the scaffold includes the
  zero-dependency `frs-map.js` that the check imports.

## 0.6.0 — 2026-10-20

- **Package rename** — the npm package is now `beepress`; imports are
  `beepress`, `beepress/react`, `beepress/vue2` and `beepress/vite`. The CLI
  keeps `beepress`, `builder-kit` and `bk` aliases.
- **Compatibility package** — `compat/builder-kit` re-exports `beepress` for
  existing `builder-kit/*` imports and the `builder-kit` CLI. The legacy
  `BUILDER_KIT_*` environment variables and `virtual:builder-kit/host` module
  remain accepted; new code should use `BEEPRESS_*` and
  `virtual:beepress/host`.
- **`ctx.beepress` service** — the dsh bundle registers a Cordis service and
  routes both tools and HTTP handlers through it.
- **Content confirmation tools** — `beepress_content_status` reads
  `docs/kb/_lock.json` via `beepress kb status --json`;
  `beepress_content_confirm` records reviewed refs via `beepress kb ack`.
- **Publish plan** — `beepress_publish_plan` compares local pages with
  `docs/kb/_published.json`, reports the configured destination and exposes the
  plan in the right-sidebar panel.
- **Media capture tool** — `beepress_capture_media` rebuilds screenshots or
  clips with the existing reproducible `capture-kb-shots` /
  `record-kb-clips` recipe runner instead of ad-hoc screenshots.
- **Panel** — added content-lock and publish-plan sections, plus a content
  check action backed by `/beepress/api/content`.
- **Thin desktop shell** — added `integrations/desktop`, an Electron wrapper
  that boots an upstream dsh profile and loads its Web UI, plus an
  `install-profile` helper for the preinstalled Bee Press bundle.

## 0.5.0 — 2026-10-19

- **DeepSeek Harness + MCP integration** — added `integrations/` with
  `@beepress/dsh-bundle`, a dsh plugin, a right-sidebar Bee Press panel and a
  `beepress-mcp` stdio entrypoint over one shared workspace reader. The dsh
  host exposes `beepress_status`, `beepress_context`, `beepress_review_open`,
  `beepress_review_add` and `beepress_review_resolve`; the panel reads the
  current session workspace and can resolve reviews. MCP remains read-only.
  Media capture and publishing are not included yet.
- **dsh session directory** — the dsh tools now resolve the active session
  working directory through `ctx.workingDirectory.ensure()` instead of the
  Harness process cwd, so selecting a project workspace gives the correct
  `docs/` tree.

## 0.4.0

- **Bee Press brand** — the product is now **Bee Press**, with the positioning
  “a hive of agents. One source of truth.” The name reflects the operating
  model: specialised agents coordinate through shared artifacts (fact refs,
  review locks, media ledgers, publish state), not a human-in-the-loop chat.
- **Compatible CLI aliases** — `beepress` was added alongside `builder-kit` and
  `bk`. The npm package name, import paths and `BUILDER_KIT_*` environment
  variables are unchanged.
- **Brand guide** — added `docs/brand.md` covering naming, taglines, voice and
  visual direction.
- **Documentation and demo** — README, architecture, adapter, publishing and UI
  spec docs now use the Bee Press name; the React demo title and copy follow.

## 0.3.0

- **Tailwind 4 migration** — the demo, canonical components and docs now target
  Tailwind 4.3 via `@tailwindcss/postcss`. The token-derived legacy config is
  loaded with `@config`; container queries use Tailwind's built-in support.
- **Pluggable publish destinations** — the studio keeps the plan/state/confirm
  workflow and loads the actual destination through
  `BUILDER_KIT_PUBLISH_GATEWAY`; `pipeline/destinations/docs-cli.mjs` is now a
  reference adapter, not core coupling. See `docs/publishing.md`.
- **Content destination guide** — reframed publishing as content carriers, not
  just document pages. Added a Chinese, step-by-step `docs/publishing.zh-CN.md`
  covering content bundles, cards/assets, adapter layout, environment setup,
  authentication, validation and troubleshooting.
- **Content-check UX** — the studio opens with a guided review queue and
  page progress, shows requirement context on "needs confirmation" cards,
  hides AI/source-editing actions behind an advanced toggle, and disables
  publishing until a destination is configured.
- **React-first dependencies** — Vue 2 is an optional peer only. It is no longer
  installed for development or allowed to gate the build/audit; the Vue adapter
  remains available for hosts that opt in.
- **Dependency refresh** — Vite 6.4, Mermaid 12.2, tailwind-merge 3.7 and a
  patched `postcss-selector-parser` override. `npm audit` now reports
  **0 vulnerabilities**.

## 0.2.0

- **React adapter** — `beepress/react` mounts the toolkit in React prototypes;
  `hashRouter()` provides a router-library-free bridge.
- **React source anchors** — `anchorLoc: "auto" | "react" | "vue" | false`;
  the JSX plugin injects `data-loc` / `data-comp` on intrinsic elements in dev.
- **React + Tailwind demo** — `examples/react-tailwind`, a synthetic product
  workspace with review comments, a command palette, async dialog states, dark
  mode and the content studio.
- **Tool UI Spec** — `ui-spec/` now ships tokens, Tailwind config and canonical
  React components. Export `beepress/ui` and `beepress/tokens.css`.
- **UI conformance gate** — `scripts/check-ui-spec.mjs` checks raw colors,
  transitions, viewport breakpoints, spacing, radii, focus compensation and
  icon-button labels.
- **UI audit** — tokenized typography, spacing, radii, focus rings and motion in
  the review/studio UI; IME guards; draft persistence; tabular numerals.
- **Pre-deploy preflight** — `scripts/preflight-dist.mjs` scans artifacts for dev
  endpoints, source anchors, local paths, source maps and common secrets.
- **Deploy skill review** — `docs/deploy-skill-review.md` covers new-environment
  detection and user guidance.
- **Isolated deploy-skill E2E** — `scripts/test-deploy-skill-e2e.mjs` runs the real
  Harness skill against a fake CLI, registry, `fetch` and `HOME`, reproducing new
  machine, binding mismatch, offline, leaky artifact and stale-verification states.
- **Public dependency guard** — `.npmrc` pins `registry.npmjs.org` and
  `scripts/check-public-deps.mjs` rejects private registries, local specs and
  non-npmjs lockfile URLs.
- **Public docs cleanup** — genericized private deploy CLI names in the deploy
  review and removed an internal host name from an export comment.
- Fixed the content-menu trigger so its title, count and caret are vertically
  centered instead of sitting against the top of the 30px control.
- **Full UI spec page** — the demo `#/ui-spec` route now documents foundations,
  live component states, patterns, accessibility and a searchable token table.
- **Type-scale merge fix** — `cn` registers the custom font-size roles with
  `tailwind-merge`, so `text-body` / `text-prose` survive merging with
  `text-primary`.
- **Dialog focus** — destructive dialogs now focus an explicit
  `data-autofocus` target (Cancel) instead of the last focusable button.
- **Security hardening** — shell-quoted document CLI arguments, blocked
  `docs/kb` path traversal in publishing, refused to overwrite corrupt review
  files, and required a same-origin confirmation token for publishing.
- **Compatibility and robustness** — CRLF front-matter, legacy comments without
  `replies`, JSX in `.js` files, `<MessageActions>` hover, composer labelling,
  missing ffmpeg/Chrome spawn errors, and publish modal focus handling.
- **UI token cleanup** — danger buttons, code-block hover/focus, table headers
  and segmented tracks now use their semantic roles.
- Fixed a Vite Less edge case where an `@import` in a comment triggered URL
  rebasing.

## 0.1.0

Initial open-source release.

- Review suite: select-and-comment UI, source-coordinate anchors (L1/L2/L3), comment persistence.
- Studio suite: review queue, content status, before/after comparison, structure view, demo recorder.
- Vite integration with a host bridge and a Vue 2 adapter.
- Pipeline CLI for review notes, feature specs, PRDs, screenshots, clips and content status.
- Optional, pluggable external document publishing.
