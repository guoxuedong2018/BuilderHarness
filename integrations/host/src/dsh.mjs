import { createBuilderHarnessService } from "./service.mjs";
import { isReviewWrite } from "./review-request.mjs";

export const name = "builderharness";
export const inject = ["tools", "workingDirectory"];

const rootParameter = {
  type: "string",
  description: "BuilderHarness workspace root. Defaults to the session working directory.",
};

function jsonTool({ name, description, parameters = {}, execute }) {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: { root: rootParameter, ...parameters },
      additionalProperties: false,
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args, exec) {
      return JSON.stringify(await execute(args, exec), null, 2);
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function apply(ctx, config = {}) {
  const fallbackRoot = config.root || undefined;
  const harness = createBuilderHarnessService();
  if (typeof ctx.provide === "function") ctx.provide("builderharness", harness);
  // Dev servers are children of this process; without this they outlive the
  // harness and later launches silently talk to a stale Vite instance.
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => harness.stopAllPrototypes(), "builderharness: stop prototype dev servers");
  }

  async function resolveToolRoot(args, exec) {
    if (args.root) return args.root;
    if (exec?.agent && ctx.workingDirectory) {
      try {
        return await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      } catch {
        // Fall through to the configured root when the session directory is unavailable.
      }
    }
    return fallbackRoot;
  }

  ctx.tools.register(
    jsonTool({
      name: "builderharness_status",
      description:
        "Inspect a BuilderHarness workspace: content pages, open review comments, feature specs, prototype dev script and publish configuration.",
      execute: async (args, exec) => harness.status(await resolveToolRoot(args, exec)),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_context",
      description:
        "Read BuilderHarness content context from docs/kb. Use topic to narrow pages and limit to bound the result.",
      parameters: {
        topic: { type: "string", description: "Optional topic or path fragment." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum pages to return." },
      },
      execute: async (args, exec) =>
        harness.context(await resolveToolRoot(args, exec), { topic: args.topic, limit: args.limit }),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_review_open",
      description: "List unresolved prototype review comments from docs/reviews, including anchors and reply counts.",
      execute: async (args, exec) => harness.reviews(await resolveToolRoot(args, exec)),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_review_add",
      description: "Add an open prototype review comment. Use this for source-grounded feedback that should survive in docs/reviews.",
      parameters: {
        frs: { type: "string", description: "Feature/region key; defaults to APP_SHELL." },
        route: { type: "string", description: "Prototype route the comment belongs to." },
        body: { type: "string", description: "The review comment." },
        author: { type: "string", description: "Comment author; defaults to BuilderHarness Agent." },
        anchor: { type: "string", description: "Optional source location, e.g. src/App.jsx:42:3." },
      },
      execute: async (args, exec) =>
        harness.addReview(await resolveToolRoot(args, exec), {
          frs: args.frs,
          route: args.route,
          body: args.body,
          author: args.author,
          anchor: args.anchor,
        }),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_review_resolve",
      description: "Resolve a prototype review comment by id, optionally appending a resolution note.",
      parameters: {
        id: { type: "string", description: "Review comment id." },
        note: { type: "string", description: "Optional resolution note." },
        author: { type: "string", description: "Resolver name; defaults to BuilderHarness Agent." },
      },
      execute: async (args, exec) =>
        harness.resolveReview(await resolveToolRoot(args, exec), {
          id: args.id,
          note: args.note,
          author: args.author,
        }),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_content_status",
      description:
        "Read the content lock status: pages that need review, changed refs, backlog and planned slots. Backed by docs/kb/_lock.json via the BuilderHarness CLI.",
      execute: async (args, exec) => harness.contentStatus(await resolveToolRoot(args, exec)),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_content_confirm",
      description:
        "Confirm one page or selected refs as reviewed. Writes the current fingerprints into docs/kb/_lock.json. Use after a human has actually reviewed the page.",
      parameters: {
        page: { type: "string", description: "Page path relative to docs/kb, e.g. guide/intro.md." },
        refs: {
          type: "array",
          items: { type: "string" },
          description: "Optional ref ids. Omit to confirm the whole page.",
        },
      },
      execute: async (args, exec) =>
        harness.contentConfirm(await resolveToolRoot(args, exec), { page: args.page, refs: args.refs }),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_publish_plan",
      description:
        "Show the local-to-destination publishing plan: configured destination, previously published pages, and pages that have never been published.",
      execute: async (args, exec) => harness.publishPlan(await resolveToolRoot(args, exec)),
    }),
  );

  ctx.tools.register(
    jsonTool({
      name: "builderharness_capture_media",
      description:
        "Rebuild documentation screenshots (PNG) or clips (MP4 + GIF) with the reproducible BuilderHarness CDP recipe runner. Use only after the prototype and shots/clips config are ready.",
      parameters: {
        kind: { type: "string", enum: ["shot", "clip"], description: "Capture screenshots or record clips." },
        only: {
          type: "array",
          items: { type: "string" },
          description: "Optional recipe keys. Omit to capture everything.",
        },
      },
      execute: async (args, exec) =>
        harness.captureMedia(await resolveToolRoot(args, exec), { kind: args.kind, only: args.only }),
    }),
  );

  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (webCtx) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/state",
            async handler(req, res) {
              res.setHeader("cache-control", "no-store");
              if (req.method !== "GET") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const url = new URL(req.url || "/", "http://127.0.0.1");
                const root = url.searchParams.get("root") || undefined;
                const [status, reviews, publish, baseline] = await Promise.all([
                  harness.status(root),
                  harness.reviews(root),
                  harness.publishPlan(root),
                  harness.baseline(root),
                ]);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ status, reviews, publish, baseline }, null, 2));
              } catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http state",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/content",
            async handler(req, res) {
              res.setHeader("cache-control", "no-store");
              if (req.method !== "GET") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const url = new URL(req.url || "/", "http://127.0.0.1");
                const root = url.searchParams.get("root") || undefined;
                const content = await harness.contentStatus(root);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(content, null, 2));
              } catch (error) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http content",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/baseline",
            async handler(req, res) {
              res.setHeader("cache-control", "no-store");
              try {
                const url = new URL(req.url || "/", "http://127.0.0.1");
                if (req.method === "GET") {
                  const root = url.searchParams.get("root") || undefined;
                  res.statusCode = 200;
                  res.setHeader("content-type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(await harness.baseline(root), null, 2));
                  return;
                }
                if (req.method !== "POST") {
                  res.statusCode = 405;
                  res.end("Method Not Allowed");
                  return;
                }
                const body = await readBody(req);
                const saved = await harness.saveBaseline(body.root, body);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(saved, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http baseline",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/requirements/create",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.createFeature(body.root, body.title);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http create feature",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/requirements/check",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.checkFrs(body.root);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http check frs",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/prototype/start",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.startPrototype(body.root);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http start prototype",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/prototype/install",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.installPrototype(body.root);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http install prototype deps",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/content/capture",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.captureMedia(body.root, { kind: body.kind, only: body.only });
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http capture media",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/publish/dry-run",
            async handler(req, res) {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.publishDryRun(body.root);
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify(result, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http publish dry run",
      );
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path: "/builderharness/api/review/resolve",
            async handler(req, res) {
              res.setHeader("cache-control", "no-store");
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end("Method Not Allowed");
                return;
              }
              if (!isReviewWrite(req)) {
                res.statusCode = 403;
                res.end("Forbidden");
                return;
              }
              try {
                const body = await readBody(req);
                const result = await harness.resolveReview(body.root, {
                  id: body.id,
                  note: body.note,
                  author: body.author,
                });
                res.statusCode = 200;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, ...result }, null, 2));
              } catch (error) {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
              }
            },
          }),
        "builderharness: http review resolve",
      );
    });
  }
}
