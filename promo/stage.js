/**
 * 宣传物料的场景舞台（浏览器端，ES module）
 * ------------------------------------------------------------------
 * 一个需求的物料 = 几个场景。每个场景是一段时间轴：镜头对准哪个元素、几秒时点什么、标注贴在哪、显示到几秒。
 * 舞台把它变成画面。图层从下到上：
 *
 *   背景（白 / 浅底 / 深色渐变）→ 窗口（活的原型 iframe，可带标题栏、圆角、投影，整体做 3D 机位）
 *   → 标注、光标、拖进来的文件 → 字卡 → 白场
 *
 * 和截图拼接的区别，全在「原型是活的 DOM」上：
 *   - 镜头是对窗口的 3D 变换（平移、缩放、俯仰、偏转），推近多少倍字都是矢量；元素位置随时从 DOM 量。
 *   - **抽离（isolate）**：把一个组件从页面里拎出来——它的祖先背景、兄弟节点按时间淡掉，组件自己照常运行（能输入、能展开、会变），
 *     垫一张卡片浮在干净的背景上。说「怎么用」时，读者只看得到那一块。
 *   - **字卡（title）**：整屏的大字，逐字入场，关键词用产品主色；文案取自需求规格，转折处用。
 *   - **真鼠标、真键盘**：由渲染器（promo.mjs）渲染时，点击、悬停、输入走 CDP 的 Input 域——
 *     光标画在哪，浏览器就在哪做命中测试，按钮的 :hover / :active、输入框的焦点都是真的；
 *     点的位置被别的东西挡住时退回合成事件并报警。内置浏览器里直接预览时没有这条通道，用合成事件。
 *
 * 开拍前先**空跑一遍**时间轴：动作照做（合成事件），把每一刻要对准、要指向的元素位置记下来；再整页重来，按帧正式渲染。
 * 于是镜头可以提前对准一个还没打开的抽屉，光标在点击之前就滑到按钮上——位置全是元素的真实位置，不手量。
 *
 * 用法：docs/promo/<需求>/scenes.js 默认导出 { frs, viewport?, frame?, tilt?, backdrop?, css?, scenes: [...] }，dev 服务给这个目录一张通用的舞台页。
 * 顶层 css 每个场景都加（藏掉「原型」标记这类全片都要藏的），场景自己的 css 再叠在后面。
 * 场景：{ id, title, duration, route | from, where?, viewport?, frame?, tilt?, backdrop?, css?, prepare?, only?, timeline }
 *   from      需求件套里的截图配方（FRS.json 的 shots），PRD 截图和动图从同一份事实出发
 *   where     窗口标题栏上的字：入口路径，和导航上的字一模一样（如「评测集 / 创建评测集」）
 *   frame     "flat"（默认，原型铺满画布）| "window"（原型装进窗口，浮在背景上）
 *   tilt      [俯仰°, 偏转°]，镜头的默认角度；读字的镜头（推近、抽离）建议正视
 *   backdrop  "white" | "paper" | "deep"；frame 为 window 时默认 paper
 *   only      "film"：只进总片，不单独出 GIF / 海报（片头、片尾字卡）。没有 route / from 的场景就是纯字卡
 *   film      [起, 止]（秒）：总片里只取这一段。GIF 为了循环首尾都是字卡，拼进总片时砍掉收尾那张，免得和下一场的开场字卡连着出
 * 物料讲的是用户在线上看到的东西：原型比线上多的 Delta，用场景的 `css` 藏掉；原型比线上少的，在 `prepare` 里补（app.window 就是原型的 window）。
 *
 * 时间轴条目（at 秒）：
 *   { at, camera: 选择器 | [选择器…] | "page", fill?, scale?, tilt?, shift?: [dx, dy], frame?, move? }
 *       镜头在 at 时到位（之前 move 秒开始移动，默认 0.9）；数组＝框住它们全部；shift 是落点相对画布中心的偏移（画布 px）
 *   { at, until, isolate: 选择器, fill?, scale?, keep?, card?, camera? }
 *       抽离：at 起 0.6 秒把页面其余部分淡掉，只留这个组件（垫卡片、正视推近）；until 前 0.6 秒还原。
 *       keep: 0.15 = 其余部分留 15%（聚光而不是抽离）；card: false 不垫卡片；camera: false 不自动推近
 *   { at, until, title: "从本地文件<b>导入 Case</b>", kicker?, sub?, enter?: "rise" | "type", exit?: "rise" | "up" | "fade" | "cut", bg?: "white" | "paper" | "deep" | "none" }
 *       字卡：整屏大字，<b> 用产品主色；kicker 是标题上方一行小字（写入口路径）；enter 逐字升起（默认）或打字机；exit "up" 整块上移、露出下面的画面
 *   { at, hold: 2 }                                            定格：原型的时间停 2 秒（提示不消失、动画不走），镜头、标注照常动。
 *       用来给只停一两秒的真组件反馈（成功提示）留出读的时间——不改产品的行为，只是把那一刻拉长
 *   { at, backdrop: "deep", fade? }                           背景换色（交叉淡化）
 *   { at, until, note: 选择器, text, sub?, side? }             标注：贴在元素旁，at 淡入、until 淡出；text 可含 <b>
 *   { at, click | hover: 选择器 }                               光标先滑过去，再由真组件响应
 *   { at, type: 选择器, text, cps?, append? }                   光标点进输入框，逐字输入（默认每秒 14 个字）；append 接在原有内容后面，否则先清空
 *   { at, leave: 选择器 }  { at, press: 键 }  { at, state }  { at, steps: [配方步骤] }  { at, do: (app, ctx) => … }
 *   { at, drop: 选择器, file: (ctx, app) => File, chip: 文件名, then? }   光标带着文件从画外拖进来、松手
 *   { at, cursor: 选择器 | false }                              光标直接放到元素上 / 收起
 *   动作带 pointer: false：不画光标、没有涟漪（白场里换状态、首帧里看不见的悬停）
 *   { at, dip: 0.6 }                                           白场（以 at 为中点），换场景状态时用
 *   任一动作可带 then: 选择器——动作引起的异步工作（读文件、解压）完成前，虚拟时间停住等它
 */

