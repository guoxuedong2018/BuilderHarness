import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { click, evaluate, fill, goto, installHelpers, launch, waitFor } from "../pipeline/lib/cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const demo = path.join(root, "examples/react-tailwind");
const anchorUrl = "/@fs/" + path.join(root, "client/review/anchor.js").replace(/^\//, "");

async function clickPoint(session, selector) {
  const point = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await session.send("Input.dispatchMouseEvent", { ...point, type: "mousePressed", button: "left", clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { ...point, type: "mouseReleased", button: "left", clickCount: 1 });
}

test("Chrome keeps a failed comment draft and anchors repeated elements without choosing the wrong instance", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "bh-review-browser-"));
  const previousRoot = process.env.BUILDERHARNESS_ROOT;
  process.env.BUILDERHARNESS_ROOT = temp;
  let server;
  let browser;
  try {
    let failCreate = true;
    server = await createServer({
      root: demo,
      configFile: path.join(demo, "vite.config.js"),
      cacheDir: path.join(temp, "vite"),
      server: { host: "127.0.0.1", port: 5418, hmr: false },
      plugins: [{
        name: "review-regression",
        enforce: "pre",
        configureServer({ middlewares }) {
          middlewares.use((req, res, next) => {
            if (!failCreate || req.method !== "POST" || req.url !== "/__proto_review/create") return next();
            failCreate = false;
            req.resume();
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "模拟保存失败" }));
          });
        },
      }],
    });
    await server.listen();
    const base = "http://127.0.0.1:" + server.httpServer.address().port;
    browser = await launch({ viewport: { width: 1440, height: 900, scale: 1 } });
    const { session } = browser;
    const exceptions = [];
    session.on("Runtime.exceptionThrown", (event) => exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
    await installHelpers(session, { onNavigation: true });
    await goto(session, base + "/#/overview");
    assert.ok(await waitFor(session, ".review-bar", 15_000));

    const findings = await evaluate(session, `(async () => {
      const { createAnchor, relocate, migrateAnchor } = await import(${JSON.stringify(anchorUrl)});
      const reviewRoot = document.querySelector("[data-review-root]");
      const [overview, experiments] = reviewRoot.querySelectorAll("nav[aria-label='Primary'] button");
      const capture = (el) => {
        const box = el.getBoundingClientRect();
        return createAnchor(el, box.x + box.width / 2, box.y + box.height / 2);
      };
      const shared = capture(experiments);
      const result = relocate(shared);
      const legacy = relocate(migrateAnchor({ loc: experiments.getAttribute("data-loc"), regionFrs: shared.frs }));
      const container = document.createElement("div");
      container.innerHTML = '<button data-loc="fixture.jsx:2:4">相同</button><button data-loc="fixture.jsx:2:4">相同</button>';
      reviewRoot.append(container);
      const ambiguous = capture(container.lastElementChild);
      const before = relocate(ambiguous);
      container.lastElementChild.remove();
      const after = relocate(ambiguous);
      const visible = container.firstElementChild;
      const hidden = visible.cloneNode(true);
      hidden.style.display = "none";
      container.prepend(hidden);
      const sole = relocate(capture(visible));
      visible.setAttribute("data-loc", "fixture.jsx:3:4");
      const moved = relocate({ ...capture(visible), src: { file: "fixture.jsx", line: 2, col: 4 } });
      container.remove();
      const makeOverlay = (title) => {
        const overlay = document.createElement("div");
        overlay.className = "app-modal";
        overlay.innerHTML = '<h2 class="ivu-modal-header-inner"></h2><button data-use="fixture.vue:4:2">确定</button>';
        overlay.firstElementChild.textContent = title;
        document.body.append(overlay);
        return overlay;
      };
      const firstOverlay = makeOverlay("第一项");
      const secondOverlay = makeOverlay("第二项");
      const overlayButton = secondOverlay.lastElementChild;
      const overlayAnchor = capture(overlayButton);
      const correctOverlay = relocate(overlayAnchor);
      secondOverlay.style.display = "none";
      const closedOverlay = relocate(overlayAnchor);
      firstOverlay.remove();
      secondOverlay.remove();
      return {
        sameSource: overview.getAttribute("data-loc") === experiments.getAttribute("data-loc"),
        correct: result.el === experiments && result.confidence === "exact",
        legacyAmbiguous: legacy.el === null && legacy.confidence === "ambiguous",
        duplicate: before.el === null && before.confidence === "ambiguous",
        afterDeletion: after.el === null && after.confidence === "ambiguous",
        hiddenIgnored: sole.el === visible && sole.confidence === "exact",
        moved: moved.el === visible && moved.confidence === "moved",
        correctOverlay: correctOverlay.el === overlayButton && correctOverlay.confidence === "exact",
        closedOverlay: closedOverlay.el === null && closedOverlay.confidence === "overlay-closed",
      };
    })()`);
    for (const [name, passed] of Object.entries(findings)) assert.equal(passed, true, name);

    await click(session, "text=评论");
    assert.ok(await waitFor(session, "text=点选元素评论中"));
    await clickPoint(session, "[data-review-root] h1");
    await fill(session, ".cl-textarea", "Retain this review draft");
    await click(session, "text=添加评论");
    assert.ok(await waitFor(session, ".cl-save-error"));
    assert.equal(await evaluate(session, 'document.querySelector(".cl-textarea").value'), "Retain this review draft");
    assert.deepEqual(await fetch(base + "/__proto_review/all").then((r) => r.json()).then((data) => data.comments), []);
    await click(session, "text=添加评论");
    assert.ok(await waitFor(session, ".cl-pin", 10_000));
    const records = JSON.parse(await readFile(path.join(temp, "docs/reviews/OVERVIEW.json"), "utf8"));
    assert.equal(records.length, 1);
    assert.equal(records[0].body, "Retain this review draft");
    await goto(session, base + "/?review-reload=1#/overview");
    assert.ok(await waitFor(session, ".cl-pin", 10_000));
    await click(session, ".cl-pin");
    await click(session, "text=回复");
    await fill(session, ".cd-reply-input", "A saved reply");
    await click(session, "text=回复");
    assert.ok(await waitFor(session, "text=A saved reply"));
    await click(session, "text=解决");
    assert.ok(await waitFor(session, ".cd-num.is-resolved"));
    const [updated] = JSON.parse(await readFile(path.join(temp, "docs/reviews/OVERVIEW.json"), "utf8"));
    assert.equal(updated.status, "resolved");
    assert.deepEqual(updated.replies.map(({ body }) => body), ["A saved reply"]);
    assert.deepEqual(exceptions, []);
  } finally {
    await browser?.close();
    await server?.close();
    if (previousRoot === undefined) delete process.env.BUILDERHARNESS_ROOT;
    else process.env.BUILDERHARNESS_ROOT = previousRoot;
    await rm(temp, { recursive: true, force: true });
  }
});
