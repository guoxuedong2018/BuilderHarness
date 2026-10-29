import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const START = /<!-- builderharness:begin sha256=([a-f0-9]{64}) sep=([012]) created=([01]) -->/g;
const END = "<!-- builderharness:end -->";
const OWN = /\n<!-- builderharness:owned sha256=([a-f0-9]{64}) -->\n$/;

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function safe(root, rel) {
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink target refused: ${rel}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return current;
}

function instruction(text, remove) {
  const matches = [...text.matchAll(START)];
  if (matches.length > 1 || ((text.includes("<!-- builderharness:begin") || text.includes(END)) && matches.length !== 1)) throw new Error("Managed markers are damaged or duplicated");
  if (!matches.length) return null;
  const match = matches[0];
  const end = text.indexOf(END, match.index);
  if (end < 0 || text.indexOf(END, end + END.length) >= 0) throw new Error("Managed end marker is missing or duplicated");
  const body = text.slice(match.index + match[0].length, end);
  const eol = body.startsWith("\r\n") ? "\r\n" : "\n";
  if (hash(body) !== match[1]) throw new Error("Managed instructions were edited; preserve and merge manually");
  const after = end + END.length + (text.startsWith(eol, end + END.length) ? eol.length : 0);
  const sep = eol.repeat(Number(match[2]));
  const before = match.index - sep.length;
  if (text.slice(before, match.index) !== sep) throw new Error("Managed separator was edited");
  if (remove) return text.slice(0, before) + text.slice(after);
  return { before: text.slice(0, before), after: text.slice(after), sep, created: match[3], eol };
}

function mergeInstruction(text, remove, present) {
  const old = instruction(text, remove);
  if (remove) return old === null ? text : old;
  const eol = old?.eol ?? (text.includes("\r\n") ? "\r\n" : "\n");
  const before = old?.before ?? text;
  const after = old?.after ?? "";
  const sep = old?.sep ?? (text ? eol.repeat(text.endsWith(eol) ? 1 : 2) : "");
  const body = `${eol}## BuilderHarness${eol}For product behavior changes, read docs/builderharness/WORKFLOW.md and use the builderharness-review skill. Preserve this project's existing instructions and permissions. Small, clear changes may proceed directly. Cite evidence when challenging a proposal; check whether historical premises still hold.${eol}`;
  return before + sep + `<!-- builderharness:begin sha256=${hash(body)} sep=${sep.length / eol.length} created=${old?.created ?? (present ? "0" : "1")} -->` + body + END + eol + after;
}

function own(body) { return body + `\n<!-- builderharness:owned sha256=${hash(body)} -->\n`; }
function owned(text) {
  const marker = text.match(OWN);
  return Boolean(marker && hash(text.slice(0, marker.index)) === marker[1]);
}

/** Add/remove only verifiably owned material. No model, subprocess or application changes. */
export async function initializeAgent({ root, kitRoot, agent, remove = false, dryRun = false }) {
  if (agent && !["codex", "claude", "both"].includes(agent)) throw new Error("--agent must be codex, claude or both");
  if (!dryRun) await fs.mkdir(root, { recursive: true });
  root = path.resolve(root);
  if (await exists(root)) root = await fs.realpath(root);
  const hasCodex = await exists(path.join(root, "AGENTS.md")) || (remove && await exists(path.join(root, ".agents/skills/builderharness-review/SKILL.md")));
  const hasClaude = await exists(path.join(root, "CLAUDE.md")) || (remove && await exists(path.join(root, ".claude/skills/builderharness-review/SKILL.md")));
  const hosts = agent === "both" ? ["codex", "claude"] : agent ? [agent]
    : hasCodex || hasClaude ? [...(hasCodex ? ["codex"] : []), ...(hasClaude ? ["claude"] : [])] : ["codex", "claude"];
  const skill = await fs.readFile(path.join(kitRoot, "scaffold", ".agent", "skills", "requirement-review", "SKILL.md"), "utf8");
  const workflow = await fs.readFile(path.join(kitRoot, "scaffold", "agent-workflow.md"), "utf8");
  const otherHostRemains = remove && ["codex", "claude"].some((host) => !hosts.includes(host) && (host === "codex" ? hasCodex : hasClaude));
  const plans = [];
  for (const host of hosts) {
    plans.push({ file: host === "codex" ? "AGENTS.md" : "CLAUDE.md", instruction: true });
    plans.push({ file: `${host === "codex" ? ".agents" : ".claude"}/skills/builderharness-review/SKILL.md`, body: skill.replace(/^name: requirement-review$/m, "name: builderharness-review") });
  }
  if (!otherHostRemains) plans.push({ file: "docs/builderharness/WORKFLOW.md", body: workflow });
  const changes = [];
  const issues = [];
  for (const plan of plans) {
    try {
      if (remove && plan.file === "docs/builderharness/WORKFLOW.md" && issues.length) {
        changes.push({ file: plan.file, action: "retained-for-unresolved-integration" }); continue;
      }
      const target = await safe(root, plan.file);
      const present = await exists(target);
      const text = present ? await fs.readFile(target, "utf8") : "";
      let next;
      if (plan.instruction) next = mergeInstruction(text, remove, present);
      else {
        if (present && !owned(text)) throw new Error("File exists or was edited; preserve and merge manually");
        next = remove ? "" : own(plan.body);
      }
      if (next === text) { changes.push({ file: plan.file, action: "unchanged" }); continue; }
      const canRemove = !plan.instruction || /<!-- builderharness:begin[^\n]* created=1 -->/.test(text);
      const action = remove && next === "" && canRemove ? "remove" : present ? "update" : "create";
      if (!dryRun) {
        const checkUnchanged = async () => {
          await safe(root, plan.file);
          if (present ? !await exists(target) || await fs.readFile(target, "utf8") !== text : await exists(target)) {
            throw new Error("File changed during initialization; retry after reconciling user changes");
          }
        };
        if (action === "remove") {
          await checkUnchanged();
          await fs.unlink(target);
        }
        else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          const temporary = `${target}.builderharness-${randomUUID()}.tmp`;
          let temporaryOwned = false;
          try {
            const handle = await fs.open(temporary, "wx", present ? (await fs.stat(target)).mode : 0o644);
            temporaryOwned = true;
            try { await handle.writeFile(next, "utf8"); } finally { await handle.close(); }
            await checkUnchanged();
            if (present) await fs.rename(temporary, target);
            // A concurrent creator must never be overwritten by rename.
            else await fs.link(temporary, target);
          } finally { if (temporaryOwned) await fs.rm(temporary, { force: true }); }
        }
      }
      changes.push({ file: plan.file, action });
    } catch (error) { issues.push({ file: plan.file, reason: error.message }); }
  }
  return { root, hosts, dryRun, remove, changes, issues, status: issues.length ? "partial" : dryRun ? "planned" : remove ? "removed" : "configured",
    agentExecution: "not-started", next: remove ? "Project decisions and user files are preserved." : "Continue in your existing agent session. For a product change, use builderharness context <task> --json, inspect original evidence, then decide, implement and verify. No model session or tests were started by init." };
}
