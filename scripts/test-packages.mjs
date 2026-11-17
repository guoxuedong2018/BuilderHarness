#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bh-packages-")));
const env = { ...process.env, NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" };
const metrics = { node: process.version, measuredAt: new Date().toISOString() };
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 12 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function pack(cwd) {
  const result = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp], cwd));
  const [artifact] = Array.isArray(result) ? result : Object.values(result);
  assert.ok(artifact?.filename, "npm pack should return a tarball name");
  return artifact;
}
async function size(dir) {
  let bytes = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += await size(file);
    else if (entry.isFile()) bytes += (await fs.stat(file)).size;
  }
  return bytes;
}
try {
  if (process.argv.includes("--baseline")) {
    const baselineRef = process.argv.includes("--baseline-ref") ? process.argv[process.argv.indexOf("--baseline-ref") + 1] : "HEAD";
    metrics.baselineCommit = run("git", ["rev-parse", "--verify", "--end-of-options", `${baselineRef}^{commit}`], root).trim();
    const baseline = path.join(tmp, "baseline-source");
    const consumer = path.join(tmp, "baseline-consumer");
    await fs.mkdir(baseline); await fs.mkdir(consumer);
    const archive = spawnSync("git", ["archive", metrics.baselineCommit], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(archive.status, 0);
    const extract = spawnSync("tar", ["-x", "-C", baseline], { input: archive.stdout });
    assert.equal(extract.status, 0);
    const artifact = pack(baseline);
    await fs.writeFile(path.join(consumer, "package.json"), '{"private":true}\n');
    const start = performance.now();
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(tmp, artifact.filename)], consumer);
    metrics.baseline = { version: artifact.version, installedBytes: await size(path.join(consumer, "node_modules")), installMs: Math.round(performance.now() - start) };
    console.log(`BASELINE ${JSON.stringify(metrics.baseline)}`);
  }
  const core = pack(root);
  const browser = pack(path.join(root, "packages/browser"));
  assert.ok(core.files.some(({ path }) => path === "scaffold/starter/vite.config.js"));
  assert.ok(core.files.every(({ path }) => !path.startsWith("examples/react-tailwind/")));
  const consumer = path.join(tmp, "consumer");
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  let start = performance.now();
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(tmp, core.filename)], consumer);
  const baseMs = Math.round(performance.now() - start);
  const tree = JSON.parse(run("npm", ["ls", "--all", "--json"], consumer));
  // npm lists unmet optional peer names as empty entries; only versioned entries are installed.
  assert.deepEqual(Object.entries(tree.dependencies.builderharness.dependencies || {}).filter(([, value]) => value.version), []);
  for (const dependency of ["react", "mermaid", "@xyflow/react", "@babel", "vite"]) {
    assert.equal(await fs.stat(path.join(consumer, "node_modules", dependency)).then(() => true, () => false), false, dependency);
  }
  const baseBytes = await size(path.join(consumer, "node_modules"));
  metrics.base = { version: core.version, installedBytes: baseBytes, installMs: baseMs, runtimeDependencies: 0 };
  const cli = path.join(consumer, "node_modules/builderharness/bin/builderharness.mjs");
  const project = path.join(tmp, "plain-project");
  await fs.mkdir(project);
  const init = JSON.parse(run(process.execPath, [cli, "init", "--target", project], project));
  assert.equal(init.status, "configured");
  assert.ok(JSON.parse(run(process.execPath, [cli, "context", "a small change", "--root", project], project)).sources.length);
  const bareVite = run(process.execPath, ["--input-type=module", "-e", "const {builderHarness}=await import('builderharness/vite'); console.log(typeof builderHarness)"], consumer);
  assert.match(bareVite, /function/);
  console.log(`PASS packed base: 0 runtime dependencies, ${baseBytes} installed bytes, ${baseMs} ms (cache/network dependent)`);

  start = performance.now();
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(tmp, browser.filename)], consumer);
  // Simulate a strict, non-hoisted package manager layout: only the profile can see its deps.
  const modules = path.join(consumer, "node_modules");
  const profileModules = path.join(modules, "@builderharness/browser/node_modules");
  await fs.mkdir(profileModules, { recursive: true });
  for (const name of await fs.readdir(modules)) {
    if (["builderharness", "@builderharness", ".bin", ".package-lock.json"].includes(name)) continue;
    await fs.rename(path.join(modules, name), path.join(profileModules, name));
  }
  const smoke = (strictLayout = true) => `
    import assert from 'node:assert/strict';
    import {builderHarness} from 'builderharness/vite';
    const plugins=builderHarness({root:process.cwd(),anchorLoc:'react'});
    const config=plugins[0].config();
    ${strictLayout ? "assert.ok(config.resolve.alias.some(x=>x.replacement.includes('@builderharness/browser/node_modules')));" : ""}
    const anchor=plugins.find(p=>p.name==='builderharness:anchor-loc-react');
    const result=await anchor.transform('export default function App(){return <button>Run</button>}',process.cwd()+'/App.jsx');
    assert.match(result.code,/data-loc/);
    console.log('PASS optional browser runtime and Babel anchors');
  `;
  console.log(run(process.execPath, ["--input-type=module", "-e", smoke()], consumer).trim());
  const vendor = path.join(tmp, "vendor");
  await fs.mkdir(vendor);
  run("tar", ["-xzf", path.join(tmp, core.filename), "-C", vendor], tmp);
  const vendorURL = pathToFileURL(path.join(vendor, "package/vite.mjs")).href;
  console.log(run(process.execPath, ["--input-type=module", "-e", smoke().replace("'builderharness/vite'", JSON.stringify(vendorURL))], consumer).trim());
  console.log("PASS vendored toolkit resolves the host optional profile without a local dependency tree");
  metrics.browser = { installedBytes: await size(modules), installMs: Math.round(performance.now() - start) };
  console.log(`PASS optional profile: ${metrics.browser.installedBytes} installed bytes, ${metrics.browser.installMs} ms (cache/network dependent)`);

  // Exercise the actual desktop starter configuration against an unpacked kit
  // outside the project. Default npm file-directory links do not install its deps.
  const desktop = path.join(tmp, "desktop-project");
  const kitRoot = path.join(vendor, "package");
  await fs.cp(path.join(kitRoot, "scaffold/starter"), desktop, { recursive: true });
  const { configureStarterProject } = await import(pathToFileURL(path.join(kitRoot, "integrations/desktop/starter-project.mjs")).href);
  await configureStarterProject({ root: desktop, kitRoot, name: "Desktop fixture" });
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], desktop);
  assert.equal((await fs.lstat(path.join(desktop, "node_modules/builderharness"))).isSymbolicLink(), false);
  assert.equal((await fs.lstat(path.join(desktop, "node_modules/@builderharness/browser"))).isSymbolicLink(), false);
  console.log(run(process.execPath, ["--input-type=module", "-e", smoke(false)], desktop).trim());
  const vite = await import(pathToFileURL(path.join(desktop, "node_modules/vite/dist/node/index.js")).href);
  const dev = await vite.createServer({ root: desktop, server: { host: "127.0.0.1", port: 5417, hmr: false } });
  try {
    await dev.listen();
    const origin = `http://127.0.0.1:${dev.httpServer.address().port}`;
    const read = async (file) => {
      const response = await fetch(origin + file, { signal: AbortSignal.timeout(15_000) });
      const body = await response.text();
      assert.ok(response.ok, `${file} returned ${response.status}\n${body}`);
      return body;
    };
    const fromKit = (file) => "/@fs/" + vite.normalizePath(path.join(desktop, "node_modules/builderharness", file));
    assert.match(await read("/src/App.jsx"), /data-loc/);
    const main = await read("/src/main.jsx");
    assert.match(main, /BuilderHarnessRoot/);
    assert.match(await read(fromKit("client/adapters/react.jsx")), /BuilderHarnessRoot/);
    assert.match(await read(fromKit("client/adapters/react.less")), /\.rs-content/);
    const react = main.match(/"(\/[^"]+\/deps\/react\.js(?:\?[^"]*)?)"/)?.[1];
    assert.ok(react, "starter should load prebundled React");
    await read(react);
  } finally {
    if (dev.httpServer.listening) await dev.waitForRequestsIdle();
    await dev.close();
  }
  run("npm", ["run", "build"], desktop);
  assert.ok((await fs.stat(path.join(desktop, "dist/index.html"))).isFile());
  run(process.execPath, ["node_modules/builderharness/bin/builderharness.mjs", "preflight"], desktop);
  assert.equal(await fs.stat(path.join(kitRoot, "packages/browser/node_modules")).then(() => true, () => false), false);
  console.log("PASS actual desktop starter installs external dependencies, transforms in dev and passes build preflight");
  if (process.argv.includes("--output")) await fs.writeFile(process.argv[process.argv.indexOf("--output") + 1], JSON.stringify(metrics, null, 2) + "\n");
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
