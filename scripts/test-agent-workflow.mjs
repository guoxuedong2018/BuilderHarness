#!/usr/bin/env node
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readTaskContext } from "../integrations/host/src/task-context.mjs";
import { readContext } from "../integrations/host/src/project.mjs";
import { initializeAgent } from "../pipeline/lib/agent-init.mjs";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bh-agent-"));
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  try { await run(root, write); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("task evidence uses original decisions/source, preserves location and never runs discovered scripts", async () => fixture(async (root, write) => {
  await write("AGENTS.md", "# Rules\nPreserve existing checks.\n");
  await write("design/decisions.md", "# Export decision\nGuests cannot export customer records.\nPremise: public sessions have no audit identity.\n");
  await write("service.py", "def export(role):\n    return role != 'guest'\n");
  await write("package.json", JSON.stringify({ scripts: { test: "touch must-not-run", build: "touch must-not-build" } }));
  const result = await readTaskContext(root, { task: "guest export", files: ["design/decisions.md", "service.py"] });
  const decision = result.sources.find((s) => s.file === "design/decisions.md");
  assert.equal(decision.kind, "decision");
  assert.match(decision.excerpt, /Guests cannot export/);
  assert.equal(decision.startLine, 1);
  assert.ok(result.sources.some((s) => s.file === "service.py"));
  assert.ok(result.verification.some((v) => v.script === "test" && v.status === "not-run"));
  assert.equal(await fs.stat(path.join(root, "must-not-run")).then(() => true, () => false), false);
  assert.ok(result.sources.every((s) => s.verifiedBehavior === false));
}));

test("bounded scan reports omissions, missing files and outside-scope paths", async () => fixture(async (root, write) => {
  await write("README.md", "x".repeat(300));
  await write("a.md", "some more context");
  const result = await readTaskContext(root, { files: ["../outside.md", "missing.md"], maxChars: 100, maxScan: 1 });
  assert.equal(result.coverage.truncated, true);
  assert.ok(result.coverage.chars <= 100);
  assert.ok(result.issues.some((i) => i.reason === "outside-scope"));
  assert.ok(result.issues.some((i) => i.file === "missing.md"));
  assert.ok(result.issues.some((i) => i.reason === "budget-reached"));
  await assert.rejects(() => readTaskContext(root, { limit: NaN }), /Budget/);
  await assert.rejects(() => readTaskContext(root, { files: "a.md" }), /array/);
}));

test("secret files and symlink escapes are excluded; nested instructions retain scope", async () => fixture(async (root, write) => {
  await write(".env", "SECRET=should-never-be-read");
  await write(".npmrc", "token-that-must-not-be-read");
  await write("config.json", '{"token":"literal-that-must-be-redacted"}');
  await write("build/source.mjs", "// explicitly selected tracked build source");
  await write("sub/AGENTS.md", "# Subproject rules\nUse a subproject-only convention.\n");
  await fs.symlink(os.tmpdir(), path.join(root, "escape"));
  const result = await readTaskContext(root, { files: [".env", ".npmrc", "config.json", "build/source.mjs", "escape/something.md", "sub/AGENTS.md"] });
  assert.ok(result.sources.every((s) => !s.excerpt.includes("should-never-be-read")));
  assert.ok(result.sources.every((s) => !s.excerpt.includes("token-that-must-not-be-read") && !s.excerpt.includes("literal-that-must-be-redacted")));
  assert.ok(result.sources.some((s) => s.file === "config.json" && s.redacted));
  assert.ok(result.sources.some((s) => s.file === "build/source.mjs"));
  assert.equal(result.sources.find((s) => s.file === "sub/AGENTS.md").scope, "sub");
  assert.ok(result.issues.some((i) => i.reason === "symlink-not-followed"));
  const child = await readTaskContext(path.join(root, "sub"));
  assert.ok(child.sources.every((s) => !s.file.startsWith("../")));
}));

test("MCP reader retains legacy KB context and shares the task collector", async () => fixture(async (root, write) => {
  await write("docs/kb/import.md", "# Import guide\nImport a CSV.\n");
  const old = await readContext(root, { topic: "import", limit: 5 });
  assert.equal(old.files[0].file, "import.md");
  const current = await readContext(root, { task: "import" });
  const direct = await readTaskContext(root, { task: "import" });
  assert.deepEqual(current, direct);
}));

test("prefixed credential literals and unquoted YAML values are redacted before output truncation", async () => fixture(async (root, write) => {
  await write("config.json", JSON.stringify({ OPENAI_API_KEY: 'synthetic-quoted-"credential', DATABASE_PASSWORD: "synthetic-password" }));
  await write("config.yaml", "api_key: synthetic-yaml-key\n  service_auth_token: synthetic-yaml-token # explanation\n");
  await write(".envrc", "export TOKEN=synthetic-direnv-token\n");
  const result = await readTaskContext(root, { files: ["config.json", "config.yaml", ".envrc"] });
  assert.equal(result.sources.filter((s) => s.redacted).length, 2);
  assert.ok(result.sources.every((s) => !s.excerpt.includes("synthetic-")));
  assert.ok(result.issues.some((i) => i.file === ".envrc" && i.reason === "excluded"));
  const clipped = await readTaskContext(root, { files: ["config.json"], maxChars: 100 });
  assert.ok(clipped.sources.every((s) => !s.excerpt.includes("synthetic-")));
}));

test("an excerpt omitting the beginning of a file is marked clipped", async () => fixture(async (root, write) => {
  await write("policy.md", Array.from({ length: 45 }, (_, i) => i === 40 ? "Relevant orchard policy" : "unrelated line").join("\n"));
  const result = await readTaskContext(root, { task: "orchard", files: ["policy.md"] });
  assert.ok(result.sources[0].startLine > 1);
  assert.equal(result.sources[0].clipped, true);
}));

test("init preserves user instructions byte-for-byte, is repeatable and reverses only owned changes", async () => fixture(async (root, write) => {
  const original = "# My harness\r\n\r\nKeep my project rules.\r\n";
  await write("AGENTS.md", original);
  await write("CLAUDE.md", "");
  await write("docs/DECISIONS.md", "# Existing decision\nKeep me.\n");
  const init = () => initializeAgent({ root, kitRoot });
  const first = await init();
  assert.equal(first.status, "configured");
  const withBlock = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.ok(withBlock.startsWith(original));
  assert.ok(!withBlock.replaceAll("\r\n", "").includes("\n"));
  assert.ok((await init()).changes.every((c) => c.action === "unchanged"));
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), withBlock);
  assert.equal((await initializeAgent({ root, kitRoot, remove: true })).status, "removed");
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), original);
  assert.equal(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8"), "");
  assert.match(await fs.readFile(path.join(root, "docs/DECISIONS.md"), "utf8"), /Keep me/);
}));

