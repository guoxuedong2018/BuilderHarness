#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { adapterName } from "./lib/adapter.mjs";
import { click, errorOverlay, evaluate, fill, goto, installHelpers, launch, press, screenshot, waitFor } from "./lib/cdp.mjs";
import { readDecisions } from "./lib/decisions.mjs";
import { readEnv } from "./lib/env.mjs";
import { FEATURES_DIR, PROJECT_CONFIG, REPO_ROOT, WEB_DIR } from "./lib/paths.mjs";
import { sourcesForRoute } from "./lib/route-source.mjs";

const idPattern = /^[A-Za-z0-9_-]+$/;
const baseUrl = () => readEnv("BASE_URL") || PROJECT_CONFIG.baseUrl || "http://localhost:5173";
const rel = (file) => path.relative(REPO_ROOT, file);
const sha = (input) => createHash("sha256").update(input).digest("hex");

function validate(frs) {
  const cases = (frs.verification ?? []).filter((entry) => typeof entry !== "string");
  const ids = new Set();
  const ac = new Set((frs.acceptance ?? []).map((entry) => String(entry).match(/^AC\d+/)?.[0]));
  for (const scenario of cases) {
    const kinds = [scenario?.route, scenario?.command, scenario?.manual].filter(Boolean);
    if (!idPattern.test(scenario?.id ?? "") || ids.has(scenario.id) || kinds.length !== 1 ||
        !Array.isArray(scenario.ac) || !scenario.ac.length ||
        scenario.ac.some((key) => typeof key !== "string" || !/^AC\d+$/.test(key) || !ac.has(key))) {
      throw new Error(`Invalid verification scenario ${scenario?.id ?? "(missing ID)"}: use a unique ID, known ACs and one verification method`);
    }
    ids.add(scenario.id);
    if (scenario.route && (!/^\/(?!\/)/.test(scenario.route) || scenario.route.includes("\\") ||
        !Array.isArray(scenario.steps) || !scenario.steps.some((step) => step?.expect))) {
      throw new Error(`${scenario.id} needs a local route and at least one positive browser assertion`);
    }
    if (scenario.command && (!Array.isArray(scenario.command) || !scenario.command.length ||
        scenario.command.some((part) => typeof part !== "string" || !part))) throw new Error(`${scenario.id} needs a command argv array`);
    if (scenario.manual && typeof scenario.manual !== "string") throw new Error(`${scenario.id} needs a manual test description`);
    if (scenario.inputs && (!Array.isArray(scenario.inputs) ||
        scenario.inputs.some((file) => typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")))) {
      throw new Error(`${scenario.id} inputs must be project-relative paths`);
    }
  }
  return cases;
}

async function fingerprint(scenario, frsFile, base) {
  const routes = scenario.route ? await sourcesForRoute(REPO_ROOT, scenario.route) : [];
  const files = [...new Set([rel(frsFile), "builderharness.config.json", rel(path.join(WEB_DIR, "package.json")),
    ...routes, ...(scenario.inputs ?? [])])].sort();
  const hashes = [];
  for (const file of files) {
    const value = await readFile(path.resolve(REPO_ROOT, file)).then((contents) => {
      if (file !== rel(frsFile)) return sha(contents);
      const spec = JSON.parse(contents);
      // A publication receipt does not change behavior or invalidate its verification.
      delete spec.prdDocId;
      delete spec.updatedAt;
      return sha(JSON.stringify(spec));
    }, (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    hashes.push([file, value]);
  }
  // Missing dependencies should never present previous results as current.
  const missingInputs = hashes.filter(([file, value]) => value === null && scenario.inputs?.includes(file)).map(([file]) => file);
  return { hash: sha(JSON.stringify([scenario, hashes, adapterName(), scenario.route ? base : null])), untracked: Boolean(scenario.route && !routes.length), missingInputs };
}

async function browser(scenario, base, file) {
  const { session, close } = await launch({ viewport: { width: 1280, height: 800, scale: 1 } });
  const runtimeErrors = [];
  session.on("Runtime.exceptionThrown", (event) => {
    runtimeErrors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text);
  });
  try {
    const url = new URL(PROJECT_CONFIG.routeMode === "history" ? scenario.route : "/", base);
    if (PROJECT_CONFIG.routeMode !== "history") url.hash = scenario.route;
    url.searchParams.set("verify", "1");
    // Reuse the existing convention for loading synthetic-only capture data.
    url.searchParams.set("shot", "verify");
    await installHelpers(session, { onNavigation: true });
    const load = () => goto(session, url.href);
    await load();
    for (const step of scenario.steps) {
      if (step.click) await click(session, step.click);
      else if (step.fill) await fill(session, step.fill.selector, step.fill.text);
      else if (step.press) await press(session, step.press);
      else if (step.reload === true) { url.searchParams.set("shot", randomUUID()); await load(); }
      else if (step.expect) {
        const selector = JSON.stringify(step.expect);
        if (!(await waitFor(session, step.expect)) ||
            !(await evaluate(session, `window.__protoVisible(window.__protoFind(${selector}))`))) throw new Error(`Expected visible: ${step.expect}`);
      } else if (step.absent) {
        const selector = JSON.stringify(step.absent);
        if (await evaluate(session, `(() => { const el = window.__protoFind(${selector}); return !!el && window.__protoVisible(el); })()`)) {
          throw new Error(`Expected absent: ${step.absent}`);
        }
      } else throw new Error("Unknown verification step");
    }
    const overlay = await errorOverlay(session);
    if (overlay || runtimeErrors.length) throw new Error(overlay || runtimeErrors[0]);
    await writeFile(file, await screenshot(session, { scale: 1 }));
    return { status: "passed", evidence: rel(file) };
  } catch (error) {
    const image = await screenshot(session, { scale: 1 }).catch(() => null);
    if (image) await writeFile(file, image);
    return { status: "failed", detail: error.message, ...(image ? { evidence: rel(file) } : {}) };
  } finally {
    await close();
  }
}

async function runScenario(scenario, base, out, id) {
  if (scenario.route) return browser(scenario, base, path.join(out, `${scenario.id}-${id}.png`));
  if (scenario.manual) return { status: "not-run", detail: scenario.manual };
  const [command, ...args] = scenario.command;
  const result = spawnSync(command, args, { cwd: WEB_DIR, encoding: "utf8", timeout: 120_000, maxBuffer: 8 << 20 });
  const log = path.join(out, `${scenario.id}-${id}.log`);
  await writeFile(log, [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n"));
  return { status: result.status === 0 ? "passed" : "failed", evidence: rel(log), exitCode: result.status };
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    status: { type: "boolean" }, base: { type: "string" }, json: { type: "boolean" },
    only: { type: "string" }, record: { type: "string" }, result: { type: "string" },
    evidence: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  const [key] = positionals;
  if (values.help || !key) {
    console.log("builderharness verify KEY [--status] [--base URL] [--only ID] [--json]\n  Manual: verify KEY --record ID --result passed|failed|skipped --evidence NOTE");
  } else {
    if (!idPattern.test(key) || positionals.length !== 1) throw new Error("Provide one valid feature key");
    if (values.status && values.record) throw new Error("Choose --status or --record");
    const frsFile = path.join(FEATURES_DIR, key, "FRS.json");
    const frs = JSON.parse(await readFile(frsFile, "utf8"));
    const scenarios = validate(frs);
    const only = values.record ?? values.only;
    if (only && !scenarios.some((scenario) => scenario.id === only)) throw new Error(`Unknown verification scenario: ${only}`);
    const base = values.base ?? baseUrl();
    const out = path.join(REPO_ROOT, ".builderharness", "verification", key);
    if (!values.status) await mkdir(out, { recursive: true });
    const results = [];
    for (const scenario of scenarios) {
      if (only && scenario.id !== only) continue;
      const input = await fingerprint(scenario, frsFile, base);
      const file = path.join(out, `${scenario.id}.json`);
      let row = await readFile(file, "utf8").then(JSON.parse, (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!values.status && (!scenario.manual || values.record)) {
        const id = randomUUID();
        let result;
        if (values.record) {
          if (!scenario.manual || !["passed", "failed", "skipped"].includes(values.result) || !values.evidence?.trim()) {
            throw new Error("Record manual scenarios with --result passed|failed|skipped and --evidence");
          }
          result = { status: values.result, detail: values.evidence };
        } else {
          try { result = await runScenario(scenario, base, out, id); }
          catch (error) { result = { status: "failed", detail: error.message }; }
        }
        const after = await fingerprint(scenario, frsFile, base);
        if (input.hash !== after.hash) result = { ...result, status: "stale", detail: "Inputs changed during verification" };
        row = { ...result, input, at: new Date().toISOString() };
        const tmp = `${file}.${id}.tmp`;
        await writeFile(tmp, JSON.stringify(row, null, 2) + "\n");
        await rename(tmp, file);
      }
      const stale = row && (row.input.hash !== input.hash || input.untracked || input.missingInputs.length > 0);
      const status = !row ? "not-run" : stale && row.status === "passed" ? "stale" : row.status;
      results.push({ id: scenario.id, ac: scenario.ac, required: scenario.required === true, ...row, status });
    }
    const decisions = (await readDecisions(key)).filter((item) => item.required && item.status !== "recorded")
      .map(({ id, status }) => ({ id, status }));
    const blocked = decisions.length > 0 || results.some((result) => result.required && result.status !== "passed");
    if (values.json) console.log(JSON.stringify({ key, results, decisions, blocked }, null, 2));
    else {
      for (const result of results) console.log(`${result.status} ${result.id} [${result.ac.join(", ")}]${result.evidence ? " → " + result.evidence : ""}${result.detail ? " — " + result.detail : ""}`);
      for (const decision of decisions) console.log(`${decision.status} blocking decision ${decision.id}`);
      if (!results.length) console.log("No executable or recorded scenarios in FRS.verification.");
    }
    process.exitCode = blocked ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
