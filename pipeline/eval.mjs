#!/usr/bin/env node
/**
 * builderharness eval — repeatable agent evaluations on a host project's own tasks.
 *
 *   builderharness eval list
 *   builderharness eval validate [task ...] [--split dev|holdout|all]
 *   builderharness eval run --variant <name> [task ...] [--split dev] [--repeat 3]
 *                          [--max-total-usd N] [--max-quota 0.85] [--keep] [--dry-run] [--skip-validate]
 *   builderharness eval run --resume <runId> [--repeat N] [...]
 *   builderharness eval compare <runA> <runB>
 *
 * Options for every command: --root <project>, --evals <dir> (default evals),
 * --out <dir> (default .builderharness/evals). See docs/evals.md.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "./lib/paths.mjs";
import { gradeWorkspace, solvedFrom } from "./lib/eval-grade.mjs";
import { cleanEnv, hostStatus, runAgent } from "./lib/eval-host.mjs";
import { compareMarkdown, compareSummaries, summarize, summaryMarkdown } from "./lib/eval-report.mjs";
import { gradeKind, loadSuite, loadVariant, selectTasks, taskIssues } from "./lib/eval-suite.mjs";
import { hostError, parseTrace, traceMetrics, traceSignals } from "./lib/eval-trace.mjs";
import { matchesAny, timestamp } from "./lib/eval-util.mjs";
import { ancestorInstructions, applyGradeFiles, createWorkspace, listFilesAt, pathExistsAt, resolveCommit, workspaceDiff } from "./lib/eval-workspace.mjs";

const VALUE_FLAGS = new Set(["--root", "--evals", "--out", "--variant", "--split", "--repeat", "--max-total-usd", "--max-quota", "--resume"]);
const BOOL_FLAGS = new Set(["--keep", "--dry-run", "--skip-validate", "--json"]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (VALUE_FLAGS.has(arg)) {
      if (!rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      opts[arg.slice(2)] = rest[++i];
    } else if (BOOL_FLAGS.has(arg)) opts[arg.slice(2)] = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown eval option: ${arg}`);
    else opts.positional.push(arg);
  }
  return { command, opts };
}

function help(code = 0) {
  console.log(`Usage:
  builderharness eval list
  builderharness eval validate [task ...] [--split dev|holdout|all]
  builderharness eval run --variant <name> [task ...] [--split dev] [--repeat 3]
                         [--max-total-usd N] [--max-quota 0.85] [--keep] [--dry-run] [--skip-validate]
  builderharness eval run --resume <runId> [--repeat N]   continue a run, e.g. with more rounds
  builderharness eval compare <runA> <runB>

Options: --root <project>  --evals <dir> (default evals)  --out <dir> (default .builderharness/evals)
See docs/evals.md for the task format.`);
  process.exit(code);
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Content hash of a task directory, so a validation stays tied to what it checked. */
async function taskHash(dir) {
  const hash = createHash("sha256");
  const walk = async (d) => {
    for (const entry of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        hash.update(path.relative(dir, file));
        hash.update(await fs.readFile(file));
      }
    }
  };
  await walk(dir);
  return hash.digest("hex").slice(0, 16);
}

function workRootFor(ctx) {
  return ctx.suite.workDir ? path.resolve(ctx.root, ctx.suite.workDir) : path.join(os.tmpdir(), "builderharness-eval");
}

function checkWorkRoot(ctx, workRoot) {
  const rel = path.relative(ctx.root, workRoot);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`workDir ${workRoot} is inside the project; the agent would load the project's own instructions. Put it outside, e.g. "../.builderharness-work/<name>".`);
  }
  const leaks = ancestorInstructions(path.join(workRoot, "x"));
  if (leaks.length) throw new Error(`agent instruction files above the work directory would leak into every run:\n  ${leaks.join("\n  ")}\nChoose another workDir.`);
}

function warnIfTracked(ctx) {
  const res = spawnSync("git", ["check-ignore", "-q", path.relative(ctx.root, ctx.out) || "."], { cwd: ctx.root });
  if (res.status === 1) console.warn(`! ${path.relative(ctx.root, ctx.out)} is not ignored by git; add it to .gitignore so traces stay local.`);
}

