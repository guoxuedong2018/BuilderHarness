# BuilderHarness scaffold

Host-project files that turn an empty repository into a BuilderHarness workspace.
The package ships them as plain files; `npx builderharness init --scaffold` copies them into the
current project without overwriting existing files.

## Contents

| Path | Purpose |
|---|---|
| `docs/templates/` | FRS, README, FLOW, STATE and ACCEPTANCE templates |
| `docs/WORKFLOW.md` | requirement → FRS → prototype → review gate → deliverables → publish |
| `docs/DEPLOY.md` | deployment checklist and target conventions |
| `docs/DECISIONS.md` | cross-feature decision log |
| `docs/kb/README.md` | knowledge-base entry page |
| `docs/kb/CONTRIBUTING.md` | knowledge-base writing rules |
| `docs/kb/outline.config.mjs` | starter outline for `builderharness kb-scaffold` |
| `docs/kb/shots.config.mjs` | screenshot recipe registry |
| `docs/kb/clips.config.mjs` | clip/GIF recipe registry |
| `src/config/frs-map.js` | route ↔ feature-region registry |
| `src/utils/contrast.js` | WCAG contrast helper used by `check-ui` and the design-system page |
| `starter/` | Vite + React + Tailwind starter copied by the desktop “new project” flow |
| `.agent/skills/` | requirement review, PRD authoring, content drafting, review, UI, quality and optional Vue 2 skills |
| `AGENTS.md` / `CLAUDE.md` | project guide and Claude Code entrypoint |
| `.gitignore` | ignores generated reviews, PRD, media caches and credentials |

## Use

```bash
cd your-prototype
npx builderharness init --scaffold
npx builderharness init --scaffold --list          # show what would be copied
npx builderharness init --scaffold --force         # overwrite generated files
npx builderharness init --scaffold --only docs     # copy one subtree
```

After init:

1. Replace the placeholders in `AGENTS.md` and `docs/kb/outline.config.mjs`.
2. Add `builderharness` to the host project and mount the Vite plugin.
3. Run `npx builderharness kb-scaffold` to create the first knowledge-base pages.

The scaffold deliberately contains no product data, internal domains, credentials
or example business rules. Those belong to the host project.

Default `init` connects an existing agent without the complete scaffold. See [migration](../docs/migration-0.9.md).
