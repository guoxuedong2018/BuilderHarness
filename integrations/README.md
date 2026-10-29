# BuilderHarness integrations

For existing Codex / Claude Code projects, start with `builderharness init` and the
[0.9 migration guide](../docs/migration-0.9.md). DSH and desktop setup remain optional.

This directory is the integration layer for running BuilderHarness beside an agent
runtime instead of inside a prototype. The dsh plugin now has a right-sidebar
panel and review write tools; the MCP entrypoint remains read-only.

## Pieces

| Path | What it is |
| :-- | :-- |
| [`host/`](./host/README.md) | `@builderharness/dsh-bundle`: a dsh plugin plus a `builderharness-mcp` entrypoint |
| [`host/src/project.mjs`](./host/src/project.mjs) | Dependency-free workspace reader used by both hosts |
| [`test-integrations.mjs`](./test-integrations.mjs) | Mock-harness and MCP protocol tests |

## The seam

```text
Cursor / Claude / Codex ──MCP──┐
                                ├── shared workspace reader ── docs/
DeepSeek Harness ──Cordis──────┘
```

Both hosts expose the same three read tools:

- `builderharness_status`
- `builderharness_context`
- `builderharness_review_open`

The dsh host adds:

- `builderharness_review_add`
- `builderharness_review_resolve`
- a **BuilderHarness** right-sidebar tab with workspace status, content pages,
  open reviews and in-place resolution

The workspace is the contract, not the agent runtime. That is what keeps the
kit usable with an external IDE agent and with a bundled BuilderHarness Desktop.

## Run the checks

```bash
npm run test:integrations
```

The test creates a temporary BuilderHarness workspace, exercises the shared reader
and review writes, registers the dsh plugin against a mock `ctx.tools` and HTTP
route, validates the client bundle factory, and drives the MCP server over
newline-delimited JSON-RPC.

## Model setup

In a dsh Web profile, open **Settings → Models** and configure either the
DeepSeek route, a third-party provider, or a custom OpenAI-compatible endpoint
for a local vLLM / LM Studio / Ollama-style server. Local models are only useful
for this workflow when they support tool calls and structured output; validate
that before treating them as a full-lifecycle agent.

## Status

The dsh bundle is installed and verified in dsh `0.2.1-rc.2`: the plugin loads,
the BuilderHarness guide entry opens a right-sidebar tab, the tab resolves the
Session workspace, and the agent can call the read/write review tools. The MCP
protocol is tested separately.

## What comes next

1. A `ctx.builderharness` service instead of direct filesystem reads in tools.
2. Content confirmation tools backed by the review lock.
3. Media capture through dsh `browser-use` / `computer-use`.
4. Publish planning through the existing destination gateway.
5. A thin downstream desktop shell; do not patch the dsh core.