function taskWorkspaceOptions(ctx, task, { inject }) {
  return {
    sourceRoot: ctx.root,
    base: task.baseSha,
    exclude: ctx.suite.exclude,
    inject: inject && task.inject ? path.join(task.dir, task.inject) : null,
    clone: ctx.suite.clone,
  };
}

function gradeFileOptions(ctx, task) {
  return { sourceRoot: ctx.root, base: task.baseSha, restore: task.restore, hiddenDir: task.hidden ? path.join(task.dir, task.hidden) : null };
}

async function load(opts) {
  const root = path.resolve(opts.root ?? PROJECT_ROOT);
  const ctx = await loadSuite(root, opts.evals ?? "evals");
  ctx.out = path.resolve(root, opts.out ?? ".builderharness/evals");
  for (const task of ctx.tasks) {
    try {
      task.baseSha = task.base ? resolveCommit(root, task.base) : null;
    } catch {
      task.baseSha = null;
    }
  }
  return ctx;
}

/** Checks one state of a task without an agent: only `run` items are evaluated. */
async function gradeState(ctx, task, state, logRoot, workRoot, keep) {
  const dir = path.join(workRoot, `${task.id}-${state}`);
  await fs.rm(dir, { recursive: true, force: true });
  const logDir = path.join(logRoot, task.id, state);
  await fs.mkdir(logDir, { recursive: true });
  try {
    await createWorkspace({ ...taskWorkspaceOptions(ctx, task, { inject: state === "problem" }), dir });
    await applyGradeFiles(dir, gradeFileOptions(ctx, task));
    const onlyRun = { ...task, grade: task.grade.filter((g) => gradeKind(g) === "run") };
    const env = cleanEnv(process.env, ctx.suite.env);
    return await gradeWorkspace({ dir, task: onlyRun, suite: ctx.suite, env, logDir, mode: "validate" });
  } finally {
    if (!keep) await fs.rm(dir, { recursive: true, force: true });
  }
}

async function validate(opts) {
  const ctx = await load(opts);
  const tasks = selectTasks(ctx.tasks, { ids: opts.positional, split: opts.split ?? "all" });
  const workRoot = path.join(workRootFor(ctx), `validate-${timestamp()}`);
  checkWorkRoot(ctx, workRoot);
  warnIfTracked(ctx);
  const logRoot = path.join(ctx.out, `validate-${timestamp()}`);
  const registry = await readJson(path.join(ctx.out, "validated.json"), {});
  const report = [];
  for (const task of tasks) {
    const issues = taskIssues(task, ctx.suite);
    if (!task.baseSha) issues.push(`base ${task.base} is not a commit in this repository`);
    if (task.baseSha) {
      for (const p of task.restore) if (!pathExistsAt(ctx.root, task.baseSha, p)) issues.push(`restore path ${p} does not exist at base`);
      const files = listFilesAt(ctx.root, task.baseSha);
      for (const item of task.grade.filter((g) => g.unchanged)) {
        for (const glob of item.unchanged) if (!files.some((f) => matchesAny(f, [glob]))) issues.push(`grade ${item.id}: ${glob} matches no file at base`);
      }
    }
    const entry = { task: task.id, split: task.split, type: task.type ?? null, base: task.baseSha, hash: await taskHash(task.dir), issues, states: {} };
    if (!issues.length) {
      process.stdout.write(`… ${task.id}: problem state\n`);
      try {
        const problem = await gradeState(ctx, task, "problem", logRoot, workRoot, opts.keep);
        entry.states.problem = problem;
        const runItems = problem.items.filter((i) => i.kind === "run");
        if (problem.infraError) issues.push(`problem state: ${problem.infraError}`);
        for (const i of runItems) {
          if (i.target && i.status === "pass") issues.push(`target ${i.id} passes before any fix; the task does not reproduce the defect`);
          if (!i.target && i.status === "fail") issues.push(`${i.id} already fails in the problem state; the defect breaks more than its target`);
        }
        if (!runItems.some((i) => i.target)) entry.note = "no run target: only structure was checked";
        if (task.inject && !issues.length) {
          process.stdout.write(`… ${task.id}: reference state\n`);
          const reference = await gradeState(ctx, task, "reference", logRoot, workRoot, opts.keep);
          entry.states.reference = reference;
          if (reference.infraError) issues.push(`reference state: ${reference.infraError}`);
          for (const i of reference.items) if (i.status === "fail") issues.push(`${i.id} fails on the reference (base without the defect)`);
        }
      } catch (error) {
        issues.push(error.message);
      }
    }
    entry.status = issues.length ? "invalid" : "valid";
    entry.checkedAt = new Date().toISOString();
    for (const state of Object.values(entry.states)) for (const item of state.items) delete item.tail;
    report.push(entry);
    registry[task.id] = { status: entry.status, hash: entry.hash, base: entry.base, checkedAt: entry.checkedAt };
    console.log(`${entry.status === "valid" ? "✓" : "✗"} ${task.id}${entry.note ? ` (${entry.note})` : ""}${issues.map((m) => `\n    - ${m}`).join("")}`);
  }
  if (!opts.keep) await fs.rm(workRoot, { recursive: true, force: true });
  await writeJson(path.join(logRoot, "validate.json"), report);
  await writeJson(path.join(ctx.out, "validated.json"), registry);
  const invalid = report.filter((r) => r.status === "invalid").length;
  console.log(`\n${report.length - invalid}/${report.length} task(s) valid. Logs: ${path.relative(process.cwd(), logRoot) || logRoot}`);
  if (invalid) process.exitCode = 1;
}