import { openApp, setup, ease, lerp, progress } from "./kit.js";

const BAR = 40; // 窗口标题栏高（原型 CSS px，随镜头缩放）
const RADIUS = 14;
const PERSPECTIVE = 2200; // 透视距离（画布 px）：俯仰十来度时近大远小看得出、又不夸张
const ISO_RAMP = 0.6;
const BACKDROPS = ["white", "paper", "deep"];

// 配色一律取宿主的 --color-*（openApp 从原型根元素搬过来）；这里只是宿主没提供时的中性兜底，不是任何产品的色值
const CSS = `
:root { --color-primary: #3d6fb6; --color-danger: #c4372f; --color-text-title: #222; --color-text-secondary: #777; --color-border: #ddd; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { overflow: hidden; position: relative; background: #fff; color: var(--color-text-title);
  font-family: "PingFang SC", -apple-system, "Hiragino Sans GB", sans-serif; -webkit-font-smoothing: antialiased; }
/* 只有原型接收鼠标：真鼠标按画面上的位置做命中测试，上面这些图层不能挡 */
body > * { pointer-events: none; }
.pm-win, .pm-win > iframe { pointer-events: auto; }
.pm-bds { position: absolute; inset: 0; z-index: 0; }
.pm-bd { position: absolute; inset: 0; opacity: 0; }
.pm-bd-white { background: #fff; }
.pm-bd-paper { background:
  radial-gradient(70% 60% at 18% 12%, color-mix(in srgb, var(--color-primary) 9%, transparent), transparent 70%),
  radial-gradient(60% 60% at 88% 92%, color-mix(in srgb, var(--color-primary) 7%, transparent), transparent 70%),
  color-mix(in srgb, var(--color-primary) 3%, #f6f7f9); }
.pm-bd-deep { background:
  radial-gradient(80% 70% at 22% 18%, color-mix(in srgb, var(--color-primary) 55%, #0c1424), transparent 72%),
  radial-gradient(70% 70% at 85% 95%, color-mix(in srgb, var(--color-primary) 30%, #0c1424), transparent 70%),
  #0c1424; }
.pm-win { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.pm-win > * { position: absolute; }
.pm-shadow { left: 0; right: 0; bottom: 0; box-shadow: 0 40px 90px rgba(15, 23, 42, .22), 0 8px 24px rgba(15, 23, 42, .12), 0 0 0 1px rgba(15, 23, 42, .08); }
.pm-sheet { inset: 0; background: #fff; }
.pm-isocard { left: 0; top: 0; background: #fff; border-radius: 14px; opacity: 0;
  box-shadow: 0 30px 70px rgba(15, 23, 42, .16), 0 6px 18px rgba(15, 23, 42, .08), 0 0 0 1px rgba(15, 23, 42, .06); }
.pm-bar { left: 0; right: 0; display: flex; align-items: center; justify-content: center; background: #f3f4f6;
  border-bottom: 1px solid rgba(15, 23, 42, .08); font-size: 15px; color: var(--color-text-secondary); }
.pm-bar i { position: absolute; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; background: rgba(15, 23, 42, .16); }
.pm-bar i:nth-child(1) { left: 18px; } .pm-bar i:nth-child(2) { left: 38px; } .pm-bar i:nth-child(3) { left: 58px; }
.pm-win > iframe { left: 0; top: 0; border: 0; background: transparent; }
.pm-dip { position: absolute; inset: 0; background: #fff; opacity: 0; }
.pm-note { position: absolute; left: 0; top: 0; padding: 14px 18px; border-radius: 10px; background: #fff; opacity: 0;
  box-shadow: 0 12px 32px rgba(29, 33, 41, .18), 0 0 0 1px var(--color-border); font-size: 26px; line-height: 1.4; white-space: nowrap; }
.pm-note b { color: var(--color-primary); font-weight: 600; }
.pm-note b.bad { color: var(--color-danger); }
.pm-note small { display: block; margin-top: 2px; font-size: 21px; color: var(--color-text-secondary); }
svg.pm-lines { position: absolute; inset: 0; color: var(--color-primary); }
.pm-chip { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; background: #fff;
  font-size: 18px; opacity: 0; box-shadow: 0 10px 28px rgba(29, 33, 41, .2), 0 0 0 1px var(--color-border); }
.pm-chip i { width: 24px; height: 30px; border-radius: 3px; background: #1f9d55; display: grid; place-items: center; color: #fff; font: 600 13px/1 sans-serif; font-style: normal; }
.pm-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; opacity: 0; transform-origin: 5px 3px; }
.pm-ripple { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; opacity: 0;
  background: color-mix(in srgb, var(--color-primary) 30%, transparent); }
.pm-card { position: absolute; inset: 0; opacity: 0; display: grid; place-items: center; }
.pm-card > .pm-bd { opacity: 1; }
.pm-card-in { position: relative; text-align: center; padding: 0 96px; }
.pm-card-kicker { margin-bottom: 20px; font-size: 26px; letter-spacing: .04em; color: var(--color-text-secondary); }
.pm-card-title { font-size: 60px; line-height: 1.25; font-weight: 600; letter-spacing: .01em; white-space: pre-wrap; }
.pm-card-title .kw { color: var(--color-primary); }
.pm-card-title span { display: inline-block; white-space: pre; }
.pm-card-sub { margin-top: 20px; font-size: 32px; line-height: 1.5; color: var(--color-text-secondary); }
.pm-card-sub b { color: var(--color-text-title); font-weight: 600; }
.pm-card.on-deep .pm-card-title { color: #fff; }
.pm-card.on-deep .pm-card-title .kw { color: color-mix(in srgb, var(--color-primary) 45%, #fff); }
.pm-card.on-deep .pm-card-sub, .pm-card.on-deep .pm-card-kicker { color: rgba(255, 255, 255, .72); }
.pm-caret { display: inline-block; width: 3px; height: 1em; margin-left: 4px; vertical-align: -0.12em; background: var(--color-primary); }
`;

