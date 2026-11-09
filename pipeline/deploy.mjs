#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readEnv } from "./lib/env.mjs";
import { PIPELINE_DIR, PROJECT_CONFIG, REPO_ROOT, WEB_DIR } from "./lib/paths.mjs";
import { inspectArtifact, loadScanPolicy } from "./lib/preflight.mjs";

const plans = path.join(REPO_ROOT, ".builderharness", "deploy");
const hashPlan = (plan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");
const resultFile = (id) => path.join(plans, `${id}.receipt.json`);

async function binding(adapter, project) {
  const target = await adapter.describe();
  if (!target || target.project !== project || typeof target.target !== "string" || !target.target.trim() ||
      typeof target.access !== "string" || !target.access.trim()) {
    throw new Error("Deployment binding does not match the requested project, target and access policy");
  }
  return { project: target.project, target: target.target, access: target.access };
}

function verifyFeature(feature) {
  if (!feature) return;
  const check = spawnSync(process.execPath, [path.join(PIPELINE_DIR, "verify.mjs"), feature, "--status"], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(`Required verification or decisions are outstanding for ${feature}:\n${check.stderr || check.stdout}`);
}

async function inspect(dir, denies, policy) {
  const result = await inspectArtifact(dir, { denies, policy });
  if (result.findings.length) throw new Error(`Preflight failed: ${result.findings.map((item) => `${item.rule} at ${item.file}`).join(", ")}`);
  return result.hash;
}

try {
  const [command, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    dir: { type: "string" }, project: { type: "string" }, deny: { type: "string", multiple: true },
    plan: { type: "string" }, policy: { type: "string" }, feature: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (!command || command === "--help" || values.help) {
    console.log("builderharness deploy plan --project ID [--dir dist] [--deny REGEX] [--policy FILE] [--feature KEY] | deploy apply --plan ID");
  } else {
    const configured = readEnv("DEPLOY_GATEWAY");
    if (!configured) throw new Error("Set BUILDERHARNESS_DEPLOY_GATEWAY to the host's deployment adapter");
    const gateway = path.resolve(REPO_ROOT, configured);
    const moduleBytes = await readFile(gateway);
    const gatewayHash = createHash("sha256").update(moduleBytes).digest("hex");
    const { default: adapter } = await import(pathToFileURL(gateway).href);
    for (const method of ["describe", "upload", "readVersion"]) {
      if (typeof adapter?.[method] !== "function") throw new Error(`Deployment adapter missing ${method}()`);
    }
    if (command === "plan") {
      const project = values.project;
      if (!project) throw new Error("--project is required");
      const dir = path.resolve(values.dir ?? path.join(WEB_DIR, "dist"));
      const denies = values.deny ?? [];
      const selectedPolicy = values.policy ?? PROJECT_CONFIG.artifactPolicy;
      const policyFile = selectedPolicy ? path.resolve(REPO_ROOT, selectedPolicy) : null;
      const policy = await loadScanPolicy(policyFile);
      verifyFeature(values.feature);
      const plan = { version: 1, dir, denies, gateway, gatewayHash, policyFile, policyHash: policy?.hash ?? null, feature: values.feature ?? null, binding: await binding(adapter, project), artifactHash: await inspect(dir, denies, policy) };
      const id = hashPlan(plan);
      await mkdir(plans, { recursive: true });
      await writeFile(path.join(plans, `${id}.json`), JSON.stringify(plan, null, 2) + "\n");
      console.log(JSON.stringify({ id, project, target: plan.binding.target, access: plan.binding.access, artifactHash: plan.artifactHash }, null, 2));
    } else if (command === "apply") {
      const id = values.plan;
      if (!/^[a-f0-9]{64}$/.test(id ?? "")) throw new Error("--plan must identify a reviewed deployment plan");
      const plan = JSON.parse(await readFile(path.join(plans, `${id}.json`), "utf8"));
      if (hashPlan(plan) !== id || plan.gateway !== gateway || plan.gatewayHash !== gatewayHash) throw new Error("Plan or adapter changed; generate and review a new plan");
      const policy = await loadScanPolicy(plan.policyFile);
      if ((policy?.hash ?? null) !== (plan.policyHash ?? null)) throw new Error("Artifact policy changed; generate a new plan");
      verifyFeature(plan.feature);
      const actual = await binding(adapter, plan.binding.project);
      if (JSON.stringify(actual) !== JSON.stringify(plan.binding)) throw new Error("Target or access changed; generate and review a new plan");
      const saved = await readFile(resultFile(id), "utf8").then(JSON.parse, (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      let receipt = saved;
      if (!receipt) {
        const tmp = await mkdtemp(path.join(os.tmpdir(), "bh-deploy-"));
        try {
          const dir = path.join(tmp, "dist");
          await cp(plan.dir, dir, { recursive: true, verbatimSymlinks: true });
          if (await inspect(dir, plan.denies, policy) !== plan.artifactHash) throw new Error("Build changed; generate and review a new plan");
          const uploaded = await adapter.upload({ dir, binding: actual, artifactHash: plan.artifactHash, idempotencyKey: id });
          if (!uploaded?.version || new URL(uploaded.fixedUrl).protocol !== "https:") throw new Error("Adapter must return a version and fixed HTTPS URL");
          receipt = { version: uploaded.version, fixedUrl: uploaded.fixedUrl, verified: false };
          await writeFile(resultFile(id), JSON.stringify(receipt, null, 2) + "\n");
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      }
      const remote = await adapter.readVersion({ binding: actual, version: receipt.version, fixedUrl: receipt.fixedUrl });
      if (remote?.version !== receipt.version || remote?.artifactHash !== plan.artifactHash) {
        throw new Error(`Deployment version could not be verified at ${receipt.fixedUrl}; retry the same plan to recheck the uploaded version`);
      }
      receipt.verified = true;
      await writeFile(resultFile(id), JSON.stringify(receipt, null, 2) + "\n");
      console.log(JSON.stringify(receipt, null, 2));
    } else throw new Error(`Unknown deploy command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