async function attempt(ctx, task, variant, rep, { runId, runDir, workRoot, keep }) {
  const attemptDir = path.join(runDir, task.id, String(rep));
  const logDir = path.join(attemptDir, "grade");
  // A resumed run repeats attempts that ended in an error; start them from a clean folder.
  await fs.rm(attemptDir, { recursive: true, force: true });
  await fs.mkdir(logDir, { recursive: true });
  const dir = path.join(workRoot, runId, `${task.id}-${rep}`);
  await fs.rm(dir, { recursive: true, force: true });
  const record = { task: task.id, split: task.split, type: task.type ?? null, attempt: rep, variant: variant.name, base: task.baseSha };
  try {
    const ws = await createWorkspace({ ...taskWorkspaceOptions(ctx, task, { inject: true }), variant, dir });
    record.cloned = ws.cloned;
    const env = cleanEnv(process.env, ctx.suite.env);
    const traceFile = path.join(attemptDir, "trace.jsonl");
    record.agent = await runAgent({ cwd: dir, prompt: task.prompt, variant, agent: task.agent, env, traceFile, stderrFile: path.join(attemptDir, "agent.stderr.log") });
    const parsed = parseTrace(await fs.readFile(traceFile, "utf8").catch(() => ""));
    record.metrics = traceMetrics(parsed);
    record.init = parsed.init;
    record.trace = { events: parsed.events, malformed: parsed.malformed };
    record.answer = (parsed.answer ?? "").slice(0, 8000);
    await fs.writeFile(path.join(attemptDir, "answer.md"), parsed.answer ?? "");
    record.memory = await collectMemory(parsed.init?.memoryDir, attemptDir, runId);
    const failed = hostError(parsed, record.agent);
    if (failed) {
      record.hostError = true;
      record.infraError = failed;
      record.solved = null;
      return record;
    }
    const diff = workspaceDiff(dir, ws.snapshot);
    await fs.writeFile(path.join(attemptDir, "diff.patch"), diff.patch);
    record.changed = diff.files;
    record.agentCommits = diff.commits;
    const changed = diff.files.map((f) => f.path);
    record.signals = traceSignals(parsed, { cwd: dir, verifyCommands: ctx.suite.verifyCommands, successClaims: ctx.suite.successClaims, loopThreshold: ctx.suite.loopThreshold });
    record.signals.outOfScope = task.scope ? changed.filter((f) => !matchesAny(f, task.scope)) : [];
    await applyGradeFiles(dir, gradeFileOptions(ctx, task));
    const graded = await gradeWorkspace({ dir, task, suite: ctx.suite, env, logDir, mode: "run", answer: parsed.answer ?? "", signals: record.signals, changed });
    record.grade = graded.items;
    record.infraError = graded.infraError ?? diff.error ?? null;
    record.solved = record.infraError ? null : solvedFrom(graded.items);
    record.falseClaim = record.solved === false && record.signals.claimedSuccess;
  } catch (error) {
    record.infraError = error.message;
    record.solved = null;
  } finally {
    if (!keep) await fs.rm(dir, { recursive: true, force: true });
    await writeJson(path.join(attemptDir, "result.json"), record);
  }
  return record;
}

