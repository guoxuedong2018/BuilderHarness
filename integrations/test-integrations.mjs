import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { addReview, readContext, readOpenReviews, readPublishPlan, readStatus, resolveReview } from "./host/src/project.mjs";
import { createBuilderHarnessService } from "./host/src/service.mjs";
import { detectPrototype, detectStack } from "./host/src/prototype.mjs";
import { apply as applyDshPlugin } from "./host/src/dsh.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpServer = path.join(here, "host", "src", "mcp.mjs");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "builderharness-spike-"));
  await fs.mkdir(path.join(root, "docs", "kb", "guides"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "kb", "concepts"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "reviews"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "features", "OVERVIEW"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { dev: "vite" }, dependencies: { builderharness: "^0.8.0" } }, null, 2),
  );
  await fs.writeFile(path.join(root, "docs", "kb", "guides", "import.md"), "# Import guide\n\nImport a CSV file.\n");
  await fs.writeFile(
    path.join(root, "docs", "kb", "concepts", "overview.md"),
    "---\ntitle: Workspace overview\n---\n\nThe workspace combines review and content.\n",
  );
  await fs.writeFile(path.join(root, "docs", "features", "OVERVIEW", "FRS.json"), JSON.stringify({ key: "OVERVIEW" }));
  await fs.writeFile(
    path.join(root, "docs", "reviews", "OVERVIEW.json"),
    JSON.stringify([
      {
        id: "c1",
        frs: "OVERVIEW",
        route: "/overview",
        author: "Ada",
        body: "Keep the score column right-aligned.",
        status: "open",
        createdAt: "2026-10-19T10:00:00.000Z",
        replies: [],
        anchor: { loc: "src/App.jsx:42:3" },
      },
      {
        id: "c2",
        frs: "OVERVIEW",
        route: "/overview",
        author: "Milo",
        body: "Resolved.",
        status: "resolved",
        createdAt: "2026-10-19T09:00:00.000Z",
        replies: [],
      },
    ]),
  );
  return root;
}

async function testManifest() {
  const hostDir = path.join(here, "host");
  const pkg = JSON.parse(await fs.readFile(path.join(hostDir, "package.json"), "utf8"));
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.bin["builderharness-mcp"], "./src/mcp.mjs");
  assert.equal(pkg.exports["./mcp"], "./src/mcp.mjs");
  const patch = await fs.readFile(path.join(hostDir, pkg.dsh.bundle.patch), "utf8");
  assert.match(patch, /@builderharness\/dsh-bundle/);
}

async function testCore(root) {
  const status = await readStatus(root);
  assert.equal(status.docs.kb.files, 2);
  assert.equal(status.docs.reviews.open, 1);
  assert.equal(status.docs.reviews.comments, 2);
  assert.equal(status.docs.features.specs, 1);
  assert.equal(status.prototype.devScript, "vite");

  const context = await readContext(root, { topic: "import", limit: 5 });
  assert.equal(context.files.length, 1);
  assert.equal(context.files[0].file, "guides/import.md");
  assert.equal(context.files[0].title, "Import guide");

  const reviews = await readOpenReviews(root);
  assert.equal(reviews.comments.length, 1);
  assert.equal(reviews.comments[0].id, "c1");
  assert.equal(reviews.comments[0].anchor.loc, "src/App.jsx:42:3");

  const publish = await readPublishPlan(root);
  assert.equal(publish.summary.total, 2);
  assert.equal(publish.summary.newPages, 2);
  assert.equal(publish.configured, false);
}

