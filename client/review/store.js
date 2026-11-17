import { proxy } from "valtio";
import { migrateAnchor } from "./anchor";

/**
 * 评审运行时状态
 * ------------------------------------------------------------------
 * 刻意不放进产品的状态树：评审层要能整体剥离，不能和生产代码缠在一起。
 * 用 valtio 的 proxy 承载：直接改字段，读它的组件（useSnapshot）自动重绘。
 *
 * 落盘依赖 vite dev 中间件（server/review-server.js）。构建/预览环境下接口不可用，
 * 会优雅降级为「会话内存」模式（persistent=false），刷新后评论丢失。
 *
 * @typedef {{ author: string, body: string, at: string }} CommentReply
 * @typedef {{
 *   id: string,
 *   frs: string,
 *   route: string,
 *   anchor: import("./anchor").CommentAnchor,
 *   body: string,
 *   author: string,
 *   status: "open" | "resolved",
 *   createdAt: string,
 *   replies: CommentReply[]
 * }} ReviewComment
 */

const API = "/__proto_review";
const AUTHOR_KEY = "proto-review-author";

function readAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) || "PM";
  } catch {
    return "PM";
  }
}

export const reviewState = proxy({
  commentMode: false,
  drawerOpen: false,
  /** @type {ReviewComment[]} */
  comments: [],
  /** 是否已连上 dev 落盘服务 */
  persistent: false,
  memoryOnly: false,
  /** @type {string | null} */
  activeCommentId: null,
  author: readAuthor(),
  /** 当前路由，由宿主适配层的 router.subscribe 同步进来 */
  route: "/",
});

export function newReviewId() {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `c_${id}`;
}

const hydrate = (comment) => ({
  ...comment,
  anchor: migrateAnchor(comment.anchor),
  replies: Array.isArray(comment.replies) ? comment.replies : [],
});
let readSequence = 0;

export async function loadAll() {
  const sequence = ++readSequence;
  try {
    const r = await fetch(`${API}/all`);
    const missing = r.status === 404 || (r.ok && r.headers.get("content-type")?.includes("text/html"));
    if (sequence !== readSequence) return;
    if (missing) {
      reviewState.memoryOnly = true;
      reviewState.persistent = false;
      return;
    }
    if (!r.ok) throw new Error("Could not load reviews");
    const { comments } = await r.json();
    if (sequence !== readSequence) return;
    reviewState.comments = (comments ?? []).filter(Boolean).map(hydrate);
    reviewState.memoryOnly = false;
    reviewState.persistent = true;
  } catch {
    if (sequence === readSequence) reviewState.persistent = false;
  }
}

async function write(action, body) {
  const response = await fetch(`${API}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => { throw new Error("请检查开发服务后重试"); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.error || "请检查开发服务后重试");
  ++readSequence; // An earlier GET must not replace a newly saved comment.
  reviewState.persistent = true;
  return data.comment;
}

export function setRoute(path) {
  if (reviewState.route === path) return;
  reviewState.route = path;
}

export function setAuthor(name) {
  reviewState.author = name;
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function showComment(comment) {
  const index = reviewState.comments.findIndex((item) => item.id === comment.id);
  if (index >= 0) reviewState.comments.splice(index, 1, comment);
  else reviewState.comments.push(comment);
}

export async function addComment({ id, frs, anchor, body, route = reviewState.route }) {
  /** @type {ReviewComment} */
  const c = {
    id,
    frs,
    route,
    anchor,
    body: body.trim(),
    author: reviewState.author.trim() || "PM",
    status: "open",
    createdAt: new Date().toISOString(),
    replies: [],
  };
  showComment(reviewState.memoryOnly ? c : hydrate(await write("create", c)));
  reviewState.activeCommentId = c.id;
  return c;
}

export async function updateComment(c, { status, reply }) {
  if (reviewState.memoryOnly) {
    showComment({ ...c, ...(status && { status }), ...(reply && { replies: [...c.replies, reply] }) });
    return;
  }
  showComment(hydrate(await write("update", { id: c.id, frs: c.frs, status, reply })));
}

export async function removeComment(c) {
  if (!reviewState.memoryOnly) await write("delete", { id: c.id, frs: c.frs });
  reviewState.comments = reviewState.comments.filter((x) => x.id !== c.id);
}

