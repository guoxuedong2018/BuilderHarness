import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { addReview, resolveReview } from "../integrations/host/src/project.mjs";
import { reviewServer } from "../server/review-server.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/builderharness.mjs", import.meta.url));
const origin = "http://localhost:5173";
const json = "application/json";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bh-review-"));
  const dir = path.join(root, "docs/reviews");
  const file = path.join(dir, "EXPERIMENTS.json");
  await mkdir(dir, { recursive: true });
  let handler;
  reviewServer({ reviewsDir: dir }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  function send(action, body, headers = {}, { method = "POST", raw } = {}) {
    const input = raw ?? (body === undefined ? "" : JSON.stringify(body));
    const request = Object.assign(Readable.from([Buffer.from(input)]), {
      method, url: "/__proto_review/" + action,
      headers: { host: "localhost:5173", "content-type": json, ...headers },
    });
    return new Promise((resolve, reject) => {
      const response = { setHeader() {}, end(value) { resolve({ status: this.statusCode, data: JSON.parse(value) }); } };
      handler(request, response, () => reject(new Error("Review request was not handled"))).catch(reject);
    });
  }
  try { await run({ dir, root, file, send }); } finally { await rm(root, { recursive: true, force: true }); }
}

const frs = "EXPERIMENTS";
const baseComment = { id: "thread", frs, route: "/experiments", body: "Original", status: "open", replies: [] };

test("concurrent writes through Vite, CLI and host keep every record in a legacy review file", () => fixture(async ({ root, file, dir, send }) => {
  await writeFile(file, JSON.stringify({ label: "Legacy metadata", comments: [baseComment] }));
  const browser = Array.from({ length: 16 }, (_, index) => send("upsert", { ...baseComment, id: "browser-" + index }));
  const command = exec(process.execPath, [cli, "review", "reply", baseComment.id, "CLI reply"], {
    cwd: root, env: { ...process.env, BUILDERHARNESS_ROOT: root },
  });
  const host = addReview(root, { frs, body: "Host review", route: baseComment.route });
  const resolved = resolveReview(root, { id: baseComment.id, note: "Host reply" });
  const [writes, , hostRecord] = await Promise.all([Promise.all(browser), command, host, resolved]);
  assert.ok(writes.every(({ status }) => status === 200));
  const result = JSON.parse(await readFile(file, "utf8"));
  assert.equal(result.label, "Legacy metadata");
  assert.equal(result.comments.length, 18);
  assert.ok(result.comments.some((comment) => comment.id === hostRecord.comment.id));
  for (let i = 0; i < 16; i += 1) assert.ok(result.comments.some((comment) => comment.id === "browser-" + i));
  const thread = result.comments.find(({ id }) => id === baseComment.id);
  assert.equal(thread.status, "resolved");
  assert.deepEqual(thread.replies.map(({ body }) => body).sort(), ["CLI reply", "Host reply"]);
  assert.deepEqual(await readdir(dir), ["EXPERIMENTS.json"]);
}));

test("thread updates merge replies and status, and retries do not duplicate or overwrite saved data", () => fixture(async ({ send }) => {
  assert.equal((await send("create", baseComment)).status, 200);
  const first = { id: "a", author: "A", body: "First", at: "2026-11-09T00:00:00Z" };
  const second = { ...first, id: "b", body: "Second" };
  const update = (fields) => send("update", { id: baseComment.id, frs, ...fields });
  const writes = await Promise.all([update({ reply: first }), update({ reply: second }), update({ status: "resolved" })]);
  assert.ok(writes.every(({ status }) => status === 200));
  const retry = await update({ reply: first });
  assert.deepEqual(retry.data.comment.replies.map(({ id }) => id).sort(), ["a", "b"]);
  assert.equal((await send("create", baseComment)).data.comment.status, "resolved");
  assert.equal((await send("delete", baseComment)).status, 200);
  assert.equal((await update({ reply: first })).status, 404);
  assert.equal((await send("delete", baseComment)).status, 200);
  assert.deepEqual((await send("all", undefined, {}, { method: "GET" })).data.comments, []);
}));

test("review writes accept same-origin JSON and reject other origins, schemes and form bodies", () => fixture(async ({ send }) => {
  for (const headers of [
    { origin: "https://foreign.invalid", "sec-fetch-site": "cross-site", "content-type": "text/plain" },
    { origin: "https://localhost:5173" },
    { origin: "http://localhost:5174", "sec-fetch-site": "same-site" },
    { origin: "null" },
    { origin: "invalid" },
    { "sec-fetch-site": "cross-site" },
    { origin, "content-type": "application/json-other" },
    { origin: "http://other.invalid", "x-forwarded-host": "other.invalid" },
  ]) {
    for (const action of ["create", "upsert", "update", "delete", "decisions/submit", "decisions/withdraw"]) {
      assert.equal((await send(action, baseComment, headers)).status, 403, action);
    }
  }
  assert.equal((await send("create", null, { origin }, { raw: "{" })).status, 400);
  assert.deepEqual((await send("all", undefined, {}, { method: "GET" })).data.comments, []);
  assert.equal((await send("create", baseComment, { origin, "sec-fetch-site": "same-origin", "content-type": json + "; charset=utf-8" })).status, 200);
}));

test("a failed save preserves the original file and releases its lock for retry", () => fixture(async ({ dir, file, send }) => {
  await writeFile(file, "{bad");
  assert.equal((await send("upsert", baseComment)).status, 500);
  assert.equal(await readFile(file, "utf8"), "{bad");
  assert.deepEqual(await readdir(dir), ["EXPERIMENTS.json"]);
  await writeFile(file, "[]");
  assert.equal((await send("upsert", baseComment)).status, 200);
  assert.equal(JSON.parse(await readFile(file, "utf8")).length, 1);
}));
