import { proxy } from "valtio";

/**
 * 决策页的运行时状态
 * ------------------------------------------------------------------
 * README 是唯一真源：页面上的条目、结论、状态全由 dev 服务从 README 现读（server/decide-server.js），
 * 这里不留副本。PM 的决定走批注的收件箱（/__proto_review/upsert，kind: "decision"），
 * Agent 用 `review.mjs open` 看到、记进 README、再 resolve；README 一变服务推一声，页面重读。
 *
 * 地址里记着看到哪一份、哪一条（#<件套>/<编号>；「全部件套」里是 #all/<件套>/<编号>），刷新、转发都回到原处。
 * README 里的直达链接是 ?key=<件套>：打开就停在那份上；什么都不带进「全部件套」。
 */

const API = "/__decide/api";
const INBOX = "/__proto_review";
const AUTHOR_KEY = "proto-review-author";

export const STATUS_LABEL = {
  pending: "待定",
  submitted: "已提交待记录",
  decided: "已定",
  provisional: "暂留待确认",
  "needs-review": "问题变更，待复核",
};

export const decideState = proxy({
  /** @type {{key: string, title: string, counts: object}[]} */
  features: [],
  author: readAuthor(),
  key: null,
  feature: null,
  active: null,
  /** 左栏看的是「全部件套」：还没定的条目按谁来定汇在一起，右边的卡照样是所属那份的 */
  overview: false,
  loading: true,
  error: "",
  /** 点开的引用：{ kind, target, label, data, loading, error } */
  ref: null,
  /** 每张卡没提交的草稿，按「件套#编号」存：切到别的卡再回来还在 */
  drafts: {},
  notice: null,
});

function readAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) || "PM";
  } catch {
    return "PM";
  }
}

async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `读取失败（${r.status}）`);
  return j;
}

async function postJson(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `写入失败（${r.status}）`);
  return j;
}

export const itemsOf = (feature) => feature?.groups.flatMap((g) => g.items) ?? [];

/** 先看要你动手的：A 组待定 → 暂留待确认 → 其余组待定 → 第一条 */
function firstToDo(feature) {
  const all = itemsOf(feature);
  return (
    all.find((it) => it.group === "A" && it.status === "pending") ??
    all.find((it) => it.status === "provisional") ??
    all.find((it) => it.status === "pending") ??
    all[0]
  )?.id ?? null;
}

/** 「全部件套」的分组：按谁来定，评审会那组有才出 */
export const OVERVIEW_GROUPS = [
  { letter: "A", label: "待我拍板" },
  { letter: "B", label: "待问研发" },
  { letter: "C", label: "待问业务" },
  { letter: "D", label: "评审会上定" },
];

/** 各件套还没定的条目（待定、暂留待确认）按组汇总：⛔ 排前面，其余按件套顺序（待定多的在前）、表里的顺序 */
export function overviewOf(features) {
  const rows = features.flatMap((f, rank) => (f.open ?? []).map((it, k) => ({ ...it, key: f.key, title: f.title, rank, k })));
  return OVERVIEW_GROUPS.map((g) => ({
    ...g,
    items: rows.filter((r) => r.group === g.letter).sort((a, b) => b.blocking - a.blocking || a.rank - b.rank || a.k - b.k),
  })).filter((g) => g.letter !== "D" || g.items.length > 0);
}

const firstOpen = (features) => overviewOf(features).flatMap((g) => g.items)[0] ?? null;

/** #all/<件套>/<编号>、#<件套>/<编号>，都没有再看 ?key=；什么都不带进「全部件套」 */
function readLocation() {
  const parts = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  if (parts[0] === "all") return { overview: true, key: parts[1] ?? null, id: parts[2] ?? null };
  if (parts[0]) return { overview: false, key: parts[0], id: parts[1] ?? null };
  const key = new URLSearchParams(window.location.search).get("key");
  return { overview: !key, key: key || null, id: null };
}

