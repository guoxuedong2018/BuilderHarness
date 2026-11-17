# Contributing

Thanks for taking the time to contribute.

## Setup

```bash
git clone https://github.com/guoxuedong2018/BuilderHarness.git
cd BuilderHarness
npm install
npm run check
```

`npm run check` runs syntax checks, the Tool UI Spec gate
(`scripts/check-ui-spec.mjs`) and the public dependency guard
(`scripts/check-public-deps.mjs`). The guard rejects private registries,
`file:`/`link:` specs and non-npmjs lockfile URLs. Run the demo with
`npm run demo` and build it with `npm run build:demo`. With Chrome installed
and the demo stopped, `npm run check:demo` runs its browser scenarios and
production preflight.

## Scope

BuilderHarness is intentionally small and local-first:

- No hosted service, no telemetry, no account system.
- Dev-only middleware; never ship the toolkit to production.
- Markdown is the single source of truth. Do not add a second copy of the content graph.
- The toolkit must not import product code. Business data crosses the boundary through `virtual:builderharness/host`.

## Pull requests

- Keep changes surgical and explain the user-visible behaviour.
- Add or update documentation when the integration surface changes.
- Run `npm run check` and `npm run build:demo` before opening a PR.
- Follow [`ui-spec/AGENT-RULES.md`](./ui-spec/AGENT-RULES.md) for UI changes; token
  values come from `ui-spec/tokens.json`.
- Read [`docs/brand.md`](./docs/brand.md) before changing README, product copy or
  capability claims. The product and npm package are `builderharness`.
- For UI changes, include a screenshot or a short description of the before/after.

## Reporting bugs

Open an issue with:

- Node, Vite and Vue versions;
- the host framework and adapter used;
- a minimal reproduction or the relevant slice of `vite.config.js`;
- the expected and actual behaviour.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
