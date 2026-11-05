#!/usr/bin/env node
/**
 * FRS 件套一致性校验
 * ------------------------------------------------------------------
 * spec 是 PRD 功能点表的唯一真源，它一旦和 acceptance / 路由表漂移，
 * 导出的 PRD 就会带着错误的验收编号和不存在的页面发给研发。这里把漂移拦在构建期。
 *
 * 硬失败：
 *   - 功能点引用了不存在的 AC 编号
 *   - 功能点没挂任何 AC，或四类规则全空
 *   - spec / shots 的路由不在 原型工程的 frs-map.js 里
 *   - 引用了未定义的截图 key
 *   - 有 spec 但 background 为空
 *
 * 提醒（不失败）：
 *   - 有 AC 没被任何功能点覆盖
 *   - 定义了却没被引用的截图
 *   - 草案里标了 planned 的分组：页面还没建（新页面要先定规格再画原型）
 *
 * 没有 spec 字段的历史件套整份跳过，不阻塞既有需求。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { FEATURES_DIR, WEB_DIR } from "./lib/paths.mjs";

const FRS_MAP = path.join(WEB_DIR, "src", "config", "frs-map.js");

const RULE_FIELDS = ["display", "interaction", "value", "permission"];

const errors = [];
const notices = [];

function fail(key, message) {
  errors.push(`${key}: ${message}`);
}
function note(key, message) {
  notices.push(`${key}: ${message}`);
}

/** 收集一条规则（含嵌套 children）里引用到的截图 key */
function shotRefs(rule) {
  if (typeof rule === "string") return [];
  if (rule.shot) return [rule.shot];
  return (rule.children ?? []).flatMap(shotRefs);
}

function normalizeRoute(route) {
  return String(route ?? "").split("?")[0].split("#")[0];
}

async function knownRoutes() {
  const { FRS_REGISTRY } = await import(`file://${FRS_MAP}`);
  return new Set(FRS_REGISTRY.flatMap((entry) => entry.routes).filter((r) => r !== "*"));
}

function checkFeature(key, frs, routes) {
  if (!Array.isArray(frs.spec) || frs.spec.length === 0) return false;

  const acIds = new Set(
    (frs.acceptance ?? []).map((line) => String(line).match(/^(AC\d+)/)?.[1]).filter(Boolean),
  );
  const shotDefs = frs.shots ?? {};
  const usedAc = new Set();
  const usedShots = new Set();
  const pointIds = new Set();

  if ((frs.background?.problem ?? []).length === 0) {
    fail(key, "有 spec 但 background.problem 为空，PRD 的「解决什么问题」会是空章节");
  }
  if ((frs.background?.solution ?? []).length === 0) {
    fail(key, "有 spec 但 background.solution 为空，PRD 的「如何解决」会是空章节");
  }

  const entryRoute = normalizeRoute(frs.prototype?.entryRoute);
  if (entryRoute && !routes.has(entryRoute)) {
    fail(key, `prototype.entryRoute «${entryRoute}» 不在 frs-map.js 的 routes 里`);
  }

  for (const group of frs.spec) {
    const label = group.group ?? "(未命名分组)";
    const route = normalizeRoute(group.route);
    if (!route) fail(key, `分组「${label}」缺 route`);
    else if (group.planned && frs.status === "draft") {
      if (routes.has(route)) note(key, `分组「${label}」的页面已登记，去掉 planned 标记`);
      else note(key, `分组「${label}」的页面 «${route}» 还没建，画原型时三处登记`);
    } else if (!routes.has(route)) fail(key, `分组「${label}」的 route «${route}» 不在 frs-map.js 里`);

    for (const shot of group.shots ?? []) if (typeof shot === "string") usedShots.add(shot); // 对象是人插的图，不是配方

    if ((group.points ?? []).length === 0) fail(key, `分组「${label}」没有功能点`);

    for (const point of group.points ?? []) {
      const id = point.id ?? "(缺 id)";
      if (!point.id) fail(key, `分组「${label}」下有功能点缺 id`);
      else if (pointIds.has(point.id)) fail(key, `功能点 id ${point.id} 重复`);
      pointIds.add(point.id);

      const filled = RULE_FIELDS.filter((f) => Array.isArray(point[f]) && point[f].length > 0);
      if (filled.length === 0) {
        fail(key, `功能点 ${id} 四类规则全空——显示、交互、取值至少要有一类写清楚`);
      }
      for (const field of RULE_FIELDS) {
        for (const rule of point[field] ?? []) shotRefs(rule).forEach((s) => usedShots.add(s));
      }

      if ((point.ac ?? []).length === 0) {
        fail(key, `功能点 ${id} 没有挂验收标准，规则与 AC 必须双向可追溯`);
      }
      for (const ac of point.ac ?? []) {
        usedAc.add(ac);
        if (!acIds.has(ac)) fail(key, `功能点 ${id} 引用了不存在的验收标准 ${ac}`);
      }
    }
  }

  for (const shot of usedShots) {
    if (!shotDefs[shot]) fail(key, `引用了未定义的截图 key «${shot}»，请在 FRS.shots 里补配方`);
  }
  for (const [shot, def] of Object.entries(shotDefs)) {
    if (!usedShots.has(shot)) note(key, `截图 «${shot}» 定义了但没被任何功能点引用`);
    const route = normalizeRoute(def.route);
    if (!route) fail(key, `截图 «${shot}» 缺 route`);
    else if (!routes.has(route)) fail(key, `截图 «${shot}» 的 route «${route}» 不在 frs-map.js 里`);
    if (!def.caption) fail(key, `截图 «${shot}» 缺 caption，它同时是图片的可访问名称`);
  }

  const uncovered = [...acIds].filter((ac) => !usedAc.has(ac));
  if (uncovered.length > 0) {
    note(key, `${uncovered.length} 条验收标准没被功能点覆盖：${uncovered.join("、")}`);
  }

  return true;
}

async function main() {
  const routes = await knownRoutes();
  const entries = await fs.readdir(FEATURES_DIR, { withFileTypes: true }).catch(() => []);

  let checked = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(FEATURES_DIR, entry.name, "FRS.json");
    let frs;
    try {
      frs = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") fail(entry.name, `FRS.json 解析失败：${err.message}`);
      continue;
    }
    if (checkFeature(entry.name, frs, routes)) checked += 1;
    else skipped += 1;
  }

  for (const line of notices) console.log(`  提醒 ${line}`);
  if (errors.length > 0) {
    console.error("\nFRS 校验未通过：");
    for (const line of errors) console.error(`  ✗ ${line}`);
    console.error("");
    process.exitCode = 1;
    return;
  }
  console.log(`✓ FRS 校验通过（${checked} 份件套已写 spec，${skipped} 份尚未写）`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
