import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECISION_STORE, readDecisions } from "../pipeline/lib/decisions.mjs";
import { countsOf, listFeatureDirs, loadFeature, resolveRef } from "../pipeline/lib/pending-list.mjs";
import { FEATURES_DIR } from "../pipeline/lib/paths.mjs";

const prefix = "/__decide";
const entry = fileURLToPath(new URL("../client/decide/main.jsx", import.meta.url));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuilderHarness · 待决清单</title></head><body>
<div id="bk-decide"></div><script type="module" src="/@fs/${entry.split(path.sep).join("/").replace(/^\//, "")}"></script>
</body></html>`;
const inside = (dir, file) => path.resolve(file).startsWith(dir + path.sep);
const send = (res, code, data) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
};

async function readFeature(key, dirs) {
  const feature = await loadFeature(key, dirs);
  if (!feature) return null;
  const rows = new Map((await readDecisions(key, feature.md)).map((row) => [row.id, row]));
  for (const item of feature.groups.flatMap((group) => group.items)) {
    const row = rows.get(item.id);
    item.version = row.version;
    item.status = { open: "pending", recorded: "decided" }[row.status] ?? row.status;
    const submission = row.submission;
    item.submissions = submission && !submission.closedAt ? [{
      ...submission, frs: key, createdAt: submission.submittedAt,
      changed: submission.version !== row.version,
      action: { confirm: "decide", return: "reject" }[submission.action] ?? submission.action,
    }] : [];
  }
  return feature;
}

export function decideServer() {
  return {
    name: "builderharness:decisions",
    apply: "serve",
    configureServer(server) {
      let watching = false;
      let timer;
      const onChange = (_, file) => {
        if (!(inside(FEATURES_DIR, file) && file.endsWith("README.md")) &&
            !(inside(DECISION_STORE, file) && file.endsWith(".json"))) return;
        clearTimeout(timer);
        timer = setTimeout(() => server.ws.send({ type: "custom", event: "bk-decide:changed" }), 150);
      };
      server.httpServer?.once("close", () => clearTimeout(timer));
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) return next();
        if (req.method !== "GET") return send(res, 405, { error: "GET required" });
        try {
          if (url.pathname === prefix || url.pathname === prefix + "/") {
            if (!watching) {
              watching = true;
              server.watcher.add([FEATURES_DIR, DECISION_STORE]);
              server.watcher.on("all", onChange);
            }
            const page = await server.transformIndexHtml(url.pathname, html);
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.setHeader("cache-control", "no-store");
            return res.end(page);
          }
          const dirs = await listFeatureDirs();
          if (url.pathname === prefix + "/api/features") {
            const summaries = [];
            for (const key of dirs) {
              const f = await readFeature(key, dirs);
              if (!f?.groups.some((group) => group.items.length)) continue;
              const open = f.groups.flatMap((g) => g.items)
                .filter((item) => !["decided", "submitted"].includes(item.status))
                .map(({ id, group, blocking, qualifier, status, question, why }) => ({ id, group, blocking, qualifier, status, question, why }));
              summaries.push({ key, title: f.title || key, counts: countsOf(f.groups), open });
            }
            summaries.sort((a, b) => b.counts.blocking - a.counts.blocking || b.open.length - a.open.length || a.key.localeCompare(b.key));
            return send(res, 200, { features: summaries });
          }
          if ([prefix + "/api/feature", prefix + "/api/ref"].includes(url.pathname)) {
            const f = await readFeature(url.searchParams.get("key"), dirs);
            if (!f) return send(res, 404, { error: "Decision list not found" });
            if (url.pathname.endsWith("/feature")) {
              return send(res, 200, { key: f.key, title: f.title || f.key, file: f.file, intro: f.intro, counts: countsOf(f.groups), groups: f.groups });
            }
            const ref = await resolveRef(f, url.searchParams.get("kind"), url.searchParams.get("target"));
            return ref ? send(res, 200, ref) : send(res, 404, { error: "Source reference not found" });
          }
          return send(res, 404, { error: "Unknown decision endpoint" });
        } catch (error) {
          return send(res, 500, { error: error.message });
        }
      });
    },
  };
}
