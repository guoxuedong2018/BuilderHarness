#!/usr/bin/env node
/**
 * Offline tests for `builderharness eval`. A synthetic git project and fake agents
 * (command host) exercise workspace building, hidden-test restore, services, grading,
 * process signals, budgets, timeouts and comparison. No model is called.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeArgs, cleanEnv } from "../pipeline/lib/eval-host.mjs";
import { compareSummaries, summarize } from "../pipeline/lib/eval-report.mjs";
import { parseTrace, traceMetrics, traceSignals } from "../pipeline/lib/eval-trace.mjs";
import { matchesGlob } from "../pipeline/lib/eval-util.mjs";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/builderharness.mjs");
let tmp;
let project;
let pidFile;

const sh = (cwd, cmd, args) => {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
};
const write = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};
const cli = (...args) => spawnSync(process.execPath, [CLI, "eval", ...args, "--root", project], { cwd: project, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1", HOME: path.join(tmp, "home") } });
const freePort = () => new Promise((resolve) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

/** A fake agent that prints a stream-json trace; `steps` run in the workspace. */
function agentScript(body) {
  return `import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
const cwd = process.cwd();
const out = (e) => process.stdout.write(JSON.stringify(e) + "\\n");
let n = 0;
const tool = (name, input) => { const id = "t" + (++n); out({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } }); return id; };
const toolResult = (id, isError = false) => out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok", is_error: isError }] } });
const edit = (file, from, to) => { const p = path.join(cwd, file); const id = tool("Edit", { file_path: p, old_string: from, new_string: to }); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(from, to)); toolResult(id); };
const bash = (command) => { const id = tool("Bash", { command }); let failed = false; try { execSync(command, { cwd, stdio: "ignore" }); } catch { failed = true; } toolResult(id, failed); };
const result = (text, extra = {}) => out({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.25, num_turns: 4, duration_ms: 1000, usage: { input_tokens: 10, output_tokens: 5 }, permission_denials: [], ...extra });
// Like Claude Code: an automatic-memory folder for the new working directory.
const memoryDir = path.join(process.env.HOME, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), "memory");
fs.mkdirSync(memoryDir, { recursive: true });
out({ type: "system", subtype: "init", model: "fake-model", permissionMode: "acceptEdits", tools: ["Read", "Edit", "Bash"], mcp_servers: [], memory_paths: { auto: memoryDir + "/" } });
${body}
`;
}