async function testPrototypeDetection() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "builderharness-prototype-"));
  try {
    await fs.writeFile(path.join(dir, "README.md"), "# no app here\n");
    const empty = await detectPrototype(dir);
    assert.equal(empty.found, false);
    assert.match(empty.reason, /package\.json/);

    await fs.mkdir(path.join(dir, "web"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "web", "package.json"),
      JSON.stringify({ scripts: { dev: "vite" }, dependencies: { vite: "^6.0.0" } }),
    );
    await fs.writeFile(path.join(dir, "web", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const found = await detectPrototype(dir);
    assert.equal(found.found, true);
    assert.equal(found.dir, "web");
    assert.equal(found.devScript, "vite");
    assert.equal(found.packageManager, "pnpm");
    assert.equal(found.installed, false);
    assert.match(found.reason, /pnpm install/);
    await assert.rejects(() => createBuilderHarnessService().startPrototype(dir), /pnpm install/);

    await fs.mkdir(path.join(dir, "web", "node_modules"), { recursive: true });
    const installed = await detectPrototype(dir);
    assert.equal(installed.installed, true);
    assert.equal(installed.reason, null);
    const service = createBuilderHarnessService();
    assert.deepEqual(await service.installPrototype(dir), {
      ok: true,
      dir: "web",
      installed: true,
      reused: true,
      packageManager: "pnpm",
    });

    await fs.writeFile(
      path.join(dir, "web", "server.mjs"),
      [
        'import { createServer } from "node:http";',
        "const port = 5399;",
        'createServer((_, res) => res.end("fixture ok")).listen(port, () => console.log(`ready http://localhost:${port}/`));',
      ].join("\n"),
    );
    await fs.writeFile(path.join(dir, "web", "package.json"), JSON.stringify({ scripts: { dev: "node server.mjs" } }));
    assert.equal((await detectPrototype(dir)).installed, true, "zero-dependency apps need no install");
    const running = await createBuilderHarnessService().startPrototype(dir);
    assert.equal(running.target, "http://localhost:5399/");
    assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(await (await fetch(running.url)).text(), "fixture ok");
    assert.equal(createBuilderHarnessService().stopPrototype(dir).stopped, true);

    await fs.writeFile(
      path.join(dir, "web", "package.json"),
      JSON.stringify({
        scripts: { dev: "vite" },
        dependencies: { vite: "^6.0.0", react: "^19.0.0", tailwindcss: "^3.4.0" },
      }),
    );
    const stack = await detectStack(dir);
    assert.equal(stack.stack, "react-tailwind");
    assert.equal(stack.appDir, "web");
    assert.equal(stack.bundler, "vite");
    assert.equal(stack.label, "React + Tailwind");

    const status = await readStatus(dir);
    assert.equal(status.prototype.dir, "web");
    assert.equal(status.prototype.devScript, "vite");
    assert.equal(status.prototype.found, true);
    assert.equal(status.prototype.installed, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testContentService(root) {
  const service = createBuilderHarnessService();
  const status = await service.contentStatus(root);
  assert.equal(status.summary.pages, 2);
  assert.equal(status.lock, "docs/kb/_lock.json");

  const confirmed = await service.contentConfirm(root, { page: "guides/import.md" });
  assert.equal(confirmed.ok, true);
  const lock = JSON.parse(await fs.readFile(path.join(root, "docs", "kb", "_lock.json"), "utf8"));
  assert.ok(lock.files["guides/import.md"].at);
  await assert.rejects(() => service.contentConfirm(root, { page: "../outside.md" }), /page/);
}

async function testReviewWrites(root) {
  const added = await addReview(root, {
    frs: "OVERVIEW",
    route: "/overview",
    body: "Added by the integration test.",
    author: "Test",
    anchor: "src/App.jsx:7:2",
  });
  assert.equal(added.comment.status, "open");
  assert.equal((await readOpenReviews(root)).comments.length, 2);

  const resolved = await resolveReview(root, { id: added.comment.id, note: "Checked." });
  assert.equal(resolved.comment.status, "resolved");
  assert.equal(resolved.comment.replies.length, 1);
  assert.equal((await readOpenReviews(root)).comments.length, 1);
}

async function testDshPlugin(root) {
  const tools = [];
  const routes = [];
  const provided = [];
  let ensured = 0;
  const webCtx = {
    effect: (fn) => fn(),
    webServer: {
      register: (route) => {
        routes.push(route);
        return () => {};
      },
    },
  };
  applyDshPlugin(
    {
      tools: { register: (tool) => tools.push(tool) },
      workingDirectory: {
        ensure: async () => {
          ensured += 1;
          return root;
        },
      },
      provide: (name, value) => provided.push([name, value]),
      inject: (services, callback) => {
        if (services.includes("webServer")) callback(webCtx);
      },
    },
    {},
  );
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "builderharness_capture_media",
      "builderharness_content_confirm",
      "builderharness_content_status",
      "builderharness_context",
      "builderharness_publish_plan",
      "builderharness_review_add",
      "builderharness_review_open",
      "builderharness_review_resolve",
      "builderharness_status",
    ],
  );
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    "/builderharness/api/baseline",
    "/builderharness/api/content",
    "/builderharness/api/content/capture",
    "/builderharness/api/prototype/install",
    "/builderharness/api/prototype/start",
    "/builderharness/api/publish/dry-run",
    "/builderharness/api/requirements/check",
    "/builderharness/api/requirements/create",
    "/builderharness/api/review/resolve",
    "/builderharness/api/state",
  ]);
  assert.equal(provided[0][0], "builderharness");
  assert.equal(typeof provided[0][1].contentStatus, "function");
  assert.equal(typeof provided[0][1].baseline, "function");
  assert.equal(typeof provided[0][1].saveBaseline, "function");
  assert.equal(typeof provided[0][1].createFeature, "function");
  assert.equal(typeof provided[0][1].startPrototype, "function");

  const statusTool = tools.find((tool) => tool.name === "builderharness_status");
  const value = await statusTool.execute({}, { agent: {}, signal: new AbortController().signal });
  const status = JSON.parse(value);
  assert.equal(status.root, root);
  assert.equal(status.docs.reviews.open, 1);
  assert.equal(ensured, 1);
  assert.equal(statusTool.output.schema.type, "string");
  assert.equal(statusTool.parameters.additionalProperties, false);

  let response = "";
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      response = value;
    },
  };
  await routes[0].handler(
    { method: "GET", url: `/builderharness/api/state?root=${encodeURIComponent(root)}` },
    res,
  );
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(response);
  assert.equal(payload.status.docs.kb.files, 2);
  assert.equal(payload.reviews.comments.length, 1);
}

