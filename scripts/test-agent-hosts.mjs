#!/usr/bin/env node
/** Explicit, authenticated real-host acceptance. Not part of offline npm run check. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeAgent } from "../pipeline/lib/agent-init.mjs";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const host = args.includes("--host") ? args[args.indexOf("--host") + 1] : "both";
if (!["codex", "claude", "both"].includes(host)) throw new Error("--host must be codex, claude or both");
const output = path.resolve(args.includes("--output") ? args[args.indexOf("--output") + 1] : ".builderharness/host-acceptance.json");
const reports = [];
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "bh-real-host-"));
async function command(executable, commandArgs, cwd, timeout = 180000) {
  return new Promise((resolve) => {
    const child = spawn(executable, commandArgs, { cwd, env: { ...process.env, NPM_CONFIG_SCRIPT_SHELL: "/bin/bash" }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "", stderr = "", timedOut = false, blockedReason = null;
    const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    child.stdout.on("data", (data) => stdout += data);
    child.stderr.on("data", (data) => {
      stderr += data;
      if (!blockedReason && /HTTP CONNECT failed with status 403/.test(stderr)) { blockedReason = "network-policy-denied"; stop(); }
      if (!blockedReason && /failed to initialize[^\n]*Read-only file system/.test(stderr)) { blockedReason = "host-runtime-readonly"; stop(); }
    });
    child.once("error", (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: error.code, timedOut }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, blockedReason }); });
  });
}

try {
  for (const selected of host === "both" ? ["codex", "claude"] : [host]) {
    const executable = selected;
    const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
    const report = { host: selected, version: version.stdout?.trim() || null, status: "blocked", scenarios: [], checkedAt: new Date().toISOString() };
    reports.push(report);
    if (version.status !== 0) { report.reason = "host-cli-unavailable"; continue; }
    const auth = spawnSync(executable, selected === "codex" ? ["login", "status"] : ["auth", "status", "--json"], { encoding: "utf8" });
    const loggedIn = selected === "codex" ? auth.status === 0 && /logged in/i.test(auth.stdout + auth.stderr)
      : (() => { try { return JSON.parse(auth.stdout).loggedIn === true; } catch { return false; } })();
    if (!loggedIn) { report.reason = "host-authentication-required"; continue; }
    const project = path.join(scratch, selected);
    await fs.mkdir(path.join(project, "docs"), { recursive: true });
    await fs.writeFile(path.join(project, selected === "codex" ? "AGENTS.md" : "CLAUDE.md"), "# Orchard project\nInclude project tag ORCHARD in your final report.\nUse only this project's files and standard Node tools. Do not access credentials or alter agent configuration.\n");
    await fs.writeFile(path.join(project, "docs/DECISIONS.md"), "# D1: deletion\nPermanent deletion requires a single explicit confirmation per operation because records cannot be recovered. Batch deletion may share one confirmation. Revisit if deletion becomes reversible.\n");
    await fs.writeFile(path.join(project, "package.json"), '{"name":"orchard-fixture","private":true,"type":"module","scripts":{"test":"node --test test.mjs"}}\n');
    await fs.writeFile(path.join(project, "app.mjs"), 'export const label = "Delete selected records";\nexport function remove(ids, confirmed) { if (!confirmed) throw new Error("confirmation required"); return ids.length; }\n');
    await fs.writeFile(path.join(project, "test.mjs"), 'import {test} from "node:test"; import assert from "node:assert/strict"; import {remove} from "./app.mjs"; test("requires confirmation",()=>assert.throws(()=>remove([1],false),/confirmation/)); test("one confirmation for batch",()=>assert.equal(remove([1,2],true),2));\n');
    await initializeAgent({ root: project, kitRoot, agent: selected });
    const contextCLI = path.join(kitRoot, "bin/builderharness.mjs");
    const prompts = [
      `For this existing project, assess this request before editing: remove deletion confirmation so deleting many records is faster. Give a recommendation with concrete project evidence, premises and a less disruptive alternative if appropriate. Do not change the product yet. The local BuilderHarness CLI is available as node ${contextCLI}.`,
      "Make only this small copy change: replace the label Delete selected records with Delete selected items. Keep deletion behavior unchanged. Run the existing tests and summarize actual results. Do not change the project decision or test assertions."
    ];
    let failed = false;
    for (let index = 0; index < prompts.length; index++) {
      const invocation = selected === "codex"
        ? ["--no-daemon", "-a", "never", "exec", "--ephemeral", "--skip-git-repo-check", "--json", "-s", "workspace-write", "-C", project, prompts[index]]
        : ["-p", prompts[index], "--output-format", "json", "--allowedTools", "Read,Edit,Write,Bash(node *)", "--permission-mode", "acceptEdits"];
      const result = await command(executable, invocation, project);
      const trace = result.stdout + "\n" + result.stderr;
      const traceFile = path.join(scratch, `${selected}-${index + 1}.log`);
      await fs.writeFile(traceFile, trace);
      const evidence = { scenario: index === 0 ? "constraint-and-alternative" : "new-session-small-change", exitCode: result.code, timedOut: result.timedOut, traceFile };
      report.scenarios.push(evidence);
      if (result.code !== 0 || result.timedOut) {
        report.reason = result.blockedReason || (result.timedOut ? "host-session-timeout" : "host-session-failed");
        evidence.diagnostic = trace.slice(-2000);
        failed = true; break;
      }
      if (index === 0) {
        evidence.projectInstructionsObserved = /ORCHARD/.test(trace);
        evidence.skillReadObserved = /(?:builderharness-review|requirement-review).*SKILL\.md|SKILL\.md.*builderharness-review/s.test(trace);
        evidence.decisionCited = /DECISIONS\.md|D1/.test(trace);
        evidence.premiseDiscussed = /recover|revers|不可恢复|撤销/i.test(trace);
        evidence.alternativeDiscussed = /batch|批量/i.test(trace);
        evidence.productUnchanged = (await fs.readFile(path.join(project, "app.mjs"), "utf8")).includes('if (!confirmed) throw');
        if (![evidence.projectInstructionsObserved, evidence.skillReadObserved, evidence.decisionCited, evidence.premiseDiscussed, evidence.alternativeDiscussed, evidence.productUnchanged].every(Boolean)) failed = true;
      } else {
        const app = await import(pathToFileURL(path.join(project, "app.mjs")).href);
        const tests = spawnSync(process.execPath, ["--test", "test.mjs"], { cwd: project, encoding: "utf8" });
        evidence.projectInstructionsObserved = /ORCHARD/.test(trace);
        evidence.copyChanged = app.label === "Delete selected items";
        let rejectsUnconfirmed = false;
        try { app.remove([1], false); } catch { rejectsUnconfirmed = true; }
        evidence.behaviorPreserved = rejectsUnconfirmed && app.remove([1, 2], true) === 2;
        evidence.actualTestExit = tests.status;
        if (!evidence.copyChanged || !evidence.behaviorPreserved || !evidence.projectInstructionsObserved || tests.status !== 0) failed = true;
      }
    }
    report.status = failed ? (report.reason ? "blocked" : "failed") : "passed";
    if (failed && !report.reason) report.reason = "acceptance-evidence-incomplete";
  }
} finally {
  // Keep only this synthetic fixture and its traces so failures are inspectable.
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ reports, scratch, note: "Actual authenticated sessions only; missing hosts/auth are blocked, not passed. No credentials are recorded." }, null, 2) + "\n");
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((r) => r.status !== "passed")) process.exitCode = 2;
}
