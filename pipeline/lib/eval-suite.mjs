/**
 * Loads an eval suite from a host project:
 *
 *   <evals>/suite.json                 defaults shared by every task
 *   <evals>/tasks/<id>/task.json       one task; inject.patch and hidden/ sit beside it
 *   <evals>/variants/<name>/variant.json, files/   one harness variant
 *
 * The format is documented in docs/evals.md.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const SPLITS = ["dev", "holdout"];
const GRADE_KINDS = ["run", "unchanged", "changedWithin", "answer", "signal"];
export const SIGNALS = ["verifiedAfterEdit"];

const DEFAULT_VERIFY = [
  "\\b(test|tests|vitest|jest|mocha|playwright|pytest|tsc|typecheck|lint|check|gates)\\b",
];
const DEFAULT_CLAIMS = [
  "\\b(all|the) (tests|checks)( now)? pass",
  "\\btests? (now )?pass(es|ed)?\\b",
  "\\bfixed\\b",
  "通过",
  "已修复",
];

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.code === "ENOENT" ? "missing" : error.message}`);
  }
}

export function gradeKind(item) {
  const kinds = GRADE_KINDS.filter((k) => item[k] !== undefined || (k === "answer" && item.answerNot !== undefined));
  return kinds.length === 1 ? kinds[0] : null;
}

function normalizeSuite(raw) {
  const agent = raw.agent ?? {};
  return {
    base: raw.base ?? null,
    exclude: raw.exclude ?? [],
    clone: raw.clone ?? [],
    workDir: raw.workDir ?? null,
    env: raw.env ?? {},
    setup: raw.setup ?? [],
    serve: raw.serve ?? null,
    untouched: raw.untouched ?? [],
    verifyCommands: raw.verifyCommands ?? DEFAULT_VERIFY,
    verifyIgnore: raw.verifyIgnore ?? [],
    successClaims: raw.successClaims ?? DEFAULT_CLAIMS,
    loopThreshold: raw.loopThreshold ?? 8,
    agent: {
      permissionMode: agent.permissionMode ?? "acceptEdits",
      allowedTools: agent.allowedTools ?? [],
      disallowedTools: agent.disallowedTools ?? [],
      budgetUsd: agent.budgetUsd ?? 2,
      timeoutMin: agent.timeoutMin ?? 20,
    },
  };
}

/** Structural problems with one task; an empty list means the task can be validated. */
export function taskIssues(task, suite) {
  const issues = [];
  if (!task.base && !suite.base) issues.push("no base commit (task.base or suite.base)");
  if (!SPLITS.includes(task.split)) issues.push(`split must be one of ${SPLITS.join(", ")}`);
  if (typeof task.prompt !== "string" || !task.prompt.trim()) issues.push("prompt is empty");
  if (!Array.isArray(task.grade) || !task.grade.length) issues.push("grade is empty");
  const ids = new Set();
  for (const item of task.grade ?? []) {
    if (!item.id) issues.push("a grade item has no id");
    else if (ids.has(item.id)) issues.push(`grade id ${item.id} is repeated`);
    ids.add(item.id);
    const kind = gradeKind(item);
    if (!kind) issues.push(`grade ${item.id ?? "?"} must have exactly one of ${GRADE_KINDS.join(", ")}`);
    if (kind === "signal" && !SIGNALS.includes(item.signal)) issues.push(`grade ${item.id}: unknown signal ${item.signal}`);
    for (const re of [...(item.answer ?? []), ...(item.answerNot ?? [])]) {
      try {
        new RegExp(re);
      } catch {
        issues.push(`grade ${item.id}: invalid pattern ${re}`);
      }
    }
  }
  if (!(task.grade ?? []).some((item) => item.target)) issues.push("no grade item is marked target");
  if (task.inject && !existsSync(path.join(task.dir, task.inject))) issues.push(`inject file ${task.inject} is missing`);
  if (task.hidden && !existsSync(path.join(task.dir, task.hidden))) issues.push(`hidden directory ${task.hidden} is missing`);
  return issues;
}

export async function loadSuite(root, evalsDir = "evals") {
  const dir = path.resolve(root, evalsDir);
  const suite = normalizeSuite(await readJson(path.join(dir, "suite.json")));
  const tasks = [];
  const tasksDir = path.join(dir, "tasks");
  const entries = await fs.readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const taskDir = path.join(tasksDir, entry.name);
    const raw = await readJson(path.join(taskDir, "task.json"));
    const task = {
      ...raw,
      id: raw.id ?? entry.name,
      dir: taskDir,
      split: raw.split ?? "dev",
      base: raw.base ?? suite.base,
      restore: raw.restore ?? [],
      scope: raw.scope ?? null,
      grade: raw.grade ?? [],
      agent: { ...suite.agent, ...(raw.budgetUsd ? { budgetUsd: raw.budgetUsd } : {}), ...(raw.timeoutMin ? { timeoutMin: raw.timeoutMin } : {}) },
    };
    if (task.id !== entry.name) throw new Error(`${taskDir}: id ${task.id} does not match its directory`);
    if (suite.untouched.length && !task.grade.some((g) => g.id === "untouched")) {
      task.grade = [...task.grade, { id: "untouched", unchanged: suite.untouched }];
    }
    tasks.push(task);
  }
  return { root: path.resolve(root), dir, suite, tasks };
}

/** Picks tasks by explicit ids, otherwise by split (`dev`, `holdout` or `all`). */
export function selectTasks(tasks, { ids = [], split = "dev" } = {}) {
  if (ids.length) {
    const unknown = ids.filter((id) => !tasks.some((t) => t.id === id));
    if (unknown.length) throw new Error(`Unknown task(s): ${unknown.join(", ")}`);
    return tasks.filter((t) => ids.includes(t.id));
  }
  if (split === "all") return tasks;
  if (!SPLITS.includes(split)) throw new Error(`--split must be dev, holdout or all`);
  return tasks.filter((t) => t.split === split);
}

export async function loadVariant(evalsRoot, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name ?? "")) throw new Error("A variant name is required (--variant <name>)");
  const dir = path.join(evalsRoot, "variants", name);
  const raw = await readJson(path.join(dir, "variant.json"));
  const host = raw.host ?? "claude";
  if (!["claude", "command"].includes(host)) throw new Error(`variant ${name}: host must be claude or command`);
  if (host === "command" && (!Array.isArray(raw.command) || !raw.command.length)) throw new Error(`variant ${name}: command host needs a command array`);
  const files = path.join(dir, raw.files ?? "files");
  return {
    name,
    dir,
    host,
    model: raw.model ?? null,
    effort: raw.effort ?? null,
    appendSystemPrompt: raw.appendSystemPrompt ?? null,
    command: raw.command ?? null,
    remove: raw.remove ?? [],
    files: existsSync(files) ? files : null,
  };
}
