#!/usr/bin/env node
/**
 * 出 PRD：一条命令把 FRS 件套发成外部目标 PRD
 * ------------------------------------------------------------------
 * 从前每出一版 PRD，Agent 要照着 Skill 手拼七八条发布命令：建文档、追图、对 imageId、写正文、回读；
 * 改一轮已发布的 PRD 更贵——取大纲找表格锚点、抠 JSON、打补丁，一轮两百多次工具调用。
 * 全是确定的步骤，收在这里。Agent 只管 FRS 里写什么、这一版该不该发。
 *
 *   npx builderharness prd <KEY> [--scope delta]             只出计划：校验、渲染、截图、和目标端比，不写目标端
 *   npx builderharness prd <KEY> [--scope delta] --yes       按计划外发
 *   npx builderharness prd <KEY> --yes --absorb              目标端里的改动已同步回 FRS（或不要了）：底稿换成目标端现状再补
 *   npx builderharness prd <KEY> --yes --redline             出修订稿给人过目：删的、改前的划线标红，新的浅绿底；人确认后不带 --redline 再发一次定稿
 *   npx builderharness prd <KEY> --yes --rewrite             已有的那篇整篇覆盖（确认没人改过才用）
 *   npx builderharness prd <KEY> --yes --folder <目录 id>     新建时建在目标端的这个目录下（由发布适配器解释）
 *
 * 新建（FRS 没有 prdDocId）：建空文档 → 追图换 imageId → 带图渲染 → 整篇写入 → 回读核对 → 回写 prdDocId。
 * 更新：只补功能点表里变了的段落，目标端有人改过的段落不动、删掉的不加回，逐条写进 cloud-edits.md
 * （改了什么、在哪个功能点下、FRS 同步了没有）。同步回 FRS 后加 --absorb 再发。需求背景与方案设计变了只提醒——
 * 这几段有 Mermaid 和列表，按段替换容易弄坏，要么去目标端手改，要么确认没人改过后 --rewrite。
 *
 * 本地记这几样（docs/prd/<KEY>/，已 gitignore）：
 *   base.json            上次发布后目标端功能点表的段落，下次用来认出哪些段落是人改的
 *   images.json          每张图上传后的 imageId 与图片哈希，图没变就复用，不重复上传
 *   cloud-edits.md       出计划时目标端里有人改过的地方（没有就不留），同步回 FRS 照它做
 *   pending-images.json  追到文末、还没挪进正文的临时图（发到一半失败时留下），下次一并删
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { PRD_METHODS, loadPublishGateway, publishDestinationInfo } from "./lib/publish-gateway.mjs";
import { compareMedia, storeBlob } from "./lib/media-ledger.mjs";
import { FEATURES_DIR, KB_DIR, PIPELINE_DIR, PRD_DIR, PROJECT_CONFIG, REPO_ROOT } from "./lib/paths.mjs";
import { readEnv } from "./lib/env.mjs";
import { sourcesForRoute } from "./lib/route-source.mjs";
import { currentHashes } from "./lib/source-snapshot.mjs";
import { alignImages } from "./prd-images.mjs";
import { batchOps, cloudEdits, cloudEditsReport, nextBase, paraText, patchOps, proseTexts, tableParagraphs } from "./prd-patch-ops.mjs";

const DEV = readEnv("BASE_URL") || PROJECT_CONFIG.baseUrl || "http://localhost:5273/";
const SECTIONS = ["需求背景", "需求描述", "方案设计", "功能点规则描述"];

const argv = process.argv.slice(2);
const VALUE_FLAGS = ["--scope", "--folder", "--plan"];
const key = argv.find((a, i) => !a.startsWith("-") && !VALUE_FLAGS.includes(argv[i - 1]));
const scope = argv.includes("--scope") ? argv[argv.indexOf("--scope") + 1] : "all";
const folder = argv.includes("--folder") ? argv[argv.indexOf("--folder") + 1] : null;
const yes = argv.includes("--yes");
const approved = argv.includes("--plan") ? argv[argv.indexOf("--plan") + 1] : null;
const rewrite = argv.includes("--rewrite");
const absorb = argv.includes("--absorb");
const redline = argv.includes("--redline");

const stop = (msg) => {
  console.log(`✗ ${msg}`);
  process.exit(1);
};
const step = (text) => console.log(`▸ ${text}`);
const readJson = (file, fallback) => fs.readFile(file, "utf8").then(JSON.parse, () => fallback);
const idOf = (v) => (typeof v === "string" ? v : v?.imageId ?? null);
const today = () => new Date().toLocaleDateString("sv-SE");

function node(script, args) {
  return spawnSync(process.execPath, [path.join(PIPELINE_DIR, script), ...args], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
}
const tail = (r, n = 15) => `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-n).join("\n");

async function ensureDev() {
  const up = await fetch(DEV, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  if (!up) stop("截图要从活的原型上抓：先在另一个终端 cd web && npm run dev（5273），再跑一次");
}

async function main() {
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) stop("用法：npx builderharness prd <FEATURE_KEY> [--scope delta] [--yes] [--absorb] [--redline] [--rewrite] [--folder <目录 id>]");
  if (argv.includes("--plan") && (!yes || !/^[a-f0-9]{64}$/.test(approved ?? ""))) stop("--plan requires --yes and a valid plan ID");
  if (yes && PROJECT_CONFIG.requirePrdPlan && !approved) stop("Generate and review a PRD plan before publishing; pass --yes --plan <ID>");
  if (folder !== null && (!folder || folder.startsWith("-"))) stop("--folder 后面要跟目标端的目录 id");
  if (!["all", "delta"].includes(scope)) stop(`--scope 只接受 all 或 delta，收到「${scope}」`);
  const frsFile = path.join(FEATURES_DIR, key, "FRS.json");
  const frs = await readJson(frsFile, null);
  if (!frs) stop(`没有这个需求件套：docs/features/${key}/FRS.json`);
  const gateway = await loadPublishGateway({ methods: PRD_METHODS }).catch((e) => stop(e.message));
  const outDir = path.join(PRD_DIR, key);
  const title = `【PRD】${frs.title ?? key}`;
  const docId = frs.prdDocId || null;
  if (redline && (rewrite || !docId)) stop("--redline 只用于更新已发布的 PRD，不和 --rewrite 一起用");

  // ── 1 校验、渲染、截图 ──────────────────────────────────────────
  let r = node("verify.mjs", [key, "--status"]);
  if (r.status !== 0) stop(`需求验收或待决清单仍有阻断项：\n${tail(r)}`);
  r = node("check-frs.mjs", []);
  if (r.status !== 0) stop(`需求件套校验没过（PRD 会带着错的验收编号或不存在的页面）：\n${tail(r)}`);
  r = node("export-frs-prd.mjs", [key, "--scope", scope]);
  if (r.status !== 0) stop(`渲染失败：\n${tail(r)}`);
  const made = r.stdout.match(/已生成 .*?：(.+)/)?.[1] ?? "";
  const shots = JSON.parse(await fs.readFile(path.join(outDir, "shots.json"), "utf8"));
  if (shots.order.length && !approved) {
    await ensureDev();
    r = node("capture-shots.mjs", [key, "--base-url", DEV, ...shots.order.flatMap((k) => ["--only", k])]);
    if (r.status !== 0) stop(`截图没成功：\n${tail(r)}`);
    for (const line of r.stdout.split("\n").filter((l) => /⚠|宽高比|点不开/.test(l))) console.log(`  ${line.trim()}`);
  }
  // 每一版截图存进内容寻址缓存（与知识库共用），下次才比得了画面
  const listIds = new Map();
  const rendered = JSON.stringify(await readJson(path.join(outDir, "ops.json"), null), (key, value) => {
    // The destination wants fresh list identifiers, which do not change the reviewed content.
    if (key !== "listId") return value;
    if (!listIds.has(value)) listIds.set(value, listIds.size + 1);
    return listIds.get(value);
  });
  const sourceFiles = new Set();
  for (const shot of shots.order) {
    const route = frs.shots?.[shot]?.route;
    if (!route) continue;
    const files = await sourcesForRoute(REPO_ROOT, route).catch(() => []);
    if (!files.length && (approved || PROJECT_CONFIG.requirePrdPlan)) stop(`缺少 ${route} 的源码依赖，无法绑定配图版本`);
    for (const file of files) sourceFiles.add(file);
  }
  const sources = await currentHashes(REPO_ROOT, [...sourceFiles].sort());
  const hashes = Object.fromEntries(await Promise.all(shots.order.map(async (k, i) => [k, await storeBlob(path.relative(KB_DIR, shots.files[i]))])));
  if (Object.values(hashes).some((hash) => !hash)) stop("配图缺失，请重新生成 PRD 计划");

  // 已上传过、画面没变、而且属于这篇文档的 imageId 可以复用（imageId 以文档 docId 结尾，换一篇就不能用）。
  // 画面没变不等于字节相同：抽屉、浮层这类截图每拍一次字节都不一样，按 16×16 格比灰度才认得出（compareMedia）。
  // 旧记录只有 imageId、没有哈希，分不出图变没变，按要重传算：多传一次无害，漏换一张图没人发现
  const imagesFile = path.join(outDir, "images.json");
  /** 追到文末、还没挪进正文的临时图（上一次发到一半失败时留下）：记追图返回的 imageId 与文末那几段的段落 id */
  const pendingFile = path.join(outDir, "pending-images.json");
  const recorded = await readJson(imagesFile, {});
  const reuse = {};
  for (const k of shots.order) {
    const v = recorded[k];
    if (!docId || !idOf(v)?.endsWith(docId) || !v.hash) continue;
    if (v.hash === hashes[k] || (await compareMedia(v.hash, hashes[k])).same) reuse[k] = v.imageId;
  }
  const toUpload = shots.order.filter((k) => !reuse[k]);

  /** 按给定的图渲染一遍，返回正文。图的记录只在真传上去之后才改（见 finish） */
  const render = async (map) => {
    const file = path.join(outDir, "images.render.json");
    await fs.writeFile(file, `${JSON.stringify(map, null, 2)}\n`);
    const res = node("export-frs-prd.mjs", [key, "--scope", scope, "--images", path.relative(REPO_ROOT, file)]);
    if (res.status !== 0) stop(`带图渲染失败：\n${tail(res)}`);
    return JSON.parse(await fs.readFile(path.join(outDir, "ops.json"), "utf8"))[0].content;
  };

  // ── 2 计划 ─────────────────────────────────────────────────────
  console.log(`\n${docId ? "更新" : "新建"}「${title}」${made ? `：${made}` : ""}，配图 ${shots.order.length} 张`);
  if (!docId || rewrite) {
    if (docId) console.log("  整篇覆盖：目标端有人改过的内容会一起没掉");
    else console.log(folder ? `  建在目标端目录 ${folder} 下，权限随这个目录` : "  新文档默认只有你自己能看，分享范围在目标端设");
    const revision = docId ? (await gateway.fetchJsonml(docId)).version : null;
    if (!checkPlan(revision)) return;
    return publishWhole();
  }

  step("读目标端现状");
  const cloud = await gateway.fetchJsonml(docId);
  const saved = await readJson(path.join(outDir, "base.json"), null);
  // --absorb：人确认过目标端里的改动已经同步回 FRS，或者不要了。底稿换成目标端现状，这些段落不再当成「有人改过」而跳过
  const base = absorb ? tableParagraphs(cloud.body).map(paraText) : saved;
  // 计划阶段图还没传：要换的图先沿用旧的 imageId，不然每张都会被算成一处改动
  const planned = { ...Object.fromEntries(Object.entries(recorded).map(([k, v]) => [k, idOf(v)]).filter(([, id]) => id?.endsWith(docId))), ...reuse };
  const localBody = await render(planned);
  const patch = patchOps({ localBody, cloudBody: cloud.body, base, redline });
  const proseChanged = JSON.stringify(proseTexts(localBody)) !== JSON.stringify(proseTexts(cloud.body));
  const changedImages = toUpload.filter((k) => planned[k]);
  const newImages = toUpload.filter((k) => !planned[k]);

  const { change, insert, delete: del, unmark } = patch.summary;
  console.log(`  目标端第 ${cloud.version} 版`);
  console.log(`  功能点表${redline ? "修订稿（删的、改前的划线标红，新的浅绿底）" : ""}：改写 ${change} · 新增 ${insert} · 删除 ${del}`);
  if (unmark) console.log(`  修订稿定稿：${unmark} 段去掉浅绿底；划线标红的段落按删除算在上面`);
  for (const line of patch.lines.slice(0, 20)) console.log(line);
  if (patch.lines.length > 20) console.log(`  …… 还有 ${patch.lines.length - 20} 处`);
  if (changedImages.length) console.log(`  配图换 ${changedImages.length} 张：${changedImages.join("、")}`);
  if (newImages.length) console.log(`  配图新增 ${newImages.length} 张：${newImages.join("、")}`);
  const editsFile = path.join(outDir, "cloud-edits.md");
  if (absorb) {
    console.log(`  底稿换成目标端第 ${cloud.version} 版：目标端里的改动这次不再保护，按 FRS 改写或删掉`);
    await fs.rm(editsFile, { force: true });
  } else if (saved) {
    const edits = cloudEdits({ cloudBody: cloud.body, base: saved, localBody });
    if (edits.length) {
      await fs.writeFile(editsFile, cloudEditsReport(edits, { version: cloud.version }));
      const open = edits.filter((e) => !e.synced).length;
      console.log(`  目标端里有人改过 ${edits.length} 处，FRS 里没有的 ${open} 处，逐条见 ${path.relative(REPO_ROOT, editsFile)}`);
      if (patch.kept.length || patch.removed.length) {
        console.log(`    这次不动 ${patch.kept.length} 段、删掉的 ${patch.removed.length} 段不加回；要留的同步回 FRS.json，处理完加 --absorb 再发`);
      }
    } else await fs.rm(editsFile, { force: true });
  }
  if (!base && change + del > 0) {
    console.log("  ⚠️ 这篇没有上次发布的底稿，分不清目标端哪些段落是人改的：上面的改写与删除会落到目标端现在的样子上。");
    console.log("     目标端那边的改动是对的，就先改回 FRS.json 再出计划；确认都要覆盖再 --yes");
  }
  if (proseChanged) console.log("  ⚠️ 需求背景 / 方案设计和目标端不一样：这条命令只同步功能点表，这几段去目标端手改；确认没人改过可以 --yes --rewrite 整篇覆盖");
  // 上次追图留下、没删掉的临时图（发到一半失败，或认错了没删）：这次一并删
  const leftover = await readJson(pendingFile, []);
  const isTemp = (b, fresh = []) =>
    b[0] !== "table" && imagesIn(b).length > 0 && (leftover.includes(b[1]?.id) || imagesIn(b).every((id) => fresh.includes(id) || leftover.includes(id)));
  const strays = topLevel(cloud.body).filter((b) => isTemp(b));
  if (strays.length) console.log(`  文末有 ${strays.length} 段上次追图留下的临时图，这次一并删掉`);
  if (!change && !insert && !del && !unmark && !toUpload.length && !strays.length) return console.log("\n✓ 功能点表和目标端一致，没有要发的");
  if (!checkPlan(cloud.version)) return;
  return publishPatch();

  // ── 3 外发 ─────────────────────────────────────────────────────

  function checkPlan(revision) {
    const destination = publishDestinationInfo(gateway);
    const adapter = readEnv("PUBLISH_GATEWAY") || readEnv("PUBLISH_DESTINATION") || "docs-cli";
    const id = createHash("sha256").update(JSON.stringify({
      key, docId, folder, revision, destination, adapter, scope, absorb, redline, rewrite, rendered, sources, hashes,
    })).digest("hex");
    if (approved && approved !== id) stop("PRD、配图或目标端版本已变更，请重新出计划并确认");
    if (yes) return true;
    console.log(`\n这次没有写目标端。核对目标、密级与分享范围后运行 --yes --plan ${id}`);
    return false;
  }

  function intent() {
    gateway.setIntent?.(`publish the PRD for ${key} to the configured destination. The user reviewed the plan printed by builderharness prd and re-ran it with --yes.`);
  }

  async function publishWhole() {
    intent();
    let target = docId;
    let url = null;
    if (!target) {
      step("建文档");
      ({ docId: target, url } = await gateway.createBlankDoc({ title, ...(folder ? { folderId: folder } : {}) }));
    }
    const ids = { ...(docId ? reuse : {}) };
    const pending = shots.order.filter((k) => !ids[k]);
    if (pending.length) {
      step(`追图 ${pending.length} 张`);
      const files = pending.map((k) => shots.files[shots.order.indexOf(k)]);
      Object.assign(ids, alignImages(pending, await gateway.appendImages({ docId: target, files }), target));
    }
    const opsFile = path.join(outDir, "ops.json");
    await render(ids);
    step("写正文");
    await gateway.updateJsonml({ docId: target, opsFile, dryRun: true });
    await gateway.updateJsonml({ docId: target, opsFile });
    await finish(target, url, ids);
  }

  async function publishPatch() {
    intent();
    const ids = { ...planned };
    let fresh = [];
    if (toUpload.length) {
      step(`追图 ${toUpload.length} 张`);
      const files = toUpload.map((k) => shots.files[shots.order.indexOf(k)]);
      const got = alignImages(toUpload, await gateway.appendImages({ docId, files }), docId);
      Object.assign(ids, got);
      fresh = Object.values(got);
      await rememberUploads(got);
    }
    const body = await render(ids);
    // 追图之后目标端多了文末那几张临时图、版本也变了：重新读一次再算补丁
    const now = fresh.length ? await gateway.fetchJsonml(docId) : cloud;
    if (fresh.length) {
      // 临时图按段落认：追图前没有、追图后多出来的带图段落。文档里那几段的 imageId 不一定是追图返回的那个
      // （参考适配器实测：返回的 id 进了正文能用，文末那几段却是另一组 id），只按 id 认会漏删
      const before = new Set(topLevel(cloud.body).map((b) => b[1]?.id));
      const added = topLevel(now.body).filter((b) => b[0] !== "table" && imagesIn(b).length && !before.has(b[1]?.id)).map((b) => b[1].id);
      leftover.push(...added);
      await fs.writeFile(pendingFile, `${JSON.stringify([...new Set(leftover)])}\n`);
    }
    const p = patchOps({ localBody: body, cloudBody: now.body, base, redline });
    // 文末的临时图：这次追的，加上上次追了却没删掉的
    const temp = topLevel(now.body).filter((b) => isTemp(b, fresh));
    if (temp.length) p.ops.push({ op: "delete", anchors: temp.map((b) => b[1].id) });
    if (!p.ops.length) return console.log("\n✓ 功能点表和目标端一致，没有要发的");
    // 一次批量提交往往有操作数上限：相邻的删除并成一个，再分批（batchOps）；先把每批都试跑一遍再真提交
    const batches = batchOps(p.ops);
    const files = await Promise.all(
      batches.map(async (ops, i) => {
        const file = path.join(outDir, batches.length > 1 ? `patch-ops-${i + 1}.json` : "patch-ops.json");
        await fs.writeFile(file, `${JSON.stringify(ops, null, 2)}\n`);
        return file;
      }),
    );
    step(
      `补功能点表${redline ? "修订稿" : ""}：改写 ${p.summary.change} · 新增 ${p.summary.insert} · 删除 ${p.summary.delete}${p.summary.unmark ? ` · 去底色 ${p.summary.unmark}` : ""}${batches.length > 1 ? `（分 ${batches.length} 批提交）` : ""}`,
    );
    for (const opsFile of files) await gateway.updateJsonml({ docId, opsFile, dryRun: true });
    for (const opsFile of files) await gateway.updateJsonml({ docId, opsFile });
    await finish(docId, null, ids, { base, beforeBody: now.body, ops: p.ops, localBody: body });
  }

  /**
   * 追上去的图立刻记下：后面一步失败时，下次重跑直接复用这几张（不再追一遍），
   * 并认得出文末那几段临时图是自己留下的、一并删掉
   */
  async function rememberUploads(got) {
    const latest = await readJson(imagesFile, {});
    for (const [k, imageId] of Object.entries(got)) latest[k] = { imageId, hash: hashes[k] };
    await fs.writeFile(imagesFile, `${JSON.stringify(latest, null, 2)}\n`);
    const pending = await readJson(pendingFile, []);
    await fs.writeFile(pendingFile, `${JSON.stringify([...new Set([...pending, ...Object.values(got)])])}\n`);
  }

  /**
   * 回读核对四节与配图，记下下次的底稿，回写 FRS。
   * 补丁发布时底稿只记我们留下的段落（nextBase）：人改过、人删掉的照旧受保护，直到 --absorb
   */
  async function finish(target, url, ids, sent = null) {
    step("回读核对");
    const outline = (await gateway.fetchOutline(target)).map((i) => i.text ?? "");
    const lost = SECTIONS.filter((s) => !outline.some((t) => t.includes(s)));
    const after = await gateway.fetchJsonml(target);
    const used = tableParagraphs(after.body).flatMap(imagesIn);
    const foreign = used.filter((id) => !id.endsWith(target));
    const nextTexts = sent ? nextBase({ ...sent, afterBody: after.body }) : tableParagraphs(after.body).map(paraText);
    await fs.writeFile(path.join(outDir, "base.json"), `${JSON.stringify(nextTexts)}\n`);
    await fs.rm(pendingFile, { force: true });
    // 沿用的图记它当初传上去那一版的哈希：以后都和那一次发布的目标端版本比，不和某次重拍比
    const hashOf = (k) => (reuse[k] && ids[k] === reuse[k] ? recorded[k].hash : hashes[k]);
    await fs.writeFile(imagesFile, `${JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, { imageId: id, hash: hashOf(k) }])), null, 2)}\n`);

    const latest = JSON.parse(await fs.readFile(frsFile, "utf8"));
    latest.prdDocId = target;
    latest.updatedAt = today();
    await fs.writeFile(frsFile, `${JSON.stringify(latest, null, 2)}\n`);

    console.log(`\n✓ 已发布${redline ? "修订稿" : ""}（目标端第 ${after.version} 版，功能点表配图 ${used.length} 张）${url ? `：${url}` : ""}`);
    if (redline) console.log("  请人在目标端过目；确认后不带 --redline 再发一次定稿（划线的删掉、浅绿底去掉），人在修订稿上改过的会列进 cloud-edits.md");
    if (!docId) console.log(`  docId 已写回 FRS.json 的 prdDocId；之后再跑就是更新这一篇`);
    if (lost.length) console.log(`  ⚠️ 大纲里没找到：${lost.join("、")}，打开文档看一眼`);
    if (foreign.length) console.log(`  ⚠️ ${foreign.length} 张图的 imageId 不属于这篇文档，渲染时会挂：重跑一次会重新上传`);
    if (Object.keys(ids).length < shots.order.length) console.log("  ⚠️ 有图没传上，参考图列留了占位");
  }
}

const topLevel = (body) => (body[0] === "root" ? body.slice(2) : body);

/** 一个节点里所有配图的 imageId */
function imagesIn(node) {
  const out = [];
  (function walk(n) {
    if (!Array.isArray(n)) return;
    if (n[1]?.imageId) out.push(n[1].imageId);
    n.slice(2).forEach(walk);
  })(node);
  return out;
}

main().catch((e) => stop(e.message));
