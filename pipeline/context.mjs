#!/usr/bin/env node
import { readTaskContext } from "../integrations/host/src/task-context.mjs";
import { PROJECT_ROOT } from "./lib/paths.mjs";

const args = process.argv.slice(2);
const options = { files: [] };
let root = PROJECT_ROOT;
const task = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (["--root", "--file", "--limit", "--max-chars", "--max-scan", "--max-read-bytes"].includes(arg) && (!args[i + 1] || args[i + 1].startsWith("--"))) throw new Error(`Missing value for ${arg}`);
  if (arg === "--root") root = args[++i];
  else if (arg === "--file") options.files.push(args[++i]);
  else if (["--limit", "--max-chars", "--max-scan", "--max-read-bytes"].includes(arg)) {
    const key = { "--limit": "limit", "--max-chars": "maxChars", "--max-scan": "maxScan", "--max-read-bytes": "maxReadBytes" }[arg];
    options[key] = Number(args[++i]);
  } else if (arg !== "--json") {
    if (arg.startsWith("--")) throw new Error(`Unknown context option: ${arg}`);
    task.push(arg);
  }
}
options.task = task.join(" ");
console.log(JSON.stringify(await readTaskContext(root, options), null, 2));
