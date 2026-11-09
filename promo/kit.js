/**
 * 宣传物料画面页的小工具（浏览器端，ES module）
 * ------------------------------------------------------------------
 * 合成页（docs/promo/<物料>/index.html）由 dev 服务伺服在 /__promo/<物料>/，和原型同源。它只做一件事：
 * 给定时刻 t，把那一帧画出来。渲染器（pipeline/promo.mjs）逐帧调它、逐帧截图。
 *
 * 主角是**活的原型**：`openApp()` 把原型页面嵌进来（地址带 promo + clock），产品代码照常运行，
 * 时间由虚拟时钟（clock.js）按帧拨动。点击、悬停交给真组件去响应——抽屉用它自己的过渡滑出、
 * 提示气泡按它自己的延时出现；镜头与标注按元素的**实时位置**摆，选择器与截图、录屏同一套引擎
 * （`text=`、`field=`、CSS，含源码坐标 `[data-comp=…]` / `[data-loc^=…]`）。
 *
 * 合成页自己画的（镜头、标注、光标、标题）一律写成 t 的函数：不用 Date.now()、Math.random()、CSS transition。
 *
 * 用法：
 *   import { setup, openApp, at, fade, frameOn, ease } from "/__promo/kit/kit.js";
 *   const app = await openApp(document.getElementById("app"), { route: "/eval-task-new/detail?id=8801", prepare });
 *   setup({ width: 1280, height: 720, duration: 10, app, actions: [[5.2, (a) => a.click("text=关闭")]], render(t) { … } });
 *
 * 内置浏览器打开 /__promo/<物料>/ 会实时循环播放；带 ?t=3.2 停在那一帧；带 ?render 由渲染器接管。
 */

/** 三次贝塞尔缓动，同 CSS cubic-bezier */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i += 1) {
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= (sx(u) - x) / d;
    }
    return sy(Math.min(1, Math.max(0, u)));
  };
}

/**
 * 工具型产品用的缓动只有这几种：沉稳、不弹（专业信赖档，video-shotcraft 的品牌→动效推导表）。
 * 落地要有分量时用 settle（≤2% 的过冲），别的地方都不弹。
 */
export const ease = {
  standard: bezier(0.2, 0, 0, 1),
  out: bezier(0, 0, 0.2, 1),
  inOut: bezier(0.4, 0, 0.2, 1),
  in: bezier(0.4, 0, 1, 1),
  settle: bezier(0.3, 1.02, 0.4, 1),
  linear: (x) => x,
};

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, p) => a + (b - a) * p;
/** t 在 [t0, t1] 里走到哪了（0–1，两头钳住）；t0 = t1 时是一步跳变 */
export const progress = (t, t0, t1) => (t1 <= t0 ? (t >= t0 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));
/** 从 a 补间到 b */
export const tween = (t, t0, t1, a, b, e = ease.standard) => lerp(a, b, e(progress(t, t0, t1)));

/**
 * 关键帧：[[时刻, 值], …]，段内按 e 补间，值可以是数字或同形的数字对象（{x, y, s}）
 * 例：at(t, [[0, {x:0, s:1}], [3.2, {x:0, s:1}], [4.2, {x:-300, s:2.4}]])
 */
export function at(t, keys, e = ease.standard) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const p = e(progress(t, t0, t1));
      if (typeof v0 === "number") return lerp(v0, v1, p);
      const out = {};
      for (const k of Object.keys(v0)) out[k] = lerp(v0[k], v1[k], p);
      return out;
    }
  }
  return keys[keys.length - 1][1];
}

/** 一段内的淡入淡出：[in0, in1] 淡入，[out0, out1] 淡出 */
export const fade = (t, in0, in1, out0 = Infinity, out1 = Infinity) => Math.min(progress(t, in0, in1), 1 - progress(t, out0, out1));

/** 读 capture 出来的坐标表 */
export async function loadLayout(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`读不到 ${url}：确认配方的素材路径`);
  return r.json();
}

/**
 * 相机：把页面坐标里的一块（box）摆到视窗（view，{w,h}）正中，放大到占视窗 fill 的比例。
 * 返回 {x, y, s}：给页面层写 transform: translate(x,y) scale(s)，transform-origin 0 0。
 */
export function frameOn(box, view, fill = 0.8, maxScale = 4) {
  const s = Math.min(maxScale, (view.w * fill) / box.w, (view.h * fill) / box.h);
  return { x: view.w / 2 - (box.x + box.w / 2) * s, y: view.h / 2 - (box.y + box.h / 2) * s, s };
}

/** 一屏页面的全景机位：整页刚好塞进视窗 */
export const overview = (page, view) => frameOn({ x: 0, y: 0, w: page.width, h: page.height }, view, 1);

