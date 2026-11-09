/**
 * 虚拟时钟：让活的原型「只在被要求时才往前走」
 * ------------------------------------------------------------------
 * dev 服务在原型地址带 `clock` 时把本文件插到 <head> 最前面（server/promo-server.js），抢在产品的任何脚本之前
 * 接管页面看得到的全部时间：
 *
 *   setTimeout / setInterval / requestAnimationFrame / performance.now / Date —— 换成虚拟时间，
 *   CSS 过渡与动画（document.getAnimations()）—— 发现即暂停，每一步按虚拟时间拨到该在的位置。
 *
 * 于是产品自己的代码照常运行：点了按钮，iView 抽屉用它自己的过渡滑出来，Vue 的 nextTick、
 * Tooltip 的延时、加载态都照旧发生——只是时间由渲染器逐帧拨动。每一帧是确定的，渲两次一模一样，
 * 帧率、分辨率随便定，不像录屏那样掉帧、卡顿或拍到半截。
 *
 * 顺带隔离本地存储（见下）。不接管的：网络。渲染器开拍前先等请求全部回来（`__promoClock.pending`），时间轴里不安排要等网络的动作。
 *
 * 普通脚本（不是 module）：同步执行、不能 import。
 */
(function installPromoClock() {
  if (window.__promoClock) return;
  if (!/[?&#]clock(=|&|$)/.test(location.href)) return;

  const real = {
    setTimeout: window.setTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
    fetch: window.fetch ? window.fetch.bind(window) : null,
    Date: window.Date,
  };
  // 固定纪元：页面里显示的「现在」每次都一样（2026-10-20 10:00 北京时间）
  const EPOCH = Date.UTC(2026, 9, 20, 2, 0, 0);
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const frames = new Map();
  const started = new WeakMap();
  let pending = 0;

  window.setTimeout = function (fn, ms, ...args) {
    const id = ++seq;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.setInterval = function (fn, ms, ...args) {
    const id = ++seq;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = ++seq;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  performance.now = () => now;
  // 事件的时间戳也走虚拟时间。Vue 2 绑监听时记下 performance.now()，事件到来时比 e.timeStamp，
  // 早于绑定时刻的事件直接丢掉（防微任务竞态的那段 fix）；浏览器给的 timeStamp 是真实时间，
  // 页面真实跑得比虚拟时间短时，点击就被当成「绑定之前的事件」吃掉——渲染快慢不同，结果就不同（2026-10-28 实测）
  Object.defineProperty(Event.prototype, "timeStamp", { get: () => now, configurable: true });

  class PromoDate extends real.Date {
    constructor(...a) {
      if (a.length) super(...a);
      else super(EPOCH + now);
    }
    static now() {
      return EPOCH + now;
    }
  }
  window.Date = PromoDate;

  // 本地存储换成只在内存里的一份：原型的 mock 数据、抽屉宽度、主题偏好都从干净状态开始，每次加载一样；
  // 场景里「另存为新评测集」这类写操作也不会写进同源的 localStorage、污染人自己在用的原型数据
  const memoryStorage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => void m.set(String(k), String(v)),
      removeItem: (k) => void m.delete(String(k)),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    } catch (e) {
      console.warn(`换不掉 ${name}`, e);
    }
  }

  // 请求照常走真网络，只记着还有几个没回来
  if (real.fetch) {
    window.fetch = (...a) => {
      pending += 1;
      return real.fetch(...a).finally(() => (pending -= 1));
    };
  }
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    pending += 1;
    this.addEventListener("loadend", () => (pending -= 1), { once: true });
    return xhrSend.apply(this, a);
  };

  const run = (fn, args) => {
    try {
      if (typeof fn === "function") fn(...args);
      else if (typeof fn === "string") (0, eval)(fn);
    } catch (e) {
      console.error(e);
    }
  };
  // 让回调里排下的微任务（Vue 的 nextTick、Promise）跑完，并给浏览器一次排版的机会
  const flush = () => new Promise((r) => real.setTimeout(r, 0));

  /** 新冒出来的 CSS 过渡 / 动画：记下它从虚拟时间哪一刻开始，暂停，拨到当前位置 */
  function syncAnimations(startAt) {
    for (const a of document.getAnimations()) {
      if (!started.has(a)) {
        started.set(a, startAt);
        a.pause();
      }
      a.currentTime = Math.max(0, now - started.get(a));
    }
  }

  function nextDue(limit) {
    let pick = null;
    for (const [id, t] of timers) {
      if (t.at > limit) continue;
      if (!pick || t.at < pick[1].at || (t.at === pick[1].at && id < pick[0])) pick = [id, t];
    }
    return pick;
  }

  window.__promoClock = {
    get now() {
      return now;
    },
    get pending() {
      return pending;
    },
    /** 排查用：还挂着哪些定时器 */
    timers() {
      return [...timers.values()].map((t) => ({ in: t.at - now, every: t.every || 0, fn: String(t.fn).slice(0, 120) }));
    },
    /** 往前拨 ms：按时间顺序触发到期的定时器，再给一帧 requestAnimationFrame，最后对齐 CSS 动画 */
    async advance(ms) {
      const target = now + Math.max(0, ms);
      let guard = 0;
      for (let due = nextDue(target); due && guard < 5000; due = nextDue(target), guard += 1) {
        const [id, t] = due;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        run(t.fn, t.args);
        await flush();
        syncAnimations(now);
      }
      const from = now;
      now = target;
      const cbs = [...frames.values()];
      frames.clear();
      for (const cb of cbs) run(cb, [now]);
      await flush();
      syncAnimations(from);
      await flush();
      syncAnimations(from);
      return now;
    },
    /** 等浏览器真画完一帧再截图（渲染器用；页面里的 requestAnimationFrame 已经是虚拟的了） */
    paint() {
      return new Promise((r) => real.raf(() => real.raf(() => r(true))));
    },
    /** 在当前时刻做一个动作（点击、输入），等它引起的更新落地 */
    async act(fn) {
      run(fn, []);
      await flush();
      syncAnimations(now);
    },
  };
})();
