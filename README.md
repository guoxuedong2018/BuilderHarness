# BuilderHarness

**An agent harness for Product Builders.**

Connect feature specs, a running prototype and source-anchored review in your
repository. BuilderHarness gives coding agents project context and gives
maintainers tools to inspect changes, check references and keep documentation
aligned with the product.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[中文](./README.zh-CN.md) · [Getting started](./docs/getting-started.md) · [Architecture](./docs/architecture.md) · [Contributing](./CONTRIBUTING.md)

## What you can do

| Capability | What is included |
| :-- | :-- |
| Specify a feature | Feature requirement specification (FRS) templates, acceptance criteria and checks for spec, route and screenshot references. |
| Review the running app | Select an element and leave a comment linked to its source. Anchors fall back to component semantics or geometry when the source location changes. |
| Work with coding agents | Export open reviews and provide source, spec and content context through the CLI, project skills or an agent host. |
| Track changes | Find broken content references, changed source dependencies and media that needs review or regeneration. |
| Prepare deliverables | Generate PRDs and recipe-based media; maintain Markdown guides and release notes. Publishing uses a configured destination adapter. |

The working cycle is **specify → implement → review → check → approve**.
The checks help maintainers make decisions; teams choose how to enforce them in
their development and release workflows.

## Try the demo

Use **Node.js 22 or later** and npm for this walkthrough. The demo runs locally
and does not require a model API key or a publishing account.

```bash
git clone https://github.com/guoxuedong2018/BuilderHarness.git
cd BuilderHarness
npm ci
npm run demo
```

Open the local URL printed by Vite, usually `http://localhost:5173/#/overview`.
Select an element to add a review comment, then open Studio to inspect the
demo's content and references. Stop the server with `Ctrl+C`.

![The bundled React demo with review and content tools](./docs/assets/demo-overview-light.png)

To add BuilderHarness to an existing app, follow the
[integration guide](./docs/getting-started.md). It covers installation from
source, React and Vue 2 entry points, styles and production builds.

## Architecture

![BuilderHarness architecture: browser, CLI and agent hosts access local tooling and repository files; media and publishing use optional integrations](./docs/assets/architecture.svg)

The browser UI talks to local Vite middleware. The CLI and middleware reuse
pipeline modules; agent hosts access a workspace reader and domain service.
Specs, source, reviews and Markdown remain in your project. The diagram groups
modules by responsibility; these are not separately deployed services.

See the [architecture guide](./docs/architecture.md) for request paths,
source-anchor behavior, storage and the production boundary.

## Integration options

| Entry point | Scope | Status |
| :-- | :-- | :-- |
| Vite + React | In-app review and Studio through `builderharness/vite` and `builderharness/react`. | Included |
| Vite + Vue 2.7 | The same review UI through `builderharness/vue2`. | Included |
| CLI and project skills | Specs, reviews, content context, media and publishing commands. | Included |
| MCP | Read workspace status, content context, open reviews and publishing plans. | Experimental; read-only |
| DeepSeek Harness / Electron | Workspace panels, domain tools and a desktop launcher around DSH. | Experimental; separate setup |

Other frontend frameworks need a [host adapter](./docs/adapters.md). Media
capture uses Chrome/CDP; clip and GIF processing also needs ffmpeg. The bundled
media adapter targets Vue 2/Vite conventions and may need adaptation for your
routes and component state.

Agent integrations are documented under [integrations/](./integrations/).
Coding agents and model-provider configuration belong to the selected agent
host.

## Project files

BuilderHarness works with files in the host project:

```text
your-project/
├── src/ or web/                    # Application source
├── docs/
│   ├── features/<KEY>/FRS.json     # Specs and acceptance references
│   ├── reviews/*.json             # Review comments and anchors
│   └── kb/                        # Markdown, media recipes and review state
├── .agent/skills/                 # Reusable workflows for coding agents
└── AGENTS.md                      # Project-specific agent instructions
```

Markdown is the source for written content. Review locks, media hashes and
publication IDs are separate workflow metadata. Check your `.gitignore` before
sharing a workspace: the scaffold ignores review JSON and several generated
metadata files.

## Checks and release workflow

From an integrated host project:

```bash
npx builderharness check-frs
npx builderharness review open
npx builderharness kb check
```

`check-frs` validates specification structure and references; `review open`
lists unresolved feedback; `kb check` fails on broken content references and
reports items needing review. These commands do not automatically block a
deployment or establish that an implementation meets its acceptance criteria.

The review and Studio UI must be imported behind `import.meta.env.DEV`.
BuilderHarness's dev middleware and source-anchor injection run only in the
development server. Check the resulting build with
[preflight](./docs/getting-started.md#check-a-production-build); dependencies
used by your application, including React, remain in its bundle.

Publishing is optional and disabled until a destination is configured. The
repository includes a `docs-cli` reference adapter; other destinations require
an implementation of the [publishing contract](./docs/publishing.md). Review a
dry run before publishing. Application authentication, hosting and operational
monitoring remain part of the host project's infrastructure.

## Contributing

Bug reports, documentation improvements and focused pull requests are welcome.
For a bug, include the host framework, Node/Vite versions, reproduction steps
and the expected behavior. Start with the
[contribution guide](./CONTRIBUTING.md) or
[open an issue](https://github.com/guoxuedong2018/BuilderHarness/issues).

From the repository root:

```bash
npm ci
npm run check
npm run build:demo
npm run test:publish-gateway
```

## Documentation

- [Getting started and migration from Bee Press](./docs/getting-started.md)
- [Architecture and source anchors](./docs/architecture.md)
- [Project scaffold and spec templates](./scaffold/README.md)
- [Host and media adapters](./docs/adapters.md)
- [Content model](./docs/content-model.md)
- [Publishing destinations](./docs/publishing.md)
- [Styling](./docs/styling.md) and [UI components](./docs/ui-spec.md)
- [Agent-host integrations](./integrations/README.md)

## License

[MIT](./LICENSE)
