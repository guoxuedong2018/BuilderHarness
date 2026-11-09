import { promises as fs } from "node:fs";
import path from "node:path";

import { loadAdapter } from "../pipeline/lib/adapter.mjs";
import { SELECTOR_HELPER } from "../pipeline/lib/cdp.mjs";
import { DOCS_DIR, FEATURES_DIR, KIT_ROOT, PROJECT_CONFIG, REPO_ROOT } from "../pipeline/lib/paths.mjs";

/**
 * 宣传物料 · 开发态服务
 * ------------------------------------------------------------------
 * 物料的画面页（合成页）要把**活的原型**嵌进来、读它元素的实时位置、在它上面拨时间，
 * 所以必须和原型同源——由 dev 服务伺服，而不是另起一个静态服务。只在 `vite dev` 挂载。
 *
 *   GET /__promo/kit/<文件>        promo/ 下的画面工具（kit.js、clock.js）
 *   GET /__promo/config            选择器引擎、字段定位与状态注入（与截图、录屏、示范录制同一份，取自适配器）
 *   GET /__promo/frs/<需求>         需求件套的标题、状态与截图配方（场景的开场状态复用 PRD 截图配方）
 *   GET /__promo/fixture?path=     需求件套 fixtures/ 下的示例文件（上传类场景的道具）
 *   GET /__promo/<物料>/<文件>      docs/promo/<物料>/ 下的素材；目录里只有 scenes.js 时，给一张通用的舞台页
 *
 * 另外：原型页面的地址带 `clock` 时，在 <head> 最前面插入虚拟时钟（clock.js），
 * 抢在产品的任何脚本之前接管时间。这样内置浏览器里直接打开合成页就能预览，
 * 渲染器逐帧拨时间截图也不用自己往页面里塞脚本。
 */

const PREFIX = "/__promo";
const KIT_DIR = path.join(KIT_ROOT, "promo");
const PROMO_DIR = path.join(DOCS_DIR, "promo");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

function inside(dir, rel) {
  const abs = path.resolve(dir, rel);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

async function sendFile(res, abs, root) {
  try {
    if (!inside(await fs.realpath(root), await fs.realpath(abs))) {
      throw new Error("Symlink assets are unavailable");
    }
    const body = await fs.readFile(abs);
    res.setHeader("content-type", MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}

const CLOCK_RE = /[?&]clock(=|&|$)/;

export function promoServer() {
  return {
    name: "builderharness:promo-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith(PREFIX + "/")) return next();
        if (req.method !== "GET") { res.statusCode = 405; return res.end(); }
        const u = new URL(url, "http://localhost");
        let rest;
        try { rest = decodeURIComponent(u.pathname.slice(PREFIX.length + 1)); }
        catch { res.statusCode = 400; return res.end("Invalid path"); }
        if (rest.split("/").some((part) => part === ".." || part.startsWith(".")) || rest.includes("\\")) {
          res.statusCode = 400;
          return res.end("Invalid path");
        }

        if (rest === "config") {
          const adapter = await loadAdapter();
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ selectorHelper: SELECTOR_HELPER, fieldSelector: adapter.fieldSelector ?? null, stateInjector: adapter.stateInjector ?? "", routeMode: PROJECT_CONFIG.routeMode ?? "hash" }));
        }
        if (rest.startsWith("kit/")) {
          const abs = inside(KIT_DIR, rest.slice(4));
          return abs ? sendFile(res, abs, KIT_DIR) : next();
        }
        // 需求件套：标题、状态与截图配方（场景的开场状态直接用 PRD 截图那一份配方，事实只有一处）
        if (rest.startsWith("frs/")) {
          const key = rest.slice(4).replace(/\/$/, "");
          const abs = /^[A-Za-z0-9_-]+$/.test(key) && inside(FEATURES_DIR, path.join(key, "FRS.json"));
          if (!abs) return next();
          try {
            if (!inside(await fs.realpath(FEATURES_DIR), await fs.realpath(abs))) throw new Error("Invalid feature path");
            const frs = JSON.parse(await fs.readFile(abs, "utf8"));
            res.setHeader("content-type", "application/json; charset=utf-8");
            return res.end(JSON.stringify({ key, title: frs.title, status: frs.status, shots: frs.shots || {} }));
          } catch {
            res.statusCode = 404;
            return res.end("not found");
          }
        }
        // 需求件套里的示例文件（fixtures/）：上传类场景的道具，都是合成数据
        if (rest === "fixture") {
          const rel = u.searchParams.get("path") || "";
          const abs = inside(REPO_ROOT, rel);
          if (!abs || !/^docs\/features\/[^/]+\/fixtures\//.test(rel)) {
            res.statusCode = 403;
            return res.end("只给需求件套 fixtures/ 下的文件");
          }
          return sendFile(res, abs, FEATURES_DIR);
        }
        // /__promo/<物料>/：有自己的 index.html 就用它，否则给通用舞台页（读同目录的 scenes.js）
        if (rest.endsWith("/") || !path.extname(rest)) {
          const dir = inside(PROMO_DIR, rest);
          if (!dir || !(await fs.stat(dir).then((stat) => stat.isDirectory(), () => false))) return next();
          const own = path.join(dir, "index.html");
          if (await fs.access(own).then(() => true, () => false)) return sendFile(res, own, PROMO_DIR);
          return sendFile(res, path.join(KIT_DIR, "stage.html"), KIT_DIR);
        }
        const abs = inside(PROMO_DIR, rest);
        return abs ? sendFile(res, abs, PROMO_DIR) : next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!CLOCK_RE.test(ctx.originalUrl || "")) return html;
        return [{ tag: "script", attrs: { src: `${PREFIX}/kit/clock.js` }, injectTo: "head-prepend" }];
      },
    },
  };
}
