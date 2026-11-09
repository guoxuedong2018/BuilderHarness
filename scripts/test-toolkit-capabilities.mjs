import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createSelection, facetsOf, locate, rootItems } from "../ui-spec/data/index.js";
import { parseDecisions } from "../pipeline/lib/decisions.mjs";
import { factsOf, findRefs, sectionsOf } from "../pipeline/lib/pending-list.mjs";
import { buildBody } from "../pipeline/export-frs-prd.mjs";
import { paraText, patchOps, tableParagraphs } from "../pipeline/prd-patch-ops.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = path.join(root, "bin/builderharness.mjs");
async function fixture(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "bh-toolkit-"));
  const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", env: { ...process.env, BUILDERHARNESS_ROOT: cwd } });
  try { await run(cwd, cli); } finally { await rm(cwd, { recursive: true, force: true }); }
}

test("legacy grouped tables and flat tables preserve decision meaning and references", () => {
  const md = `# Example

## Confirmed facts
1. The prototype uses synthetic drafts.

## 待决清单（定稿用）

### A · 产品

| # | 要定什么 | 我的建议 | 备选 | 为什么重要 | 你的结论 |
| --- | --- | --- | --- | --- | --- |
| A1 ⛔ | Do we keep it? | **Keep it**. Fact 1 | ① Remove it ② Delay | See B1 | 先保留，待确认 |

### B · 研发

| ID | Question | Conclusion |
| --- | --- | --- |
| B1 | Does it save? | — |
`;
  const [row, answer] = parseDecisions(md);
  assert.equal(row.id, "A1");
  assert.equal(row.required, true);
  assert.equal(row.state, "provisional");
  assert.equal(row.alternatives.length, 2);
  assert.equal(answer.state, "pending");
  assert.deepEqual(findRefs(row.recommend.text, { facts: factsOf(sectionsOf(md)) }).map((ref) => ref.kind), ["fact"]);
  assert.deepEqual(findRefs(row.why, { ids: new Set(["A1", "B1"]) }, "A1").map((ref) => ref.target), ["B1"]);
  assert.notEqual(parseDecisions(md.replace("Delay", "Defer"))[0].version, row.version);
  assert.equal(parseDecisions(md.replace("先保留，待确认", "已确认"))[0].version, row.version);
});

test("component tables append as blocks, and subsequent edits stay in their own cells", () => {
  const frs = { title: "Demo", spec: [{ group: "Page", points: [{ display: ["Rule"] }] }] };
  const notes = (value) => ({ route: "/ui", items: [{ name: "Dialog", route: "/ui#dialog", notes: [value] }] });
  const opts = { prototypeUrl: null, prototypeOrigin: "https://example.com", images: {} };
  const local = buildBody({ ...frs, components: notes("Component rule") }, "", opts);
  const old = buildBody(frs, "", opts);
  assert.match(JSON.stringify(local), /https:\/\/example\.com/);
  for (const [i, node] of tableParagraphs(old).entries()) node[1].id = "old-" + i;
  const append = patchOps({ cloudBody: old, localBody: local, base: tableParagraphs(old).map(paraText) });
  assert.equal(append.ops.at(-1).anchor, "@docEnd");
  assert.equal(append.ops.at(-1).content.at(-1)[0], "table");

  for (const [i, node] of tableParagraphs(local).entries()) node[1].id = "published-" + i;
  const edit = patchOps({ cloudBody: local, localBody: buildBody({ ...frs, components: notes("Updated component rule") }, "", opts),
    base: tableParagraphs(local).map(paraText) });
  const paragraph = tableParagraphs(local).find((node) => paraText(node) === "Componentrule");
  assert.ok(edit.ops.some((op) => op.anchor === paragraph[1].id));
});

test("prototype packages include a product-film starter and can install the Cursor profile", () => fixture(async (cwd, cli) => {
  const init = cli("promo", "init", "Film", "--template", "product-film");
  assert.equal(init.status, 0, init.stderr);
  assert.match(await readFile(path.join(cwd, "docs/promo/Film/film.js"), "utf8"), /openApp/);
  assert.match(await readFile(path.join(cwd, "docs/promo/Film/assets/fonts/OFL-Inter.txt"), "utf8"), /OPEN FONT LICENSE/i);
  assert.notEqual(cli("promo", "init", "Film", "--template", "product-film").status, 0);
  assert.equal(cli("init", "--prototype", "--agent", "cursor").status, 0);
  assert.match(await readFile(path.join(cwd, ".cursor/rules/builderharness.mdc"), "utf8"), /alwaysApply: true/);
  assert.match(await readFile(path.join(cwd, ".cursor/skills/builderharness-product-design-review/SKILL.md"), "utf8"), /name: builderharness-product-design-review/);
}));

test("artifact policy matches private values while keeping reports free of their contents", () => fixture(async (cwd, cli) => {
  await mkdir(path.join(cwd, "dist"));
  await writeFile(path.join(cwd, "dist/index.html"), "<p>Synthetic-private-value</p>");
  const policy = path.join(cwd, "policy.json");
  await writeFile(policy, JSON.stringify({ denyValues: ["Synthetic-private-value"] }));
  const bad = cli("preflight", "--json", "--policy", policy);
  assert.equal(bad.status, 1, bad.stderr);
  assert.doesNotMatch(bad.stdout, /Synthetic-private-value/);
  assert.equal(JSON.parse(bad.stdout).findings[0].rule, "host-private-value");
  await writeFile(policy, JSON.stringify({ denyValues: ["Synthetic-private-value"], allowValues: ["Synthetic-private-value"] }));
  assert.equal(cli("preflight", "--policy", policy).status, 0);
}));

test("shared UI logic supports recreated rows, facet counts and incomplete JSON", () => {
  const selection = createSelection("id");
  selection.select([{ id: "a" }, {}]);
  selection.select([{ id: "b" }]);
  assert.deepEqual(selection.mark([{ id: "b" }, { id: "c" }]).map((row) => row._checked), [true, false]);
  assert.deepEqual(selection.keys, ["a", "b"]);
  const fields = [{ key: "label", kind: "enum", values: (row) => row.labels }];
  const result = facetsOf(fields, [{ labels: ["x"] }, { labels: ["x", "y"] }], [{ field: "label", op: "any", values: ["y"] }]);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.fields[0].options.map((option) => option.count), [2, 1]);
  const incomplete = '[{"escaped\\u004bey": "unfinished';
  assert.equal(locate(incomplete, incomplete.length).frames.at(-1).key, "escapedKey");
  assert.equal(rootItems(incomplete)[0].end, -1);
});
