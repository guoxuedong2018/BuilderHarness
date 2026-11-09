import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, SegmentedControl, Table, TableWrap, TBody, TD, TH, THead, TR } from "builderharness/ui";

import { ActivityTable } from "./components/ActivityTable";
import { CommandPalette } from "./components/CommandPalette";
import { ContentHealth } from "./components/ContentHealth";
import { Icon } from "./components/Icons";
import { MetricCard } from "./components/MetricCard";
import { NewExperimentDialog } from "./components/NewExperimentDialog";
import { ReviewCanvas } from "./components/ReviewCanvas";
import { Sidebar } from "./components/Sidebar";
import { SpecView } from "./components/SpecView";
import { Toast } from "./components/Toast";
import { Topbar } from "./components/Topbar";
import { EXPERIMENTS, METRICS, THREADS } from "./data";
import { ROUTES, navigate, useHashRoute } from "./router";

const THEME_KEY = "helix:theme";
const CREATED_KEY = "helix:created-experiments";

function readCreated() {
  try {
    const value = JSON.parse(localStorage.getItem(CREATED_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const STATUS_TONE = { draft: "info", running: "info", review: "warning", passed: "success", failed: "danger" };
const STATUS_ICON = { draft: "○", running: "▶", review: "◔", passed: "✓", failed: "✕" };

function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function Hero({ onNew, onReview }) {
  return (
    <section className="relative overflow-hidden rounded-panel bg-surface-2 shadow-sm demo-glow">
      <div aria-hidden="true" className="demo-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[620px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info" icon={<span className="anim-breathe">●</span>}>
              Experiment 042 running
            </Badge>
            <span className="text-caption text-tertiary">Updated 2 min ago · 1,284 samples</span>
          </div>
          <h1 className="mt-3 text-display font-normal tracking-tight text-primary wrap-balance">
            Make retrieval quality visible before it ships.
          </h1>
          <p className="mt-2 text-body-lg text-secondary wrap-pretty">
            Helix is a synthetic product workspace for the BuilderHarness demo: runs, review threads and content health in one place.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-caption">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-3 px-2 py-1 font-mono text-tertiary">
              <span className="size-1.5 rounded-pill bg-success" aria-hidden="true" />
              src/pages/experiments/042.jsx:88:12
            </span>
            <span className="text-tertiary">exact anchor</span>
            <span className="text-tertiary">·</span>
            <span className="text-tertiary">2 moved</span>
            <span className="text-tertiary">·</span>
            <span className="text-tertiary">1 lost</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={onReview}>
            <Icon name="comment" size={15} />
            Review queue
          </Button>
          <Button variant="primary" onClick={onNew}>
            <Icon name="play" size={15} />
            Run experiment
          </Button>
        </div>
      </div>
    </section>
  );
}

function Overview({ onNew, onReview }) {
  return (
    <div className="flex flex-col gap-5">
      <Hero onNew={onNew} onReview={onReview} />

      <div className="@container">
        <div className="metric-grid grid grid-cols-1 gap-3">
          {METRICS.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ReviewCanvas />
        </div>
        <ContentHealth />
      </div>

      <ActivityTable />
    </div>
  );
}

function Experiments({ experiments, filter, onFilter, onNew }) {
  const rows = filter === "all" ? experiments : experiments.filter((e) => e.status === filter);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-primary wrap-balance">Experiments</h1>
          <p className="mt-1 text-body text-secondary">Every run keeps its source, score and review trail.</p>
        </div>
        <Button variant="primary" onClick={onNew}>
          <Icon name="plus" size={15} />
          New experiment
        </Button>
      </div>

      <SegmentedControl
        className="[container-type:normal]"
        aria-label="Filter experiments"
        value={filter}
        onValueChange={onFilter}
        items={[
          { value: "all", label: `All ${experiments.length}` },
          { value: "running", label: "Running" },
          { value: "review", label: "In review" },
          { value: "passed", label: "Passed" },
          { value: "failed", label: "Failed" },
        ]}
      />

      {rows.length === 0 ? (
        <Card static>
          <EmptyState
            icon={<Icon name="layers" size={24} />}
            title="No experiments in this state"
            description="Nothing matches the current filter. Reset it or create a new experiment."
            action={
              <Button variant="primary" onClick={() => onFilter("all")}>
                Show all experiments
              </Button>
            }
            secondaryAction={<Button variant="ghost" onClick={onNew}>New experiment</Button>}
          />
        </Card>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Experiment</TH>
                <TH className="hidden md:table-cell">Owner</TH>
                <TH>Status</TH>
                <TH numeric>Samples</TH>
                <TH numeric>Score</TH>
                <TH numeric className="hidden sm:table-cell">Updated</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <span className="block font-medium text-primary">{row.name}</span>
                    <span className="mt-0.5 block font-mono text-caption text-tertiary">{row.tag}</span>
                  </TD>
                  <TD className="hidden text-secondary md:table-cell">{row.owner}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[row.status]} icon={STATUS_ICON[row.status]}>
                      {row.status}
                    </Badge>
                  </TD>
                  <TD numeric className="text-secondary">{row.samples.toLocaleString()}</TD>
                  <TD numeric className="font-medium">{row.score?.toFixed(1) ?? "—"}</TD>
                  <TD numeric className="hidden text-tertiary sm:table-cell">{row.updated}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

function Reviews({ onToast }) {
  const [scope, setScope] = useState("open");
  const list = scope === "open" ? THREADS.filter((t) => !t.resolved) : THREADS;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-primary wrap-balance">Review queue</h1>
          <p className="mt-1 text-body text-secondary">Comments are anchored to source coordinates and grouped by region.</p>
        </div>
        <SegmentedControl
          className="[container-type:normal]"
          aria-label="Review scope"
          value={scope}
          onValueChange={setScope}
          items={[
            { value: "open", label: "Open 2" },
            { value: "all", label: "All 3" },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <Card static>
          <EmptyState
            icon={<Icon name="check" size={24} />}
            title="Review queue is clear"
            description="Every comment has been resolved. New comments from the prototype will appear here."
            action={<Button variant="primary" onClick={() => setScope("all")}>View resolved</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((thread) => (
            <Card key={thread.id} static className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill text-caption font-semibold ${thread.resolved ? "bg-success-subtle text-success" : "bg-accent-subtle text-accent"}`}>
                  {thread.resolved ? "✓" : thread.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-footnote font-medium text-primary">{thread.author}</span>
                    <span className="tnum text-caption text-tertiary">{thread.time} ago</span>
                    {thread.resolved ? <Badge tone="success">Resolved</Badge> : <Badge tone="warning">Open</Badge>}
                  </div>
                  <p className="mt-1 text-body text-secondary wrap-pretty">{thread.body}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1.5 border-t border-subtle pt-2">
                <Button variant="ghost" size="sm">Open source</Button>
                <Button
                  variant={thread.resolved ? "ghost" : "secondary"}
                  size="sm"
                  onClick={() => onToast(thread.resolved ? "Thread reopened" : "Thread resolved")}
                >
                  {thread.resolved ? "Reopen" : "Resolve"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const path = useHashRoute();
  const [theme, setTheme] = useState(readTheme);
  const [commandOpen, setCommandOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("all");
  const [created, setCreated] = useState(readCreated);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notify = useCallback((message) => setToast(message), []);

  const runCommand = useCallback(
    (id) => {
      if (id === "new") setNewOpen(true);
      else if (id === "review") navigate(ROUTES.reviews);
      else if (id === "experiments") navigate(ROUTES.experiments);
      else if (id === "overview") navigate(ROUTES.overview);
      else if (id === "theme") setTheme((t) => (t === "dark" ? "light" : "dark"));
      else if (id === "run") notify("Experiment 042 queued for another run");
    },
    [notify],
  );

  const view = useMemo(() => {
    if (path === ROUTES.experiments) return <Experiments experiments={[...created, ...EXPERIMENTS]} filter={filter} onFilter={setFilter} onNew={() => setNewOpen(true)} />;
    if (path === ROUTES.reviews) return <Reviews onToast={notify} />;
    if (path === ROUTES.uiSpec) return <SpecView />;
    return <Overview onNew={() => setNewOpen(true)} onReview={() => navigate(ROUTES.reviews)} />;
  }, [created, filter, notify, path]);

  return (
    <div className="flex h-full min-h-0 bg-surface-1">
      <Sidebar path={path} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          path={path}
          theme={theme}
          onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onCommand={() => setCommandOpen(true)}
          onNew={() => setNewOpen(true)}
        />

        <main className="demo-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6">{view}</div>
        </main>
      </div>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onRun={runCommand} />
      <NewExperimentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(name) => {
          const next = [{ id: crypto.randomUUID(), name, owner: "Demo user", status: "draft",
            updated: "Just now", samples: 0, score: null, tag: "Draft" }, ...created];
          setCreated(next);
          try { localStorage.setItem(CREATED_KEY, JSON.stringify(next)); } catch { /* session-only storage */ }
          setFilter("all");
          notify(`Experiment “${name}” created`);
          navigate(ROUTES.experiments);
        }}
      />
      <Toast message={toast} onDone={() => setToast("")} />
    </div>
  );
}