before(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bh-eval-test-")));
  project = path.join(tmp, "project");
  pidFile = path.join(tmp, "orphan.pid");
  const port = await freePort();
  await write(path.join(project, "package.json"), '{"name":"fixture","private":true,"type":"module"}\n');
  await write(path.join(project, "CLAUDE.md"), "# Fixture rules\n");
  await write(path.join(project, ".gitignore"), "node_modules/\n.builderharness/\n");
  await write(path.join(project, "calc.mjs"), 'export function add(a, b) {\n  return a + b;\n}\nexport const label = "Sum";\n');
  await write(path.join(project, "test/calc.test.mjs"), 'import assert from "node:assert/strict";\nimport { add } from "../calc.mjs";\n\n// adds\nassert.equal(add(2, 3), 5);\n');
  await write(path.join(project, "test/extra.test.mjs"), 'import assert from "node:assert/strict";\nimport { label } from "../calc.mjs";\n\nassert.ok(label.length > 0);\n');
  await write(path.join(project, "server.mjs"), 'import http from "node:http";\nhttp.createServer((q, s) => s.end(process.env.EVAL_MARK || "none")).listen(Number(process.env.FIXTURE_PORT), "127.0.0.1");\n');
  await write(path.join(project, "check-server.mjs"), 'const r = await fetch(`http://127.0.0.1:${process.env.FIXTURE_PORT}/`);\nprocess.exit((await r.text()) === "on" ? 0 : 1);\n');
  await write(path.join(project, "node_modules/dep/index.js"), "module.exports = 1;\n");
  sh(project, "git", ["init", "-q"]);
  sh(project, "git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  sh(project, "git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
  const base = sh(project, "git", ["rev-parse", "HEAD"]).trim();

  // Defect: subtraction, and the test that would reveal it is removed from the workspace.
  await write(path.join(project, "calc.mjs"), 'export function add(a, b) {\n  return a - b;\n}\nexport const label = "Sum";\n');
  await write(path.join(project, "test/calc.test.mjs"), "// nothing here yet\n");
  const inject = sh(project, "git", ["diff"]);
  sh(project, "git", ["checkout", "--", "."]);
  // A defect that does not touch its target: validate must reject the task.
  await write(path.join(project, "calc.mjs"), 'export function add(a, b) {\n  return a + b;\n}\nexport const label = "Total";\n');
  const harmless = sh(project, "git", ["diff"]);
  sh(project, "git", ["checkout", "--", "."]);

  const evals = path.join(project, "evals");
  await write(path.join(evals, "suite.json"), JSON.stringify({
    base,
    exclude: ["evals"],
    clone: ["node_modules"],
    workDir: "../work",
    env: { EVAL_MARK: "on", FIXTURE_PORT: String(port) },
    setup: ["node -e \"require('fs').writeFileSync('setup-ran', '1')\""],
    serve: { run: "node server.mjs", url: "http://127.0.0.1:${FIXTURE_PORT}/", timeoutSec: 20 },
    untouched: ["package.json"],
    agent: { budgetUsd: 1, timeoutMin: 0.05 },
  }, null, 2));
  const grade = [
    { id: "target", target: true, run: "node test/calc.test.mjs" },
    { id: "extra", run: "node test/extra.test.mjs" },
    { id: "served", run: "node check-server.mjs", serve: true },
  ];
  await write(path.join(evals, "tasks/add-broken/task.json"), JSON.stringify({ type: "injected-defect", split: "dev", prompt: "Sums are wrong: 2 + 3 shows -1.", inject: "inject.patch", restore: ["test"], scope: ["calc.mjs", "test/**"], grade }, null, 2));
  await write(path.join(evals, "tasks/add-broken/inject.patch"), inject);
  await write(path.join(evals, "tasks/no-repro/task.json"), JSON.stringify({ split: "dev", prompt: "x", inject: "inject.patch", grade }, null, 2));
  await write(path.join(evals, "tasks/no-repro/inject.patch"), harmless);
  await write(path.join(evals, "tasks/known-open/task.json"), JSON.stringify({ type: "known-defect", split: "holdout", prompt: "The label should read Total.", hidden: "hidden", grade: [{ id: "target", target: true, run: "node test/open.test.mjs" }, { id: "extra", run: "node test/extra.test.mjs" }] }, null, 2));
  await write(path.join(evals, "tasks/known-open/hidden/test/open.test.mjs"), 'import assert from "node:assert/strict";\nimport { label } from "../calc.mjs";\n\nassert.equal(label, "Total");\n');
  await write(path.join(evals, "tasks/rule/task.json"), JSON.stringify({ type: "rule", split: "dev", prompt: "Add a column.", grade: [{ id: "asks", target: true, answer: ["approv"] }, { id: "no-schema", target: true, unchanged: ["calc.mjs"] }] }, null, 2));

  const variant = async (name, body) => {
    await write(path.join(evals, `variants/${name}/variant.json`), JSON.stringify({ host: "command", command: ["node", "${VARIANT_DIR}/agent.mjs"] }));
    await write(path.join(evals, `variants/${name}/agent.mjs`), agentScript(body));
  };
  await variant("fixer", `
if (execSync("git rev-list --count HEAD", { cwd }).toString().trim() !== "1") process.exit(9);
if (fs.readFileSync(path.join(cwd, "test/calc.test.mjs"), "utf8").includes("adds")) process.exit(8);
if (!fs.existsSync(path.join(cwd, "node_modules/dep/index.js"))) process.exit(7);
if (process.env.CLAUDECODE || process.env.EVAL_MARK !== "on") process.exit(6);
out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.4 }, seven_day: { utilization: 0.5 } } } });
edit("calc.mjs", "a - b", "a + b");
bash("node test/extra.test.mjs");
out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.42 }, seven_day: { utilization: 0.51 } } } });
result("Fixed; tests pass.", { permission_denials: [{ tool_name: "Bash", tool_use_id: "d1", tool_input: { command: "curl example.invalid" } }] });
`);
  await variant("claimer", `result("All tests pass now.");`);
  await variant("looper", `
for (let i = 0; i < 10; i++) edit("calc.mjs", i % 2 ? "a + b" : "a - b", i % 2 ? "a - b" : "a + b");
result("Still looking.");
`);
  await variant("sleeper", `
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
setTimeout(() => {}, 60000);
`);
  await variant("asker", `fs.writeFileSync(path.join(memoryDir, "note.md"), "remember the migration rule");
result("This needs a migration. Please approve the plan first.");`);
  await variant("steady", `out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.42 }, seven_day: { utilization: 0.51 } } } });
result("Please approve the plan.");`);
  await variant("apierror", `
out({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "API Error: 400 this version does not support the model" }] }, is_api_error_message: true });
out({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", api_error_status: 400, result: "API Error: 400 this version does not support the model", total_cost_usd: 0.001, num_turns: 1, permission_denials: [] });
process.exit(1);
`);
  // Like print mode after a command left running in the background: the turn ends with a
  // result, the session continues when the command finishes and ends with another one.
  await variant("backgrounder", `
edit("calc.mjs", "a - b", "a + b");
result("Gates are running in the background.", { num_turns: 3, total_cost_usd: 0.2, duration_ms: 400, duration_api_ms: 300, usage: { input_tokens: 6, output_tokens: 3 }, permission_denials: [{ tool_name: "Bash", tool_use_id: "d1", tool_input: { command: "npm run gates; echo done" } }] });
bash("node test/extra.test.mjs");
result("Fixed; the background checks passed.", { num_turns: 2, total_cost_usd: 0.3, duration_ms: 100, duration_api_ms: 450, usage: { input_tokens: 4, output_tokens: 2 } });
`);
  await variant("breaker", `
edit("calc.mjs", "a - b", "a + b");
fs.writeFileSync(path.join(cwd, "server.mjs"), "process.exit(3);\\n");
result("Fixed.");
`);
});