test("edited managed content and skill-name collisions survive reinitialization and removal", async () => fixture(async (root, write) => {
  await write("AGENTS.md", "Existing rules");
  await initializeAgent({ root, kitRoot });
  const skill = ".agents/skills/builderharness-review/SKILL.md";
  const edited = (await fs.readFile(path.join(root, skill), "utf8")) + "\nUser additions\n";
  await write(skill, edited);
  const result = await initializeAgent({ root, kitRoot });
  assert.equal(result.status, "partial");
  assert.ok(result.issues.some((i) => i.file === skill));
  await initializeAgent({ root, kitRoot, remove: true });
  assert.equal(await fs.readFile(path.join(root, skill), "utf8"), edited);
  assert.ok(await fs.stat(path.join(root, "docs/builderharness/WORKFLOW.md")));
}));

test("user additions with different line endings do not damage managed block removal", async () => fixture(async (root, write) => {
  const original = "# Original rules\n";
  const added = "\r\n# User additions\r\nKeep these too.\r\n";
  await write("AGENTS.md", original);
  await initializeAgent({ root, kitRoot, agent: "codex" });
  await fs.appendFile(path.join(root, "AGENTS.md"), added);
  assert.equal((await initializeAgent({ root, kitRoot, agent: "codex" })).status, "configured");
  assert.equal((await initializeAgent({ root, kitRoot, agent: "codex", remove: true })).status, "removed");
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), original + added);
}));

