/** Summaries of one run and comparisons between two runs. */
import { median } from "./eval-util.mjs";

const round = (n, digits = 2) => (typeof n === "number" ? Number(n.toFixed(digits)) : null);
const pct = (n) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "–");
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "–");
const secs = (ms) => (typeof ms === "number" ? `${Math.round(ms / 1000)}s` : "–");

/** `attempts` are result.json objects of one run. */
export function summarize(meta, attempts) {
  const tasks = {};
  for (const a of attempts) {
    const t = (tasks[a.task] ??= { split: a.split, type: a.type, results: [] });
    t.results.push(a);
  }
  const out = {};
  for (const [id, t] of Object.entries(tasks)) {
    const graded = t.results.filter((r) => r.solved !== null);
    const solved = graded.filter((r) => r.solved).length;
    const edited = t.results.filter((r) => r.signals?.verifiedAfterEdit !== null && r.signals?.verifiedAfterEdit !== undefined);
    out[id] = {
      split: t.split,
      type: t.type,
      attempts: t.results.length,
      graded: graded.length,
      solved,
      rate: graded.length ? solved / graded.length : null,
      unstable: solved > 0 && solved < graded.length,
      costMedianUsd: round(median(t.results.map((r) => r.metrics?.costUsd)), 4),
      wallMedianMs: median(t.results.map((r) => r.agent?.wallMs)),
      turnsMedian: median(t.results.map((r) => r.metrics?.turns)),
      verifiedAfterEditRate: edited.length ? edited.filter((r) => r.signals.verifiedAfterEdit).length / edited.length : null,
      falseClaims: t.results.filter((r) => r.falseClaim).length,
      looping: t.results.filter((r) => r.signals?.looping).length,
      denials: t.results.reduce((n, r) => n + (r.signals?.denials?.length ?? 0), 0),
      infraErrors: t.results.filter((r) => r.solved === null).length,
      stopReasons: [...new Set(t.results.map((r) => r.metrics?.stopReason).filter(Boolean))],
    };
  }
  const rates = Object.values(out).map((t) => t.rate).filter((r) => r !== null);
  const quotas = attempts.map((a) => a.metrics?.quota).filter(Boolean);
  const window = (name) => {
    const spans = quotas.map((q) => q[name]).filter(Boolean);
    return spans.length ? { start: spans[0].start, end: spans[spans.length - 1].end } : null;
  };
  return {
    ...meta,
    tasks: out,
    totals: {
      attempts: attempts.length,
      solved: attempts.filter((a) => a.solved).length,
      infraErrors: attempts.filter((a) => a.solved === null).length,
      meanRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
      costUsd: round(attempts.reduce((n, a) => n + (a.metrics?.costUsd ?? 0), 0), 4),
      quota: quotas.length ? { fiveHour: window("fiveHour"), sevenDay: window("sevenDay") } : null,
    },
  };
}

const NORMAL_STOPS = new Set(["success", "completed"]);

export function summaryMarkdown(s) {
  const lines = [
    `# Eval run ${s.runId}`,
    "",
    `- Variant: \`${s.variant}\` · host ${s.host?.version ?? s.host?.host ?? "?"} · base \`${String(s.base).slice(0, 12)}\``,
    `- Attempts: ${s.totals.attempts} · solved ${s.totals.solved} · infrastructure errors ${s.totals.infraErrors}`,
    `- Mean solve rate: ${pct(s.totals.meanRate)} · total cost ${usd(s.totals.costUsd)}`,
    s.totals.quota ? `- Subscription quota: five-hour window ${pct(s.totals.quota.fiveHour?.start)} → ${pct(s.totals.quota.fiveHour?.end)}, seven-day ${pct(s.totals.quota.sevenDay?.start)} → ${pct(s.totals.quota.sevenDay?.end)} (cost above is the API-equivalent figure)` : null,
    s.stoppedEarly ? `- Stopped early: ${s.stoppedEarly}` : null,
    "",
    "| Task | Split | Solved | Cost (median) | Time (median) | Turns | Verified after edit | False claims | Looping | Denials | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ].filter((l) => l !== null);
  for (const [id, t] of Object.entries(s.tasks)) {
    const notes = [t.unstable ? "unstable" : null, t.infraErrors ? `${t.infraErrors} infra error(s)` : null, t.stopReasons.filter((r) => !NORMAL_STOPS.has(r)).join(", ") || null].filter(Boolean).join("; ");
    lines.push(`| ${id} | ${t.split} | ${t.solved}/${t.graded} | ${usd(t.costMedianUsd)} | ${secs(t.wallMedianMs)} | ${t.turnsMedian ?? "–"} | ${pct(t.verifiedAfterEditRate)} | ${t.falseClaims} | ${t.looping} | ${t.denials} | ${notes} |`);
  }
  lines.push("", "Process signals come from the trace and are heuristic; check the attempt's trace.jsonl before acting on one.", "");
  return lines.join("\n");
}

export function compareSummaries(a, b) {
  const warnings = [];
  if (a.base !== b.base) warnings.push(`base differs: ${String(a.base).slice(0, 12)} vs ${String(b.base).slice(0, 12)}`);
  if (a.variant === b.variant) warnings.push(`both runs use variant ${a.variant}; differences are run-to-run noise`);
  const ids = [...new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])].sort();
  const rows = ids.map((id) => {
    const x = a.tasks[id];
    const y = b.tasks[id];
    if (!x || !y) return { id, change: x ? "only-in-a" : "only-in-b" };
    const change = x.rate === null || y.rate === null ? "not-graded" : y.rate > x.rate ? "improved" : y.rate < x.rate ? "regressed" : "same";
    return {
      id,
      change,
      unstable: x.unstable || y.unstable,
      rateA: x.rate,
      rateB: y.rate,
      costA: x.costMedianUsd,
      costB: y.costMedianUsd,
      verifiedA: x.verifiedAfterEditRate,
      verifiedB: y.verifiedAfterEditRate,
    };
  });
  return {
    a: { runId: a.runId, variant: a.variant },
    b: { runId: b.runId, variant: b.variant },
    warnings,
    rows,
    totals: { meanRateA: a.totals.meanRate, meanRateB: b.totals.meanRate, costA: a.totals.costUsd, costB: b.totals.costUsd },
  };
}

export function compareMarkdown(c) {
  const lines = [
    `# ${c.a.runId} (${c.a.variant}) → ${c.b.runId} (${c.b.variant})`,
    "",
    ...c.warnings.map((w) => `> ${w}`),
    c.warnings.length ? "" : null,
    `Mean solve rate ${pct(c.totals.meanRateA)} → ${pct(c.totals.meanRateB)} · cost ${usd(c.totals.costA)} → ${usd(c.totals.costB)}`,
    "",
    "| Task | Change | Solve rate | Cost (median) | Verified after edit | Unstable |",
    "| --- | --- | --- | --- | --- | --- |",
  ].filter((l) => l !== null);
  for (const r of c.rows) {
    if (r.change.startsWith("only")) lines.push(`| ${r.id} | ${r.change} | | | | |`);
    else lines.push(`| ${r.id} | ${r.change} | ${pct(r.rateA)} → ${pct(r.rateB)} | ${usd(r.costA)} → ${usd(r.costB)} | ${pct(r.verifiedA)} → ${pct(r.verifiedB)} | ${r.unstable ? "yes" : ""} |`);
  }
  lines.push("");
  return lines.join("\n");
}