/**
 * Claude Code creates a project directory with an automatic-memory folder for every new
 * working directory, even without session persistence. Memories the agent wrote are
 * kept with the attempt; the directory itself is removed when its name carries this
 * run's id, so a baseline does not leave dozens of empty projects behind.
 */
async function collectMemory(memoryDir, attemptDir, runId) {
  if (!memoryDir) return null;
  const projectDir = path.dirname(path.resolve(memoryDir));
  if (path.dirname(projectDir) !== path.join(os.homedir(), ".claude", "projects") || !path.basename(projectDir).includes(runId)) {
    return { dir: memoryDir, files: null, removed: false };
  }
  const files = await fs.readdir(memoryDir, { recursive: true }).catch(() => []);
  if (files.length) await fs.cp(memoryDir, path.join(attemptDir, "memory"), { recursive: true });
  await fs.rm(projectDir, { recursive: true, force: true });
  return { files: files.length, removed: true };
}

async function readRunDir(ctx, ref) {
  const dir = [path.resolve(ref), path.join(ctx.out, ref)].find((d) => existsSync(path.join(d, "run.json")));
  if (!dir) throw new Error(`No run.json for run ${ref}`);
  const run = JSON.parse(await fs.readFile(path.join(dir, "run.json"), "utf8"));
  const attempts = [];
  for (const task of await fs.readdir(dir, { withFileTypes: true })) {
    if (!task.isDirectory()) continue;
    for (const rep of await fs.readdir(path.join(dir, task.name)).catch(() => [])) {
      const record = await readJson(path.join(dir, task.name, rep, "result.json"), null);
      if (record) attempts.push(record);
    }
  }
  return { dir, run, attempts };
}

/** The fuller subscription window (five-hour or seven-day) in the latest attempt that reported one. */
function latestQuota(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const q = records[i].metrics?.quota;
    if (!q) continue;
    const five = q.fiveHour?.end ?? 0;
    const seven = q.sevenDay?.end ?? 0;
    return five >= seven ? { share: five, window: "five-hour" } : { share: seven, window: "seven-day" };
  }
  return null;
}

