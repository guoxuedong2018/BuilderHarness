# BuilderHarness × DeepSeek Harness integration

Integration package for running BuilderHarness beside an agent runtime. One package
has three faces:

- `src/dsh.mjs` — a DeepSeek Harness / Cordis plugin (`@builderharness/dsh-bundle`)
- `lib/client.js` — the dsh client plugin (right-sidebar BuilderHarness panel)
- `src/mcp.mjs` — a stdio MCP server (`builderharness-mcp`)
- `src/project.mjs` — the dependency-free workspace reader shared by all faces
- `src/service.mjs` — the `ctx.builderharness` domain service shared by tools and routes
- `src/kit.mjs` — locates the installed `builderharness` CLI for lock/material capture commands

The separation is intentional: the reader is the domain seam; dsh and MCP are
two hosts. The package is one directory so a `file:` install of the dsh bundle
does not depend on files outside the package.

## Tools

| Tool | Purpose |
| :-- | :-- |
| `builderharness_status` | Content pages, open reviews, feature specs, dev script, publish config |
| `builderharness_context` | `docs/kb` pages and excerpts, optionally filtered by topic |
| `builderharness_review_open` | Unresolved review comments with anchors and reply counts |
| `builderharness_review_add` | Add an open comment to `docs/reviews` |
| `builderharness_review_resolve` | Resolve a comment, optionally appending a note |
| `builderharness_content_status` | Read `docs/kb/_lock.json` through `builderharness kb status --json` |
| `builderharness_content_confirm` | Confirm a page or selected refs through `builderharness kb ack` |
| `builderharness_publish_plan` | Compare local pages with `docs/kb/_published.json` and show the destination |
| `builderharness_capture_media` | Rebuild screenshots or clips with the reproducible recipe runner |

The dsh plugin registers six **BuilderHarness** page types in DSH's own right
sidebar: production baseline, requirements, prototype, review, content and
publish. Each has a body and title slot plus a guide entry, and the tab strip is
DSH's own. Prototype/review open DSH's browser tab; files and terminal stay
DSH's built-in tabs.

The HTTP paths are `/builderharness/api/state`, `/builderharness/api/content`,
`/builderharness/api/baseline`, `/builderharness/api/requirements/create`,
`/builderharness/api/requirements/check`, `/builderharness/api/prototype/start`,
`/builderharness/api/content/capture`, `/builderharness/api/publish/dry-run` and
`/builderharness/api/review/resolve`.

![BuilderHarness tabs in DeepSeek Harness](../../docs/assets/dsh-builderharness-panel.png)

The MCP entrypoint remains read-only: Cursor/Claude/Codex get the read tools,
not review writes, content confirmation, media capture, or publishing.

## Load into dsh

From the repository root:

```bash
dsh plugin --profile web add "file:$PWD/integrations/host"
```

Restart the Web UI or let the profile HMR pick up the patch, then:

1. Open a session in the target workspace.
2. Open the right sidebar and choose **生产基线 / 需求 / 原型 / 评审 / 内容 / 发布** from the guide.
3. Or ask the agent: `Use builderharness_status and summarize the content workspace.`

For a one-off overlay without installing:

```bash
cat >/tmp/builderharness-dsh.yml <<EOF
- insert:
    - id: builderharness
      name: '$PWD/integrations/host/src/dsh.mjs'
EOF
dsh web --patch /tmp/builderharness-dsh.yml
```

## Run MCP

```bash
BUILDERHARNESS_ROOT=/path/to/project node integrations/host/src/mcp.mjs
```

Cursor / Claude configuration:

```json
{
  "mcpServers": {
    "builderharness": {
      "command": "node",
      "args": ["/absolute/path/to/builderharness/integrations/host/src/mcp.mjs"],
      "env": {
        "BUILDERHARNESS_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

## Notes

- The host plugin uses raw JSON-Schema tool definitions; the client bundle is a
  hand-written `window.__ModuleLoader__` factory so it needs no build step.
- Tools are registered through `ctx.tools`; Cordis unregisters them when the
  plugin unloads.
- The workspace root defaults to the dsh **session working directory**, then
  `BUILDERHARNESS_ROOT`. Pass `root` to a tool when you need another workspace.
- Content confirmation and media capture run the installed `builderharness` CLI.
  Set `BUILDERHARNESS_KIT_ROOT` when the package is not resolvable from the dsh
  profile; otherwise the plugin resolves `builderharness/package.json`.
- The client panel uses the session's `cwd`; use dsh's `working_directory` tool
  (or a new session in the target workspace) before opening it.
- The package is `private` and versioned as a spike. The dsh package is
  `0.2.1-rc.2`; pin a compatible version before publishing.
- `ctx.builderharness` is registered as a Cordis service, so other plugins can
  `inject: ["builderharness"]` instead of reaching into the bundle internals.

## Existing-agent task evidence (0.9)

The base package also exposes the same server as `builderharness-mcp`.
`builderharness_context` retains the legacy topic-only KB response. Supply `task`
and optional relative `files`, `limit`, `maxChars` and `maxScan` for bounded project
instructions, decisions, specs, source and unexecuted verification entries. Missing,
truncated or conflicting evidence requires follow-up by the host agent.

Use `builderharness init` for project instructions and native review skills; MCP
is optional and read-only. See [migration and real-host verification](../../docs/migration-0.9.md).
