#!/usr/bin/env node
import { PROJECT_ROOT, KIT_ROOT } from "./lib/paths.mjs";
import { initializeAgent } from "./lib/agent-init.mjs";
import path from "node:path";

const args = process.argv.slice(2);
const supported = new Set(["--scaffold", "--target", "--list", "--dry-run", "--only", "--force", "--agent", "--remove"]);
for (let i = 0; i < args.length; i++) {
  if (!supported.has(args[i])) throw new Error(`Unknown init option: ${args[i]}`);
  if (["--target", "--only", "--agent"].includes(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${args[i]}`);
    i++;
  }
}
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const legacy = args.some((arg) => ["--scaffold", "--only", "--force"].includes(arg));
if (legacy) {
  if (args.includes("--remove") || args.includes("--agent") || args.includes("--dry-run")) throw new Error("Agent integration options cannot be combined with scaffold options; use --list for scaffold preview");
  if (!args.includes("--scaffold")) console.error("Legacy scaffold options retained. Use init --scaffold explicitly for the complete scaffold.");
  await import("./scaffold-init.mjs");
} else {
  const result = await initializeAgent({ root: path.resolve(value("--target") || PROJECT_ROOT), kitRoot: KIT_ROOT,
    agent: value("--agent"), remove: args.includes("--remove"), dryRun: args.includes("--list") || args.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length) process.exitCode = 1;
}