after(async () => {
  if (tmp && !process.env.KEEP_EVAL_TMP) await fs.rm(tmp, { recursive: true, force: true });
  else if (tmp) console.log(`kept ${tmp}`);
});

test("globs, claude arguments and a clean nested environment", () => {
  assert.ok(matchesGlob("prisma/schema.prisma", "prisma"));
  assert.ok(matchesGlob("prisma/migrations/1/x.sql", "prisma/**"));
  assert.ok(matchesGlob("src/a.ts", "src/*.ts"));
  assert.ok(!matchesGlob("src/lib/a.ts", "src/*.ts"));
  assert.ok(matchesGlob("a.ts", "**/*.ts"));
  assert.ok(!matchesGlob("prismatic.txt", "prisma"));

  const args = claudeArgs({ prompt: "fix it", variant: { model: "m", effort: null }, agent: { permissionMode: "acceptEdits", budgetUsd: 3, allowedTools: ["Read", "Bash(npm *)"], disallowedTools: [] } });
  assert.deepEqual(args.slice(0, 2), ["-p", "fix it"]);
  for (const flag of ["--setting-sources", "--strict-mcp-config", "--no-session-persistence", "--max-budget-usd", "--model"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Bash(npm *)");
  assert.ok(!args.includes("--effort"));

  const env = cleanEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "x", ANTHROPIC_API_KEY: "k", USER: "me" }, { DB: "db_${USER}" });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, "k");
  assert.equal(env.DB, "db_me");
});

