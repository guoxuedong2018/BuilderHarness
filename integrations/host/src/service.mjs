import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { addReview, readContext, readOpenReviews, readPublishPlan, readStatus, resolveReview } from "./project.mjs";
import { readEnv } from "./env.mjs";
import { resolveKitRoot, runKit } from "./kit.mjs";
import { detectPrototype, detectStack, devCommand, installCommand } from "./prototype.mjs";
import { isReviewWrite } from "./review-request.mjs";

const prototypeProcesses = new Map();

function featureStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function featureSlug(title) {
  const ascii = String(title || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "FEATURE";
}

async function copyDirectory(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDirectory(src, dst);
    else if (entry.isFile()) await fs.copyFile(src, dst);
  }
}

async function readSettings(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, ".builderharness", "desktop.json"), "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(root, patch) {
  const current = await readSettings(root);
  const next = { ...current, ...patch };
  await fs.mkdir(path.join(root, ".builderharness"), { recursive: true });
  await fs.writeFile(path.join(root, ".builderharness", "desktop.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function createFeature(root, title) {
  const project = path.resolve(root);
  const safeTitle = String(title || "").trim();
  if (!safeTitle) throw new Error("先填功能名称。");
  const key = `${featureStamp()}_${featureSlug(safeTitle)}`;
  const featureDir = path.join(project, "docs", "features", key);
  try {
    await fs.access(featureDir);
    throw new Error(`需求件套已存在：${path.relative(project, featureDir)}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const kitRoot = await resolveKitRoot(project);
  const templates = (await fs.access(path.join(project, "docs", "templates")).then(() => true, () => false))
    ? path.join(project, "docs", "templates")
    : path.join(kitRoot, "docs", "templates");
  await copyDirectory(templates, featureDir);
  const replace = async (name) => {
    const file = path.join(featureDir, name);
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      text
        .replaceAll("<功能名称>", safeTitle)
        .replaceAll("<ID>_MODULE_NAME", key)
        .replaceAll("MMDDHHMM_MODULE_NAME", key)
        .replaceAll("YYYY-MM-DD", new Date().toISOString().slice(0, 10)),
    );
  };
  for (const name of ["README.md", "FLOW.md", "STATE.md", "ACCEPTANCE.md"]) await replace(name);
  const frsFile = path.join(featureDir, "FRS.json");
  const frs = JSON.parse(await fs.readFile(frsFile, "utf8"));
  frs.key = key;
  frs.title = safeTitle;
  frs.createdAt = new Date().toISOString().slice(0, 10);
  frs.updatedAt = frs.createdAt;
  await fs.writeFile(frsFile, `${JSON.stringify(frs, null, 2)}\n`);
  return { key, relativePath: path.relative(project, featureDir), checkCommand: `npx builderharness check-frs ${key}` };
}

/**
 * Dev servers print `localhost` but often bind only `::1`. Browsers refuse to
 * frame a loopback alias that differs from the page host, so every prototype is
 * served through a same-host proxy that also forwards the HMR WebSocket.
 */
function startPreviewProxy(target) {
  const upstream = new URL(target);
  const host = upstream.hostname.replace(/^\[|\]$/g, "");
  const port = Number(upstream.port || (upstream.protocol === "https:" ? 443 : 80));

  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: upstream.host };
    if (req.method === "POST" && req.url?.startsWith("/__proto_review/")) {
      if (!isReviewWrite(req)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "请从当前原型页面提交批注或决定" }));
      }
      // Only translate an origin already verified against the public preview URL.
      if (headers.origin) headers.origin = upstream.origin;
    }
    const proxyReq = http.request(
      { host, port, path: req.url, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("原型服务暂时不可用");
    });
    req.pipe(proxyReq);
  });

  server.on("upgrade", (req, socket, head) => {
    const upstreamSocket = net.connect(port, host, () => {
      const headers = { ...req.headers, host: upstream.host };
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(headers)) raw += `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`;
      upstreamSocket.write(`${raw}\r\n`);
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port_ = typeof address === "object" && address ? address.port : null;
      if (!port_) {
        server.close();
        reject(new Error("无法为原型分配代理端口。"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${port_}/` });
    });
  });
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text) {
  return text.replace(ANSI, "");
}

