/**
 * Reference destination adapter: docs-cli
 * ------------------------------------------------------------------
 * This is one concrete publisher, not the BuilderHarness core. It talks to an
 * external document CLI through a small JSON protocol (create / write /
 * fetch-jsonml / update-jsonml / append-image / source-upload / list-wiki).
 *
 *   BUILDERHARNESS_DOCS_CLI="docs-cli"          # default command prefix
 *   BUILDERHARNESS_DOCS_CLI="npx my-docs-cli"   # any shell command prefix
 *
 * The protocol is JSON-in / JSON-out:
 *
 *   { "ok": true, "data": … }   success
 *   { "ok": false, "error": … } failure
 *
 * A business that publishes somewhere else writes its own adapter and points
 * `BUILDERHARNESS_PUBLISH_GATEWAY` at it; the publishing workflow (plan, state,
 * retries, review UI) stays in the kit. See `docs/publishing.md`.
 *
 * ## Retry boundary
 *
 * Only idempotent operations are retried automatically. `word +create` is not
 * idempotent: a timeout may mean it succeeded, and retrying can create a
 * duplicate document. Such operations fail loudly; callers persist progress
 * and can resume safely.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Per-call timeout. Creating a page with a zip upload is the slowest case. */
const DEFAULT_TIMEOUT_MS = 150_000;
const SCRIPT_DIR = path.join(os.tmpdir(), "builderharness-docs-gateway");
const RETRIABLE = /\b401\b|unauthorized|session expired|timeout/i;
const ENV = process.env;

/** Command prefix; everything after it is the documented `word` protocol. */
const DOCS_CLI = readEnv("DOCS_CLI") || "docs-cli";

/** Metadata the studio can show without knowing the destination. */
export const destination = {
  id: "docs-cli",
  label: "外部文档",
  description: "长文文档参考适配器：通过可配置的 docs CLI 写入外部文档服务。",
  capabilities: ["document"],
};

/** Human-readable URL for a page. The core only passes opaque ids through. */
export function buildPageUrl({ base, viewId, docId }) {
  return `${String(base).replace(/\/+$/, "")}/${viewId}/${docId}`;
}

/** Turn the core's source descriptor into the CLI's file/zip arguments. */
function sourceArg(source) {
  if (source?.kind === "file" && source.path) return `--content-file ${shellQuote(source.path)}`;
  if (source?.kind === "zip" && source.path) return `--content-zip ${shellQuote(source.path)}`;
  throw new Error("docs-cli 发布目标只接受 { kind: 'file' | 'zip', path } 内容源");
}

/** Quote one dynamic value for the generated bash script. */
export function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

/** What the user confirmed in the publishing UI; kept for publisher implementations. */
let intent = "";
export function setIntent(text) {
  intent = String(text ?? "").trim();
}
export function getIntent() {
  return intent;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 可以原样再试一次的失败：超时、会话过期 */
const retriable = (message, flag) => {
  const err = new Error(message);
  err.retriable = flag;
  return err;
};

/**
 * Run one external document command.
 *
 * @param command        full command line, e.g. `docs-cli word +create --title "x" …`
 * @param idempotent     true when retrying cannot produce a side effect
 */
export async function call(command, { timeoutMs = DEFAULT_TIMEOUT_MS, idempotent = false, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= (idempotent ? retries : 0); attempt += 1) {
    if (attempt > 0) {
      const wait = 2000 * attempt;
      console.log(`    ↻ ${lastErr.message.slice(0, 60)}，${wait / 1000}s 后重试（第 ${attempt} 次）`);
      await sleep(wait);
    }
    try {
      return await once(command, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!err.retriable && !RETRIABLE.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

/**
 * Write the command into a script file, then execute it. This avoids shell
 * quoting problems with long titles, paths and ids, and keeps stdout separate
 * from diagnostics.
 */
async function writeScript(command) {
  await fs.mkdir(SCRIPT_DIR, { recursive: true });
  const id = randomUUID().slice(0, 8);
  const script = path.join(SCRIPT_DIR, `cmd-${id}.sh`);
  const out = path.join(SCRIPT_DIR, `out-${id}.json`);
  await fs.writeFile(
    script,
    ["#!/bin/bash", `${command} > "${out}"`, `echo '{"ok":true,"data":{"ran":true}}'`, ""].join("\n"),
    { mode: 0o755 },
  );
  return { script, out };
}

/** 起一个进程，收齐输出。独立进程组：超时要连它拉起的 docs-cli 一起杀，否则孤儿进程会继续占着会话 */
function capture(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    let err = "";
    let done = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      reject(retriable(`调用超时（${Math.round(timeoutMs / 1000)}s 无响应）`, true));
    }, timeoutMs);
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`启动不了 ${cmd}：${e.message}`));
    });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/** 命令落进文件的 JSON 信封。没有这个文件或文件是空的，说明命令根本没跑起来 */
