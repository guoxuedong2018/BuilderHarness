#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { PROJECT_CONFIG, REPO_ROOT, WEB_DIR } from "./lib/paths.mjs";
import { inspectArtifact, loadScanPolicy } from "./lib/preflight.mjs";

try {
  const { values } = parseArgs({ options: {
    dir: { type: "string" }, json: { type: "boolean" },
    deny: { type: "string", multiple: true }, policy: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) console.log("builderharness preflight [--dir PATH] [--deny REGEX] [--policy FILE] [--json]");
  else {
    const dir = path.resolve(values.dir ?? path.join(WEB_DIR, "dist"));
    const policyFile = values.policy ?? PROJECT_CONFIG.artifactPolicy;
    const policy = await loadScanPolicy(policyFile ? path.resolve(REPO_ROOT, policyFile) : null);
    const result = await inspectArtifact(dir, { denies: values.deny, policy });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (!result.findings.length) console.log(`✓ ${result.files} artifact files scanned (${result.hash.slice(0, 12)}).`);
    else for (const item of result.findings) console.error(`[${item.rule}] ${item.file}${item.line ? ":" + item.line : ""} — ${item.reason}`);
    process.exitCode = result.findings.length ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