async function testClientBundle() {
  const code = await fs.readFile(path.join(here, "host", "lib", "client.js"), "utf8");
  let registration;
  const sandbox = { window: { __ModuleLoader__: { load: (entry) => { registration = entry; } } } };
  vm.runInNewContext(code, sandbox);
  assert.equal(registration.id, "@builderharness/dsh-bundle");
  const exported = registration.factory(() => ({
    createElement() {},
    useState() {},
    useEffect() {},
    useCallback() {},
    Fragment: {},
  }));
  assert.equal(exported.name, "builderharness-client");
  assert.equal(typeof exported.apply, "function");
  assert.ok(exported.inject.includes("sidebarRightTabs"));
}

function startMcp(root) {
  const child = spawn(process.execPath, [mcpServer], {
    env: { ...process.env, BUILDERHARNESS_ROOT: root },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  let nextId = 1;
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const message = JSON.parse(line);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { child, request, rl };
}

async function testMcp(root) {
  const { child, request, rl } = startMcp(root);
  const initialized = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "spike-test", version: "0.0.0" },
  });
  assert.equal(initialized.serverInfo.name, "builderharness-mcp");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const list = await request("tools/list");
  assert.deepEqual(
    list.tools.map((tool) => tool.name).sort(),
    ["builderharness_context", "builderharness_publish_plan", "builderharness_review_open", "builderharness_status"],
  );

  const called = await request("tools/call", {
    name: "builderharness_review_open",
    arguments: {},
  });
  assert.equal(called.isError, undefined);
  const reviews = JSON.parse(called.content[0].text);
  assert.equal(reviews.comments.length, 1);
  assert.equal(reviews.comments[0].id, "c1");

  const context = await request("tools/call", {
    name: "builderharness_context",
    arguments: { topic: "import", limit: 5 },
  });
  const contextValue = JSON.parse(context.content[0].text);
  assert.equal(contextValue.files.length, 1);
  assert.equal(contextValue.files[0].file, "guides/import.md");

  const taskContext = await request("tools/call", {
    name: "builderharness_context",
    arguments: { task: "import", files: ["docs/kb/guides/import.md"], maxChars: 2000, maxScan: 100 },
  });
  assert.equal(taskContext.isError, undefined);
  const evidence = JSON.parse(taskContext.content[0].text);
  assert.ok(evidence.sources.some((source) => source.file === "docs/kb/guides/import.md"));
  assert.ok(evidence.coverage.chars <= 2000);
  assert.ok(evidence.sources.every((source) => source.verifiedBehavior === false));

  child.stdin.end();
  rl.close();
  await new Promise((resolve) => child.once("exit", resolve));
}

const root = await fixture();
try {
  await testManifest();
  await testCore(root);
  await testPrototypeDetection();
  await testContentService(root);
  await testReviewWrites(root);
  await testDshPlugin(root);
  await testClientBundle();
  await testMcp(root);
  console.log("✓ integration spike checks passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