async function run(opts) {
  const ctx = await load(opts);
  const previous = opts.resume ? await readRunDir(ctx, opts.resume) : null;
  if (previous && opts.positional.length) throw new Error("--resume continues the run's own tasks; do not name tasks");
  if (previous && opts.variant && opts.variant !== previous.run.variant) throw new Error(`run ${previous.run.runId} uses variant ${previous.run.variant}`);
  const variant = await loadVariant(ctx.dir, previous ? previous.run.variant : opts.variant);
  const tasks = previous ? selectTasks(ctx.tasks, { ids: previous.run.plan.tasks }) : selectTasks(ctx.tasks, { ids: opts.positional, split: opts.split ?? "dev" });
  const repeat = Number(opts.repeat ?? previous?.run.repeat ?? 3);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
  if (previous && repeat < previous.run.repeat) throw new Error(`--repeat cannot go below the run's ${previous.run.repeat}`);
  const maxTotal = opts["max-total-usd"] ? Number(opts["max-total-usd"]) : null;
  if (maxTotal !== null && !(maxTotal > 0)) throw new Error("--max-total-usd must be a positive number");
  const maxQuota = opts["max-quota"] ? Number(opts["max-quota"]) : null;
  if (maxQuota !== null && !(maxQuota > 0 && maxQuota <= 1)) throw new Error("--max-quota is a share of the subscription window, between 0 and 1");
  const workRoot = workRootFor(ctx);
  checkWorkRoot(ctx, workRoot);

  const registry = await readJson(path.join(ctx.out, "validated.json"), {});
  const hashes = { variant: await taskHash(variant.dir), tasks: {} };
  const notValid = [];
  for (const task of tasks) {
    hashes.tasks[task.id] = await taskHash(task.dir);
    const entry = registry[task.id];
    if (!entry || entry.status !== "valid" || entry.hash !== hashes.tasks[task.id] || entry.base !== task.baseSha) notValid.push(task.id);
  }
  if (notValid.length && !opts["skip-validate"]) {
    throw new Error(`task(s) without a current passing validation: ${notValid.join(", ")}. Run builderharness eval validate first.`);
  }
  if (previous?.run.hashes) {
    // All attempts of one run must have seen the same tasks and the same harness.
    const changed = [
      previous.run.hashes.variant !== hashes.variant ? `variant ${variant.name}` : null,
      ...tasks.filter((t) => previous.run.hashes.tasks?.[t.id] !== hashes.tasks[t.id]).map((t) => t.id),
    ].filter(Boolean);
    if (changed.length) throw new Error(`changed since run ${previous.run.runId} started: ${changed.join(", ")}; start a new run`);
  }
  // Attempts that ended in an infrastructure or host error are run again.
  const kept = (previous?.attempts ?? []).filter((a) => a.solved !== null && a.attempt <= repeat);
  const done = new Set(kept.map((a) => `${a.task}#${a.attempt}`));
  const ceiling = tasks.reduce((n, t) => n + t.agent.budgetUsd, 0) * repeat;
  const plan = { variant: variant.name, host: variant.host, model: variant.model, effort: variant.effort, tasks: tasks.map((t) => t.id), repeat, attempts: tasks.length * repeat, pending: tasks.length * repeat - done.size, budgetCeilingUsd: ceiling, maxTotalUsd: maxTotal, maxQuota, workRoot };
  if (opts["dry-run"]) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const env = cleanEnv(process.env, ctx.suite.env);
  const host = hostStatus(variant, env);
  if (!host.ready) {
    console.error(`Host not ready: ${host.reason}. For Claude Code, log in with \`claude\` then /login, or set ANTHROPIC_API_KEY.`);
    process.exitCode = 3;
    return;
  }
  warnIfTracked(ctx);
  const runId = previous ? previous.run.runId : `${timestamp()}-${variant.name}`;
  const runDir = previous ? previous.dir : path.join(ctx.out, runId);
  const meta = previous
    ? {
        ...Object.fromEntries(Object.entries(previous.run).filter(([k]) => !["plan", "hashes", "stoppedEarly", "finishedAt"].includes(k))),
        host,
        repeat,
        resumedAt: [...(previous.run.resumedAt ?? []), new Date().toISOString()],
      }
    : { runId, variant: variant.name, model: variant.model, effort: variant.effort, host, base: [...new Set(tasks.map((t) => t.baseSha))].join(","), repeat, startedAt: new Date().toISOString() };
  await writeJson(path.join(runDir, "run.json"), { ...meta, plan, hashes });
  const index = (id) => tasks.findIndex((t) => t.id === id);
  const ordered = (list) => [...list].sort((x, y) => x.attempt - y.attempt || index(x.task) - index(y.task));
  const attempts = [...kept];
  const fresh = [];
  let spent = 0;
  outer: for (let rep = 1; rep <= repeat; rep++) {
    for (const task of tasks) {
      if (done.has(`${task.id}#${rep}`)) continue;
      if (maxTotal !== null && spent >= maxTotal) {
        meta.stoppedEarly = `spent $${spent.toFixed(2)} of the $${maxTotal} limit`;
        break outer;
      }
      const used = latestQuota(fresh);
      if (maxQuota !== null && used !== null && used.share >= maxQuota) {
        meta.stoppedEarly = `${used.window} subscription window at ${Math.round(used.share * 100)}%, limit ${Math.round(maxQuota * 100)}%`;
        break outer;
      }
      process.stdout.write(`… ${task.id} #${rep}\n`);
      const record = await attempt(ctx, task, variant, rep, { runId, runDir, workRoot, keep: opts.keep });
      spent += record.metrics?.costUsd ?? 0;
      attempts.push(record);
      fresh.push(record);
      if (record.hostError) {
        // Every further attempt would fail the same way (unsupported model, login, limits).
        meta.stoppedEarly = `host error on ${task.id} #${rep}: ${record.infraError}`;
        console.log(`  ${record.infraError}\n  Stopping: fix the host, then continue with --resume ${runId}.`);
        break outer;
      }
      const verdict = record.solved === null ? `error: ${record.infraError}` : record.solved ? "solved" : "unsolved";
      const q = record.metrics?.quota?.fiveHour;
      console.log(`  ${verdict} · $${(record.metrics?.costUsd ?? 0).toFixed(2)} · ${Math.round((record.agent?.wallMs ?? 0) / 1000)}s${q ? ` · five-hour window ${Math.round(q.end * 100)}%` : ""}`);
      await writeJson(path.join(runDir, "summary.json"), summarize({ ...meta, finishedAt: null }, ordered(attempts)));
    }
  }
  const summary = summarize({ ...meta, finishedAt: new Date().toISOString() }, ordered(attempts));
  await writeJson(path.join(runDir, "summary.json"), summary);
  await writeJson(path.join(runDir, "run.json"), { ...meta, plan, hashes });
  const md = summaryMarkdown(summary);
  await fs.writeFile(path.join(runDir, "summary.md"), md);
  if (!opts.keep) await fs.rm(path.join(workRoot, runId), { recursive: true, force: true });
  console.log(`\n${md}\nRun: ${path.relative(process.cwd(), runDir) || runDir}`);
}