test("trace signals: verification after the last edit, denials, loops and claims", () => {
  const lines = [
    { type: "system", subtype: "init", model: "m", tools: ["Edit"] },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Edit", input: { file_path: "/w/a.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "2", name: "Bash", input: { command: "npx vitest run" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "2", is_error: true, content: "1 failed" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "3", name: "Edit", input: { file_path: "/w/a.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "4", name: "Bash", input: { command: "rm -rf /" } }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "Done, all tests pass." }] } },
    { type: "result", subtype: "success", result: "Done, all tests pass.", total_cost_usd: 1.5, num_turns: 5, permission_denials: [{ tool_name: "Bash", tool_use_id: "4", tool_input: { command: "rm -rf /" } }] },
  ].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n";
  const parsed = parseTrace(lines);
  assert.equal(parsed.malformed, 1);
  assert.equal(parsed.init.model, "m");
  const s = traceSignals(parsed, { cwd: "/w", verifyCommands: ["vitest"], successClaims: ["tests pass"], loopThreshold: 1 });
  assert.equal(s.verifiedAfterEdit, false, "the only test run came before the last edit");
  assert.equal(s.edits, 2);
  assert.equal(s.looping, true);
  assert.equal(s.claimedSuccess, true);
  assert.deepEqual(s.denials, [{ tool: "Bash", detail: "rm -rf /" }]);
  assert.equal(s.toolErrors, 1);
  assert.equal(traceMetrics(parsed).segments, 1);

  // A changelog note written after the last test run does not undo the verification.
  const noted = parseTrace([
    { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Edit", input: { file_path: "/w/src/a.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "npx vitest run" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "Edit", input: { file_path: "/w/docs/CHANGELOG.md" } }] } },
  ].map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(traceSignals(noted, { cwd: "/w", verifyCommands: ["vitest"] }).verifiedAfterEdit, false);
  assert.equal(traceSignals(noted, { cwd: "/w", verifyCommands: ["vitest"], verifyIgnore: ["docs/**"] }).verifiedAfterEdit, true);
});

test("validate accepts reproducible tasks and rejects a defect that misses its target", () => {
  const res = cli("validate");
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /✓ add-broken/);
  assert.match(res.stdout, /✓ known-open/);
  assert.match(res.stdout, /✓ rule \(no run target/);
  assert.match(res.stdout, /✗ no-repro\n\s+- target target passes before any fix/);
  assert.match(res.stdout, /3\/4 task\(s\) valid/);
  const list = cli("list");
  assert.match(list.stdout, /add-broken\s+dev\s+injected-defect\s+valid/);
});

test("run solves, grades with restored tests and a service, and leaves the project untouched", async () => {
  const statusBefore = sh(project, "git", ["status", "--porcelain"]);
  const headBefore = sh(project, "git", ["rev-parse", "HEAD"]);
  const blocked = cli("run", "--variant", "fixer", "no-repro", "--repeat", "1");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /without a current passing validation: no-repro/);

  const dry = cli("run", "--variant", "fixer", "add-broken", "rule", "--repeat", "2", "--dry-run");
  assert.equal(JSON.parse(dry.stdout).budgetCeilingUsd, 4, "two dev tasks x two repeats x $1");

  const res = cli("run", "--variant", "fixer", "add-broken", "--repeat", "2");
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const runId = res.stdout.match(/Run: .*?([0-9]{8}-[0-9]{6}-fixer)/)[1];
  const summary = JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, "summary.json"), "utf8"));
  assert.equal(summary.tasks["add-broken"].solved, 2);
  assert.equal(summary.totals.costUsd, 0.5);
  assert.deepEqual(summary.totals.quota.fiveHour, { start: 0.4, end: 0.42 });
  const md = await fs.readFile(path.join(project, ".builderharness/evals", runId, "summary.md"), "utf8");
  assert.match(md, /five-hour window 40% → 42%/);
  const result = JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, "add-broken/1/result.json"), "utf8"));
  assert.equal(result.solved, true);
  assert.equal(result.agent.exitCode, 0);
  assert.deepEqual(result.grade.map((g) => [g.id, g.status]), [["target", "pass"], ["extra", "pass"], ["served", "pass"], ["untouched", "pass"]]);
  assert.equal(result.signals.verifiedAfterEdit, true);
  assert.deepEqual(result.signals.denials, [{ tool: "Bash", detail: "curl example.invalid" }]);
  assert.deepEqual(result.changed, [{ status: "M", path: "calc.mjs" }]);
  assert.deepEqual(result.signals.outOfScope, []);
  assert.equal(result.cloned.node_modules !== undefined, true);
  assert.match(await fs.readFile(path.join(project, ".builderharness/evals", runId, "add-broken/1/diff.patch"), "utf8"), /\+  return a \+ b;/);
  assert.equal(existsSync(path.join(tmp, "work", runId)), false, "workspaces are removed");
  assert.deepEqual(result.memory, { files: 0, removed: true });
  const projects = await fs.readdir(path.join(tmp, "home/.claude/projects")).catch(() => []);
  assert.ok(!projects.some((d) => d.includes(runId)), "empty memory folders of the run are removed");
  assert.equal(sh(project, "git", ["status", "--porcelain"]), statusBefore);
  assert.equal(sh(project, "git", ["rev-parse", "HEAD"]), headBefore);
  return runId;
});

