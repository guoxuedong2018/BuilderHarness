/**
 * One isolated workspace per eval run.
 *
 * The workspace is a snapshot of the base commit with the task's defect applied and
 * the variant's files laid over it, committed as the only commit of a fresh
 * repository. The agent can use git normally but cannot see what was injected.
 * Heavy, untracked directories (node_modules) are cloned copy-on-write when the
 * file system allows it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GIT_IDENTITY = ["-c", "user.name=builderharness-eval", "-c", "user.email=eval@builderharness.invalid", "-c", "commit.gpgsign=false"];

function git(cwd, args, options = {}) {
  const res = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: options.encoding ?? "utf8", maxBuffer: 256 * 1024 * 1024, input: options.input });
  if (res.status !== 0 && !options.allowFail) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${String(res.stderr || res.error?.message || "").trim()}`);
  }
  return res;
}

export function resolveCommit(sourceRoot, ref) {
  return git(sourceRoot, ["rev-parse", "--verify", `${ref}^{commit}`]).stdout.trim();
}

/** Lists the instruction files above `dir` that an agent started in `dir` would load. */
export function ancestorInstructions(dir) {
  const found = [];
  const home = os.homedir();
  let current = path.dirname(path.resolve(dir));
  for (;;) {
    for (const name of ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]) {
      if (existsSync(path.join(current, name))) found.push(path.join(current, name));
    }
    if (current !== home && existsSync(path.join(current, ".claude"))) found.push(path.join(current, ".claude"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

function exportSnapshot(sourceRoot, base, dir, exclude) {
  return new Promise((resolve, reject) => {
    const pathspec = ["--", ".", ...exclude.map((p) => `:(exclude)${p}`)];
    const archive = spawn("git", ["-C", sourceRoot, "archive", "--format=tar", base, ...pathspec], { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-x", "-f", "-", "-C", dir], { stdio: ["pipe", "ignore", "pipe"] });
    let errors = "";
    archive.stderr.on("data", (d) => (errors += d));
    tar.stderr.on("data", (d) => (errors += d));
    archive.stdout.pipe(tar.stdin);
    let pending = 2;
    let failed = false;
    const done = (code) => {
      if (code !== 0) failed = true;
      if (--pending === 0) failed ? reject(new Error(`snapshot export failed: ${errors.trim()}`)) : resolve();
    };
    archive.once("close", done);
    tar.once("close", done);
    archive.once("error", reject);
    tar.once("error", reject);
  });
}

/** Copy-on-write clone where the file system supports it, a plain copy otherwise. */
export async function cloneTree(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // clonefile(2) fails across volumes; plain cp -R is still much faster than fs.cp.
  const attempts = process.platform === "darwin" ? [["-c", "-R"], ["-R"]] : process.platform === "linux" ? [["--reflink=auto", "-R"]] : [];
  for (const flags of attempts) {
    const res = spawnSync("cp", [...flags, src, dest], { encoding: "utf8" });
    if (res.status === 0) return { "-c": "clone", "--reflink=auto": "reflink" }[flags[0]] ?? "copy";
    await fs.rm(dest, { recursive: true, force: true });
  }
  await fs.cp(src, dest, { recursive: true, verbatimSymlinks: true });
  return "copy";
}

async function overlay(from, to) {
  await fs.cp(from, to, { recursive: true, force: true });
}

/**
 * Builds a workspace in `dir`. `inject` is an absolute patch path or null; `variant`
 * may carry an overlay directory and paths to remove.
 */
export async function createWorkspace({ sourceRoot, base, dir, exclude = [], inject = null, variant = null, clone = [] }) {
  await fs.mkdir(dir, { recursive: true });
  await exportSnapshot(sourceRoot, base, dir, exclude);
  // Initialise before applying anything: git apply inside a foreign repository
  // would resolve paths against that repository's root.
  git(dir, ["init", "-q"]);
  if (clone.length) await fs.appendFile(path.join(dir, ".git", "info", "exclude"), `${clone.map((p) => `/${p}`).join("\n")}\n`);
  if (inject) {
    const res = git(dir, ["apply", "--whitespace=nowarn", inject], { allowFail: true });
    if (res.status !== 0) throw new Error(`inject patch does not apply: ${res.stderr.trim()}`);
  }
  if (variant?.files) await overlay(variant.files, dir);
  for (const p of variant?.remove ?? []) await fs.rm(path.join(dir, p), { recursive: true, force: true });
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "snapshot"]);
  const snapshot = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
  const cloned = {};
  for (const p of clone) {
    const src = path.join(sourceRoot, p);
    if (existsSync(src)) cloned[p] = await cloneTree(src, path.join(dir, p));
  }
  return { dir, snapshot, cloned };
}

function parseNameStatus(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status[0], path: rest.join("\t") };
    });
}

/** The agent's changes relative to the snapshot, including untracked files and its own commits. */
export function workspaceDiff(dir, snapshot) {
  if (!existsSync(path.join(dir, ".git"))) return { error: "workspace-git-missing", files: [], patch: "", commits: 0 };
  git(dir, ["add", "-A"]);
  const files = parseNameStatus(git(dir, ["diff", "--cached", "--no-renames", "--name-status", snapshot]).stdout);
  const patch = git(dir, ["diff", "--cached", "--no-renames", "--binary", snapshot]).stdout;
  const commits = Number(git(dir, ["rev-list", "--count", `${snapshot}..HEAD`], { allowFail: true }).stdout.trim() || 0);
  return { files, patch, commits };
}

/**
 * Puts the grader's files back: `restore` paths (files or directories) return to their
 * base content, then the task's hidden directory is copied over the workspace.
 */
export async function applyGradeFiles(dir, { sourceRoot, base, restore = [], hiddenDir = null }) {
  let all = null;
  for (const entry of restore) {
    const p = entry.replace(/\/+$/, "");
    const type = git(sourceRoot, ["cat-file", "-t", `${base}:${p}`], { allowFail: true }).stdout.trim();
    if (!type) throw new Error(`restore path ${p} does not exist at ${base.slice(0, 12)}`);
    // A directory restores every file it had at base; files the agent added stay.
    all ??= type === "tree" ? listFilesAt(sourceRoot, base) : null;
    const files = type === "tree" ? all.filter((f) => f.startsWith(`${p}/`)) : [p];
    for (const file of files) {
      const res = git(sourceRoot, ["show", `${base}:${file}`], { encoding: "buffer" });
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), res.stdout);
    }
  }
  if (hiddenDir) await overlay(hiddenDir, dir);
}

/** True when `glob`-style path list entries all exist at `base` (used by validate). */
export function pathExistsAt(sourceRoot, base, p) {
  return git(sourceRoot, ["cat-file", "-e", `${base}:${p}`], { allowFail: true }).status === 0;
}

export function listFilesAt(sourceRoot, base) {
  return git(sourceRoot, ["ls-tree", "-r", "--name-only", base]).stdout.split("\n").filter(Boolean);
}