const CURSOR_SVG = `<svg viewBox="0 0 28 28"><path d="M5 3l16 10.5-7 1.6 4.2 8.2-3 1.5-4.2-8.3L5 22z" fill="#222" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const ACTIONS = ["click", "hover", "leave", "type", "press", "state", "steps", "do", "drop", "_char"];
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const lerpPt = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) });
const tri = (t, mid, len) => Math.max(0, 1 - Math.abs(t - mid) / (len / 2));

function el(tag, cls, html, parent = document.body) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html) n.innerHTML = html;
  parent.appendChild(n);
  return n;
}

const warnings = (window.__promoWarnings = window.__promoWarnings || []);
function warn(msg) {
  if (!warnings.includes(msg)) warnings.push(msg);
  console.warn(msg);
}

// ── 真鼠标、真键盘：渲染器装了 CDP 绑定才有（Runtime.addBinding），预览时退回合成事件 ──────────
const bridge = typeof window.__promoInput === "function";
const inflight = new Map();
let inputSeq = 0;
window.__promoInputDone = (id, error) => {
  const p = inflight.get(id);
  inflight.delete(id);
  if (p) error ? p.reject(new Error(error)) : p.resolve();
};
// 一条输入 6 秒（真实时间）没回音就跳过、记一条警告，不让整片卡死
const input = (msg) =>
  new Promise((resolve, reject) => {
    inputSeq += 1;
    const id = inputSeq;
    const timer = setTimeout(() => {
      if (!inflight.has(id)) return;
      inflight.delete(id);
      warn(`真输入 ${msg.type} 6 秒没回应，跳过了一次`);
      resolve();
    }, 6000);
    inflight.set(id, { resolve: () => (clearTimeout(timer), resolve()), reject: (e) => (clearTimeout(timer), reject(e)) });
    window.__promoInput(JSON.stringify({ id, ...msg }));
  });

// ── 字卡：拆成逐字的 span，<b> 里的字标成关键词 ─────────────────────────
function splitChars(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out = [];
  const walk = (node, kw) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) for (const ch of Array.from(n.textContent)) out.push({ ch, kw });
      else if (n.nodeName === "BR") out.push({ br: true });
      else walk(n, kw || n.nodeName === "B");
    }
  };
  walk(tpl.content, false);
  return out;
}

/**
 * 抽离：把 target 以外的部分按 amount（0–1）淡掉。每帧先还原、再按当前 amount 重设，只改不影响排版的样式
 * （透明度、背景色、边框色、投影），所以空跑量到的位置照样成立。
 */
function makeIsolator(app) {
  const touched = new Map();
  const set = (n, prop, value) => {
    let saved = touched.get(n);
    if (!saved) touched.set(n, (saved = {}));
    if (!(prop in saved)) saved[prop] = [n.style.getPropertyValue(prop), n.style.getPropertyPriority(prop)];
    n.style.setProperty(prop, value, "important");
  };
  const restore = () => {
    for (const [n, saved] of touched) {
      for (const [prop, [v, pr]] of Object.entries(saved)) {
        if (v) n.style.setProperty(prop, v, pr);
        else n.style.removeProperty(prop);
      }
      n.classList?.remove("pm-iso-anc");
    }
    touched.clear();
  };
  const fadeColor = (c, k) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return c;
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return `rgba(${r}, ${g}, ${b}, ${a * k})`;
  };
  let pseudo = null;
  return function apply(target, amount, keep = 0) {
    restore();
    if (!target || amount <= 0) return;
    const w = app.window;
    const doc = w.document;
    if (!pseudo || !pseudo.isConnected) {
      // 祖先的 ::before / ::after（表格外框线这类）改不了行内样式，用类名 + 变量一起淡
      pseudo = doc.createElement("style");
      pseudo.textContent = ".pm-iso-anc::before,.pm-iso-anc::after{opacity:var(--pm-iso-op,1)!important}";
      doc.head.appendChild(pseudo);
    }
    const chain = [];
    for (let n = target; n; n = n.parentElement) chain.push(n);
    const onChain = new Set(chain);
    const op = 1 - amount * (1 - keep);
    // 聚光（keep > 0）只压暗兄弟节点，祖先的底色留着——否则后面的页面会透上来，叠成一片重影
    const k = keep > 0 ? 1 : 1 - amount;
    set(doc.documentElement, "--pm-iso-op", String(op));
    for (const anc of chain.slice(1)) {
      for (const c of anc.children) {
        if (onChain.has(c) || c === pseudo || /^(SCRIPT|STYLE|LINK)$/.test(c.tagName)) continue;
        const own = parseFloat(w.getComputedStyle(c).opacity);
        set(c, "opacity", String(op * (Number.isNaN(own) ? 1 : own)));
      }
      anc.classList.add("pm-iso-anc");
      if (!touched.has(anc)) touched.set(anc, {});
      if (k === 1) continue;
      const cs = w.getComputedStyle(anc);
      set(anc, "background-color", fadeColor(cs.backgroundColor, k));
      if (cs.backgroundImage !== "none") set(anc, "background-image", "none");
      if (cs.boxShadow !== "none") set(anc, "box-shadow", "none");
      for (const side of ["top", "right", "bottom", "left"]) set(anc, `border-${side}-color`, fadeColor(cs.getPropertyValue(`border-${side}-color`), k));
    }
  };
}

export async function stage(config) {
  const q = new URLSearchParams(location.search);
  const W = config.width || 1280;
  const H = config.height || 720;
  const scenes = config.scenes || [];
  window.PROMO = { scenes: scenes.map((s) => ({ id: s.id, title: s.title, duration: s.duration, only: s.only || "", film: s.film || null })) };

  const id = q.get("scene");
  if (!id) {
    // 渲染器先来这一趟拿场景清单，再逐个打开；人打开就从第一个场景放起
    if (q.has("render")) window.__ready = true;
    else location.replace(`?scene=${scenes[0].id}`);
    return;
  }
  const scene = scenes.find((s) => s.id === id);
  if (!scene) throw new Error(`没有场景 ${id}`);
  // 原型按自己的视口排版（默认同画布）；比画布大时，全景是整页缩小装进画面，推近再放大
  const VP = scene.viewport || config.viewport || { width: W, height: H };
  const PW = VP.width;
  const PH = VP.height;
  const FRAME = scene.frame || config.frame || "flat";
  const TILT = scene.tilt || config.tilt || [0, 0];
  const BACKDROP = scene.backdrop || config.backdrop || (FRAME === "window" ? "paper" : "white");
  const hasApp = !!(scene.route || scene.from);
  document.title = `${scene.title || scene.id}`;

  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: CSS }));
  document.body.style.width = `${W}px`;
  document.body.style.height = `${H}px`;
  // 背景自成一层（z-index 0 的层叠上下文），里面几张交叉淡化时调 z-index 不会盖到窗口上
  const bdWrap = el("div", "pm-bds");
  const bds = Object.fromEntries(BACKDROPS.map((k) => [k, el("div", `pm-bd pm-bd-${k}`, "", bdWrap)]));
  const win = el("div", "pm-win");
  win.style.width = `${PW}px`;
  win.style.height = `${PH}px`;
  const shadow = el("div", "pm-shadow", "", win);
  shadow.style.top = `${-BAR}px`;
  const sheet = el("div", "pm-sheet", "", win);
  const isoCard = el("div", "pm-isocard", "", win);
  const bar = el("div", "pm-bar", `<i></i><i></i><i></i><span>${scene.where || ""}</span>`, win);
  bar.style.top = `${-BAR}px`;
  bar.style.height = `${BAR}px`;
  const frame = el("iframe", "", "", win);
  frame.id = "app";
  frame.title = "原型";
  frame.style.width = `${PW}px`;
  frame.style.height = `${PH}px`;
  // 纯字卡也要产品主色：照样把原型开在看不见的窗口里，只为搬它的 --color-*
  if (!hasApp) win.style.visibility = "hidden";
  const svg = el("svg", "pm-lines");
  svg.outerHTML = `<svg class="pm-lines" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`;
  const lines = document.querySelector("svg.pm-lines");
  const chip = el("div", "pm-chip");
  const ripple = el("span", "pm-ripple");
  const cursor = el("div", "pm-cursor", CURSOR_SVG);

  // 开场状态：需求件套里的截图配方 → 场景自己的 prepare
  let recipe = null;
  if (scene.from) {
    (window.__promoFeatures ??= []).push(config.frs);
    const frs = await fetch(`/__promo/frs/${encodeURIComponent(config.frs)}`).then((r) => {
      if (!r.ok) throw new Error(`FRS unavailable: ${config.frs}`);
      return r.json();
    });
    recipe = frs.shots[scene.from];
    if (!recipe) throw new Error(`${config.frs} 的截图配方里没有 ${scene.from}`);
  }
  const ctx = {};
  const opened = await openApp(frame, {
    route: hasApp ? scene.route || recipe.route : config.themeRoute || "/",
    async prepare(a) {
      if (!hasApp) return;
      if (config.css) a.css(config.css);
      if (scene.css) a.css(scene.css);
      if (recipe) await a.steps(recipe.steps);
      if (scene.prepare) await scene.prepare(a, ctx);
    },
  });
  const app = hasApp ? opened : null;

  // ── 时间轴：整理条目 ─────────────────────────────────────────
  const raw = (scene.timeline || []).map((e, i) => ({ ...e, i }));
  // 逐字输入：点进输入框，之后每个字一条动作
  for (const e of raw.filter((x) => x.type !== undefined)) {
    const cps = e.cps || 14;
    Array.from(e.text || "").forEach((ch, n) => raw.push({ at: e.at + 0.25 + n / cps, _char: e.type, parent: e, n, i: raw.length, pointer: false }));
    e.typeEnd = e.at + 0.25 + (e.text || "").length / cps;
  }
  // 抽离自带一个正视推近的镜头（camera: false 不要）
  for (const e of raw.filter((x) => x.isolate && x.camera !== false)) {
    raw.push({ at: e.at <= 0 ? 0 : e.at + ISO_RAMP, move: ISO_RAMP + 0.2, camera: e.isolate, fill: e.fill ?? 0.62, scale: e.scale, tilt: e.tilt || [0, 0], frame: e.frame, i: raw.length });
  }
  const entries = raw.sort((a, b) => a.at - b.at || a.i - b.i);
  // 定格：原型的时间轴在这些段里停住。时间轴的 t → 原型的虚拟时刻，减去 t 之前累计停了多久
  const holds = entries.filter((e) => e.hold);
  if (app && holds.length) app.timeMap = (t) => t - holds.reduce((sum, h) => sum + Math.min(Math.max(t - h.at, 0), h.hold), 0);
  const isAction = (e) => ACTIONS.some((k) => e[k] !== undefined);
  // pointer: false 的动作不画光标（白场里换状态、看不见的悬停）
  const pointerOf = (e) => (e.pointer === false ? null : e.click || e.hover || e.type || e.drop || (typeof e.cursor === "string" ? e.cursor : null));

  // ── 镜头 ───────────────────────────────────────────────────
  const fit = Math.min(W / PW, H / PH);
  const pageBox = { x: 0, y: 0, w: PW, h: PH };
  // 不让画面里露出原型之外的空白：平拍铺满时，放大倍数不小于整页装满，平移不越过页面边缘
  const clampAxis = (v, view, page, s) => (page * s <= view ? (view - page * s) / 2 : Math.min(0, Math.max(view - page * s, v)));
  function camFor(e) {
    const f = (e.frame || FRAME) === "window" ? 1 : 0;
    const [rx, ry] = e.tilt || TILT;
    const [dx, dy] = e.shift || [0, 0];
    const box = e.box;
    let s;
    let fx;
    let fy;
    if (box === pageBox) {
      s = e.scale || (f ? Math.min((W * 0.84) / PW, (H * 0.84) / (PH + BAR)) : fit);
      fx = PW / 2;
      fy = f ? (PH - BAR) / 2 : PH / 2;
    } else {
      const fill = e.fill ?? 0.72;
      s = Math.min(3.2, Math.max(f ? 0.2 : fit, e.scale || Math.min((W * fill) / box.w, (H * fill) / box.h)));
      fx = box.x + box.w / 2;
      fy = box.y + box.h / 2;
    }
    if (!f && !rx && !ry && !dx && !dy) {
      fx = (W / 2 - clampAxis(W / 2 - fx * s, W, PW, s)) / s;
      fy = (H / 2 - clampAxis(H / 2 - fy * s, H, PH, s)) / s;
    }
    return { fx, fy, s, rx, ry, dx, dy, f };
  }
  const mixCam = (a, b, p) => ({
    fx: lerp(a.fx, b.fx, p), fy: lerp(a.fy, b.fy, p), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), p)),
    rx: lerp(a.rx, b.rx, p), ry: lerp(a.ry, b.ry, p), dx: lerp(a.dx, b.dx, p), dy: lerp(a.dy, b.dy, p), f: lerp(a.f, b.f, p),
  });
  let camKeys = [];
  const home = () => camFor({ box: pageBox });
  function camera(t) {
    if (!camKeys.length) return home();
    if (t <= camKeys[0][0]) return camKeys[0][1];
    for (let n = 1; n < camKeys.length; n += 1) {
      const [t1, c1] = camKeys[n];
      if (t <= t1) {
        const [t0, c0] = camKeys[n - 1];
        return mixCam(c0, c1, ease.inOut(progress(t, t0, t1)));
      }
    }
    return camKeys[camKeys.length - 1][1];
  }
  /** 镜头 → 变换矩阵。俯仰、偏转为 0 时用 2D 矩阵：不升合成层，推近时文字按新倍率重新栅格化，不发虚 */
  function matrix(c) {
    let m = new DOMMatrix().translate(W / 2 + c.dx, H / 2 + c.dy);
    if (Math.abs(c.rx) > 0.01 || Math.abs(c.ry) > 0.01) {
      const p = new DOMMatrix();
      p.m34 = -1 / PERSPECTIVE;
      m = m.multiply(p).rotateAxisAngle(1, 0, 0, c.rx).rotateAxisAngle(0, 1, 0, c.ry);
    }
    return m.scale(c.s, c.s).translate(-c.fx, -c.fy);
  }
  let curCam = null;
  let curM = null;
  function applyCamera(c) {
    curCam = c;
    curM = matrix(c);
    win.style.transform = curM.toString();
  }
  const project = (m, p) => {
    const r = m.transformPoint(new DOMPoint(p.x, p.y, 0, 1));
    return { x: r.x / r.w, y: r.y / r.w };
  };
  const projectBox = (m, b) => {
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => project(m, { x, y }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  // ── 动作：空跑用合成事件；正式渲染时有 CDP 通道就走真鼠标、真键盘 ───────────
  let live = false;
  const real = () => live && bridge && !scene.synthetic;
  async function realClick(sel, t, visible = true) {
    const target = app.find(sel);
    if (!target) throw new Error(`第 ${t} 秒：原型里找不到 «${sel}»`);
    const b = app.box(sel);
    const pt = center(b);
    const hit = app.window.document.elementFromPoint(pt.x, pt.y);
    // iView 固定列会把整行再画一份盖在上面：点到的是「孪生」（同类名、同文字），真点下去效果一样
    const cls = target.classList[0];
    const twin = cls && hit && hit.closest(`.${window.CSS.escape(cls)}`);
    const same = twin && twin.textContent.trim() === target.textContent.trim();
    applyCamera(camera(t));
    const sp = project(curM, pt);
    const onCanvas = sp.x >= 0 && sp.y >= 0 && sp.x <= W && sp.y <= H;
    if (!hit || !(hit === target || target.contains(hit) || same) || !onCanvas) {
      // 看不见的动作（pointer: false，白场里换状态）在画外是有意的，不报
      if (visible || onCanvas) {
        const why = !onCanvas ? "在画面外" : `被 «${hit ? String(hit.className || hit.tagName).split(" ")[0] : "页面外"}» 挡住`;
        warn(`第 ${t} 秒：«${sel}» 的中心${why}，这一下改用合成点击`);
      }
      await app.click(sel);
      return;
    }
    await input({ type: "click", x: sp.x, y: sp.y });
    await app.flush();
  }
  async function realMove(sel, t) {
    const b = app.box(sel);
    if (!b) throw new Error(`第 ${t} 秒：原型里找不到 «${sel}»`);
    applyCamera(camera(t));
    const sp = project(curM, center(b));
    await input({ type: "move", x: sp.x, y: sp.y });
    await app.flush();
  }
  const away = async () => {
    await input({ type: "move", x: W + 40, y: H + 40 });
    await app.flush();
  };

  async function perform(e, a) {
    if (e.click) await (real() ? realClick(e.click, e.at, e.pointer !== false) : a.click(e.click));
    else if (e.hover) await (real() ? realMove(e.hover, e.at) : a.hover(e.hover));
    else if (e.leave) {
      if (real()) await away();
      await a.leave(e.leave);
    } else if (e.type !== undefined) {
      // append: true 接在原有内容后面打（光标挪到末尾）；否则先清空
      const field = () => {
        const n = a.find(e.type);
        return n && (n.matches("input,textarea") ? n : n.querySelector("input,textarea"));
      };
      if (!e.append) await a.type(e.type, "");
      if (real()) {
        await realClick(e.type, e.at);
        if (e.append) await input({ type: "key", key: "End" });
        await a.flush();
      } else await a.focus(e.type);
      e.base = e.append && field() ? field().value : "";
      a.caret(true);
    } else if (e._char !== undefined) {
      const chars = Array.from(e.parent.text);
      if (real()) {
        await input({ type: "text", text: chars[e.n] });
        await a.flush();
      } else await a.type(e._char, e.parent.base + chars.slice(0, e.n + 1).join(""));
    } else if (e.press) {
      if (real()) {
        a.window.focus();
        await input({ type: "key", key: e.press });
        await a.flush();
      } else await a.press(e.press);
    } else if (e.state) await a.setState(e.state);
    else if (e.steps) await a.steps(e.steps);
    else if (e.do) await e.do(a, ctx);
    else if (e.drop) await a.drag(e.drop, "drop", e.file(ctx, a));
    if (e.then) await a.until(e.then);
  }
  // 拖文件之前，上传区先亮起来（真组件的 dragover 样式）
  const extra = entries.filter((e) => e.drop).map((e) => ({ at: e.at - 0.45, do: (a) => a.drag(e.drop, "dragover"), i: -1 }));
  const typeEnds = entries.filter((e) => e.typeEnd).map((e) => ({ at: e.typeEnd + 0.8, do: (a) => a.caret(false), i: -1 }));
  const timeline = [...entries.filter(isAction), ...extra, ...typeEnds].sort((a, b) => a.at - b.at);

  // ── 空跑一遍，记下每一刻要对准、要指向的位置 ───────────────────────
  // 镜头目标：选择器、"page"、一个盒子，或几个选择器（框住它们全部）
  const boxOf = (target) => {
    if (target === "page" || !target) return pageBox;
    if (Array.isArray(target)) {
      const bs = target.map((x) => app.box(x));
      if (bs.some((x) => !x)) return null;
      const x0 = Math.min(...bs.map((x) => x.x));
      const y0 = Math.min(...bs.map((x) => x.y));
      return { x: x0, y: y0, w: Math.max(...bs.map((x) => x.x + x.w)) - x0, h: Math.max(...bs.map((x) => x.y + x.h)) - y0 };
    }
    return typeof target === "object" ? target : app.box(target);
  };
  if (app) {
    const times = [...new Set([...entries.map((e) => e.at), ...extra.map((e) => e.at), ...typeEnds.map((e) => e.at)])].sort((a, b) => a - b);
    for (const t of times) {
      await app.advanceTo(Math.max(0, t));
      for (const e of entries) if (e.at === t && pointerOf(e)) e.pointBox = app.box(pointerOf(e));
      for (const e of timeline) if (e.at === t) await perform(e, app);
      for (const e of entries) {
        if (e.at !== t) continue;
        if (e.camera !== undefined && e.camera !== false) e.box = boxOf(e.camera);
        if (e.note) e.box = app.box(e.note);
        if (e.isolate && !app.box(e.isolate)) throw new Error(`第 ${e.at} 秒：原型里找不到要抽离的 «${e.isolate}»`);
        if (e.box === null) throw new Error(`第 ${e.at} 秒：原型里找不到 «${e.camera || e.note}»`);
      }
      for (const e of entries) if (e.at === t && pointerOf(e) && !e.pointBox) throw new Error(`第 ${e.at} 秒：光标要去的 «${pointerOf(e)}» 不在页面上`);
    }
    await app.reset();
  }

  const cams = entries.filter((e) => e.camera !== undefined && e.camera !== false && e.box).map((e) => ({ at: e.at, move: e.move ?? 0.9, cam: camFor(e) }));
  camKeys = [];
  cams.forEach((c, n) => {
    if (n === 0) camKeys.push([c.at, c.cam]);
    else camKeys.push([Math.max(c.at - c.move, cams[n - 1].at), cams[n - 1].cam], [c.at, c.cam]);
  });

  // ── 光标：关键点要么钉在页面上（随镜头走），要么钉在画布上（从画外进来）；段内在画布坐标里缓动 ──────
  const curKeys = [];
  let last = null;
  const push = (t, k, o) => curKeys.push({ t, ...k, o });
  for (const e of entries) {
    if (e.cursor === false) {
      if (last) push(e.at, { p: last }, 1), push(e.at + 0.25, { p: last }, 0);
      last = null;
      continue;
    }
    if (!pointerOf(e)) continue;
    const to = center(e.pointBox);
    if (typeof e.cursor === "string") {
      push(e.at, { p: to }, 1);
      last = to;
      continue;
    }
    const glide = e.glide ?? (e.drop ? 1.1 : 0.7);
    const prevT = curKeys.length ? curKeys[curKeys.length - 1].t : 0;
    const t0 = Math.max(prevT + 0.1, e.at - glide);
    if (last) push(t0, { p: last }, 1);
    else {
      // 收起之后再出现：先在画外不透明度 0 落一个点，隐藏的那一段才不会淡入
      const off = { sp: { x: W - 80, y: H + 40 } };
      push(t0, off, 0);
      push(t0 + 0.12, off, 1);
    }
    push(e.at, { p: to }, 1);
    last = to;
    e.glideFrom = t0;
  }
  const where = (k, m) => k.sp || project(m, k.p);
  function cursorAt(t, m) {
    if (!curKeys.length || t < curKeys[0].t) return { p: null, o: 0 };
    for (let n = 1; n < curKeys.length; n += 1) {
      const a = curKeys[n - 1];
      const b = curKeys[n];
      if (t <= b.t) {
        const p = b.t > a.t ? progress(t, a.t, b.t) : 1;
        return { p: lerpPt(where(a, m), where(b, m), ease.inOut(p)), o: lerp(a.o, b.o, p) };
      }
    }
    const z = curKeys[curKeys.length - 1];
    return { p: where(z, m), o: z.o };
  }

  // ── 标注 ───────────────────────────────────────────────────
  const notes = entries.filter((e) => e.note).map((e) => {
    const n = el("div", "pm-note", `${e.text}${e.sub ? `<small>${e.sub}</small>` : ""}`);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.innerHTML = `<line stroke="currentColor" stroke-width="2"/><circle r="4" fill="currentColor"/>`;
    lines.appendChild(g);
    return { e, n, g };
  });
  const M = 24;
  const GAP = 30;
  function placeNote({ e, n, g }, o) {
    const T = projectBox(curM, app.box(e.note) || e.box);
    const w = n.offsetWidth;
    const h = n.offsetHeight;
    const cx = T.x + T.w / 2;
    const cy = T.y + T.h / 2;
    // 连线起点离开元素边缘几像素，圆点不压在被指的东西上
    const off = 6;
    const options = {
      below: { x: cx - w / 2, y: T.y + T.h + GAP, from: { x: cx, y: T.y + T.h + off }, to: (b) => ({ x: cx, y: b.y }) },
      above: { x: cx - w / 2, y: T.y - GAP - h, from: { x: cx, y: T.y - off }, to: (b) => ({ x: cx, y: b.y + h }) },
      right: { x: T.x + T.w + GAP, y: cy - h / 2, from: { x: T.x + T.w + off, y: cy }, to: (b) => ({ x: b.x, y: cy }) },
      left: { x: T.x - GAP - w, y: cy - h / 2, from: { x: T.x - off, y: cy }, to: (b) => ({ x: b.x + w, y: cy }) },
    };
    const fits = (b) => b.x >= M && b.y >= M && b.x + w <= W - M && b.y + h <= H - M;
    const order = e.side ? [e.side] : ["below", "above", "right", "left"];
    const pick = options[order.find((k) => fits(options[k])) || order[0]];
    const b = { x: Math.min(W - M - w, Math.max(M, pick.x)), y: Math.min(H - M - h, Math.max(M, pick.y)) };
    const lift = (1 - o) * 10;
    n.style.transform = `translate(${b.x}px, ${b.y + lift}px)`;
    n.style.opacity = o;
    const end = pick.to(b);
    const [line, dot] = g.children;
    line.setAttribute("x1", pick.from.x); line.setAttribute("y1", pick.from.y);
    line.setAttribute("x2", Math.min(b.x + w, Math.max(b.x, end.x))); line.setAttribute("y2", Math.min(b.y + h, Math.max(b.y, end.y)) + lift);
    dot.setAttribute("cx", pick.from.x); dot.setAttribute("cy", pick.from.y);
    g.style.opacity = o;
  }

  // ── 抽离 ───────────────────────────────────────────────────
  const isolator = app ? makeIsolator(app) : () => {};
  const isos = entries.filter((e) => e.isolate);
  function isoAt(t) {
    for (const e of isos) {
      const until = e.until ?? scene.duration + 1;
      if (t < e.at || t > until) continue;
      const fadeIn = e.at <= 0 ? 1 : progress(t, e.at, e.at + ISO_RAMP);
      return { e, amount: ease.inOut(Math.min(fadeIn, 1 - progress(t, until - ISO_RAMP, until))) };
    }
    return { e: null, amount: 0 };
  }

  // ── 字卡 ───────────────────────────────────────────────────
  const cards = entries.filter((e) => e.title).map((e) => {
    const bg = e.bg || (e.exit === "up" ? "none" : BACKDROP === "deep" ? "deep" : "white");
    const root = el("div", `pm-card${bg === "deep" ? " on-deep" : ""}`);
    const bgEl = bg === "none" ? null : el("div", `pm-bd pm-bd-${bg}`, "", root);
    const box = el("div", "pm-card-in", "", root);
    const kicker = e.kicker ? el("div", "pm-card-kicker", e.kicker, box) : null;
    const title = el("div", "pm-card-title", "", box);
    const chars = splitChars(e.title).map((c) => (c.br ? el("br", "", "", title) : el("span", c.kw ? "kw" : "", c.ch.replace(/&/g, "&amp;").replace(/</g, "&lt;"), title)));
    const spans = chars.filter((n) => n.tagName === "SPAN");
    const caret = e.enter === "type" ? el("span", "pm-caret", "", title) : null;
    const sub = e.sub ? el("div", "pm-card-sub", e.sub, box) : null;
    return { e, root, bgEl, box, kicker, spans, caret, sub };
  });
  function renderCard(c, t) {
    const { e } = c;
    const until = e.until ?? scene.duration;
    if (t < e.at || t > until) {
      c.root.style.opacity = 0;
      return;
    }
    c.root.style.opacity = 1;
    const n = c.spans.length;
    const exit = e.exit || "rise";
    const outLen = exit === "up" ? 0.7 : exit === "cut" ? 0 : 0.45;
    const out = outLen ? ease.in(progress(t, until - outLen, until)) : 0;
    if (c.bgEl) c.bgEl.style.opacity = (e.at <= 0 ? 1 : progress(t, e.at, e.at + 0.25)) * (exit === "cut" ? 1 : 1 - progress(t, until - 0.3, until));
    let typed = n;
    if (e.enter === "type") {
      const cps = e.cps || 12;
      typed = Math.min(n, Math.floor(Math.max(0, t - e.at - 0.2) * cps));
      c.spans.forEach((s, i) => (s.style.display = i < typed ? "" : "none"));
      // 打字时光标常亮，打完按 1 Hz 闪（t 的函数，不靠 CSS 动画）
      const blink = typed < n || Math.floor((t - e.at) * 2) % 2 === 0;
      c.caret.style.opacity = blink && out < 0.5 ? 1 : 0;
    } else {
      const stagger = Math.min(0.045, 0.7 / Math.max(1, n));
      c.spans.forEach((s, i) => {
        const p = e.at <= 0 ? 1 : ease.out(progress(t, e.at + 0.1 + i * stagger, e.at + 0.6 + i * stagger));
        const ot = exit === "rise" ? ease.in(progress(t, until - outLen + i * stagger * 0.4, until - outLen + 0.3 + i * stagger * 0.4)) : 0;
        s.style.opacity = p * (1 - ot);
        s.style.transform = `translateY(${(1 - p) * 0.45 - ot * 0.35}em)`;
        s.style.filter = p < 1 ? `blur(${(1 - p) * 6}px)` : "none";
      });
    }
    if (c.kicker) {
      const p = e.at <= 0 && e.enter !== "type" ? 1 : ease.out(progress(t, e.at + 0.05, e.at + 0.45));
      c.kicker.style.opacity = p * (1 - (exit === "rise" ? out : 0));
      c.kicker.style.transform = `translateY(${(1 - p) * 10}px)`;
    }
    const allIn = e.enter === "type" ? e.at + 0.2 + n / (e.cps || 12) : e.at + 0.6 + n * Math.min(0.045, 0.7 / Math.max(1, n));
    if (c.sub) {
      const p = e.at <= 0 && e.enter !== "type" ? 1 : ease.out(progress(t, allIn, allIn + 0.4));
      c.sub.style.opacity = p * (1 - (exit === "rise" ? out : 0));
      c.sub.style.transform = `translateY(${(1 - p) * 12}px)`;
    }
    c.box.style.opacity = exit === "fade" ? 1 - out : 1;
    c.box.style.transform = exit === "up" ? `translateY(${-out * H * 0.7}px)` : "";
  }

  // ── 背景 ───────────────────────────────────────────────────
  const bdKeys = [{ at: -1, k: BACKDROP, fade: 0 }, ...entries.filter((e) => e.backdrop).map((e) => ({ at: e.at, k: e.backdrop, fade: e.fade ?? 0.6 }))];
  function renderBackdrop(t) {
    let cur = bdKeys[0];
    let prev = null;
    for (const k of bdKeys) if (k.at <= t) (prev = cur), (cur = k);
    for (const k of BACKDROPS) {
      bds[k].style.zIndex = 0;
      bds[k].style.opacity = 0;
    }
    if (prev && prev.k !== cur.k) bds[prev.k].style.opacity = 1;
    bds[cur.k].style.zIndex = 1;
    bds[cur.k].style.opacity = cur.fade ? progress(t, cur.at, cur.at + cur.fade) : 1;
  }

  const drops = entries.filter((e) => e.drop);
  const clicks = entries.filter((e) => e.click && e.pointer !== false);
  const dips = entries.filter((e) => e.dip);
  const dip = el("div", "pm-dip");
  for (const c of cards) document.body.insertBefore(c.root, dip);
  const place = (n, x, y, o, s = 1) => {
    n.style.transform = `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ""}`;
    n.style.opacity = o;
  };
  let cursorNow = { p: null, o: 0 };
  let mouseAt = null;

  const ids = scenes.map((s) => s.id);
  await setup({
    width: W, height: H, duration: scene.duration, fps: config.fps || 30, poster: scene.poster ?? 0.8,
    gifWidth: config.gifWidth || 960, gifFps: config.gifFps || 15, maxMb: config.maxMb || 5,
    app,
    actions: timeline.map((e) => [e.at, (a) => perform(e, a)]),
    onLoop() {
      const next = ids[(ids.indexOf(id) + 1) % ids.length];
      if (next === id) return false;
      location.replace(`?scene=${next}`);
      return true;
    },
    render(t) {
      live = true;
      renderBackdrop(t);
      dip.style.opacity = Math.max(0, ...dips.map((e) => tri(t, e.at, typeof e.dip === "number" ? e.dip : 0.6)));
      for (const c of cards) renderCard(c, t);
      if (!app) return;

      const cam = camera(t);
      applyCamera(cam);
      const iso = isoAt(t);
      const target = iso.e ? app.find(iso.e.isolate) : null;
      isolator(target, iso.amount, iso.e ? iso.e.keep || 0 : 0);
      const chrome = cam.f * (1 - iso.amount);
      const r = RADIUS * cam.f;
      bar.style.opacity = chrome;
      shadow.style.opacity = chrome;
      shadow.style.borderRadius = `${r}px`;
      bar.style.borderRadius = `${r}px ${r}px 0 0`;
      frame.style.borderRadius = sheet.style.borderRadius = `0 0 ${r}px ${r}px`;
      sheet.style.opacity = 1 - iso.amount * (1 - (iso.e?.keep || 0));
      const pad = iso.e?.pad ?? 16;
      if (target && iso.amount > 0 && iso.e.card !== false) {
        const b = app.box(iso.e.isolate);
        // 卡片跟着组件自己的不透明度走：弹窗关闭时内容淡出，卡片不能留成一块空白
        let seen = 1;
        for (let n = target; n && n.nodeType === 1; n = n.parentElement) seen *= Number(app.window.getComputedStyle(n).opacity) || 0;
        Object.assign(isoCard.style, { opacity: iso.amount * seen, width: `${b.w + pad * 2}px`, height: `${b.h + pad * 2}px`, transform: `translate(${b.x - pad}px, ${b.y - pad}px)` });
      } else isoCard.style.opacity = 0;

      for (const x of notes) {
        const until = x.e.until ?? Infinity;
        // 开场就有的标注不淡入：首帧要带着它（群聊里没点开只看得到这一帧），循环接缝也不闪
        const fadeIn = x.e.at <= 0 ? 1 : progress(t, x.e.at, x.e.at + 0.3);
        const o = Math.min(fadeIn, 1 - progress(t, until - 0.25, until));
        if (o > 0) placeNote(x, o);
        else {
          x.n.style.opacity = 0;
          x.g.style.opacity = 0;
        }
      }

      const c = cursorAt(t, curM);
      cursorNow = c;
      if (c.p) {
        // 推近时光标跟着变大一点，和画面里的按钮成比例
        const grow = Math.min(2.4, Math.max(1, (cam.s / fit) ** 0.6));
        const hit = clicks.find((e) => t >= e.at && t < e.at + 0.4);
        const press = hit ? 1 - 0.12 * tri(t, hit.at + 0.06, 0.24) : 1;
        place(cursor, c.p.x - 5, c.p.y - 3, c.o, grow * press);
        const carrying = drops.find((e) => t >= e.glideFrom && t <= e.at + 0.05);
        if (carrying) {
          chip.innerHTML = `<i>X</i>${carrying.chip || "数据.xlsx"}`;
          place(chip, c.p.x + 16 * grow, c.p.y + 12 * grow, Math.min(1, progress(t, carrying.glideFrom, carrying.glideFrom + 0.2)));
        } else chip.style.opacity = 0;
        if (hit) {
          ripple.style.transform = `translate(${c.p.x}px, ${c.p.y}px) scale(${(0.4 + progress(t, hit.at, hit.at + 0.4) * 0.9) * grow})`;
          ripple.style.opacity = 1 - progress(t, hit.at, hit.at + 0.4);
        } else ripple.style.opacity = 0;
      } else {
        cursor.style.opacity = 0;
        chip.style.opacity = 0;
        ripple.style.opacity = 0;
      }
    },
    // 每帧画完：真鼠标跟着画出来的光标走，悬停态因此和画面一致（只在渲染器里，预览没有 CDP 通道）
    async sync() {
      if (!app || !bridge || !live || scene.synthetic) return;
      const c = cursorNow;
      if (!c.p || c.o < 0.5) return;
      if (mouseAt && Math.abs(mouseAt.x - c.p.x) < 0.5 && Math.abs(mouseAt.y - c.p.y) < 0.5) return;
      mouseAt = c.p;
      await input({ type: "move", x: c.p.x, y: c.p.y });
      await app.flush();
    },
  });
}