function runPrototypeCommand(command, args, cwd) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function installPrototype(root) {
  const detected = await detectPrototype(root);
  if (!detected.found) throw new Error(detected.reason);
  if (detected.installed) return { ok: true, dir: detected.dir, installed: true, reused: true, packageManager: detected.packageManager };
  const { command, args } = installCommand(detected.packageManager);
  return new Promise((resolve, reject) => {
    const child = runPrototypeCommand(command, args, detected.absoluteDir);
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} ${args.join(" ")} 超过 5 分钟未完成：\n${output.slice(-4000)}`));
    }, 5 * 60_000);
    const collect = (chunk) => {
      output += stripAnsi(chunk.toString());
      if (output.length > 20_000) output = output.slice(-20_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, dir: detected.dir, installed: true, reused: false, packageManager: detected.packageManager });
      else reject(new Error(`${command} ${args.join(" ")} 退出（${code}）：\n${output.slice(-4000)}`));
    });
  });
}

function stopPrototype(root) {
  const key = path.resolve(root);
  const running = prototypeProcesses.get(key);
  if (!running) return { ok: true, stopped: false };
  running.child.kill();
  running.proxy?.close();
  prototypeProcesses.delete(key);
  return { ok: true, stopped: true };
}

function stopAllPrototypes() {
  for (const running of prototypeProcesses.values()) {
    running.child.kill();
    running.proxy?.close();
  }
  prototypeProcesses.clear();
}

async function startPrototype(root) {
  const cwd = path.resolve(root);
  const existing = prototypeProcesses.get(cwd);
  if (existing?.url) return { ok: true, url: existing.url, reused: true };
  const detected = await detectPrototype(cwd);
  if (!detected.found) throw new Error(detected.reason);
  if (!detected.installed) throw new Error(detected.reason);
  const { command, args } = devCommand(detected.packageManager, "dev");
  const child = runPrototypeCommand(command, args, detected.absoluteDir);
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`dev server 没有在 25 秒内输出 URL：\n${output}`));
    }, 25_000);
    const onData = (chunk) => {
      output += stripAnsi(chunk.toString());
      const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[[^\]]+\]):\d+\/?/i);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      startPreviewProxy(match[0]).then(
        ({ server, url }) => {
          prototypeProcesses.set(cwd, { child, url, target: match[0], proxy: server, dir: detected.dir });
          resolve({ ok: true, url, target: match[0], reused: false, dir: detected.dir, devScript: detected.devScript });
        },
        () => {
          prototypeProcesses.set(cwd, { child, url: match[0], target: match[0], dir: detected.dir });
          resolve({ ok: true, url: match[0], target: match[0], reused: false, dir: detected.dir, devScript: detected.devScript });
        },
      );
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("exit", (code) => {
      const running = prototypeProcesses.get(cwd);
      running?.proxy?.close();
      prototypeProcesses.delete(cwd);
      if (!settled && code) {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`dev server 退出（${code}）：\n${output}`));
      }
    });
  });
}

function pageRef(page) {
  const rel = String(page || "").replace(/^\/+/, "");
  if (!rel || rel.includes("\0") || rel.split("/").includes("..") || !rel.endsWith(".md")) {
    throw new Error("page 必须是 docs/kb 下的 .md 相对路径，例如 guide/intro.md");
  }
  return rel;
}

function summarizeStatus(data) {
  return {
    summary: data.summary,
    review: (data.review || []).map((file) => ({
      path: file.path,
      title: file.title,
      open: file.open,
      reviewedAt: file.reviewedAt,
      refs: (file.refs || [])
        .filter((ref) => ref.state !== "ok" && !ref.unverified)
        .map((ref) => ({ id: ref.id, type: ref.type, line: ref.line, state: ref.state, reason: ref.reason })),
    })),
    following: (data.following || []).map((file) => ({ path: file.path, title: file.title, open: file.open })),
    backlog: (data.backlog || []).map((file) => ({ path: file.path, title: file.title })),
    planning: (data.planning || []).map((file) => ({ path: file.path, title: file.title, unfilled: file.unfilled })),
  };
}

/**
 * The BuilderHarness domain service. Keeping workspace access here lets tools,
 * HTTP routes, and future UI packages share one contract instead of each
 * reading docs/kb directly.
 */
export function createBuilderHarnessService() {
  return {
    name: "builderharness",

    async baseline(root) {
      const settings = await readSettings(root);
      return {
        stack: settings.stack ?? null,
        uiPreset: settings.uiPreset ?? null,
        sourceUrl: settings.sourceUrl ?? null,
        detected: await detectStack(root),
      };
    },

    saveBaseline(root, { stack, uiPreset, sourceUrl = null }) {
      return writeSettings(root, { stack, uiPreset, sourceUrl });
    },

    async status(root) {
      const data = await readStatus(root);
      const running = prototypeProcesses.get(path.resolve(data.root));
      return {
        ...data,
        prototype: {
          ...data.prototype,
          url: running?.url ?? null,
        },
      };
    },

    context(root, options) {
      return readContext(root, options);
    },

    reviews(root) {
      return readOpenReviews(root);
    },

    addReview(root, options) {
      return addReview(root, options);
    },

    resolveReview(root, options) {
      return resolveReview(root, options);
    },

    async contentStatus(root) {
      const result = await runKit(root, ["kb", "status", "--json"]);
      const data = JSON.parse(result.stdout);
      return {
        root: result.root,
        lock: "docs/kb/_lock.json",
        ...summarizeStatus(data),
      };
    },

    async contentConfirm(root, { page, refs = [] } = {}) {
      const rel = pageRef(page);
      const ids = (Array.isArray(refs) ? refs : [refs]).filter(Boolean).map(String);
      const result = await runKit(root, ["kb", "ack", rel, ...ids]);
      return {
        ok: true,
        page: rel,
        refs: ids,
        root: result.root,
        output: result.stdout.trim(),
      };
    },

    publishPlan(root) {
      return readPublishPlan(root);
    },

    createFeature(root, title) {
      return createFeature(root, title);
    },

    async checkFrs(root) {
      const result = await runKit(root, ["check-frs"]);
      return { ok: true, root: result.root, output: result.stdout.trim() };
    },

    startPrototype(root) {
      return startPrototype(root);
    },

    installPrototype(root) {
      return installPrototype(root);
    },

    stopPrototype(root) {
      return stopPrototype(root);
    },

    stopAllPrototypes() {
      stopAllPrototypes();
    },

    async publishDryRun(root) {
      const result = await runKit(root, ["kb-publish", "--dry-run"], { timeout: 5 * 60_000 });
      return { ok: true, root: result.root, output: result.stdout.trim() };
    },

    async captureMedia(root, { kind = "shot", only = [] } = {}) {
      const keys = (Array.isArray(only) ? only : [only]).filter(Boolean).map(String);
      const command = kind === "clip" ? "record-kb-clips" : "capture-kb-shots";
      if (!["shot", "clip"].includes(kind)) throw new Error("kind 必须是 shot 或 clip");
      const args = [command];
      for (const key of keys) args.push("--only", key);
      const result = await runKit(root, args, { timeout: 15 * 60_000 });
      return {
        ok: true,
        kind,
        keys,
        root: result.root,
        output: result.stdout.trim(),
      };
    },
  };
}
