# UI spec integration

BuilderHarness uses the **Tool UI Spec** kept in [`ui-spec/`](../ui-spec) as its
design system. The spec is framework-agnostic at the principle and token
layers; React is the canonical component implementation.

## What lives where

| Layer | File | Role |
|---|---|---|
| Principles | [`ui-spec/UI-SPEC.md`](../ui-spec/UI-SPEC.md) | Rules, decision trees, anti-patterns |
| Agent rules | [`ui-spec/AGENT-RULES.md`](../ui-spec/AGENT-RULES.md) | Short, injectable version of the rules |
| Gate | [`ui-spec/SELF-CHECK.md`](../ui-spec/SELF-CHECK.md) | Manual and automated checks |
| Tokens | [`ui-spec/tokens.json`](../ui-spec/tokens.json), [`ui-spec/tokens.css`](../ui-spec/tokens.css) | Single source of truth |
| React reference | [`ui-spec/impl/react`](../ui-spec/impl/react) | Buttons, cards, dialogs, composer, table, empty state |
| Tailwind config | [`ui-spec/impl/react/tailwind.config.cjs`](../ui-spec/impl/react/tailwind.config.cjs) | Maps tokens to Tailwind classes; package consumers can require `builderharness/tailwind.config.cjs` |

## How the toolkit consumes it

1. **Tokens** — `client/core/tokens.css` imports `ui-spec/tokens.css`. The React
   adapter mounts it, so every toolkit surface sees the same CSS variables.
2. **Less bridge** — `client/core/theme-defaults.less` maps the toolkit's
   historical Less variables (`@color-primary`, `@space-8`, …) onto the semantic
   tokens. Hosts with their own token sheet can skip this file.
3. **React components** — the demo imports `Button`, `Card`, `Badge`, `Dialog`,
   `SegmentedControl`, `EmptyState`, `Table` from `builderharness/ui`.
4. **Tailwind 4** — the canonical React components use Tailwind classes generated
   from the same `tokens.json`. The demo loads the token-derived config through
   `@config`; container queries are built in.

### Using the defaults from a host

```js
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const kitRoot = path.dirname(require.resolve("builderharness/package.json"));
const themeDefaults = path.join(kitRoot, "client/core/theme-defaults.less");

export default defineConfig({
  css: {
    preprocessorOptions: {
      less: { additionalData: `@import "${themeDefaults}";\n` },
    },
  },
});
```

The trailing `\n` matters: Less comments on the first line of the imported file
must not be glued to the `@import` statement.

If the host already injects its own `@color-*` tokens, do not import the
defaults; host tokens and defaults would redefine the same variables.

## What was changed in the toolkit

The migration was deliberately surgical: the toolkit keeps its Less structure
and existing component APIs, but its values now come from the spec.

- Typography now uses the 8 role sizes (11/16 … 32/40) instead of ad-hoc sizes.
- Buttons use the spec's 24/28/32/40 height ladder, role-based radii, the
  `scale(0.98)` press feedback and the custom focus ring.
- Inputs, chips, segmented controls and badges use 4px-grid spacing and the
  spec's radii.
- Focus rings are `--focus-shadow` (accent ring + isolation inset), not the
  system outline.
- Transitions use `--dur-fast` / `--ease-out`; `transition: all` and `linear`
  are gone.
- Dynamic numbers use `tabular-nums` at the toolkit root.
- Comment drafts persist to `localStorage` (EDGE-03).
- Comment and block editors guard IME composition before submitting (EDGE-01).
- The studio already used a container query for its main column; this is now
  part of the checked rules.
- The React adapter and the demo use the canonical React components.
- `cn` registers the custom font-size roles with `tailwind-merge`. Without this,
  `text-body` / `text-prose` and `text-primary` are treated as the same group
  and the font size is silently dropped.
- Dialogs use an explicit `data-autofocus` marker. Destructive footers put it
  on Cancel, so the initial focus never lands on the destructive action.

## Demo spec page

`#/ui-spec` in the React demo is the living reference page. It is intentionally
more than a swatch board:

- **Foundations** — semantic color (light and dark values), the eight type
  roles, the 4px spacing grid, radius roles, elevation, motion and icons.
- **Components** — live buttons (5 variants × 4 sizes), inputs and fields,
  segmented control, badges, cards, dialog, table, empty state, code block,
  composer and messages.
- **Patterns** — review toolbar, metric row and settings panel.
- **Accessibility** — focus, keyboard, reduced motion and semantics.
- **Tokens** — a searchable semantic-token table plus the component contracts
  and change protocol.

The page imports `ui-spec/tokens.json` directly, so the displayed values cannot
drift from the spec.

## Conformance check

`npm run check` runs three layers:

- `scripts/check.mjs` — syntax and import smoke checks;
- `scripts/check-ui-spec.mjs` — a subset of SELF-CHECK A1–A8 across `client/`
  and the demo:
  - raw hex / rgb / hsl in component code;
  - `transition: all` and `linear`;
  - viewport breakpoints in component Less;
  - arbitrary radius / font-size values;
  - `outline: none` without a focus compensation;
  - icon-only buttons without `aria-label`.
- `scripts/check-public-deps.mjs` — every manifest and lockfile entry resolves
  from `https://registry.npmjs.org`.

The canonical components under `ui-spec/impl` are not re-linted; they are the
reference implementation.

## Remaining intentional exceptions

- `pipeline/check-ui.mjs` is a **host reference check**. It encodes one design
  system's conventions (iView components, a token file, a contrast utility) and
  is meant to be adapted or removed.
- The review/comments layer uses fixed z-index bands (`3000–3020`) and the
  studio uses `3100+`. These are tooling layers above any host component
  library; they are documented in the `z-index.less` files.
- The `SegmentedControl` from the canonical React implementation declares
  `container-type: inline-size`. When placed in a shrink-to-fit flex parent it
  can collapse to zero width; the demo overrides it with
  `[container-type:normal]` where needed. A future spec revision should move
  the container to a wrapper.

## Extending the system

1. Change `tokens.json` first.
2. Keep `tokens.css`, the Tailwind config and `theme-defaults.less` in sync.
3. Add or change a component recipe in `UI-SPEC.md` before changing both
   implementations.
4. Run `npm run check` and the demo (`npm run demo`).

### Framework-neutral table and editor logic

Import `createSelection`, `facetsOf` or `locate` from `builderharness/ui-data`.
Keep selection by stable IDs and apply select/deselect events to the current page.
`facetsOf` takes field definitions and a set of rows, returns filtered rows and counts
for enum values, and supports numeric/date ranges and text. `locate` tracks the
container, array position and key around the caret before JSON is complete.
