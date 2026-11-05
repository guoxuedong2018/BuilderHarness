/**
 * Agent hosts for the eval runner.
 *
 * - `claude`: Claude Code in print mode with a stream-json trace. User-level settings,
 *   plugins and MCP servers are left out so only the variant's project files count.
 * - `command`: any executable that prints a stream-json trace; used by the runner's
 *   own tests and for wrapping other agents.
 */
import { spawnSync } from "node:child_process";
import { expandEnv, runProcess } from "./eval-util.mjs";

/**
 * The environment of a nested session must not look like the parent's: variables set
 * by an enclosing Claude Code session (CLAUDECODE, CLAUDE_CODE_*, ...) are dropped.
 */
export function cleanEnv(base = process.env, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (!/^CLAUDE/.test(key)) env[key] = value;
  for (const [key, value] of Object.entries(extra)) env[key] = expandEnv(value, base);
  return env;
}

export function claudeArgs({ prompt, variant, agent }) {
  // The prompt follows -p directly: --allowedTools takes a variadic list and would
  // swallow a positional argument placed after it.
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  args.push("--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence");
  args.push("--permission-mode", agent.permissionMode);
  if (variant.model) args.push("--model", variant.model);
  if (variant.effort) args.push("--effort", variant.effort);
  if (agent.budgetUsd) args.push("--max-budget-usd", String(agent.budgetUsd));
  if (variant.appendSystemPrompt) args.push("--append-system-prompt", variant.appendSystemPrompt);
  if (agent.allowedTools?.length) args.push("--allowedTools", agent.allowedTools.join(","));
  if (agent.disallowedTools?.length) args.push("--disallowedTools", agent.disallowedTools.join(","));
  return args;
}

/** Version and readiness of the host, checked once before a run. */
export function hostStatus(variant, env = process.env) {
  if (variant.host === "command") return { host: "command", version: "command", ready: true };
  const version = spawnSync("claude", ["--version"], { encoding: "utf8", env });
  if (version.status !== 0) return { host: "claude", version: null, ready: false, reason: "host-cli-unavailable" };
  if (env.ANTHROPIC_API_KEY) return { host: "claude", version: version.stdout.trim(), ready: true, auth: "api-key" };
  const auth = spawnSync("claude", ["auth", "status", "--json"], { encoding: "utf8", env });
  let loggedIn = false;
  try {
    loggedIn = JSON.parse(auth.stdout).loggedIn === true;
  } catch {
    /* not JSON: treat as logged out */
  }
  return loggedIn
    ? { host: "claude", version: version.stdout.trim(), ready: true, auth: "login" }
    : { host: "claude", version: version.stdout.trim(), ready: false, reason: "host-authentication-required" };
}

export function agentInvocation({ prompt, variant, agent }) {
  if (variant.host === "command") {
    const [command, ...rest] = variant.command.map((part) => expandEnv(part, { ...process.env, VARIANT_DIR: variant.dir }));
    return { command, args: [...rest, prompt] };
  }
  return { command: "claude", args: claudeArgs({ prompt, variant, agent }) };
}

export async function runAgent({ cwd, prompt, variant, agent, env, traceFile, stderrFile }) {
  const { command, args } = agentInvocation({ prompt, variant, agent });
  const res = await runProcess(command, args, {
    cwd,
    env: { ...env, BH_EVAL_PROMPT: prompt },
    timeoutMs: agent.timeoutMin * 60_000,
    stdoutFile: traceFile,
    stderrFile,
  });
  return { exitCode: res.code, signal: res.signal, timedOut: res.timedOut, wallMs: res.durationMs, spawnError: res.spawnError ?? null };
}
