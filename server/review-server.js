import { promises as fs } from "node:fs";
import path from "node:path";

import { listDecisions, readDecisions, submitDecision, withdrawDecision } from "../pipeline/lib/decisions.mjs";
import { REVIEWS_DIR } from "../pipeline/lib/paths.mjs";

/**
 * 原型评审 · 开发态评论服务
 * ------------------------------------------------------------------
 * 仅在 `vite dev`（apply: "serve"）时挂载，为前端评审工具提供读写落盘能力：
 *   GET  /__proto_review/all      读取全部评论（合并 docs/reviews/*.json）
 *   POST /__proto_review/upsert   新增/更新一条评论，按 frs 归档到 <FRS>.json
 *   POST /__proto_review/delete   删除一条评论
 *
 * 评论按需求区域分文件存储：docs/reviews/<REGION>.json。
 * 这些 JSON 默认被版本控制忽略；生产构建（build/preview）不挂载此服务。
 */

const DEFAULT_REVIEWS_DIR = REVIEWS_DIR;

function fileForFrs(dir, frs) {
  const safe = String(frs || "APP_SHELL").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dir, `${safe}.json`);
}

async function readArray(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`评论文件损坏，拒绝覆盖：${file}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.comments)) return parsed.comments;
  throw new Error(`评论文件格式不认识，拒绝覆盖：${file}`);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

export function reviewServer({ reviewsDir = DEFAULT_REVIEWS_DIR } = {}) {
  const storeDir = reviewsDir;
  return {
    name: "builderharness:review-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/__proto_review")) return next();

        try {
          const requestUrl = new URL(url, "http://localhost");
          if (requestUrl.pathname === "/__proto_review/decisions" && req.method === "GET") {
            res.statusCode = 302;
            res.setHeader("location", "/__decide/" + requestUrl.search);
            return res.end();
          }
          if (requestUrl.pathname === "/__proto_review/decisions/data" && req.method === "GET") {
            const key = requestUrl.searchParams.get("key");
            const items = key ? await readDecisions(key) : [];
            return sendJson(res, 200, { features: key ? (items.length ? [{ key, items }] : []) : await listDecisions() });
          }
          if (["/submit", "/withdraw"].some((action) => requestUrl.pathname === "/__proto_review/decisions" + action) && req.method === "POST") {
            const origin = req.headers.origin;
            if ((origin && new URL(origin).host !== req.headers.host) ||
                !req.headers["content-type"]?.startsWith("application/json")) {
              return sendJson(res, 403, { error: "Submit decisions from the local review page" });
            }
            const body = await readBody(req);
            try {
              const result = requestUrl.pathname.endsWith("/withdraw")
                ? await withdrawDecision(body.key, body.id, body.author) : await submitDecision(body.key, body);
              return sendJson(res, 200, result);
            }
            catch (error) { return sendJson(res, 409, { error: error.message }); }
          }
          await fs.mkdir(storeDir, { recursive: true });

          if (req.method === "GET" && url.startsWith("/__proto_review/all")) {
            const files = await fs.readdir(storeDir).catch(() => []);
            const comments = [];
            const skipped = [];
            for (const f of files) {
              if (!f.endsWith(".json")) continue;
              try {
                comments.push(...(await readArray(path.join(storeDir, f))));
              } catch (err) {
                skipped.push({ file: f, error: err instanceof Error ? err.message : String(err) });
              }
            }
            return sendJson(res, 200, { comments, skipped });
          }

          if (req.method === "POST" && url.startsWith("/__proto_review/upsert")) {
            const body = await readBody(req);
            const id = body.id;
            const frs = body.frs ?? "APP_SHELL";
            if (!id) return sendJson(res, 400, { error: "missing id" });
            const file = fileForFrs(storeDir, frs);
            const arr = await readArray(file);
            const idx = arr.findIndex((x) => x && x.id === id);
            if (idx >= 0) arr[idx] = body;
            else arr.push(body);
            await fs.writeFile(file, `${JSON.stringify(arr, null, 2)}\n`, "utf8");
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === "POST" && url.startsWith("/__proto_review/delete")) {
            const body = await readBody(req);
            const frs = body.frs ?? "APP_SHELL";
            const file = fileForFrs(storeDir, frs);
            const arr = await readArray(file);
            const nextArr = arr.filter((x) => !x || x.id !== body.id);
            await fs.writeFile(file, `${JSON.stringify(nextArr, null, 2)}\n`, "utf8");
            return sendJson(res, 200, { ok: true });
          }

          return sendJson(res, 404, { error: "not found" });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
