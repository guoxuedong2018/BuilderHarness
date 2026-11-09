import { inRange, matchValues } from "./conditions.js";

/** Configure each field with kind, key, label and a row accessor. */
function matchOne(def, row, cond) {
  if (def.kind === "enum") return matchValues(cond, new Set(def.values(row)));
  if (def.kind === "numberRange") return inRange(def.number(row), cond.values);
  if (def.kind === "keyword" || def.kind === "text") {
    const raw = def.text(row);
    if (cond.op === "exists") return raw != null && String(raw).trim().length > 0;
    const t = String(raw ?? "");
    const v = String(cond.values[0] ?? "");
    return cond.op === "eq" ? t === v : t.includes(v);
  }
  if (def.kind === "dateRange") {
    const day = def.date(row);
    const [from, to] = cond.values;
    return Boolean(day) && (!from || day >= from) && (!to || day <= to);
  }
  return true;
}

export function matchFacets(defs, row, conditions) {
  return (conditions || []).every((cond) => {
    const def = defs.find((d) => d.key === cond.field);
    return def ? matchOne(def, row, cond) : true;
  });
}

function enumField(def, defs, pool, conditions, counts, locale) {
  const mine = conditions.find((c) => c.field === def.key);
  const seen = new Set([...(def.options || []), ...(mine ? mine.values : [])]);
  if (!def.options) pool.forEach((r) => def.values(r).forEach((v) => seen.add(v)));
  const list = def.options ? [...seen] : [...seen].sort(def.sort || ((a, b) => String(a).localeCompare(String(b), locale)));
  const field = { key: def.key, label: def.label, group: def.group, kind: "enum", multi: Boolean(def.multi) };
  if (!counts) return { ...field, options: list.map((value) => ({ value })) };

  const rest = mine && mine.op === "all" ? conditions : conditions.filter((c) => c.field !== def.key);
  const tally = new Map(list.map((v) => [v, 0]));
  pool
    .filter((r) => matchFacets(defs, r, rest))
    .forEach((r) => new Set(def.values(r)).forEach((v) => tally.set(v, (tally.get(v) || 0) + 1)));
  return { ...field, options: list.map((value) => ({ value, count: tally.get(value) || 0 })) };
}

/**
 * `fields` 供渲染候选项，`rows` 为过滤后的结果。
 * @param defs        字段定义（见文件头）
 * @param pool        筛选栏条件已经筛过的那批
 * @param conditions  当前生效的分面条件
 */
export function facetsOf(defs, pool, conditions = [], { counts = true, locale } = {}) {
  const fields = defs.map((def) => {
    if (def.kind === "enum") return enumField(def, defs, pool, conditions, counts, locale);
    const base = { key: def.key, label: def.label, group: def.group, kind: def.kind };
    if (def.kind === "numberRange") return { ...base, unit: def.unit || "", presets: def.presets || null };
    return base;
  });
  return { fields, rows: pool.filter((r) => matchFacets(defs, r, conditions)) };
}