test("false claims, loops, rule answers, timeouts and comparison", async () => {
  const runOf = (res) => res.stdout.match(/Run: .*?([0-9]{8}-[0-9]{6}-[a-z]+)/)[1];
  const read = async (runId, task) => JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, task, "1/result.json"), "utf8"));

  const claimer = cli("run", "--variant", "claimer", "add-broken", "--repeat", "1");
  const claimed = await read(runOf(claimer), "add-broken");
  assert.equal(claimed.solved, false);
  assert.equal(claimed.falseClaim, true);
  assert.equal(claimed.signals.verifiedAfterEdit, null);

  const looper = await read(runOf(cli("run", "--variant", "looper", "add-broken", "--repeat", "1")), "add-broken");
  assert.equal(looper.signals.looping, true);
  assert.equal(looper.signals.verifiedAfterEdit, false);

  const askerRun = runOf(cli("run", "--variant", "asker", "rule", "--repeat", "1"));
  const asked = await read(askerRun, "rule");
  assert.equal(asked.solved, true);
  assert.equal(asked.memory.files, 1, "memories the agent wrote are kept with the attempt");
  assert.match(await fs.readFile(path.join(project, ".builderharness/evals", askerRun, "rule/1/memory/note.md"), "utf8"), /migration rule/);

  const apiRun = cli("run", "--variant", "apierror", "add-broken", "rule", "--repeat", "2");
  assert.equal(apiRun.status, 0, apiRun.stderr);
  const apiSummary = JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runOf(apiRun), "summary.json"), "utf8"));
  assert.equal(apiSummary.totals.attempts, 1, "a host error stops the run instead of repeating it");
  assert.match(apiSummary.stoppedEarly, /host error on add-broken #1: host-api-error 400/);
  const apiFailed = await read(runOf(apiRun), "add-broken");
  assert.equal(apiFailed.solved, null);
  assert.equal(apiFailed.grade, undefined, "a host error is not graded");
  const ignored = await read(runOf(cli("run", "--variant", "claimer", "rule", "--repeat", "1")), "rule");
  assert.equal(ignored.solved, false);

  const slept = await read(runOf(cli("run", "--variant", "sleeper", "add-broken", "--repeat", "1")), "add-broken");
  assert.equal(slept.agent.timedOut, true);
  assert.equal(slept.solved, false);
  assert.equal(slept.metrics.stopReason, "no-result");
  const orphan = Number(await fs.readFile(pidFile, "utf8"));
  await new Promise((r) => setTimeout(r, 500));
  assert.throws(() => process.kill(orphan, 0), "a background process the agent started is stopped with it");

  const broke = await read(runOf(cli("run", "--variant", "breaker", "add-broken", "--repeat", "1")), "add-broken");
  assert.equal(broke.solved, false, "a service the agent broke fails the attempt, it is not an infrastructure error");
  assert.equal(broke.infraError, null);
  assert.deepEqual(broke.grade.find((g) => g.id === "served").status, "fail");
  assert.match(broke.grade.find((g) => g.id === "served").detail, /service-exited/);

  const fixer = runOf(cli("run", "--variant", "fixer", "add-broken", "--repeat", "1"));
  const cmp = cli("compare", runOf(claimer), fixer, "--json");
  const rows = JSON.parse(cmp.stdout).rows;
  assert.deepEqual(rows.map((r) => [r.id, r.change]), [["add-broken", "improved"]]);
  const md = cli("compare", runOf(claimer), fixer);
  assert.match(md.stdout, /add-broken \| improved \| 0% → 100%/);
});

