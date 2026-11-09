#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./lib/paths.mjs";

const secret = /(?:authorization|cookie|token|pass(?:word|wd)|secret|api[-_]?key)/i;
function redact(value, depth = 0) {
  if (depth > 10) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, secret.test(key) ? "[redacted]" : redact(item, depth + 1)]));
  if (typeof value === "string") return value.slice(0, 2000).replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]");
  return value;
}

function requestClient(origin, trace, faults) {
  const remaining = faults.map((fault) => {
    if (!["before", "after"].includes(fault.mode) || typeof fault.path !== "string" ||
        (fault.count != null && (!Number.isSafeInteger(fault.count) || fault.count < 1))) throw new Error("Invalid fault definition");
    return { ...fault, count: fault.count ?? 1 };
  });
  return async (method, endpoint, { body, headers } = {}) => {
    if (typeof endpoint !== "string" || !/^\/(?!\/)/.test(endpoint) || endpoint.includes("\\")) throw new Error("Use a route relative to the mock service");
    const url = new URL(endpoint, origin);
    const fault = remaining.find((rule) => rule.count && rule.path === url.pathname && (!rule.method || rule.method === method));
    if (fault) fault.count -= 1;
    const record = { method, path: url.pathname, query: redact(Object.fromEntries(url.searchParams)), request: redact(body) };
    trace.push(record);
    if (fault?.mode === "before") {
      record.fault = "request-not-sent";
      throw new Error("Injected failure before send");
    }
    const response = await fetch(url, {
      method, headers: { ...(body == null ? {} : { "content-type": "application/json" }), ...headers },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    record.status = response.status;
    record.response = redact(data);
    if (fault?.mode === "after") {
      record.fault = "response-lost";
      throw new Error("Injected failure after send");
    }
    return { status: response.status, data };
  };
}

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    only: { type: "string" }, variant: { type: "string" }, json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help || !positionals.length) console.log("builderharness simulate <recipe.mjs> [--only CASE] [--variant ID] [--json]");
  else {
    if (positionals.length !== 1) throw new Error("Provide one simulation recipe");
    const file = path.resolve(positionals[0]);
    const { default: recipe } = await import(pathToFileURL(file).href);
    const variants = recipe.variants ?? { default: {} };
    const selected = values.variant ? Object.keys(variants).filter((id) => id === values.variant) : Object.keys(variants);
    const cases = (recipe.cases ?? []).filter((item) => !values.only || item.id === values.only);
    if (typeof recipe.start !== "function" || !cases.length || !selected.length) throw new Error("Simulation needs a service, a variant and a matching case");
    if (new Set(cases.map((item) => item.id)).size !== cases.length || cases.some((item) => !item.id || typeof item.run !== "function")) throw new Error("Cases require unique IDs and run()");
    const results = [];
    for (const id of selected) {
      for (const item of cases) {
        const trace = [];
        const variant = structuredClone(variants[id]);
        const result = { variant: id, case: item.id, status: "passed", trace };
        let service;
        try {
          service = await recipe.start({ variant, caseId: item.id });
          const url = new URL(service.url);
          if (!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) || url.protocol !== "http:" ||
              url.username || url.password || typeof service.close !== "function") throw new Error("Simulated service must be local HTTP with close()");
          const request = requestClient(url.origin, trace, [...(variant.faults ?? []), ...(item.faults ?? [])]);
          await item.run({ request, variant, assert });
        } catch (error) {
          result.status = "failed";
          result.error = redact(error.message);
        } finally {
          try { await service?.close?.(); }
          catch (error) { result.status = "failed"; result.error ??= redact(error.message); }
        }
        results.push(result);
      }
    }
    const out = path.join(REPO_ROOT, ".builderharness", "simulations", randomUUID());
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "trace.json"), JSON.stringify({ recipe: path.relative(REPO_ROOT, file), results }, null, 2) + "\n");
    const summary = { trace: path.relative(REPO_ROOT, path.join(out, "trace.json")),
      results: results.map(({ trace: _, ...result }) => result) };
    if (values.json) console.log(JSON.stringify(summary, null, 2));
    else {
      for (const result of summary.results) console.log(`${result.status} ${result.variant}/${result.case}${result.error ? " — " + result.error : ""}`);
      console.log(summary.trace);
    }
    process.exitCode = results.some((result) => result.status !== "passed") ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