function writeHash() {
  const { overview, key, active } = decideState;
  const next = `#${[overview && "all", key, active].filter(Boolean).join("/")}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

export function notify(text, kind = "success") {
  decideState.notice = { id: Date.now(), text, kind };
  const id = decideState.notice.id;
  setTimeout(() => decideState.notice?.id === id && (decideState.notice = null), kind === "error" ? 8000 : 3500);
}

async function loadFeature(key, keepActive) {
  const f = await getJson(`${API}/feature?key=${encodeURIComponent(key)}`);
  decideState.feature = f;
  decideState.key = key;
  const ids = new Set(itemsOf(f).map((it) => it.id));
  if (!keepActive || !ids.has(decideState.active)) decideState.active = firstToDo(f);
  writeHash();
}

export async function init() {
  const want = readLocation();
  try {
    const { features } = await getJson(`${API}/features`);
    decideState.features = features;
    const known = features.some((f) => f.key === want.key);
    if (want.key && !known) notify(`${want.key} 没有〈待决清单〉，先看全部件套`, "error");
    decideState.overview = want.overview || !known;
    // 全部件套：右边先摆地址里那张，没有就摆最该先看的一条
    const first = known ? { key: want.key, id: want.id } : decideState.overview ? firstOpen(features) : null;
    if (first) {
      decideState.active = first.id;
      await loadFeature(first.key, !!first.id);
    } else writeHash();
    decideState.error = "";
  } catch (e) {
    decideState.error = e.message;
  } finally {
    decideState.loading = false;
  }
}

/** README 或收件箱变了：重读，停在原来那一条 */
export async function refresh() {
  try {
    const { features } = await getJson(`${API}/features`);
    decideState.features = features;
    if (decideState.key) await loadFeature(decideState.key, true);
    decideState.error = "";
  } catch (e) {
    decideState.error = e.message;
  }
}

export async function openFeature(key, id = null) {
  decideState.ref = null;
  decideState.overview = false;
  decideState.active = id;
  try {
    await loadFeature(key, !!id);
  } catch (e) {
    notify(e.message, "error");
  }
}

/** 回到「全部件套」：右边那张卡留着，没有卡就摆最该先看的一条 */
export async function openOverview() {
  decideState.overview = true;
  if (decideState.feature) return writeHash();
  const first = firstOpen(decideState.features);
  if (first) await openFromOverview(first.key, first.id);
  else writeHash();
}

/** 在「全部件套」里点一条：打开所属那份的那张卡，左栏仍是全部件套 */
export async function openFromOverview(key, id) {
  decideState.ref = null;
  decideState.overview = true;
  if (key === decideState.key) return openItem(id);
  decideState.active = id;
  try {
    await loadFeature(key, true);
  } catch (e) {
    notify(e.message, "error");
  }
}

/** 手改地址、点了带 # 的链接：跟过去 */
export function followHash() {
  const want = readLocation();
  decideState.overview = want.overview;
  if (want.key && want.key !== decideState.key) {
    decideState.ref = null;
    decideState.active = want.id;
    loadFeature(want.key, !!want.id).catch((e) => notify(e.message, "error"));
  } else if (want.id && want.id !== decideState.active) openItem(want.id);
  else writeHash();
}

export function openItem(id) {
  decideState.active = id;
  writeHash();
}

export const EMPTY_DRAFT = Object.freeze({ choice: null, own: "", note: "", answer: "", source: "", reject: "", rejecting: false, editing: false });
export const draftKey = (id) => `${decideState.key}#${id}`;

export function setDraft(id, patch) {
  const k = draftKey(id);
  decideState.drafts[k] = { ...(decideState.drafts[k] ?? EMPTY_DRAFT), ...patch };
}

/** 格子原文 → 一行纯文字：清单里显示、复制给别人、记进锚点都用它。链接只留文字 */
export const plain = (s) =>
  String(s ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 提交一条决定。一条决定一条记录，锚点是件套 + 条目编号，带提交那一刻这一行的指纹：
 * Agent 记录前一比，就知道 PM 提交之后这一行有没有被改过。
 *
 * @param action  decide（A 组选了哪个）/ answer（B、C、D 问到的结果）/ reject（打回）
 */
export async function submit(item, { action, choice = null, body = "", source = "" }) {
  const f = decideState.feature;
  const mapped = { decide: "confirm", reject: "return", answer: "answer" }[action];
  const author = decideState.author.trim();
  if (!author) throw new Error("先填写确认人");
  await postJson(`${INBOX}/decisions/submit`, {
    key: f.key, item: item.id, version: item.version, action: mapped, author,
    body: action === "decide" ? choice.text : body.trim(),
    ...(choice ? { choice, note: body.trim() } : {}),
    source: source.trim(),
  });
  delete decideState.drafts[`${f.key}#${item.id}`];
  notify(action === "reject" ? `已打回 ${item.id}，等 Agent 改` : `已提交 ${item.id}，等 Agent 记进 README`);
  await refresh();
}

export async function withdraw(rec) {
  await postJson(`${INBOX}/decisions/withdraw`, { id: rec.id, key: rec.frs, author: decideState.author.trim() });
  notify("已撤回");
  await refresh();
}

/** 点开引用的那个按钮：关掉原文时焦点回到它，键盘用户不用从头 Tab */
let refTrigger = null;

/** 点开一处引用：同件套的另一条直接从手上的数据摆，其余问服务要原文 */
export async function openRef(ref) {
  if (!decideState.ref) refTrigger = document.activeElement;
  decideState.ref = { ...ref, data: null, loading: ref.kind !== "item", error: "" };
  if (ref.kind === "item") return;
  try {
    const q = new URLSearchParams({ key: decideState.key, kind: ref.kind, target: ref.target });
    const data = await getJson(`${API}/ref?${q}`);
    if (decideState.ref?.target === ref.target) decideState.ref = { ...decideState.ref, data, loading: false };
  } catch (e) {
    if (decideState.ref?.target === ref.target) decideState.ref = { ...decideState.ref, loading: false, error: e.message };
  }
}

export function closeRef() {
  decideState.ref = null;
  if (refTrigger?.isConnected) refTrigger.focus();
  refTrigger = null;
}

export async function copyText(text, done = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  notify(done);
}

export function setAuthor(value) {
  decideState.author = value;
  try { localStorage.setItem(AUTHOR_KEY, value); } catch { /* optional browser storage */ }
}
