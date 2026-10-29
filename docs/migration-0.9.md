# Existing-agent workflow and migration to 0.9

0.9 keeps the `builderharness` CLI and existing browser import paths. The default
`init` now connects an existing project to its local agent. These are source and
packed-artifact instructions; this change does not publish a registry release.

## Connect an existing project

In your existing Codex or Claude Code session, ask:

> Initialize BuilderHarness here, preserving the project's existing harness and rules.

With a local installation, the agent runs:

```sh
npx --no-install builderharness init
```

Only project instructions, a review skill and a small workflow file are added.
Existing `AGENTS.md` and/or `CLAUDE.md` determine which host is configured; when
neither exists, both are prepared. Codex uses `.agents/skills/builderharness-review/`
and Claude Code uses `.claude/skills/builderharness-review/`. Advanced automation
may select `--agent codex`, `claude` or `both`. Check the host's actual loaded
instructions; generated files alone do not prove the host loaded them.

`init --list` previews changes without writing. Repeating `init` does not duplicate
entries. Edited managed files, damaged markers and same-name skills are preserved
and reported as partial initialization with a nonzero exit status. Resolve that
specific conflict and rerun. `init --remove` removes unchanged managed material;
it retains user edits, original project rules and decision records. Partially
removing one host retains the shared workflow while another host remains.

Initialization in a terminal does not start a model session. It does not modify
application source, dependency declarations, lockfiles, Vite config or route tables.
It works in non-frontend repositories and scoped monorepo applications. Supply
`--target <project>` when the automatically detected root is not your intended scope.

## Use project evidence

```sh
npx --no-install builderharness context "simplify batch deletion" --json
npx --no-install builderharness context "export policy" --file design/decisions.md --file src/export.js --limit 12 --max-chars 12000
```

The read-only collector returns original paths, line ranges, evidence kinds,
instruction scopes, discovered verification entries and explicit omissions.
`--root` chooses a scope. File/count/read budgets are bounded; symlinks are not
followed, generated directories are skipped by default and common credential files
are excluded. Common literal credentials are redacted heuristically. It does not
execute discovered package scripts. Snippets can be incomplete or inconsistent;
read the originals and use the project's own search for missing context.

The review skill checks goals, active constraints, historical premises, reuse,
cost and counterexamples before choosing S/M/L process weight. It can recommend
proceeding, explain a current conflict, propose an alternative, or acknowledge
missing evidence. It must not treat old decisions as permanent vetoes, or modify
specifications to conceal a failing implementation. Small changes stay lightweight.

Important confirmed decisions belong in the existing shared Markdown documents,
with premises, alternatives, evidence, tradeoffs, revisit conditions and supersession
links. Agent recommendations remain proposals. Existing `.builderharness/` ignore
rules make that directory appropriate for local reports, not the only copy of shared
project knowledge. Report passed, failed, skipped, not-run and zero-test outcomes
separately. A passing check proves only its executed assertions.

The MCP server is also available as `builderharness-mcp`. Existing topic-only
`builderharness_context` calls retain their KB response shape; pass `task`, optional
relative `files`, `limit`, `maxChars` and `maxScan` for the same task collector used
by the CLI. This MCP interface remains read-only; it does not grant execution rights.

## Complete scaffold and browser capabilities

```sh
npx --no-install builderharness init --scaffold
npx --no-install builderharness init --scaffold --list
npx --no-install builderharness init --scaffold --only docs/templates
```

`--only` and `--force` retain their legacy scaffold behavior with a migration notice;
use `--scaffold` explicitly in automation. `--force` is not a way to overwrite the
new integration's user-edited blocks. `--remove`/`--agent`/`--dry-run` cannot be mixed
with scaffold options; use scaffold `--list` for preview. Desktop project creation
now explicitly requests the complete scaffold before copying its starter.
New desktop starters set project-local `install-links=true` so npm installs their
external local toolkit/profile dependencies instead of leaving dependency-free
symlinks. Existing projects' npm settings are unchanged.

The base package has zero runtime dependencies. Browser source remains in the
base package to preserve import paths; `@builderharness/browser` is an optional
dependency profile containing React, Mermaid, XYFlow, Babel and Less. Media still
needs its documented external Chrome/ffmpeg tools; Electron remains a separate
integration. These are not installed by the base CLI.

For source testing, pack both artifacts (the project and profile must use matching versions):

```sh
npm ci
npm pack --pack-destination /tmp
npm pack ./packages/browser --pack-destination /tmp
```

Install only `/tmp/builderharness-0.9.0.tgz` in a base consumer. For Vite browser
review, install both that artifact and `/tmp/builderharness-browser-0.9.0.tgz`, plus
the host's Vite/framework setup. After a registry release, the equivalent is
`npm install --save-dev builderharness @builderharness/browser less`.
Keep existing `builderharness/vite`, `/react`, `/vue2` and `/ui` imports. The Vite
plugin and Babel loader resolve optional dependencies from the profile's own tree,
including non-hoisted layouts. Standalone UI use outside this Vite integration
must supply its framework dependencies through its own bundler. New Next.js/Nuxt
browser adapters are not included.

## Verify the change

```sh
npm run check
npm run build:demo
npm run preflight -- --dir examples/react-tailwind/dist
npm run test:publish-gateway
npm run test:packages
# Explicit real model sessions; requires the respective installed, authenticated CLI:
npm run test:agents -- --host codex
npm run test:agents -- --host claude
```

Package tests install real tarballs in clean temporary consumers and check base
dependency absence, CLI execution and non-hoisted optional runtime/Babel resolution.
They also configure the actual desktop starter against an external unpacked kit,
install its local dependencies and run its production build without launching Electron.
Real-host tests create a synthetic non-Vite project, check a decision conflict and
alternative, then open a new session for a small copy change and execute its tests.
They retain traces for inspection and return nonzero for missing hosts/authentication,
startup failures or incomplete behavioral evidence. Offline tests are not a substitute
for those sessions; model self-assessment alone is not the acceptance criterion.
