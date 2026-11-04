/**
 * Reads a Claude Code stream-json trace (`claude -p --output-format stream-json --verbose`)
 * and derives the metrics and process signals the eval reports.
 *
 * The parser only relies on the documented event shapes: `system/init`, `assistant`
 * messages with `tool_use` blocks, `user` messages with `tool_result` blocks and the
 * final `result` event. Unknown events are counted and ignored.
 */
import path from "node:path";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function text(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join("\n");
  return "";
}

function pickInit(init) {
  if (!init) return null;
  const names = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === "string" ? x : x?.name ?? "?")) : undefined);
  return {
    model: init.model,
    claudeCodeVersion: init.claude_code_version,
    permissionMode: init.permissionMode,
    apiKeySource: init.apiKeySource,
    tools: names(init.tools),
    mcpServers: Array.isArray(init.mcp_servers) ? init.mcp_servers.map((s) => `${s.name}:${s.status}`) : undefined,
    skills: names(init.skills),
    plugins: names(init.plugins),
    agents: names(init.agents),
    slashCommands: Array.isArray(init.slash_commands) ? init.slash_commands.length : undefined,
  };
}

export function parseTrace(raw) {
  const events = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? null;
  const result = [...events].reverse().find((e) => e.type === "result") ?? null;
  const steps = [];
  const toolResults = new Map();
  let lastText = "";
  for (const e of events) {
    if (e.type === "assistant") {
      for (const block of e.message?.content ?? []) {
        if (block.type === "tool_use") steps.push({ id: block.id, name: block.name, input: block.input ?? {}, subagent: Boolean(e.parent_tool_use_id) });
        if (block.type === "text" && !e.parent_tool_use_id && block.text?.trim()) lastText = block.text;
      }
    } else if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const block of e.message.content) {
        if (block.type === "tool_result") toolResults.set(block.tool_use_id, { isError: Boolean(block.is_error), text: text(block.content).slice(0, 400) });
      }
    }
  }
  return {
    events: events.length,
    malformed,
    init: pickInit(init),
    result,
    steps,
    toolResults,
    answer: typeof result?.result === "string" && result.result.trim() ? result.result : lastText,
  };
}

export function traceMetrics(parsed) {
  const r = parsed.result;
  const usage = r?.usage ?? {};
  return {
    stopReason: r ? r.subtype ?? "unknown" : "no-result",
    isError: r ? Boolean(r.is_error) : true,
    costUsd: typeof r?.total_cost_usd === "number" ? r.total_cost_usd : null,
    turns: r?.num_turns ?? null,
    durationMs: r?.duration_ms ?? null,
    apiDurationMs: r?.duration_api_ms ?? null,
    tokens: {
      input: usage.input_tokens ?? null,
      output: usage.output_tokens ?? null,
      cacheRead: usage.cache_read_input_tokens ?? null,
      cacheCreation: usage.cache_creation_input_tokens ?? null,
    },
  };
}

function relative(cwd, file) {
  if (!file) return "?";
  if (!cwd || !path.isAbsolute(file)) return file;
  return path.relative(cwd, file) || ".";
}

/**
 * Process signals. `verifiedAfterEdit` is null when the agent edited nothing through
 * its edit tools; edits made by shell commands only show up in the diff.
 */
export function traceSignals(parsed, { cwd, verifyCommands = [], successClaims = [], loopThreshold = 8 } = {}) {
  const denials = (parsed.result?.permission_denials ?? []).map((d) => ({
    tool: d.tool_name,
    detail: String(d.tool_input?.command ?? d.tool_input?.file_path ?? JSON.stringify(d.tool_input ?? {})).slice(0, 200),
    id: d.tool_use_id,
  }));
  const denied = new Set(denials.map((d) => d.id));
  const verify = verifyCommands.map((re) => new RegExp(re, "i"));
  const editsPerFile = {};
  const toolCalls = {};
  const outsideEdits = new Set();
  let lastEdit = -1;
  const verifyRuns = [];
  let toolErrors = 0;
  parsed.steps.forEach((step, index) => {
    toolCalls[step.name] = (toolCalls[step.name] ?? 0) + 1;
    if (denied.has(step.id)) return;
    if (parsed.toolResults.get(step.id)?.isError) toolErrors += 1;
    if (EDIT_TOOLS.has(step.name)) {
      lastEdit = index;
      const file = relative(cwd, step.input.file_path ?? step.input.notebook_path);
      editsPerFile[file] = (editsPerFile[file] ?? 0) + 1;
      if (file.startsWith("..")) outsideEdits.add(file);
    }
    if (step.name === "Bash" && verify.some((re) => re.test(step.input.command ?? ""))) {
      verifyRuns.push({ index, command: String(step.input.command).slice(0, 200), failed: Boolean(parsed.toolResults.get(step.id)?.isError) });
    }
  });
  const after = verifyRuns.filter((v) => v.index > lastEdit);
  const [busiestFile, busiest] = Object.entries(editsPerFile).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return {
    edits: Object.values(editsPerFile).reduce((a, b) => a + b, 0),
    verifiedAfterEdit: lastEdit === -1 ? null : after.length > 0,
    lastVerifyFailed: after.length ? after[after.length - 1].failed : null,
    verifyRuns: verifyRuns.map(({ command, failed }) => ({ command, failed })),
    claimedSuccess: successClaims.some((re) => new RegExp(re, "i").test(parsed.answer ?? "")),
    looping: busiest > loopThreshold,
    busiestFile: busiestFile ? { file: busiestFile, edits: busiest } : null,
    outsideEdits: [...outsideEdits],
    denials: denials.map(({ tool, detail }) => ({ tool, detail })),
    toolErrors,
    toolCalls,
    subagentCalls: parsed.steps.filter((s) => s.subagent).length,
  };
}
