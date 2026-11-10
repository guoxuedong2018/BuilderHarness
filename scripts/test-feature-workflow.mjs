import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = path.join(root, "bin", "builderharness.mjs");
async function fixture(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "bh-feature-"));
  const write = async (rel, value) => {
    const target = path.join(cwd, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  const cli = (...args) => spawnSync(process.execPath, [bin, ...args], {
    cwd, encoding: "utf8", env: { ...process.env, BUILDERHARNESS_ROOT: cwd, BUILDERHARNESS_DEPLOY_GATEWAY: "./gateway.mjs" },
  });
  try { await run(cwd, write, cli); } finally { await rm(cwd, { recursive: true, force: true }); }
}
const table = (question, conclusion = "") => `## Pending decisions\n\n| ID | Question | Blocking | Conclusion |\n| --- | --- | --- | --- |\n| D1 | ${question} | yes | ${conclusion} |\n`;
const key = "DEMO";

test("approval refuses stale questions and requires a README and FRS linkage before closing", () => fixture(async (cwd, write, cli) => {
  const dir = "docs/features/" + key;
  await write(dir + "/README.md", table("Allow a synthetic draft?"));
  await write(dir + "/FRS.json", { acceptance: ["AC1: Save a draft"] });
  const listing = JSON.parse(cli("review", "decisions", key).stdout);
  const { version } = listing[0].items[0];
  const lib = new URL("../pipeline/lib/decisions.mjs", import.meta.url);
  const action = 'const m=await import(process.argv[1]); const row = await m.submitDecision("DEMO", JSON.parse(process.argv[2])); console.log(JSON.stringify(row));';
  const submit = (v) => spawnSync(process.execPath, ["--input-type=module", "-e", action, lib.href,
    JSON.stringify({ item: "D1", version: v, action: "confirm", author: "Reviewer", body: "Use a local draft" })],
  { cwd, encoding: "utf8", env: { ...process.env, BUILDERHARNESS_ROOT: cwd } });
  const submitted = submit(version);
  assert.equal(submitted.status, 0, submitted.stderr);
  const { id } = JSON.parse(submitted.stdout);
  assert.match(cli("review", "open").stdout, /Use a local draft/);
  assert.equal(cli("review", "resolve-decision", key, id).status, 1);
  await write(dir + "/README.md", table("Allow a remote draft?"));
  assert.equal(submit(version).status, 1);
  assert.match(cli("review", "decisions", key).stdout, /needs-review/);
  await write(dir + "/README.md", table("Allow a synthetic draft?", `Use a local draft <!-- ${id} -->`));
  await write(dir + "/FRS.json", { acceptance: ["AC1: Save a draft"], decisionRefs: { D1: { submission: id, acceptance: ["AC1"] } } });
  assert.equal(cli("review", "resolve-decision", key, id).status, 0);
  assert.match(cli("review", "decisions", key).stdout, /recorded/);
}));

test("feature verification reports required evidence and invalidates it when an input changes", () => fixture(async (_cwd, write, cli) => {
  await write("case.js", "process.exitCode = 0");
  await write("docs/features/DEMO/FRS.json", {
    acceptance: ["AC1: Save"],
    verification: [{ id: "save", ac: ["AC1"], required: true, command: [process.execPath, "case.js"], inputs: ["case.js"] }],
  });
  assert.equal(cli("verify", key, "--status").status, 1);
  assert.equal(cli("verify", key).status, 0);
  assert.match(cli("verify", key, "--status").stdout, /^passed save/);
  await write("case.js", "process.exitCode = 1");
  assert.match(cli("verify", key, "--status").stdout, /^stale save/);
  assert.match(cli("verify", key).stdout, /^failed save/);
}));

test("demo route evidence follows the shared inputs and the separately loaded UI spec", () => {
  const demo = path.join(root, "examples/react-tailwind");
  const source = new URL("../pipeline/lib/route-source.mjs", import.meta.url);
  const program = `
    const { sourcesForRoute } = await import(process.argv[1]);
    const paths = ["/experiments", "/ui-spec", "/missing"];
    console.log(JSON.stringify(await Promise.all(paths.map(route => sourcesForRoute(process.cwd(), route)))));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, source.href], {
    cwd: demo, encoding: "utf8", env: { ...process.env, BUILDERHARNESS_ROOT: demo },
  });
  assert.equal(result.status, 0, result.stderr);
  const [experiments, spec, unknown] = JSON.parse(result.stdout);
  assert.deepEqual(unknown, []);
  for (const file of ["src/App.jsx", "tailwind.config.cjs", "postcss.config.cjs", "../../ui-spec/tokens.css", "../../ui-spec/impl/react/index.ts"]) {
    assert.ok(experiments.includes(path.normalize(file)), file);
  }
  const specView = path.normalize("src/components/SpecView.jsx");
  assert.ok(!experiments.includes(specView));
  assert.ok(spec.includes(specView));
});

test("preflight and deployment bind to an artifact and refuse a mismatched project", () => fixture(async (cwd, write, cli) => {
  await write("dist/index.html", "<h1>Synthetic fixture</h1>");
  await write("dist/old.js", 'const endpoint = "/__promo/config";');
  assert.equal(cli("preflight").status, 1);
  await rm(path.join(cwd, "dist/old.js"));
  await write("gateway.mjs", `import { readFile, writeFile } from "node:fs/promises";
    export default {
      describe: async () => ({ project: "expected", target: "preview", access: "team" }),
      upload: async ({ artifactHash }) => {
        await writeFile("remote.json", JSON.stringify({ version: "v1", artifactHash }));
        return { version: "v1", fixedUrl: "https://example.com/v1" };
      },
      readVersion: async () => JSON.parse(await readFile("remote.json", "utf8"))
    };`);
  assert.equal(cli("deploy", "plan", "--project", "wrong").status, 1);
  const plan = cli("deploy", "plan", "--project", "expected");
  assert.equal(plan.status, 0, plan.stderr);
  const { id } = JSON.parse(plan.stdout);
  await write("dist/index.html", "<h1>Modified</h1>");
  assert.match(cli("deploy", "apply", "--plan", id).stderr, /Build changed/);
  const next = JSON.parse(cli("deploy", "plan", "--project", "expected").stdout);
  const applied = cli("deploy", "apply", "--plan", next.id);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).verified, true);
  assert.equal(JSON.parse(await readFile(path.join(cwd, "remote.json"), "utf8")).artifactHash, next.artifactHash);
}));

test("prototype initialization registers native skills, references and protects edits", () => fixture(async (cwd, write, cli) => {
  assert.equal(cli("init", "--prototype", "--agent", "codex").status, 0);
  const relative = ".agents/skills/builderharness-feature-promo/SKILL.md";
  assert.match(await readFile(path.join(cwd, relative), "utf8"), /name: builderharness-feature-promo/);
  assert.match(await readFile(path.join(cwd, ".agents/skills/builderharness-review/references/design-brief.md"), "utf8"), /设计/);
  await write(relative, "My local skill");
  assert.equal(cli("init", "--prototype", "--agent", "codex").status, 1);
  assert.equal(await readFile(path.join(cwd, relative), "utf8"), "My local skill");
}));