async function readEnvelope(file) {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    throw new Error(`JSON 解析失败：${text.slice(0, 200)}`);
  }
}

function settle(parsed) {
  if (parsed.ok === false) throw new Error(parsed.error?.message ?? JSON.stringify(parsed.error));
  return parsed.data ?? parsed;
}

async function once(command, timeoutMs) {
  const { script, out } = await writeScript(command);
  try {
    const { code, err } = await capture("bash", [script], timeoutMs);
    const parsed = await readEnvelope(out);
    if (parsed === null) {
      throw new Error(`document CLI did not return JSON (exit ${code}): ${err.slice(0, 200)}`);
    }
    return settle(parsed);
  } finally {
    await Promise.all([fs.rm(script, { force: true }), fs.rm(out, { force: true })]).catch(() => {});
  }
}

// ---------------------------------------------------------------- 具体操作
//
// 把命令行拼装收在这里，调用方不用记 `--position` 默认是追加、
// zip 与 file 只能二选一这类细节——那些都是踩过的坑。

/** 建文档。**不幂等**，不会自动重试 */
export async function createDoc({ title, source, parentViewId }) {
  const res = await call(
    `${DOCS_CLI} word +create --title ${shellQuote(title)} ${sourceArg(source)} --parent-view-id ${shellQuote(parentViewId)}`,
  );
  const r = res.result ?? res;
  return { docId: r.docId, viewId: r.shortcutId ?? r.viewId, url: r.openDocUrl };
}

/**
 * 整篇覆盖已有文档。
 *
 * `--position` 服务端默认是 `APPEND_TAIL`，不显式传就是往文末追加、
 * 内容会被写成双份——这里强制补上。
 */
export function writeDoc({ docId, source, position = "REPLACE_ALL" }) {
  return call(`${DOCS_CLI} word +write --doc-id ${shellQuote(docId)} ${sourceArg(source)} --position ${shellQuote(position)}`, {
    idempotent: true,
  });
}

/** 取目录大纲（小响应，不用走 capture wrapper），返回 `[{id, type, text}]` */
export async function fetchOutline(docId) {
  const res = await call(`${DOCS_CLI} word +fetch-jsonml --doc-id ${shellQuote(docId)} --view outline`, {
    idempotent: true,
  });
  return (res.result ?? res).items ?? [];
}

/** JsonML 局部更新。原子操作，失败整体回滚，所以可安全重试。dryRun 只让服务端核对、不落 */
export function updateJsonml({ docId, opsFile, dryRun = false }) {
  return call(`${DOCS_CLI} word +update-jsonml --doc-id ${shellQuote(docId)} --ops-file ${shellQuote(opsFile)}${dryRun ? " --dry-run" : ""}`, {
    idempotent: true,
  });
}

/** 整篇 JsonML，返回 `{ body, version, docId }` */
export async function fetchJsonml(docId) {
  const res = await call(`${DOCS_CLI} word +fetch-jsonml --doc-id ${shellQuote(docId)}`, { idempotent: true });
  return res.result ?? res;
}

/** 建一篇空文档（正文之后用 JsonML 写）；给了 folderId 就建在那个目录下。**不幂等**，不会自动重试 */
export async function createBlankDoc({ title, viewModel = "A3", folderId = null }) {
  const folderArg = folderId ? ` --folder-id ${shellQuote(folderId)}` : "";
  const res = await call(`${DOCS_CLI} word +create --title ${shellQuote(title)} --view-model ${shellQuote(viewModel)}${folderArg}`);
  const r = res.result ?? res;
  return { docId: r.docId, url: r.openDocUrl };
}

/**
 * 把图追到文末，换回 imageId（与 files 顺序一一对应）。**不幂等**：每次都产生新资源，失败如实抛。
 * 追上去的图是临时的，调用方要么整篇覆盖掉，要么自己删掉那几段
 */
export async function appendImages({ docId, files }) {
  const res = await call(`${DOCS_CLI} word +append-image --doc-id ${shellQuote(docId)} ${files.map((f) => `--image ${shellQuote(f)}`).join(" ")}`);
  const list = [res.appendedImages, res.result?.appendedImages].find(Array.isArray);
  if (!list) throw new Error("追图的返回里没有 appendedImages，确认命令是否成功");
  return list.map((x) => x.imageId);
}

/** 上传媒体资源，拿 blobStoreKey。**不幂等**（每次产生新资源），失败如实抛 */
export async function uploadSource({ docId, file, type = "image" }) {
  const res = await call(
    `${DOCS_CLI} +source-upload --doc-id ${shellQuote(docId)} --file ${shellQuote(file)} --type ${shellQuote(type)}`,
  );
  return (res.result ?? res).key;
}

/** 展开知识库节点 */
export async function listWiki(viewId) {
  const res = await call(`${DOCS_CLI} +list-wiki --view-id ${shellQuote(viewId)}`, { idempotent: true });
  return (res.result ?? res).items ?? [];
}