test("a quota limit stops new attempts; resume adds rounds and refuses changed tasks", async () => {
  const runOf = (res) => res.stdout.match(/Run: .*?([0-9]{8}-[0-9]{6}-[a-z]+)/)[1];
  const summaryOf = async (runId) => JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, "summary.json"), "utf8"));

  const limited = cli("run", "--variant", "steady", "add-broken", "rule", "--repeat", "2", "--max-quota", "0.4");
  assert.equal(limited.status, 0, limited.stderr);
  const runId = runOf(limited);
  const first = await summaryOf(runId);
  assert.equal(first.totals.attempts, 1, "the fake agent reports 42% of five hours and 51% of seven days");
  assert.match(first.stoppedEarly, /seven-day subscription window at 51%, limit 40%/);

  const resumed = cli("run", "--resume", runId, "--repeat", "3");
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(runOf(resumed), runId, "resume continues the same run");
  const all = await summaryOf(runId);
  assert.equal(all.totals.attempts, 6);
  assert.equal(all.tasks["add-broken"].attempts, 3);
  assert.equal(all.stoppedEarly, undefined);
  const meta = JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, "run.json"), "utf8"));
  assert.equal(meta.repeat, 3);
  assert.equal(meta.resumedAt.length, 1);

  const nothingLeft = cli("run", "--resume", runId, "--dry-run");
  assert.equal(JSON.parse(nothingLeft.stdout).pending, 0);

  const taskFile = path.join(project, "evals/tasks/rule/task.json");
  const original = await fs.readFile(taskFile, "utf8");
  await fs.writeFile(taskFile, original.replace('"Add a column."', '"Add two columns."'));
  try {
    const refused = cli("run", "--resume", runId, "--repeat", "4", "--skip-validate");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /changed since run .* started: rule/);
  } finally {
    await fs.writeFile(taskFile, original);
  }
});

test("an interrupted run stops the agent's process group it started", async () => {
  await fs.rm(pidFile, { force: true });
  const { spawn } = await import("node:child_process");
  const runner = spawn(process.execPath, [CLI, "eval", "run", "--variant", "sleeper", "add-broken", "--repeat", "1", "--root", project], { cwd: project, env: { ...process.env, HOME: path.join(tmp, "home") }, stdio: "ignore", detached: true });
  const deadline = Date.now() + 15000;
  while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const orphan = Number(await fs.readFile(pidFile, "utf8"));
  process.kill(-runner.pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 3000));
  assert.throws(() => process.kill(orphan, 0), "the agent's background child dies with the interrupted runner");
});

test("the work directory may not sit inside the project", async () => {
  const suiteFile = path.join(project, "evals/suite.json");
  const original = await fs.readFile(suiteFile, "utf8");
  await fs.writeFile(suiteFile, JSON.stringify({ ...JSON.parse(original), workDir: "tmp-work" }));
  try {
    const res = cli("validate", "add-broken");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /inside the project/);
  } finally {
    await fs.writeFile(suiteFile, original);
  }
});

test("a session that continues after background work: metrics add up its segments; regrade --trace-only re-reads old records", async () => {
  const runOf = (res) => res.stdout.match(/Run: .*?([0-9]{8}-[0-9]{6}-[a-z]+)/)[1];
  const res = cli("run", "--variant", "backgrounder", "add-broken", "--repeat", "1");
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const runId = runOf(res);
  const resultFile = path.join(project, ".builderharness/evals", runId, "add-broken/1/result.json");
  const record = JSON.parse(await fs.readFile(resultFile, "utf8"));
  assert.equal(record.solved, true);
  assert.equal(record.answer, "Fixed; the background checks passed.", "the answer is the last segment's");
  assert.deepEqual(
    { segments: record.metrics.segments, turns: record.metrics.turns, cost: record.metrics.costUsd, ms: record.metrics.durationMs, api: record.metrics.apiDurationMs, input: record.metrics.tokens.input },
    { segments: 2, turns: 5, cost: 0.3, ms: 500, api: 450, input: 10 },
    "turns, durations and usage are per segment; cost and API time are running totals",
  );
  assert.deepEqual(record.signals.denials, [{ tool: "Bash", detail: "npm run gates; echo done" }], "denials from every segment");

  // A record written by an older parser, and a run item whose recorded verdict must be kept.
  const old = { ...record, metrics: { ...record.metrics, turns: 2, segments: undefined }, signals: { ...record.signals, denials: [] } };
  old.grade = record.grade.map((g) => (g.id === "extra" ? { ...g, status: "fail" } : g));
  await fs.writeFile(resultFile, JSON.stringify(old, null, 2));
  const again = cli("regrade", runId, "--trace-only");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /add-broken #1: solved → unsolved \(turns 2 → 5, denials 0 → 1\)/);
  const fixed = JSON.parse(await fs.readFile(resultFile, "utf8"));
  assert.equal(fixed.metrics.turns, 5);
  assert.equal(fixed.signals.denials.length, 1);
  assert.equal(fixed.grade.find((g) => g.id === "extra").status, "fail", "run items are not run again");
  assert.equal(fixed.grade.find((g) => g.id === "untouched").status, "pass");
  assert.equal(fixed.previous.at(-1).traceOnly, true);
  assert.equal(existsSync(path.join(tmp, "work", runId)), false, "no workspace is rebuilt");

  const taskFile = path.join(project, "evals/tasks/add-broken/task.json");
  const original = await fs.readFile(taskFile, "utf8");
  await fs.writeFile(taskFile, original.replace("Sums are wrong", "Sums are off"));
  try {
    const refused = cli("regrade", runId, "--trace-only");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /tasks changed since the run: add-broken/);
  } finally {
    await fs.writeFile(taskFile, original);
  }
});

