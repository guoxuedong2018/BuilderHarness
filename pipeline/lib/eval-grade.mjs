/**
 * Grades a workspace against a task's `grade` list.
 *
 * Item kinds:
 *   run            shell command, passes on exit 0; `serve: true` needs the suite's service
 *   unchanged      globs the agent must not change
 *   changedWithin  globs every change must fall inside (`requireChange` also needs one)
 *   answer         patterns the final answer must all match (`answerNot`: must not match)
 *   signal         a process signal that must hold, e.g. verifiedAfterEdit
 *
 * The suite's `setup` commands run once before the first `run` item; its service is
 * started before the first item that asks for it and stopped afterwards.
 */
import path from "node:path";
import { gradeKind } from "./eval-suite.mjs";
import { expandEnv, matchesAny, runShell, startService, urlAnswers } from "./eval-util.mjs";

const AGENT_ONLY = new Set(["answer", "signal"]);

async function bringUp(serve, { dir, env, logDir }) {
  const url = expandEnv(serve.url, env);
  if (await urlAnswers(url)) return { error: `service-url-busy: ${url} already answers before the service started` };
  const service = startService(serve.run, { cwd: dir, env, logFile: path.join(logDir, "serve.log") });
  const deadline = Date.now() + (serve.timeoutSec ?? 300) * 1000;
  while (Date.now() < deadline) {
    if (service.exited) return { service, error: `service-exited: ${JSON.stringify(service.exited)}; see serve.log` };
    if (await urlAnswers(url)) return { service };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { service, error: `service-timeout: ${url} did not answer within ${serve.timeoutSec ?? 300}s` };
}

/**
 * `mode` is "run" (after an agent) or "validate" (no agent: answer and signal items are
 * skipped). Returns one entry per item with status pass, fail, skipped or error.
 */
export async function gradeWorkspace({ dir, task, suite, env, logDir, mode = "run", answer = "", signals = {}, changed = [] }) {
  const results = [];
  let setupDone = false;
  let infra = null;
  let up = null;
  // After an agent, a service that exits or never answers is usually the agent's doing
  // (a build it broke), so the items that need it fail. A busy address is not.
  let serviceDown = null;
  try {
    for (const item of task.grade) {
      const kind = gradeKind(item);
      const base = { id: item.id, kind, target: Boolean(item.target) };
      if (mode === "validate" && AGENT_ONLY.has(kind)) {
        results.push({ ...base, status: "skipped" });
        continue;
      }
      if (kind === "run") {
        if (infra) {
          results.push({ ...base, status: "error", detail: infra });
          continue;
        }
        if (!setupDone) {
          setupDone = true;
          for (const [index, line] of suite.setup.entries()) {
            const res = await runShell(line, { cwd: dir, env, timeoutMs: 120_000, stdoutFile: path.join(logDir, `setup-${index + 1}.log`), stderrFile: path.join(logDir, `setup-${index + 1}.err.log`) });
            if (res.code !== 0) {
              infra = `setup-failed: ${line}`;
              break;
            }
          }
        }
        if (!infra && item.serve && !up) {
          if (!suite.serve) infra = "grade item needs serve but the suite defines none";
          else {
            up = await bringUp(suite.serve, { dir, env, logDir });
            if (up.error && mode === "run" && !up.error.startsWith("service-url-busy")) serviceDown = up.error;
            else if (up.error) infra = up.error;
          }
        }
        if (infra) {
          results.push({ ...base, status: "error", detail: infra });
          continue;
        }
        if (item.serve && serviceDown) {
          results.push({ ...base, status: "fail", detail: serviceDown });
          continue;
        }
        const log = path.join(logDir, `${item.id}.log`);
        const res = await runShell(item.run, { cwd: dir, env, timeoutMs: (item.timeoutSec ?? 900) * 1000, stdoutFile: log, stderrFile: path.join(logDir, `${item.id}.err.log`) });
        results.push({ ...base, status: res.code === 0 && !res.timedOut ? "pass" : "fail", exitCode: res.code, timedOut: res.timedOut, durationMs: res.durationMs, tail: (res.stdout + res.stderr).slice(-1500) });
      } else if (kind === "unchanged") {
        const hits = changed.filter((f) => matchesAny(f, item.unchanged));
        results.push({ ...base, status: hits.length ? "fail" : "pass", detail: hits.length ? hits : undefined });
      } else if (kind === "changedWithin") {
        const outside = changed.filter((f) => !matchesAny(f, item.changedWithin));
        const missing = item.requireChange && !changed.length;
        results.push({ ...base, status: outside.length || missing ? "fail" : "pass", detail: outside.length ? outside : missing ? "no change" : undefined });
      } else if (kind === "answer") {
        const missing = (item.answer ?? []).filter((re) => !new RegExp(re, "i").test(answer));
        const present = (item.answerNot ?? []).filter((re) => new RegExp(re, "i").test(answer));
        results.push({ ...base, status: missing.length || present.length ? "fail" : "pass", detail: missing.length || present.length ? { missing, present } : undefined });
      } else if (kind === "signal") {
        results.push({ ...base, status: signals[item.signal] === true ? "pass" : "fail", detail: { [item.signal]: signals[item.signal] ?? null } });
      }
    }
  } finally {
    await up?.service?.stop();
  }
  return { items: results, infraError: infra };
}

export function solvedFrom(items) {
  const graded = items.filter((i) => i.status !== "skipped");
  if (graded.some((i) => i.status === "error")) return null;
  return graded.length > 0 && graded.every((i) => i.status === "pass");
}
