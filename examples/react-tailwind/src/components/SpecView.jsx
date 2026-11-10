import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  CodeBlock,
  Composer,
  Dialog,
  EmptyState,
  Field,
  Input,
  Message,
  SegmentedControl,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  cn,
} from "builderharness/ui";

import tokens from "../../../../ui-spec/tokens.json";
import { Icon } from "./Icons";

const NAV = [
  ["foundations", "Foundations", "01"],
  ["components", "Components", "02"],
  ["patterns", "Patterns", "03"],
  ["accessibility", "Accessibility", "04"],
  ["tokens", "Tokens", "05"],
];

const SURFACES = ["surface-0", "surface-1", "surface-2", "surface-3", "surface-sunken", "surface-hover", "surface-active"];
const STATUS = ["accent", "success", "warning", "danger", "info"];
const TYPE_SCALE = [
  ["display", "text-display", "Make the system visible.", tokens.typography.scale.display],
  ["title", "text-title", "Review quality before it ships.", tokens.typography.scale.title],
  ["heading", "text-heading", "Card and panel titles", tokens.typography.scale.heading],
  ["body-lg", "text-body-lg", "Longer form values and the composer input.", tokens.typography.scale["body-lg"]],
  ["body", "text-body", "The default reading size for lists and forms.", tokens.typography.scale.body],
  ["prose", "text-prose", "Markdown and long-form reading use a wider measure.", tokens.typography.scale.prose],
  ["footnote", "text-footnote", "Secondary labels and helper copy.", tokens.typography.scale.footnote],
  ["caption", "text-caption", "Timestamps, meta and keyboard hints.", tokens.typography.scale.caption],
];
const SPACES = ["2", "4", "6", "8", "10", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "56", "64"];
const DURATIONS = ["instant", "fast", "base", "sheet", "slow"];
const EASINGS = ["out", "snap", "overshoot"];
const BADGES = [
  ["success", "Passed"],
  ["warning", "Needs review"],
  ["danger", "Failed"],
  ["info", "Running"],
  ["neutral", "Draft"],
];
const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "outline", "danger"];
const BUTTON_SIZES = ["xs", "sm", "md", "lg"];
const ICONS = [
  "spark",
  "search",
  "command",
  "sun",
  "moon",
  "plus",
  "play",
  "check",
  "clock",
  "alert",
  "arrow",
  "comment",
  "layout",
  "layers",
  "settings",
  "terminal",
  "filter",
  "x",
  "copy",
  "external",
  "dots",
  "chevron",
  "git",
  "star",
  "bolt",
  "refresh",
];
const TABLE_ROWS = [
  ["042", "Retrieval quality · hybrid", "running", "1,284", "94.7"],
  ["041", "Citation precision", "passed", "2,108", "96.2"],
  ["040", "Long-query recall", "warning", "876", "88.4"],
  ["039", "Freshness sweep", "failed", "1,502", "72.1"],
];
const ROW_TONE = { running: "info", passed: "success", warning: "warning", failed: "danger" };
const CONTRACTS = [
  ["Button", "24 / 28 / 32 / 40px · five variants · scale(0.98) press"],
  ["Input", "32px · radius lg · custom focus ring · invalid state"],
  ["Card", "radius panel · shadow sm · one border · 1.5px hover lift"],
  ["Dialog", "max 448px · radius 2xl · focus trap · return focus"],
  ["Composer", "min 88px / max 384px · radius composer · IME guard"],
  ["Table", "surface-0 header · 12/16 cells · numeric right + tnum"],
  ["Empty state", "24px icon · title scale · one primary action required"],
  ["Segmented", "pill track · 32px height · 120ms snap indicator"],
  ["Code block", "radius xl · 36px header · copy feedback"],
  ["Message", "user bubble accent-subtle · assistant has no bubble"],
];

