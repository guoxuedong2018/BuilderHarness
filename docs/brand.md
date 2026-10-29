# BuilderHarness brand

**An agent harness for Product Builders.**

BuilderHarness is the product name. The repository, prose and headings use
**BuilderHarness** — one word, camel case. The npm package and import paths are
`builderharness`.

## Positioning

> **BuilderHarness is an agent harness for Product Builders.** Day to day it
> keeps Claude (and similar agents) on a leash: executable specs, a same-stack
> runnable prototype as the source of truth, and human review before ship.

| Dimension | Definition |
| :-- | :-- |
| **User** | Internet Product Builders — product × engineering × operations |
| **Category** | Agent harness: constrain the agent, run the loop, gate the result |
| **Job** | Build a maintainable product at 0→1; keep changing, accepting and announcing it at 1→100 |
| **Source of truth** | A same-stack runnable prototype plus specs (FRS, `frs:` / `code:` facts) |
| **Gate** | Spec ↔ same-stack prototype ↔ review before ship |
| **Production pieces** | Auth, observability and deploy connect through adapters (Cloudflare, GCP, internal platforms) |

The fixed sentence for any channel:

> **Spec-gated → use mature infrastructure → review before ship.**

### What it is not

- Not a CMS, a content factory or a publishing platform as the main story.
- Not WordPress-like publishing or a generic AI writing assistant.
- Not a Lovable / Bolt / v0 page generator.
- Not a delivered auth / observability / deploy / SRE stack.
- The gate is not a gold label or a reward-model loop. Passing means the spec
  and the same-stack prototype agree.

## Existing-agent entry

The default entry connects the user's existing Codex / Claude Code project.
Evidence-based requirement review precedes process sizing: examine goals, active
constraints, historical premises and alternatives, including flaws in human proposals.
Historical decisions may be superseded when their premises or goals change. Small
changes remain lightweight. Scripts collect evidence and run bounded checks; the
existing agent explains tradeoffs and carries out authorized work. Browser review
is an optional capability. Do not claim that generated instructions or a passing
structural check prove the agent loaded the workflow or the product meets intent.

## Why "harness"

- **Builder** names the buyer and the output perspective: the person who builds
  the product, writes the spec and reviews the result.
- **Harness** names the category and the mechanism: constrain the agent, run
  the loop, score and gate the result. This maps to the review anchors,
  `frs:` / `code:` facts, Agent context, preflight, the DSH sidebar and the
  adapter hooks.
- Avoid `Spec`, `Ship`, `Kit`, `Press` or `Bee` in the name: they read as a
  one-off CI tool, a PR bot, a component bundle, a CMS or a mascot.

The harness constrains the process; it does not replace implementation. Keep
lifecycle claims (0→1→100) in vision or buyer-story language, never as a
delivered production lifecycle.

## Content is a side effect

When the loop is in place, manuals, launch notes, message cards, screenshots and
clips are throughput on the same source of truth. They are useful, but they are
**downstream deliverables**, not the product category. In prose, mention the
loop first and the deliverables second.

**Connecting ≠ bundling ≠ production-ready by default.** Never imply that
plugging in Cloudflare or GCP makes a prototype production-ready.

## Naming

| Context | Name |
| :-- | :-- |
| Product name | **BuilderHarness** |
| Package | `builderharness` |
| Import paths | `builderharness/*` |
| CLI | `builderharness` |
| Environment variables | `BUILDERHARNESS_*` |
| Review capability | Review |
| Content capability | Studio |
| Publishing capability | Publish |
| Repository | [BuilderHarness](https://github.com/guoxuedong2018/BuilderHarness) |

Use **BuilderHarness** in prose and headings. Use `builderharness` for
package-like identifiers and commands. Do not write `Builder Harness` (two
words) as the product name.

## Taglines

Primary:

> **An agent harness for Product Builders.**

Supporting:

- **Spec-gated. Prototype-as-truth. Review before ship.**
- **Constrain the agent; gate the result.**
- **Same source, downstream deliverables.**
- **Connect, don't bundle.**

## Voice

- Evidence first: name the spec id, the page, the source coordinate or the
  artifact.
- Calm and precise; no "magic", "revolutionary" or animal metaphors.
- Explain the task before the mechanism. "Confirm this claim is still true"
  comes before "review lock" or "fact reference".
- State boundaries plainly: what is in the box, what connects, what a human
  must decide.
- The human sets intent and approves. Agents do the repetitive work.

## Visual direction

- Show the loop: spec, prototype, review pins, gate. Diagrams are structural,
  not decorative.
- Avoid mascots, hive patterns and bee/amber motifs. Keep the existing warm
  neutral palette and semantic status colors.
- The wordmark is `BuilderHarness` in the existing UI type scale; no custom
  display font is required.
