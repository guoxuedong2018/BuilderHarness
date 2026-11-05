/**
 * Small helpers shared by the eval runner. Dependency-free on purpose: the
 * runner is part of the base CLI, which has no runtime dependencies.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

/** Converts a path glob (`*`, `**`, `?`) into an anchored RegExp. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** A pattern without wildcards also matches everything below it, so `prisma` covers `prisma/schema.prisma`. */
export function matchesGlob(file, glob) {
  if (!/[*?]/.test(glob)) {
    const prefix = glob.replace(/\/+$/, "");
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  return globToRegExp(glob).test(file);
}

export const matchesAny = (file, globs = []) => globs.some((glob) => matchesGlob(file, glob));

export function median(values) {
  const sorted = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Expands `${NAME}` from the given environment; unknown names become empty strings. */
export function expandEnv(value, env = process.env) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => env[name] ?? "");
}

export function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function killGroup(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}

const TAIL = 64 * 1024;

/**
 * Process groups started by the runner that are still alive. Detached groups survive
 * their parent, so an interrupted run (Ctrl-C, a stopped task) stops them itself.
 */
const live = new Set();
let trapped = false;
function track(child) {
  live.add(child);
  if (!trapped) {
    trapped = true;
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
      process.once(signal, () => {
        for (const c of live) killGroup(c, "SIGTERM");
        setTimeout(() => {
          for (const c of live) killGroup(c, "SIGKILL");
          process.exit(code);
        }, 2000).unref();
      });
    }
  }
  child.once("exit", () => live.delete(child));
}

/**
 * Runs a process in its own process group. Output can go to files; the last 64 KiB of
 * each stream is kept in memory. On timeout the whole group gets SIGTERM, then SIGKILL.
 * When the main process exits, the rest of its group is stopped too, so background
 * servers an agent or a grade command left behind do not outlive the step.
 */
export function runProcess(command, args, { cwd, env, timeoutMs, stdoutFile, stderrFile } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
      if (child.pid) track(child);
    } catch (error) {
      resolve({ code: null, signal: null, timedOut: false, stdout: "", stderr: error.message, durationMs: 0, spawnError: error.code || error.message });
      return;
    }
    const out = stdoutFile ? fs.createWriteStream(stdoutFile) : null;
    const err = stderrFile ? fs.createWriteStream(stderrFile) : null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exit = null;
    let settled = false;
    const keep = (buffer, chunk) => (buffer + chunk).slice(-TAIL);
    child.stdout.on("data", (chunk) => {
      out?.write(chunk);
      stdout = keep(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      err?.write(chunk);
      stderr = keep(stderr, chunk.toString());
    });
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killGroup(child, "SIGTERM");
          setTimeout(() => killGroup(child, "SIGKILL"), 5000).unref();
        }, timeoutMs)
      : null;
    const finish = (spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const done = () =>
        resolve({
          code: exit?.code ?? null,
          signal: exit?.signal ?? null,
          timedOut,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          ...(spawnError ? { spawnError } : {}),
        });
      let pending = [out, err].filter(Boolean).length;
      if (!pending) return done();
      for (const stream of [out, err].filter(Boolean)) stream.end(() => --pending === 0 && done());
    };
    child.once("error", (error) => finish(error.code || error.message));
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      // Leftover members of the group (servers, watchers) would hold the pipes open.
      killGroup(child, "SIGTERM");
      const hard = setTimeout(() => killGroup(child, "SIGKILL"), 5000);
      hard.unref();
      const fallback = setTimeout(finish, 10000);
      fallback.unref();
      child.once("close", () => {
        clearTimeout(fallback);
        finish();
      });
    });
  });
}

/** Runs a shell command line with /bin/sh. */
export function runShell(line, options) {
  return process.platform === "win32" ? runProcess("cmd.exe", ["/d", "/s", "/c", line], options) : runProcess("/bin/sh", ["-c", line], options);
}

/** A long-running service in its own process group, stopped with `stop()`. */
export function startService(line, { cwd, env, logFile }) {
  const log = fs.createWriteStream(logFile);
  const child = spawn("/bin/sh", ["-c", line], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  if (child.pid) track(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let exited = null;
  const exitPromise = new Promise((resolve) => child.once("exit", (code, signal) => {
    exited = { code, signal };
    resolve(exited);
  }));
  return {
    get exited() {
      return exited;
    },
    async stop() {
      if (!exited) {
        killGroup(child, "SIGTERM");
        const hard = setTimeout(() => killGroup(child, "SIGKILL"), 10000);
        let giveUp;
        await Promise.race([exitPromise, new Promise((r) => (giveUp = setTimeout(r, 15000)))]);
        clearTimeout(hard);
        clearTimeout(giveUp);
      }
      killGroup(child, "SIGKILL");
      await new Promise((r) => log.end(r));
    },
  };
}

/** Resolves true once `url` answers with a status below 500. */
export async function urlAnswers(url, timeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}
