import { promises as fs } from "node:fs";
import path from "node:path";

import { listDecisions, readDecisions, submitDecision, withdrawDecision } from "../pipeline/lib/decisions.mjs";
import { REVIEWS_DIR } from "../pipeline/lib/paths.mjs";
import { editReviews, readComments, reviewFile } from "../integrations/host/src/review-files.mjs";
import { isReviewWrite } from "../integrations/host/src/review-request.mjs";

/**
 * 原型评审 · 开发态评论服务
 * ------------------------------------------------------------------
 * 仅在 `vite dev`（apply: "serve"）时挂载，为前端评审工具提供读写落盘能力：
 *   GET  /__proto_review/all      读取全部评论（合并 docs/reviews/*.json）
 *   POST /__proto_review/create   创建批注，重试复用已保存的记录
 *   POST /__proto_review/update   更新状态或追加回复
 *   POST /__proto_review/upsert   兼容旧版整条更新
 *   POST /__proto_review/delete   删除一条评论
 *
 * 评论按需求区域分文件存储：docs/reviews/<REGION>.json。
 * 这些 JSON 默认被版本控制忽略；生产构建（build/preview）不挂载此服务。
 */

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object");
  return body;
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

const prefix = "/__proto_review/";
const commentActions = new Set(["create", "upsert", "update", "delete"]);

function validUpdate({ status, reply }) {
  if (status !== undefined && !["open", "resolved"].includes(status)) return false;
  if (reply === undefined) return status !== undefined;
  return reply && [reply.id, reply.author, reply.body, reply.at].every((value) => typeof value === "string" && value.trim());
}

async function writeComment(dir, action, body) {
  return editReviews(reviewFile(dir, body.frs), (comments) => {
    const index = comments.findIndex((item) => item?.id === body.id);
    if (action === "delete") {
      if (index >= 0) comments.splice(index, 1);
      return null;
    }
    if (action === "update") {
      const comment = comments[index];
      if (!comment) return null;
      if (body.status !== undefined) comment.status = body.status;
      if (body.reply) {
        if (!Array.isArray(comment.replies)) comment.replies = [];
        if (!comment.replies.some((reply) => reply?.id === body.reply.id)) comment.replies.push(body.reply);
      }
      return comment;
    }
    if (index < 0) comments.push(body);
    else if (action === "upsert") comments[index] = body;
    return index < 0 ? body : comments[index];
  });
}

export function reviewServer({ reviewsDir = REVIEWS_DIR } = {}) {
  const storeDir = reviewsDir;
  return {
    name: "builderharness:review-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith(prefix)) return next();

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
          if (req.method === "POST" && !isReviewWrite(req)) {
            return sendJson(res, 403, { error: "请从当前原型页面提交批注或决定" });
          }
          const action = requestUrl.pathname.slice(prefix.length);
          if (req.method === "POST" && ["decisions/submit", "decisions/withdraw"].includes(action)) {
            const body = await readBody(req).catch(() => null);
            if (!body) return sendJson(res, 400, { error: "无效的请求内容" });
            try {
              const result = requestUrl.pathname.endsWith("/withdraw")
                ? await withdrawDecision(body.key, body.id, body.author) : await submitDecision(body.key, body);
              return sendJson(res, 200, result);
            }
            catch (error) { return sendJson(res, 409, { error: error.message }); }
          }
          if (req.method === "GET" && action === "all") {
            const files = await fs.readdir(storeDir).catch((error) => {
              if (error.code === "ENOENT") return [];
              throw error;
            });
            const comments = [];
            const skipped = [];
            for (const f of files) {
              if (!f.endsWith(".json")) continue;
              try {
                comments.push(...await readComments(path.join(storeDir, f)));
              } catch (err) {
                skipped.push({ file: f, error: err instanceof Error ? err.message : String(err) });
              }
            }
            return sendJson(res, 200, { comments, skipped });
          }

          if (req.method === "POST" && commentActions.has(action)) {
            const body = await readBody(req).catch(() => null);
            if (typeof body?.id !== "string" || !body.id.trim() || (action === "update" && !validUpdate(body))) {
              return sendJson(res, 400, { error: "无效的批注请求" });
            }
            const comment = await writeComment(storeDir, action, body);
            if (action === "update" && !comment) return sendJson(res, 404, { error: "这条批注已不存在，请刷新页面" });
            return sendJson(res, 200, { ok: true, ...(comment && { comment }) });
          }

          return sendJson(res, 404, { error: "not found" });
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