test("edits during temporary writes and concurrent file creation are preserved", async () => fixture(async (root, write) => {
  const rules = path.join(root, "AGENTS.md");
  const userEdit = "# User rules saved during init\n";
  await write("AGENTS.md", "# Original rules\n");
  const originalOpen = fs.open;
  fs.open = async (file, ...args) => {
    if (file.startsWith(`${rules}.builderharness-`)) await fs.writeFile(rules, userEdit);
    return originalOpen(file, ...args);
  };
  let result;
  try { result = await initializeAgent({ root, kitRoot, agent: "codex" }); }
  finally { fs.open = originalOpen; }
  assert.equal(result.status, "partial");
  assert.ok(result.issues.some((i) => i.file === "AGENTS.md" && /changed during/.test(i.reason)));
  assert.ok(result.changes.every((c) => c.file !== "AGENTS.md"));
  assert.equal(await fs.readFile(rules, "utf8"), userEdit);
  assert.ok((await fs.readdir(root)).every((file) => !file.endsWith(".tmp")));

  await fs.unlink(rules);
  const originalLink = fs.link;
  fs.link = async (source, target) => {
    if (target === rules) await fs.writeFile(rules, userEdit);
    return originalLink(source, target);
  };
  try { result = await initializeAgent({ root, kitRoot, agent: "codex" }); }
  finally { fs.link = originalLink; }
  assert.equal(result.status, "partial");
  assert.ok(result.issues.some((i) => i.file === "AGENTS.md"));
  assert.equal(await fs.readFile(rules, "utf8"), userEdit);
  assert.ok((await fs.readdir(root)).every((file) => !file.endsWith(".tmp")));
}));

test("one-host removal retains the other host and its shared workflow", async () => fixture(async (root) => {
  await initializeAgent({ root, kitRoot });
  await initializeAgent({ root, kitRoot, remove: true, agent: "codex" });
  assert.ok(await fs.stat(path.join(root, "CLAUDE.md")));
  assert.ok(await fs.stat(path.join(root, "docs/builderharness/WORKFLOW.md")));
  await initializeAgent({ root, kitRoot, remove: true, agent: "claude" });
  assert.equal(await fs.stat(path.join(root, "docs/builderharness/WORKFLOW.md")).then(() => true, () => false), false);
}));

test("unreadable and oversized evidence and read-budget limits are reported", async () => fixture(async (root, write) => {
  await write("large.md", "x".repeat(140000));
  await write("restricted.md", "User cannot read this evidence.");
  await fs.chmod(path.join(root, "restricted.md"), 0);
  const result = await readTaskContext(root, { files: ["large.md", "restricted.md"] });
  assert.ok(result.issues.some((i) => i.file === "large.md" && i.reason === "file-size-budget"));
  if (process.getuid?.() !== 0) assert.ok(result.issues.some((i) => i.file === "restricted.md" && i.reason === "EACCES"));
  await fs.chmod(path.join(root, "restricted.md"), 0o600);
  const bounded = await readTaskContext(root, { files: ["restricted.md"], maxReadBytes: 100 });
  assert.ok(bounded.coverage.bytesRead <= 100);
}));

test("contradictory sources retain their original statements for agent review", async () => fixture(async (root, write) => {
  await write("docs/DECISIONS.md", "# Export policy\nGuests cannot export. Premise: no audit identity.\n");
  await write("export.mjs", "// Current implementation allows every guest export.\nexport const guestExport = true;\n");
  const result = await readTaskContext(root, { task: "guest export", files: ["export.mjs"] });
  assert.ok(result.sources.some((s) => s.excerpt.includes("Guests cannot export")));
  assert.ok(result.sources.some((s) => s.excerpt.includes("allows every guest")));
  assert.match(result.interpretation, /disagree/);
}));

test("dry run performs no writes; conflicts and symlink parents produce partial status", async () => fixture(async (root, write) => {
  const future = path.join(root, "future");
  const plan = await initializeAgent({ root: future, kitRoot, dryRun: true });
  assert.equal(plan.status, "planned");
  assert.equal(await fs.stat(future).then(() => true, () => false), false);
  await write("AGENTS.md", "<!-- builderharness:begin damaged -->\nUser modified this\n");
  await fs.symlink(os.tmpdir(), path.join(root, ".agents"));
  const result = await initializeAgent({ root, kitRoot, agent: "codex" });
  assert.equal(result.status, "partial");
  assert.equal(result.issues.length, 2);
  assert.match(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), /User modified/);
}));

test("default CLI init works without a frontend and does not scaffold application files", async () => fixture(async (root) => {
  const run = spawnSync(process.execPath, [path.join(kitRoot, "bin/builderharness.mjs"), "init", "--target", root], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.agentExecution, "not-started");
  assert.ok(result.hosts.includes("codex") && result.hosts.includes("claude"));
  for (const file of ["package.json", "src/config/frs-map.js", "vite.config.js", "docs/templates/FRS.json"]) {
    assert.equal(await fs.stat(path.join(root, file)).then(() => true, () => false), false, file);
  }
  const context = spawnSync(process.execPath, [path.join(kitRoot, "bin/builderharness.mjs"), "context", "local change", "--root", root], { encoding: "utf8" });
  assert.equal(context.status, 0, context.stderr);
  assert.ok(JSON.parse(context.stdout).sources.length > 0);
}));