async function resolveRun(ctx, ref) {
  const candidates = [path.resolve(ref), path.join(ctx.out, ref)];
  for (const dir of candidates) {
    const file = path.join(dir, "summary.json");
    if (existsSync(file)) return JSON.parse(await fs.readFile(file, "utf8"));
  }
  throw new Error(`No summary.json for run ${ref}`);
}

async function compare(opts) {
  if (opts.positional.length !== 2) throw new Error("compare needs two runs: builderharness eval compare <runA> <runB>");
  const ctx = { out: path.resolve(opts.root ?? PROJECT_ROOT, opts.out ?? ".builderharness/evals") };
  const [a, b] = await Promise.all(opts.positional.map((ref) => resolveRun(ctx, ref)));
  const result = compareSummaries(a, b);
  console.log(opts.json ? JSON.stringify(result, null, 2) : compareMarkdown(result));
}

async function list(opts) {
  const ctx = await load(opts);
  const registry = await readJson(path.join(ctx.out, "validated.json"), {});
  for (const task of ctx.tasks) {
    const entry = registry[task.id];
    const current = entry && entry.hash === (await taskHash(task.dir)) && entry.base === task.baseSha;
    console.log(`${task.id.padEnd(32)} ${task.split.padEnd(8)} ${(task.type ?? "").padEnd(18)} ${entry ? `${entry.status}${current ? "" : " (stale)"}` : "not validated"}`);
  }
  const runs = (await fs.readdir(ctx.out, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith("validate-")).map((e) => e.name).sort();
  if (runs.length) console.log(`\nRuns:\n  ${runs.join("\n  ")}`);
}

const { command, opts } = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
if (!command || command === "--help" || command === "-h" || command === "help") help();
const commands = { validate, run, compare, list };
if (!commands[command]) {
  console.error(`Unknown eval command: ${command}`);
  help(1);
}
try {
  await commands[command](opts);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