/** 保持放大倍数 s，把 box 摆到视窗正中：几处特写用同一档放大，摇镜头时视线只平移、不忽大忽小 */
export const centerOn = (box, view, s) => ({ x: view.w / 2 - (box.x + box.w / 2) * s, y: view.h / 2 - (box.y + box.h / 2) * s, s });

function report(e) {
  window.__promoError = String((e && e.stack) || e);
  console.error(e);
}

const realFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把原型页面嵌进来，等它把数据取完、画面停稳，再跑一遍 prepare（开场前要处于的状态，如「抽屉已打开」）。
 * 返回的 app 句柄就是时间轴里的动作与取位置的入口。
 *
 * @param {HTMLIFrameElement} frame  合成页里的 <iframe>，宽高 = 原型的视口
 * @param {{ route: string, prepare?: (app) => Promise<void>, settle?: number }} opts
 */
export async function openApp(frame, { route, prepare, settle = 600 } = {}) {
  const config = await fetch("/__promo/config").then((r) => r.json());
  // 渲染器据此记下牵涉的源码，源码一变 `promo.mjs status` 就报这份物料该重渲
  (window.__promoRoutes = window.__promoRoutes || []).push(route);
  let win = null;
  let start = 0;
  let loads = 0;

  const find = (sel) => (win && win.__protoFind ? win.__protoFind(sel) : null);
  // 开场准备（prepare、截图配方）时，动作先等元素出现再做；正式时间轴上不等——空跑已经证明它在
  let preparing = false;
  const ready = async (sel) => {
    if (preparing && !find(sel)) await app.waitFor(sel);
  };
  const must = (sel) => {
    const el = find(sel);
    if (!el) throw new Error(`原型里找不到 «${sel}»`);
    return el;
  };
  /** 悬停：从元素往上逐层 mouseenter（不冒泡，Tooltip、表格行都挂在外层），再冒泡一个 mouseover */
  const pointer = (el, enter) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    const Ev = win.MouseEvent;
    const opts = { bubbles: false, cancelable: true, view: win };
    (enter ? chain.slice().reverse() : chain).forEach((n) => n.dispatchEvent(new Ev(enter ? "mouseenter" : "mouseleave", opts)));
    el.dispatchEvent(new Ev(enter ? "mouseover" : "mouseout", { ...opts, bubbles: true }));
  };
  const clock = () => win.__promoClock;

  async function load() {
    // 每次带个序号：同一个带 # 的地址再设一遍，浏览器当成页内跳转、不重新加载，load 永远等不到
    loads += 1;
    if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("\\")) throw new Error("Expected a local prototype route");
    const url = new URL(config.routeMode === "history" ? route : "/", location.origin);
    url.searchParams.set("promo", "1");
    url.searchParams.set("clock", "1");
    url.searchParams.set("load", String(loads));
    if (config.routeMode !== "history") url.hash = route;
    frame.src = url.href;
    await new Promise((r) => frame.addEventListener("load", r, { once: true }));
    win = frame.contentWindow;
    if (!win.__promoClock) throw new Error("原型里没有虚拟时钟：dev 服务没注入 clock.js（enable promo in the Vite plugin）");
    win.eval(`${config.selectorHelper}\nwindow.__protoFieldSelector = ${JSON.stringify(config.fieldSelector)};\n${config.stateInjector || ""}`);
    const style = win.document.createElement("style");
    // 输入光标平时藏起来（它按真实时间闪，每次渲染不一样）；逐字输入时打开，`caret-animation: manual` 让它常亮不闪
    style.textContent = ".bk-root,.review-bar{display:none!important}html:not(.pm-caret) *{caret-color:transparent!important}"
      + "html.pm-caret *{caret-color:var(--color-primary,#3d6fb6)!important;caret-animation:manual!important}";
    win.document.head.appendChild(style);
    // 一边拨时间一边等网络：mock 的加载延时、取演示素材都在这里走完
    // 「停稳」要同时满足：请求回完、DOM 不再变、没有新的资源加载完（路由组件是按需加载的模块，fetch 计数看不到它），
    // 且这样持续了 400ms 真实时间——几个浏览器并行渲时 dev 服务变慢，只数轮次会在页面挂载之前就当成停稳（2026-11-05）
    let size = -1;
    let res = -1;
    let since = 0;
    for (let i = 0; i < 600; i += 1) {
      await clock().advance(50);
      await sleep(15);
      const now = win.document.body.innerHTML.length;
      const loaded = win.performance.getEntriesByType("resource").length;
      const still = clock().pending === 0 && now === size && loaded === res && clock().now >= settle;
      if (!still) since = performance.now();
      else if (performance.now() - since >= 400) break;
      size = now;
      res = loaded;
    }
    // 等图解码完，但最多等 3 秒：loading="lazy" 的图在视口外永远不加载，decode() 永远不回（2026-11-05 评测 Case 缩略图）
    const decoded = Promise.all(Array.from(win.document.images).map((i) => (i.complete ? null : i.decode().catch(() => null))));
    await Promise.race([decoded, sleep(3000)]);
    preparing = true;
    try {
      if (prepare) await prepare(app);
    } finally {
      preparing = false;
    }
    start = clock().now;
  }

  const app = {
    /** 按选择器找原型里的元素（同截图录屏一套引擎）；找不到给 null */
    find,
    /** 元素在原型视口里的位置（CSS px）；找不到给 null */
    box(sel) {
      const el = find(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    /** 时间轴的 t（秒）对应的虚拟时刻 */
    async advanceTo(t) {
      // timeMap：舞台的定格（hold）把时间轴的 t 映射到原型的虚拟时刻
      const target = start + (app.timeMap ? app.timeMap(t) : t) * 1000;
      if (target > clock().now) await clock().advance(target - clock().now);
    },
    /** 动作：都在当前时刻发生，产品代码自己决定接下来怎么动 */
    click: async (sel) => (await ready(sel), clock().act(() => must(sel).click())),
    hover: async (sel) => (await ready(sel), clock().act(() => pointer(must(sel), true))),
    leave: async (sel) => (await ready(sel), clock().act(() => pointer(must(sel), false))),
    type: async (sel, text) => {
      await ready(sel);
      return clock().act(() => {
        const el = must(sel);
        const input = el.matches("input,textarea") ? el : el.querySelector("input,textarea");
        const proto = Object.getPrototypeOf(input);
        Object.getOwnPropertyDescriptor(proto, "value").set.call(input, text);
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
      });
    },
    /** 让动作引起的更新落地：排下的微任务跑完、新冒出来的 CSS 过渡对齐到当前虚拟时刻 */
    flush: () => clock().act(() => {}),
    /** 把焦点放进输入框（合成事件版的「点进去」） */
    focus: async (sel) => {
      await ready(sel);
      return clock().act(() => {
        const el = must(sel);
        const target = el.matches("input,textarea,[contenteditable]") ? el : el.querySelector("input,textarea,[contenteditable]") || el;
        target.focus();
      });
    },
    /** 显示 / 藏起输入光标 */
    caret: (on) => win.document.documentElement.classList.toggle("pm-caret", !!on),
    /** 往原型里加一段样式：原型比线上多的东西（还没上线的 Delta）在物料里藏掉，每次加载都要重加，放在 prepare 里 */
    css(text) {
      const style = win.document.createElement("style");
      style.textContent = text;
      win.document.head.appendChild(style);
    },
    /** 翻页面的状态开关（适配器的状态注入，同截图配方的 state） */
    setState: (patch) => clock().act(() => win.__protoSetState(patch)),
    /** 做一份原型那一侧的文件（File 要在 iframe 的 realm 里造，组件里的 instanceof 才认） */
    file: (parts, name, type = "") => new win.File([].concat(parts), name, { type }),
    /**
     * 拖拽：在元素上派 dragenter / dragover / drop（带文件），上传区的拖入高亮、松手后的解析都由组件自己处理。
     * type 为 "drop" 时必须给 file。
     */
    drag: async (sel, type, file) => {
      await ready(sel);
      return clock().act(() => {
        const dt = new win.DataTransfer();
        if (file) dt.items.add(file);
        must(sel).dispatchEvent(new win.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
    },
    /**
     * 等一件不归时钟管的事做完（读文件、解压、解码），虚拟时间停在原地：结果落在动作发生的那一刻，每次渲染都一样。
     * cond 是选择器（出现即可）或函数（返回 true）。不要拿它等网络——时间轴里不安排要等网络的动作。
     */
    async until(cond, timeout = 10000) {
      const ok = typeof cond === "function" ? cond : () => !!find(cond);
      const deadline = performance.now() + timeout;
      while (!ok(win)) {
        if (performance.now() > deadline) throw new Error(`等了 ${timeout}ms 还没等到 ${typeof cond === "string" ? `«${cond}»` : "条件成立"}`);
        await sleep(20);
      }
      await clock().act(() => {});
    },
    /** 在开场前或动作之间让时间走一段（毫秒） */
    wait: (ms) => clock().advance(ms),
    /** 等元素出现：一边拨时间一边等（mock 的加载延时、异步读文件都等得到） */
    async waitFor(sel, timeout = 8000) {
      const deadline = performance.now() + timeout;
      while (!find(sel)) {
        if (performance.now() > deadline) throw new Error(`等不到 «${sel}»`);
        await clock().advance(50);
        await sleep(15);
      }
    },
    /** 往文件框里放一份文件，等同于用户选了它 */
    upload: async (sel, file) => {
      await ready(sel);
      return clock().act(() => {
        const input = must(sel);
        const dt = new win.DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      });
    },
    /** 在当前焦点上按一个键（Enter、Escape、ArrowDown……） */
    press: (key) =>
      clock().act(() => {
        const el = win.document.activeElement || win.document.body;
        for (const type of ["keydown", "keyup"]) el.dispatchEvent(new win.KeyboardEvent(type, { key, bubbles: true }));
      }),
    /** 需求件套 fixtures/ 下的示例文件，做成原型那一侧的 File */
    async fixture(rel) {
      const r = await fetch(`/__promo/fixture?path=${encodeURIComponent(rel)}`);
      if (!r.ok) throw new Error(`读不到示例文件 ${rel}`);
      return app.file(await r.blob(), rel.split("/").pop());
    },
    /**
     * 照截图配方的步骤走一遍（docs/features/<KEY>/FRS.json 的 shots[].steps，与 capture-shots 同一套写法）：
     * click / hover / fill / press / state / upload / wait，每步可带 waitFor，之后停 settle 毫秒（默认 300，虚拟时间）。
     */
    async steps(list = []) {
      for (const s of list) {
        if (s.click) await app.click(s.click);
        else if (s.hover) await app.hover(s.hover);
        else if (s.fill) await app.type(s.fill.selector, s.fill.text);
        else if (s.press) await app.press(s.press);
        else if (s.state) await app.setState(s.state);
        else if (s.upload) await app.upload(s.upload.selector, await app.fixture(s.upload.file));
        else if (s.wait) await app.wait(s.wait);
        if (s.waitFor) await app.waitFor(s.waitFor);
        await app.wait(s.settle ?? 300);
      }
    },
    /** 往回拨只能从头再来：重新加载、重跑 prepare */
    reset: load,
    /** 把原型的主题色（--color-*）搬到合成页：标注、标题用的就是产品此刻的配色 */
    adoptTheme(root = document.documentElement) {
      const cs = win.getComputedStyle(win.document.documentElement);
      for (let i = 0; i < cs.length; i += 1) {
        const k = cs[i];
        if (k.startsWith("--color-")) root.style.setProperty(k, cs.getPropertyValue(k));
      }
    },
    get window() {
      return win;
    },
  };

  await load();
  app.adoptTheme();
  return app;
}

/**
 * 登记画面。渲染器读 window.PROMO 定尺寸与时长，按 t 递增逐帧调 window.__promoSeek(t)。
 * poster：海报帧的时刻。群聊里没点开之前只看得到它，标题必须在这一帧读得清。
 * app + actions：时间轴上对活原型做的动作 [[秒, (app) => …], …]，按时间顺序在那一刻发生。
 * sync(t)：每帧 render 之后、截图之前调一次（可以是异步的），如让真鼠标挪到画出来的光标处。
 */
export async function setup({ width, height, duration, fps = 30, poster = 0, gifWidth, gifFps, maxMb, scale, app, actions = [], render, sync, onLoop }) {
  window.PROMO = { ...(window.PROMO || {}), width, height, duration, fps, poster, gifWidth, gifFps, maxMb, scale };
  const timeline = actions.slice().sort((a, b) => a[0] - b[0]);
  let last = 0;
  let next = 0;

  async function seek(t) {
    if (app) {
      if (t < last) {
        await app.reset();
        next = 0;
      }
      while (next < timeline.length && timeline[next][0] <= t) {
        const [at, fn] = timeline[next];
        await app.advanceTo(at);
        await fn(app);
        next += 1;
      }
      await app.advanceTo(t);
    }
    last = t;
    render(t);
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t * 1000;
    }
    // 画完之后的收尾（舞台用它让真鼠标跟上画出来的光标）
    if (sync) await sync(t);
  }

  let busy = Promise.resolve();
  window.__promoSeek = (t) => {
    busy = busy.then(() => seek(t)).catch(report);
    return busy;
  };
  window.__promoPaint = realFrame;

  try {
    await (document.fonts ? document.fonts.ready : null);
    await Promise.all(Array.from(document.images).map((i) => (i.complete ? null : i.decode().catch(() => null))));
  } catch (e) {
    report(e);
  }
  const q = new URLSearchParams(location.search);
  await window.__promoSeek(q.has("t") ? Number(q.get("t")) : app ? 0 : poster);
  window.__ready = true;
  if (q.has("render") || q.has("t")) return;
  // 直接打开时按真实时间循环播放，方便边改边看；渲染时不走这里
  let t0 = performance.now();
  for (;;) {
    await realFrame();
    let t = (performance.now() - t0) / 1000;
    if (t >= duration) {
      // 多场景预览：一圈放完交给下一个场景（onLoop 返回 true 就不再从头放）
      if (onLoop && onLoop()) return;
      t0 = performance.now();
      t = 0;
    }
    await window.__promoSeek(t);
  }
}

window.addEventListener("error", (e) => report(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => report(e.reason));