test("a suite change makes validations stale; regrade applies a corrected grader to saved attempts", async () => {
  const runOf = (res) => res.stdout.match(/Run: .*?([0-9]{8}-[0-9]{6}-[a-z]+)/)[1];
  const runId = runOf(cli("run", "--variant", "fixer", "add-broken", "--repeat", "1"));
  const resultFile = path.join(project, ".builderharness/evals", runId, "add-broken/1/result.json");
  assert.equal(JSON.parse(await fs.readFile(resultFile, "utf8")).solved, true);
  const savedInject = path.join(project, ".builderharness/evals", runId, "add-broken/1/inject.patch");
  assert.equal(await fs.readFile(savedInject, "utf8"), await fs.readFile(path.join(project, "evals/tasks/add-broken/inject.patch"), "utf8"), "the attempt keeps the defect it saw");

  // A stricter suite: the fix in calc.mjs is now off limits.
  const suiteFile = path.join(project, "evals/suite.json");
  const original = await fs.readFile(suiteFile, "utf8");
  await fs.writeFile(suiteFile, JSON.stringify({ ...JSON.parse(original), untouched: ["package.json", "calc.mjs"] }, null, 2));
  try {
    assert.match(cli("list").stdout, /add-broken\s+dev\s+injected-defect\s+valid \(stale\)/);
    const refused = cli("regrade", runId);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /without a current passing validation: add-broken/);

    assert.equal(cli("validate", "add-broken").status, 0);
    const res = cli("regrade", runId);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /add-broken #1: solved → unsolved/);
    const record = JSON.parse(await fs.readFile(resultFile, "utf8"));
    assert.equal(record.solved, false);
    assert.equal(record.previous[0].solved, true);
    assert.deepEqual(record.grade.find((g) => g.id === "untouched").detail, ["calc.mjs"]);
    assert.ok(existsSync(path.join(project, ".builderharness/evals", runId, "add-broken/1/grade-before-regrade/target.log")));
    const summary = JSON.parse(await fs.readFile(path.join(project, ".builderharness/evals", runId, "summary.json"), "utf8"));
    assert.equal(summary.tasks["add-broken"].solved, 0);
    assert.equal(summary.regradedAt.length, 1);
  } finally {
    await fs.writeFile(suiteFile, original);
  }
});

test("summaries flag unstable tasks and compare warns on equal variants", () => {
  const a = summarize({ runId: "a", variant: "v", base: "x" }, [
    { task: "t", split: "dev", solved: true, metrics: { costUsd: 1 }, agent: { wallMs: 10 }, signals: { verifiedAfterEdit: true } },
    { task: "t", split: "dev", solved: false, metrics: { costUsd: 3 }, agent: { wallMs: 30 }, signals: { verifiedAfterEdit: false } },
    { task: "u", split: "dev", solved: null, infraError: "x" },
  ]);
  assert.equal(a.tasks.t.unstable, true);
  assert.equal(a.tasks.t.rate, 0.5);
  assert.equal(a.tasks.t.costMedianUsd, 2);
  assert.equal(a.tasks.u.rate, null);
  assert.equal(a.totals.infraErrors, 1);
  const c = compareSummaries(a, a);
  assert.ok(c.warnings.some((w) => /noise/.test(w)));
});
