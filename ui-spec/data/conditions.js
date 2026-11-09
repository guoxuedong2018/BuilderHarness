/** Match set, scalar and range conditions in a faceted list. */
export const CONDITION_OPS = {
  any: { label: "任一", hint: "勾上的值有一个就算" },
  all: { label: "全部", hint: "勾上的值都要有" },
  none: { label: "不含", hint: "没勾的值一个都不能有" },
  eq: { label: "等于", hint: "整个值一致" },
  contains: { label: "包含", hint: "值里有这段文字" },
  exists: { label: "有值", hint: "填了值就算，不管是什么" },
};

export const TEXT_OPS = ["eq", "contains", "exists"];
export const KEYWORD_OPS = ["contains", "eq"];

const isNum = (v) => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v));

/** 数值区间的写法：「5–10 秒」「≥ 30 秒」「≤ 5 秒」 */
export function rangeLabel(values, unit = "") {
  const [lo, hi] = values || [];
  const u = unit ? ` ${unit}` : "";
  if (isNum(lo) && isNum(hi)) return Number(lo) === Number(hi) ? `${lo}${u}` : `${lo}–${hi}${u}`;
  if (isNum(lo)) return `≥ ${lo}${u}`;
  if (isNum(hi)) return `≤ ${hi}${u}`;
  return "";
}

/** 一个数落不落在区间里：两端都含，空的一端不限；没有值的记录不命中 */
export function inRange(n, values) {
  if (!isNum(n)) return false;
  const [lo, hi] = values || [];
  return (!isNum(lo) || Number(n) >= Number(lo)) && (!isNum(hi) || Number(n) <= Number(hi));
}

/** 可枚举的值：任一 / 全部 / 不含。`have` 是这条记录在这个字段上的值（Set） */
export function matchValues(cond, have) {
  if (cond.op === "all") return cond.values.every((v) => have.has(v));
  const hit = cond.values.some((v) => have.has(v));
  return cond.op === "none" ? !hit : hit;
}

/** 树字段：节点值 → 显示名。同一棵树里重名的节点写成「父 / 子」路径 */
function treeNames(field) {
  const seen = new Map();
  const all = [];
  const walk = (nodes, trail) =>
    nodes.forEach((n) => {
      const path = [...trail, n.label];
      all.push([n.value, n.label, path]);
      seen.set(n.label, (seen.get(n.label) || 0) + 1);
      if (n.children) walk(n.children, path);
    });
  walk(field.nodes || [], []);
  return new Map(all.map(([v, label, path]) => [v, seen.get(label) > 1 ? path.join(" / ") : label]));
}

/** 条件里一个值的显示名：树字段存的是节点值（标签 id），要换成名字 */
export function valueLabel(field, value) {
  if (!field || field.kind !== "tree") return value;
  return treeNames(field).get(value) || String(value);
}

/**
 * 生效条件里的一句话：字段 + 运算 + 值，排除一定写出来（「画风风格 不含：写实」），不只摆一个值。
 * 同名字段使用组名区分。
 */
export function conditionLabel(cond, fields) {
  const list = fields || [];
  const f = list.find((x) => x.key === cond.field);
  const clash = f && list.some((x) => x.key !== f.key && x.label === f.label);
  const name = f ? (clash ? `${f.group}·${f.label}` : f.label) : cond.field;
  if (f && f.kind === "numberRange") return `${name}：${rangeLabel(cond.values, f.unit)}`;
  const vals = cond.values.map((v) => valueLabel(f, v)).join("、");
  if (cond.op === "none") return `${name} 不含：${vals}`;
  if (cond.op === "all") return `${name} 同时有：${vals}`;
  if (cond.op === "eq") return `${name} = ${vals}`;
  if (cond.op === "contains") return `${name} 包含 ${vals}`;
  if (cond.op === "exists") return `${name} 有值`;
  if (cond.op === "between") return `${name}：${cond.values[0] || "…"} 至 ${cond.values[1] || "…"}`;
  return `${name}：${vals}`;
}