function Stat({ value, label }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-1 px-3 py-2">
      <p className="font-mono text-title font-semibold tabular-nums text-primary">{value}</p>
      <p className="mt-0.5 text-caption text-tertiary">{label}</p>
    </div>
  );
}

function Section({ id, index, title, description, children }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-6">
      <div className="flex items-start gap-3 border-b border-subtle pb-4">
        <span className="mt-1 font-mono text-caption font-semibold text-accent">{index}</span>
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-primary wrap-balance">{title}</h2>
          {description && <p className="mt-1 max-w-prose text-body text-secondary wrap-pretty">{description}</p>}
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function Demo({ title, hint, children, className }) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-panel border border-subtle bg-surface-2 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-subtle px-4 py-3">
        <div>
          <p className="text-footnote font-semibold text-primary">{title}</p>
          {hint && <p className="mt-0.5 text-caption text-tertiary">{hint}</p>}
        </div>
        <span className="font-mono text-caption text-tertiary">live</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Swatch({ name, light, dark, wide }) {
  return (
    <div className={cn("rounded-lg border border-subtle bg-surface-1 p-2", wide && "flex items-center gap-3")}>
      <div
        className={cn("rounded-md border border-subtle", wide ? "size-8 shrink-0" : "h-10")}
        style={{ background: `var(--${name})` }}
        aria-hidden="true"
      />
      <div className={cn("min-w-0", wide ? "" : "mt-2")}>
        <p className="truncate font-mono text-caption font-medium text-primary">{name}</p>
        <p className="truncate font-mono text-caption text-tertiary">L {light}</p>
        <p className="truncate font-mono text-caption text-tertiary">D {dark}</p>
      </div>
    </div>
  );
}

function TokenValue({ children }) {
  return <code className="break-all rounded-sm bg-surface-active px-1 py-0.5 font-mono text-caption text-secondary">{children}</code>;
}

export default function SpecView() {
  const [active, setActive] = useState("foundations");
  const [segment, setSegment] = useState("preview");
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [query, setQuery] = useState("");

  const tokenRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.entries(tokens.semantic.light).filter(([name]) => !needle || name.includes(needle));
  }, [query]);

  const jump = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="relative overflow-hidden rounded-2xl border border-subtle bg-surface-2 p-5 shadow-sm sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-pill"
          style={{ background: "radial-gradient(circle, var(--accent-subtle), transparent 62%)" }}
        />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">v1.0.0 · stable</Badge>
            <Badge tone="info">Web / desktop tools</Badge>
            <Badge tone="neutral">MIT</Badge>
            <span className="text-caption text-tertiary">Updated 2026-10-19</span>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="font-mono text-caption font-semibold uppercase tracking-widest text-tertiary">Tool UI Spec</p>
              <h1 className="mt-2 font-serif text-display text-primary wrap-balance">Make the system visible.</h1>
              <p className="mt-3 max-w-prose text-body-lg text-secondary wrap-pretty">
                A constraint layer for long-lived tool products: one accent, role-based surfaces, a 4px grid,
                tokenized motion and components that explain their own rules.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[360px]">
              <Stat value={Object.keys(tokens.semantic.light).length} label="semantic tokens" />
              <Stat value={CONTRACTS.length} label="component contracts" />
              <Stat value={TYPE_SCALE.length} label="type roles" />
              <Stat value={Object.keys(tokens.radius).filter((k) => !k.startsWith("$") && k !== "roleMap" && k !== "concentricRule").length} label="radius roles" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => jump("components")}>
              Browse components
              <Icon name="arrow" />
            </Button>
            <Button variant="ghost" onClick={() => jump("tokens")}>
              Token reference
            </Button>
            <span className="ml-auto flex items-center gap-1.5 text-caption text-tertiary">
              <span className="size-1.5 rounded-pill bg-success" aria-hidden="true" />
              Theme-aware · light and dark share the same roles
            </span>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[168px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-3 lg:self-start">
          <nav aria-label="UI spec sections" className="flex gap-1 overflow-x-auto rounded-panel border border-subtle bg-surface-2 p-1.5 lg:flex-col">
            {NAV.map(([id, label, index]) => (
              <button
                key={id}
                type="button"
                aria-current={active === id ? "location" : undefined}
                onClick={() => jump(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-footnote transition-colors duration-fast ease-out",
                  active === id ? "bg-surface-active text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary",
                )}
              >
                <span className="font-mono text-caption text-accent">{index}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-3 hidden rounded-panel border border-subtle bg-surface-2 p-3 lg:block">
            <p className="text-caption font-semibold text-primary">Canonical source</p>
            <p className="mt-1 break-all font-mono text-caption text-tertiary">ui-spec/UI-SPEC.md</p>
            <p className="mt-3 text-caption font-semibold text-primary">Machine-readable</p>
            <p className="mt-1 break-all font-mono text-caption text-tertiary">ui-spec/tokens.json</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-8">
          <Section
            id="foundations"
            index="01"
            title="Foundations"
            description="The invariants that every component inherits. Components consume semantic roles, never raw primitives."
          >
            <Demo title="Semantic color" hint="Light and dark are separate mappings, not an inversion.">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {SURFACES.map((name) => (
                  <Swatch key={name} name={name} light={tokens.semantic.light[name]} dark={tokens.semantic.dark[name]} />
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {STATUS.map((name) => (
                  <Swatch key={name} name={name} light={tokens.semantic.light[name]} dark={tokens.semantic.dark[name]} wide />
                ))}
              </div>
              <p className="mt-3 text-caption text-tertiary">Accent is the only brand color. Status colors never replace an icon or a label.</p>
            </Demo>

            <Demo title="Type scale" hint="Each role binds size, line height and weight. No ad-hoc font sizes.">
              <div className="flex flex-col">
                {TYPE_SCALE.map(([key, className, sample, role]) => (
                  <div key={key} className="grid gap-2 border-b border-subtle py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_160px_220px] lg:items-baseline">
                    <p className={cn(className, "text-primary")}>{sample}</p>
                    <div className="flex items-baseline gap-2 font-mono text-caption">
                      <span className="font-semibold text-primary">{key}</span>
                      <span className="text-tertiary">
                        {role.size} / {role.lineHeight}
                      </span>
                    </div>
                    <p className="text-caption text-tertiary">{role.use}</p>
                  </div>
                ))}
              </div>
            </Demo>

            <div className="grid gap-4 xl:grid-cols-2">
              <Demo title="Spacing" hint="4px grid. 2px is allowed only for hairline adjustments.">
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {SPACES.map((key) => {
                    const px = Number(key);
                    return (
                      <div key={key} className="flex items-center gap-2 rounded-md border border-subtle bg-surface-1 px-2 py-1.5">
                        <span className="w-8 font-mono text-caption text-tertiary">{key}</span>
                        <span className="h-1.5 rounded-pill bg-accent" style={{ width: `${Math.max(px, 2)}px` }} aria-hidden="true" />
                        <span className="ml-auto font-mono text-caption text-tertiary">{px}px</span>
                      </div>
                    );
                  })}
                </div>
              </Demo>

              <Demo title="Radius" hint="Radius is a role, not a mood.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(tokens.radius.roleMap).map(([role, key]) => (
                    <div key={`${role}-${key}`} className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-1 p-2">
                      <span className="h-9 w-12 shrink-0 border border-default bg-surface-3" style={{ borderRadius: tokens.radius[key] }} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-caption font-medium text-primary">{key}</p>
                        <p className="truncate text-caption text-tertiary">
                          {tokens.radius[key]} · {role}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Demo>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Demo title="Elevation" hint="Two-layer shadows. Dark mode changes the mapping.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {["sm", "md", "lg", "popover"].map((key) => (
                    <div key={key} className="rounded-panel border border-subtle bg-surface-2 p-3" style={{ boxShadow: `var(--shadow-${key})` }}>
                      <p className="font-mono text-caption font-semibold text-primary">shadow-{key}</p>
                      <p className="mt-1 text-caption text-tertiary">Elevation token</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-panel border border-subtle bg-surface-2 p-3">
                  <p className="text-caption font-semibold text-primary">Focus ring</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="secondary" size="sm">
                      Tab to focus
                    </Button>
                    <Input aria-label="Focus ring sample" placeholder="Input focus" className="w-40" />
                  </div>
                </div>
              </Demo>

              <Demo title="Motion" hint="Hover a bar to see its duration. Reduced motion keeps state changes.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {DURATIONS.map((key) => (
                    <div key={key} className="group rounded-lg border border-subtle bg-surface-1 p-2.5">
                      <div className="flex items-center justify-between font-mono text-caption">
                        <span className="text-primary">{key}</span>
                        <span className="text-tertiary">{tokens.motion.duration[key]}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-active">
                        <div
                          className="h-full w-1/4 rounded-pill bg-accent transition-transform ease-out group-hover:translate-x-8"
                          style={{ transitionDuration: tokens.motion.duration[key] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {EASINGS.map((key) => (
                    <span key={key} className="rounded-pill border border-subtle bg-surface-1 px-2 py-1 font-mono text-caption text-secondary">
                      ease-{key} · {tokens.motion.easing[key]}
                    </span>
                  ))}
                </div>
              </Demo>
            </div>

            <Demo title="Iconography" hint="20px grid, 1.5px stroke, currentColor. Icons are always decorative or labelled.">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-10">
                {ICONS.map((name) => (
                  <div key={name} className="flex flex-col items-center gap-1 rounded-md border border-subtle bg-surface-1 px-1 py-2">
                    <Icon name={name} size={20} className="text-secondary" />
                    <span className="truncate font-mono text-caption text-tertiary">{name}</span>
                  </div>
                ))}
              </div>
            </Demo>
          </Section>

          <Section
            id="components"
            index="02"
            title="Components"
            description="Reference implementations are live on this page. Every state below uses the same tokens as the toolkit."
          >
            <Demo title="Button" hint="Five variants, four sizes, four states. Press feedback is scale(0.98).">
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-subtle">
                      <th scope="col" className="py-2 pr-3 text-caption font-semibold text-secondary">Variant</th>
                      {BUTTON_SIZES.map((size) => (
                        <th key={size} scope="col" className="px-2 py-2 text-caption font-semibold text-secondary">
                          {size}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {BUTTON_VARIANTS.map((variant) => (
                      <tr key={variant} className="border-b border-subtle last:border-b-0">
                        <td className="py-2 pr-3 font-mono text-caption text-tertiary">{variant}</td>
                        {BUTTON_SIZES.map((size) => (
                          <td key={size} className="px-2 py-2">
                            <Button variant={variant} size={size}>
                              {variant}
                            </Button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="secondary" disabled>
                  Disabled
                </Button>
                <Button variant="primary" iconOnly aria-label="Add experiment">
                  <Icon name="plus" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Icon name="filter" />
                  Filter
                </Button>
              </div>
            </Demo>

            <Demo title="Field and input" hint="32px tall, custom focus ring, error via aria-invalid.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Experiment name" hint="Sentence case, 3–40 characters." htmlFor="spec-name">
                  <Input id="spec-name" placeholder="Retrieval quality" />
                </Field>
                <Field label="Owner" hint="A person or a team." htmlFor="spec-owner">
                  <Input id="spec-owner" defaultValue="Atlas research" />
                </Field>
                <Field label="Slug" error="Use lowercase letters and dashes." htmlFor="spec-slug">
                  <Input id="spec-slug" invalid defaultValue="Retrieval Quality" />
                </Field>
                <Field label="Disabled" hint="Read-only by policy." htmlFor="spec-disabled">
                  <Input id="spec-disabled" disabled defaultValue="Locked" />
                </Field>
              </div>
            </Demo>

            <div className="grid gap-4 xl:grid-cols-2">
              <Demo title="Segmented control" hint="Arrow keys move the selection; labels collapse in narrow containers.">
                <div className="w-full [container-type:normal]">
                  <SegmentedControl
                    aria-label="Preview mode"
                    className="w-full"
                    items={[
                      { value: "preview", label: "Preview" },
                      { value: "comments", label: "Comments" },
                      { value: "structure", label: "Structure" },
                    ]}
                    value={segment}
                    onValueChange={setSegment}
                  />
                </div>
                <p className="mt-2 text-footnote text-tertiary">
                  Selected: <TokenValue>{segment}</TokenValue>
                </p>
              </Demo>

              <Demo title="Badges" hint="Status carries a symbol. Color alone is not a signal.">
                <div className="flex flex-wrap gap-2">
                  {BADGES.map(([tone, label]) => (
                    <Badge key={tone} tone={tone}>
                      {label}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 text-caption text-tertiary">Neutral is for drafts and metadata; status tones are reserved for state.</p>
              </Demo>
            </div>

            <Demo title="Cards" hint="One border, one shadow, one hover lift. Never nest bordered cards.">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardTitle>Default card</CardTitle>
                  <CardDescription>Hover to see the 1.5px lift and shadow transition.</CardDescription>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone="success">Live</Badge>
                    <Button variant="ghost" size="xs">
                      Open
                      <Icon name="arrow" size={14} />
                    </Button>
                  </div>
                </Card>
                <Card compact>
                  <CardTitle>Compact</CardTitle>
                  <CardDescription>12px padding for dense sidebars.</CardDescription>
                </Card>
                <Card static>
                  <CardTitle>Static</CardTitle>
                  <CardDescription>No hover movement for read-only summaries.</CardDescription>
                </Card>
              </div>
            </Demo>

            <Demo title="Dialog" hint="Focus trap, Escape, focus return. Danger focuses Cancel first.">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setDialog("default")}>
                  Open dialog
                </Button>
                <Button variant="danger" onClick={() => setDialog("danger")}>
                  Open danger dialog
                </Button>
              </div>
            </Demo>

            <Demo title="Table" hint="Numeric columns right-align and use tabular numbers.">
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Run</TH>
                      <TH>Experiment</TH>
                      <TH>Status</TH>
                      <TH numeric>Samples</TH>
                      <TH numeric>Score</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {TABLE_ROWS.map(([run, name, status, samples, score]) => (
                      <TR key={run}>
                        <TD className="font-mono text-caption text-tertiary">{run}</TD>
                        <TD className="font-medium">{name}</TD>
                        <TD>
                          <Badge tone={ROW_TONE[status]}>{status}</Badge>
                        </TD>
                        <TD numeric className="text-secondary">
                          {samples}
                        </TD>
                        <TD numeric className="font-medium">
                          {score}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </Demo>

            <div className="grid gap-4 xl:grid-cols-2">
              <Demo title="Empty state" hint="Every empty state needs a next action.">
                <EmptyState
                  icon={<Icon name="layers" size={24} />}
                  title="No review threads"
                  description="Select an element on the prototype to start the first thread."
                  action={<Button variant="primary">Start review</Button>}
                  secondaryAction={<Button variant="ghost">Read the guide</Button>}
                />
              </Demo>

              <Demo title="Code block" hint="Copy feedback, horizontal scroll, no wrapping.">
                <CodeBlock
                  language="js"
                  code={'builderHarness({\n  anchorLoc: "react",\n  frsRegistry: "src/config/frs-map.js",\n  barLinks: [{ label: "UI spec", route: "/ui-spec" }],\n});'}
                />
              </Demo>
            </div>

            <Demo title="Composer and messages" hint="Enter sends, Shift+Enter wraps, IME composition is guarded.">
              <div className="flex flex-col gap-3">
                <Message role="user" meta="14:32 · product">
                  Can we show where a comment is anchored?
                </Message>
                <Message role="assistant" meta="14:33 · BuilderHarness">
                  Yes. The composer shows the source coordinate, and the review queue keeps the anchor after a refresh.
                </Message>
                {lastPrompt && (
                  <Message role="user" meta="just now">
                    {lastPrompt}
                  </Message>
                )}
              </div>
              <div className="mt-4">
                <Composer
                  value={draft}
                  onValueChange={setDraft}
                  onSubmit={(value) => {
                    setLastPrompt(value);
                    setDraft("");
                  }}
                  placeholder="Ask about the system…"
                />
              </div>
            </Demo>
          </Section>

          <Section
            id="patterns"
            index="03"
            title="Patterns"
            description="Small compositions that show how the primitives behave together. Patterns do not introduce new tokens."
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <Demo title="Review toolbar" hint="One primary action, secondary controls stay ghost.">
                <div className="flex flex-wrap items-center gap-2 rounded-panel border border-subtle bg-surface-1 p-2">
                  <Badge tone="info">3 open</Badge>
                  <span className="text-footnote text-secondary">Anchors</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm">
                      <Icon name="comment" />
                      Comments
                    </Button>
                    <Button variant="primary" size="sm">
                      New review
                    </Button>
                  </span>
                </div>
              </Demo>

              <Demo title="Metric row" hint="Large numbers use tabular numerals; deltas carry a symbol and a label.">
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    ["1,284", "Runs this week", "+18.2%"],
                    ["94.7", "Retrieval quality", "+2.1"],
                    ["312ms", "p95 latency", "−41ms"],
                  ].map(([value, label, delta]) => (
                    <Card key={label} compact static>
                      <p className="text-caption text-tertiary">{label}</p>
                      <p className="mt-1 font-mono text-title font-semibold tabular-nums text-primary">{value}</p>
                      <p className="mt-1 text-caption font-medium text-success">{delta}</p>
                    </Card>
                  ))}
                </div>
              </Demo>
            </div>

            <Demo title="Settings panel" hint="Labels above controls; primary action right-aligned.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Workspace name" htmlFor="spec-workspace">
                  <Input id="spec-workspace" defaultValue="Atlas research" />
                </Field>
                <Field label="Review window" hint="Time zone follows the browser." htmlFor="spec-window">
                  <Input id="spec-window" defaultValue="Last 12 hours" />
                </Field>
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-subtle pt-3">
                <Button variant="ghost">Cancel</Button>
                <Button variant="primary">Save changes</Button>
              </div>
            </Demo>
          </Section>

          <Section
            id="accessibility"
            index="04"
            title="Accessibility"
            description="The rules that cannot be waived. These are checked in review, not left to taste."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Focus", "Every interactive control uses the custom focus ring. Removing an outline without a replacement is a defect.", "check"],
                ["Keyboard", "Dialogs trap Tab, close on Escape and return focus. Segmented controls support arrow keys and Home/End.", "command"],
                ["Motion", "prefers-reduced-motion removes translation and scale, keeps state changes and uses 1ms durations.", "moon"],
                ["Semantics", "Icon-only buttons require aria-label. Invalid inputs set aria-invalid. Status uses an icon and a label.", "alert"],
              ].map(([title, body, icon]) => (
                <Card key={title} static compact>
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                      <Icon name={icon} />
                    </span>
                    <div>
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{body}</CardDescription>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Demo title="Do / Don't" hint="The shortest version of the review checklist.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-panel border border-subtle bg-success-subtle p-4">
                  <p className="flex items-center gap-2 text-footnote font-semibold text-success">
                    <Icon name="check" />
                    Do
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-footnote text-secondary">
                    <li>Use one accent for the primary action.</li>
                    <li>Use semantic roles for every color, radius and duration.</li>
                    <li>Keep 4px spacing and tabular numerals for data.</li>
                  </ul>
                </div>
                <div className="rounded-panel border border-subtle bg-danger-subtle p-4">
                  <p className="flex items-center gap-2 text-footnote font-semibold text-danger">
                    <Icon name="x" />
                    Don't
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-footnote text-secondary">
                    <li>Don't introduce a second brand color.</li>
                    <li>Don't nest bordered cards or add a second outline.</li>
                    <li>Don't ship an empty state without an action.</li>
                  </ul>
                </div>
              </div>
            </Demo>
          </Section>

          <Section
            id="tokens"
            index="05"
            title="Token reference"
            description="Filter semantic tokens by name. The values below are the light mapping; the dark mapping uses the same roles."
          >
            <Demo title="Semantic tokens" hint="Components may reference this layer only.">
              <div className="max-w-sm">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tokens…" aria-label="Filter tokens" />
              </div>
              <div className="mt-3 min-w-0 overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead className="bg-surface-0">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-caption font-semibold text-secondary">Token</th>
                      <th scope="col" className="px-3 py-2 text-caption font-semibold text-secondary">Light</th>
                      <th scope="col" className="px-3 py-2 text-caption font-semibold text-secondary">Dark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenRows.map(([name, value]) => (
                      <tr key={name} className="border-t border-subtle">
                        <td className="px-3 py-2 font-mono text-caption text-primary">{name}</td>
                        <td className="px-3 py-2 font-mono text-caption text-tertiary">{value}</td>
                        <td className="px-3 py-2 font-mono text-caption text-tertiary">{tokens.semantic.dark[name]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!tokenRows.length && <p className="mt-3 text-footnote text-tertiary">No token matches “{query}”.</p>}
            </Demo>

            <Demo title="Component contracts" hint="What each component is allowed to consume.">
              <div className="grid gap-2 sm:grid-cols-2">
                {CONTRACTS.map(([name, contract]) => (
                  <div key={name} className="rounded-lg border border-subtle bg-surface-1 p-3">
                    <p className="font-mono text-caption font-semibold text-primary">{name}</p>
                    <p className="mt-1 text-footnote text-secondary">{contract}</p>
                  </div>
                ))}
              </div>
            </Demo>

            <Demo title="Change protocol" hint="Tokens first, then components, then the gate.">
              <ol className="grid gap-2 sm:grid-cols-3">
                {[
                  ["1", "Change tokens.json", "The single source of truth for primitive, semantic and component values."],
                  ["2", "Update the mapping", "Keep tokens.css, the Tailwind config and the reference components in sync."],
                  ["3", "Run the gate", "npm run check covers syntax, the UI spec subset and public dependency provenance."],
                ].map(([step, title, body]) => (
                  <li key={step} className="rounded-lg border border-subtle bg-surface-1 p-3">
                    <span className="font-mono text-caption font-semibold text-accent">{step}</span>
                    <p className="mt-1 text-footnote font-semibold text-primary">{title}</p>
                    <p className="mt-1 text-caption text-tertiary">{body}</p>
                  </li>
                ))}
              </ol>
            </Demo>
          </Section>
        </div>
      </div>

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "danger" ? "Delete this experiment?" : "Create a review link"}
        description={
          dialog === "danger"
            ? "This removes the run and its review threads. The action cannot be undone."
            : "The link opens the current prototype build for a reviewer who is not in this workspace."
        }
        tone={dialog === "danger" ? "danger" : "default"}
        footer={
          <>
            <Button variant="ghost" data-autofocus onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog === "danger" ? "danger" : "primary"} onClick={() => setDialog(null)}>
              {dialog === "danger" ? "Delete experiment" : "Create link"}
            </Button>
          </>
        }
      >
        <p className="text-body text-secondary">
          {dialog === "danger"
            ? "Reviewers will lose access to the pinned build as soon as the run is deleted."
            : "The link is read-only by default. Change the access group in the hosting console before sharing it widely."}
        </p>
      </Dialog>
    </div>
  );
}
